#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
04_build_bm25.py
- chunks/chunks.jsonl 을 읽어 BM25 인덱스 생성
- disease_mapping.yaml 사용하여 질병명 확장
- outputs/bm25_index.pkl 로 저장
"""

import json
import pickle
import re
from pathlib import Path
from rank_bm25 import BM25Okapi
import yaml


TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[가-힣]+")


def tokenize(text: str) -> list[str]:
    """토큰화: 영문/숫자 + 한글 + 2-gram"""
    tokens = TOKEN_RE.findall(text.lower())
    out = []
    for t in tokens:
        out.append(t)
        if re.fullmatch(r"[가-힣]+", t) and len(t) >= 2:
            out.extend([t[i:i+2] for i in range(len(t) - 1)])
    return out


def extract_disease_keywords(disease_tags: str, disease_map: dict) -> list[str]:
    """disease_tags → YAML 매핑 사용하여 확장"""
    if not disease_tags:
        return []
    
    keywords = []
    tags = [t.strip().lower() for t in disease_tags.replace(";", ",").split(",")]
    
    for tag in tags:
        if tag in disease_map:
            keywords.extend(disease_map[tag])
        elif tag:
            keywords.append(tag)
    
    return keywords


def main():
    root = Path(".").resolve()
    chunks_path = root / "chunks" / "chunks.jsonl"
    out_dir = root / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "bm25_index.pkl"

    if not chunks_path.exists():
        raise FileNotFoundError(f"Missing: {chunks_path}")

    # YAML 로드
    yaml_path = root / "config" / "disease_mapping.yaml"
    if yaml_path.exists():
        with yaml_path.open("r", encoding="utf-8") as f:
            DISEASE_MAP = yaml.safe_load(f) or {}
        print(f"[INFO] Loaded disease mapping: {len(DISEASE_MAP)} groups")
    else:
        print(f"[WARN] No disease_mapping.yaml found, skipping disease term expansion")
        DISEASE_MAP = {}

    docs = []
    corpus_tokens = []
    
    stats = {
        "total_lines": 0,
        "skipped_short": 0,
        "indexed": 0,
    }

    with chunks_path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            stats["total_lines"] += 1
            line = line.strip()
            if not line:
                continue
            
            obj = json.loads(line)
            text = obj.get("text", "") or ""
            section_path = obj.get("section_path", "") or ""
            
            # section_path 제외한 실제 본문 길이 체크
            actual_content = text.replace(section_path, "").strip()
            if len(actual_content) < 30:
                stats["skipped_short"] += 1
                continue

            meta = obj.get("meta", {})
            disease_tags = meta.get("disease_tags", "")
            
            # Document 저장
            docs.append({
                "chunk_id": obj.get("chunk_id", ""),
                "doc_id": obj.get("doc_id", ""),
                "page_no": obj.get("page_no", None),
                "section_path": section_path,
                "chunk_type": obj.get("chunk_type", ""),
                "text": text,
                "meta": meta,
            })
            
            # 검색 텍스트 구성
            # 1. Section path 3번 반복
            section_repeated = " ".join([section_path] * 3)
            
            # 2. Disease tags → YAML 매핑 확장
            disease_keywords = extract_disease_keywords(disease_tags, DISEASE_MAP)
            disease_text = " ".join(disease_keywords * 2)
            
            # 3. 최종 검색 텍스트
            searchable = f"{section_repeated} {disease_text} {text}"
            
            corpus_tokens.append(tokenize(searchable))
            stats["indexed"] += 1
            
            if stats["indexed"] % 500 == 0:
                print(f"  ... indexed {stats['indexed']} chunks")

    if not docs:
        raise RuntimeError("No docs loaded from chunks.jsonl")

    print(f"\n[Tokenizing] Building BM25 index...")
    bm25 = BM25Okapi(corpus_tokens)

    payload = {
        "bm25": bm25,
        "docs": docs,
    }

    with out_path.open("wb") as wf:
        pickle.dump(payload, wf)

    print(f"\n[DONE] Indexed: {stats['indexed']} chunks")
    print(f"[SAVE] {out_path}")


if __name__ == "__main__":
    main()