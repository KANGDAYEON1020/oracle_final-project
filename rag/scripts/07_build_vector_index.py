#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
07_build_vector_index.py
- chunks/chunks.jsonl → 임베딩 생성 → ChromaDB 저장

사용법:
    python scripts/07_build_vector_index.py
    python scripts/07_build_vector_index.py --model paraphrase-multilingual-MiniLM-L12-v2
    python scripts/07_build_vector_index.py --batch-size 64

ChromaDB는 별도 서버 없이 로컬 파일로 저장됨 (outputs/chroma_db/)
"""

import argparse
import json
from pathlib import Path
from tqdm import tqdm

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer


# 기본 임베딩 모델 (한글 지원, 420MB)
DEFAULT_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
COLLECTION_NAME = "medical_chunks"


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
            # section_path 제외한 실제 본문 길이 체크
            actual_content = text.replace(section_path, "").strip()
            if len(actual_content) < 30:
                continue
            docs.append(obj)
    return docs


def create_searchable_text(doc: dict) -> str:
    """검색용 텍스트 생성 (section_path + text)"""
    section = doc.get("section_path", "") or ""
    text = doc.get("text", "") or ""
    return f"{section} {text}".strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL, help="sentence-transformers 모델명")
    ap.add_argument("--batch-size", type=int, default=32, help="임베딩 배치 크기")
    ap.add_argument("--min-length", type=int, default=15, help="최소 청크 길이")
    ap.add_argument("--reset", action="store_true", help="기존 컬렉션 삭제 후 재생성")
    args = ap.parse_args()

    root = Path(".").resolve()
    chunks_path = root / "chunks" / "chunks.jsonl"
    chroma_dir = root / "outputs" / "chroma_db"
    chroma_dir.mkdir(parents=True, exist_ok=True)

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
    print(f"       Embedding dimension: {model.get_sentence_embedding_dimension()}")

    # 3. ChromaDB 클라이언트 생성
    print(f"[3/4] Initializing ChromaDB at {chroma_dir}")
    client = chromadb.PersistentClient(
        path=str(chroma_dir),
        settings=Settings(anonymized_telemetry=False)
    )

    # 기존 컬렉션 처리
    existing = [c.name for c in client.list_collections()]
    if COLLECTION_NAME in existing:
        if args.reset:
            print(f"       Deleting existing collection: {COLLECTION_NAME}")
            client.delete_collection(COLLECTION_NAME)
        else:
            print(f"       Collection '{COLLECTION_NAME}' already exists. Use --reset to rebuild.")
            return

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}  # 코사인 유사도 사용
    )

    # 4. 임베딩 생성 및 저장
    print(f"[4/4] Generating embeddings and storing (batch_size={args.batch_size})")

    # 배치 처리
    for i in tqdm(range(0, len(docs), args.batch_size), desc="Embedding"):
        batch_docs = docs[i:i + args.batch_size]

        # 검색용 텍스트 생성
        texts = [create_searchable_text(d) for d in batch_docs]

        # 임베딩 생성
        embeddings = model.encode(texts, show_progress_bar=False, convert_to_numpy=True)

        # ChromaDB에 저장
        ids = [d["chunk_id"] for d in batch_docs]
        metadatas = []
        for d in batch_docs:
            meta = d.get("meta", {}) or {}
            metadatas.append({
                "doc_id": d.get("doc_id", ""),
                "page_no": str(d.get("page_no", "")),
                "section_path": d.get("section_path", ""),
                "chunk_type": d.get("chunk_type", ""),
                "publisher": meta.get("publisher", ""),
                "year": str(meta.get("year", "")),
                "allowed_use": meta.get("allowed_use", ""),
                "disease_tags": meta.get("disease_tags", ""),
            })

        collection.add(
            ids=ids,
            embeddings=embeddings.tolist(),
            documents=texts,
            metadatas=metadatas,
        )

    print()
    print(f"[DONE] Indexed {len(docs)} chunks")
    print(f"[SAVE] ChromaDB at {chroma_dir}")
    print(f"       Collection: {COLLECTION_NAME}")
    print(f"       Model: {args.model}")


if __name__ == "__main__":
    main()