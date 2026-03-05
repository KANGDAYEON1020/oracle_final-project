#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
08b_query_hybrid_supabase.py
- BM25 + Supabase pgvector 하이브리드 검색
- 메타데이터 필터링 (publisher/year/disease/allowed_use)
- RRF(Reciprocal Rank Fusion) 또는 가중합 방식 지원

사용법:
    python scripts/08b_query_hybrid_supabase.py --q "EHEC 의심 소견과 주의점" --topk 5
    python scripts/08b_query_hybrid_supabase.py --q "급성 설사 항생제" --publisher KSID --topk 10
    python scripts/08b_query_hybrid_supabase.py --q "검사 의뢰 흐름" --mode rrf --topk 5
    python scripts/08b_query_hybrid_supabase.py --q "탈수 치료" --alpha 0.4 --topk 5

하이브리드 모드:
    - weighted (기본): score = α * bm25_norm + (1-α) * vector_norm
    - rrf: RRF(Reciprocal Rank Fusion) - 순위 기반 결합
"""

import argparse
import json
import os
import pickle
import re
from pathlib import Path
from collections import defaultdict
from typing import Any, Dict, List
from dotenv import load_dotenv

from sentence_transformers import SentenceTransformer
from supabase import create_client, Client


# ─────────────────────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────────────────────

DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
TABLE_NAME = "rag_chunks"
TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[가-힣]+")
DEFAULT_LLM_MODEL = "gpt-4.1-mini"


# ─────────────────────────────────────────────────────────────
# Supabase 클라이언트
# ─────────────────────────────────────────────────────────────

def get_supabase_client() -> Client:
    """Supabase 클라이언트 생성"""
    url = os.getenv("SUPABASE_VEC_URL")
    key = os.getenv("SUPABASE_VEC_KEY")
    if not url or not key:
        raise RuntimeError(
            "환경변수 SUPABASE_VEC_URL, SUPABASE_VEC_KEY가 필요합니다."
        )
    return create_client(url, key)


# ─────────────────────────────────────────────────────────────
# BM25 토크나이저 (04_build_bm25.py와 동일)
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
# 메타데이터 필터링
# ─────────────────────────────────────────────────────────────

def parse_tags(v):
    if v is None:
        return set()
    s = str(v).lower().strip()
    if not s:
        return set()
    s = s.replace(";", ",")
    return {x.strip() for x in s.split(",") if x.strip()}


def match_filters(meta: dict, publisher=None, year_min=None, year_max=None, 
                  disease=None, allowed_use=None, must_contain=None, text="") -> bool:
    """메타데이터 필터 + must_contain 키워드 필터"""
    
    if publisher:
        p = str(meta.get("publisher", "")).lower()
        if publisher.lower() not in p:
            return False

    if allowed_use:
        au = str(meta.get("allowed_use", "")).lower()
        if allowed_use.lower() not in au:
            return False

    if year_min is not None or year_max is not None:
        try:
            y = int(meta.get("year"))
        except Exception:
            return False
        if year_min is not None and y < year_min:
            return False
        if year_max is not None and y > year_max:
            return False

    if disease:
        tags = parse_tags(meta.get("disease_tags", ""))
        d = disease.lower().strip()
        if not tags:
            return False
        hit = any(d == t or d in t for t in tags)
        if not hit:
            return False

    if must_contain:
        searchable = (meta.get("section_path", "") + " " + text).lower()
        if must_contain.lower() not in searchable:
            return False

    return True


# ─────────────────────────────────────────────────────────────
# 점수 정규화
# ─────────────────────────────────────────────────────────────

def normalize_scores(scores: dict[str, float]) -> dict[str, float]:
    """Min-Max 정규화 (0~1)"""
    if not scores:
        return {}
    vals = list(scores.values())
    min_v, max_v = min(vals), max(vals)
    if max_v == min_v:
        return {k: 1.0 for k in scores}
    return {k: (v - min_v) / (max_v - min_v) for k, v in scores.items()}


def rrf_score(ranks: list[int], k: int = 60) -> float:
    """RRF(Reciprocal Rank Fusion) 점수 계산"""
    return sum(1.0 / (k + r) for r in ranks)


def deduplicate_results(results: list, threshold: float = 0.85) -> list:
    """유사도 기반 중복 제거"""
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
    """OpenAI SDK 클라이언트 생성"""
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


def build_rerank_prompt(query: str, items: List[Dict[str, Any]]) -> str:
    """LLM rerank용 프롬프트 생성"""
    header = (
        "You are a strict reranking function.\n"
        "Given a query and candidate passages, score relevance from 0 to 100.\n"
        "Return ONLY valid JSON.\n\n"
        "Rules:\n"
        "- 100: answers the query directly with procedural/criteria details.\n"
        "- 70-90: strongly related but partial.\n"
        "- 40-69: somewhat related / background.\n"
        "- 0-39: weak/irrelevant.\n"
        "- Prefer candidates whose section_path matches the query intent.\n"
        "- Do not use outside knowledge.\n\n"
        "Return JSON object with key 'results' (array).\n"
        "Each result: {\"idx\": <int>, \"score\": <int>, \"rationale\": <string up to 20 words>}.\n"
    )
    
    lines = [f"QUERY: {query}\n\nCANDIDATES:\n"]
    for i, it in enumerate(items):
        meta = it.get("meta", {}) or {}
        sp = it.get("section_path", "") or ""
        text = (it.get("text", "") or "").strip().replace("\n", " ")
        if len(text) > 900:
            text = text[:900] + "..."
        
        lines.append(
            f"[{i}] chunk_id={it.get('chunk_id')} doc_id={it.get('doc_id')} "
            f"page_no={it.get('page_no')}\n"
            f"publisher={meta.get('publisher')} year={meta.get('year')}\n"
            f"section_path={sp}\n"
            f"text={text}\n"
        )
    
    return header + "\n" + "\n".join(lines)


def extract_json(text: str) -> Dict[str, Any]:
    """LLM 출력에서 JSON 추출"""
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"JSON not found in: {text[:500]}")
    return json.loads(text[start:end + 1])


def llm_rerank_batch(client, model: str, query: str, items: List[Dict[str, Any]], 
                     temperature: float = 0.0) -> List[Dict[str, Any]]:
    """LLM으로 배치 rerank"""
    prompt = build_rerank_prompt(query, items)
    
    resp = client.responses.create(
        model=model,
        input=prompt,
        temperature=temperature,
    )
    
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
        if not isinstance(r, dict):
            continue
        idx = int(r.get("idx", -1))
        score = int(r.get("score", 0))
        rationale = str(r.get("rationale", "")).strip()
        if 0 <= idx < len(items):
            out.append({"idx": idx, "score": score, "rationale": rationale})
    
    # 누락된 idx는 0점 처리
    seen = {x["idx"] for x in out}
    for i in range(len(items)):
        if i not in seen:
            out.append({"idx": i, "score": 0, "rationale": ""})
    
    return out


def rerank_with_llm(results: list, query: str, model: str = DEFAULT_LLM_MODEL,
                    batch_size: int = 12, topn: int = 30) -> list:
    """하이브리드 결과를 LLM으로 rerank"""
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
            doc["_llm_rationale"] = r["rationale"]
            reranked.append((chunk_id, r["score"], doc))
    
    reranked.sort(key=lambda x: (x[1], x[2].get("_hybrid_score", 0)), reverse=True)
    
    return reranked


# ─────────────────────────────────────────────────────────────
# BM25 검색
# ─────────────────────────────────────────────────────────────

def search_bm25(query: str, bm25_data: dict, topn: int = 100) -> list[tuple[str, float, dict]]:
    """BM25 검색, (chunk_id, score, doc) 리스트 반환"""
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


# ─────────────────────────────────────────────────────────────
# Supabase Vector 검색
# ─────────────────────────────────────────────────────────────

def search_vector_supabase(query: str, sb: Client, model: SentenceTransformer,
                           topn: int = 100, filter_publisher: str = None,
                           filter_doc_id: str = None) -> list[tuple[str, float, dict]]:
    """Supabase pgvector 검색, (chunk_id, similarity, meta) 리스트 반환"""
    
    # 쿼리 임베딩
    q_embedding = model.encode([query], convert_to_numpy=True)[0]
    
    # RPC 호출
    params = {
        "query_embedding": q_embedding.tolist(),
        "match_count": topn,
    }
    if filter_publisher:
        params["filter_publisher"] = filter_publisher
    if filter_doc_id:
        params["filter_doc_id"] = filter_doc_id
    
    response = sb.rpc("match_rag_chunks", params).execute()
    
    out = []
    if response.data:
        for row in response.data:
            chunk_id = row["id"]
            similarity = row.get("similarity", 0.0)
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
            out.append((chunk_id, similarity, meta))
    
    return out


# ─────────────────────────────────────────────────────────────
# 하이브리드 결합
# ─────────────────────────────────────────────────────────────

def hybrid_weighted(bm25_results: list, vector_results: list, 
                    alpha: float = 0.5) -> list[tuple[str, float, dict]]:
    """
    가중합 방식 하이브리드
    score = α * bm25_norm + (1-α) * vector_norm
    """
    bm25_scores = {r[0]: r[1] for r in bm25_results}
    vector_scores = {r[0]: r[1] for r in vector_results}
    
    bm25_norm = normalize_scores(bm25_scores)
    vector_norm = normalize_scores(vector_scores)
    
    all_docs = {}
    for chunk_id, score, doc in bm25_results:
        all_docs[chunk_id] = {"bm25_doc": doc, "bm25_score": score}
    for chunk_id, score, meta in vector_results:
        if chunk_id not in all_docs:
            all_docs[chunk_id] = {}
        all_docs[chunk_id]["vector_meta"] = meta
        all_docs[chunk_id]["vector_score"] = score
    
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
                "page_no": vm.get("page_no", ""),
                "section_path": vm.get("section_path", ""),
                "chunk_type": vm.get("chunk_type", ""),
                "text": vm.get("_document", ""),
                "meta": vm,
            }
        
        doc_info["_bm25_score"] = info.get("bm25_score", 0.0)
        doc_info["_vector_score"] = info.get("vector_score", 0.0)
        doc_info["_hybrid_score"] = hybrid_score
        
        results.append((chunk_id, hybrid_score, doc_info))
    
    results.sort(key=lambda x: x[1], reverse=True)
    return results


def hybrid_rrf(bm25_results: list, vector_results: list, 
               k: int = 60) -> list[tuple[str, float, dict]]:
    """
    RRF(Reciprocal Rank Fusion) 방식 하이브리드
    """
    bm25_ranks = {r[0]: i + 1 for i, r in enumerate(bm25_results)}
    vector_ranks = {r[0]: i + 1 for i, r in enumerate(vector_results)}
    
    all_docs = {}
    for chunk_id, score, doc in bm25_results:
        all_docs[chunk_id] = {"bm25_doc": doc, "bm25_score": score}
    for chunk_id, score, meta in vector_results:
        if chunk_id not in all_docs:
            all_docs[chunk_id] = {}
        all_docs[chunk_id]["vector_meta"] = meta
        all_docs[chunk_id]["vector_score"] = score
    
    results = []
    for chunk_id, info in all_docs.items():
        ranks = []
        if chunk_id in bm25_ranks:
            ranks.append(bm25_ranks[chunk_id])
        if chunk_id in vector_ranks:
            ranks.append(vector_ranks[chunk_id])
        
        rrf = rrf_score(ranks, k=k)
        
        doc_info = info.get("bm25_doc") or {}
        if not doc_info and info.get("vector_meta"):
            vm = info["vector_meta"]
            doc_info = {
                "chunk_id": chunk_id,
                "doc_id": vm.get("doc_id", ""),
                "page_no": vm.get("page_no", ""),
                "section_path": vm.get("section_path", ""),
                "chunk_type": vm.get("chunk_type", ""),
                "text": vm.get("_document", ""),
                "meta": vm,
            }
        
        doc_info["_bm25_score"] = info.get("bm25_score", 0.0)
        doc_info["_vector_score"] = info.get("vector_score", 0.0)
        doc_info["_rrf_score"] = rrf
        doc_info["_bm25_rank"] = bm25_ranks.get(chunk_id)
        doc_info["_vector_rank"] = vector_ranks.get(chunk_id)
        
        results.append((chunk_id, rrf, doc_info))
    
    results.sort(key=lambda x: x[1], reverse=True)
    return results


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--q", required=True, help="쿼리 텍스트")
    ap.add_argument("--topk", type=int, default=5, help="최종 출력 개수")
    ap.add_argument("--topn", type=int, default=100, help="BM25/Vector 각각 후보 개수")
    ap.add_argument("--mode", choices=["weighted", "rrf"], default="weighted", 
                    help="하이브리드 모드 (weighted/rrf)")
    ap.add_argument("--alpha", type=float, default=0.5, 
                    help="weighted 모드: BM25 가중치 (0~1, 기본 0.5)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="임베딩 모델")
    
    # 필터 옵션
    ap.add_argument("--publisher", default=None)
    ap.add_argument("--year-min", type=int, default=None)
    ap.add_argument("--year-max", type=int, default=None)
    ap.add_argument("--disease", default=None)
    ap.add_argument("--allowed-use", default=None)
    ap.add_argument("--must-contain", default=None, help="결과에 반드시 포함될 키워드")
    
    ap.add_argument("--show", type=int, default=280, help="텍스트 미리보기 길이")
    ap.add_argument("--verbose", action="store_true", help="상세 점수 출력")
    
    # LLM rerank 옵션
    ap.add_argument("--rerank", action="store_true", help="LLM rerank 사용")
    ap.add_argument("--llm-model", default=DEFAULT_LLM_MODEL, help="LLM 모델명")
    ap.add_argument("--rerank-topn", type=int, default=30, help="rerank할 후보 수")
    ap.add_argument("--batch-size", type=int, default=12, help="LLM 배치 크기")
    
    args = ap.parse_args()

    # .env 로드
    root = Path(__file__).resolve().parent.parent
    for env_file in [root.parent / ".env.local", root.parent / ".env"]:
        if env_file.exists():
            load_dotenv(env_file, override=True)

    bm25_path = root / "outputs" / "bm25_index.pkl"

    if not bm25_path.exists():
        raise FileNotFoundError(f"Missing BM25 index: {bm25_path}")

    # 1. BM25 로드
    print(f"Loading BM25 index...")
    with bm25_path.open("rb") as f:
        bm25_data = pickle.load(f)

    # 2. Supabase + 임베딩 모델 로드
    print(f"Loading Supabase client and embedding model...")
    sb = get_supabase_client()
    model = SentenceTransformer(args.model)

    # 3. 검색 실행
    print(f"Searching...")
    bm25_results = search_bm25(args.q, bm25_data, topn=args.topn)
    vector_results = search_vector_supabase(
        args.q, sb, model, topn=args.topn,
        filter_publisher=args.publisher,
    )

    # 4. 하이브리드 결합
    if args.mode == "weighted":
        hybrid_results = hybrid_weighted(bm25_results, vector_results, alpha=args.alpha)
    else:
        hybrid_results = hybrid_rrf(bm25_results, vector_results)

    # 중복 제거
    hybrid_results = deduplicate_results(hybrid_results)

    # 5. LLM rerank (옵션)
    if args.rerank:
        print(f"Running LLM rerank (model={args.llm_model}, topn={args.rerank_topn})...")
        hybrid_results = rerank_with_llm(
            hybrid_results, 
            query=args.q,
            model=args.llm_model,
            batch_size=args.batch_size,
            topn=args.rerank_topn,
        )

    # 6. 필터링 및 출력
    print()
    print("=" * 90)
    print(f"QUERY: {args.q}")
    print(f"MODE: {args.mode}" + (f" (alpha={args.alpha})" if args.mode == "weighted" else ""))
    print(f"BM25 candidates: {len(bm25_results)}  |  Vector candidates: {len(vector_results)}")
    print("=" * 90)

    shown = 0
    for chunk_id, score, doc in hybrid_results:
        # 메타데이터 필터
        meta = doc.get("meta", {}) or {}
        if not meta:
            meta = {
                "publisher": doc.get("publisher", ""),
                "year": doc.get("year", ""),
                "allowed_use": doc.get("allowed_use", ""),
                "disease_tags": doc.get("disease_tags", ""),
                "section_path": doc.get("section_path", ""),
            }
        
        text = doc.get("text", "") or ""
        
        if not match_filters(
            meta,
            publisher=args.publisher,
            year_min=args.year_min,
            year_max=args.year_max,
            disease=args.disease,
            allowed_use=args.allowed_use,
            must_contain=args.must_contain,
            text=text,
        ):
            continue

        print("-" * 90)
        
        # 점수 출력
        if args.rerank:
            llm_score = doc.get('_llm_score', 0)
            rationale = doc.get('_llm_rationale', '')
            score_str = f"llm={llm_score}"
            if args.verbose:
                score_str += f"  hybrid={doc.get('_hybrid_score', 0):.4f}  bm25={doc.get('_bm25_score', 0):.4f}  vec={doc.get('_vector_score', 0):.4f}"
        elif args.mode == "weighted":
            score_str = f"hybrid={score:.4f}"
            if args.verbose:
                score_str += f"  bm25={doc.get('_bm25_score', 0):.4f}  vec={doc.get('_vector_score', 0):.4f}"
        else:
            score_str = f"rrf={score:.4f}"
            if args.verbose:
                bm25_r = doc.get('_bm25_rank', '-')
                vec_r = doc.get('_vector_rank', '-')
                score_str += f"  bm25_rank={bm25_r}  vec_rank={vec_r}"
        
        print(f"{score_str}  chunk_id={chunk_id}  doc_id={doc.get('doc_id', '')}  p={doc.get('page_no', '')}")
        
        sp = doc.get("section_path", "")
        if sp:
            print(f"section_path: {sp}")
        
        pub = meta.get("publisher", doc.get("publisher", ""))
        year = meta.get("year", doc.get("year", ""))
        au = meta.get("allowed_use", doc.get("allowed_use", ""))
        print(f"publisher={pub}  year={year}  allowed_use={au}")
        
        # LLM rationale 출력
        if args.rerank and doc.get('_llm_rationale'):
            print(f"rationale: {doc.get('_llm_rationale')}")
        
        text_preview = text.strip().replace("\n", " ")
        print(f"text: {text_preview[:args.show]}{'...' if len(text_preview) > args.show else ''}")

        shown += 1
        if shown >= args.topk:
            break

    if shown == 0:
        print("[NO HIT] Try broader query or remove filters.")


if __name__ == "__main__":
    main()
