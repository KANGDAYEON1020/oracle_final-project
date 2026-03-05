# T03 - SFTS 고령 중증 (Sepsis 유사, ICU 고려)

## 1. 환자 프로필

- Subject id : T03_Patient (Synthetic)

### 0) 환자 프로필

- **82세 남성**
- **Dx**: **Severe SFTS with MODS**
- 기저질환: **Dementia, CKD**
- 입원 사유: **Altered Mental Status, Fever, Diarrhea**

### 1) 핵심 서사 (Narrative Arc)

- **1단계: 패혈증 의심 (Day 1)**
    - **Trigger**: 고열, 설사, 그리고 **의식 저하**로 응급실 내원.
    - **System Act**: **Sepsis Bundle** 가동 (Fluid, Culture, Antibiotics).
- **2단계: 쇼크 및 장기부전 진행 (Day 3)**
    - **Trigger**: BP 저하(Hypotension), Platelet < 50k.
    - **System Act**: **"패혈증성 쇼크 vs SFTS 중증"**. 전형적인 Bacterial Sepsis와 유사하나 **CRP가 낮고 혈소판 감소가 극심함**이 차이점.
- **3단계: 중환자실 고려 (Day 4-5)**
    - **Act 포인트**: 시스템이 **" 전원 필요성"**을 질문. (High Mortality Risk).

## 2. “타임라인별” 상세 시나리오 (D0 = 8월 10일)

### HD 1 (Sepsis Workup / D0)
**필수 이벤트**
- **Vital**: BP 90/60, HR 110, BT 38.8.
- **Action**: Quick Sepsis management.
- **Lab**: Cr 1.8 (CKD base), Plt 80k (Already low).

### HD 3 (Severe Progression / D2)
**필수 이벤트**
- **Lab**: **Plt < 50k (42k)**. AST/ALT > 200. aPTT prolongation.
- **Status**: Bleeding tendency (Oral mucosa).
- **Explain 핵심**: **Sepsis precursor 모델과 겹치지만** 원인균 미확인 상태에서 혈액학적 수치 붕괴.

### HD 4-5 (Critical Care Decision / D3-D4)
**필수 이벤트**
- **Status**: Mental Stupor. SpO2 unstable.
- **Alert**:
    - **Message**: **"Critical Thrombocytopenia & MODS sign. Mortality risk High. Evaluate for ICU transfer."**

## 3. 프롬프트 생성용 핵심 변수 세트
- **Patient**: 82 / M / Dementia
- **Key**: **Sepsis-like presentation** but **Tick-borne etiology**.
- **Outcome**:  transfer consideration.
