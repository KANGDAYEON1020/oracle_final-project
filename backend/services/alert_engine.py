#!/usr/bin/env python3
"""
Alert Fusion Engine

Input:
  - trajectory_events (DB)

Output:
  - alerts (DB INSERT)

Default mode is WRITE (persist INSERT). Use --dry-run for simulation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, TYPE_CHECKING
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if TYPE_CHECKING:  # pragma: no cover
    import oracledb

try:
    from dotenv import load_dotenv  # type: ignore
except Exception:  # pragma: no cover
    load_dotenv = None


DEFAULT_ORACLE_CLIENT_LIB_DIR = "/opt/oracle/instantclient_23_3"
DEFAULT_RULES_PATH = Path(__file__).with_name("alert_rules.yaml")
DEFAULT_SEPSIS_FLASK_BASE_URL = "http://127.0.0.1:8002"
DEFAULT_SEPSIS_FLASK_TIMEOUT_MS = 3000
DEFAULT_SEPSIS_GATE_CRITICAL_THRESHOLD = 0.65
DEFAULT_SEPSIS_GATE_ACTION_THRESHOLD = 0.45

SHIFT_ORDER: dict[str, int] = {"DAY": 1, "EVENING": 2, "NIGHT": 3}
SHIFT_ORDER_TO_HOUR: dict[int, int] = {1: 8, 2: 16, 3: 23}

HIGH_RISK_EVENT_TYPES = {
    "mdro_confirmed",
    "isolation_gap",
    "isolation_gap_current",
    "temp_spike",
    "wbc_rise",
    "crp_rise",
    "o2_start_or_increase",
    "abx_escalate_or_change",
    "platelet_drop",
}

ESCALATION_EVENT_TYPES = {
    "abx_escalate_or_change",
    "o2_start_or_increase",
    "prn_increase",
}


@dataclass
class EngineCandidate:
    admission_id: int | None
    patient_id: str
    alert_type: str
    severity: str
    message: str
    trigger_json: str
    evidence_snippet: str
    recommended_cta_json: str
    hd: int | None
    d_number: int | None
    primary_datetime: datetime | None


def _maybe_load_env() -> None:
    if load_dotenv:
        load_dotenv()


def _init_oracle_client() -> None:
    import oracledb

    lib_dir = os.getenv("ORACLE_CLIENT_LIB_DIR", DEFAULT_ORACLE_CLIENT_LIB_DIR)
    try:
        oracledb.init_oracle_client(lib_dir=lib_dir)
    except Exception:
        # Already initialized or unavailable in thin mode path; continue.
        pass


def _read_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, "read"):
        try:
            return value.read()
        except Exception:
            return None
    return str(value)


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _truncate(value: str, max_len: int) -> str:
    if len(value) <= max_len:
        return value
    if max_len <= 1:
        return value[:max_len]
    return value[: max_len - 1] + "…"


def _event_sort_key(event: dict[str, Any]) -> tuple[datetime, int]:
    event_dt = event.get("event_datetime")
    if not isinstance(event_dt, datetime):
        event_dt = datetime.min

    raw_event_id = event.get("event_id")
    try:
        event_id = int(raw_event_id) if raw_event_id is not None else -1
    except Exception:
        event_id = -1

    return (event_dt, event_id)


def _parse_json_maybe(text: str | None) -> Any | None:
    if text is None:
        return None
    trimmed = text.strip()
    if not trimmed:
        return None
    try:
        return json.loads(trimmed)
    except Exception:
        return None


def _extract_hd_from_trigger(trigger_raw: str | None) -> int | None:
    parsed = _parse_json_maybe(trigger_raw)
    if not isinstance(parsed, dict):
        return None
    hd = parsed.get("hd")
    if isinstance(hd, int):
        return hd
    events = parsed.get("events")
    if isinstance(events, list):
        for event in events:
            if isinstance(event, dict) and isinstance(event.get("hd"), int):
                return event["hd"]
    return None


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = float(value)
        return v if v == v else None
    if value is None:
        return None
    matched = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not matched:
        return None
    try:
        return float(matched.group(0))
    except ValueError:
        return None


def _normalize_shift_token(raw: Any) -> str | None:
    token = str(raw or "").strip().upper()
    if token in ("DAY", "D"):
        return "Day"
    if token in ("EVENING", "EVE", "E"):
        return "Evening"
    if token in ("NIGHT", "N"):
        return "Night"
    return None


def _infer_shift_from_datetime(value: Any) -> str | None:
    if not isinstance(value, datetime):
        return None
    hour = value.hour
    if 6 <= hour <= 13:
        return "Day"
    if 14 <= hour <= 21:
        return "Evening"
    return "Night"


def _shift_order(raw: Any) -> int:
    token = _normalize_shift_token(raw)
    if not token:
        return 9
    return SHIFT_ORDER.get(token.upper(), 9)


def _safe_ratio_delta(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None:
        return None
    denom = max(abs(previous), 1e-6)
    return abs(current - previous) / denom


def _compute_map(sbp: float | None, dbp: float | None) -> float | None:
    if sbp is None or dbp is None:
        return None
    return (sbp + (2 * dbp)) / 3.0


def _compose_slot_key(admission_id: int, d_number: int, shift: str) -> tuple[int, int, str]:
    return (int(admission_id), int(d_number), shift)


def _is_sepsis_flask_enabled() -> bool:
    return str(os.getenv("SEPSIS_FLASK_ENABLED", "false")).strip().lower() != "false"


def _sepsis_flask_base_url() -> str:
    base = str(os.getenv("SEPSIS_FLASK_BASE_URL", DEFAULT_SEPSIS_FLASK_BASE_URL)).strip()
    return base.rstrip("/")


def _sepsis_flask_timeout_ms() -> int:
    raw = _to_float(os.getenv("SEPSIS_FLASK_TIMEOUT_MS", str(DEFAULT_SEPSIS_FLASK_TIMEOUT_MS)))
    timeout = int(raw) if raw is not None else DEFAULT_SEPSIS_FLASK_TIMEOUT_MS
    return max(500, timeout)


def _sepsis_gate_critical_threshold() -> float:
    raw = _to_float(
        os.getenv("SEPSIS_GATE_CRITICAL_THRESHOLD", str(DEFAULT_SEPSIS_GATE_CRITICAL_THRESHOLD))
    )
    return raw if raw is not None else DEFAULT_SEPSIS_GATE_CRITICAL_THRESHOLD


def _sepsis_gate_action_threshold() -> float:
    raw = _to_float(
        os.getenv("SEPSIS_GATE_ACTION_THRESHOLD", str(DEFAULT_SEPSIS_GATE_ACTION_THRESHOLD))
    )
    return raw if raw is not None else DEFAULT_SEPSIS_GATE_ACTION_THRESHOLD


def _ensure_rules_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("rules payload must be a dict")
    if "rules" not in raw or not isinstance(raw["rules"], list):
        raise ValueError("rules payload must include list key: rules")
    if "dedup" in raw and not isinstance(raw["dedup"], dict):
        raise ValueError("dedup must be a dict")
    return raw


def load_rules(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    # This file is JSON-compatible YAML by design.
    payload = json.loads(text)
    return _ensure_rules_payload(payload)


def normalize_severity(raw: Any) -> str:
    sev = str(raw or "").upper().strip()
    if sev in ("CRITICAL", "ACTION", "INFO"):
        return sev
    if sev in ("LOW", "MEDIUM", "HIGH"):
        return "ACTION"
    return "ACTION"


def parse_iso_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        # Accept both "2026-01-01T12:00:00" and "2026-01-01 12:00:00"
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def connect() -> "oracledb.Connection":
    try:
        import oracledb
    except Exception as exc:
        raise RuntimeError(
            "oracledb module is required. Run this script in the same Python env used for data loaders."
        ) from exc

    user = os.getenv("ORACLE_USER")
    password = os.getenv("ORACLE_PASSWORD")
    dsn = os.getenv("ORACLE_CONNECTION_STRING")
    if not user or not password or not dsn:
        raise RuntimeError("Missing ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECTION_STRING")
    return oracledb.connect(user=user, password=password, dsn=dsn)


def fetch_events(
    conn: "oracledb.Connection",
    from_datetime: datetime | None = None,
    patient_id: str | None = None,
) -> list[dict[str, Any]]:
    sql = """
        SELECT
            te.event_id,
            te.admission_id,
            a.patient_id,
            te.event_type,
            te.event_datetime,
            te.axis_type,
            te.priority_rank,
            te.render_text,
            te.evidence_text,
            te.severity,
            te.supporting_docs_json,
            te.hd,
            te.d_number,
            te.shift
        FROM trajectory_events te
        JOIN admissions a ON a.admission_id = te.admission_id
        WHERE (:from_dt IS NULL OR te.event_datetime >= :from_dt)
          AND (:patient_id IS NULL OR a.patient_id = :patient_id)
        ORDER BY a.patient_id, te.event_datetime, te.event_id
    """
    with conn.cursor() as cur:
        cur.execute(
            sql,
            {
                "from_dt": from_datetime,
                "patient_id": patient_id,
            },
        )
        rows = cur.fetchall()

    events: list[dict[str, Any]] = []
    for row in rows:
        supporting_docs_raw = _read_text(row[10])
        events.append(
            {
                "event_id": row[0],
                "admission_id": row[1],
                "patient_id": row[2],
                "event_type": row[3],
                "event_datetime": row[4],
                "axis_type": row[5],
                "priority_rank": row[6],
                "render_text": row[7],
                "evidence_text": row[8],
                "event_severity": row[9],
                "supporting_docs_json": supporting_docs_raw,
                "hd": row[11],
                "d_number": row[12],
                "shift": row[13],
            }
        )
    return events


def fetch_existing_alerts(
    conn: "oracledb.Connection", patient_ids: list[str]
) -> dict[str, list[dict[str, Any]]]:
    if not patient_ids:
        return {}

    unique_ids = sorted(set(patient_ids))
    bind_map = {f"p{i}": patient_id for i, patient_id in enumerate(unique_ids)}
    placeholders = ", ".join(f":p{i}" for i in range(len(unique_ids)))
    sql = f"""
        SELECT
            alert_id,
            patient_id,
            alert_type,
            severity,
            created_at,
            trigger_json
        FROM alerts
        WHERE patient_id IN ({placeholders})
          AND status <> 'RESOLVED'
        ORDER BY created_at DESC, alert_id DESC
    """

    with conn.cursor() as cur:
        cur.execute(sql, bind_map)
        rows = cur.fetchall()

    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        patient_id = row[1]
        trigger_raw = _read_text(row[5])
        out[str(patient_id)].append(
            {
                "alert_id": row[0],
                "patient_id": str(patient_id),
                "alert_type": str(row[2]),
                "severity": normalize_severity(row[3]),
                "created_at": row[4],
                "hd": _extract_hd_from_trigger(trigger_raw),
            }
        )
    return out


def _build_in_clause(values: list[Any], prefix: str) -> tuple[str, dict[str, Any]]:
    unique_values = list(dict.fromkeys(values))
    binds = {f"{prefix}{idx}": value for idx, value in enumerate(unique_values)}
    placeholders = ", ".join(f":{key}" for key in binds.keys())
    return placeholders, binds


def _normalize_lab_token(value: Any) -> str:
    return str(value or "").strip().upper().replace(" ", "").replace("_", "")


def _canonical_lab_code(item_code: Any, item_name: Any) -> str | None:
    token_code = _normalize_lab_token(item_code)
    token_name = _normalize_lab_token(item_name)
    tokens = [token_code, token_name]
    for token in tokens:
        if token in ("WBC", "WHITEBLOODCELL", "WHITEBLOODCELLS"):
            return "WBC"
        if token in ("CRP",):
            return "CRP"
        if token in ("LACTATE", "LAC"):
            return "LACTATE"
        if token in ("CREATININE", "CREA"):
            return "CREATININE"
        if token in ("PLATELETS", "PLT"):
            return "PLATELETS"
        if token in ("BILIRUBIN", "TBIL", "TOTALBILIRUBIN"):
            return "BILIRUBIN"
        if token in ("SODIUM", "NA"):
            return "SODIUM"
        if token in ("POTASSIUM", "K"):
            return "POTASSIUM"
        if token in ("PH",):
            return "PH"
    return None


def _build_trajectory_slots(
    events: list[dict[str, Any]],
) -> tuple[dict[tuple[int, int, str], dict[str, Any]], dict[int, list[tuple[int, int, str]]]]:
    slots: dict[tuple[int, int, str], dict[str, Any]] = {}
    by_admission: dict[int, list[tuple[int, int, str]]] = defaultdict(list)

    for event in events:
        admission_raw = event.get("admission_id")
        d_number_raw = event.get("d_number")
        if admission_raw is None or d_number_raw is None:
            continue
        admission_id = int(admission_raw)
        d_number = int(d_number_raw)
        shift = _normalize_shift_token(event.get("shift")) or _infer_shift_from_datetime(
            event.get("event_datetime")
        )
        if not shift:
            continue

        key = _compose_slot_key(admission_id, d_number, shift)
        slot = slots.setdefault(
            key,
            {
                "admission_id": admission_id,
                "patient_id": str(event.get("patient_id") or ""),
                "d_number": d_number,
                "shift": shift,
                "hd": None,
                "event_datetime": None,
                "events": [],
            },
        )
        slot["events"].append(event)

        hd_raw = event.get("hd")
        if isinstance(hd_raw, int):
            slot["hd"] = max(slot["hd"] or hd_raw, hd_raw)

        event_dt = event.get("event_datetime")
        if isinstance(event_dt, datetime):
            current = slot.get("event_datetime")
            if current is None or event_dt > current:
                slot["event_datetime"] = event_dt

    for key in slots:
        by_admission[key[0]].append(key)

    for admission_id in by_admission:
        by_admission[admission_id].sort(key=lambda item: (item[1], _shift_order(item[2])))

    return slots, by_admission


def _resolve_slot_key_for_confirmed_at(
    slot_keys: list[tuple[int, int, str]],
    slots: dict[tuple[int, int, str], dict[str, Any]],
    confirmed_at: datetime | None,
) -> tuple[int, int, str] | None:
    if not slot_keys:
        return None
    ordered = sorted(slot_keys, key=lambda item: (int(item[1]), _shift_order(item[2])))
    if not isinstance(confirmed_at, datetime):
        return ordered[-1]

    latest_not_after: tuple[int, int, str] | None = None
    earliest_after: tuple[int, int, str] | None = None

    for key in ordered:
        slot_dt = slots.get(key, {}).get("event_datetime")
        if not isinstance(slot_dt, datetime):
            continue
        if slot_dt <= confirmed_at:
            latest_not_after = key
        elif earliest_after is None:
            earliest_after = key

    return latest_not_after or earliest_after or ordered[-1]


def _fetch_admission_meta(
    conn: "oracledb.Connection", admission_ids: list[int]
) -> dict[int, dict[str, Any]]:
    if not admission_ids:
        return {}
    placeholders, binds = _build_in_clause(admission_ids, "a")
    sql = f"""
        SELECT a.admission_id, a.patient_id, p.age
        FROM admissions a
        JOIN patients p ON p.patient_id = a.patient_id
        WHERE a.admission_id IN ({placeholders})
    """
    with conn.cursor() as cur:
        cur.execute(sql, binds)
        rows = cur.fetchall()

    out: dict[int, dict[str, Any]] = {}
    for row in rows:
        out[int(row[0])] = {"patient_id": str(row[1]), "age": _to_float(row[2])}
    return out


def _fetch_isolation_live_state(
    conn: "oracledb.Connection",
    admission_ids: list[int],
) -> dict[int, dict[str, Any]]:
    if not admission_ids:
        return {}

    placeholders, binds = _build_in_clause(admission_ids, "ps")
    sql = f"""
        SELECT
            ps.admission_id,
            ps.patient_id,
            ps.isolation_required,
            ps.current_bed_id,
            b.patient_id AS bed_patient_id,
            b.room_id,
            bs.current_admission_id,
            bs.status AS bed_status,
            r.is_isolation,
            w.is_isolation_ward,
            w.ward_id,
            r.room_number
        FROM patient_status ps
        LEFT JOIN beds b
          ON b.bed_id = ps.current_bed_id
        LEFT JOIN bed_status bs
          ON bs.bed_id = b.bed_id
        LEFT JOIN rooms r
          ON r.room_id = b.room_id
        LEFT JOIN wards w
          ON w.ward_id = r.ward_id
        WHERE ps.admission_id IN ({placeholders})
    """
    with conn.cursor() as cur:
        cur.execute(sql, binds)
        rows = cur.fetchall()

    out: dict[int, dict[str, Any]] = {}
    for row in rows:
        admission_id = int(row[0])
        patient_id = str(row[1] or "")
        isolation_required = int(_to_float(row[2]) or 0)
        current_bed_id = row[3]
        bed_patient_id = str(row[4] or "")
        room_id = row[5]
        bed_status_admission = row[6]
        bed_status = str(row[7] or "").strip().upper()
        room_isolation = int(_to_float(row[8]) or 0)
        ward_isolation = int(_to_float(row[9]) or 0)
        ward_id = row[10]
        room_number = row[11]

        has_isolation_location = bool(room_isolation == 1 or ward_isolation == 1)
        has_valid_bed_status = bed_status in ("OCCUPIED", "RESERVED")
        matches_admission = (
            bed_status_admission is None
            or int(bed_status_admission) == int(admission_id)
        )
        matches_patient = (not bed_patient_id) or (bed_patient_id == patient_id)

        isolation_applied = bool(
            isolation_required == 1
            and current_bed_id
            and room_id
            and has_isolation_location
            and has_valid_bed_status
            and matches_admission
            and matches_patient
        )

        out[admission_id] = {
            "patient_id": patient_id,
            "isolation_required": isolation_required,
            "isolation_applied": isolation_applied,
            "current_bed_id": current_bed_id,
            "room_id": room_id,
            "room_number": room_number,
            "ward_id": ward_id,
            "bed_status": bed_status,
        }
    return out


def _pick_latest_confirmed_by_as_of(
    rows: list[tuple[Any, ...]],
    as_of_by_admission: dict[int, datetime],
    *,
    admission_idx: int,
    patient_idx: int,
    code_idx: int,
    name_idx: int,
    confirmed_at_idx: int,
    source_idx: int,
    confirmed_hd_idx: int | None = None,
    confirmed_d_number_idx: int | None = None,
    confirmed_shift_idx: int | None = None,
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for row in rows:
        admission_id = int(row[admission_idx])
        as_of = as_of_by_admission.get(admission_id)
        confirmed_at = row[confirmed_at_idx]
        if isinstance(as_of, datetime) and isinstance(confirmed_at, datetime) and confirmed_at > as_of:
            continue

        existing = out.get(admission_id)
        if existing:
            existing_dt = existing.get("confirmed_at")
            if isinstance(existing_dt, datetime) and isinstance(confirmed_at, datetime):
                if confirmed_at <= existing_dt:
                    continue
            elif isinstance(existing_dt, datetime) and confirmed_at is None:
                continue
            elif existing_dt is None and confirmed_at is None:
                continue

        out[admission_id] = {
            "patient_id": str(row[patient_idx] or ""),
            "diagnosis_code": str(row[code_idx] or "MDRO"),
            "diagnosis_name": str(row[name_idx] or "MDRO"),
            "status": "CONFIRMED",
            "confirmed_at": confirmed_at if isinstance(confirmed_at, datetime) else None,
            "source_type": str(row[source_idx] or "UNKNOWN"),
            "confirmed_hd": None,
            "confirmed_d_number": None,
            "confirmed_shift": None,
        }
        if confirmed_hd_idx is not None:
            confirmed_hd_raw = _to_float(row[confirmed_hd_idx])
            out[admission_id]["confirmed_hd"] = (
                int(confirmed_hd_raw) if confirmed_hd_raw is not None else None
            )
        if confirmed_d_number_idx is not None:
            confirmed_d_raw = _to_float(row[confirmed_d_number_idx])
            out[admission_id]["confirmed_d_number"] = (
                int(confirmed_d_raw) if confirmed_d_raw is not None else None
            )
        if confirmed_shift_idx is not None:
            out[admission_id]["confirmed_shift"] = _normalize_shift_token(row[confirmed_shift_idx])
    return out


def _fetch_confirmed_mdro_from_infection_diagnoses(
    conn: "oracledb.Connection",
    admission_ids: list[int],
    as_of_by_admission: dict[int, datetime],
) -> tuple[dict[int, dict[str, Any]], bool]:
    if not admission_ids:
        return {}, False

    placeholders, binds = _build_in_clause(admission_ids, "idg")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM user_tab_columns
            WHERE table_name = 'INFECTION_DIAGNOSES'
              AND column_name IN ('CONFIRMED_HD', 'CONFIRMED_D_NUMBER', 'CONFIRMED_SHIFT')
            """
        )
        has_slot_columns = int(cur.fetchone()[0] or 0) == 3

    select_slot_cols = """
            d.confirmed_hd,
            d.confirmed_d_number,
            d.confirmed_shift,
    """ if has_slot_columns else ""

    sql = f"""
        SELECT
            d.admission_id,
            d.patient_id,
            d.diagnosis_code,
            d.diagnosis_name,
            d.confirmed_at,
            d.source_type,
{select_slot_cols}
            d.diagnosis_id
        FROM infection_diagnoses d
        WHERE d.admission_id IN ({placeholders})
          AND UPPER(NVL(d.diagnosis_group, '')) = 'MDRO'
          AND UPPER(NVL(d.status, '')) = 'CONFIRMED'
        ORDER BY d.admission_id, d.confirmed_at DESC, d.diagnosis_id DESC
    """
    try:
        with conn.cursor() as cur:
            cur.execute(sql, binds)
            rows = cur.fetchall()
    except Exception as exc:
        if "ORA-00942" in str(exc):
            return {}, False
        raise

    if not rows:
        return {}, True

    slot_hd_idx = 6 if has_slot_columns else None
    slot_d_idx = 7 if has_slot_columns else None
    slot_shift_idx = 8 if has_slot_columns else None
    picked = _pick_latest_confirmed_by_as_of(
        rows,
        as_of_by_admission,
        admission_idx=0,
        patient_idx=1,
        code_idx=2,
        name_idx=3,
        confirmed_at_idx=4,
        source_idx=5,
        confirmed_hd_idx=slot_hd_idx,
        confirmed_d_number_idx=slot_d_idx,
        confirmed_shift_idx=slot_shift_idx,
    )
    return picked, True


def _fetch_confirmed_mdro_from_microbiology(
    conn: "oracledb.Connection",
    admission_ids: list[int],
    as_of_by_admission: dict[int, datetime],
) -> dict[int, dict[str, Any]]:
    if not admission_ids:
        return {}

    placeholders, binds = _build_in_clause(admission_ids, "m")
    sql = f"""
        SELECT
            m.admission_id,
            a.patient_id,
            UPPER(NVL(m.mdro_type, 'MDRO')) AS mdro_type,
            NVL(m.result_datetime, m.collection_datetime) AS confirmed_at,
            m.hd AS confirmed_hd,
            m.d_number AS confirmed_d_number,
            CASE
              WHEN NVL(m.result_datetime, m.collection_datetime) IS NULL THEN NULL
              WHEN TO_NUMBER(TO_CHAR(NVL(m.result_datetime, m.collection_datetime), 'HH24')) BETWEEN 6 AND 13 THEN 'DAY'
              WHEN TO_NUMBER(TO_CHAR(NVL(m.result_datetime, m.collection_datetime), 'HH24')) BETWEEN 14 AND 21 THEN 'EVENING'
              ELSE 'NIGHT'
            END AS confirmed_shift,
            m.result_id
        FROM microbiology_results m
        JOIN admissions a
          ON a.admission_id = m.admission_id
        WHERE m.admission_id IN ({placeholders})
          AND NVL(m.is_mdro, 0) = 1
          AND UPPER(NVL(m.result_status, NVL(m.status, 'FINAL'))) IN ('FINAL', 'CONFIRMED', 'POSITIVE')
        ORDER BY m.admission_id, NVL(m.result_datetime, m.collection_datetime) DESC, m.result_id DESC
    """
    with conn.cursor() as cur:
        cur.execute(sql, binds)
        rows = cur.fetchall()

    normalized_rows: list[tuple[Any, ...]] = []
    for row in rows:
        mdro_type = str(row[2] or "MDRO").strip().upper()
        code_suffix = re.sub(r"[^A-Z0-9]+", "_", mdro_type).strip("_") or "UNKNOWN"
        diagnosis_code = f"MDRO_{code_suffix}"
        diagnosis_name = mdro_type
        normalized_rows.append(
            (
                row[0],  # admission_id
                row[1],  # patient_id
                diagnosis_code,
                diagnosis_name,
                row[3],  # confirmed_at
                row[4],  # confirmed_hd
                row[5],  # confirmed_d_number
                row[6],  # confirmed_shift
                "MICROBIOLOGY",
            )
        )

    return _pick_latest_confirmed_by_as_of(
        normalized_rows,
        as_of_by_admission,
        admission_idx=0,
        patient_idx=1,
        code_idx=2,
        name_idx=3,
        confirmed_at_idx=4,
        source_idx=8,
        confirmed_hd_idx=5,
        confirmed_d_number_idx=6,
        confirmed_shift_idx=7,
    )


def _fetch_confirmed_mdro_state(
    conn: "oracledb.Connection",
    admission_ids: list[int],
    as_of_by_admission: dict[int, datetime],
) -> dict[int, dict[str, Any]]:
    from_normalized, table_exists = _fetch_confirmed_mdro_from_infection_diagnoses(
        conn,
        admission_ids,
        as_of_by_admission,
    )
    if from_normalized:
        return from_normalized
    if table_exists:
        # Table exists but no rows for this scope. Keep backward compatibility by
        # falling back to microbiology signals so alert behavior doesn't disappear.
        return _fetch_confirmed_mdro_from_microbiology(conn, admission_ids, as_of_by_admission)
    return _fetch_confirmed_mdro_from_microbiology(conn, admission_ids, as_of_by_admission)


def sync_confirmed_mdro_to_infection_diagnoses(
    conn: "oracledb.Connection",
    admission_ids: list[int],
    *,
    write_mode: bool,
) -> dict[str, int]:
    if not admission_ids:
        return {
            "candidates": 0,
            "existing": 0,
            "would_insert": 0,
            "would_update": 0,
            "inserted": 0,
            "updated": 0,
            "table_exists": 0,
            "slot_columns": 0,
        }

    placeholders, binds = _build_in_clause(admission_ids, "sync")
    source_sql = f"""
        SELECT
            m.result_id,
            m.admission_id,
            a.patient_id,
            UPPER(NVL(m.mdro_type, 'MDRO')) AS mdro_type,
            NVL(m.result_datetime, m.collection_datetime) AS confirmed_at,
            m.hd AS confirmed_hd,
            m.d_number AS confirmed_d_number,
            CASE
              WHEN NVL(m.result_datetime, m.collection_datetime) IS NULL THEN NULL
              WHEN TO_NUMBER(TO_CHAR(NVL(m.result_datetime, m.collection_datetime), 'HH24')) BETWEEN 6 AND 13 THEN 'DAY'
              WHEN TO_NUMBER(TO_CHAR(NVL(m.result_datetime, m.collection_datetime), 'HH24')) BETWEEN 14 AND 21 THEN 'EVENING'
              ELSE 'NIGHT'
            END AS confirmed_shift
        FROM microbiology_results m
        JOIN admissions a
          ON a.admission_id = m.admission_id
        WHERE m.admission_id IN ({placeholders})
          AND NVL(m.is_mdro, 0) = 1
          AND UPPER(NVL(m.result_status, NVL(m.status, 'FINAL'))) IN ('FINAL', 'CONFIRMED', 'POSITIVE')
    """

    with conn.cursor() as cur:
        cur.execute(source_sql, binds)
        rows = cur.fetchall()

    candidates_by_ref: dict[str, dict[str, Any]] = {}
    for row in rows:
        result_id = row[0]
        if result_id is None:
            continue
        source_ref_id = str(int(result_id))
        mdro_type = str(row[3] or "MDRO").strip().upper() or "MDRO"
        code_suffix = re.sub(r"[^A-Z0-9]+", "_", mdro_type).strip("_") or "UNKNOWN"
        confirmed_hd_raw = _to_float(row[5])
        confirmed_d_raw = _to_float(row[6])
        candidates_by_ref[source_ref_id] = {
            "admission_id": int(row[1]),
            "patient_id": str(row[2] or ""),
            "diagnosis_code": f"MDRO_{code_suffix}",
            "diagnosis_name": mdro_type,
            "confirmed_at": row[4] if isinstance(row[4], datetime) else None,
            "confirmed_hd": int(confirmed_hd_raw) if confirmed_hd_raw is not None else None,
            "confirmed_d_number": int(confirmed_d_raw) if confirmed_d_raw is not None else None,
            "confirmed_shift": str(row[7]).upper() if row[7] else None,
            "source_ref_id": source_ref_id,
        }

    if not candidates_by_ref:
        return {
            "candidates": 0,
            "existing": 0,
            "would_insert": 0,
            "would_update": 0,
            "inserted": 0,
            "updated": 0,
            "table_exists": 1,
            "slot_columns": 0,
        }

    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM user_tables WHERE table_name = 'INFECTION_DIAGNOSES'"
        )
        table_exists = int(cur.fetchone()[0] or 0) > 0
    if not table_exists:
        return {
            "candidates": len(candidates_by_ref),
            "existing": 0,
            "would_insert": len(candidates_by_ref),
            "would_update": 0,
            "inserted": 0,
            "updated": 0,
            "table_exists": 0,
            "slot_columns": 0,
        }

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM user_tab_columns
            WHERE table_name = 'INFECTION_DIAGNOSES'
              AND column_name IN ('CONFIRMED_HD', 'CONFIRMED_D_NUMBER', 'CONFIRMED_SHIFT')
            """
        )
        slot_columns = int(cur.fetchone()[0] or 0) == 3

    source_refs = sorted(candidates_by_ref.keys(), key=int)
    existing_refs: set[str] = set()
    if source_refs:
        ref_placeholders, ref_binds = _build_in_clause(source_refs, "ref")
        existing_sql = f"""
            SELECT source_ref_id
            FROM infection_diagnoses
            WHERE source_type = 'MICROBIOLOGY'
              AND source_ref_id IN ({ref_placeholders})
        """
        with conn.cursor() as cur:
            cur.execute(existing_sql, ref_binds)
            existing_refs = {str(row[0]) for row in cur.fetchall() if row[0] is not None}

    update_payload = []
    insert_payload = []
    for source_ref_id in source_refs:
        payload = candidates_by_ref[source_ref_id]
        if source_ref_id in existing_refs:
            update_payload.append(payload)
        else:
            insert_payload.append(payload)

    if not write_mode:
        return {
            "candidates": len(candidates_by_ref),
            "existing": len(existing_refs),
            "would_insert": len(insert_payload),
            "would_update": len(update_payload),
            "inserted": 0,
            "updated": 0,
            "table_exists": 1,
            "slot_columns": 1 if slot_columns else 0,
        }

    if slot_columns:
        update_sql = """
            UPDATE infection_diagnoses
            SET admission_id = :admission_id,
                patient_id = :patient_id,
                diagnosis_code = :diagnosis_code,
                diagnosis_name = :diagnosis_name,
                diagnosis_group = 'MDRO',
                status = 'CONFIRMED',
                confirmed_at = :confirmed_at,
                confirmed_hd = :confirmed_hd,
                confirmed_d_number = :confirmed_d_number,
                confirmed_shift = :confirmed_shift,
                updated_at = SYSTIMESTAMP
            WHERE source_type = 'MICROBIOLOGY'
              AND source_ref_id = :source_ref_id
        """
        insert_sql = """
            INSERT INTO infection_diagnoses (
                admission_id,
                patient_id,
                diagnosis_code,
                diagnosis_name,
                diagnosis_group,
                status,
                confirmed_at,
                confirmed_hd,
                confirmed_d_number,
                confirmed_shift,
                source_type,
                source_ref_id,
                created_at,
                updated_at
            ) VALUES (
                :admission_id,
                :patient_id,
                :diagnosis_code,
                :diagnosis_name,
                'MDRO',
                'CONFIRMED',
                :confirmed_at,
                :confirmed_hd,
                :confirmed_d_number,
                :confirmed_shift,
                'MICROBIOLOGY',
                :source_ref_id,
                SYSTIMESTAMP,
                SYSTIMESTAMP
            )
        """
    else:
        update_sql = """
            UPDATE infection_diagnoses
            SET admission_id = :admission_id,
                patient_id = :patient_id,
                diagnosis_code = :diagnosis_code,
                diagnosis_name = :diagnosis_name,
                diagnosis_group = 'MDRO',
                status = 'CONFIRMED',
                confirmed_at = :confirmed_at,
                updated_at = SYSTIMESTAMP
            WHERE source_type = 'MICROBIOLOGY'
              AND source_ref_id = :source_ref_id
        """
        insert_sql = """
            INSERT INTO infection_diagnoses (
                admission_id,
                patient_id,
                diagnosis_code,
                diagnosis_name,
                diagnosis_group,
                status,
                confirmed_at,
                source_type,
                source_ref_id,
                created_at,
                updated_at
            ) VALUES (
                :admission_id,
                :patient_id,
                :diagnosis_code,
                :diagnosis_name,
                'MDRO',
                'CONFIRMED',
                :confirmed_at,
                'MICROBIOLOGY',
                :source_ref_id,
                SYSTIMESTAMP,
                SYSTIMESTAMP
            )
        """

    updated = 0
    inserted = 0
    if slot_columns:
        update_rows = update_payload
        insert_rows = insert_payload
    else:
        update_rows = [
            {
                "admission_id": item["admission_id"],
                "patient_id": item["patient_id"],
                "diagnosis_code": item["diagnosis_code"],
                "diagnosis_name": item["diagnosis_name"],
                "confirmed_at": item["confirmed_at"],
                "source_ref_id": item["source_ref_id"],
            }
            for item in update_payload
        ]
        insert_rows = [
            {
                "admission_id": item["admission_id"],
                "patient_id": item["patient_id"],
                "diagnosis_code": item["diagnosis_code"],
                "diagnosis_name": item["diagnosis_name"],
                "confirmed_at": item["confirmed_at"],
                "source_ref_id": item["source_ref_id"],
            }
            for item in insert_payload
        ]
    if update_rows:
        with conn.cursor() as cur:
            cur.executemany(update_sql, update_rows)
            updated = int(cur.rowcount or 0)
    if insert_rows:
        with conn.cursor() as cur:
            cur.executemany(insert_sql, insert_rows)
            inserted = int(cur.rowcount or 0)
    if inserted or updated:
        conn.commit()

    return {
        "candidates": len(candidates_by_ref),
        "existing": len(existing_refs),
        "would_insert": len(insert_payload),
        "would_update": len(update_payload),
        "inserted": inserted,
        "updated": updated,
        "table_exists": 1,
        "slot_columns": 1 if slot_columns else 0,
    }


def _fetch_nursing_snapshots_by_slot(
    conn: "oracledb.Connection", admission_ids: list[int]
) -> dict[tuple[int, int, str], dict[str, Any]]:
    if not admission_ids:
        return {}
    placeholders, binds = _build_in_clause(admission_ids, "n")
    sql = f"""
        SELECT
            n.admission_id,
            n.d_number,
            n.note_datetime,
            n.temp,
            n.hr,
            n.rr,
            n.bp_sys,
            n.bp_dia,
            n.spo2
        FROM nursing_notes n
        WHERE n.admission_id IN ({placeholders})
          AND n.d_number IS NOT NULL
    """
    with conn.cursor() as cur:
        cur.execute(sql, binds)
        rows = cur.fetchall()

    out: dict[tuple[int, int, str], dict[str, Any]] = {}
    for row in rows:
        admission_id = int(row[0])
        d_number = int(row[1])
        note_dt = row[2]
        if not isinstance(note_dt, datetime):
            continue
        shift = _infer_shift_from_datetime(note_dt)
        if not shift:
            continue
        key = _compose_slot_key(admission_id, d_number, shift)
        existing = out.get(key)
        if existing and isinstance(existing.get("timestamp"), datetime):
            if existing["timestamp"] >= note_dt:
                continue
        out[key] = {
            "timestamp": note_dt,
            "temp": _to_float(row[3]),
            "hr": _to_float(row[4]),
            "rr": _to_float(row[5]),
            "sbp": _to_float(row[6]),
            "dbp": _to_float(row[7]),
            "spo2": _to_float(row[8]),
        }
    return out


def _fetch_labs_by_slot(
    conn: "oracledb.Connection", admission_ids: list[int]
) -> dict[tuple[int, int, str], dict[str, dict[str, Any]]]:
    if not admission_ids:
        return {}
    placeholders, binds = _build_in_clause(admission_ids, "l")
    sql = f"""
        SELECT
            l.admission_id,
            l.d_number,
            l.result_datetime,
            l.item_code,
            l.item_name,
            l.value
        FROM lab_results l
        WHERE l.admission_id IN ({placeholders})
          AND l.d_number IS NOT NULL
    """
    with conn.cursor() as cur:
        cur.execute(sql, binds)
        rows = cur.fetchall()

    out: dict[tuple[int, int, str], dict[str, dict[str, Any]]] = {}
    for row in rows:
        admission_id = int(row[0])
        d_number = int(row[1])
        result_dt = row[2]
        if not isinstance(result_dt, datetime):
            continue
        canonical = _canonical_lab_code(row[3], row[4])
        if not canonical:
            continue
        value = _to_float(row[5])
        if value is None:
            continue
        shift = _infer_shift_from_datetime(result_dt)
        if not shift:
            continue
        key = _compose_slot_key(admission_id, d_number, shift)
        by_code = out.setdefault(key, {})
        existing = by_code.get(canonical)
        if existing and isinstance(existing.get("timestamp"), datetime):
            if existing["timestamp"] >= result_dt:
                continue
        by_code[canonical] = {"value": value, "timestamp": result_dt}
    return out


def _build_slot_clinical_snapshots(
    nursing_by_slot: dict[tuple[int, int, str], dict[str, Any]],
    labs_by_slot: dict[tuple[int, int, str], dict[str, dict[str, Any]]],
) -> dict[tuple[int, int, str], dict[str, Any]]:
    snapshots: dict[tuple[int, int, str], dict[str, Any]] = {}
    keys = set(nursing_by_slot.keys()) | set(labs_by_slot.keys())
    for key in keys:
        nursing = nursing_by_slot.get(key, {})
        labs = labs_by_slot.get(key, {})
        sbp = _to_float(nursing.get("sbp"))
        dbp = _to_float(nursing.get("dbp"))
        snapshot = {
            "temp": _to_float(nursing.get("temp")),
            "hr": _to_float(nursing.get("hr")),
            "rr": _to_float(nursing.get("rr")),
            "spo2": _to_float(nursing.get("spo2")),
            "sbp": sbp,
            "dbp": dbp,
            "map": _compute_map(sbp, dbp),
            "wbc": _to_float((labs.get("WBC") or {}).get("value")),
            "crp": _to_float((labs.get("CRP") or {}).get("value")),
            "lactate": _to_float((labs.get("LACTATE") or {}).get("value")),
            "creatinine": _to_float((labs.get("CREATININE") or {}).get("value")),
            "platelets": _to_float((labs.get("PLATELETS") or {}).get("value")),
            "bilirubin": _to_float((labs.get("BILIRUBIN") or {}).get("value")),
            "sodium": _to_float((labs.get("SODIUM") or {}).get("value")),
            "potassium": _to_float((labs.get("POTASSIUM") or {}).get("value")),
            "ph": _to_float((labs.get("PH") or {}).get("value")),
        }
        timestamps: list[datetime] = []
        nursing_ts = nursing.get("timestamp")
        if isinstance(nursing_ts, datetime):
            timestamps.append(nursing_ts)
        for item in labs.values():
            ts = item.get("timestamp")
            if isinstance(ts, datetime):
                timestamps.append(ts)
        snapshot["latest_datetime"] = max(timestamps) if timestamps else None
        snapshots[key] = snapshot
    return snapshots


def _build_sepsis_feature_snapshot(
    patient_age: float | None,
    snapshot: dict[str, Any],
    hd: int | None,
    shift: str | None,
) -> dict[str, float]:
    hr = _to_float(snapshot.get("hr"))
    sbp = _to_float(snapshot.get("sbp"))
    dbp = _to_float(snapshot.get("dbp"))
    rr = _to_float(snapshot.get("rr"))
    spo2 = _to_float(snapshot.get("spo2"))
    lactate = _to_float(snapshot.get("lactate"))
    wbc = _to_float(snapshot.get("wbc"))
    creatinine = _to_float(snapshot.get("creatinine"))
    platelets = _to_float(snapshot.get("platelets"))
    bilirubin = _to_float(snapshot.get("bilirubin"))
    sodium = _to_float(snapshot.get("sodium"))
    potassium = _to_float(snapshot.get("potassium"))
    ph = _to_float(snapshot.get("ph"))
    mbp = _compute_map(sbp, dbp)
    pulse_pressure = (sbp - dbp) if sbp is not None and dbp is not None else None
    shock_index = (hr / sbp) if hr is not None and sbp not in (None, 0) else None

    shift_rank = _shift_order(shift) if shift else 1
    shift_hour = SHIFT_ORDER_TO_HOUR.get(shift_rank, 8)
    observation_hour = None
    if hd is not None:
        observation_hour = max(0, ((int(hd) - 1) * 24) + shift_hour)

    raw_snapshot: dict[str, float | None] = {
        "hr": hr,
        "hr_max": hr,
        "sbp": sbp,
        "dbp": dbp,
        "mbp": mbp,
        "rr": rr,
        "rr_max": rr,
        "spo2": spo2,
        "lactate": lactate,
        "wbc": wbc,
        "creatinine": creatinine,
        "platelets": platelets,
        "bilirubin": bilirubin,
        "sodium": sodium,
        "potassium": potassium,
        "ph": ph,
        "shock_index": shock_index,
        "pulse_pressure": pulse_pressure,
        "anchor_age": patient_age,
        "observation_hour": float(observation_hour) if observation_hour is not None else None,
        "abga_checked": 1.0 if ph is not None else 0.0,
        "icu_micu": 1.0,
        "icu_micu_sicu": 0.0,
    }

    feature_snapshot: dict[str, float] = {}
    for key, value in raw_snapshot.items():
        if value is None:
            continue
        if isinstance(value, float) and value == value:
            feature_snapshot[key] = value
    return feature_snapshot


def _build_sepsis_infer_urls() -> list[str]:
    base = _sepsis_flask_base_url()
    primary = f"{base}/v1/sepsis/infer"
    urls = [primary]
    localhost_re = re.compile(r"^(https?://)localhost(?=[:/]|$)", re.IGNORECASE)
    if localhost_re.search(base):
        fallback = localhost_re.sub(r"\g<1>127.0.0.1", base)
        urls.append(f"{fallback}/v1/sepsis/infer")
    # preserve order and dedup
    return list(dict.fromkeys(urls))


def _call_sepsis_flask_infer(payload: dict[str, Any]) -> dict[str, Any] | None:
    if not _is_sepsis_flask_enabled():
        return None

    timeout_sec = _sepsis_flask_timeout_ms() / 1000.0
    body = json.dumps(payload).encode("utf-8")
    last_error: str | None = None
    for url in _build_sepsis_infer_urls():
        req = Request(
            url=url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=timeout_sec) as resp:  # nosec: B310 (local service)
                parsed = json.loads(resp.read().decode("utf-8"))
            if isinstance(parsed, dict) and parsed.get("status") == "ok":
                return parsed
            last_error = f"{url} :: invalid response"
        except HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode("utf-8")
            except Exception:
                pass
            last_error = f"{url} :: HTTP {exc.code} {err_body}".strip()
        except URLError as exc:
            last_error = f"{url} :: {exc.reason}"
        except Exception as exc:  # pragma: no cover - defensive
            last_error = f"{url} :: {exc}"

    if last_error:
        print(f"[warn] sepsis flask infer failed: {last_error}")
    return None


def _sepsis_trigger_flags(snapshot: dict[str, Any]) -> dict[str, bool]:
    sbp = _to_float(snapshot.get("sbp"))
    map_value = _to_float(snapshot.get("map"))
    spo2 = _to_float(snapshot.get("spo2"))
    lactate = _to_float(snapshot.get("lactate"))
    return {
        "hypotension": (sbp is not None and sbp <= 90) or (map_value is not None and map_value <= 65),
        "hypoxemia": spo2 is not None and spo2 < 92,
        "lactate_high": lactate is not None and lactate >= 2.0,
    }


def _evaluate_no_meaningful_change(
    current_snapshot: dict[str, Any],
    previous_snapshot: dict[str, Any],
    current_event_types: set[str],
) -> tuple[bool, str]:
    lowered_types = {str(item).lower() for item in current_event_types}
    if lowered_types & HIGH_RISK_EVENT_TYPES:
        return False, "high_risk_event_present"
    if lowered_types & ESCALATION_EVENT_TYPES:
        return False, "escalation_event_present"

    vital_count = 0
    lab_count = 0

    cur_temp, prev_temp = _to_float(current_snapshot.get("temp")), _to_float(previous_snapshot.get("temp"))
    if cur_temp is not None and prev_temp is not None:
        vital_count += 1
        if abs(cur_temp - prev_temp) >= 0.5:
            return False, "temp_delta_exceeded"

    cur_hr, prev_hr = _to_float(current_snapshot.get("hr")), _to_float(previous_snapshot.get("hr"))
    if cur_hr is not None and prev_hr is not None:
        vital_count += 1
        if abs(cur_hr - prev_hr) >= 15:
            return False, "hr_delta_exceeded"

    cur_rr, prev_rr = _to_float(current_snapshot.get("rr")), _to_float(previous_snapshot.get("rr"))
    if cur_rr is not None and prev_rr is not None:
        vital_count += 1
        if abs(cur_rr - prev_rr) >= 4:
            return False, "rr_delta_exceeded"

    cur_spo2, prev_spo2 = _to_float(current_snapshot.get("spo2")), _to_float(
        previous_snapshot.get("spo2")
    )
    if cur_spo2 is not None and prev_spo2 is not None:
        vital_count += 1
        if (prev_spo2 - cur_spo2) >= 3 or cur_spo2 < 92:
            return False, "spo2_condition_failed"

    cur_sbp, prev_sbp = _to_float(current_snapshot.get("sbp")), _to_float(previous_snapshot.get("sbp"))
    cur_map, prev_map = _to_float(current_snapshot.get("map")), _to_float(previous_snapshot.get("map"))
    sbp_comparable = cur_sbp is not None and prev_sbp is not None
    map_comparable = cur_map is not None and prev_map is not None
    if sbp_comparable or map_comparable:
        vital_count += 1
        sbp_ok = sbp_comparable and (prev_sbp - cur_sbp) < 15
        map_ok = map_comparable and (prev_map - cur_map) < 10
        if not (sbp_ok or map_ok):
            return False, "bp_map_condition_failed"

    cur_lactate, prev_lactate = _to_float(current_snapshot.get("lactate")), _to_float(
        previous_snapshot.get("lactate")
    )
    if cur_lactate is not None and prev_lactate is not None:
        lab_count += 1
        if (cur_lactate - prev_lactate) >= 0.5:
            return False, "lactate_delta_exceeded"
        if prev_lactate < 2.0 <= cur_lactate:
            return False, "lactate_threshold_crossed"

    cur_wbc, prev_wbc = _to_float(current_snapshot.get("wbc")), _to_float(previous_snapshot.get("wbc"))
    if cur_wbc is not None and prev_wbc is not None:
        lab_count += 1
        wbc_ratio = _safe_ratio_delta(cur_wbc, prev_wbc)
        if wbc_ratio is not None and wbc_ratio >= 0.20:
            return False, "wbc_ratio_exceeded"

    cur_crp, prev_crp = _to_float(current_snapshot.get("crp")), _to_float(previous_snapshot.get("crp"))
    if cur_crp is not None and prev_crp is not None:
        lab_count += 1
        crp_ratio = _safe_ratio_delta(cur_crp, prev_crp)
        if crp_ratio is not None and crp_ratio >= 0.25:
            return False, "crp_ratio_exceeded"

    if not (vital_count >= 3 or (vital_count >= 1 and lab_count >= 1)):
        return False, "insufficient_data"

    return True, "stable_vs_previous_slot"


def _make_runtime_event(
    *,
    admission_id: int,
    patient_id: str,
    event_type: str,
    event_datetime: datetime,
    hd: int | None,
    d_number: int | None,
    shift: str | None,
    render_text: str,
    evidence_text: str,
    event_severity: str | None = None,
) -> dict[str, Any]:
    return {
        "event_id": None,
        "admission_id": admission_id,
        "patient_id": patient_id,
        "event_type": event_type,
        "event_datetime": event_datetime,
        "axis_type": "CLINICAL_ACTION",
        "priority_rank": None,
        "render_text": render_text,
        "evidence_text": evidence_text,
        "event_severity": event_severity,
        "supporting_docs_json": None,
        "hd": hd,
        "d_number": d_number,
        "shift": shift,
    }


def augment_runtime_events(
    conn: "oracledb.Connection",
    events: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    if not events:
        return events, {}

    slots, slots_by_admission = _build_trajectory_slots(events)
    if not slots:
        return events, {}

    admission_ids = sorted(slots_by_admission.keys())
    admission_meta = _fetch_admission_meta(conn, admission_ids)
    nursing_by_slot = _fetch_nursing_snapshots_by_slot(conn, admission_ids)
    labs_by_slot = _fetch_labs_by_slot(conn, admission_ids)
    slot_snapshots = _build_slot_clinical_snapshots(nursing_by_slot, labs_by_slot)
    as_of_by_admission: dict[int, datetime] = {}
    for admission_id, slot_keys in slots_by_admission.items():
        if not slot_keys:
            continue
        latest_key = slot_keys[-1]
        latest_slot = slots.get(latest_key, {})
        latest_snapshot = slot_snapshots.get(latest_key, {})
        event_dt = (
            latest_snapshot.get("latest_datetime")
            or latest_slot.get("event_datetime")
            or datetime.now()
        )
        if isinstance(event_dt, datetime):
            as_of_by_admission[admission_id] = event_dt
        else:
            as_of_by_admission[admission_id] = datetime.now()

    isolation_live_by_admission = _fetch_isolation_live_state(conn, admission_ids)
    confirmed_mdro_by_admission = _fetch_confirmed_mdro_state(
        conn,
        admission_ids,
        as_of_by_admission,
    )

    runtime_events: list[dict[str, Any]] = []
    stats: dict[str, int] = defaultdict(int)

    for admission_id, slot_keys in slots_by_admission.items():
        if not slot_keys:
            continue

        # S1 no_meaningful_change on each slot compared to previous slot
        for idx in range(1, len(slot_keys)):
            current_key = slot_keys[idx]
            previous_key = slot_keys[idx - 1]
            current_slot = slots.get(current_key, {})
            previous_slot = slots.get(previous_key, {})
            current_snapshot = slot_snapshots.get(current_key, {})
            previous_snapshot = slot_snapshots.get(previous_key, {})
            current_types = {
                str(item.get("event_type") or "").lower()
                for item in current_slot.get("events", [])
            }

            ok, reason = _evaluate_no_meaningful_change(
                current_snapshot=current_snapshot,
                previous_snapshot=previous_snapshot,
                current_event_types=current_types,
            )
            if not ok:
                continue

            event_dt = (
                current_snapshot.get("latest_datetime")
                or current_slot.get("event_datetime")
                or previous_snapshot.get("latest_datetime")
                or previous_slot.get("event_datetime")
                or datetime.now()
            )
            patient_id = str(current_slot.get("patient_id") or admission_meta.get(admission_id, {}).get("patient_id") or "")
            if not patient_id:
                continue
            hd = current_slot.get("hd")
            if hd is None:
                hd = int(current_key[1]) + 1
            runtime_events.append(
                _make_runtime_event(
                    admission_id=admission_id,
                    patient_id=patient_id,
                    event_type="no_meaningful_change",
                    event_datetime=event_dt,
                    hd=hd,
                    d_number=int(current_key[1]),
                    shift=str(current_key[2]),
                    render_text="의미 있는 변화 없음(직전 슬롯 대비 안정)",
                    evidence_text=reason,
                    event_severity="info",
                )
            )
            stats["no_meaningful_change"] += 1

        # Sepsis pseudo events (latest slot only)
        latest_key = slot_keys[-1]
        latest_slot = slots.get(latest_key, {})
        latest_snapshot = slot_snapshots.get(latest_key, {})
        isolation_live = isolation_live_by_admission.get(admission_id) or {}
        confirmed_mdro = confirmed_mdro_by_admission.get(admission_id)
        patient_id = str(
            latest_slot.get("patient_id")
            or admission_meta.get(admission_id, {}).get("patient_id")
            or isolation_live.get("patient_id")
            or (confirmed_mdro or {}).get("patient_id")
            or ""
        )
        if not patient_id:
            continue
        hd = latest_slot.get("hd")
        if hd is None:
            hd = int(latest_key[1]) + 1

        # ISOLATION(CRITICAL): "지금도 gap인지"는 live state로 판단하되,
        # 알림 슬롯(d/shift/hd)은 MDRO 확진 슬롯에 고정한다.
        if confirmed_mdro:
            isolation_required = int(_to_float(isolation_live.get("isolation_required")) or 0)
            isolation_applied = bool(isolation_live.get("isolation_applied"))
            if isolation_required == 1 and not isolation_applied:
                diagnosis_name = str(confirmed_mdro.get("diagnosis_name") or "MDRO")
                room_number = str(isolation_live.get("room_number") or "-")
                ward_id = str(isolation_live.get("ward_id") or "-")
                bed_id = str(isolation_live.get("current_bed_id") or "-")
                bed_status = str(isolation_live.get("bed_status") or "-")

                confirmed_at = (
                    confirmed_mdro.get("confirmed_at")
                    if isinstance(confirmed_mdro.get("confirmed_at"), datetime)
                    else None
                )
                confirmed_d_raw = _to_float(confirmed_mdro.get("confirmed_d_number"))
                confirmed_shift = _normalize_shift_token(confirmed_mdro.get("confirmed_shift"))
                confirmed_hd_raw = _to_float(confirmed_mdro.get("confirmed_hd"))

                confirmed_slot_key: tuple[int, int, str] | None = None
                # Prefer the first trajectory slot that explicitly marks MDRO confirmation.
                for key in slot_keys:
                    slot_events = slots.get(key, {}).get("events", [])
                    has_mdro_confirm_event = False
                    for item in slot_events:
                        event_type = str(item.get("event_type") or "").strip().lower()
                        render_text = str(item.get("render_text") or "").strip().lower()
                        if event_type in {"mdro_confirmed", "new_mdro_detection"}:
                            has_mdro_confirm_event = True
                            break
                        if "mdro confirmed" in render_text or "new mdro detection" in render_text:
                            has_mdro_confirm_event = True
                            break
                    if has_mdro_confirm_event:
                        confirmed_slot_key = key
                        break

                if confirmed_slot_key is None and confirmed_d_raw is not None:
                    confirmed_d = int(confirmed_d_raw)
                    for key in slot_keys:
                        if int(key[1]) != confirmed_d:
                            continue
                        if confirmed_shift and _normalize_shift_token(key[2]) == confirmed_shift:
                            confirmed_slot_key = key
                            break
                        if confirmed_slot_key is None:
                            confirmed_slot_key = key

                if confirmed_slot_key is None:
                    confirmed_slot_key = _resolve_slot_key_for_confirmed_at(
                        slot_keys,
                        slots,
                        confirmed_at,
                    )
                if confirmed_slot_key is None:
                    confirmed_slot_key = latest_key

                confirmed_slot = slots.get(confirmed_slot_key, {})
                confirmed_d_number = int(confirmed_slot_key[1])
                confirmed_shift_token = _normalize_shift_token(confirmed_slot_key[2]) or "Night"
                confirmed_hd = confirmed_slot.get("hd")
                if confirmed_hd is None and confirmed_hd_raw is not None:
                    confirmed_hd = int(confirmed_hd_raw)
                if confirmed_hd is None:
                    confirmed_hd = confirmed_d_number + 1

                event_dt = (
                    confirmed_at
                    or confirmed_slot.get("event_datetime")
                    or as_of_by_admission.get(admission_id)
                    or latest_snapshot.get("latest_datetime")
                    or latest_slot.get("event_datetime")
                    or datetime.now()
                )
                evidence = (
                    f"diagnosis={diagnosis_name}, required=1, applied=0, "
                    f"bed={bed_id}, room={room_number}, ward={ward_id}, bed_status={bed_status}, "
                    f"confirmed_d={confirmed_d_number}, confirmed_shift={confirmed_shift_token}"
                )
                runtime_events.append(
                    _make_runtime_event(
                        admission_id=admission_id,
                        patient_id=patient_id,
                        event_type="isolation_gap_current",
                        event_datetime=event_dt,
                        hd=int(confirmed_hd),
                        d_number=confirmed_d_number,
                        shift=confirmed_shift_token,
                        render_text=f"MDRO confirmed: {diagnosis_name} / isolation not applied (gap)",
                        evidence_text=evidence,
                        event_severity="critical",
                    )
                )
                stats["isolation_gap_current"] += 1

        feature_snapshot = _build_sepsis_feature_snapshot(
            patient_age=_to_float((admission_meta.get(admission_id) or {}).get("age")),
            snapshot=latest_snapshot,
            hd=hd,
            shift=str(latest_key[2]),
        )
        if feature_snapshot:
            inferred = _call_sepsis_flask_infer(
                {
                    "patientId": patient_id,
                    "admissionId": admission_id,
                    "hd": hd,
                    "dNumber": int(latest_key[1]),
                    "featureSnapshot": feature_snapshot,
                }
            )
            risk_score = _to_float((inferred or {}).get("risk_score"))
            if inferred and risk_score is not None:
                critical_threshold = _sepsis_gate_critical_threshold()
                action_threshold = _sepsis_gate_action_threshold()
                flags = _sepsis_trigger_flags(latest_snapshot)
                active_triggers = [name for name, enabled in flags.items() if enabled]
                event_dt = (
                    latest_snapshot.get("latest_datetime")
                    or latest_slot.get("event_datetime")
                    or datetime.now()
                )

                if risk_score >= critical_threshold:
                    runtime_events.append(
                        _make_runtime_event(
                            admission_id=admission_id,
                            patient_id=patient_id,
                            event_type="sepsis_rate_high",
                            event_datetime=event_dt,
                            hd=hd,
                            d_number=int(latest_key[1]),
                            shift=str(latest_key[2]),
                            render_text=f"Sepsis risk score {risk_score:.3f} (high)",
                            evidence_text=f"risk_score={risk_score:.3f}, threshold={critical_threshold:.2f}",
                            event_severity="critical",
                        )
                    )
                    stats["sepsis_rate_high"] += 1
                    if active_triggers:
                        runtime_events.append(
                            _make_runtime_event(
                                admission_id=admission_id,
                                patient_id=patient_id,
                                event_type="sepsis_vital_lab_trigger",
                                event_datetime=event_dt,
                                hd=hd,
                                d_number=int(latest_key[1]),
                                shift=str(latest_key[2]),
                                render_text="Sepsis vital/lab trigger 동반",
                                evidence_text=", ".join(active_triggers),
                                event_severity="critical",
                            )
                        )
                        stats["sepsis_vital_lab_trigger"] += 1
                    else:
                        runtime_events.append(
                            _make_runtime_event(
                                admission_id=admission_id,
                                patient_id=patient_id,
                                event_type="sepsis_gate_failed",
                                event_datetime=event_dt,
                                hd=hd,
                                d_number=int(latest_key[1]),
                                shift=str(latest_key[2]),
                                render_text="Sepsis risk는 높으나 게이트 미충족",
                                evidence_text=f"risk_score={risk_score:.3f}, trigger=none",
                                event_severity="warning",
                            )
                        )
                        stats["sepsis_gate_failed"] += 1
                elif risk_score >= action_threshold:
                    runtime_events.append(
                        _make_runtime_event(
                            admission_id=admission_id,
                            patient_id=patient_id,
                            event_type="sepsis_gate_failed",
                            event_datetime=event_dt,
                            hd=hd,
                            d_number=int(latest_key[1]),
                            shift=str(latest_key[2]),
                            render_text="Sepsis 위험 상승(관찰 필요)",
                            evidence_text=f"risk_score={risk_score:.3f}, triggers={len(active_triggers)}",
                            event_severity="warning",
                        )
                    )
                    stats["sepsis_gate_failed"] += 1

    if not runtime_events:
        return events, dict(stats)
    stats["runtime_added"] = len(runtime_events)
    return events + runtime_events, dict(stats)


def dedup_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[Any] = set()
    ordered: list[dict[str, Any]] = []
    for event in events:
        event_id = event.get("event_id")
        key = event_id if event_id is not None else (
            event.get("event_type"),
            event.get("event_datetime"),
            event.get("hd"),
            event.get("d_number"),
        )
        if key in seen:
            continue
        seen.add(key)
        ordered.append(event)
    return ordered


def evaluate_condition(condition: dict[str, Any], events: list[dict[str, Any]]) -> tuple[bool, list[dict[str, Any]]]:
    if not isinstance(condition, dict):
        return False, []

    if "all" in condition:
        parts = condition.get("all")
        if not isinstance(parts, list) or not parts:
            return False, []
        matched: list[dict[str, Any]] = []
        for part in parts:
            ok, sub = evaluate_condition(part, events)
            if not ok:
                return False, []
            matched.extend(sub)
        return True, dedup_events(matched)

    if "any" in condition:
        parts = condition.get("any")
        if not isinstance(parts, list) or not parts:
            return False, []
        required = int(condition.get("min_count", 1))
        hit_count = 0
        matched: list[dict[str, Any]] = []
        for part in parts:
            ok, sub = evaluate_condition(part, events)
            if ok:
                hit_count += 1
                matched.extend(sub)
        if hit_count < required:
            return False, []
        return True, dedup_events(matched)

    if "event_type" in condition:
        event_type = str(condition.get("event_type"))
        hits = [e for e in events if str(e.get("event_type")) == event_type]
        required = int(condition.get("min_count", 1))
        return (len(hits) >= required, hits if len(hits) >= required else [])

    # Unsupported condition shape (e.g., source-threshold in future rules)
    return False, []


def _event_types_from_condition(condition: Any) -> list[str]:
    out: list[str] = []
    if isinstance(condition, dict):
        if "event_type" in condition:
            out.append(str(condition["event_type"]))
        if "all" in condition and isinstance(condition["all"], list):
            for item in condition["all"]:
                out.extend(_event_types_from_condition(item))
        if "any" in condition and isinstance(condition["any"], list):
            for item in condition["any"]:
                out.extend(_event_types_from_condition(item))
    return out


def evaluate_rule(
    rule: dict[str, Any],
    events: list[dict[str, Any]],
) -> tuple[bool, list[dict[str, Any]]]:
    condition = rule.get("condition")
    if not isinstance(condition, dict):
        return False, []

    scope = str(rule.get("scope") or "").strip().lower()
    if scope == "since_first":
        anchor_type = None
        all_clause = condition.get("all")
        if isinstance(all_clause, list) and all_clause:
            first = all_clause[0]
            if isinstance(first, dict) and "event_type" in first:
                anchor_type = str(first["event_type"])
        if not anchor_type:
            event_types = _event_types_from_condition(condition)
            anchor_type = event_types[0] if event_types else None

        if not anchor_type:
            return False, []
        anchor_event = next((e for e in events if str(e.get("event_type")) == anchor_type), None)
        if not anchor_event:
            return False, []
        anchor_dt = anchor_event.get("event_datetime")
        scoped_events = [
            e
            for e in events
            if e.get("event_datetime") is not None
            and anchor_dt is not None
            and e["event_datetime"] >= anchor_dt
        ]
        return evaluate_condition(condition, scoped_events)

    return evaluate_condition(condition, events)


def build_evidence_snippet(events: list[dict[str, Any]]) -> str:
    texts = [str(e.get("render_text") or "").strip() for e in events]
    texts = [t for t in texts if t]
    if not texts:
        types = [str(e.get("event_type") or "") for e in events]
        types = [t for t in types if t]
        if not types:
            return "-"
        return _truncate(" + ".join(types), 1000)

    counts = Counter(texts)
    ordered_unique: list[str] = []
    seen: set[str] = set()
    for text in texts:
        if text in seen:
            continue
        seen.add(text)
        ordered_unique.append(text)

    pieces = [f"{t} x {counts[t]}" if counts[t] > 1 else t for t in ordered_unique]
    return _truncate(" + ".join(pieces), 1000)


def build_trigger_json(
    rule: dict[str, Any],
    events: list[dict[str, Any]],
    patient_id: str,
    admission_id: int | None,
    hd: int | None,
    d_number: int | None,
) -> str:
    latest_event = max(events, key=_event_sort_key) if events else {}
    shift_raw = latest_event.get("shift")
    shift_value = str(shift_raw).strip().upper() if shift_raw is not None else None
    if shift_value not in {"DAY", "EVENING", "NIGHT"}:
        shift_value = None

    payload = {
        "rule": str(rule.get("alert_type") or ""),
        "scope": str(rule.get("scope") or "hd"),
        "patient_id": patient_id,
        "admission_id": admission_id,
        "hd": hd,
        "d_number": d_number,
        "shift": shift_value,
        "event_shift": shift_value,
        "events": [
            {
                "event_id": e.get("event_id"),
                "event_type": e.get("event_type"),
                "event_datetime": _to_iso(e.get("event_datetime")),
                "render_text": e.get("render_text"),
                "evidence_text": e.get("evidence_text"),
                "hd": e.get("hd"),
                "d_number": e.get("d_number"),
                "shift": e.get("shift"),
                "axis_type": e.get("axis_type"),
            }
            for e in events
        ],
    }
    return json.dumps(payload, ensure_ascii=False)


def build_recommended_cta_json(rule: dict[str, Any]) -> str:
    ctas = rule.get("recommended_cta")
    if isinstance(ctas, list):
        return json.dumps(ctas, ensure_ascii=False)
    return json.dumps([], ensure_ascii=False)


def should_skip_by_dedup(
    existing_by_patient: dict[str, list[dict[str, Any]]],
    candidate: EngineCandidate,
    dedup_config: dict[str, Any],
    disable_rate_limit: bool = False,
) -> tuple[bool, str]:
    patient_existing = existing_by_patient.get(candidate.patient_id, [])
    rate_limit_minutes = 0 if disable_rate_limit else int(
        (dedup_config.get(candidate.severity, {}) or {}).get("rate_limit_minutes", 0)
    )
    now = datetime.now()
    for existing in patient_existing:
        if str(existing.get("alert_type")) != candidate.alert_type:
            continue
        if normalize_severity(existing.get("severity")) != candidate.severity:
            continue
        existing_hd = existing.get("hd")
        if candidate.hd is not None and existing_hd is not None and int(existing_hd) == int(candidate.hd):
            return True, "same_hd"
        existing_created = existing.get("created_at")
        if isinstance(existing_created, datetime) and rate_limit_minutes > 0:
            if now - existing_created < timedelta(minutes=rate_limit_minutes):
                return True, "rate_limit"
    return False, ""


def group_events_for_action(events: list[dict[str, Any]]) -> dict[tuple[Any, Any, Any], list[dict[str, Any]]]:
    grouped: dict[tuple[Any, Any, Any], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        key = (event.get("admission_id"), event.get("hd"), event.get("d_number"))
        grouped[key].append(event)
    for key in grouped:
        grouped[key].sort(key=_event_sort_key)
    return grouped


def build_candidates(
    events: list[dict[str, Any]],
    rules_payload: dict[str, Any],
    existing_by_patient: dict[str, list[dict[str, Any]]],
    disable_rate_limit: bool = False,
) -> tuple[list[EngineCandidate], dict[str, int]]:
    dedup_config = rules_payload.get("dedup", {}) or {}
    rules = rules_payload.get("rules", []) or []

    critical_rules = [r for r in rules if normalize_severity(r.get("severity")) == "CRITICAL"]
    action_rules = [r for r in rules if normalize_severity(r.get("severity")) == "ACTION"]
    info_rules = [r for r in rules if normalize_severity(r.get("severity")) == "INFO"]

    events_by_patient: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        patient_id = str(event.get("patient_id"))
        events_by_patient[patient_id].append(event)
    for patient_id in events_by_patient:
        events_by_patient[patient_id].sort(key=_event_sort_key)

    candidates: list[EngineCandidate] = []
    skip_stats: dict[str, int] = defaultdict(int)

    for patient_id, patient_events in events_by_patient.items():
        consumed_ids: set[Any] = set()

        # Step 1: CRITICAL rules first (patient scope)
        for rule in critical_rules:
            scope = str(rule.get("scope") or "").strip().lower()
            if scope in ("slot", "hd", "d_number"):
                grouped_for_critical = group_events_for_action(patient_events)
                evaluation_groups = list(grouped_for_critical.values())
            else:
                evaluation_groups = [patient_events]

            for eval_events in evaluation_groups:
                ok, matched = evaluate_rule(rule, eval_events)
                if not ok or not matched:
                    continue

                matched = dedup_events(matched)
                if not matched:
                    continue
                consumed_ids.update(
                    e.get("event_id") for e in matched if e.get("event_id") is not None
                )

                latest_event = max(
                    matched,
                    key=_event_sort_key,
                )
                admission_id = latest_event.get("admission_id")
                hd = latest_event.get("hd")
                d_number = latest_event.get("d_number")
                severity = normalize_severity(rule.get("severity"))
                message = _truncate(str(rule.get("description") or rule.get("alert_type") or ""), 500)

                candidate = EngineCandidate(
                    admission_id=admission_id,
                    patient_id=patient_id,
                    alert_type=str(rule.get("alert_type")),
                    severity=severity,
                    message=message,
                    trigger_json=build_trigger_json(rule, matched, patient_id, admission_id, hd, d_number),
                    evidence_snippet=build_evidence_snippet(matched),
                    recommended_cta_json=build_recommended_cta_json(rule),
                    hd=hd,
                    d_number=d_number,
                    primary_datetime=latest_event.get("event_datetime"),
                )

                skip, reason = should_skip_by_dedup(
                    existing_by_patient,
                    candidate,
                    dedup_config,
                    disable_rate_limit=disable_rate_limit,
                )
                if skip:
                    skip_stats[reason] += 1
                    continue

                candidates.append(candidate)
                existing_by_patient.setdefault(patient_id, []).append(
                    {
                        "alert_type": candidate.alert_type,
                        "severity": candidate.severity,
                        "created_at": datetime.now(),
                        "hd": candidate.hd,
                    }
                )
        # Step 2: ACTION rules on remaining events grouped by HD/D
        remaining = [e for e in patient_events if e.get("event_id") not in consumed_ids]
        grouped = group_events_for_action(remaining)
        for (admission_id, hd, d_number), group_events in grouped.items():
            for rule in action_rules:
                ok, matched = evaluate_rule(rule, group_events)
                if not ok or not matched:
                    continue
                matched = dedup_events(matched)
                if not matched:
                    continue
                consumed_ids.update(e.get("event_id") for e in matched if e.get("event_id") is not None)

                merge = bool(rule.get("merge", False))
                payload_events = matched if merge else [matched[0]]
                latest_event = max(
                    payload_events,
                    key=_event_sort_key,
                )
                severity = normalize_severity(rule.get("severity"))
                message = _truncate(str(rule.get("description") or rule.get("alert_type") or ""), 500)

                candidate = EngineCandidate(
                    admission_id=admission_id,
                    patient_id=patient_id,
                    alert_type=str(rule.get("alert_type")),
                    severity=severity,
                    message=message,
                    trigger_json=build_trigger_json(
                        rule, payload_events, patient_id, admission_id, hd, d_number
                    ),
                    evidence_snippet=build_evidence_snippet(payload_events),
                    recommended_cta_json=build_recommended_cta_json(rule),
                    hd=hd,
                    d_number=d_number,
                    primary_datetime=latest_event.get("event_datetime"),
                )

                skip, reason = should_skip_by_dedup(
                    existing_by_patient,
                    candidate,
                    dedup_config,
                    disable_rate_limit=disable_rate_limit,
                )
                if skip:
                    skip_stats[reason] += 1
                    continue

                candidates.append(candidate)
                existing_by_patient.setdefault(patient_id, []).append(
                    {
                        "alert_type": candidate.alert_type,
                        "severity": candidate.severity,
                        "created_at": datetime.now(),
                        "hd": candidate.hd,
                    }
                )

        # Step 3: INFO rules on remaining events grouped by HD/D
        if info_rules:
            remaining_for_info = [e for e in patient_events if e.get("event_id") not in consumed_ids]
            grouped_for_info = group_events_for_action(remaining_for_info)
            for (admission_id, hd, d_number), group_events in grouped_for_info.items():
                for rule in info_rules:
                    ok, matched = evaluate_rule(rule, group_events)
                    if not ok or not matched:
                        continue
                    matched = dedup_events(matched)
                    if not matched:
                        continue

                    merge = bool(rule.get("merge", False))
                    payload_events = matched if merge else [matched[0]]
                    latest_event = max(
                        payload_events,
                        key=_event_sort_key,
                    )
                    severity = normalize_severity(rule.get("severity"))
                    message = _truncate(str(rule.get("description") or rule.get("alert_type") or ""), 500)

                    candidate = EngineCandidate(
                        admission_id=admission_id,
                        patient_id=patient_id,
                        alert_type=str(rule.get("alert_type")),
                        severity=severity,
                        message=message,
                        trigger_json=build_trigger_json(
                            rule, payload_events, patient_id, admission_id, hd, d_number
                        ),
                        evidence_snippet=build_evidence_snippet(payload_events),
                        recommended_cta_json=build_recommended_cta_json(rule),
                        hd=hd,
                        d_number=d_number,
                        primary_datetime=latest_event.get("event_datetime"),
                    )

                    skip, reason = should_skip_by_dedup(
                        existing_by_patient,
                        candidate,
                        dedup_config,
                        disable_rate_limit=disable_rate_limit,
                    )
                    if skip:
                        skip_stats[reason] += 1
                        continue

                    candidates.append(candidate)
                    existing_by_patient.setdefault(patient_id, []).append(
                        {
                            "alert_type": candidate.alert_type,
                            "severity": candidate.severity,
                            "created_at": datetime.now(),
                            "hd": candidate.hd,
                        }
                    )

    return candidates, dict(skip_stats)


def insert_candidates(conn: "oracledb.Connection", candidates: list[EngineCandidate]) -> int:
    if not candidates:
        return 0

    sql = """
        INSERT INTO alerts (
            admission_id,
            patient_id,
            d_number,
            alert_type,
            severity,
            is_critical,
            message,
            trigger_json,
            evidence_snippet,
            recommended_cta_json,
            status
        ) VALUES (
            :admission_id,
            :patient_id,
            :d_number,
            :alert_type,
            :severity,
            :is_critical,
            :message,
            :trigger_json,
            :evidence_snippet,
            :recommended_cta_json,
            'ACTIVE'
        )
    """

    binds = [
        {
            "admission_id": c.admission_id,
            "patient_id": c.patient_id,
            "d_number": c.d_number,
            "alert_type": c.alert_type,
            "severity": c.severity,
            "is_critical": 1 if c.severity == "CRITICAL" else 0,
            "message": c.message,
            "trigger_json": c.trigger_json,
            "evidence_snippet": _truncate(c.evidence_snippet, 1000),
            "recommended_cta_json": c.recommended_cta_json,
        }
        for c in candidates
    ]

    with conn.cursor() as cur:
        cur.executemany(sql, binds)
    conn.commit()
    return len(candidates)


def resolve_isolation_alerts(
    conn: "oracledb.Connection",
    write_mode: bool,
) -> int:
    sql = """
        SELECT
            al.alert_id,
            al.admission_id,
            al.patient_id,
            ps.isolation_required,
            ps.current_bed_id,
            b.bed_id,
            bs.current_admission_id,
            bs.status,
            r.is_isolation,
            w.is_isolation_ward
        FROM alerts al
        LEFT JOIN patient_status ps
          ON (
            (al.admission_id IS NOT NULL AND ps.admission_id = al.admission_id)
            OR (al.admission_id IS NULL AND ps.patient_id = al.patient_id)
          )
        LEFT JOIN beds b
          ON b.bed_id = ps.current_bed_id
        LEFT JOIN bed_status bs
          ON bs.bed_id = b.bed_id
        LEFT JOIN rooms r
          ON r.room_id = b.room_id
        LEFT JOIN wards w
          ON w.ward_id = r.ward_id
        WHERE al.alert_type = 'ISOLATION'
          AND al.status IN ('ACTIVE', 'ACKNOWLEDGED')
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    resolved_ids: list[int] = []
    for row in rows:
        alert_id = int(row[0])
        admission_id = row[1]
        isolation_required = _to_float(row[3])
        current_bed_id = row[4]
        bed_id = row[5]
        bs_current_admission = row[6]
        bed_status = str(row[7] or "").strip().upper()
        room_isolation = int(_to_float(row[8]) or 0)
        ward_isolation = int(_to_float(row[9]) or 0)

        # If isolation requirement is no longer active, resolve stale gap alerts.
        if isolation_required == 0:
            resolved_ids.append(alert_id)
            continue

        if not current_bed_id or not bed_id:
            continue
        if not (room_isolation == 1 or ward_isolation == 1):
            continue
        if (
            admission_id is not None
            and bs_current_admission is not None
            and int(bs_current_admission) != int(admission_id)
        ):
            continue
        if bed_status and bed_status not in ("OCCUPIED", "RESERVED"):
            continue

        resolved_ids.append(alert_id)

    if not write_mode or not resolved_ids:
        return len(resolved_ids)

    updated = 0
    for idx in range(0, len(resolved_ids), 900):
        chunk = resolved_ids[idx : idx + 900]
        placeholders, binds = _build_in_clause(chunk, "r")
        update_sql = f"""
            UPDATE alerts
            SET status = 'RESOLVED',
                resolved_at = NVL(resolved_at, SYSTIMESTAMP)
            WHERE alert_id IN ({placeholders})
              AND status IN ('ACTIVE', 'ACKNOWLEDGED')
        """
        with conn.cursor() as cur:
            cur.execute(update_sql, binds)
            updated += int(cur.rowcount or 0)
    conn.commit()
    return updated


def print_summary(
    events: list[dict[str, Any]],
    candidates: list[EngineCandidate],
    skip_stats: dict[str, int],
    write_mode: bool,
    disable_rate_limit: bool,
) -> None:
    print("=" * 72)
    print("Alert Fusion Engine")
    print("=" * 72)
    print(f"events loaded:        {len(events)}")
    print(f"alerts generated:     {len(candidates)}")
    print(f"mode:                 {'WRITE' if write_mode else 'DRY-RUN'}")
    print(
        f"rate-limit:           {'DISABLED' if disable_rate_limit else 'ENABLED'}"
    )
    if skip_stats:
        print(f"skipped by dedup:     {sum(skip_stats.values())} ({skip_stats})")

    if candidates:
        by_type = Counter(c.alert_type for c in candidates)
        by_sev = Counter(c.severity for c in candidates)
        print(f"by severity:          {dict(by_sev)}")
        print(f"by alert_type:        {dict(by_type)}")
        print("-" * 72)
        for idx, c in enumerate(candidates[:10], start=1):
            print(
                f"{idx:02d}. [{c.severity}] {c.alert_type} "
                f"patient={c.patient_id} hd={c.hd} d={c.d_number} | {c.message}"
            )
        if len(candidates) > 10:
            print(f"... and {len(candidates) - 10} more")
    print("=" * 72)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Alert Fusion Engine")
    parser.add_argument(
        "--rules",
        default=str(DEFAULT_RULES_PATH),
        help="Path to alert rules file (JSON-compatible YAML)",
    )
    parser.add_argument(
        "--from-datetime",
        default=None,
        help="Only process trajectory_events at/after this ISO datetime",
    )
    parser.add_argument(
        "--patient-id",
        default=None,
        help="Process only one patient_id",
    )
    parser.add_argument(
        "--limit-patients",
        type=int,
        default=None,
        help="Limit patient count after loading events (debug)",
    )
    parser.set_defaults(write=True)
    parser.add_argument(
        "--write",
        dest="write",
        action="store_true",
        help="Persist INSERT into alerts (default)",
    )
    parser.add_argument(
        "--dry-run",
        dest="write",
        action="store_false",
        help="Do not mutate alerts; print summary only",
    )
    parser.add_argument(
        "--disable-rate-limit",
        action="store_true",
        help="Disable time-based rate-limit dedup (same-HD dedup still applies)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _maybe_load_env()
    _init_oracle_client()

    rules_path = Path(args.rules).resolve()
    if not rules_path.exists():
        print(f"rules file not found: {rules_path}")
        return 1

    from_datetime = parse_iso_datetime(args.from_datetime)
    if args.from_datetime and from_datetime is None:
        print(f"invalid --from-datetime: {args.from_datetime}")
        return 1

    rules_payload = load_rules(rules_path)

    conn = connect()
    try:
        events = fetch_events(conn, from_datetime=from_datetime, patient_id=args.patient_id)
        if not events:
            print("no trajectory_events found for requested scope")
            return 0

        if args.limit_patients and args.limit_patients > 0:
            limited_ids = sorted({str(e["patient_id"]) for e in events})[: args.limit_patients]
            limited_set = set(limited_ids)
            events = [e for e in events if str(e["patient_id"]) in limited_set]

        scoped_admission_ids = sorted(
            {
                int(event["admission_id"])
                for event in events
                if event.get("admission_id") is not None
            }
        )
        mdro_sync_stats = sync_confirmed_mdro_to_infection_diagnoses(
            conn,
            scoped_admission_ids,
            write_mode=args.write,
        )

        events, runtime_stats = augment_runtime_events(conn, events)

        patient_ids = sorted({str(e["patient_id"]) for e in events})
        existing_by_patient = fetch_existing_alerts(conn, patient_ids)
        candidates, skip_stats = build_candidates(
            events,
            rules_payload,
            existing_by_patient,
            disable_rate_limit=args.disable_rate_limit,
        )

        print_summary(
            events,
            candidates,
            skip_stats,
            write_mode=args.write,
            disable_rate_limit=args.disable_rate_limit,
        )
        if runtime_stats:
            print(f"runtime events added:  {runtime_stats.get('runtime_added', 0)} {runtime_stats}")
        if mdro_sync_stats:
            print(f"infection_diagnoses sync: {mdro_sync_stats}")

        if args.write:
            inserted = insert_candidates(conn, candidates)
            print(f"inserted rows:         {inserted}")
            resolved = resolve_isolation_alerts(conn, write_mode=True)
            print(f"isolation resolved:    {resolved}")
        else:
            resolved = resolve_isolation_alerts(conn, write_mode=False)
            print(f"isolation resolve dry: {resolved}")
            print("dry-run complete (no DB mutation)")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
