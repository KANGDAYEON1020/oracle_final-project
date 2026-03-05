#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
07b_build_supabase_index.py
- chunks/chunks.jsonl → 임베딩 생성 → Supabase pgvector 저장

사용법:
    python scripts/07b_build_supabase_index.py
    python scripts/07b_build_supabase_index.py --reset
    python scripts/07b_build_supabase_index.py --batch-size 50

사전 조건:
    1. Supabase SQL Editor에서 00_setup_supabase.sql 실행 완료
    2. .env 에 SUPABASE_VEC_URL, SUPABASE_VEC_KEY 설정
    3. pip install supabase sentence-transformers
"""

import argparse
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from tqdm import tqdm

from sentence_transformers import SentenceTransformer
from supabase import create_client, Client


# 기본 임베딩 모델 (한글 지원, 384-dim)
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
TABLE_NAME = "rag_chunks"


def get_supabase_client() -> Client:
    """Supabase 클라이언트 생성"""
    url = os.getenv("SUPABASE_VEC_URL")
    key = os.getenv("SUPABASE_VEC_KEY")
    if not url or not key:
        raise RuntimeError(
            "환경변수 SUPABASE_VEC_URL, SUPABASE_VEC_KEY가 필요합니다.\n"
            ".env 파일에 설정하세요."
        )
    return create_client(url, key)


def load_chunks(chunks_path: Path, min_length: int = 15) -> list[dict]:
    """chunks.jsonl 로드, 너무 짧은 청크 제외"""
    docs = []
    with chunks_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            text = obj.get("text", "") or ""
            section_path = obj.get("section_path", "") or ""
            actual_content = text.replace(section_path, "").strip()
            if len(actual_content) < 30:
                continue
            docs.append(obj)
    return docs


def sanitize_text(text: str) -> str:
    """Postgres text 에 저장 불가능한 \0 (null byte) 제거"""
    return text.replace("\x00", "")


def create_searchable_text(doc: dict) -> str:
    """검색용 텍스트 생성 (section_path + text), null byte 제거"""
    section = sanitize_text(doc.get("section_path", "") or "")
    text = sanitize_text(doc.get("text", "") or "")
    return f"{section} {text}".strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL, help="sentence-transformers 모델명")
    ap.add_argument("--batch-size", type=int, default=50, help="임베딩 & upsert 배치 크기")
    ap.add_argument("--min-length", type=int, default=15, help="최소 청크 길이")
    ap.add_argument("--reset", action="store_true", help="기존 데이터 삭제 후 재업로드")
    args = ap.parse_args()

    # .env 로드
    root = Path(__file__).resolve().parent.parent
    for env_file in [root.parent / ".env.local", root.parent / ".env"]:
        if env_file.exists():
            load_dotenv(env_file, override=True)

    chunks_path = root / "chunks" / "chunks.jsonl"

    if not chunks_path.exists():
        raise FileNotFoundError(f"Missing: {chunks_path}")

    # 1. 청크 로드
    print(f"[1/4] Loading chunks from {chunks_path}")
    docs = load_chunks(chunks_path, min_length=args.min_length)
    print(f"       Loaded {len(docs)} chunks")

    if not docs:
        raise RuntimeError("No chunks loaded!")

    # 2. 임베딩 모델 로드
    print(f"[2/4] Loading embedding model: {args.model}")
    model = SentenceTransformer(args.model)
    dim = model.get_sentence_embedding_dimension()
    print(f"       Embedding dimension: {dim}")

    # 3. Supabase 클라이언트
    print(f"[3/4] Connecting to Supabase")
    sb = get_supabase_client()

    if args.reset:
        print(f"       Deleting all rows from {TABLE_NAME}...")
        # Supabase에서 전체 삭제: id가 빈 문자열이 아닌 모든 행 삭제
        sb.table(TABLE_NAME).delete().neq("id", "").execute()
        print(f"       Done.")

    # 4. 임베딩 생성 및 Supabase에 upsert
    print(f"[4/4] Generating embeddings and uploading (batch_size={args.batch_size})")

    total_uploaded = 0
    for i in tqdm(range(0, len(docs), args.batch_size), desc="Upload"):
        batch_docs = docs[i:i + args.batch_size]

        # 검색용 텍스트
        texts = [create_searchable_text(d) for d in batch_docs]

        # 임베딩 생성
        embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)

        # Supabase에 upsert할 행 준비
        rows = []
        for j, d in enumerate(batch_docs):
            meta = d.get("meta", {}) or {}
            rows.append({
                "id": d["chunk_id"],
                "doc_id": sanitize_text(d.get("doc_id", "")),
                "page_no": str(d.get("page_no", "")),
                "section_path": sanitize_text(d.get("section_path", "")),
                "chunk_type": sanitize_text(d.get("chunk_type", "")),
                "content": texts[j],
                "embedding": embeddings[j].tolist(),
                "publisher": sanitize_text(meta.get("publisher", "")),
                "year": str(meta.get("year", "")),
                "allowed_use": sanitize_text(meta.get("allowed_use", "")),
                "disease_tags": sanitize_text(meta.get("disease_tags", "")),
            })

        # Upsert (중복 id는 업데이트)
        sb.table(TABLE_NAME).upsert(rows).execute()
        total_uploaded += len(rows)

    print()
    print(f"[DONE] Uploaded {total_uploaded} chunks to Supabase")
    print(f"       Table: {TABLE_NAME}")
    print(f"       Model: {args.model}")
    print(f"       Dimension: {dim}")


if __name__ == "__main__":
    main()
