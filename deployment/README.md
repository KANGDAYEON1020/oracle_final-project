# Deployment (Docker Compose)

이 폴더는 데모 운영용 4-서비스 스택(`frontend`, `backend`, `ml-api`, `rag`) 실행을 위한 파일입니다.

## 1) 사전 준비

1. `deployment/.env.docker.example`를 복사해 `deployment/.env.docker` 생성
2. `deployment/oracle/instantclient_23_3/`에 **Linux용 Oracle Instant Client 23.3** 압축 해제본 배치
3. Docker/Compose 설치 확인

## 2) 실행

```bash
cd deployment
cp .env.docker.example .env.docker

docker compose build
docker compose up -d
docker compose ps
```

## 3) 헬스 체크

```bash
curl http://localhost:3000
curl http://localhost:5002/health
curl http://localhost:8002/health
curl http://localhost:8001/health
```

## 4) Demo Reset 동작 확인

```bash
curl -s -X POST "http://localhost:5002/api/alerts/demo-reset?demoStep=1&demoShift=Day" | jq
```

응답의 `snapshotRestore.enabled=true`, `skipped=false`이면 backend 컨테이너에서
`08_load_synthetic_extensions.py` 실행까지 정상입니다.

## 5) 중요한 주의사항

- `backend/db.js`는 `/opt/oracle/instantclient_23_3`를 사용합니다.
- Instant Client 아키텍처는 컨테이너 아키텍처와 일치해야 합니다.
  - 예: 서버가 `x86_64`면 x86_64 라이브러리 필요
- RAG 기본 backend는 `supabase`이므로 `.env.docker`에
  `SUPABASE_VEC_URL`, `SUPABASE_VEC_KEY`가 없으면 guideline query가 실패할 수 있습니다.
- 필요 시 로그 확인:

```bash
docker compose logs -f backend
docker compose logs -f ml-api
docker compose logs -f rag
docker compose logs -f frontend
```
