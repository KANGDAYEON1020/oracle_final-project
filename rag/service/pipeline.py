#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import pickle
import re
import threading
import time
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

DEFAULT_EMBED_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
DEFAULT_LLM_MODEL = "gpt-4.1-mini"
COLLECTION_NAME = "medical_chunks"
TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[가-힣]+")

DISEASE_PATTERNS: list[str] = []


def load_disease_patterns(yaml_path: Path | None = None) -> list[str]:
    global DISEASE_PATTERNS

    if yaml_path is None:
        yaml_path = Path(".").resolve() / "config" / "disease_mapping.yaml"

    if yaml_path.exists():
        try:
            import yaml

            with yaml_path.open("r", encoding="utf-8") as f:
                mapping = yaml.safe_load(f)

            patterns: list[str] = []
            for aliases in mapping.values():
                patterns.extend(aliases)

            DISEASE_PATTERNS = patterns
            return patterns
        except Exception:
            pass

    DISEASE_PATTERNS = [
        "노로바이러스", "로타바이러스", "아데노바이러스", "인플루엔자", "RSV", "사포바이러스",
        "콜레라", "장티푸스", "파라티푸스", "세균성이질", "살모넬라", "캄필로박터", "비브리오", "수막구균", "성홍열",
        "장출혈성대장균", "EHEC", "STEC", "장독소성대장균", "ETEC",
        "VRSA", "VISA", "VRE", "CRE", "MRSA",
        "SFTS", "중증열성혈소판감소증후군", "A형간염", "E형간염",
    ]
    return DISEASE_PATTERNS


def tokenize(text: str) -> list[str]:
    tokens = TOKEN_RE.findall(text.lower())
    out: list[str] = []
    for token in tokens:
        out.append(token)
        if re.fullmatch(r"[가-힣]+", token) and len(token) >= 2:
            out.extend([token[i : i + 2] for i in range(len(token) - 1)])
    return out


def normalize_scores(scores: dict[str, float]) -> dict[str, float]:
    if not scores:
        return {}
    vals = list(scores.values())
    min_v, max_v = min(vals), max(vals)
    if max_v == min_v:
        return {k: 1.0 for k in scores}
    return {k: (v - min_v) / (max_v - min_v) for k, v in scores.items()}


def deduplicate_results(results: list[tuple[str, float, dict[str, Any]]], threshold: float = 0.85):
    out: list[tuple[str, float, dict[str, Any]]] = []
    for chunk_id, score, doc in results:
        text = doc.get("text", "").strip()[:300]
        is_dup = False
        for _, _, existing in out:
            existing_text = existing.get("text", "").strip()[:300]
            if text and existing_text and SequenceMatcher(None, text, existing_text).ratio() > threshold:
                is_dup = True
                break
        if not is_dup:
            out.append((chunk_id, score, doc))
    return out


def extract_disease_names(query: str) -> list[str]:
    found: list[str] = []
    for pattern in DISEASE_PATTERNS:
        if re.search(pattern, query, re.IGNORECASE):
            found.append(pattern)
    return found


def expand_queries(query: str) -> list[str]:
    queries = [query]
    diseases = extract_disease_names(query)

    for disease in diseases:
        remaining = re.sub(disease, "", query, flags=re.IGNORECASE).strip()
        remaining = re.sub(r"[와과의을를에]", " ", remaining)
        remaining = " ".join(remaining.split())

        if remaining:
            expanded = f"{disease} 감염증 {remaining}"
            if expanded not in queries:
                queries.append(expanded)

        general = f"{disease} 감염증"
        if general not in queries:
            queries.append(general)

    return queries


def get_openai_client():
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("pip install openai") from exc

    api_key = os.getenv("RAG_OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("RAG_OPENAI_API_KEY 환경변수 필요")

    base_url = os.getenv("OPENAI_BASE_URL")
    return OpenAI(api_key=api_key, base_url=base_url) if base_url else OpenAI(api_key=api_key)


def search_bm25(query: str, bm25_data: dict[str, Any], topn: int = 100):
    bm25, docs = bm25_data["bm25"], bm25_data["docs"]
    scores = bm25.get_scores(tokenize(query))
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    return [(docs[i]["chunk_id"], scores[i], docs[i]) for i in ranked[:topn] if scores[i] > 0]


def search_vector_chroma(query: str, collection, model, topn: int = 100):
    q_emb = model.encode([query], convert_to_numpy=True)[0]
    results = collection.query(
        query_embeddings=[q_emb.tolist()],
        n_results=topn,
        include=["documents", "metadatas", "distances"],
    )
    out = []
    if results and results["ids"]:
        for i, cid in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            meta["_document"] = results["documents"][0][i] if results["documents"] else ""
            out.append((cid, 1.0 - results["distances"][0][i], meta))
    return out


def search_vector_supabase(query: str, sb_client, model, topn: int = 100):
    q_emb = model.encode([query], convert_to_numpy=True)[0]
    response = sb_client.rpc(
        "match_rag_chunks",
        {
            "query_embedding": q_emb.tolist(),
            "match_count": topn,
        },
    ).execute()

    out = []
    if response.data:
        for row in response.data:
            meta = {
                "doc_id": row.get("doc_id", ""),
                "page_no": row.get("page_no", ""),
                "section_path": row.get("section_path", ""),
                "chunk_type": row.get("chunk_type", ""),
                "publisher": row.get("publisher", ""),
                "year": row.get("year", ""),
                "allowed_use": row.get("allowed_use", ""),
                "disease_tags": row.get("disease_tags", ""),
                "_document": row.get("content", ""),
            }
            out.append((row["id"], row.get("similarity", 0.0), meta))
    return out


def hybrid_search_single(
    query: str,
    bm25_data: dict[str, Any],
    vector_backend,
    model,
    alpha: float = 0.5,
    topn: int = 100,
    backend_type: str = "supabase",
):
    bm25_results = search_bm25(query, bm25_data, topn)
    if backend_type == "supabase":
        vector_results = search_vector_supabase(query, vector_backend, model, topn)
    else:
        vector_results = search_vector_chroma(query, vector_backend, model, topn)

    bm25_scores = {r[0]: r[1] for r in bm25_results}
    vector_scores = {r[0]: r[1] for r in vector_results}
    bm25_norm = normalize_scores(bm25_scores)
    vector_norm = normalize_scores(vector_scores)

    all_docs: dict[str, dict[str, Any]] = {}
    for cid, score, doc in bm25_results:
        all_docs[cid] = {"bm25_doc": doc, "bm25_score": score}
    for cid, score, meta in vector_results:
        all_docs.setdefault(cid, {})
        all_docs[cid]["vector_meta"] = meta
        all_docs[cid]["vector_score"] = score

    results = []
    for cid, info in all_docs.items():
        hybrid = alpha * bm25_norm.get(cid, 0) + (1 - alpha) * vector_norm.get(cid, 0)
        doc = info.get("bm25_doc") or {}
        if not doc and info.get("vector_meta"):
            vm = info["vector_meta"]
            doc = {
                "chunk_id": cid,
                "doc_id": vm.get("doc_id", ""),
                "section_path": vm.get("section_path", ""),
                "text": vm.get("_document", ""),
                "meta": vm,
            }
        doc["_hybrid_score"] = hybrid
        results.append((cid, hybrid, doc))

    return results


def hybrid_search_multi(
    queries: list[str],
    bm25_data: dict[str, Any],
    vector_backend,
    model,
    alpha: float = 0.5,
    topn: int = 100,
    must_contain: str | None = None,
    backend_type: str = "supabase",
):
    combined_scores: dict[str, float] = {}
    combined_docs: dict[str, dict[str, Any]] = {}

    for i, query in enumerate(queries):
        query_weight = 1.5 if i == 0 else 1.0
        results = hybrid_search_single(
            query,
            bm25_data,
            vector_backend,
            model,
            alpha,
            topn,
            backend_type=backend_type,
        )

        for cid, score, doc in results:
            weighted_score = score * query_weight
            if cid in combined_scores:
                combined_scores[cid] += weighted_score
            else:
                combined_scores[cid] = weighted_score
                combined_docs[cid] = doc

    merged = [(cid, score, combined_docs[cid]) for cid, score in combined_scores.items()]
    merged.sort(key=lambda x: x[1], reverse=True)
    merged = deduplicate_results(merged)

    if must_contain:
        must = must_contain.lower()
        merged = [
            (c, s, d)
            for c, s, d in merged
            if must in (d.get("section_path", "") + " " + d.get("text", "")).lower()
        ]

    return merged


def rerank_with_llm(
    results: list[tuple[str, float, dict[str, Any]]],
    query: str,
    client,
    model: str,
    topn: int = 20,
    disease_boost: bool = True,
):
    if not results:
        return results

    candidates = results[:topn]
    diseases = extract_disease_names(query)

    prompt = (
        "Score relevance 0-100 for each candidate. Return JSON: {\"results\": [{\"idx\": N, \"score\": N}]}\n\n"
        f"QUERY: {query}\n\nCANDIDATES:\n"
    )
    for i, (_, _, doc) in enumerate(candidates):
        text = doc.get("text", "")[:600].replace("\n", " ")
        prompt += f"[{i}] {doc.get('section_path', '')}: {text}\n"

    resp = client.responses.create(model=model, input=prompt, temperature=0.0)
    out_text = getattr(resp, "output_text", "")
    if not out_text:
        for output in resp.output:
            if output.type == "message":
                for content in output.content:
                    if content.type == "output_text":
                        out_text += content.text

    try:
        start, end = out_text.find("{"), out_text.rfind("}")
        data = json.loads(out_text[start : end + 1])
        scores = {r["idx"]: r["score"] for r in data.get("results", [])}
    except Exception:
        scores = {}

    reranked = []
    for i, (cid, _, doc) in enumerate(candidates):
        base_score = scores.get(i, 0)
        if disease_boost and diseases:
            text = (doc.get("section_path", "") + " " + doc.get("text", "")).lower()
            for disease in diseases:
                if disease.lower() in text:
                    base_score += 15
                    break

        doc["_llm_score"] = base_score
        reranked.append((cid, base_score, doc))

    reranked.sort(key=lambda x: x[1], reverse=True)
    return reranked


def generate_card(query: str, results, client, model: str):
    context_parts = []
    source_refs = []

    for i, (_, _, doc) in enumerate(results[:5]):
        ref_id = i + 1
        meta = doc.get("meta", {}) or {}
        publisher = meta.get("publisher", doc.get("publisher", ""))
        year = meta.get("year", doc.get("year", ""))
        section = doc.get("section_path", "")
        page = doc.get("page_no") or meta.get("page_no") or "N/A"
        text = doc.get("text", "")[:800]
        doc_id = doc.get("doc_id", "")
        cite_label = f"{publisher}({year}, p.{page})"

        source_refs.append(
            {
                "ref_id": ref_id,
                "cite_label": cite_label,
                "doc_id": doc_id,
                "publisher": publisher,
                "year": year,
                "section": section,
                "page": page,
                "text_preview": text[:200] + "..." if len(text) > 200 else text,
            }
        )

        context_parts.append(f"[출처{ref_id}={cite_label}]\n섹션: {section}\n내용: {text}")

    context = "\n\n".join(context_parts)
    cite_list = ", ".join([f"출처{r['ref_id']}={r['cite_label']}" for r in source_refs])

    prompt = f"""다음 검색 결과를 바탕으로 질문에 대한 Knowledge Card를 생성하세요.

질문: {query}

검색 결과:
{context}

규칙:
1. 검색 결과에 있는 정보만 사용하세요
2. 각 정보 뒤에 반드시 인용 표시를 하세요. 인용 형식: {cite_list}
   예: \"잠복기는 2-10일이다. [KDCA 2026, p.89]\"
3. 핵심 정보를 구조화하여 정리하세요
4. 임상적으로 중요한 내용을 우선하세요
5. 한국어로 작성하세요
6. 검색 결과에 없는 내용은 절대 추가하지 마세요

형식:
## [주제]

### 핵심 요약
- (1-2문장 요약) [출처, p.XX]

### 상세 내용
(구조화된 정보, 각 항목에 [출처, p.XX] 인용 표시)

### 주의사항
(있는 경우) [출처, p.XX]
"""

    resp = client.responses.create(model=model, input=prompt, temperature=0.2)

    out_text = getattr(resp, "output_text", "")
    if not out_text:
        for output in resp.output:
            if output.type == "message":
                for content in output.content:
                    if content.type == "output_text":
                        out_text += content.text

    return out_text.strip(), source_refs


def format_references(source_refs: list[dict[str, Any]], debug: bool = False) -> str:
    if not debug:
        lines = ["\n---", "📚 **출처**\n"]
        seen = set()
        for ref in source_refs:
            label = f"{ref['publisher']} ({ref['year']})"
            if label not in seen:
                seen.add(label)
                lines.append(f"- {label}")
        return "\n".join(lines)

    lines = ["\n---", "## 📚 참고 문헌 (DEBUG)\n"]
    for ref in source_refs:
        lines.append(
            f"**{ref['cite_label']}**\n"
            f"  - 문서: {ref['doc_id']}\n"
            f"  - 섹션: {ref['section'] or '(없음)'}\n"
            f"  - 원문: \"{ref['text_preview']}\"\n"
        )
    return "\n".join(lines)


def _clean_md_block(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"^[-*]\s*", "", line)
        lines.append(line)
    return "\n".join(lines).strip()


def parse_card_markdown(markdown_text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {
        "summary": [],
        "detailedContent": [],
        "precautions": [],
    }
    current_key: str | None = None

    section_map = {
        "핵심 요약": "summary",
        "상세 내용": "detailedContent",
        "주의사항": "precautions",
        "주의 사항": "precautions",
        "주의사항 및 고려사항": "precautions",
    }

    for line in markdown_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("### "):
            title = stripped[4:].strip()
            current_key = section_map.get(title)
            continue
        if stripped.startswith("---"):
            current_key = None
            continue
        if current_key:
            sections[current_key].append(line)

    summary = _clean_md_block("\n".join(sections["summary"]))
    detailed = _clean_md_block("\n".join(sections["detailedContent"]))
    precautions = _clean_md_block("\n".join(sections["precautions"]))

    if not summary:
        summary = "검색된 근거를 바탕으로 요약을 생성하지 못했습니다."
    if not detailed:
        detailed = "상세 내용을 생성하지 못했습니다."
    if not precautions:
        precautions = "별도 주의사항이 명시되지 않았습니다."

    return {
        "summary": summary,
        "detailedContent": detailed,
        "precautions": precautions,
    }


def build_sources(source_refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    palette = [
        ("📄", "rose"),
        ("📋", "blue"),
        ("📑", "emerald"),
        ("🧾", "amber"),
        ("📚", "violet"),
    ]
    out = []
    for idx, ref in enumerate(source_refs):
        icon, color = palette[idx % len(palette)]
        title = f"{ref.get('publisher', '')} {ref.get('year', '')}".strip()
        out.append(
            {
                "id": f"src-{idx + 1}",
                "title": title or ref.get("doc_id") or f"Source {idx + 1}",
                "section": ref.get("section") or f"p.{ref.get('page', 'N/A')}",
                "quote": ref.get("text_preview", ""),
                "icon": icon,
                "color": color,
                "citeLabel": ref.get("cite_label", ""),
                "docId": ref.get("doc_id", ""),
                "publisher": ref.get("publisher", ""),
                "year": ref.get("year", ""),
                "page": ref.get("page", ""),
            }
        )
    return out


@dataclass
class RagQueryOptions:
    topk: int = 15
    alpha: float = 0.5
    must_contain: str | None = None
    rerank: bool = False
    no_expand: bool = False
    llm_model: str = DEFAULT_LLM_MODEL
    embed_model: str = DEFAULT_EMBED_MODEL
    backend: str = "supabase"
    disease_yaml: str | None = None


class RagPipeline:
    def __init__(self, root: Path | None = None, load_env_files: bool = True):
        self.root = root or Path(__file__).resolve().parents[1]
        self._load_env_files = load_env_files
        self._lock = threading.Lock()

        self._initialized = False
        self._init_signature: tuple[str, str, str] | None = None

        self._bm25_data = None
        self._embed_model = None
        self._vector_backend = None

    def _load_env(self):
        if not self._load_env_files:
            return
        for env_file in [self.root.parent / ".env.local", self.root.parent / ".env"]:
            if env_file.exists():
                load_dotenv(env_file, override=True)

    def _ensure_initialized(self, options: RagQueryOptions):
        if options.backend not in {"supabase", "chroma"}:
            raise ValueError("backend must be one of: supabase, chroma")

        disease_yaml = options.disease_yaml or str(self.root / "config" / "disease_mapping.yaml")
        signature = (options.embed_model, options.backend, disease_yaml)

        with self._lock:
            if self._initialized and self._init_signature == signature:
                return

            self._load_env()
            load_disease_patterns(Path(disease_yaml))

            bm25_path = self.root / "outputs" / "bm25_index.pkl"
            with bm25_path.open("rb") as f:
                self._bm25_data = pickle.load(f)

            self._embed_model = SentenceTransformer(options.embed_model)

            if options.backend == "supabase":
                from supabase import create_client

                url = os.getenv("SUPABASE_VEC_URL")
                key = os.getenv("SUPABASE_VEC_KEY")
                if not url or not key:
                    raise RuntimeError("SUPABASE_VEC_URL / SUPABASE_VEC_KEY 환경변수 필요")
                self._vector_backend = create_client(url, key)
            else:
                import chromadb
                from chromadb.config import Settings

                chroma_dir = self.root / "outputs" / "chroma_db"
                self._vector_backend = chromadb.PersistentClient(
                    path=str(chroma_dir), settings=Settings(anonymized_telemetry=False)
                ).get_collection(COLLECTION_NAME)

            self._initialized = True
            self._init_signature = signature

    def run_query(self, query: str, options: RagQueryOptions | None = None) -> dict[str, Any]:
        opts = options or RagQueryOptions()
        q = query.strip()
        if not q:
            raise ValueError("query is required")

        self._ensure_initialized(opts)

        started = time.perf_counter()

        queries = [q] if opts.no_expand else expand_queries(q)
        results = hybrid_search_multi(
            queries,
            self._bm25_data,
            self._vector_backend,
            self._embed_model,
            alpha=opts.alpha,
            topn=max(100, opts.topk * 8),
            must_contain=opts.must_contain,
            backend_type=opts.backend,
        )

        if not results:
            elapsed = time.perf_counter() - started
            return {
                "query": q,
                "elapsed": f"{elapsed:.2f}s",
                "elapsedMs": int(elapsed * 1000),
                "sourceCount": 0,
                "summary": "관련 근거를 찾지 못했습니다. 검색어를 더 구체화해 다시 시도하세요.",
                "detailedContent": "검색 결과가 없어 상세 내용을 생성하지 않았습니다.",
                "precautions": "공식 지침 원문을 직접 확인해 주세요.",
                "sources": [],
                "rawMarkdown": "",
                "sourceRefs": [],
            }

        client = get_openai_client()
        ranked = results
        if opts.rerank:
            ranked = rerank_with_llm(ranked, q, client, opts.llm_model)

        card_markdown, source_refs = generate_card(q, ranked[: opts.topk], client, opts.llm_model)
        sections = parse_card_markdown(card_markdown)
        sources = build_sources(source_refs)

        elapsed = time.perf_counter() - started
        return {
            "query": q,
            "elapsed": f"{elapsed:.2f}s",
            "elapsedMs": int(elapsed * 1000),
            "sourceCount": len(sources),
            "summary": sections["summary"],
            "detailedContent": sections["detailedContent"],
            "precautions": sections["precautions"],
            "sources": sources,
            "rawMarkdown": card_markdown,
            "sourceRefs": source_refs,
        }
