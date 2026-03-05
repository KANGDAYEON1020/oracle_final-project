#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
06_rerank_with_llm.py
- outputs/bm25_index.pkl 로드
- BM25로 Top-N 후보를 뽑은 뒤
- LLM에 "쿼리-청크" relevance를 점수화(0~100)시키고
- 점수 기준으로 재정렬하여 Top-K 출력

주의/옵션:
- 기본값은 allowed_use가 retrieval_only인 청크는 LLM에 원문을 보내지 않음(=rerank 제외).
  필요하면 --include-retrieval-only 로 포함 가능.
- LLM 호출은 OpenAI Python SDK(openai) 사용 (미설치면 설치 필요)

환경변수:
- RAG_OPENAI_API_KEY: 필수
- (선택) OPENAI_BASE_URL: OpenAI 호환 엔드포인트 사용 시
"""

import argparse
import json
import os
import pickle
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[가-힣]+")

def lexical_gate(query: str, text: str) -> bool:
    q = query.lower()
    t = text.lower()
    if "ehec" in q or "장출혈성" in q or "stec" in q:
        must = ["ehec", "stec", "장출혈성", "enterohemorrhagic"]
        return any(m in t for m in must)
    return True

# -----------------------------
# Tokenize / Filters (05와 동일 계열)
# -----------------------------
def tokenize(text: str) -> list[str]:
    tokens = TOKEN_RE.findall(text.lower())
    out = []
    for t in tokens:
        out.append(t)
        if re.fullmatch(r"[가-힣]+", t) and len(t) >= 2:
            out.extend([t[i : i + 2] for i in range(len(t) - 1)])
    return out


def parse_tags(v):
    if v is None:
        return None
    s = str(v).lower().strip()
    if not s:
        return set()
    s = s.replace(";", ",")
    return {x.strip() for x in s.split(",") if x.strip()}


def match_filters(
    doc,
    publisher=None,
    year_min=None,
    year_max=None,
    disease=None,
    allowed_use=None,
):
    meta = doc.get("meta", {}) or {}

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

    return True


# -----------------------------
# LLM Client (OpenAI SDK)
# -----------------------------
def get_openai_client():
    """
    OpenAI SDK가 있으면 사용.
    - openai>=1.x: from openai import OpenAI
    - base_url 커스텀 가능 (OPENAI_BASE_URL)
    """
    try:
        from openai import OpenAI  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "openai 패키지가 필요합니다.\n"
            "설치: pip install openai\n"
            f"원인: {e}"
        )

    api_key = os.getenv("RAG_OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("환경변수 RAG_OPENAI_API_KEY가 없습니다.")

    base_url = os.getenv("OPENAI_BASE_URL")
    if base_url:
        return OpenAI(api_key=api_key, base_url=base_url)
    return OpenAI(api_key=api_key)


def build_rerank_prompt(
    query: str,
    items: List[Dict[str, Any]],
) -> str:
    """
    LLM에 줄 입력: 쿼리 + 후보 리스트(메타 + 텍스트)
    출력은 JSON만 받도록 강제.
    """
    # 모델이 헛소리 안 하게 매우 강하게 제약
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

    # 후보들 직렬화
    # idx는 이 배치 내부 인덱스(0..len-1)
    lines = [f"QUERY: {query}\n\nCANDIDATES:\n"]
    for i, it in enumerate(items):
        meta = it.get("meta", {}) or {}
        sp = it.get("section_path", "") or ""
        text = (it.get("text", "") or "").strip().replace("\n", " ")
        # 너무 길면 잘라서 토큰 폭주 방지
        if len(text) > 900:
            text = text[:900] + "..."

        lines.append(
            f"[{i}] chunk_id={it.get('chunk_id')} doc_id={it.get('doc_id')} "
            f"page_no={it.get('page_no')}\n"
            f"publisher={meta.get('publisher')} year={meta.get('year')} allowed_use={meta.get('allowed_use')}\n"
            f"section_path={sp}\n"
            f"text={text}\n"
        )

    body = "\n".join(lines)

    return header + "\n" + body


def extract_json(text: str) -> Dict[str, Any]:
    """
    모델이 JSON 앞뒤로 군더더기 붙여도 최대한 JSON만 파싱.
    """
    text = text.strip()
    # 가장 바깥 {} 구간 찾기
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"JSON object not found in model output:\n{text[:500]}")
    return json.loads(text[start : end + 1])


def llm_rerank_batch(
    client,
    model: str,
    query: str,
    items: List[Dict[str, Any]],
    temperature: float = 0.0,
) -> List[Dict[str, Any]]:
    prompt = build_rerank_prompt(query, items)

    # OpenAI Responses API
    # (chat.completions로도 돌릴 수 있지만 responses가 더 범용)
    resp = client.responses.create(
        model=model,
        input=prompt,
        temperature=temperature,
    )

    # SDK 응답에서 텍스트만 뽑기
    # resp.output_text 가 제공되는 버전이 많음
    out_text = getattr(resp, "output_text", None)
    if not out_text:
        # 호환: output 배열을 훑어서 text 수집
        chunks = []
        for o in resp.output:
            if o.type == "message":
                for c in o.content:
                    if c.type == "output_text":
                        chunks.append(c.text)
        out_text = "\n".join(chunks).strip()

    data = extract_json(out_text)
    results = data.get("results", [])
    if not isinstance(results, list):
        raise ValueError("Bad JSON format: 'results' is not a list")

    # idx/score 검증
    out = []
    for r in results:
        if not isinstance(r, dict):
            continue
        idx = int(r.get("idx"))
        score = int(r.get("score"))
        rationale = str(r.get("rationale", "")).strip()
        if idx < 0 or idx >= len(items):
            continue
        out.append({"idx": idx, "score": score, "rationale": rationale})

    # idx 누락 대비: 없는 애들은 0점 처리
    seen = {x["idx"] for x in out}
    for i in range(len(items)):
        if i not in seen:
            out.append({"idx": i, "score": 0, "rationale": ""})

    # 높은 점수 우선
    out.sort(key=lambda x: x["score"], reverse=True)
    return out


# -----------------------------
# Main
# -----------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--q", required=True, help="query text")
    ap.add_argument("--topk", type=int, default=5, help="final top-k after rerank")
    ap.add_argument("--bm25-topn", type=int, default=30, help="candidates from BM25 before rerank")
    ap.add_argument("--publisher", default=None)
    ap.add_argument("--year-min", type=int, default=None)
    ap.add_argument("--year-max", type=int, default=None)
    ap.add_argument("--disease", default=None)
    ap.add_argument("--allowed-use", default=None)
    ap.add_argument("--include-retrieval-only", action="store_true",
                    help="allowed_use=retrieval_only 청크도 LLM rerank에 포함")
    ap.add_argument("--model", default="gpt-4.1-mini", help="OpenAI model name")
    ap.add_argument("--batch-size", type=int, default=12, help="LLM rerank batch size")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--show", type=int, default=320)
    ap.add_argument("--save", default=None, help="save rerank output to json (path)")
    args = ap.parse_args()

    root = Path(".").resolve()
    idx_path = root / "outputs" / "bm25_index.pkl"
    if not idx_path.exists():
        raise FileNotFoundError(f"Missing index: {idx_path} (run 04_build_bm25.py first)")

    with idx_path.open("rb") as f:
        payload = pickle.load(f)

    bm25 = payload["bm25"]
    docs = payload["docs"]

    # 1) BM25 후보 뽑기
    q_tokens = tokenize(args.q)
    scores = bm25.get_scores(q_tokens)
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)

    candidates: List[Dict[str, Any]] = []
    for i in ranked:
        if scores[i] <= 0:
            break

        doc = docs[i]
        if not match_filters(
            doc,
            publisher=args.publisher,
            year_min=args.year_min,
            year_max=args.year_max,
            disease=args.disease,
            allowed_use=args.allowed_use,
        ):
            continue

        meta = doc.get("meta", {}) or {}
        au = str(meta.get("allowed_use", "")).lower()

        if (not args.include_retrieval_only) and ("retrieval_only" in au):
            # retrieval_only는 LLM에 원문 보내지 않는 기본 정책
            continue

        # rerank용으로 bm25 점수도 같이 저장
        c = dict(doc)
        c["_bm25_score"] = float(scores[i])
        candidates.append(c)

        if len(candidates) >= args.bm25_topn:
            break

    if not candidates:
        print("[NO CANDIDATES] Try broader query or relax filters / include retrieval_only.")
        return

    # 2) LLM rerank
    client = get_openai_client()

    reranked_scored: List[Tuple[Dict[str, Any], int, str]] = []
    # 배치 단위로 점수 받기
    bs = max(1, args.batch_size)
    for start in range(0, len(candidates), bs):
        batch = candidates[start : start + bs]
        rr = llm_rerank_batch(
            client=client,
            model=args.model,
            query=args.q,
            items=batch,
            temperature=args.temperature,
        )
        # rr는 batch 내부 idx 기준
        for r in rr:
            item = batch[r["idx"]]
            reranked_scored.append((item, int(r["score"]), r.get("rationale", "")))

    # lexical_gate 적용 (정렬 전에!)
    for i, (item, score, rationale) in enumerate(reranked_scored):
        gate_text = (item.get("section_path", "") + " " + item.get("text", "")).strip()
        if not lexical_gate(args.q, gate_text):
            reranked_scored[i] = (item, min(score, 30), rationale)

    # 전체 합치고, LLM 점수로 정렬 (동점이면 bm25로)
    reranked_scored.sort(key=lambda x: (x[1], x[0].get("_bm25_score", 0.0)), reverse=True)

    # 3) 출력
    print("=" * 90)
    print(f"QUERY: {args.q}")
    print(f"BM25 candidates: {len(candidates)}  | reranked total: {len(reranked_scored)}")
    print("=" * 90)

    topk = max(1, args.topk)
    shown = 0
    out_rows = []

    for item, llm_score, rationale in reranked_scored:
        # gate_text = (item.get("section_path","") + " " + item.get("text","")).strip()
        # if not lexical_gate(args.q, gate_text):
        #     llm_score = min(llm_score, 30)

        meta = item.get("meta", {}) or {}
        sp = item.get("section_path", "") or ""
        text = (item.get("text", "") or "").strip().replace("\n", " ")
        if len(text) > args.show:
            text = text[: args.show] + "..."

        print("-" * 90)
        print(
            f"llm_score={llm_score:3d}  bm25={item.get('_bm25_score', 0.0):.4f}  "
            f"chunk_id={item.get('chunk_id')}  doc_id={item.get('doc_id')}  p={item.get('page_no')}"
        )
        if sp:
            print(f"section_path: {sp}")
        print(f"publisher={meta.get('publisher')}  year={meta.get('year')}  allowed_use={meta.get('allowed_use')}")
        if rationale:
            print(f"rationale: {rationale}")
        print(f"text: {text}")

        out_rows.append(
            {
                "query": args.q,
                "llm_score": llm_score,
                "bm25_score": float(item.get("_bm25_score", 0.0)),
                "chunk_id": item.get("chunk_id"),
                "doc_id": item.get("doc_id"),
                "page_no": item.get("page_no"),
                "section_path": sp,
                "publisher": meta.get("publisher"),
                "year": meta.get("year"),
                "allowed_use": meta.get("allowed_use"),
                "rationale": rationale,
                "text": item.get("text", ""),
            }
        )

        shown += 1
        if shown >= topk:
            break

    # 4) 저장(옵션)
    if args.save:
        save_path = Path(args.save)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(json.dumps(out_rows, ensure_ascii=False, indent=2), encoding="utf-8")
        print("=" * 90)
        print(f"[SAVED] {save_path}")

    print("=" * 90)
    print("[DONE]")


if __name__ == "__main__":
    main()
