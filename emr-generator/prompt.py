"""
EMR Generator v2 - 통합 한국어 프롬프트

설계 철학:
1. 전역 프롬프트: 모든 환자에게 동일하게 적용 (환자별 맞춤 프롬프트 X)
2. 시나리오 데이터: 환자별 변수로 주입
3. LLM이 시나리오 타임라인을 보고 스스로 필요한 문서 판단
4. 문서별 생성 주기 규칙 명시 (간호 8h, 배양 3일, CXR 당일 등)
5. v1 스타일의 자연스러운 의료 문서 형식 + v2의 구조화된 JSON
"""

from schemas import (
    get_nursing_note_schema,
    get_physician_note_schema,
    get_radiology_schema,
    get_lab_schema,
    get_microbiology_schema,
    SEVERITY_GUIDE
)


# =============================================================================
# 전역 시스템 프롬프트 (모든 환자 공통)
# =============================================================================
SYSTEM_PROMPT = """당신은 대학병원의 숙련된 의료 기록 작성 전문가입니다.
환자의 임상 시나리오와 실제 타임라인 데이터를 바탕으로 다양한 의무기록을 JSON 형식으로 작성합니다.

## 역할
- 간호사로서 간호기록 작성 (Shift 교대 기반)
- 담당 전공의/주치의로서 의사 경과기록 작성
- 영상의학과 전문의로서 CXR 판독문 작성
- 진단검사의학과로서 검사 결과 보고서 작성

## 핵심 규칙 (반드시 준수)

### 1. Language Style (Medical Konglish)
- **의학 용어는 영어, 서술/연결어는 한국어**
  - ✅ 올바른 예: "RLL에 consolidation이 관찰됩니다", "Dr. Kim notify함", "O2 apply함"
  - ❌ 틀린 예: "Consolidation was observed in RLL" (전체 영어 금지)
- **축약형 사용**: ~함, ~음, ~임 또는 명사형 종결
- **의료 약어 적극 사용**: c/o, f/u, Rt/Lt, abd, w/, s/p, r/o, adm, ER, Imp), C.C), PHx)

### 2. Vital Signs 형식 (필수)
- 순서 고정: **BP - HR - RR - Temp - SpO2**
- 구분자: 하이픈(-)
- 단위 생략
- **모든 필드 필수**: 빈 값, null, 하이픈만 있는 값 금지
- vital_signs 객체의 모든 필드(temp, hr, rr, bp_sys, bp_dia, spo2)는 반드시 숫자 값 포함
- 타임라인에 값이 없으면 환자 상태에 맞는 의학적 모순이 없고 합리적인 값 생성
- ✅ 올바른 예: 120/80 - 88 - 18 - 37.2 - 98%
- ❌ 틀린 예: - - 30 - 39.0 - 85% (빈 값 금지)

### 3. Past History 형식
- (+) / (-) 표기법 사용
- 예: PHx) HTN(+)/DM(-)/Tbc(-)/Hepatitis(-)

### 4. 출력 형식
- 모든 문서는 **JSON 형식**으로만 출력
- 각 문서는 지정된 스키마를 정확히 따름
- 마크다운이나 추가 설명 없이 JSON만 출력

### 5. 간호기록 특별 규칙 ⚠️
- **현재 상태만 기록**: 관찰 시점의 상태만 기술
- **호전/악화 언급 절대 금지**: "좋아졌다", "나빠졌다", "호전", "악화", "개선", "worse" 등 사용 금지
- **비교 표현 금지**: "이전보다", "어제보다", "compared to" 등 사용 금지
- **객관적 관찰만**: 현재 SpO2, V/S, 호흡 양상 등 관찰 가능한 사실만 기록

❌ 잘못된 예: "SpO2가 어제보다 떨어졌다", "호흡 상태 악화됨"
✅ 올바른 예: "SpO2 93% 측정됨", "호흡 시 보조근 사용 관찰됨"

### 6. 진단 표현 규칙
- **절대 금지**: "확진", "confirmed", "definite diagnosis"
- **허용 표현**: "Imp)", "의심", "r/o", "consistent with", "suggestive of"

### 7. 시간적 일관성
- 이전 기록과 수치/상태가 논리적으로 연결되어야 함
- Lab 수치, 활력징후, 산소 요구량의 연속성 유지
- 급격한 변동 시 의사 기록에서 설명 필요

### 8. 항생제 기록 일관성 ⚠️
- 현재 사용 중인 항생제를 정확히 기록
- 약물명 혼동 금지 (예: Cefepime ≠ Cefpodoxime)
- 변경 시점과 사유 명확히 기록

### 9. Hospital Day (HD) vs D-number 규칙
- **HD (Hospital Day)**: 입원일부터 1일씩 증가 (HD 1 = 입원일)
- **D-number**: 시나리오의 핵심 이벤트(D0) 기준 상대적 날짜
  - D0: 핵심 이벤트 발생일 (예: 폐렴 발병, 수술일 등)
  - D-2, D-1: D0 이전 (전구 증상, baseline 상태)
  - D+1, D+2: D0 이후 (치료 반응, 경과)
- **기록 시 HD와 D-number 모두 표기**: 시간적 맥락 명확화

### 10. 타임라인 데이터 활용 규칙
- **MIMIC 타임라인 데이터가 제공된 경우**: 해당 값을 우선 사용
- **타임라인에 값이 없거나 null인 경우**: 시나리오 설정과 환자 상태에 맞게 의학적 모순이 없고 합리적인 값 생성
  - 약물: 시나리오에 명시된 항생제/약물 사용
- **절대 빈 값, null, 하이픈(-) 단독 사용 금지**
- 생성한 값은 이전 기록과 연속성 유지 필수

#### Vital Signs 생성 규칙
- 모든 필드(temp, hr, rr, bp_sys, bp_dia, spo2) 필수
- 환자의 현재 임상 상태(감염 경과, O2 요구량, 패혈증 여부)에 맞는 값 생성
- 정상 범위 참고:
  - BP: 90~140 / 60~90 mmHg (패혈증 시 저하 가능)
  - HR: 60~100 bpm (발열/감염 시 상승)
  - RR: 12~20 /min (호흡부전 시 상승)
  - Temp: 36.5~37.5°C (감염 시 상승)
  - SpO2: 95~100% (폐렴/ARDS 시 저하)

#### Lab 결과 생성 규칙
- 타임라인에 값이 없으면 **시나리오 trajectory 및 HD별 이벤트**에 맞는 값 생성
- 정상 범위 및 감염 시 예상 범위:
  - **WBC**: 정상 4~10 / 감염 시 12~20+
  - **CRP**: 정상 <0.5 / 감염 시 10~20+
  - **Procalcitonin**: 정상 <0.1 / 세균감염 시 0.5~10+
  - **Lactate**: 정상 <2.0 / 패혈증 시 2~4+
  - **Cr**: 기저값 기준, AKI 시 1.5~2배 상승
  - **BUN**: Cr과 연동
- **시나리오 trajectory를 따를 것**: 각 HD별 이벤트(악화/호전/peak 등)에 맞춰 값 조정
- 급격한 변동 금지 (전날 대비 ±30% 이내 권장)

#### 배양 결과 생성 규칙
- 채취일: COLLECTED 상태
- 채취 후 1일: PRELIMINARY (Gram stain 결과)
- 채취 후 2-3일: FINAL (균 동정 + 감수성)
- 시나리오에 명시된 균/MDRO 타입 준수

"""


# =============================================================================
# 문서 타입별 생성 규칙 (전역 - 현실 반영)
# =============================================================================
DOCUMENT_GENERATION_RULES = """
## 문서 타입별 생성 규칙 (현실 반영)

### 1. 간호기록 (nursing_note)
- **생성 주기**: 8시간마다 (Shift 교대)
  - Day Shift: 09:30
  - Evening Shift: 17:30
  - Night Shift: 01:30 (익일)
- **매일 3회 생성**
- **note_type**: ADMISSION(HD 1 또는 D0) / PROGRESS(일반) / CRITICAL(응급)

### 2. 의사 경과기록 (physician_note)
- **생성 주기**: 1일 1회 (오전 회진 후)
- **note_type**:
  - ADMISSION: HD 1 (입원일)에만 사용
  - PROGRESS: 그 외 일반 경과기록
  - DISCHARGE: 마지막 HD 퇴원요약

### 3. 영상검사 (radiology)
- **CXR 촬영 여부는 시나리오 이벤트 기반으로 판단**:
  - 시나리오의 "필수 이벤트" 또는 "문서별 가이드"에 CXR/Imaging 언급 시에만 생성
  - 호흡기 질환(폐렴, ARDS 등): 입원 시 baseline + 상태 변화 시
  - 비호흡기 질환(요로감염, 연조직염 등): 시나리오에 명시된 경우에만
- **결과 보고**: 촬영 당일 판독 완료
- **비교 판독**: 이전 영상과 비교 시 "increased/decreased" 표현

### 4. 배양검사 (microbiology)
- **채취 시점**: 발열, 감염 의심 시
- **결과 보고 소요시간**:
  - Gram stain (예비): 채취 후 1일
  - 배양 동정 (최종): 채취 후 2-3일
- **결과 상태**: COLLECTED → PRELIMINARY → FINAL

### 5. Lab 결과 (lab_result)
- **일반 검사**: 매일 아침 06:00 채혈, 당일 결과
- **응급 검사 (STAT)**: 필요 시 즉시 (예: Lactate)
- **Lactate 검사**: 패혈증 의심 시 시행, 상승 시 재검

## 문서 생성 판단 기준
LLM은 아래 기준으로 해당 날짜에 어떤 문서가 필요한지 판단합니다:
1. **간호기록**: 매일 3회 (필수)
2. **의사기록**: 매일 1회 (필수)
3. **Lab**: 매일 1회 (필수) + 임상 필요 시 추가
4. **CXR**: 시나리오 이벤트에 명시된 경우에만 (질환/상황에 따라 다름)
5. **배양 결과**: 채취일 기준 +2~3일 후 (자동 계산)
"""

# =============================================================================
# Nursing Note 상세 가이드 (v1 스타일 통합)
# =============================================================================
NURSING_DETAILED_GUIDE = """
## 간호기록 상세 가이드

### Note Type별 Structure Rules

#### 1) ADMISSION Note
- 헤더: [Admission Note]
- 필수 항목: Imp), C.C), PHx)
- 형식:
    [Admission Note]

    - Admitted at Ward via [경로] by [수단].
    - V/S: BP - HR - RR - Temp - SpO2
    - Imp) [진단명]
    - C.C) [주호소]
    - PHx) HTN(+/-)/DM(+/-)/Tbc(+/-)/Hepatitis(+/-)
    - [관찰 소견]
    - [수행한 처치]
        - Education 시행함: [교육 내용]

#### 2) PROGRESS Note (SOAP)
- 헤더: < Shift Title > (예: < Night Duty Report >)
- 형식:
    < Night Duty Report >
    s) "환자 직접 인용"
    [관찰된 양상]

    o)
    1. V/S: BP - HR - RR - Temp - SpO2 (on Room air / O2 NL)
    2. [신체 검진 소견]
    3. [검사 결과]

    a) [간호 진단]

    p)
    - [수행한 처치 1]
    - [수행한 처치 2]
    - Dr. XXX notify함 → "order 내용" order 받음.

#### 3) CRITICAL Note (응급/악화)
- 헤더: < Emergency Report >
- 시간 명시 필수: [HH:MM]
- 형식:
    < Emergency Report >
    [23:30] [트리거 상황]

    s) [환자 상태/반응]

    o)
    1. V/S: BP(▼) - HR(▲) - RR - Temp - SpO2 (▼▲ 표시)
    2. Mental: [의식 상태 변화]
    3. Physical: [신체 징후]

    a) [간호 진단 - 응급]

    p)
    - [응급 처치 1]
    - [응급 처치 2]
    - Dr. XXX notify함 ([상황 요약]) → "[응급 order]" order 받음.
    - [보호자 설명/전원 준비 등]

### Few-Shot Examples

#### Example 1: ADMISSION Note
{
  "document_type": "nursing_note",
  "note_type": "ADMISSION",
  "shift": "Day",
  "note_datetime": "2024-06-10T09:30:00",
  "hd": 1,
  "d_number": 0,
  "vital_signs": {
    "temp": 37.8,
    "hr": 92,
    "rr": 20,
    "bp_sys": 130,
    "bp_dia": 78,
    "spo2": 94
  },
  "subjective": null,
  "objective": "V/S: 130/78 - 92 - 20 - 37.8 - 94%\\nPt. cough c/o 있음, yellowish sputum 관찰됨. Lung sound: Rt. lower에 crackle 청취됨.",
  "assessment": null,
  "plan_action": "O2 2L/min via Nasal cannula apply함. SpO2 f/u check 예정.\\nEducation 시행함: 낙상 예방/호흡기 예절/call bell 사용/검사 및 tx plan 설명함.",
  "o2_device": "Nasal Cannula",
  "o2_flow": "2L/min",
  "intake": null,
  "output": null,
  "notify_md": false
}

#### Example 2: PROGRESS Note (SOAP) - 악화 징후
{
  "document_type": "nursing_note",
  "note_type": "PROGRESS",
  "shift": "Night",
  "note_datetime": "2024-06-12T01:30:00",
  "hd": 3,
  "d_number": 2,
  "vital_signs": {
    "temp": 38.2,
    "hr": 98,
    "rr": 24,
    "bp_sys": 125,
    "bp_dia": 75,
    "spo2": 91
  },
  "subjective": "\\"가슴이 답답하고 숨 쉬기가 힘들어요\\"\\nanxious appearance 관찰됨.",
  "objective": "1. V/S: 125/75 - 98 - 24 - 38.2 - 91% (on O2 2L NC)\\n2. Lung sound: Both lower에 coarse crackle 청취됨.\\n3. Accessory muscle 사용 관찰됨.",
  "assessment": "Ineffective airway clearance r/t excessive secretions.\\nImpaired gas exchange r/t V/Q mismatch.",
  "plan_action": "- O2 4L/min으로 up-titration → SpO2 94% check.\\n- Semi-Fowler position 유지함.\\n- Dr. Park notify함 (SpO2 drop & dyspnea) → \\"O2 4L 유지, CXR f/u, keep monitoring\\" order 받음.",
  "o2_device": "Nasal Cannula",
  "o2_flow": "4L/min",
  "intake": 1200,
  "output": 850,
  "notify_md": true
}

#### Example 3: CRITICAL Note - Sepsis 의심
{
  "document_type": "nursing_note",
  "note_type": "CRITICAL",
  "shift": "Night",
  "note_datetime": "2024-06-14T23:30:00",
  "hd": 5,
  "d_number": 4,
  "vital_signs": {
    "temp": 39.2,
    "hr": 118,
    "rr": 28,
    "bp_sys": 85,
    "bp_dia": 50,
    "spo2": 88
  },
  "subjective": "환자 의식 저하로 verbal response 감소함.",
  "objective": "1. V/S: 85/50(▼) - 118(▲) - 28 - 39.2 - 88% (on O2 4L NC)\\n2. Mental: Drowsy, GCS 13 (E3V4M6)\\n3. Physical: Cold & clammy extremities(+), Diaphoresis(+) 관찰됨.\\n4. Lung sound: Both field에 coarse crackle 청취됨.",
  "assessment": "Septic shock r/t aggravated pneumonia 의심.\\nRisk for decreased cardiac output.",
  "plan_action": "- O2 10L/min via Mask apply → SpO2 92% check.\\n- N/S 500cc IV bolus 시행함.\\n- Lactate, Blood culture x2 채취함.\\n- Dr. Kim notify함 (Sepsis 의심, hypotension) → \\"ICU 전원 고려, Norepinephrine 준비\\" order 받음.\\n- 보호자에게 상태 악화 설명함.",
  "o2_device": "Simple Mask",
  "o2_flow": "10L/min",
  "intake": 1500,
  "output": 400,
  "notify_md": true
}
"""

# =============================================================================
# Radiology 상세 가이드 (v1 스타일 통합)
# =============================================================================
RADIOLOGY_DETAILED_GUIDE = """
## 영상 판독문 상세 가이드

### Structure Rules
1. 모든 판독문은 **[Findings] → [Impression]** 2단 구조
2. Findings 서술 순서:
   - 1순위: 병변 부위 (예: "RLL에 consolidation")
   - 2순위: 반대측 폐 (예: "Left lung은 clear")
   - 3순위: 심장 크기 (예: "Heart size는 normal")
   - 4순위: 흉막/횡격막 (예: "CPA는 sharp")
   - 5순위: 뼈/기타 (예: "Bony thorax 특이소견 없음")
3. **Negative Findings 필수 1개 이상 포함**

### Severity Guide
| Severity | 표현 | 설명 |
|----------|------|------|
| NORMAL | no active lesion | 정상 |
| MILD | faint, suspicious, minimal | 경증/초기 |
| MODERATE | ill-defined, patch, moderate | 중등도 |
| SEVERE | dense, large, air-bronchogram | 중증 |
| CRITICAL | ARDS, white-out, massive | 위중 |

### Negative Case Guide (정상 소견)
- Findings: "Both lung fields are clear. No active lung lesion. Heart size normal. CPA sharp."
- Impression: "No active lung lesion."
- severity: "NORMAL"

### Few-Shot Examples

#### Example 1: Baseline CXR (입원 시)
{
  "document_type": "radiology",
  "subject_id": "17650289",
  "study_type": "CXR",
  "study_datetime": "2024-06-10T10:00:00",
  "day": 0,
  "technique": "Portable AP chest radiograph",
  "comparison": "None",
  "findings": "Right lower lung zone에 ill-defined patchy opacity가 관찰됩니다. Left lung field는 clear하며 focal lesion 보이지 않습니다. Heart size는 normal range입니다. Both CPA는 sharp합니다. Bony thorax에 특이 소견 없습니다.",
  "impression": "Right lower lobe pneumonia, suspected.",
  "severity": "MODERATE"
}

#### Example 2: Worsening CXR (악화)
{
  "document_type": "radiology",
  "subject_id": "17650289",
  "study_type": "CXR",
  "study_datetime": "2024-06-12T11:00:00",
  "day": 2,
  "technique": "Portable AP chest radiograph",
  "comparison": "CXR 2024-06-10",
  "findings": "이전 검사와 비교 시 RLL consolidation이 increased 되었습니다. 새로이 RML에도 patchy opacity가 관찰됩니다. Heart size는 normal입니다. Right CPA는 약간 blunting 되어 scanty pleural effusion 가능성 있습니다.",
  "impression": "1. Increased RLL pneumonia with extension to RML.\\n2. Possible small right pleural effusion.",
  "severity": "SEVERE"
}

#### Example 3: Improved CXR (호전)
{
  "document_type": "radiology",
  "subject_id": "17650289",
  "study_type": "CXR",
  "study_datetime": "2024-06-17T10:00:00",
  "day": 7,
  "technique": "Portable AP chest radiograph",
  "comparison": "CXR 2024-06-12",
  "findings": "이전 검사와 비교 시 RLL 및 RML의 patchy opacity가 decreased 되었습니다. Residual minimal opacity 관찰되나 significant improvement 소견입니다. Heart size normal. CPA sharp.",
  "impression": "Improving pneumonia in right lung.",
  "severity": "MILD"
}
"""


# =============================================================================
# Microbiology 상세 가이드 (v1 스타일 통합, MRSA/CRE만)
# =============================================================================
MICROBIOLOGY_DETAILED_GUIDE = """
## 배양검사 상세 가이드

### MDRO Definition Rules (필수 준수)
| MDRO Type | Organism | Key Resistance Marker |
|-----------|----------|----------------------|
| **MRSA** | Staphylococcus aureus | Oxacillin = R |
| **CRE** | E. coli, Klebsiella, Enterobacter 등 | Carbapenem (Imipenem/Meropenem/Ertapenem) = R |

### Report Structure
[Report ID: XX-YYYYMMDD-NNN]
Test: [검사명]
Specimen: [검체 종류]
Result Date: [결과 일시]

1. Gram Stain:
    - [그람 염색 소견]
2. Identification:
    - Organism: [균 이름]
    - Growth: [배양 정도]
3. Antimicrobial Susceptibility Test (MIC):
| Antibiotics | MIC (μg/mL) | Interpretation |
| :--- | :--- | :--- |
| ... | ... | R/S/I |

[Comments]
** [ALERT 메시지] **
- [격리/조치 지침]

### 검체별 일반균 목록
- **SPUTUM**: Streptococcus pneumoniae, Haemophilus influenzae, Klebsiella pneumoniae, Staphylococcus aureus
- **URINE**: Escherichia coli, Klebsiella pneumoniae, Proteus mirabilis, Enterococcus faecalis
- **BLOOD**: Staphylococcus aureus, Escherichia coli, Klebsiella pneumoniae, Streptococcus pneumoniae
- **STOOL**: Salmonella enterica, Campylobacter jejuni, Clostridium difficile

### Few-Shot Examples

#### Example 1: MRSA (Sputum)
{
  "document_type": "microbiology",
  "subject_id": "17650289",
  "specimen_type": "SPUTUM",
  "collection_datetime": "2024-06-10T07:00:00",
  "result_datetime": "2024-06-13T14:00:00",
  "hd": 4,
  "d_number": 3,
  "result_status": "FINAL",
  "gram_stain": "Many Gram positive cocci in clusters (GPC). Many WBCs seen.",
  "organism": "Staphylococcus aureus",
  "colony_count": "Heavy growth (+++)",
  "susceptibility": [
    {"antibiotic": "Penicillin G", "mic": ">=0.5", "interpretation": "R"},
    {"antibiotic": "Oxacillin", "mic": ">=4", "interpretation": "R"},
    {"antibiotic": "Gentamicin", "mic": "<=0.5", "interpretation": "S"},
    {"antibiotic": "Erythromycin", "mic": ">=8", "interpretation": "R"},
    {"antibiotic": "Clindamycin", "mic": ">=4", "interpretation": "R"},
    {"antibiotic": "Vancomycin", "mic": "2", "interpretation": "S"},
    {"antibiotic": "Linezolid", "mic": "2", "interpretation": "S"},
    {"antibiotic": "Rifampin", "mic": "<=0.5", "interpretation": "S"}
  ],
  "is_mdro": true,
  "mdro_type": "MRSA",
  "comments": "** MRSA (Methicillin-Resistant Staphylococcus aureus) DETECTED **\\n* Oxacillin Resistant.\\n* Contact Precautions Required (접촉 격리 요망).\\n* Vancomycin or Linezolid recommended."
}

#### Example 2: CRE (Rectal Swab - Surveillance)
{
  "document_type": "microbiology",
  "subject_id": "17650289",
  "specimen_type": "RECTAL_SWAB",
  "collection_datetime": "2024-06-10T10:00:00",
  "result_datetime": "2024-06-13T09:00:00",
  "hd": 4,
  "d_number": 3,
  "result_status": "FINAL",
  "gram_stain": "Gram negative rods observed.",
  "organism": "Klebsiella pneumoniae",
  "colony_count": "Heavy growth",
  "susceptibility": [
    {"antibiotic": "Ampicillin", "mic": ">=32", "interpretation": "R"},
    {"antibiotic": "Cefazolin", "mic": ">=64", "interpretation": "R"},
    {"antibiotic": "Ceftriaxone", "mic": ">=64", "interpretation": "R"},
    {"antibiotic": "Ertapenem", "mic": ">=8", "interpretation": "R"},
    {"antibiotic": "Imipenem", "mic": ">=16", "interpretation": "R"},
    {"antibiotic": "Meropenem", "mic": ">=16", "interpretation": "R"},
    {"antibiotic": "Amikacin", "mic": "<=2", "interpretation": "S"},
    {"antibiotic": "Tigecycline", "mic": "<=0.5", "interpretation": "S"},
    {"antibiotic": "Colistin", "mic": "<=0.5", "interpretation": "S"}
  ],
  "is_mdro": true,
  "mdro_type": "CRE",
  "comments": "** CRE (Carbapenem-Resistant Enterobacteriaceae) POSITIVE **\\n* Carbapenemase-producing strain suspected.\\n* 즉시 1인실 격리 또는 코호트 격리 필요.\\n* 감염관리실 통보 필수."
}

#### Example 3: Non-MDRO (일반균 - Colonization)
{
  "document_type": "microbiology",
  "subject_id": "17650289",
  "specimen_type": "SPUTUM",
  "collection_datetime": "2024-06-10T07:00:00",
  "result_datetime": "2024-06-13T14:00:00",
  "hd": 4,
  "d_number": 3,
  "result_status": "FINAL",
  "gram_stain": "Many PMNs, few epithelial cells. Yeast cells observed.",
  "organism": "Yeast",
  "colony_count": "Moderate growth",
  "susceptibility": [],
  "is_mdro": false,
  "mdro_type": null,
  "comments": "Yeast isolated - likely colonization. No bacterial pathogen isolated.\\nStandard Precautions Recommended."
}

#### Example 4: PENDING Result (배양 진행 중)
{
  "document_type": "microbiology",
  "subject_id": "17650289",
  "specimen_type": "BLOOD",
  "collection_datetime": "2024-06-10T23:45:00",
  "result_datetime": null,
  "hd": 1,
  "d_number": 0,
  "result_status": "PENDING",
  "gram_stain": null,
  "organism": null,
  "colony_count": null,
  "susceptibility": [],
  "is_mdro": false,
  "mdro_type": null,
  "comments": "검체 접수 완료. 배양 진행 중.\\n최종 결과 보고까지 48~72시간 소요 예정.\\n임상 증상에 따른 경험적 치료 요망."
}
"""

# =============================================================================
# JSON 출력 형식 지시
# =============================================================================
JSON_OUTPUT_INSTRUCTION = """
## JSON 출력 형식

각 문서 타입별 JSON 스키마:

### 1. 간호기록 (nursing_note)
""" + get_nursing_note_schema() + """

### 2. 의사 경과기록 (physician_note)
""" + get_physician_note_schema() + """

### 3. CXR 판독문 (radiology)
""" + get_radiology_schema() + """

### 4. Lab 결과 (lab_result)
""" + get_lab_schema() + """

### 5. 배양 검사 (microbiology)
""" + get_microbiology_schema() + """

### CXR Severity 기준
""" + SEVERITY_GUIDE + """
"""


# =============================================================================
# 시나리오 컨텍스트 빌더
# =============================================================================
def build_scenario_context(scenario_data: dict, timeline_summary: dict = None) -> str:
    """환자 시나리오를 프롬프트용 텍스트로 변환

    Args:
        scenario_data: 시나리오 md에서 파싱한 데이터
        timeline_summary: 타임라인 JSON에서 추출한 요약 데이터 (선택)

    Returns:
        프롬프트용 컨텍스트 문자열
    """
    profile = scenario_data.get('profile', {})
    trajectory = scenario_data.get('trajectory', {})
    events = scenario_data.get('events_by_hd', {})
    narrative = scenario_data.get('narrative', '')
    period = scenario_data.get('generation_period', {})

    start_hd = period.get('start_hd', 1)
    end_hd = period.get('end_hd', 10)
    d0_hd = period.get('d0_hd', 1)
    total_days = period.get('total_days', end_hd - start_hd + 1)

    context = f"""
## 환자 정보
- **Subject ID**: {profile.get('subject_id', 'Unknown')}
- **나이/성별**: {profile.get('age', '')}세 {profile.get('gender', '')}
- **입원 사유**: {profile.get('admission_reason', '')}
- **기저질환**: {', '.join(profile.get('comorbidities', []))}
- **신기능 특이사항**: {profile.get('renal_note', '')}

## 합성데이터 생성 범위
- **생성 기간**: HD {start_hd} ~ HD {end_hd} (총 {total_days}일)
- **D0 기준**: HD {d0_hd} (핵심 임상 이벤트 발생일)
- **D-number 범위**: D{start_hd - d0_hd:+d} ~ D{end_hd - d0_hd:+d}

## 핵심 임상 서사
{narrative}

## Trajectory 데이터 (시나리오 기반)

### 산소 요구량 경과
{_format_o2_trajectory(trajectory.get('o2', []))}

### 항생제 경과
{_format_abx_trajectory(trajectory.get('antibiotics', []))}

### Lab 경과 (예상 추이)
{_format_lab_trajectory(trajectory.get('labs', {}))}

### 배양 결과
{_format_culture_trajectory(trajectory.get('cultures', []))}

## HD별 핵심 이벤트 (시나리오 정의)
{_format_daily_events(events)}
"""

    # 타임라인 데이터가 있으면 추가
    if timeline_summary:
        context += f"""

## 실제 타임라인 데이터 (참고용)
{_format_timeline_summary(timeline_summary)}
"""

    return context.strip()

def _format_o2_trajectory(o2_data: list) -> str:
    if not o2_data:
        return "- 시나리오에 따라 LLM이 판단"
    lines = [f"- HD{item.get('hd', item.get('day', 0)+1)}: {item['value']}" for item in o2_data]
    return '\n'.join(lines)


def _format_abx_trajectory(abx_data: list) -> str:
    if not abx_data:
        return "- 시나리오에 따라 LLM이 판단"
    lines = [f"- HD{item.get('hd', item.get('day', 0)+1)}: {item['action']} - {item['drug']}" for item in abx_data]
    return '\n'.join(lines)


def _format_lab_trajectory(lab_data: dict) -> str:
    if not lab_data:
        return "- 시나리오에 따라 LLM이 판단 (WBC, Cr, Lactate 등)"
    lines = []
    for lab_name, values in lab_data.items():
        value_str = ' → '.join([f"HD{v.get('hd', v.get('day', 0)+1)} {v['value']}" for v in values])
        lines.append(f"- {lab_name}: {value_str}")
    return '\n'.join(lines)


def _format_culture_trajectory(culture_data: list) -> str:
    if not culture_data:
        return "- 채취 후 2-3일 뒤 결과 보고"
    lines = [f"- {item['type']}: {item['result']}" for item in culture_data]
    return '\n'.join(lines)


def _format_daily_events(events: dict) -> str:
    """events_by_hd 형식 지원"""
    if not events:
        return "- 시나리오 md 파일 참조"
    lines = []
    for hd, event_data in sorted(events.items()):
        if isinstance(event_data, dict):
            # events_by_hd 형식
            label = event_data.get('label', '')
            req_events = event_data.get('required_events', [])
            event_str = label if label else ', '.join(req_events[:3])
        elif isinstance(event_data, list):
            event_str = ', '.join(event_data[:3])
        else:
            event_str = str(event_data)
        lines.append(f"- HD{hd}: {event_str}")
    return '\n'.join(lines)


def _format_timeline_summary(timeline_summary: dict) -> str:
    """타임라인 요약 포맷팅"""
    lines = []

    # 활성 약물
    active_meds = timeline_summary.get('active_medications', [])
    if active_meds:
        med_names = [m.get('name') or '' for m in active_meds[:5]]
        med_names = [n for n in med_names if n]
        if med_names:
            lines.append(f"- 현재 약물: {', '.join(med_names)}")

    # 최신 Lab
    latest_labs = timeline_summary.get('latest_labs', {})
    if latest_labs:
        lab_strs = []
        for k, v in list(latest_labs.items())[:5]:
            val = v.get('value') if isinstance(v, dict) else v
            if val is not None:
                lab_strs.append(f"{k}: {val}")
        if lab_strs:
            lines.append(f"- 최근 Lab: {', '.join(lab_strs)}")

    # Pending 배양
    pending_cultures = timeline_summary.get('pending_cultures', [])
    if pending_cultures:
        lines.append(f"- Pending 배양: {len(pending_cultures)}건")

    # 배양 결과
    culture_results = timeline_summary.get('culture_results', [])
    if culture_results:
        lines.append(f"- 배양 결과 도착: {len(culture_results)}건")

    return '\n'.join(lines) if lines else "- 데이터 없음"


# =============================================================================
# 일별 생성 프롬프트 빌더
# =============================================================================
def build_daily_generation_prompt(
    hd: int,
    d_number: int,
    period: dict,
    subject_id: str,
    admit_date: str,
    day_summary: dict = None,
    previous_summary: str = None,
    hd_event: dict = None
) -> str:
    """특정 날짜의 EMR 생성 요청 프롬프트

    Args:
        hd: Hospital Day (1-based)
        d_number: D-number (음수 가능)
        period: 생성 기간 정보 (start_hd, end_hd, d0_hd)
        subject_id: 환자 ID
        admit_date: 입원일 (YYYY-MM-DD)
        day_summary: 해당 날짜의 타임라인 요약 (timeline_loader에서)
        previous_summary: 이전 기록 요약 (일관성 유지용)
        hd_event: 해당 HD의 이벤트 정보 (시나리오에서)

    Returns:
        생성 요청 프롬프트 문자열
    """
    from datetime import datetime, timedelta

    # 현재 날짜 계산 (HD 1 = 입원일)
    base_date = datetime.strptime(admit_date, "%Y-%m-%d")
    current_date = (base_date + timedelta(days=hd - 1)).strftime("%Y-%m-%d")

    # D-number 표시 형식
    d_display = f"D{d_number:+d}" if d_number != 0 else "D0"

    # 문서 타입 결정
    start_hd = period.get('start_hd', 1)
    end_hd = period.get('end_hd', 10)
    
    if hd == 1:
        note_type = "ADMISSION"
    elif hd >= end_hd:
        note_type = "DISCHARGE"
    else:
        note_type = "PROGRESS"

    prompt = f"""
## HD {hd} / {d_display} ({current_date}) 기록 생성 요청

**환자 ID**: {subject_id}
**Hospital Day {hd}** (HD {start_hd} ~ HD {end_hd} 중)
"""
    
    # 시나리오 내 위치 설명
    if d_number < 0:
        phase_desc = f"D0 이전 ({abs(d_number)}일 전) - Baseline/전구 증상 단계"
    elif d_number == 0:
        phase_desc = "D0 - 핵심 임상 이벤트 발생일"
    elif hd >= end_hd:
        phase_desc = "시나리오 종료 단계 - 퇴원/안정화"
    else:
        phase_desc = f"D0 이후 {d_number}일 - 치료 반응/경과 관찰 단계"

    prompt += f"""**시나리오 단계**: {phase_desc}
"""

    # HD 이벤트 정보 추가
    if hd_event:
        event_label = hd_event.get('label', '')
        required_events = hd_event.get('required_events', [])
        doc_guides = hd_event.get('doc_guides', {})
        
        if event_label:
            prompt += f"""**오늘의 이벤트**: {event_label}
"""
        if required_events:
            prompt += f"""**필수 이벤트**:
"""
            for evt in required_events:
                prompt += f"- {evt}\n"
        
        if doc_guides:
            prompt += f"""**문서별 가이드**:
"""
            for doc_type, guide in doc_guides.items():
                prompt += f"- {doc_type}: {guide}\n"

    # 이전 기록 요약 (일관성 유지용)
    if previous_summary:
        prompt += f"""
### 이전 기록 요약 (일관성 유지용)
{previous_summary}
"""

    # 현재 상태 (타임라인 데이터)
    if day_summary:
        prompt += f"""
### 현재 상태 (타임라인 데이터 기반)
"""
        # 활성 약물
        active_meds = day_summary.get('active_medications', [])
        if active_meds:
            prompt += "**현재 사용 중 약물**:\n"
            for med in active_meds[:10]:
                prompt += f"- {med.get('name', '')} ({med.get('route', '')})\n"

        # Pending 배양
        pending_cultures = day_summary.get('pending_cultures', [])
        if pending_cultures:
            prompt += "\n**Pending 배양검사**:\n"
            for culture in pending_cultures:
                prompt += f"- {culture.get('name', 'Culture')}: {culture.get('status', 'PENDING')}\n"

        # 결과 도착 배양
        culture_results = day_summary.get('culture_results', [])
        if culture_results:
            prompt += "\n**오늘 결과 도착 배양**:\n"
            for culture in culture_results:
                prompt += f"- {culture.get('name', 'Culture')}: FINAL 결과 보고\n"

    # 생성할 문서 목록
    prompt += f"""
### 생성할 문서 목록 (JSON 배열로 출력)

1. **간호기록** (nursing_note) - 3회
   - Day Shift (09:30) - 헤더: < Day Duty Report >
   - Evening Shift (17:30) - 헤더: < Evening Duty Report >
   - Night Shift (익일 01:30) - 헤더: < Night Duty Report >
   - HD 1(입원일)만 ADMISSION note 형식 사용 (생성 범위에 포함된 경우)

2. **의사 경과기록** (physician_note) - 1회
   - note_type: {note_type}

3. **Lab 결과** (lab_result) - 1회
   - 매일 아침 채혈 기준
"""

    # CXR 필요 여부 판단 안내
    prompt += """
4. **CXR 판독문** (radiology) - 시나리오에 명시된 경우에만
   - 해당 HD의 "필수 이벤트" 또는 "문서별 가이드"에 CXR/Imaging 언급 시 생성
   - 호흡기 질환: 입원 시 baseline + 상태 변화 시
   - 비호흡기 질환: 시나리오에 명시된 경우에만 (무조건 생성 금지)

5. **배양 검사** (microbiology) - 결과 도착 시
   - 채취 후 2-3일 경과한 검사
   - 위 "오늘 결과 도착 배양" 참조
"""

    # 출력 형식
    prompt += f"""
### 출력 형식
아래 형식으로 JSON 배열을 출력하세요:
```json
[
  {{ "document_type": "nursing_note", "shift": "Day", "hd": {hd}, "d_number": {d_number}, ... }},
  {{ "document_type": "nursing_note", "shift": "Evening", "hd": {hd}, "d_number": {d_number}, ... }},
  {{ "document_type": "nursing_note", "shift": "Night", "hd": {hd}, "d_number": {d_number}, ... }},
  {{ "document_type": "physician_note", "hd": {hd}, "d_number": {d_number}, ... }},
  {{ "document_type": "lab_result", "hd": {hd}, "d_number": {d_number}, ... }},
  {{ "document_type": "radiology", "hd": {hd}, "d_number": {d_number}, ... }},  // 필요 시
  {{ "document_type": "microbiology", "hd": {hd}, "d_number": {d_number}, ... }}  // 결과 도착 시
]
```

**중요**: JSON만 출력하세요. 다른 설명이나 마크다운 없이 순수 JSON 배열만 출력합니다.
**항생제 주의**: 현재 사용 중 약물 목록을 확인하고 정확한 약물명을 사용하세요.
**간호기록 헤더**: note_type에 맞는 헤더를 raw_text에 사용하세요.
**환자 인용**: subjective에 환자의 직접 발언을 큰따옴표로 인용하세요. 예: "숨이 차요"

### ⚠️ 날짜 규칙 (필수 준수)
- **모든 datetime 필드는 반드시 {current_date}를 기준으로 작성하세요.**
- few-shot 예시의 날짜는 무시하고, 실제 환자의 입원일({admit_date}) 기준으로 계산하세요.
- 배양 검사(microbiology):
  - `collection_datetime`: 해당 날짜에 채취한 경우에만 생성
  - `result_datetime`: 채취일 + 2~3일 (FINAL 결과)
"""

    return prompt.strip()


# =============================================================================
# 이전 기록 요약 생성
# =============================================================================
def build_previous_summary(previous_records: list) -> str:
    """이전 기록들의 요약 생성 (일관성 유지용)

    Args:
        previous_records: 이전에 생성된 기록 리스트

    Returns:
        요약 문자열
    """
    if not previous_records:
        return ""

    summary_lines = []

    for record in previous_records[-3:]:  # 최근 3일
        hd = record.get('hd', '?')
        d_number = record.get('d_number', 0)
        d_display = f"D{d_number:+d}" if d_number != 0 else "D0"
        content = record.get('content', '')

        # JSON에서 주요 정보 추출 시도
        try:
            import json
            docs = json.loads(content) if isinstance(content, str) else content
            if isinstance(docs, list):
                for doc in docs:
                    doc_type = doc.get('document_type', '')

                    if doc_type == 'lab_result':
                        wbc = doc.get('wbc', '')
                        cr = doc.get('cr', '')
                        lactate = doc.get('lactate', '')
                        summary_lines.append(f"HD{hd}/{d_display} Lab: WBC {wbc}, Cr {cr}" + (f", Lactate {lactate}" if lactate else ""))

                    elif doc_type == 'physician_note':
                        plan = doc.get('plan', [])
                        # plan이 list인 경우 처리
                        if isinstance(plan, list):
                            plan_str = '; '.join(plan)[:100]
                        else:
                            plan_str = str(plan)[:100]
                        summary_lines.append(f"HD{hd}/{d_display} 의사기록: {plan_str}...")

        except (json.JSONDecodeError, TypeError):
            pass

    return '\n'.join(summary_lines) if summary_lines else ""


# =============================================================================
# 전체 프롬프트 조합
# =============================================================================
def build_full_prompt(
    scenario_data: dict,
    hd: int,
    d_number: int,
    admit_date: str,
    day_summary: dict = None,
    previous_records: list = None
) -> str:
    """전체 프롬프트 조합

    Args:
        scenario_data: 시나리오 md에서 파싱한 데이터
        hd: Hospital Day (1-based)
        d_number: D-number (음수 가능, D0 기준 상대값)
        admit_date: 입원일
        day_summary: 해당 날짜의 타임라인 요약
        previous_records: 이전 생성 기록 (일관성 유지용)

    Returns:
        최종 프롬프트 문자열
    """
    subject_id = scenario_data.get('profile', {}).get('subject_id', 'Unknown')
    period = scenario_data.get('generation_period', {})

    # 시나리오 컨텍스트
    scenario_context = build_scenario_context(scenario_data, day_summary)

    # 이전 기록 요약
    previous_summary = build_previous_summary(previous_records) if previous_records else None

    # 해당 HD의 이벤트 정보 (events_by_hd에서)
    events_by_hd = scenario_data.get('events_by_hd', {})
    hd_event = events_by_hd.get(hd, {})

    # 일별 생성 프롬프트
    daily_prompt = build_daily_generation_prompt(
        hd=hd,
        d_number=d_number,
        period=period,
        subject_id=subject_id,
        admit_date=admit_date,
        day_summary=day_summary,
        previous_summary=previous_summary,
        hd_event=hd_event
    )

    # 전체 조합
    full_prompt = f"""
{scenario_context}

{DOCUMENT_GENERATION_RULES}

{NURSING_DETAILED_GUIDE}

{RADIOLOGY_DETAILED_GUIDE}

{MICROBIOLOGY_DETAILED_GUIDE}

{JSON_OUTPUT_INSTRUCTION}

---

{daily_prompt}
"""
    return full_prompt.strip()