#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
extract_disease_terms.py
전체 문서에서 질병명 자동 추출 → disease_mapping.yaml 생성

실행: python extract_disease_terms.py
출력: disease_mapping.yaml
"""

import json
import re
from pathlib import Path
from collections import defaultdict
import yaml


def extract_terms_from_text(text: str) -> set[str]:
    """텍스트에서 질병명 패턴 추출"""
    terms = set()
    
    patterns = [
        # 한글 질병명
        (r"[가-힣]{2,}균", "균"),                    # 콜레라균, 살모넬라균
        (r"[가-힣]{2,}감염증?", "감염"),             # 콜레라감염, 이질감염증
        (r"[가-힣]{2,}바이러스", "바이러스"),        # 노로바이러스
        (r"[가-힣]{2,}증후군", "증후군"),            # 용혈성요독증후군
        
        # 영문 질병명
        (r"\b[A-Z][a-z]+\s+species\b", "species"),  # Salmonella species
        (r"\b[A-Z]\.\s*[a-z]+(?:\s+O\d+)?", "학명"), # E. coli, E. coli O157
        (r"\b[A-Z]{2,}\b", "약어"),                  # EHEC, STEC, ETEC
    ]
    
    for pattern, category in patterns:
        matches = re.findall(pattern, text)
        for match in matches:
            normalized = match.strip().lower()
            # 노이즈 필터링
            if len(normalized) < 2:
                continue
            if normalized in ["감염", "균", "바이러스", "질환", "증상"]:
                continue
            terms.add(normalized)
    
    return terms


def group_similar_terms(terms: dict) -> dict:
    """유사 질병명 자동 그룹화"""
    
    # 그룹화 규칙
    rules = [
        {
            "name": "ehec",
            "keywords": ["ehec", "stec", "장출혈", "o157", "출혈성대장균"],
            "terms": []
        },
        {
            "name": "salmonella", 
            "keywords": ["salmonella", "살모넬"],
            "terms": []
        },
        {
            "name": "shigella",
            "keywords": ["shigella", "이질"],
            "terms": []
        },
        {
            "name": "campylobacter",
            "keywords": ["campylobacter", "캄필로"],
            "terms": []
        },
        {
            "name": "vibrio",
            "keywords": ["vibrio", "비브리오", "장염비브리오"],
            "terms": []
        },
        {
            "name": "cholera",
            "keywords": ["cholera", "콜레라"],
            "terms": []
        },
        {
            "name": "typhoid",
            "keywords": ["typhoid", "typhi", "장티푸스", "파라티푸스"],
            "terms": []
        },
        {
            "name": "norovirus",
            "keywords": ["norovirus", "노로바이러스"],
            "terms": []
        },
        {
            "name": "rotavirus",
            "keywords": ["rotavirus", "로타바이러스"],
            "terms": []
        },
        {
            "name": "clostridium",
            "keywords": ["clostridium", "clostridioides", "difficile", "클로스트리디"],
            "terms": []
        },
        {
            "name": "yersinia",
            "keywords": ["yersinia", "예르시니아"],
            "terms": []
        },
        {
            "name": "listeria",
            "keywords": ["listeria", "리스테리아"],
            "terms": []
        },
    ]
    
    # 각 용어를 그룹에 매칭
    unmatched = []
    for term, count in terms.items():
        matched = False
        for rule in rules:
            if any(kw in term for kw in rule["keywords"]):
                rule["terms"].append(term)
                matched = True
                break
        if not matched:
            unmatched.append((term, count))
    
    # 결과 구성
    result = {}
    for rule in rules:
        if rule["terms"]:
            # 빈도순 정렬
            sorted_terms = sorted(
                rule["terms"], 
                key=lambda t: terms[t], 
                reverse=True
            )
            result[rule["name"]] = sorted_terms
    
    # 미매칭 항목 (빈도 높은 것만)
    if unmatched:
        high_freq = [t for t, c in unmatched if c >= 5]
        if high_freq:
            result["_unmatched_high_freq"] = sorted(
                high_freq,
                key=lambda t: terms[t],
                reverse=True
            )[:20]  # 상위 20개만
    
    return result


def main():
    root = Path(".").resolve()
    chunks_path = root / "chunks" / "chunks.jsonl"
    out_path = root / "config" / "disease_mapping.yaml"
    
    if not chunks_path.exists():
        raise FileNotFoundError(f"Missing: {chunks_path}")
    
    print("[1/4] Loading chunks...")
    term_counts = defaultdict(int)
    total_chunks = 0
    
    with chunks_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            
            obj = json.loads(line)
            total_chunks += 1
            
            # section_path + text에서 추출
            searchable = f"{obj.get('section_path', '')} {obj.get('text', '')}"
            terms = extract_terms_from_text(searchable)
            
            for term in terms:
                term_counts[term] += 1
    
    print(f"    Total chunks: {total_chunks}")
    print(f"    Unique terms found: {len(term_counts)}")
    
    print("\n[2/4] Filtering terms...")
    # 최소 2번 이상 나온 용어만 (노이즈 제거)
    filtered = {t: c for t, c in term_counts.items() if c >= 2}
    print(f"    Filtered terms (freq >= 2): {len(filtered)}")
    
    print("\n[3/4] Grouping similar terms...")
    grouped = group_similar_terms(filtered)
    print(f"    Disease groups: {len(grouped)}")
    
    # 그룹별 통계
    for group_name, terms in grouped.items():
        if not group_name.startswith("_"):
            print(f"      - {group_name}: {len(terms)} terms")
    
    print("\n[4/4] Saving to YAML...")
    with out_path.open("w", encoding="utf-8") as f:
        # YAML 헤더 코멘트
        f.write("# Disease term mapping (auto-generated)\n")
        f.write("# 수동으로 수정 가능: 오탐 제거, 누락 추가\n")
        f.write("#\n")
        f.write("# 사용법:\n")
        f.write("#   disease_tags: 'ehec,salmonella' 있으면\n")
        f.write("#   검색 시 아래 매핑된 모든 용어 추가\n")
        f.write("#\n\n")
        
        yaml.dump(grouped, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
    
    print(f"\n[DONE] Saved: {out_path}")
    # print(f"\n다음 단계:")
    # print(f"  1. {out_path} 파일 열기")
    # print(f"  2. 각 그룹 확인하고 오탐 제거")
    # print(f"  3. 누락된 용어 수동 추가")
    # print(f"  4. _unmatched_high_freq 확인해서 새 그룹 필요한지 판단")
    # print(f"  5. 04_build_bm25.py 실행")


if __name__ == "__main__":
    main()