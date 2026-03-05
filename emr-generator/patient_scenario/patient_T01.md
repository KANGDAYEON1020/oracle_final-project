# T01 - 전형적 SFTS (혈소판 급감, 고열 지속)

## 1. 환자 프로필

- Subject id : T01_Patient (Synthetic)

### 0) 환자 프로필

- **74세 남성**
- **Severe Fever with Thrombocytopenia Syndrome (SFTS)** / **Admission Date: 2181-06-15**
- 기저질환: **HTN, Mild Diabetes** (well-controlled)
- 입원 사유: **High Fever, Generalized Weakness, Diarrhea**
- **합성데이터 생성 기간**: HD 1 ~ HD 4 (총 4일)

### 1) 핵심 서사 (Narrative Arc)

- **1단계: 초기 증상 (Day 1-2)**
    - **Trigger**: 야외 활동(밭일) 후 발생한 고열, 설사, 무기력.
    - **System Act**: 초기 감염성 장염 또는 불명열 의심. 수액 및 해열제 투여.
- **2단계: 혈소판 급감 및 의심 (Day 3)**
    - **Trigger**: **Platelet 급격한 감소 (130k -> 60k)**, WBC 감소 동반. CRP는 증상 대비 낮음.
    - **System Act**: **"SFTS 등 진드기 매개 감염 의심 - PCR 검사 권고"** (Pattern Recognition).
- **3단계: 악화 및 대응 (Day 4)**
    - **Trigger**: 의식 저하 소견(Drowsy), Notify 증가.
    - **System Act**: 중증 SFTS 진행 가능성 경고. ICU 전실 고려.

## 2. “타임라인별” 상세 시나리오 (D0 = 6월 15일)

### HD 1 (Admission & Initial Care / D0) — 6월 15일
**필수 이벤트**
- **Trigger**: 고열(39.2℃), 설사(3-4회/일), 근육통.
- **Vital**: BP 130/80, HR 98, BT 39.2℃.
- **Lab**: WBC 3.8 (Low normal), Plt 135k (Mild low), AST/ALT 45/50 (Mild elevated). CRP 1.2 (Not high).
- **History**: "1주일 전 밭에서 작업함." (Insect bite mark not clearly seen).
- **Action**: Hydration, Antipyretics, Conservative care.

**문서별 가이드**
- 간호기록: `15:00 Pt admitted w/ high fever & diarrhea. Complains of severe myalgia/fatigue. No resp symptoms.`
- 의사 기록: `Fever/Diarrhea/Myalgia. R/O viral syndrome vs early sepsis. Start hydration. Check stool culture.`

---

### HD 2 (Symptom Persistence / D1) — 6월 16일
**필수 이벤트**
- **Status**: 고열 지속(Spiking to 40℃). 설사 지속.
- **CXR**: Clear. No pneumonia evidence.
- **Lab**: WBC 3.2 (Decreasing), Plt 105k (Decreasing).
- **Action**: 항생제(Ceftriaxone) 경험적 투여 고려하나 CRP 낮아 보류 혹은 유지.

**문서별 가이드**
- 간호기록: `10:00 Fever spiked to 40.1. Tepid massage applied. Pt looks exhausted.`
- 의사 기록: `Persistent high fever. CRP low (1.5). WBC/Plt trending down. Viral infection likely? Monitor labs.`

---

### HD 3 (Platelet Crash & Awareness / D2) — 6월 17일
**필수 이벤트**
- **Trigger (Critical)**: **Platelet 58k** (Overnight drop). WBC 2.1.
- **Symptoms**: 의식 명료하나 처짐. Petechiae(점상출혈) 관찰 안됨.
- **Explain 핵심**: "발열 지속, 항생제 반응 없음, **혈소판/백혈구 동반 감소** Pattern."
- **Action**: **SFTS PCR Order**.
- **Alert**:
    - **Logic**: **Fever + Plt < 100k + Leukopenia**.
    - **Message**: **"High Suspicion of SFTS/Tick-borne disease. Recommend SFTS PCR & careful fluid management."**

**문서별 가이드**
- 간호기록: `08:00 Lab returned. Critical value Plt 58k reported to Dr. No active bleeding signs.`
- 의사 기록: `Leukopenia & Thrombocytopenia worsening. Hx of outdoor activity. Strongly suspect SFTS. Order SFTS PCR. Check mental status closely.`

---

### HD 4 (Neurological Signs / D3) — 6월 18일
**필수 이벤트**
- **Status**: Fever continued. **Mental status change** (Alert -> Drowsy).
- **Lab**: Plt 45k. AST/ALT 120/110 (Increasing). LDH High.
- **Action**: ICU consultation needed?
- **Explain 핵심**: SFTS의 중증 진행 (MODS, Encephalopathy risk).

**문서별 가이드**
- 간호기록: `14:00 Pt difficult to arouse. Response only to pain. Notify Dr.`
- 의사 기록: `Mental change noted. SFTS progression suspected. Prepare for ICU transfer if BP drops or bleeding occurs.`

## 3. 프롬프트 생성용 핵심 변수 세트

1. **Patient Demographics**
   - `Age/Sex`: 74 / M
   - `Dx`: **SFTS** (Suspected -> Clinical Dx)
   - `HospitalDay`: HD 1 ~ 4

2. **Trajectory Data**
   - **Dates**: June 15 - June 18
   - **Key trend**: Fever maintained, **Plt/WBC Drop**, CRP Low, **Mental Drop**.

3. **Scenario Focus**
   - **"{Tick-borne Pattern}"**: 폐렴이나 요로감염이 아닌, **혈소판 감소와 백혈구 감소**가 특징적인 패턴을 시연.
