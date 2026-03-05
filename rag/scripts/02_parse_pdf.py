#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
02_parse_pdf.py
- manifest.csv를 읽어서 source_path의 PDF를 파싱
- 페이지별 'lines'와 'tables'를 추출하여 parsed/{doc_id}.pages.json 저장
- 2단 레이아웃 자동 감지 및 컬럼 분리 처리

가정:
- PDF는 텍스트 기반(스캔 OCR 아님)
"""

import os
import json
import re
from pathlib import Path
from typing import Literal
import pandas as pd
import pdfplumber


# ─────────────────────────────────────────────────────────────
# 노이즈 필터링
# ─────────────────────────────────────────────────────────────

NOISE_RE = re.compile(
    r'^(https?://|orcid\.org|doi:|DOI:|[0-9]+/[0-9]+$|©|copyright|'
    r'e-?mail:|fax:|tel:|corresponding\s+author)',
    re.I
)

def is_noise_line(line: str) -> bool:
    """노이즈 라인 여부 체크"""
    return bool(NOISE_RE.match(line.strip()))


def norm_space(s: str) -> str:
    """공백 정규화"""
    s = s.replace("\u00a0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def fix_broken_text(text: str) -> str:
    """PDF 줄바꿈 깨짐 복구"""
    text = re.sub(r'-\s*\n\s*', '', text)  # 하이픈 연결
    text = re.sub(r'([가-힣])\n([가-힣])', r'\1\2', text)  # 한글
    text = re.sub(r'([a-zA-Z])\n([a-zA-Z])', r'\1 \2', text)  # 영문
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


# ─────────────────────────────────────────────────────────────
# 레이아웃 감지
# ─────────────────────────────────────────────────────────────

def detect_layout(page) -> Literal["single", "two_column"]:
    """
    페이지의 레이아웃 감지 (1단 vs 2단)
    
    왼쪽/오른쪽 단어 비율로 판단:
    - 비율이 0.4 이상이면 2단
    - 그 외는 1단
    """
    try:
        words = page.extract_words()
        if not words:
            return "single"
        
        x_coords = [w['x0'] for w in words]
        mid = page.width / 2
        
        left = len([x for x in x_coords if x < mid])
        right = len([x for x in x_coords if x >= mid])
        
        if max(left, right) == 0:
            return "single"
        
        ratio = min(left, right) / max(left, right)
        
        # 비율이 0.4 이상이면 2단으로 판정
        return "two_column" if ratio > 0.4 else "single"
    
    except Exception:
        return "single"


# ─────────────────────────────────────────────────────────────
# 텍스트 추출
# ─────────────────────────────────────────────────────────────

def extract_lines_single(page) -> list[dict]:
    """
    1단 레이아웃: 기존 방식 (extract_text)
    """
    txt = page.extract_text(x_tolerance=2, y_tolerance=2)
    if not txt:
        return []

    lines = []
    for i, raw in enumerate(txt.splitlines()):
        t = norm_space(raw)
        if not t or len(t) < 3:
            continue
        if is_noise_line(t):
            continue
        t = fix_broken_text(t)
        lines.append({
            "line_no": i,
            "text": t
        })
    return lines


def extract_lines_two_column(page) -> list[dict]:
    """
    2단 레이아웃: 왼쪽 컬럼 먼저, 오른쪽 컬럼 나중에 읽기
    """
    words = page.extract_words()
    if not words:
        return []
    
    mid_x = page.width / 2
    
    # 왼쪽/오른쪽 분리
    left_words = [w for w in words if w['x0'] < mid_x]
    right_words = [w for w in words if w['x0'] >= mid_x]
    
    def words_to_lines(word_list: list) -> list[str]:
        """단어들을 y좌표 기준으로 라인으로 묶기"""
        if not word_list:
            return []
        
        # y좌표(top)로 정렬
        sorted_words = sorted(word_list, key=lambda w: (w['top'], w['x0']))
        
        lines = []
        current_line = []
        current_y = None
        y_tolerance = 5  # 같은 라인으로 볼 y 차이
        
        for w in sorted_words:
            if current_y is None:
                current_y = w['top']
                current_line = [w]
            elif abs(w['top'] - current_y) <= y_tolerance:
                # 같은 라인
                current_line.append(w)
            else:
                # 새 라인
                # x좌표로 정렬해서 합치기
                current_line.sort(key=lambda x: x['x0'])
                line_text = ' '.join([word['text'] for word in current_line])
                lines.append(line_text)
                
                current_y = w['top']
                current_line = [w]
        
        # 마지막 라인
        if current_line:
            current_line.sort(key=lambda x: x['x0'])
            line_text = ' '.join([word['text'] for word in current_line])
            lines.append(line_text)
        
        return lines
    
    # 왼쪽 라인들
    left_lines = words_to_lines(left_words)
    # 오른쪽 라인들
    right_lines = words_to_lines(right_words)
    
    # 왼쪽 먼저, 오른쪽 나중에 결합
    all_lines = left_lines + right_lines
    
    # 정규화 및 필터링
    result = []
    for i, raw in enumerate(all_lines):
        t = norm_space(raw)
        if not t or len(t) < 3:
            continue
        if is_noise_line(t):
            continue
        t = fix_broken_text(t)
        result.append({
            "line_no": i,
            "text": t
        })
    
    return result


def extract_lines(page) -> tuple[list[dict], str]:
    """
    레이아웃 자동 감지 후 적절한 방식으로 라인 추출
    
    Returns:
        (lines, layout_type)
    """
    layout = detect_layout(page)
    
    if layout == "two_column":
        lines = extract_lines_two_column(page)
    else:
        lines = extract_lines_single(page)
    
    return lines, layout


# ─────────────────────────────────────────────────────────────
# 표 추출
# ─────────────────────────────────────────────────────────────

def extract_tables(page) -> list[dict]:
    """
    표는 완벽 파싱 목표가 아니라 '표 블록 단위 분리'가 목적
    """
    tables = []
    try:
        raw_tables = page.extract_tables({
            "vertical_strategy": "lines",
            "horizontal_strategy": "lines",
            "intersection_tolerance": 5,
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "edge_min_length": 10,
        })
    except Exception:
        raw_tables = []

    for ti, tb in enumerate(raw_tables or []):
        cleaned = []
        for row in tb:
            cleaned.append([norm_space(c) if c else "" for c in row])
        tables.append({
            "table_no": ti,
            "rows": cleaned
        })
    return tables


# ─────────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────────

def main():
    root = Path(".").resolve()
    manifest_path = root / "docs_manifest" / "manifest.csv"
    out_dir = root / "parsed"
    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(manifest_path)
    required = ["doc_id", "source_path", "file_type"]
    for c in required:
        if c not in df.columns:
            raise ValueError(f"manifest.csv missing required column: {c}")

    for _, row in df.iterrows():
        doc_id = str(row["doc_id"]).strip()
        src = str(row["source_path"]).strip()
        ftype = str(row["file_type"]).strip().lower()

        if ftype != "pdf":
            print(f"[SKIP] {doc_id}: file_type={ftype}")
            continue

        pdf_path = (root / src).resolve()
        if not pdf_path.exists():
            raise FileNotFoundError(f"[ERROR] PDF not found: {pdf_path}")

        print(f"\n[PARSE] {doc_id}")
        pages_out = []
        layout_stats = {"single": 0, "two_column": 0}

        with pdfplumber.open(str(pdf_path)) as pdf:
            for pno, page in enumerate(pdf.pages, start=1):
                lines, layout = extract_lines(page)
                tables = extract_tables(page)
                layout_stats[layout] += 1

                pages_out.append({
                    "page_no": pno,
                    "layout": layout,
                    "num_lines": len(lines),
                    "num_tables": len(tables),
                    "lines": lines,
                    "tables": tables
                })

        out_path = out_dir / f"{doc_id}.pages.json"
        payload = {
            "doc_id": doc_id,
            "source_path": src,
            "num_pages": len(pages_out),
            "layout_stats": layout_stats,
            "pages": pages_out
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  -> saved: {out_path}")
        print(f"     layout: single={layout_stats['single']}, two_column={layout_stats['two_column']}")


if __name__ == "__main__":
    main()