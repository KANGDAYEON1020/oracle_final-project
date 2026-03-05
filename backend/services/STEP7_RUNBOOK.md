# Step 7 Manual Runbook (Alert Fusion Engine)

## 1) Scope
- This runbook is for manual operation of `backend/services/alert_engine.py`.
- Real-time streaming/scheduler is out of scope.

## 2) Execution Modes
- `Operational write (default, rate-limit ON)`
  - `python backend/services/alert_engine.py`
- `Dry-run (no DB mutation)`
  - `python backend/services/alert_engine.py --dry-run`
- `Backfill write (rate-limit OFF, same-HD dedup ON)`
  - `python backend/services/alert_engine.py --disable-rate-limit`
- `Backfill dry-run`
  - `python backend/services/alert_engine.py --dry-run --disable-rate-limit`

## 3) When to Run
- After reloading `trajectory_events`.
- After changing `alert_rules.yaml`.
- When re-generating a baseline.

## 4) Pre-Run Checks (SQL)
```sql
SELECT COUNT(*) AS trajectory_events_cnt FROM trajectory_events;

SELECT COUNT(*) AS alerts_total_cnt FROM alerts;

SELECT COUNT(*) AS sx_alert_cnt
FROM alerts
WHERE message LIKE '[SX]%' OR trigger_json LIKE '%SX_EXT%';
```

## 5) Post-Run Checks (SQL)
```sql
SELECT severity, alert_type, COUNT(*) AS cnt
FROM alerts
WHERE message IN (
  'MDRO 확진 환자에게 격리 미적용',
  '배양 채취 - 결과 대기 중',
  '감염 지표 변화 감지',
  '운영 조치 필요 이벤트',
  'Sepsis 조기위험: 게이트 충족',
  'Sepsis 위험 상승(게이트 미충족)',
  '의미 있는 변화 없음(직전 슬롯 대비 안정)'
)
GROUP BY severity, alert_type
ORDER BY severity, alert_type;
```

```sql
SELECT COUNT(*) AS engine_alert_cnt
FROM alerts
WHERE message IN (
  'MDRO 확진 환자에게 격리 미적용',
  '배양 채취 - 결과 대기 중',
  '감염 지표 변화 감지',
  '운영 조치 필요 이벤트',
  'Sepsis 조기위험: 게이트 충족',
  'Sepsis 위험 상승(게이트 미충족)',
  '의미 있는 변화 없음(직전 슬롯 대비 안정)'
);
```

```sql
SELECT COUNT(*) AS sx_alert_cnt
FROM alerts
WHERE message LIKE '[SX]%' OR trigger_json LIKE '%SX_EXT%';
```

## 6) API Verification
```bash
curl -sS "$API/alerts?status=ACTIVE&limit=200" | jq '.meta'
curl -sS "$API/alerts?status=ACTIVE&limit=5" | jq '.data[] | {alertId,patientId,alertType,severityNormalized,message}'
```

## 7) Repeat-Run Stability Check
- Run the same command once more.
- Expected: significantly fewer new rows due to dedup (or zero).

## 8) Rollback (Engine-only messages)
```sql
DELETE FROM alerts
WHERE message IN (
  'MDRO 확진 환자에게 격리 미적용',
  '배양 채취 - 결과 대기 중',
  '감염 지표 변화 감지',
  '운영 조치 필요 이벤트',
  'Sepsis 조기위험: 게이트 충족',
  'Sepsis 위험 상승(게이트 미충족)',
  '의미 있는 변화 없음(직전 슬롯 대비 안정)'
);
COMMIT;
```

## 9) Operational Notes
- `--disable-rate-limit` is for backfill/rebuild only.
- Normal operation should keep rate-limit ON.
- `same_hd` dedup remains active in all modes.
- write 모드에서는 ISOLATION 알림 자동 해소(RESOLVED) 패스가 함께 실행됩니다.
