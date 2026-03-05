"""
EMR Generator v2 - JSON Output Schemas
프롬프트용 예시 스키마 정의 - 순수 의료 기록만
"""


def get_nursing_note_schema() -> str:
    """간호기록 JSON 스키마"""
    return """{
  "document_type": "nursing_note",
  "subject_id": "17650289",
  "note_type": "PROGRESS",
  "note_datetime": "2024-06-12T08:00:00",
  "hd": 3,
  "d_number": 2,
  "vital_signs": {
    "temp": 37.8,
    "hr": 92,
    "rr": 22,
    "bp_sys": 128,
    "bp_dia": 78,
    "spo2": 93
  },
  "subjective": "숨이 좀 차요",
  "objective": "O2 4L NC 적용 중. 호흡 시 보조근 사용 관찰됨. 흉부 청진 상 RLL crackle 청취됨.",
  "assessment": "가스교환장애",
  "plan_action": "반좌위 유지함. O2 4L 유지 중. SpO2 지속 모니터링함.",
  "o2_device": "Nasal Cannula",
  "o2_flow": "4L/min",
  "intake": 1200,
  "output": 800,
  "notify_md": false
}"""

def get_physician_note_schema() -> str:
    """의사 경과기록 JSON 스키마"""
    return """{
  "document_type": "physician_note",
  "subject_id": "17650289",
  "hadm_id": "29604918",
  "note_type": "PROGRESS",
  "note_datetime": "2024-06-12T09:00:00",
  "hd": 3,
  "d_number": 2,
  "problem_list": [
    "#. CAP (Community-Acquired Pneumonia)",
    "#. AKI (Acute Kidney Injury) - Cr 1.7"
  ],
  "treatment_history": "s/p Levofloxacin D0-D2",
  "subjective": "숨이 차고 가래가 많아요",
  "objective": {
    "vital_signs": {
      "bp": "128/78",
      "hr": 92,
      "rr": 22,
      "bt": 37.8,
      "spo2": 93
    },
    "lab_results": {
      "wbc": 18.2,
      "creatinine": 1.7,
      "crp": 12.5
    },
    "imaging": "CXR: RLL infiltration 증가 소견"
  },
  "assessment": [
    "CAP, worsening - r/o resistant pathogen",
    "AKI stage 1, likely prerenal"
  ],
  "plan": [
    "1. Abx escalation: D/C Levofloxacin, Start Cefepime 2g q12h + Linezolid 600mg q12h",
    "2. IV fluid 유지 (N/S 1L/day)",
    "3. Renal function f/u tomorrow",
    "4. CXR f/u D+2"
  ],
  "raw_text": "[ Progress Note ]\\n\\n주관적 소견(Subjective)\\n#. CAP (Community-Acquired Pneumonia)\\n#. AKI (Acute Kidney Injury) - Cr 1.7\\ns/p Levofloxacin D0-D2\\n\\nS) 숨이 차고 가래가 많아요\\n\\n객관적 소견(Objective)\\nV/S: 128/78 - 92 - 22 - 37.8 - 93%\\nLab: WBC 18.2, Cr 1.7, CRP 12.5\\nCXR: RLL infiltration 증가 소견\\n\\n평가(Assessment)\\nCAP, worsening - r/o resistant pathogen\\nAKI stage 1, likely prerenal\\n\\n치료 계획(Plan)\\n1. Abx escalation: D/C Levofloxacin, Start Cefepime 2g q12h + Linezolid 600mg q12h\\n2. IV fluid 유지 (N/S 1L/day)\\n3. Renal function f/u tomorrow\\n4. CXR f/u D+2"
}"""

def get_radiology_schema() -> str:
    """CXR 판독문 JSON 스키마"""
    return """{
  "document_type": "radiology",
  "subject_id": "17650289",
  "study_type": "CXR",
  "study_datetime": "2024-06-12T10:00:00",
  "hd": 3,
  "d_number": 2,
  "technique": "Portable AP chest radiograph",
  "comparison": "CXR 2024-06-10",
  "findings": "Increased patchy opacity in the right lower lobe compared to prior study. No pleural effusion. Heart size normal.",
  "impression": "Increased right lower lobe opacity, findings suggestive of worsening pneumonia.",
  "severity": "MODERATE"
}"""

# Severity 가이드 (프롬프트 참조용)
SEVERITY_GUIDE = """
Severity 기준 (CXR):
- NORMAL: no active lesion (정상)
- MILD: faint, suspicious, minimal 소견 (경증/초기)
- MODERATE: ill-defined, patch, moderate 소견 (중등도)
- SEVERE: dense, large, air-bronchogram 소견 (중증)
- CRITICAL: ARDS, white-out, massive 소견 (위중)
"""


def get_lab_schema() -> str:
    """Lab 결과 JSON 스키마"""
    return """{
  "document_type": "lab_result",
  "subject_id": "17650289",
  "result_datetime": "2024-06-12T06:00:00",
  "hd": 3,
  "d_number": 2,
  "wbc": 18.2,
  "hgb": 10.8,
  "plt": 245,
  "cr": 1.7,
  "bun": 28,
  "na": 138,
  "k": 4.2,
  "glucose": 142,
  "lactate": 1.8,
  "crp": 12.5,
  "procalcitonin": 0.85
}"""


def get_microbiology_schema() -> str:
    """배양 검사 JSON 스키마"""
    return """{
  "document_type": "microbiology",
  "subject_id": "17650289",
  "specimen_type": "SPUTUM",
  "collection_datetime": "2024-06-10T07:00:00",
  "result_datetime": "2024-06-13T14:00:00",
  "hd": 4,
  "d_number": 3,
  "result_status": "FINAL",
  "gram_stain": "Many PMNs, few epithelial cells, GPC in clusters",
  "organism": "Yeast",
  "colony_count": "Moderate growth",
  "susceptibility": [],
  "is_mdro": false,
  "mdro_type": null,
  "comments": "Yeast isolated - likely colonization. No bacterial pathogen isolated."
}"""