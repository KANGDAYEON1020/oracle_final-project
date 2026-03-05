#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
09_eval_retrieval.py
- eval/eval_queries.jsonl 로드
- 하이브리드 검색 실행
- 키워드 기반 hit@k, precision@k 계산 및 리포트

사용법:
    python scripts/09_eval_retrieval.py
    python scripts/09_eval_retrieval.py --topk 10 --alpha 0.6
    python scripts/09_eval_retrieval.py --mode rrf --verbose
    python scripts/09_eval_retrieval.py --rerank --verbose
"""

import argparse
import json
import os
import pickle
import re
from pathlib import Path
from dataclasses import dataclass, field

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer


# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────

DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
COLLECTION_NAME = "medical_chunks"
TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[가-힣]+")


# ─────────────────────────────────────────────────────────────
# 토크나이저
# ─────────────────────────────────────────────────────────────

def tokenize(text: str) -> list[str]:
    tokens = TOKEN_RE.findall(text.lower())
    out = []
    for t in tokens:
        out.append(t)
        if re.fullmatch(r"[가-힣]+", t) and len(t) >= 2:
            out.extend([t[i:i+2] for i in range(len(t) - 1)])
    return out


# ─────────────────────────────────────────────────────────────
# 점수 정규화 및 중복 제거
# ─────────────────────────────────────────────────────────────

def normalize_scores(scores: dict[str, float]) -> dict[str, float]:
    if not scores:
        return {}
    vals = list(scores.values())
    min_v, max_v = min(vals), max(vals)
    if max_v == min_v:
        return {k: 1.0 for k in scores}
    return {k: (v - min_v) / (max_v - min_v) for k, v in scores.items()}


def rrf_score(ranks: list[int], k: int = 60) -> float:
    return sum(1.0 / (k + r) for r in ranks)


def deduplicate_results(results: list, threshold: float = 0.85) -> list:
    from difflib import SequenceMatcher
    out = []
    for chunk_id, score, doc in results:
        text = doc.get("text", "").strip()[:300]
        is_dup = False
        for _, _, existing in out:
            existing_text = existing.get("text", "").strip()[:300]
            if not text or not existing_text:
                continue
            ratio = SequenceMatcher(None, text, existing_text).ratio()
            if ratio > threshold:
                is_dup = True
                break
        if not is_dup:
            out.append((chunk_id, score, doc))
    return out


# ─────────────────────────────────────────────────────────────
# LLM Rerank
# ─────────────────────────────────────────────────────────────

def get_openai_client():
    try:
        from openai import OpenAI
    except ImportError:
        raise RuntimeError("openai 패키지 필요: pip install openai")
    
    api_key = os.getenv("RAG_OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("환경변수 RAG_OPENAI_API_KEY 필요")
    
    base_url = os.getenv("OPENAI_BASE_URL")
    if base_url:
        return OpenAI(api_key=api_key, base_url=base_url)
    return OpenAI(api_key=api_key)


def build_rerank_prompt(query: str, items: list) -> str:
    header = (
        "You are a strict reranking function.\n"
        "Given a query and candidate passages, score relevance from 0 to 100.\n"
        "Return ONLY valid JSON.\n\n"
        "Rules:\n"
        "- 100: answers the query directly with procedural/criteria details.\n"
        "- 70-90: strongly related but partial.\n"
        "- 40-69: somewhat related / background.\n"
        "- 0-39: weak/irrelevant.\n\n"
        "Return JSON object with key 'results' (array).\n"
        "Each result: {\"idx\": <int>, \"score\": <int>, \"rationale\": <string up to 20 words>}.\n"
    )
    
    lines = [f"QUERY: {query}\n\nCANDIDATES:\n"]
    for i, it in enumerate(items):
        meta = it.get("meta", {}) or {}
        sp = it.get("section_path", "") or ""
        text = (it.get("text", "") or "").strip().replace("\n", " ")[:900]
        lines.append(f"[{i}] section_path={sp}\ntext={text}\n")
    
    return header + "\n" + "\n".join(lines)


def extract_json(text: str) -> dict:
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("JSON not found")
    return json.loads(text[start:end + 1])


def llm_rerank_batch(client, model: str, query: str, items: list) -> list:
    prompt = build_rerank_prompt(query, items)
    resp = client.responses.create(model=model, input=prompt, temperature=0.0)
    
    out_text = getattr(resp, "output_text", None)
    if not out_text:
        chunks = []
        for o in resp.output:
            if o.type == "message":
                for c in o.content:
                    if c.type == "output_text":
                        chunks.append(c.text)
        out_text = "\n".join(chunks).strip()
    
    data = extract_json(out_text)
    results = data.get("results", [])
    
    out = []
    for r in results:
        idx = int(r.get("idx", -1))
        score = int(r.get("score", 0))
        if 0 <= idx < len(items):
            out.append({"idx": idx, "score": score})
    
    seen = {x["idx"] for x in out}
    for i in range(len(items)):
        if i not in seen:
            out.append({"idx": i, "score": 0})
    
    return out


def rerank_with_llm(results: list, query: str, model: str, batch_size: int, topn: int) -> list:
    if not results:
        return results
    
    candidates = results[:topn]
    client = get_openai_client()
    reranked = []
    
    for start in range(0, len(candidates), batch_size):
        batch = candidates[start:start + batch_size]
        batch_items = [doc for _, _, doc in batch]
        
        rr = llm_rerank_batch(client, model, query, batch_items)
        
        for r in rr:
            idx = r["idx"]
            chunk_id, hybrid_score, doc = batch[idx]
            doc["_llm_score"] = r["score"]
            reranked.append((chunk_id, r["score"], doc))
    
    reranked.sort(key=lambda x: x[1], reverse=True)
    return reranked


# ─────────────────────────────────────────────────────────────
# 검색 함수
# ─────────────────────────────────────────────────────────────

def search_bm25(query: str, bm25_data: dict, topn: int = 100) -> list[tuple[str, float, dict]]:
    bm25 = bm25_data["bm25"]
    docs = bm25_data["docs"]
    q_tokens = tokenize(query)
    scores = bm25.get_scores(q_tokens)
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    results = []
    for i in ranked[:topn]:
        if scores[i] <= 0:
            break
        doc = docs[i]
        results.append((doc["chunk_id"], scores[i], doc))
    return results


def search_vector(query: str, collection, model: SentenceTransformer, 
                  topn: int = 100) -> list[tuple[str, float, dict]]:
    q_embedding = model.encode([query], convert_to_numpy=True)[0]
    results = collection.query(
        query_embeddings=[q_embedding.tolist()],
        n_results=topn,
        include=["documents", "metadatas", "distances"]
    )
    out = []
    if results and results["ids"]:
        for i, chunk_id in enumerate(results["ids"][0]):
            distance = results["distances"][0][i]
            similarity = 1.0 - distance
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            meta["_document"] = results["documents"][0][i] if results["documents"] else ""
            out.append((chunk_id, similarity, meta))
    return out


def hybrid_search(query: str, bm25_data: dict, collection, model: SentenceTransformer,
                  mode: str = "weighted", alpha: float = 0.5, topn: int = 100,
                  must_contain: str = None, rerank: bool = False, 
                  llm_model: str = "gpt-4.1-mini", batch_size: int = 12,
                  rerank_topn: int = 30) -> list[tuple[str, float, dict]]:
    """하이브리드 검색 + 필터링 + 중복제거"""
    
    bm25_results = search_bm25(query, bm25_data, topn=topn)
    vector_results = search_vector(query, collection, model, topn=topn)
    
    bm25_scores = {r[0]: r[1] for r in bm25_results}
    vector_scores = {r[0]: r[1] for r in vector_results}
    
    all_docs = {}
    for chunk_id, score, doc in bm25_results:
        all_docs[chunk_id] = {"bm25_doc": doc, "bm25_score": score}
    for chunk_id, score, meta in vector_results:
        if chunk_id not in all_docs:
            all_docs[chunk_id] = {}
        all_docs[chunk_id]["vector_meta"] = meta
        all_docs[chunk_id]["vector_score"] = score
    
    if mode == "weighted":
        bm25_norm = normalize_scores(bm25_scores)
        vector_norm = normalize_scores(vector_scores)
        
        results = []
        for chunk_id, info in all_docs.items():
            bm25_s = bm25_norm.get(chunk_id, 0.0)
            vector_s = vector_norm.get(chunk_id, 0.0)
            hybrid_score = alpha * bm25_s + (1 - alpha) * vector_s
            
            doc_info = info.get("bm25_doc") or {}
            if not doc_info and info.get("vector_meta"):
                vm = info["vector_meta"]
                doc_info = {
                    "chunk_id": chunk_id,
                    "doc_id": vm.get("doc_id", ""),
                    "section_path": vm.get("section_path", ""),
                    "text": vm.get("_document", ""),
                    "meta": vm,
                }
            results.append((chunk_id, hybrid_score, doc_info))
    else:
        bm25_ranks = {r[0]: i + 1 for i, r in enumerate(bm25_results)}
        vector_ranks = {r[0]: i + 1 for i, r in enumerate(vector_results)}
        
        results = []
        for chunk_id, info in all_docs.items():
            ranks = []
            if chunk_id in bm25_ranks:
                ranks.append(bm25_ranks[chunk_id])
            if chunk_id in vector_ranks:
                ranks.append(vector_ranks[chunk_id])
            rrf = rrf_score(ranks)
            
            doc_info = info.get("bm25_doc") or {}
            if not doc_info and info.get("vector_meta"):
                vm = info["vector_meta"]
                doc_info = {
                    "chunk_id": chunk_id,
                    "doc_id": vm.get("doc_id", ""),
                    "section_path": vm.get("section_path", ""),
                    "text": vm.get("_document", ""),
                    "meta": vm,
                }
            results.append((chunk_id, rrf, doc_info))
    
    results.sort(key=lambda x: x[1], reverse=True)
    results = deduplicate_results(results)
    
    if must_contain:
        filtered = []
        for chunk_id, score, doc in results:
            text = doc.get("text", "") or ""
            section = doc.get("section_path", "") or ""
            searchable = (section + " " + text).lower()
            if must_contain.lower() in searchable:
                filtered.append((chunk_id, score, doc))
        results = filtered
    
    if rerank:
        results = rerank_with_llm(results, query, llm_model, batch_size, rerank_topn)
    
    return results


# ─────────────────────────────────────────────────────────────
# 평가 로직 (키워드 전용)
# ─────────────────────────────────────────────────────────────

@dataclass
class EvalResult:
    query: str
    topk: int
    hit_keyword: bool = False
    keyword_precision: float = 0.0
    matched_keywords: list = field(default_factory=list)
    missing_keywords: list = field(default_factory=list)


def evaluate_single(query_obj: dict, results: list, topk: int) -> EvalResult:
    query = query_obj["query"]
    expected_keywords = [k.lower() for k in query_obj.get("expected_keywords", [])]
    
    eval_result = EvalResult(query=query, topk=topk)
    top_results = results[:topk]
    matched_kw = set()
    
    for chunk_id, score, doc in top_results:
        text = (doc.get("text", "") or "").lower()
        section_path = (doc.get("section_path", "") or "").lower()
        searchable = section_path + " " + text
        
        for kw in expected_keywords:
            if kw in searchable:
                matched_kw.add(kw)
    
    eval_result.hit_keyword = len(matched_kw) > 0
    
    if expected_keywords:
        eval_result.keyword_precision = len(matched_kw) / len(expected_keywords)
    
    eval_result.matched_keywords = list(matched_kw)
    eval_result.missing_keywords = [kw for kw in expected_keywords if kw not in matched_kw]
    
    return eval_result


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--topn", type=int, default=100)
    ap.add_argument("--mode", choices=["weighted", "rrf"], default="weighted")
    ap.add_argument("--alpha", type=float, default=0.5)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--rerank", action="store_true")
    ap.add_argument("--debug", action="store_true", help="Show detailed chunk info for failed queries")
    ap.add_argument("--llm-model", default="gpt-4.1-mini")
    ap.add_argument("--rerank-topn", type=int, default=30)
    ap.add_argument("--batch-size", type=int, default=12)
    
    args = ap.parse_args()

    root = Path(".").resolve()
    eval_path = root / "eval" / "eval_queries.jsonl"
    bm25_path = root / "outputs" / "bm25_index.pkl"
    chroma_dir = root / "outputs" / "chroma_db"

    if not eval_path.exists():
        raise FileNotFoundError(f"Missing: {eval_path}")
    if not bm25_path.exists():
        raise FileNotFoundError(f"Missing: {bm25_path}")
    if not chroma_dir.exists():
        raise FileNotFoundError(f"Missing: {chroma_dir}")

    queries = []
    with eval_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                queries.append(json.loads(line))
    
    print(f"Loaded {len(queries)} eval queries")
    print(f"Mode: {args.mode}, Alpha: {args.alpha}, Top-k: {args.topk}, Rerank: {args.rerank}")
    print()

    print("Loading BM25 index...")
    with bm25_path.open("rb") as f:
        bm25_data = pickle.load(f)

    print("Loading ChromaDB and embedding model...")
    client = chromadb.PersistentClient(
        path=str(chroma_dir),
        settings=Settings(anonymized_telemetry=False)
    )
    collection = client.get_collection(COLLECTION_NAME)
    model = SentenceTransformer(args.model)
    print()

    all_results: list[EvalResult] = []
    
    for i, q_obj in enumerate(queries, 1):
        query = q_obj["query"]
        must_contain = q_obj.get("must_contain")
        
        results = hybrid_search(
            query=query,
            bm25_data=bm25_data,
            collection=collection,
            model=model,
            mode=args.mode,
            alpha=args.alpha,
            topn=args.topn,
            must_contain=must_contain,
            rerank=args.rerank,
            llm_model=args.llm_model,
            batch_size=args.batch_size,
            rerank_topn=args.rerank_topn,
        )
        
        eval_result = evaluate_single(q_obj, results, args.topk)
        all_results.append(eval_result)

        # DEBUG: 실패/부분 케이스 상세 출력
        if args.debug and eval_result.keyword_precision < 1.0:
            print(f"\n{'='*60}")
            print(f"[DEBUG] Query: {query}")
            print(f"  Expected keywords: {q_obj.get('expected_keywords', [])}")
            print(f"  Matched keywords:  {eval_result.matched_keywords}")
            print(f"  Missing keywords:  {eval_result.missing_keywords}")
            print(f"  Keyword precision: {eval_result.keyword_precision:.0%}")
            print(f"\n  Top-{args.topk} chunks retrieved:")
            for rank, (chunk_id, score, doc) in enumerate(results[:args.topk], 1):
                section_path = doc.get("section_path", "") or "(없음)"
                text_preview = (doc.get("text", "") or "")[:150].replace("\n", " ")
                doc_id = doc.get("doc_id", "")
                print(f"    [{rank}] score={score:.4f}")
                print(f"        doc_id: {doc_id}")
                print(f"        section_path: {section_path}")
                print(f"        text: {text_preview}...")
            print(f"{'='*60}\n")
        
        if args.verbose:
            status = "✅" if eval_result.keyword_precision == 1.0 else "⚠️" if eval_result.hit_keyword else "❌"
            print(f"[{i:2d}] {status} {query[:50]}")
            print(f"     keyword precision: {eval_result.keyword_precision:.0%} ({len(eval_result.matched_keywords)}/{len(q_obj.get('expected_keywords', []))})")
            print(f"     matched: {eval_result.matched_keywords}")
            if eval_result.missing_keywords:
                print(f"     missing: {eval_result.missing_keywords}")
            print()

    print("=" * 70)
    print("EVALUATION SUMMARY (Keyword-Only)")
    print("=" * 70)
    
    n = len(all_results)
    hit_kw = sum(1 for r in all_results if r.hit_keyword)
    perfect_kw = sum(1 for r in all_results if r.keyword_precision == 1.0)
    
    avg_kw_prec = sum(r.keyword_precision for r in all_results) / n if n else 0
    
    print(f"Total queries:          {n}")
    print(f"Mode:                   {args.mode} (alpha={args.alpha})")
    print(f"Top-k:                  {args.topk}")
    print(f"Rerank:                 {args.rerank}")
    print()
    print(f"Hit@{args.topk} (any keyword):  {hit_kw}/{n} ({hit_kw/n*100:.1f}%)")
    print(f"Perfect@{args.topk} (all kw):   {perfect_kw}/{n} ({perfect_kw/n*100:.1f}%)")
    print()
    print(f"Avg keyword precision:  {avg_kw_prec:.3f}")
    print("=" * 70)
    
    failed = [r for r in all_results if r.keyword_precision < 1.0]
    if failed:
        print()
        print("INCOMPLETE QUERIES (missing some keywords):")
        for r in failed:
            status = "⚠️ partial" if r.hit_keyword else "❌ fail"
            print(f"  {status}: {r.query}")
            print(f"           precision: {r.keyword_precision:.0%}, missing: {r.missing_keywords}")


if __name__ == "__main__":
    main()