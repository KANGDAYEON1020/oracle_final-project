// routes/alerts.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const router = express.Router();
const db = require("../db");
const { getShiftOrder } = require("../helpers/demo-filter");

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(__dirname, "../..");

const VALID_STATUSES = new Set(["ACTIVE", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"]);
const DEFAULT_STATUS_FILTER = ["ACTIVE"];
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MIN_SNOOZE_MINUTES = 1;
const MAX_SNOOZE_MINUTES = 24 * 60;

function parseBooleanFlag(value, fallback = true) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function tailText(text, maxChars = 1200) {
  if (!text) return "";
  const normalized = String(text).trim();
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(-maxChars);
}

async function runSnapshotRestoreScriptIfEnabled(req) {
  const shouldRestoreSnapshot = parseBooleanFlag(
    req.query.restoreSnapshot ?? process.env.DEMO_RESET_RESTORE_SNAPSHOT,
    true
  );

  if (!shouldRestoreSnapshot) {
    return {
      enabled: false,
      skipped: true,
      reason: "restoreSnapshot disabled",
    };
  }

  const scriptSetting =
    process.env.DEMO_RESET_SNAPSHOT_SCRIPT || "data/scripts/08_load_synthetic_extensions.py";
  const scriptPath = path.isAbsolute(scriptSetting)
    ? scriptSetting
    : path.resolve(ROOT_DIR, scriptSetting);
  if (!fs.existsSync(scriptPath)) {
    const error = new Error(`Snapshot restore script not found: ${scriptPath}`);
    error.statusCode = 500;
    throw error;
  }

  const pythonBin = process.env.DEMO_RESET_PYTHON_BIN || "python";
  const timeoutMs = parsePositiveInt(process.env.DEMO_RESET_SNAPSHOT_TIMEOUT_MS, 180000);
  const startedAtMs = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath], {
      cwd: ROOT_DIR,
      env: process.env,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });

    return {
      enabled: true,
      skipped: false,
      scriptPath,
      pythonBin,
      durationMs: Date.now() - startedAtMs,
      stdoutTail: tailText(stdout, 400),
      stderrTail: tailText(stderr, 400),
    };
  } catch (error) {
    const code = Number.isFinite(Number(error?.code)) ? ` code=${error.code}` : "";
    const signal = error?.signal ? ` signal=${error.signal}` : "";
    const stderrTail = tailText(error?.stderr, 800);
    const stdoutTail = tailText(error?.stdout, 800);
    const details = [stderrTail, stdoutTail].filter(Boolean).join(" | ");
    const wrapped = new Error(
      `Snapshot restore failed (${pythonBin} ${scriptPath})${code}${signal}${details ? ` :: ${details}` : ""}`
    );
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

function normalizeSeverity(severity) {
  const upper = String(severity || "").toUpperCase();
  if (upper === "CRITICAL") return "CRITICAL";
  if (upper === "ACTION") return "ACTION";
  if (upper === "INFO") return "INFO";
  if (upper === "LOW" || upper === "MEDIUM" || upper === "HIGH") return "ACTION";
  return "ACTION";
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseAlertId(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseSnoozeMinutes(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_SNOOZE_MINUTES || parsed > MAX_SNOOZE_MINUTES) return null;
  return parsed;
}

function inferShiftOrderFromTimestamp(value) {
  if (!value) return 3;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 3;
  const hour = date.getHours();
  if (hour >= 6 && hour <= 13) return 1;
  if (hour >= 14 && hour <= 21) return 2;
  return 3;
}

function inferShiftOrderFromTrigger(triggerValue) {
  if (!triggerValue || typeof triggerValue !== "object") return null;
  const candidates = [
    triggerValue.shift,
    triggerValue.event_shift,
    triggerValue?.trajectory?.shift,
    triggerValue?.source?.shift,
  ];
  for (const candidate of candidates) {
    const shift = String(candidate || "").trim().toUpperCase();
    if (shift === "DAY") return 1;
    if (shift === "EVENING") return 2;
    if (shift === "NIGHT") return 3;
  }
  return null;
}

function computeDisplayCreatedAt({
  createdAt,
  dNumber,
  admissionDMin,
  admissionDemoOffset,
  demoStep,
  demoShiftOrder,
  trigger,
}) {
  const createdAtIso = toIso(createdAt);
  if (!createdAtIso) return null;

  if (demoStep == null) return createdAtIso;

  const step = toFiniteNumber(demoStep);
  const d = toFiniteNumber(dNumber);
  const dMin = toFiniteNumber(admissionDMin);
  const demoOffset = toFiniteNumber(admissionDemoOffset) ?? 0;
  if (step == null || d == null || dMin == null) return createdAtIso;

  const effectiveMaxD = dMin + (step - demoOffset - 1);
  const currentShift = toFiniteNumber(demoShiftOrder) ?? 3;
  const alertShift =
    inferShiftOrderFromTrigger(trigger) ?? inferShiftOrderFromTimestamp(createdAtIso);

  const slotDiff = (effectiveMaxD - d) * 3 + (currentShift - alertShift);
  const nowMs = Date.now();
  const displayMs = nowMs - slotDiff * 8 * 60 * 60 * 1000;
  return new Date(displayMs).toISOString();
}

function computeReferenceNow({ demoStep, demoShiftOrder, demoBaseDate }) {
  const step = toFiniteNumber(demoStep);
  if (step == null) return new Date();

  const baseDate = String(demoBaseDate || "2026-02-09").trim();
  const base = new Date(`${baseDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return new Date();

  base.setUTCDate(base.getUTCDate() + (step - 1));

  if (demoShiftOrder === 1) {
    base.setUTCHours(13, 59, 59, 999);
    return base;
  }

  if (demoShiftOrder === 2) {
    base.setUTCHours(21, 59, 59, 999);
    return base;
  }

  if (demoShiftOrder === 3) {
    base.setUTCDate(base.getUTCDate() + 1);
    base.setUTCHours(5, 59, 59, 999);
    return base;
  }

  base.setUTCHours(23, 59, 59, 999);
  return base;
}

function parseOptionalJson(raw) {
  if (raw == null) return { value: null, parseError: false };
  if (typeof raw !== "string") return { value: raw, parseError: false };
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, parseError: false };

  try {
    return { value: JSON.parse(trimmed), parseError: false };
  } catch {
    return { value: null, parseError: true };
  }
}

function parseRecommendedCta(raw) {
  const parsed = parseOptionalJson(raw);
  if (parsed.value == null) return { actions: [], parseError: parsed.parseError };
  if (Array.isArray(parsed.value)) return { actions: parsed.value, parseError: parsed.parseError };
  if (
    typeof parsed.value === "object" &&
    parsed.value !== null &&
    Array.isArray(parsed.value.actions)
  ) {
    return { actions: parsed.value.actions, parseError: parsed.parseError };
  }
  return { actions: [], parseError: parsed.parseError };
}

function parseStatusFilter(statusParam) {
  if (!statusParam || !String(statusParam).trim()) return { statuses: DEFAULT_STATUS_FILTER };

  const statuses = String(statusParam)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const uniqueStatuses = [...new Set(statuses)];
  const invalid = uniqueStatuses.filter((s) => !VALID_STATUSES.has(s));
  if (invalid.length > 0) {
    return {
      error: `Invalid status value(s): ${invalid.join(", ")}`,
      allowed: [...VALID_STATUSES],
    };
  }

  if (uniqueStatuses.length === 0) {
    return {
      error: "status must contain at least one value",
      allowed: [...VALID_STATUSES],
    };
  }

  return { statuses: uniqueStatuses };
}

function parseLimit(limitParam) {
  if (limitParam == null || String(limitParam).trim() === "") return DEFAULT_LIMIT;
  const parsed = Number.parseInt(String(limitParam), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  if (parsed > MAX_LIMIT) return MAX_LIMIT;
  return parsed;
}

function buildStatusInClause(statuses, bindPrefix = "s") {
  const binds = {};
  const placeholders = statuses.map((status, i) => {
    const key = `${bindPrefix}${i}`;
    binds[key] = status;
    return `:${key}`;
  });
  return { placeholders: placeholders.join(", "), binds };
}

// GET /api/alerts
router.get("/", async (req, res) => {
  try {
    const statusResult = parseStatusFilter(req.query.status);
    if (statusResult.error) {
      return res.status(400).json({
        error: statusResult.error,
        allowed: statusResult.allowed,
      });
    }

    const statuses = statusResult.statuses;
    const limit = parseLimit(req.query.limit);
    const demoStep = req.demoStep ?? null;
    const demoShiftOrder = getShiftOrder(req.demoShift);
    const referenceNow = computeReferenceNow({
      demoStep,
      demoShiftOrder,
      demoBaseDate: req.demoBaseDate,
    });
    const referenceNowMs = referenceNow.getTime();
    const { placeholders, binds: statusBinds } = buildStatusInClause(statuses, "st");

    const result = await db.execute(
      `
      SELECT
        al.alert_id,
        al.admission_id,
        al.patient_id,
        al.d_number,
        al.alert_type,
        al.severity,
        al.is_critical,
        al.message,
        al.trigger_json,
        al.evidence_snippet,
        al.recommended_cta_json,
        al.status,
        al.acknowledged_at,
        al.resolved_at,
        al.snoozed_until,
        al.snoozed_at,
        al.snoozed_by,
        al.created_at,
        a.d_min AS admission_d_min,
        a.demo_d_offset AS admission_demo_d_offset
      FROM alerts al
      LEFT JOIN admissions a
        ON a.admission_id = al.admission_id
      WHERE al.status IN (${placeholders})
        AND (
          :demoStep IS NULL
          OR (
            al.d_number IS NOT NULL
            AND a.admission_id IS NOT NULL
            AND :demoStep >= NVL(a.demo_d_offset, 0) + 1
            AND :demoStep <= NVL(a.demo_d_offset, 0) + NVL(a.d_length, 0)
            AND (
              al.d_number < (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
              OR (
                al.d_number = (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
                AND (
                  :demoShiftOrder IS NULL
                  OR (
                    CASE
                      WHEN UPPER(
                        NVL(
                          JSON_VALUE(al.trigger_json, '$.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                          NVL(
                            JSON_VALUE(al.trigger_json, '$.event_shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                            NVL(
                              JSON_VALUE(al.trigger_json, '$.trajectory.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                              NVL(
                                JSON_VALUE(al.trigger_json, '$.source.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                                JSON_VALUE(al.trigger_json, '$.events[0].shift' RETURNING VARCHAR2(16) NULL ON ERROR)
                              )
                            )
                          )
                        )
                      ) = 'DAY' THEN 1
                      WHEN UPPER(
                        NVL(
                          JSON_VALUE(al.trigger_json, '$.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                          NVL(
                            JSON_VALUE(al.trigger_json, '$.event_shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                            NVL(
                              JSON_VALUE(al.trigger_json, '$.trajectory.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                              NVL(
                                JSON_VALUE(al.trigger_json, '$.source.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                                JSON_VALUE(al.trigger_json, '$.events[0].shift' RETURNING VARCHAR2(16) NULL ON ERROR)
                              )
                            )
                          )
                        )
                      ) = 'EVENING' THEN 2
                      WHEN UPPER(
                        NVL(
                          JSON_VALUE(al.trigger_json, '$.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                          NVL(
                            JSON_VALUE(al.trigger_json, '$.event_shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                            NVL(
                              JSON_VALUE(al.trigger_json, '$.trajectory.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                              NVL(
                                JSON_VALUE(al.trigger_json, '$.source.shift' RETURNING VARCHAR2(16) NULL ON ERROR),
                                JSON_VALUE(al.trigger_json, '$.events[0].shift' RETURNING VARCHAR2(16) NULL ON ERROR)
                              )
                            )
                          )
                        )
                      ) = 'NIGHT' THEN 3
                      ELSE CASE
                             WHEN EXTRACT(HOUR FROM CAST(NVL(al.created_at, SYSTIMESTAMP) AS TIMESTAMP)) BETWEEN 6 AND 13 THEN 1
                             WHEN EXTRACT(HOUR FROM CAST(NVL(al.created_at, SYSTIMESTAMP) AS TIMESTAMP)) BETWEEN 14 AND 21 THEN 2
                             ELSE 3
                           END
                    END <= :demoShiftOrder
                  )
                )
              )
            )
          )
        )
      ORDER BY al.created_at DESC, al.alert_id DESC
      FETCH FIRST :lim ROWS ONLY
      `,
      {
        ...statusBinds,
        demoStep,
        demoShiftOrder,
        lim: limit,
      }
    );

    const data = result.rows.map((row) => {
      const severityNormalized = normalizeSeverity(row.SEVERITY);
      const triggerParsed = parseOptionalJson(row.TRIGGER_JSON);
      const ctaParsed = parseRecommendedCta(row.RECOMMENDED_CTA_JSON);
      const isCritical = row.IS_CRITICAL === 1 || severityNormalized === "CRITICAL";
      const createdAtIso = toIso(row.CREATED_AT);
      const displayCreatedAt = computeDisplayCreatedAt({
        createdAt: row.CREATED_AT,
        dNumber: row.D_NUMBER,
        admissionDMin: row.ADMISSION_D_MIN,
        admissionDemoOffset: row.ADMISSION_DEMO_D_OFFSET,
        demoStep,
        demoShiftOrder,
        trigger: triggerParsed.value,
      });
      const snoozedUntil = toIso(row.SNOOZED_UNTIL);
      const isSnoozed =
        snoozedUntil != null && !Number.isNaN(new Date(snoozedUntil).getTime())
          ? new Date(snoozedUntil).getTime() > referenceNowMs
          : false;

      return {
        alertId: row.ALERT_ID,
        legacyId: `notif-${row.ALERT_ID}`,
        patientId: row.PATIENT_ID ?? null,
        admissionId: row.ADMISSION_ID ?? null,
        alertType: row.ALERT_TYPE,
        type: String(row.ALERT_TYPE || "").toLowerCase(),
        severity: row.SEVERITY,
        severityNormalized,
        isCritical,
        message: row.MESSAGE ?? null,
        status: row.STATUS,
        createdAt: createdAtIso,
        displayCreatedAt,
        acknowledgedAt: toIso(row.ACKNOWLEDGED_AT),
        resolvedAt: toIso(row.RESOLVED_AT),
        snoozedUntil,
        snoozedAt: toIso(row.SNOOZED_AT),
        snoozedBy: row.SNOOZED_BY ?? null,
        isSnoozed,
        evidenceSnippet: row.EVIDENCE_SNIPPET ?? null,
        trigger: triggerParsed.value,
        triggerJsonRaw: row.TRIGGER_JSON ?? null,
        triggerParseError: triggerParsed.parseError,
        recommendedCta: ctaParsed.actions,
        recommendedCtaJsonRaw: row.RECOMMENDED_CTA_JSON ?? null,
        recommendedCtaParseError: ctaParsed.parseError,
      };
    });

    res.json({
      data,
      meta: {
        count: data.length,
        limit,
        statusFilter: statuses,
      },
    });
  } catch (err) {
    console.error("alerts 조회 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:alertId/ack
router.patch("/:alertId/ack", async (req, res) => {
  try {
    const alertId = parseAlertId(req.params.alertId);
    if (alertId == null) {
      return res.status(400).json({ error: "Invalid alertId" });
    }

    const result = await db.execute(
      `
      UPDATE alerts
      SET status = 'ACKNOWLEDGED',
          acknowledged_at = NVL(acknowledged_at, SYSTIMESTAMP)
      WHERE alert_id = :alertId
      `,
      { alertId }
    );

    if (!result.rowsAffected) {
      return res.status(404).json({ error: "Alert not found" });
    }

    res.json({ ok: true, alertId, status: "ACKNOWLEDGED" });
  } catch (err) {
    console.error("alerts ack 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:alertId/snooze
router.patch("/:alertId/snooze", async (req, res) => {
  try {
    const alertId = parseAlertId(req.params.alertId);
    if (alertId == null) {
      return res.status(400).json({ error: "Invalid alertId" });
    }

    const minutes = parseSnoozeMinutes(req.body?.minutes);
    if (minutes == null) {
      return res.status(400).json({
        error: `minutes must be between ${MIN_SNOOZE_MINUTES} and ${MAX_SNOOZE_MINUTES}`,
      });
    }

    const referenceNow = computeReferenceNow({
      demoStep: req.demoStep ?? null,
      demoShiftOrder: getShiftOrder(req.demoShift),
      demoBaseDate: req.demoBaseDate,
    });
    const snoozedUntil = new Date(referenceNow.getTime() + minutes * 60 * 1000);

    const result = await db.execute(
      `
      UPDATE alerts
      SET status = 'ACKNOWLEDGED',
          acknowledged_at = NVL(acknowledged_at, SYSTIMESTAMP),
          snoozed_at = :snoozedAt,
          snoozed_until = :snoozedUntil
      WHERE alert_id = :alertId
      `,
      {
        alertId,
        snoozedAt: referenceNow,
        snoozedUntil,
      }
    );

    if (!result.rowsAffected) {
      return res.status(404).json({ error: "Alert not found" });
    }

    res.json({
      ok: true,
      alertId,
      status: "ACKNOWLEDGED",
      snoozedUntil: snoozedUntil.toISOString(),
    });
  } catch (err) {
    console.error("alerts snooze 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/alerts/:alertId/unsnooze
router.patch("/:alertId/unsnooze", async (req, res) => {
  try {
    const alertId = parseAlertId(req.params.alertId);
    if (alertId == null) {
      return res.status(400).json({ error: "Invalid alertId" });
    }

    const result = await db.execute(
      `
      UPDATE alerts
      SET snoozed_until = NULL,
          snoozed_at = NULL,
          snoozed_by = NULL
      WHERE alert_id = :alertId
      `,
      { alertId }
    );

    if (!result.rowsAffected) {
      return res.status(404).json({ error: "Alert not found" });
    }

    res.json({ ok: true, alertId });
  } catch (err) {
    console.error("alerts unsnooze 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts/demo-reset
router.post("/demo-reset", async (req, res) => {
  try {
    const snapshotRestore = await runSnapshotRestoreScriptIfEnabled(req);

    const result = await db.withTransaction(async (conn) => {
      const alertsRes = await db.execute(
        `
        UPDATE alerts
        SET status = 'ACTIVE',
            acknowledged_at = NULL,
            acknowledged_by = NULL,
            resolved_at = NULL,
            snoozed_until = NULL,
            snoozed_at = NULL,
            snoozed_by = NULL
        `,
        {},
        { connection: conn }
      );

      const transferRes = await db.execute(
        `
        UPDATE transfer_cases
        SET status = 'WAITING',
            plan_id = NULL,
            to_ward_id = NULL,
            to_room_id = NULL,
            to_bed_id = NULL,
            exception_reason = NULL,
            updated_at = SYSTIMESTAMP
        WHERE status IN ('PLANNED', 'NEEDS_EXCEPTION')
           OR plan_id IN (
             SELECT bp.plan_id
             FROM bed_assignment_plans bp
             WHERE bp.status IN ('DRAFT', 'CANCELLED')
           )
        `,
        {},
        { connection: conn }
      );

      const planItemsRes = await db.execute(
        `
        DELETE FROM bed_assignment_items
        WHERE plan_id IN (
          SELECT bp.plan_id
          FROM bed_assignment_plans bp
          WHERE bp.status IN ('DRAFT', 'CANCELLED')
        )
        `,
        {},
        { connection: conn }
      );

      const planRes = await db.execute(
        `
        DELETE FROM bed_assignment_plans
        WHERE status IN ('DRAFT', 'CANCELLED')
        `,
        {},
        { connection: conn }
      );

      return {
        alertsResetRows: alertsRes.rowsAffected ?? 0,
        transferResetRows: transferRes.rowsAffected ?? 0,
        planItemsResetRows: planItemsRes.rowsAffected ?? 0,
        plansResetRows: planRes.rowsAffected ?? 0,
      };
    });

    res.json({
      ok: true,
      resetRows: result.alertsResetRows,
      transferResetRows: result.transferResetRows,
      planItemsResetRows: result.planItemsResetRows,
      plansResetRows: result.plansResetRows,
      snapshotRestore,
    });
  } catch (err) {
    console.error("alerts demo-reset 실패:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
