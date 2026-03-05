const express = require("express");
const oracledb = require("oracledb");
const db = require("../db");
const { getShiftOrder } = require("../helpers/demo-filter");

const router = express.Router();

const SUPPORTED_CHECKLIST_TYPES = new Set(["MDRO", "GI_WATERBORNE", "RESP_ISOLATION"]);
const SUPPORTED_ACTIONS = new Set([
  "check",
  "uncheck",
  "select_option",
  "unselect_option",
  "select_risk_group",
  "unselect_risk_group",
  "select_alternative",
  "unselect_alternative",
  "clear_all",
  "update_note",
  "apply_isolation",
  "unapply_isolation",
  "set_applied_status",
  "apply_recommended_markers",
  "snapshot_save",
]);

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const MAX_SCAN_ROWS = 5000;
const DEFAULT_GAP_THRESHOLD_HOURS = 4;

function asNonEmptyString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeChecklistType(rawType, fallback = null) {
  const raw = asNonEmptyString(rawType);
  if (!raw) return fallback;
  const normalized = raw.toUpperCase();
  if (normalized === "RESP_INFECTIOUS") return "RESP_ISOLATION";
  if (SUPPORTED_CHECKLIST_TYPES.has(normalized)) return normalized;
  return fallback;
}

function normalizeMode(rawMode, fallback = "suspected") {
  const mode = asNonEmptyString(rawMode)?.toLowerCase();
  if (mode === "confirmed") return "confirmed";
  if (mode === "suspected") return "suspected";
  return fallback;
}

function normalizeDemoShift(rawShift) {
  const shift = asNonEmptyString(rawShift);
  if (!shift) return null;
  const lowered = shift.toLowerCase();
  if (lowered === "day") return "Day";
  if (lowered === "evening") return "Evening";
  if (lowered === "night") return "Night";
  return null;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseLimit(value) {
  const parsed = parsePositiveInt(value);
  if (parsed == null) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function parseThresholdHours(value) {
  const parsed = Number.parseFloat(String(value ?? DEFAULT_GAP_THRESHOLD_HOURS));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_GAP_THRESHOLD_HOURS;
  return parsed;
}

function parseDate(value) {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIso(value, fallbackIso = null) {
  if (!value) return fallbackIso;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackIso;
  return date.toISOString();
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const normalized = tags
    .map((item) => asNonEmptyString(item))
    .filter((item) => item != null);
  return [...new Set(normalized)];
}

function normalizeDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return details;
}

function isTruthyBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function safeJsonParseObject(value, fallback = {}) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    return fallback;
  } catch {
    return fallback;
  }
}

function safeJsonParseArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeTags(parsed) : [];
  } catch {
    return [];
  }
}

function parseDemoStepWithMax(rawStep, maxStep) {
  const step = parsePositiveInt(rawStep);
  if (step == null) return null;
  if (Number.isFinite(maxStep) && step > maxStep) return null;
  return step;
}

function resolveDemoContext(req, body = {}) {
  const fallbackStep = parseDemoStepWithMax(body.demoStep, req.demoMaxStep);
  const fallbackShift = normalizeDemoShift(body.demoShift);

  const demoStep = req.demoStep ?? fallbackStep;
  const demoShift = demoStep != null ? (req.demoShift ?? fallbackShift) : null;
  const demoShiftOrder = demoStep != null ? getShiftOrder(demoShift) : null;

  return {
    demoStep: demoStep ?? null,
    demoShift: demoShift ?? null,
    demoShiftOrder: demoShiftOrder ?? null,
  };
}

function getLogTimestampMs(log) {
  const ts = new Date(log?.timestamp || log?.created_at || 0).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function guessTags(action, candidateTags) {
  if (candidateTags.length > 0) return candidateTags;
  if (action === "select_alternative" || action === "unselect_alternative") return ["alternative"];
  if (
    action === "set_applied_status" ||
    action === "apply_isolation" ||
    action === "unapply_isolation" ||
    action === "check" ||
    action === "uncheck" ||
    action === "select_option" ||
    action === "unselect_option" ||
    action === "select_risk_group" ||
    action === "unselect_risk_group"
  ) {
    return ["isolation"];
  }
  if (action === "clear_all" || action === "update_note") return ["admin"];
  return [];
}

function toChecklistLogSummary(row) {
  const payload = safeJsonParseObject(row.CHECKLIST_PAYLOAD, {});
  const action = asNonEmptyString(row.EVENT_ACTION) || asNonEmptyString(payload.action) || "snapshot_save";

  const tagsFromColumn = safeJsonParseArray(row.TAGS_JSON);
  const payloadTags = normalizeTags(payload.tags);
  const tags = tagsFromColumn.length > 0 ? tagsFromColumn : guessTags(action, payloadTags);

  const detailsFromColumn = safeJsonParseObject(row.DETAILS_JSON, {});
  const payloadDetails = normalizeDetails(payload.details) || {};
  const details = Object.keys(detailsFromColumn).length > 0 ? detailsFromColumn : payloadDetails;

  const checklistType = normalizeChecklistType(
    row.CHECKLIST_TYPE || row.INFECTION_TYPE || payload.checklist_type || payload.infection_type,
    "MDRO",
  );
  const infectionType = normalizeChecklistType(
    row.INFECTION_TYPE || row.CHECKLIST_TYPE || payload.infection_type || payload.checklist_type,
    checklistType,
  );
  const mode = normalizeMode(row.CHECKLIST_MODE || row.STAGE || payload.mode, "suspected");
  const subtype =
    asNonEmptyString(row.CHECKLIST_SUBTYPE) ||
    asNonEmptyString(row.MDRO_TYPE) ||
    asNonEmptyString(payload.subtype) ||
    undefined;

  const createdAt = toIso(row.CREATED_AT, new Date().toISOString());
  const timestamp = toIso(row.EVENT_TS || payload.timestamp || row.CREATED_AT, createdAt);

  return {
    id: String(row.LOG_ID),
    patient_id: String(row.PATIENT_ID),
    patient_name: asNonEmptyString(row.PATIENT_NAME) || undefined,
    checklist_type: checklistType,
    infection_type: infectionType,
    mode,
    subtype,
    changed_item_id:
      asNonEmptyString(row.CHANGED_ITEM_ID) || asNonEmptyString(payload.changed_item_id) || undefined,
    changed_item_label:
      asNonEmptyString(row.CHANGED_ITEM_LABEL) ||
      asNonEmptyString(payload.changed_item_label) ||
      undefined,
    action,
    actor_role: asNonEmptyString(row.ACTOR_ROLE) || asNonEmptyString(payload.actor_role) || "간호사",
    actor_name:
      asNonEmptyString(row.ACTOR_NAME) ||
      asNonEmptyString(row.CREATED_BY) ||
      asNonEmptyString(payload.actor_name) ||
      undefined,
    reason:
      asNonEmptyString(row.EVENT_REASON) ||
      asNonEmptyString(row.NOTES) ||
      asNonEmptyString(payload.reason) ||
      undefined,
    tags,
    details,
    created_at: createdAt,
    timestamp,
    demo_step: row.DEMO_STEP == null ? null : Number(row.DEMO_STEP),
    demo_shift: asNonEmptyString(row.DEMO_SHIFT) || null,
  };
}

function buildWhereClause(filters) {
  const where = [];
  const binds = {};

  if (filters.patientId) {
    where.push("patient_id = :patientId");
    binds.patientId = filters.patientId;
  }
  if (filters.checklistType) {
    where.push("NVL(checklist_type, 'MDRO') = :checklistType");
    binds.checklistType = filters.checklistType;
  }
  if (filters.infectionType) {
    where.push("NVL(infection_type, NVL(checklist_type, 'MDRO')) = :infectionType");
    binds.infectionType = filters.infectionType;
  }
  if (!filters.checklistType && !filters.infectionType) {
    where.push("NVL(checklist_type, 'MDRO') IN ('MDRO', 'GI_WATERBORNE', 'RESP_ISOLATION')");
  }
  if (filters.dateFrom) {
    where.push("NVL(event_ts, created_at) >= :dateFrom");
    binds.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    where.push("NVL(event_ts, created_at) <= :dateTo");
    binds.dateTo = filters.dateTo;
  }
  if (filters.demoStep != null) {
    where.push("demo_step IS NOT NULL");
    binds.demoStep = filters.demoStep;
    binds.demoShiftOrder = filters.demoShiftOrder;
    if (filters.startDemoStep != null) {
      where.push("demo_step >= :startDemoStep");
      binds.startDemoStep = filters.startDemoStep;
    }
    where.push(
      "(demo_step < :demoStep OR (demo_step = :demoStep AND (:demoShiftOrder IS NULL OR NVL(demo_shift_order, 99) <= :demoShiftOrder)))",
    );
  }

  const sql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  return { sql, binds };
}

async function fetchLogRows(filters) {
  const { sql: whereSql, binds } = buildWhereClause(filters);
  binds.maxRows = filters.maxRows ?? MAX_SCAN_ROWS;

  const query = `
    SELECT * FROM (
      SELECT
        log_id,
        patient_id,
        patient_name,
        stage,
        mdro_type,
        created_by,
        completed,
        notes,
        checklist_payload,
        created_at,
        checklist_type,
        infection_type,
        checklist_mode,
        checklist_subtype,
        event_action,
        changed_item_id,
        changed_item_label,
        actor_role,
        actor_name,
        event_reason,
        tags_json,
        details_json,
        event_ts,
        demo_step,
        demo_shift,
        demo_shift_order,
        ROW_NUMBER() OVER (ORDER BY NVL(event_ts, created_at) DESC, log_id DESC) AS rn
      FROM mdro_checklist_logs
      ${whereSql}
    )
    WHERE rn <= :maxRows
    ORDER BY rn
  `;

  const result = await db.execute(query, binds);
  return result.rows || [];
}

function filterByCategory(logs, category) {
  const normalized = asNonEmptyString(category)?.toLowerCase();
  if (!normalized || normalized === "all") return logs;
  return logs.filter((log) => log.tags.includes(normalized));
}

function roundTo2(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function isGapStartLog(log) {
  if (log.action === "unapply_isolation") return true;
  if (log.action === "set_applied_status") {
    return isTruthyBoolean(log.details?.next_applied) === false;
  }
  return false;
}

function isGapEndLog(log) {
  if (log.action === "apply_isolation") return true;
  if (log.action === "set_applied_status") {
    return isTruthyBoolean(log.details?.next_applied) === true;
  }
  return false;
}

function getGapStartIso(log, nowIso) {
  const detailIso = asNonEmptyString(log.details?.gap_started_at);
  if (detailIso) return toIso(detailIso, nowIso);
  return toIso(log.timestamp || log.created_at, nowIso);
}

function buildGapMetrics(logs, thresholdHours, nowIso) {
  const nowMs = new Date(nowIso).getTime();
  const activeByPatient = new Map();
  const cases = [];

  const ordered = [...logs].sort((a, b) => getLogTimestampMs(a) - getLogTimestampMs(b));

  for (const log of ordered) {
    const patientId = asNonEmptyString(log.patient_id);
    if (!patientId) continue;

    if (isGapStartLog(log)) {
      activeByPatient.set(patientId, {
        patient_id: patientId,
        patient_name: log.patient_name,
        checklist_type: log.checklist_type || "MDRO",
        infection_type: log.infection_type || log.checklist_type || "MDRO",
        started_at: getGapStartIso(log, nowIso),
        start_log_id: log.id,
      });
      continue;
    }

    if (!isGapEndLog(log)) continue;
    const activeCase = activeByPatient.get(patientId);
    if (!activeCase) continue;

    const endedAt = toIso(log.timestamp || log.created_at, nowIso);
    const durationHours = Math.max(
      0,
      (new Date(endedAt).getTime() - new Date(activeCase.started_at).getTime()) / 3600000,
    );

    cases.push({
      ...activeCase,
      ended_at: endedAt,
      end_log_id: log.id,
      status: "closed",
      duration_hours: roundTo2(durationHours),
    });
    activeByPatient.delete(patientId);
  }

  for (const activeCase of activeByPatient.values()) {
    const durationHours = Math.max(
      0,
      (nowMs - new Date(activeCase.started_at).getTime()) / 3600000,
    );
    cases.push({
      ...activeCase,
      ended_at: null,
      end_log_id: null,
      status: "open",
      duration_hours: roundTo2(durationHours),
    });
  }

  const durations = cases.map((entry) => entry.duration_hours);
  const totalCases = cases.length;
  const openCases = cases.filter((entry) => entry.status === "open").length;
  const closedCases = totalCases - openCases;
  const thresholdExceededCount = cases.filter(
    (entry) => entry.duration_hours >= thresholdHours,
  ).length;
  const avgGapHours = totalCases > 0
    ? durations.reduce((sum, value) => sum + value, 0) / totalCases
    : 0;

  return {
    total_cases: totalCases,
    open_cases: openCases,
    closed_cases: closedCases,
    avg_gap_hours: roundTo2(avgGapHours),
    median_gap_hours: roundTo2(median(durations)),
    max_gap_hours: totalCases > 0 ? roundTo2(Math.max(...durations)) : 0,
    threshold_exceeded_count: thresholdExceededCount,
    threshold_exceeded_ratio: totalCases > 0 ? roundTo2(thresholdExceededCount / totalCases) : 0,
    cases: cases.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()),
  };
}

function extractOutBindValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

router.post("/logs", async (req, res) => {
  try {
    const body = req.body ?? {};
    const patientId = asNonEmptyString(body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: "patient_id is required" });
    }

    const action = asNonEmptyString(body.action);
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }
    if (!SUPPORTED_ACTIONS.has(action)) {
      return res.status(400).json({ error: "unsupported action" });
    }
    if ((action === "clear_all" || action === "unapply_isolation") && !asNonEmptyString(body.reason)) {
      return res.status(400).json({ error: `${action} action requires reason` });
    }

    const checklistType = normalizeChecklistType(
      body.checklist_type || body.infection_type,
      "MDRO",
    );
    const infectionType = normalizeChecklistType(
      body.infection_type || body.checklist_type,
      checklistType,
    );
    const mode = normalizeMode(body.mode || body.stage, "suspected");
    const subtype = asNonEmptyString(body.subtype) || asNonEmptyString(body.mdro_type);
    const actorRole = asNonEmptyString(body.actor_role) || "간호사";
    const actorName = asNonEmptyString(body.actor_name) || asNonEmptyString(body.created_by);
    const reason = asNonEmptyString(body.reason);
    const notes = asNonEmptyString(body.notes) || reason;
    const tags = normalizeTags(body.tags);
    const details = normalizeDetails(body.details) || {};
    const nowIso = new Date().toISOString();
    const timestampIso = toIso(body.timestamp, nowIso);
    const createdAt = new Date(nowIso);
    const eventTs = new Date(timestampIso);
    const demo = resolveDemoContext(req, body);

    const payload = {
      patient_id: patientId,
      patient_name: asNonEmptyString(body.patient_name),
      checklist_type: checklistType,
      infection_type: infectionType,
      mode,
      subtype,
      changed_item_id: asNonEmptyString(body.changed_item_id),
      changed_item_label: asNonEmptyString(body.changed_item_label),
      action,
      actor_role: actorRole,
      actor_name: actorName,
      reason,
      tags,
      details,
      timestamp: timestampIso,
      demo_step: demo.demoStep,
      demo_shift: demo.demoShift,
    };

    const sql = `
      INSERT INTO mdro_checklist_logs (
        patient_id,
        patient_name,
        stage,
        mdro_type,
        created_by,
        completed,
        notes,
        checklist_payload,
        created_at,
        checklist_type,
        infection_type,
        checklist_mode,
        checklist_subtype,
        event_action,
        changed_item_id,
        changed_item_label,
        actor_role,
        actor_name,
        event_reason,
        tags_json,
        details_json,
        event_ts,
        demo_step,
        demo_shift,
        demo_shift_order
      ) VALUES (
        :patientId,
        :patientName,
        :stage,
        :mdroType,
        :createdBy,
        :completed,
        :notes,
        :checklistPayload,
        :createdAt,
        :checklistType,
        :infectionType,
        :checklistMode,
        :checklistSubtype,
        :eventAction,
        :changedItemId,
        :changedItemLabel,
        :actorRole,
        :actorName,
        :eventReason,
        :tagsJson,
        :detailsJson,
        :eventTs,
        :demoStep,
        :demoShift,
        :demoShiftOrder
      )
      RETURNING log_id INTO :outLogId
    `;

    const insertResult = await db.execute(sql, {
      patientId,
      patientName: asNonEmptyString(body.patient_name),
      stage: mode,
      mdroType: subtype,
      createdBy: actorName,
      completed: isTruthyBoolean(body.completed) ? 1 : 0,
      notes,
      checklistPayload: JSON.stringify(payload),
      createdAt,
      checklistType,
      infectionType,
      checklistMode: mode,
      checklistSubtype: subtype,
      eventAction: action,
      changedItemId: asNonEmptyString(body.changed_item_id),
      changedItemLabel: asNonEmptyString(body.changed_item_label),
      actorRole,
      actorName,
      eventReason: reason,
      tagsJson: JSON.stringify(tags),
      detailsJson: JSON.stringify(details),
      eventTs,
      demoStep: demo.demoStep,
      demoShift: demo.demoShift,
      demoShiftOrder: demo.demoShiftOrder,
      outLogId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    });

    const logId = Number(extractOutBindValue(insertResult.outBinds?.outLogId));
    const summary = toChecklistLogSummary({
      LOG_ID: logId,
      PATIENT_ID: patientId,
      PATIENT_NAME: asNonEmptyString(body.patient_name),
      STAGE: mode,
      MDRO_TYPE: subtype,
      CREATED_BY: actorName,
      NOTES: notes,
      CHECKLIST_PAYLOAD: JSON.stringify(payload),
      CREATED_AT: createdAt,
      CHECKLIST_TYPE: checklistType,
      INFECTION_TYPE: infectionType,
      CHECKLIST_MODE: mode,
      CHECKLIST_SUBTYPE: subtype,
      EVENT_ACTION: action,
      CHANGED_ITEM_ID: asNonEmptyString(body.changed_item_id),
      CHANGED_ITEM_LABEL: asNonEmptyString(body.changed_item_label),
      ACTOR_ROLE: actorRole,
      ACTOR_NAME: actorName,
      EVENT_REASON: reason,
      TAGS_JSON: JSON.stringify(tags),
      DETAILS_JSON: JSON.stringify(details),
      EVENT_TS: eventTs,
      DEMO_STEP: demo.demoStep,
      DEMO_SHIFT: demo.demoShift,
      DEMO_SHIFT_ORDER: demo.demoShiftOrder,
    });

    return res.status(201).json(summary);
  } catch (error) {
    console.error("POST /api/nlp/mdro/checklists/logs error:", error);
    return res.status(500).json({ error: "Failed to create checklist log" });
  }
});

router.get("/logs", async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const patientId = asNonEmptyString(req.query.patient_id);
    const checklistType = normalizeChecklistType(req.query.checklist_type, null);
    const infectionType = normalizeChecklistType(req.query.infection_type, null);
    const category = asNonEmptyString(req.query.category);
    const dateFrom = parseDate(req.query.date_from);
    const dateTo = parseDate(req.query.date_to);
    const demo = resolveDemoContext(req);

    const rows = await fetchLogRows({
      patientId,
      checklistType,
      infectionType,
      dateFrom,
      dateTo,
      demoStep: demo.demoStep,
      demoShiftOrder: demo.demoShiftOrder,
      maxRows: MAX_SCAN_ROWS,
    });

    let logs = rows.map(toChecklistLogSummary);
    logs = filterByCategory(logs, category);
    logs.sort((a, b) => getLogTimestampMs(b) - getLogTimestampMs(a));

    return res.json({
      total: logs.length,
      logs: logs.slice(0, limit),
    });
  } catch (error) {
    console.error("GET /api/nlp/mdro/checklists/logs error:", error);
    return res.status(500).json({ error: "Failed to fetch checklist logs" });
  }
});

router.get("/gap-metrics", async (req, res) => {
  try {
    const thresholdHours = parseThresholdHours(req.query.threshold_hours);
    const includeCases = isTruthyBoolean(req.query.include_cases);
    const days = parsePositiveInt(req.query.days);
    const patientId = asNonEmptyString(req.query.patient_id);
    const checklistType = normalizeChecklistType(req.query.checklist_type, null);
    const infectionType = normalizeChecklistType(req.query.infection_type, null);
    const category = asNonEmptyString(req.query.category);
    const demo = resolveDemoContext(req);

    let dateFrom = parseDate(req.query.date_from);
    let dateTo = parseDate(req.query.date_to);
    let startDemoStep = null;

    if (days != null) {
      if (demo.demoStep != null) {
        startDemoStep = Math.max(1, demo.demoStep - days + 1);
      } else if (!dateFrom && !dateTo) {
        dateTo = new Date();
        dateFrom = new Date(dateTo.getTime() - days * 24 * 60 * 60 * 1000);
      }
    }

    const nowIso = new Date().toISOString();
    const rows = await fetchLogRows({
      patientId,
      checklistType,
      infectionType,
      dateFrom,
      dateTo,
      demoStep: demo.demoStep,
      demoShiftOrder: demo.demoShiftOrder,
      startDemoStep,
      maxRows: MAX_SCAN_ROWS,
    });

    let logs = rows.map(toChecklistLogSummary);
    logs = filterByCategory(logs, category);
    const metrics = buildGapMetrics(logs, thresholdHours, nowIso);

    return res.json({
      generated_at: nowIso,
      threshold_hours: thresholdHours,
      total_logs: logs.length,
      total_cases: metrics.total_cases,
      open_cases: metrics.open_cases,
      closed_cases: metrics.closed_cases,
      avg_gap_hours: metrics.avg_gap_hours,
      median_gap_hours: metrics.median_gap_hours,
      max_gap_hours: metrics.max_gap_hours,
      threshold_exceeded_count: metrics.threshold_exceeded_count,
      threshold_exceeded_ratio: metrics.threshold_exceeded_ratio,
      cases: includeCases ? metrics.cases : undefined,
    });
  } catch (error) {
    console.error("GET /api/nlp/mdro/checklists/gap-metrics error:", error);
    return res.status(500).json({ error: "Failed to fetch gap metrics" });
  }
});

module.exports = router;
