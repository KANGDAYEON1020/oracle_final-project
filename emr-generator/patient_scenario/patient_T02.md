# T02 - SFTS 의심 혼동 (FUO → 확진 전까지 혼란)

## 1. 환자 프로필

- Subject id : T02_Patient (Synthetic)

### 0) 환자 프로필

- **68세 여성**
- **Admitting Dx**: **Fever of Unknown Origin (FUO)**
- **Discharge Dx**: **SFTS**
- 기저질환: **None specific**
- 입원 사유: **Persistent Fever, Myalgia**

### 1) 핵심 서사 (Narrative Arc)

- **1단계: 단순 감염 의심 (Day 1)**
    - **Trigger**: 발열, 근육통으로 내원. 호흡기 증상이나 복부 증상 뚜렷하지 않음.
    - **System Act**: UTI(요로감염) 등 흔한 감염원 먼저 Rule-out 시도.
- **2단계: 배제 진단 과정 (Day 2)**
    - **Trigger**: 소변검사(UA) 정상. CXR 정상. 열은 지속됨.
    - **System Act**: **"Not Pneumonia, Not UTI"** Pattern. 원인 불명(FUO) 워크업 진행.
- **3단계: 단서 포착 (Day 3-4)**
    - **Trigger**: 입원 3일차 **WBC/Platelet 동반 감소** 확인 (Trend).
    - **System Act**: **"일반 감염(폐렴/UTI) 추이와 다름"** 감지 -> **SFTS PCR 의뢰**.

## 2. “타임라인별” 상세 시나리오 (D0 = 7월 20일)

### HD 1 (Admission & FUO Workup / D0) — 7월 20일
**필수 이벤트**
- **Trigger**: 38.5℃ 발열, 심한 몸살 기운.
- **Vital**: Stable except Fever.
- **Action**: Blood Culture x 2, Urine Culture, CXR. Start Cephalosporin (Empiric).
- **Explain 핵심**: "뚜렷한 Focal infection source가 보이지 않음."

**문서별 가이드**
- 의사 기록: `Fever lacking localizing signs. R/O APN vs Occult infection. Start empirical antibiotics.`

---

### HD 2 (Rule-out Phase / D1) — 7월 21일
**필수 이벤트**
- **Lab**: Urinalysis Normal (WBC 0-1). CXR Clear.
- **Status**: Fever spiked to 39.5℃ despite antibiotics.
- **Explain 핵심**: **"항생제 반응 없음 + 흔한 감염원 배제됨."** -> 의료진의 혼란.

**문서별 가이드**
- 간호기록: `Pt complains of headache and muscle pain. Urine clear. Fever persistent.`
- 의사 기록: `UA negative. No respiratory symptoms. Fever uncontrolled. Consider other viral or tick-borne etiologies?`

---

### HD 3 (The Turning Point / D2) — 7월 22일
**필수 이벤트**
- **Trigger**: Routine Lab f/u.
    - **Leukopenia** (WBC 2800).
    - **Thrombocytopenia** (Plt 85k -> 140k에서 감소).
- **Action**: **SFTS PCR Order**.
- **Alert**:
    - **Message**: **"Lab trend atypical for bacterial infection. Platelet/WBC drop observed. Consider SFTS."**

**문서별 가이드**
- 의사 기록: `Cytopenia appearing. Review Hx again. "Hiking 10 days ago". Suspicion for SFTS high. Send viral panel.`

---

### HD 4 (Confirmation Pending / D3) — 7월 23일
**필수 이벤트**
- **Status**: PCR 결과 대기 중.
- **Action**: Contact Isolation (Pre-emptive). Stop Antibiotics?

## 3. 프롬프트 생성용 핵심 변수 세트
- **Patient**: 68 / F
- **Trend**: Fever -> UTI Rule-out -> **Cytopenia appeared late**.
- **Message**: "일반 감염 알림과 다른 결(Cytopenia Alert)" 시연.
