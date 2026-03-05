#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
03_chunk_sections.py
v2.3 청킹 전략:
1. 더 작은 chunk 크기 (300 토큰 목표)
2. 문단 단위 분리 강화 (섹션 내에서도 문단별로 분리)
3. Section path를 chunk text에 명시적으로 포함 (검색 강화)
4. 리스트 항목 개별 분리 옵션
5. [v2.2] 목차 필터링 강화 + 헤딩 최대 길이 제한 (2단 레이아웃 오파싱 방지)
6. [v2.3] section_path 최대 길이 100자 제한 (긴 헤딩 체인 방지)
"""

import json
import re
from pathlib import Path
import pandas as pd


# ---------- 헤딩 인식 규칙 ----------
RE_HEADING = [
    re.compile(r"^(PART\s*[IVX0-9]+|Part\s*[IVX0-9]+)\b", re.I),
    re.compile(r"^[IVX]{1,6}\.\s+"),
    re.compile(r"^\d+\.\s+"),          # 1. 개요
    re.compile(r"^[가-하]\.\s*"),      # 가. 목적
    re.compile(r"^\([가-하]\)\s*"),    # (가)
    re.compile(r"^제\s*\d+\s*장"),     # 제1장
]

RE_FIRST_PAGE_NOISE = re.compile(
    r"(doi\s*:|https?://|orcid\.org|corresponding\s+author|e-mail:|fax:|tel:|copyright|©|\baffiliation\b)",
    re.I
)

# [v2.2] 헤딩 최대 길이 (2단 레이아웃 오파싱 방지)
MAX_HEADING_LENGTH = 50

# [v2.3] section_path 최대 길이 (긴 헤딩 체인 방지)
MAX_SECTION_PATH_LENGTH = 100


def heading_level(s: str) -> int:
    """헤딩 레벨 판정"""
    s = s.strip()

    if re.match(r"^(PART\s*[IVX0-9]+|Part\s*[IVX0-9]+)\b", s, re.I):
        return 1
    if re.match(r"^제\s*\d+\s*장", s):
        return 1
    if re.match(r"^[IVX]{1,6}\.\s+", s):
        return 1

    if re.match(r"^\d+\.\s+", s):      # 1. 개요
        return 2
    if re.match(r"^[가-하]\.\s*", s):  # 가. 목적
        return 3
    if re.compile(r"^\([가-하]\)\s*").match(s):  # (가)
        return 4

    return 9


def truncate_section_path(section_path: str, max_len: int = MAX_SECTION_PATH_LENGTH) -> str:
    """
    [v2.3] section_path가 max_len 초과 시 truncate
    - 마지막 섹션(가장 구체적)을 유지
    - 앞부분을 줄여서 "... > 마지막섹션" 형태로
    """
    if len(section_path) <= max_len:
        return section_path
    
    parts = section_path.split(" > ")
    
    # 마지막 섹션만이라도 max_len 넘으면 그냥 자르기
    if len(parts[-1]) >= max_len - 6:
        return parts[-1][:max_len-3] + "..."
    
    # 뒤에서부터 추가하면서 길이 맞추기
    # "... > " prefix = 6자
    prefix = "... > "
    available_len = max_len - len(prefix)
    
    result_parts = []
    current_len = 0
    
    for part in reversed(parts):
        # " > " 구분자 길이 고려 (첫 파트 제외)
        separator_len = 3 if result_parts else 0
        add_len = len(part) + separator_len
        
        if current_len + add_len <= available_len:
            result_parts.insert(0, part)
            current_len += add_len
        else:
            break
    
    if len(result_parts) < len(parts):
        return prefix + " > ".join(result_parts)
    
    return " > ".join(result_parts)


# ---------- 노이즈/목차 패턴 ----------
RE_TOC_LIKE = re.compile(r"\.{3,}\s*\d*$")  # 목차 점선 + 페이지 번호 (선택)
RE_TOC_DOTS = re.compile(r"[·․…]{3,}")  # [v2.2] 가운뎃점, 말줄임표 등
RE_TOC_PAGE_REF = re.compile(r"/{1,2}\s*\d+\s*$")  # [v2.2] "/ 71" 형태

RE_HEADING_BAD = re.compile(
    r"(doi\s*:|https?://|www\.|issn|isbn|copyright|creative\s+commons|open\s+access|license|cc-by|cc\s+by|kogl)",
    re.I
)
RE_HEADING_NOISY = re.compile(r"\bn\s*=\s*\d+\b", re.I)
RE_ENDS_WITH_SENTENCE = re.compile(r"[\.…:]\s*$")
RE_TOO_MANY_WORDS = re.compile(r"(\S+\s+){12,}\S+")

RE_BLACKLIST_PHRASE = re.compile(
    r"(publication\s+format|when\s+the\s+publication|evidence-based|original\s+guidelines|could\s+not\s+be\s+retrieved)",
    re.I
)

RE_BULLET = re.compile(r"^(\-|\•|\·|□|○|▶|※)\s*")
RE_ROMAN_HEADING = re.compile(r"^[IVX]{1,6}\.\s+")
RE_SENTENCE_LIKE = re.compile(r".*[가-힣A-Za-z0-9]\s+(는|은|이|가|을|를)\b")


def is_toc_line(line: str) -> bool:
    """[v2.2] 목차 라인인지 체크"""
    s = line.strip()
    
    # 점선 패턴
    if RE_TOC_LIKE.search(s):
        return True
    if RE_TOC_DOTS.search(s):
        return True
    
    # "/ 71" 형태 페이지 참조
    if RE_TOC_PAGE_REF.search(s):
        return True
    
    return False


def is_heading(line: str) -> bool:
    """헤딩 판별 (v2.2 개선)"""
    if not line:
        return False

    s = line.strip()

    # 공백/너무 짧음
    if not s or len(s) < 2:
        return False

    # [v2.2] 헤딩 최대 길이 제한 (2단 레이아웃 오파싱 방지)
    if len(s) > MAX_HEADING_LENGTH:
        return False

    # [v2.2] 목차 라인 제거
    if is_toc_line(s):
        return False

    # 노이즈 패턴
    if RE_HEADING_BAD.search(s):
        return False
    if RE_HEADING_NOISY.search(s):
        return False
    if RE_BLACKLIST_PHRASE.search(s):
        return False
    if RE_ENDS_WITH_SENTENCE.search(s):
        return False
    if RE_TOO_MANY_WORDS.search(s):
        return False
    # [v2.3] 한글 문장 어미로 끝나면 헤딩 아님
    if re.search(r"(다|요|음|함|됨|임)\s*$", s):
        return False

    # 로마숫자 헤딩 검증 강화
    if RE_ROMAN_HEADING.match(s):
        if len(s) > 40:
            return False
        if RE_SENTENCE_LIKE.search(s):
            return False
        # [v2.3] 로마숫자 뒤에 학명/병원체명(소문자)이 오면 헤딩 아님
        after_roman = re.sub(r"^[IVX]{1,6}\.\s*", "", s)
        if after_roman and after_roman[0].islower():
            return False

    # 실제 헤딩 패턴 매칭
    return any(r.search(s) for r in RE_HEADING)


def chunk_type_of(lines: list[str]) -> str:
    """청크 타입 판별"""
    if not lines:
        return "paragraph"
    # 리스트 판별
    starts = sum(1 for x in lines if RE_BULLET.match(x.strip()))
    if starts >= max(1, len(lines) // 2):
        return "list"
    return "paragraph"


def is_paragraph_break(line: str) -> bool:
    """
    문단 구분선 판별
    - 빈 줄
    - 숫자 리스트 시작 (1., 2., 21., 28. 등)
    - 숫자 괄호 (1), 2), ①, ②)
    - 강한 문단 구분 패턴
    """
    s = line.strip()
    
    # 완전히 빈 줄
    if not s:
        return True
    
    # 숫자 리스트 시작
    # - 숫자 + 마침표: "21. ", "28. "
    # - 숫자 + 괄호: "1)", "2)"  
    # - 원 숫자: "①", "②"
    if re.match(r"^(\d{1,2}[\.\)]\s|[①②③④⑤⑥⑦⑧⑨⑩]\))", s):
        return True
    
    return False


def split_into_paragraphs(lines: list[str]) -> list[list[str]]:
    """
    라인 리스트를 문단 단위로 분리
    빈 줄이나 리스트 시작을 기준으로 분리
    """
    paragraphs = []
    current_para = []
    
    for line in lines:
        if is_paragraph_break(line):
            # 현재 문단 저장
            if current_para:
                paragraphs.append(current_para)
                current_para = []
            # 구분선이 실제 내용이 있으면 새 문단 시작
            if line.strip():
                current_para.append(line)
        else:
            current_para.append(line)
    
    # 마지막 문단 저장
    if current_para:
        paragraphs.append(current_para)
    
    return paragraphs


def should_skip_chunk(text: str, section_path: str) -> bool:
    """
    [v2.2] 청크를 스킵해야 하는지 체크
    - 너무 짧은 청크 (section_path 제외)
    - 목차 라인만 있는 청크
    """
    # section_path 제외한 실제 본문 길이 체크
    actual_content = text.replace(section_path, "").strip() if section_path else text.strip()
    if len(actual_content) < 30:
        return True
    
    # 목차 라인만 있는 청크
    lines = text.strip().split('\n')
    toc_lines = sum(1 for ln in lines if is_toc_line(ln))
    if len(lines) > 0 and toc_lines > len(lines) / 2:
        return True
    
    return False


def main():
    root = Path(".").resolve()
    manifest_path = root / "docs_manifest" / "manifest.csv"
    parsed_dir = root / "parsed"
    chunks_dir = root / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(manifest_path)

    # Manifest 메타 준비
    meta_cols = [
        "publisher", "title", "year", "file_type", "license", "allowed_use",
        "signal_tag", "disease_tags", "section_schema", "priority"
    ]
    meta_by_doc = {}
    for _, r in df.iterrows():
        doc_id = str(r["doc_id"]).strip()
        meta_by_doc[doc_id] = {
            c: ("" if pd.isna(r.get(c)) else str(r.get(c)).strip()) 
            for c in meta_cols
        }
        meta_by_doc[doc_id]["allowed_use"] = (
            meta_by_doc[doc_id]["allowed_use"].lower().replace("-", "_")
        )

    out_path = chunks_dir / "chunks.jsonl"
    out_f = out_path.open("w", encoding="utf-8")

    # 설정값
    MAX_CHUNK_SIZE = 500
    INCLUDE_SECTION_IN_TEXT = True  # section_path를 text 앞에 추가
    NUMBERED_ITEM_FORCE_SPLIT = True  # 숫자 항목(21., 28. 등)에서 강제 분리

    stats = {"total": 0, "skipped": 0, "truncated_paths": 0}

    for doc_json in parsed_dir.glob("*.pages.json"):
        payload = json.loads(doc_json.read_text(encoding="utf-8"))
        doc_id = payload["doc_id"]
        if doc_id not in meta_by_doc:
            print(f"[WARN] doc_id not in manifest: {doc_id}")
            continue

        meta = meta_by_doc[doc_id]
        section_stack: list[tuple[str, int]] = []
        chunk_seq = 0
        doc_skipped = 0

        def emit(chunk_type: str, page_no: int, text: str):
            """청크 방출 함수"""
            nonlocal chunk_seq, doc_skipped
            
            # Section context 추가 (검색 강화)
            raw_section_path = " > ".join([x[0] for x in section_stack]) if section_stack else ""
            
            # [v2.3] section_path 길이 제한
            section_path_str = truncate_section_path(raw_section_path)
            if len(raw_section_path) > MAX_SECTION_PATH_LENGTH:
                stats["truncated_paths"] += 1
            
            if INCLUDE_SECTION_IN_TEXT and section_path_str:
                # Section path를 chunk 앞에 명시적으로 추가
                full_text = f"{section_path_str}\n{text.strip()}"
            else:
                full_text = text.strip()
            
            # [v2.2] 스킵 체크
            if should_skip_chunk(full_text, section_path_str):
                doc_skipped += 1
                stats["skipped"] += 1
                return
            
            chunk_seq += 1
            stats["total"] += 1
            chunk_id = f"{doc_id}:{chunk_seq:06d}"
            
            obj = {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "page_no": page_no,
                "section_path": section_path_str,
                "chunk_type": chunk_type,
                "text": full_text,
                "meta": meta
            }
            out_f.write(json.dumps(obj, ensure_ascii=False) + "\n")

        print(f"\n[CHUNK] {doc_id} from {doc_json.name}")

        for page in payload["pages"]:
            pno = page["page_no"]

            # 목차 페이지 스킵
            toc_hits = sum(
                1 for ln in page["lines"] 
                if RE_TOC_LIKE.search(ln.get("text", "")) or is_toc_line(ln.get("text", ""))
            )
            if toc_hits >= 5:
                print(f"    [SKIP TOC] page {pno}")
                continue

            # 첫 페이지 메타 노이즈 스킵
            if pno == 1:
                noise_hits = sum(
                    1 for ln in page["lines"] 
                    if RE_FIRST_PAGE_NOISE.search(ln.get("text", ""))
                )
                if noise_hits >= 3:
                    print(f"    [SKIP META] page {pno}")
                    continue

            # 라인 처리: 헤딩으로 section 갱신 + 문단 분리
            buf: list[str] = []
            
            for ln in page["lines"]:
                t = ln["text"].strip()
                if not t:
                    # 빈 줄 만나면 버퍼 강제 분리
                    if buf:
                        # 문단 단위로 분리
                        for para in split_into_paragraphs(buf):
                            if para:
                                emit(chunk_type_of(para), pno, "\n".join(para))
                        buf = []
                    continue

                # [v2.2] 목차 라인 스킵
                if is_toc_line(t):
                    continue

                if is_heading(t):
                    # 헤딩 만나면 버퍼 방출
                    if buf:
                        for para in split_into_paragraphs(buf):
                            if para:
                                emit(chunk_type_of(para), pno, "\n".join(para))
                        buf = []

                    # Section stack 갱신
                    lvl = heading_level(t)
                    while section_stack and section_stack[-1][1] >= lvl:
                        section_stack.pop()
                    section_stack.append((t, lvl))
                    continue

                # 숫자 항목에서 강제 분리 (옵션)
                if NUMBERED_ITEM_FORCE_SPLIT and re.match(r"^\d{1,2}[\.\)]\s", t):
                    # 기존 버퍼 먼저 방출
                    if buf:
                        for para in split_into_paragraphs(buf):
                            if para:
                                emit(chunk_type_of(para), pno, "\n".join(para))
                        buf = []
                    # 새 항목 시작
                    buf.append(t)
                    continue

                # 일반 텍스트 누적
                buf.append(t)

                # 크기 제한
                if sum(len(x) for x in buf) > MAX_CHUNK_SIZE:
                    # 문단 단위로 분리
                    for para in split_into_paragraphs(buf):
                        if para:
                            emit(chunk_type_of(para), pno, "\n".join(para))
                    buf = []

            # 페이지 끝 남은 버퍼 처리
            if buf:
                for para in split_into_paragraphs(buf):
                    if para:
                        emit(chunk_type_of(para), pno, "\n".join(para))

            # 표는 별도 청크
            for tb in page.get("tables", []):
                rows = tb.get("rows", [])
                tsv_lines = [
                    "\t".join(r).strip() 
                    for r in rows 
                    if any(c.strip() for c in r)
                ]
                if tsv_lines:
                    emit("table", pno, "\n".join(tsv_lines))

        print(f"  -> chunks emitted: {chunk_seq}, skipped: {doc_skipped}")

    out_f.close()
    print(f"\n[DONE] saved: {out_path}")
    print(f"  total chunks: {stats['total']}, skipped: {stats['skipped']}, truncated paths: {stats['truncated_paths']}")


if __name__ == "__main__":
    main()