# INFECT-GUARD (LOOK)

감염내과 전문의가 없는 지방 2차 병원을 위한 **감염 감시 및 임상 궤적 시스템**

## 개요

INFECT-GUARD는 의료 문서 분석과 임상 의사결정 지원을 통해 감염 관리의 지역 간 격차를 해소하기 위한 시스템입니다. 4개 서비스(Frontend, Backend, ML API, RAG)로 구성된 마이크로서비스 아키텍처를 기반으로 합니다.

---

## 아키텍처

```
                  ┌─────────────────┐
                  │   Frontend      │
                  │  (Next.js 16)   │
                  │   :3000         │
                  └───────┬─────────┘
                          │ /api/* (rewrite proxy)
                  ┌───────▼─────────┐
                  │    Backend      │
                  │  (Express 5)    │
                  │   :5002         │
                  └──┬──────────┬───┘
                     │          │
           ┌─────────▼──┐  ┌───▼──────────┐
           │  ML API     │  │  RAG Service  │
           │  (Flask)    │  │  (Flask)      │
           │  :8002      │  │  :8001        │
           └─────────────┘  └───────────────┘
                  │                  │
            XGBoost Model    ChromaDB / Supabase
                                + OpenAI
```

---

## 프로젝트 구조

```
final-prj/
├── frontend/                     # Next.js 16 + React 19 프론트엔드
│   ├── app/                      # App Router 페이지
│   │   ├── page.tsx              # 메인 대시보드 (Watch / 감염병 현황 / 문서 초안작성)
│   │   ├── patients/             # 환자 목록 및 상세
│   │   ├── bed-allocation/       # 병상 배정 관리
│   │   ├── isolation-checklist/  # 격리 체크리스트
│   │   ├── transfer-checklist/   # 전원 체크리스트
│   │   ├── guideline-search/     # 가이드라인 검색 (RAG)
│   │   └── api/                  # Next.js API Routes (proxy)
│   ├── components/               # UI 컴포넌트 (~146개)
│   │   ├── clinical/             # 핵심 임상 컴포넌트
│   │   ├── dashboard/            # 대시보드 레이아웃
│   │   ├── bed-allocation/       # 병상 배정
│   │   ├── auto-draft/           # AI 문서 초안 생성
│   │   ├── explain/              # 임상 궤적 설명
│   │   ├── patient/              # 환자 뷰
│   │   ├── infection-status/     # 감염 현황
│   │   ├── reports/              # 리포트
│   │   └── ui/                   # shadcn/ui 기반 공통 UI
│   └── styles/                   # Tailwind CSS 4
│
├── backend/                      # Express 5 + OracleDB 백엔드
│   ├── app.js                    # 앱 진입점
│   ├── db.js                     # Oracle DB 연결 관리
│   ├── routes/                   # API 라우트
│   ├── services/                 # 비즈니스 로직
│   ├── helpers/                  # 유틸리티
│   └── middleware/               # 미들웨어 (데모 시계 등)
│
├── ml/                           # ML Sepsis 파이프라인
│   ├── api/                      # Flask API (추론 서비스)
│   ├── src/                      # 학습/검증 소스
│   ├── notebooks/                # 학습 노트북
│   ├── models/                   # 학습된 모델
│   └── data/                     # 학습 데이터
│
├── nlp/                          # NLP 문서 처리 파이프라인
│   ├── run_pipeline.py           # 파이프라인 실행기
│   ├── scripts/                  # 파이프라인 단계별 스크립트
│   ├── models/                   # NER 모델
│   └── data/                     # NLP 입출력 데이터
│
├── rag/                          # RAG 가이드라인 검색 서비스
│   ├── service/                  # Flask API 서비스
│   ├── chunks/                   # 문서 청크
│   ├── docs_raw/                 # 원본 가이드라인 문서
│   └── parsed/                   # 파싱 결과
│
├── emr-generator/                # LLM 기반 합성 EMR 생성기
│   ├── main.py                   # CLI 진입점
│   ├── generator.py              # EMR 생성 로직
│   ├── patient_scenario/         # 환자 시나리오 (*.md)
│   └── outputs/                  # 생성 결과
│
├── data/                         # 데이터 추출 및 적재
│   └── scripts/                  # 데이터 파이프라인 스크립트
│
├── deployment/                   # Docker Compose 배포
│   ├── docker-compose.yml        # 4-서비스 스택 정의
│   ├── *.Dockerfile              # 서비스별 Dockerfile
│   └── oracle/                   # Oracle Instant Client
│
├── .env.example                  # 환경변수 템플릿
└── requirements.txt              # Python 공통 의존성
```

---

## 모듈별 상세

### 1. Frontend (Next.js 16)

React 19 + Tailwind CSS 4 + shadcn/ui 기반 임상 대시보드입니다.

#### 주요 페이지

| 경로                     | 기능                                                |
| ------------------------ | --------------------------------------------------- |
| `/`                      | 메인 대시보드 (Watch / 감염병 현황 / 문서 초안작성) |
| `/patients`              | 환자 목록 (필터링, 페이지네이션)                    |
| `/patients/[id]`         | 환자 상세 정보                                      |
| `/patients/[id]/explain` | 임상 궤적 타임라인 (Explain)                        |
| `/bed-allocation`        | 병상 배정 관리                                      |
| `/isolation-checklist`   | 격리 체크리스트 (MDRO, GI, 호흡기)                  |
| `/transfer-checklist`    | 전원 체크리스트 (안정성, 자원, 교통 평가)           |
| `/guideline-search`      | RAG 기반 가이드라인 검색                            |

#### 실행

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

### 2. Backend (Express 5 + OracleDB)

Oracle DB를 통한 임상 데이터 CRUD 및 외부 서비스 연동 API입니다.

#### API 엔드포인트

| Method   | Endpoint                      | 설명                                     |
| -------- | ----------------------------- | ---------------------------------------- |
| GET      | `/api/patients`               | 환자 목록 (진단 스냅샷 포함)             |
| GET      | `/api/patients/:id`           | 환자 상세 정보                           |
| GET      | `/api/patients/:id/explain/*` | 임상 궤적 (축 스냅샷, 궤적 이벤트)       |
| GET      | `/api/rooms`                  | 병실/병상 배정 현황                      |
| GET      | `/api/transfer-cases`         | 전원 케이스 목록                         |
| POST     | `/api/transfer-checklist`     | 전원 체크리스트 관리                     |
| GET/POST | `/api/alerts`                 | 알림 CRUD (ACTIVE/ACKNOWLEDGED/RESOLVED) |
| POST     | `/api/draft/generate`         | AI 문서 초안 생성 (OpenAI)               |
| GET      | `/api/guideline-search`       | RAG 서비스 프록시                        |
| GET/POST | `/api/nlp/mdro/checklists`    | 격리 체크리스트 관리                     |
| GET/POST | `/api/plans`                  | 병상 배정 계획 (생성/커밋/롤백)          |

#### 실행

```bash
cd backend
npm install
npm run dev          # http://localhost:5002
```

### 3. ML API (Flask - Sepsis 위험도 추론)

XGBoost 기반 패혈증 위험도 실시간 추론 서비스입니다.

| Endpoint                | 설명                                          |
| ----------------------- | --------------------------------------------- |
| `GET /health`           | 모델 준비 상태 확인                           |
| `POST /v1/sepsis/infer` | 패혈증 위험도 추론 (LOW/MEDIUM/HIGH/CRITICAL) |

#### 위험도 기준

| 레벨     | 점수 범위   |
| -------- | ----------- |
| LOW      | < 0.30      |
| MEDIUM   | 0.30 ~ 0.60 |
| HIGH     | 0.60 ~ 0.85 |
| CRITICAL | >= 0.85     |

### 4. NLP 파이프라인

의료 문서에서 임상 정보를 추출하는 오프라인 파이프라인입니다.

#### 실행 순서

```bash
python nlp/run_pipeline.py --patient patient_19548143
```

1. `01_document_parser.py` - 의료 문서 파싱
2. `02_rule_extractor.py` - 규칙 기반 정보 추출
3. `03_ner_train.py` - NER 모델 학습
4. `04_ner_extractor.py` - 개체명 인식 (NER)
5. `05_normalizer.py` - 추출 데이터 정규화
6. `06a_axis_snapshot_generator.py` - 축 스냅샷 생성
7. `06b_trajectory_event_generator.py` - 궤적 이벤트 생성

### 5. RAG 서비스 (Flask - 가이드라인 검색)

감염 관련 가이드라인 문서를 벡터 검색하고 LLM으로 답변을 생성합니다.

| Endpoint          | 설명                         |
| ----------------- | ---------------------------- |
| `GET /health`     | 서비스 상태 확인             |
| `POST /rag/query` | 가이드라인 검색 및 응답 생성 |

- Embedding: `paraphrase-multilingual-MiniLM-L12-v2`
- Vector DB: ChromaDB / Supabase pgvector
- LLM: GPT-4 mini

### 6. EMR 생성기 (emr-generator/)

시나리오 기반 합성 EMR을 LLM으로 생성합니다.

```bash
cd emr-generator
pip install -r requirements.txt
export OPENAI_API_KEY="your-api-key"
python main.py patient_scenario/patient_17650289.md
```

#### 생성되는 문서 타입

| 문서 타입        | 설명          | 생성 주기                     |
| ---------------- | ------------- | ----------------------------- |
| `nursing_note`   | 간호기록      | 8시간마다 (Day/Evening/Night) |
| `physician_note` | 의사 경과기록 | 매일                          |
| `radiology`      | CXR 판독문    | 입원 시 + 상태 변화 시        |
| `lab_result`     | 검사 결과     | 매일 아침 + 필요 시           |
| `microbiology`   | 배양 검사     | 채취 후 2~3일                 |

### 7. 데이터 파이프라인 (data/scripts/)

MIMIC-IV 데이터 추출부터 Oracle DB 적재까지의 전체 파이프라인입니다.

| 단계 | 스크립트                                | 설명                                   |
| ---- | --------------------------------------- | -------------------------------------- |
| 0    | `00_table_creation.sql`                 | Oracle 테이블/인덱스 생성 (50+ 테이블) |
| 1    | `01_cohort_v4.ipynb`                    | 폐렴 코호트 선정                       |
| 2    | `02_cohort_records_extraction_v4.ipynb` | 임상 기록 추출                         |
| 3    | `03_patient_timeline_extraction.py`     | 타임라인 JSON 생성                     |
| 4    | `04_load_master.py`                     | 마스터 데이터 적재                     |
| 5    | `05_load_documents.py`                  | 문서 데이터 적재                       |
| 6    | `06_load_axis_snapshots.py`             | 축 스냅샷 적재                         |
| 6    | `06_load_trajectory_events.py`          | 궤적 이벤트 적재                       |
| 7    | `07_load_prescriptions.py`              | 처방 데이터 적재                       |
| 8    | `08_load_synthetic_extensions.py`       | 합성 확장 데이터 적재 (데모용)         |
| 9    | `09_load_nlp_slots.py`                  | NLP 슬롯 데이터 적재                   |
| 9    | `09_backfill_ml_sepsis_scores.py`       | ML Sepsis 점수 적재                    |

---

## 환자 시나리오 목록

| Patient ID | 코드 | 시나리오                                       |
| ---------- | ---- | ---------------------------------------------- |
| 11601773   | G02  | 집단 설사 발병 (Ward Cluster Alert)            |
| 12249103   | P04  | 폐렴 - 수술 후 흡인성 폐렴, CXR Bilateral 증가 |
| 12356657   | M01  | 다제내성균 폐렴 (MRSA Superinfection)          |
| 16836931   | U01  | 요로감염 (UTI, Lactate 상승 직전 조기 개입)    |
| 17650289   | P01  | 폐렴 (CAP, O2 2L->4L, 항생제 변경 후 호전)     |
| 18003081   | G01  | 감염성 장염 (설사/복통, 선제적 격리 검토)      |
| 18294629   | M03  | CRE 수술 후 감염 (Suspected -> Confirmed)      |
| 19096027   | G01  | 병원획득 장염 (Antibiotic-Associated, C. diff) |
| 19440935   | M01  | 다제내성균 폐렴 (MRSA Superinfection)          |
| 19548143   | P05  | 폐렴 (HAP, 배양 결과 지연, 항생제 변경)        |
| T01        | T01  | 전형적 SFTS (혈소판 급감, 고열 지속)           |
| T02        | T02  | SFTS 의심 혼동 (FUO, 확진 전 혼란)             |
| T03        | T03  | SFTS 고령 중증 (Sepsis 유사, ICU 고려)         |

### 시나리오 카테고리

- **P**: Pneumonia (폐렴)
- **M**: MDRO (다제내성균)
- **G**: GI Infection (장관감염)
- **U**: UTI (요로감염)
- **T**: SFTS (중증열성혈소판감소증후군)

---

## 환경 설정

`.env.example`을 복사하여 `.env` 파일을 생성합니다.

```bash
cp .env.example .env
```

### 주요 환경변수

| 변수                                                           | 설명                                        |
| -------------------------------------------------------------- | ------------------------------------------- |
| `ORACLE_USER` / `ORACLE_PASSWORD` / `ORACLE_CONNECTION_STRING` | Oracle DB 접속 정보                         |
| `EXPRESS_PORT`                                                 | Backend 포트 (기본 5002)                    |
| `OPEN_AI_API`                                                  | OpenAI API 키 (문서 초안 생성용)            |
| `RAG_OPENAI_API_KEY`                                           | OpenAI API 키 (RAG 서비스용)                |
| `RAG_API_BASE`                                                 | RAG 서비스 URL (기본 http://localhost:8001) |
| `SUPABASE_VEC_URL` / `SUPABASE_VEC_KEY`                        | Supabase 벡터 DB (RAG용)                    |
| `NEXT_PUBLIC_API_URL`                                          | 프론트엔드 API 경로 (기본 /api)             |

---

## 의존성

### Node.js (Frontend/Backend)

- Next.js 16, React 19, Tailwind CSS 4, shadcn/ui
- Express 5, oracledb 6, openai

### Python (ML/NLP/RAG)

- Flask, pandas, numpy, scikit-learn
- XGBoost (ML), transformers, sentence-transformers (NLP/RAG)
- chromadb, openai, supabase (RAG)

---

## Docker 배포

```bash
cd deployment
cp .env.docker.example .env.docker
# .env.docker에 Oracle/Supabase/OpenAI 접속 정보 입력

docker compose build
docker compose up -d
docker compose ps
```

### 헬스 체크

```bash
curl http://localhost:3000          # Frontend
curl http://localhost:5002/health   # Backend
curl http://localhost:8002/health   # ML API
curl http://localhost:8001/health   # RAG Service
```

자세한 배포 가이드는 [deployment/README.md](deployment/README.md) 참조.
