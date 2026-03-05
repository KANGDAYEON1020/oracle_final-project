#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
10_generate_card.py (service-backed CLI)
- rag.service.pipeline를 사용해 Knowledge Card를 생성합니다.

사용법:
    python scripts/10_generate_card.py --q "노로바이러스 잠복기와 증상"
    python scripts/10_generate_card.py --q "EHEC 의심 소견과 주의점" --rerank
    python scripts/10_generate_card.py --q "콜레라 격리 기준" --save cards/cholera.md
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))

from rag.service.pipeline import (  # noqa: E402
    DEFAULT_EMBED_MODEL,
    DEFAULT_LLM_MODEL,
    RagPipeline,
    RagQueryOptions,
    format_references,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--q", required=True, help="쿼리")
    ap.add_argument("--topk", type=int, default=15, help="사용할 청크 수")
    ap.add_argument("--alpha", type=float, default=0.5, help="BM25 가중치")
    ap.add_argument("--must-contain", default=None, help="필수 포함 키워드")
    ap.add_argument("--rerank", action="store_true", help="LLM rerank 사용")
    ap.add_argument("--no-expand", action="store_true", help="쿼리 확장 비활성화")
    ap.add_argument("--llm-model", default=DEFAULT_LLM_MODEL, help="LLM 모델")
    ap.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL, help="임베딩 모델")
    ap.add_argument("--save", default=None, help="카드 저장 경로")
    ap.add_argument("--debug", action="store_true", help="디버그 모드 (원문 포함)")
    ap.add_argument("--verbose", action="store_true", help="상세 로그")
    ap.add_argument("--disease-yaml", default=None, help="disease_mapping.yaml 경로")
    ap.add_argument(
        "--backend",
        choices=["chroma", "supabase"],
        default="supabase",
        help="벡터 DB 백엔드 (chroma/supabase, 기본: supabase)",
    )
    args = ap.parse_args()

    for env_file in [ROOT.parent / ".env.local", ROOT.parent / ".env"]:
        if env_file.exists():
            load_dotenv(env_file, override=True)

    options = RagQueryOptions(
        topk=args.topk,
        alpha=args.alpha,
        must_contain=args.must_contain,
        rerank=args.rerank,
        no_expand=args.no_expand,
        llm_model=args.llm_model,
        embed_model=args.embed_model,
        backend=args.backend,
        disease_yaml=args.disease_yaml,
    )

    pipeline = RagPipeline(root=ROOT, load_env_files=False)

    if args.verbose:
        print(f"Searching: {args.q}")

    result = pipeline.run_query(args.q, options)

    card_markdown = result.get("rawMarkdown", "")
    refs = result.get("sourceRefs", [])
    full_card = card_markdown + format_references(refs, debug=args.debug)

    print()
    print("=" * 70)
    print(full_card)
    print("=" * 70)

    if args.save:
        save_path = Path(args.save)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(full_card, encoding="utf-8")
        print(f"\n[SAVED] {save_path}")


if __name__ == "__main__":
    main()
