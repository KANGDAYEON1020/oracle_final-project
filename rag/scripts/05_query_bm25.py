#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
05_query_bm25.py
- outputs/bm25_index.pkl 로드
- BM25로 Top-k 검색
- (옵션) publisher/year/disease_tag/allowed_use 필터
"""

import argparse
import pickle
import re
from pathlib import Path


TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[가-힣]+")


def tokenize(text: str) -> list[str]:
    tokens = TOKEN_RE.findall(text.lower())
    out = []
    for t in tokens:
        out.append(t)
        if re.fullmatch(r"[가-힣]+", t) and len(t) >= 2:
            out.extend([t[i:i+2] for i in range(len(t) - 1)])
    return out


def parse_tags(v):
    if v is None:
        return None
    # disease_tags가 "a,b,c" 또는 "a;b;c" 등 혼재 가능
    s = str(v).lower().strip()
    if not s:
        return set()
    s = s.replace(";", ",")
    return {x.strip() for x in s.split(",") if x.strip()}


def match_filters(doc, publisher=None, year_min=None, year_max=None, disease=None, allowed_use=None):
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
        # disease에 입력한 값이 tags에 포함되면 통과(부분일치도 허용)
        d = disease.lower().strip()
        if not tags:
            return False
        hit = any(d == t or d in t for t in tags)
        if not hit:
            return False

    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--q", required=True, help="query text")
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--publisher", default=None, help="e.g., KDCA or KSID")
    ap.add_argument("--year-min", type=int, default=None)
    ap.add_argument("--year-max", type=int, default=None)
    ap.add_argument("--disease", default=None, help="e.g., ehec, cholera")
    ap.add_argument("--allowed-use", default=None, help="e.g., retrieval_only, summary_allowed")
    ap.add_argument("--must-contain", default=None, help="결과에 반드시 포함되어야 할 키워드")
    ap.add_argument("--show", type=int, default=280, help="preview chars")
    args = ap.parse_args()

    root = Path(".").resolve()
    idx_path = root / "outputs" / "bm25_index.pkl"
    if not idx_path.exists():
        raise FileNotFoundError(f"Missing index: {idx_path} (run 04_build_bm25.py first)")

    with idx_path.open("rb") as f:
        payload = pickle.load(f)

    bm25 = payload["bm25"]
    docs = payload["docs"]

    q_tokens = tokenize(args.q)
    scores = bm25.get_scores(q_tokens)

    # 점수 내림차순 인덱스
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)

    shown = 0
    for i in ranked:
        doc = docs[i]
        if scores[i] <= 0:
            break

        if not match_filters(
            doc,
            publisher=args.publisher,
            year_min=args.year_min,
            year_max=args.year_max,
            disease=args.disease,
            allowed_use=args.allowed_use,
        ):
            continue
        
        # 필수 키워드 필터
        if args.must_contain:
            searchable = (doc.get("section_path", "") + " " + doc.get("text", "")).lower()
            if args.must_contain.lower() not in searchable:
                continue

        meta = doc.get("meta", {}) or {}
        print("=" * 90)
        print(f"score={scores[i]:.4f}  chunk_id={doc['chunk_id']}  doc_id={doc['doc_id']}  p={doc.get('page_no')}")
        sp = doc.get("section_path", "")
        if sp:
            print(f"section_path: {sp}")
        print(f"publisher={meta.get('publisher')}  year={meta.get('year')}  allowed_use={meta.get('allowed_use')}")
        text = doc.get("text", "").strip().replace("\n", " ")
        print(f"text: {text[:args.show]}{'...' if len(text) > args.show else ''}")

        shown += 1
        if shown >= args.topk:
            break

    if shown == 0:
        print("[NO HIT] Try broader query or remove filters.")


if __name__ == "__main__":
    main()
