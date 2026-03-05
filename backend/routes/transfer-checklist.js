const express = require("express");
const oracledb = require("oracledb");
const db = require("../db");
const { getShiftOrder } = require("../helpers/demo-filter");

const router = express.Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const TRACKED_ACTIONS = new Set(["snapshot_save", "submit"]);
const KNOWN_CONDITIONS = new Set(["pneumonia", "sepsis", "uti", "mdro", "gi"]);
const SECTION_REQUIREMENTS = [
  { section: "B", itemIds: ["Q_A1", "Q_A2", "Q_A3"], label: "환자 안정성" },
  { section: "C", itemIds: ["Q_B1", "Q_B2"], label: "우리 병원 역량" },
  { section: "D", itemIds: ["Q_C1", "Q_C2"], label: "전원 필요성/수용확인" },
  { section: "E", itemIds: ["Q_D1", "Q_D2", "Q_D3"], label: "이송 준비" },
];
const CONDITION_ITEM_IDS = {
  pneumonia: ["Q_P1", "Q_P2", "Q_P3"],
  sepsis: ["Q_S1", "Q_S2", "Q_S3"],
  uti: ["Q_U1", "Q_U2", "Q_U3"],
  mdro: ["Q_M1", "Q_M2", "Q_M3"],
  gi: ["Q_G1", "Q_G2", "Q_G3"],
};

function asNonEmptyString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
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

function normalizeDemoShift(rawShift) {
  const shift = asNonEmptyString(rawShift);
  if (!shift) return null;
  const lowered = shift.toLowerCase();
  if (lowered === "day") return "Day";
  if (lowered === "evening") return "Evening";
  if (lowered === "night") return "Night";
  return null;
}

function toIso(value, fallbackIso = null) {
  if (!value) return fallbackIso;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackIso;
  return date.toISOString();
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

function normalizeConditionIds(raw) {
  if (!Array.isArray(raw)) return [];
  const deduped = new Set();
  for (const value of raw) {
    const normalized = asNonEmptyString(value)?.toLowerCase();
    if (!normalized || !KNOWN_CONDITIONS.has(normalized)) continue;
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

function normalizeItems(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const items = {};
  for (const [itemIdRaw, entryRaw] of Object.entries(raw)) {
    const itemId = asNonEmptyString(itemIdRaw);
    if (!itemId || !entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) continue;
    const note = typeof entryRaw.note === "string" ? entryRaw.note.trim() : "";
    const references = Array.isArray(entryRaw.references)
      ? Array.from(
        new Set(
          entryRaw.references
            .map((value) => asNonEmptyString(value))
            .filter(Boolean),
        ),
      )
      : [];
    const reviewed = Boolean(entryRaw.reviewed);
    items[itemId] = {
      reviewed,
      note,
      references,
    };
  }
  return items;
}

function normalizeQuickNotes(raw) {
  if (!Array.isArray(raw)) return [];
  const notes = [];
  for (const entryRaw of raw) {
    if (!entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) continue;
    const text = asNonEmptyString(entryRaw.text);
    if (!text) continue;
    const id = asNonEmptyString(entryRaw.id) || `note-${Math.random().toString(36).slice(2, 8)}`;
    const category = asNonEmptyString(entryRaw.category);
    const createdAt = Number(entryRaw.created_at);
    const updatedAt = Number(entryRaw.updated_at);
    notes.push({
      id,
      text,
      category: category || null,
      created_at: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updated_at: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    });
  }
  return notes;
}

function normalizeSnapshotState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return {
      active_condition_ids: [],
      items: {},
      quick_notes: [],
    };
  }

  return {
    active_condition_ids: normalizeConditionIds(state.active_condition_ids),
    items: normalizeItems(state.items),
    quick_notes: normalizeQuickNotes(state.quick_notes),
  };
}

function resolveDemoContext(req, body = {}) {
  const fallbackStep = parsePositiveInt(body.demoStep);
  const fallbackShift = normalizeDemoShift(body.demoShift);

  const maxStep = Number.isFinite(req.demoMaxStep) ? req.demoMaxStep : null;
  const boundedFallbackStep =
    maxStep != null && fallbackStep != null && fallbackStep > maxStep ? null : fallbackStep;

  const demoStep = req.demoStep ?? boundedFallbackStep;
  const demoShift = demoStep != null ? req.demoShift ?? fallbackShift : null;
  const demoShiftOrder = demoStep != null ? getShiftOrder(demoShift) : null;

  return {
    demoStep: demoStep ?? null,
    demoShift: demoShift ?? null,
    demoShiftOrder: demoShiftOrder ?? null,
  };
}

function extractOutBindValue(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function buildSummaryFromState(state) {
  const conditionIds = normalizeConditionIds(state.active_condition_ids);
  const trackedItemIds = new Set(SECTION_REQUIREMENTS.flatMap((section) => section.itemIds));
  for (const conditionId of conditionIds) {
    for (const itemId of CONDITION_ITEM_IDS[conditionId] || []) {
      trackedItemIds.add(itemId);
    }
  }

  let reviewedCount = 0;
  let inProgressCount = 0;
  for (const itemId of trackedItemIds) {
    const item = state.items?.[itemId];
    if (!item) continue;
    if (item.reviewed) {
      reviewedCount += 1;
      continue;
    }
    if (item.note || (Array.isArray(item.references) && item.references.length > 0)) {
      inProgressCount += 1;
    }
  }

  const totalCount = trackedItemIds.size;
  const progressPercent = totalCount > 0 ? Math.round((reviewedCount / totalCount) * 100) : 0;
  const overallState =
    reviewedCount === totalCount && totalCount > 0
      ? "reviewed"
      : reviewedCount > 0 || inProgressCount > 0
        ? "in_progress"
        : "not_reviewed";

  return {
    reviewedCount,
    inProgressCount,
    totalCount,
    progressPercent,
    overallState,
  };
}

function createValidationIssue(code, message, meta = {}) {
  return {
    code,
    message,
    ...meta,
  };
}

function buildValidationResult(state) {
  const errors = [];
  const warnings = [];
  const summary = buildSummaryFromState(state);

  if (state.active_condition_ids.length === 0) {
    errors.push(
      createValidationIssue(
        "CONDITION_REQUIRED",
        "질병별 체크리스트에서 최소 1개 감염군을 선택해야 제출할 수 있습니다.",
        { field: "active_condition_ids" },
      ),
    );
  }

  for (const section of SECTION_REQUIREMENTS) {
    const missingItemIds = section.itemIds.filter((itemId) => !Boolean(state.items?.[itemId]?.reviewed));
    if (missingItemIds.length > 0) {
      errors.push(
        createValidationIssue(
          "SECTION_REQUIRED_ITEMS_INCOMPLETE",
          `${section.label} 섹션 필수 항목이 미검토 상태입니다.`,
          {
            section_id: section.section,
            item_ids: missingItemIds,
          },
        ),
      );
    }
  }

  for (const conditionId of state.active_condition_ids) {
    const conditionItems = CONDITION_ITEM_IDS[conditionId] || [];
    const hasReviewedItem = conditionItems.some((itemId) => Boolean(state.items?.[itemId]?.reviewed));
    if (!hasReviewedItem) {
      errors.push(
        createValidationIssue(
          "CONDITION_REVIEW_REQUIRED",
          `${conditionId.toUpperCase()} 감염군 항목에서 최소 1개 이상 검토 완료가 필요합니다.`,
          {
            condition_id: conditionId,
            item_ids: conditionItems,
          },
        ),
      );
    }
  }

  if (state.quick_notes.length === 0) {
    warnings.push(
      createValidationIssue(
        "QUICK_NOTE_RECOMMENDED",
        "Quick Notes가 비어 있습니다. 전원 근거를 간단히 남기는 것을 권장합니다.",
      ),
    );
  }

  if (summary.inProgressCount > 0) {
    warnings.push(
      createValidationIssue(
        "IN_PROGRESS_ITEMS_EXIST",
        "검토중 항목이 남아 있습니다. 제출 전 검토완료 상태를 확인하세요.",
        { in_progress_count: summary.inProgressCount },
      ),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

function actionWhereClause() {
  return "("
    + "NVL(event_action, 'snapshot_save') = 'snapshot_save'"
    + " OR NVL(event_action, 'snapshot_save') = 'submit'"
    + ")";
}

function buildWhereClause({ patientId, demoStep, demoShiftOrder }) {
  const where = ["NVL(checklist_type, 'MDRO') = 'TRANSFER'", actionWhereClause()];
  const binds = {};

  if (patientId) {
    where.push("patient_id = :patientId");
    binds.patientId = patientId;
  }

  if (demoStep != null) {
    where.push("demo_step IS NOT NULL");
    where.push(
      "(demo_step < :demoStep OR (demo_step = :demoStep AND (:demoShiftOrder IS NULL OR NVL(demo_shift_order, 99) <= :demoShiftOrder)))",
    );
    binds.demoStep = demoStep;
    binds.demoShiftOrder = demoShiftOrder;
  }

  return { whereSql: where.join(" AND "), binds };
}

async function ensurePatientExists(patientId) {
  const result = await db.execute(
    `
      SELECT 1 AS found
      FROM patients
      WHERE patient_id = :patientId
      FETCH FIRST 1 ROWS ONLY
    `,
    { patientId },
  );
  return Boolean(result.rows?.[0]);
}

async function resolveCreatedByUserId(actorName) {
  const normalized = asNonEmptyString(actorName);
  if (!normalized) return null;
  const result = await db.execute(
    `
      SELECT user_id
      FROM users
      WHERE user_id = :userId
      FETCH FIRST 1 ROWS ONLY
    `,
    { userId: normalized },
  );
  const found = result.rows?.[0]?.USER_ID;
  return found ? normalized : null;
}

async function insertChecklistLog({
  patientId,
  patientName,
  actorName,
  createdBy,
  action,
  reason,
  changedItemLabel,
  summary,
  state,
  validation,
  timestamp,
  demo,
}) {
  const normalizedAction = TRACKED_ACTIONS.has(action) ? action : "snapshot_save";
  const nowIso = new Date().toISOString();
  const createdAt = new Date(nowIso);
  const timestampIso = toIso(timestamp, nowIso);
  const eventTs = new Date(timestampIso);

  const details = {
    source: "transfer_checklist",
    summary,
    state,
    validation: validation || null,
  };

  const payload = {
    patient_id: patientId,
    patient_name: patientName || null,
    checklist_type: "TRANSFER",
    infection_type: "TRANSFER",
    mode: "suspected",
    action: normalizedAction,
    actor_role: "의사",
    actor_name: actorName,
    reason,
    timestamp: timestampIso,
    details,
    state,
    summary,
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

  const result = await db.execute(sql, {
    patientId,
    patientName: patientName || null,
    stage: "suspected",
    mdroType: null,
    createdBy: createdBy || null,
    completed: normalizedAction === "submit" ? 1 : 0,
    notes: reason,
    checklistPayload: JSON.stringify(payload),
    createdAt,
    checklistType: "TRANSFER",
    infectionType: "TRANSFER",
    checklistMode: "suspected",
    checklistSubtype: null,
    eventAction: normalizedAction,
    changedItemId: null,
    changedItemLabel,
    actorRole: "의사",
    actorName,
    eventReason: normalizedAction,
    tagsJson: JSON.stringify(["transfer", normalizedAction]),
    detailsJson: JSON.stringify(details),
    eventTs,
    demoStep: demo.demoStep,
    demoShift: demo.demoShift,
    demoShiftOrder: demo.demoShiftOrder,
    outLogId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  });

  return {
    logId: Number(extractOutBindValue(result.outBinds?.outLogId)),
    createdAtIso: createdAt.toISOString(),
    timestampIso,
  };
}

function toSnapshotSummaryRow(row) {
  const details = safeJsonParseObject(row.DETAILS_JSON, {});
  const payload = safeJsonParseObject(row.CHECKLIST_PAYLOAD, {});

  const detailsState = normalizeSnapshotState(details.state);
  const payloadState = normalizeSnapshotState(payload.state);
  const state =
    Object.keys(detailsState.items || {}).length > 0
      || (Array.isArray(detailsState.quick_notes) && detailsState.quick_notes.length > 0)
      || (Array.isArray(detailsState.active_condition_ids) && detailsState.active_condition_ids.length > 0)
      ? detailsState
      : payloadState;

  const summary = details.summary && typeof details.summary === "object" && !Array.isArray(details.summary)
    ? details.summary
    : payload.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary)
      ? payload.summary
      : {};

  const createdAtIso = toIso(row.CREATED_AT, new Date().toISOString());
  const timestampIso = toIso(row.EVENT_TS, createdAtIso);

  return {
    id: String(row.LOG_ID),
    patient_id: String(row.PATIENT_ID),
    patient_name: asNonEmptyString(row.PATIENT_NAME) || undefined,
    created_at: createdAtIso,
    timestamp: timestampIso,
    demo_step: row.DEMO_STEP == null ? null : Number(row.DEMO_STEP),
    demo_shift: asNonEmptyString(row.DEMO_SHIFT) || null,
    action: asNonEmptyString(row.EVENT_ACTION) || "snapshot_save",
    summary,
    state,
  };
}

function buildValidationResponse({ patientId, demo, validation, state }) {
  return {
    patient_id: patientId,
    demo_step: demo.demoStep,
    demo_shift: demo.demoShift,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    summary: validation.summary,
    state,
  };
}

router.post("/snapshots", async (req, res) => {
  try {
    const body = req.body ?? {};
    const patientId = asNonEmptyString(body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: "patient_id is required" });
    }

    const patientExists = await ensurePatientExists(patientId);
    if (!patientExists) {
      return res.status(404).json({ error: "patient not found" });
    }

    const state = normalizeSnapshotState(body.state);
    const summary = buildSummaryFromState(state);
    const actorName = asNonEmptyString(body.actor_name) || "TransferChecklist";
    const createdBy = await resolveCreatedByUserId(actorName);
    const demo = resolveDemoContext(req, body);

    const inserted = await insertChecklistLog({
      patientId,
      patientName: asNonEmptyString(body.patient_name),
      actorName,
      createdBy,
      action: "snapshot_save",
      reason: "transfer checklist snapshot",
      changedItemLabel: "전원 체크리스트 임시저장",
      summary,
      state,
      validation: null,
      timestamp: body.timestamp,
      demo,
    });

    return res.status(201).json({
      snapshot: {
        id: String(inserted.logId),
        patient_id: patientId,
        patient_name: asNonEmptyString(body.patient_name) || undefined,
        created_at: inserted.createdAtIso,
        timestamp: inserted.timestampIso,
        demo_step: demo.demoStep,
        demo_shift: demo.demoShift,
        action: "snapshot_save",
        summary,
        state,
      },
    });
  } catch (error) {
    console.error("POST /api/transfer-checklist/snapshots error:", error);
    return res.status(500).json({ error: "Failed to save transfer checklist snapshot" });
  }
});

router.post("/validate", async (req, res) => {
  try {
    const body = req.body ?? {};
    const patientId = asNonEmptyString(body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: "patient_id is required" });
    }

    const patientExists = await ensurePatientExists(patientId);
    if (!patientExists) {
      return res.status(404).json({ error: "patient not found" });
    }

    const state = normalizeSnapshotState(body.state);
    const demo = resolveDemoContext(req, body);
    const validation = buildValidationResult(state);

    return res.json(buildValidationResponse({ patientId, demo, validation, state }));
  } catch (error) {
    console.error("POST /api/transfer-checklist/validate error:", error);
    return res.status(500).json({ error: "Failed to validate transfer checklist" });
  }
});

router.post("/submit", async (req, res) => {
  try {
    const body = req.body ?? {};
    const patientId = asNonEmptyString(body.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: "patient_id is required" });
    }

    const patientExists = await ensurePatientExists(patientId);
    if (!patientExists) {
      return res.status(404).json({ error: "patient not found" });
    }

    const state = normalizeSnapshotState(body.state);
    const demo = resolveDemoContext(req, body);
    const validation = buildValidationResult(state);
    if (!validation.valid) {
      return res.status(422).json(buildValidationResponse({ patientId, demo, validation, state }));
    }

    const actorName = asNonEmptyString(body.actor_name) || "TransferChecklist";
    const createdBy = await resolveCreatedByUserId(actorName);
    const inserted = await insertChecklistLog({
      patientId,
      patientName: asNonEmptyString(body.patient_name),
      actorName,
      createdBy,
      action: "submit",
      reason: "transfer checklist submit",
      changedItemLabel: "전원 체크리스트 제출",
      summary: validation.summary,
      state,
      validation,
      timestamp: body.timestamp,
      demo,
    });

    return res.status(201).json({
      snapshot: {
        id: String(inserted.logId),
        patient_id: patientId,
        patient_name: asNonEmptyString(body.patient_name) || undefined,
        created_at: inserted.createdAtIso,
        timestamp: inserted.timestampIso,
        demo_step: demo.demoStep,
        demo_shift: demo.demoShift,
        action: "submit",
        summary: validation.summary,
        state,
      },
      validation: {
        valid: true,
        errors: [],
        warnings: validation.warnings,
      },
    });
  } catch (error) {
    console.error("POST /api/transfer-checklist/submit error:", error);
    return res.status(500).json({ error: "Failed to submit transfer checklist" });
  }
});

router.get("/snapshots", async (req, res) => {
  try {
    const patientId = asNonEmptyString(req.query.patient_id);
    const limit = parseLimit(req.query.limit);
    const demo = resolveDemoContext(req);
    const { whereSql, binds } = buildWhereClause({
      patientId,
      demoStep: demo.demoStep,
      demoShiftOrder: demo.demoShiftOrder,
    });

    const query = `
      SELECT * FROM (
        SELECT
          log_id,
          patient_id,
          patient_name,
          created_at,
          event_ts,
          checklist_payload,
          details_json,
          event_action,
          demo_step,
          demo_shift,
          demo_shift_order,
          ROW_NUMBER() OVER (ORDER BY NVL(event_ts, created_at) DESC, log_id DESC) AS rn
        FROM mdro_checklist_logs
        WHERE ${whereSql}
      )
      WHERE rn <= :maxRows
      ORDER BY rn
    `;

    const rowsResult = await db.execute(query, { ...binds, maxRows: limit });
    const rows = rowsResult.rows || [];
    const snapshots = rows.map(toSnapshotSummaryRow);

    return res.json({
      total: snapshots.length,
      snapshots,
    });
  } catch (error) {
    console.error("GET /api/transfer-checklist/snapshots error:", error);
    return res.status(500).json({ error: "Failed to fetch transfer checklist snapshots" });
  }
});

router.get("/snapshots/latest", async (req, res) => {
  try {
    const patientId = asNonEmptyString(req.query.patient_id);
    if (!patientId) {
      return res.status(400).json({ error: "patient_id is required" });
    }

    const demo = resolveDemoContext(req);
    const { whereSql, binds } = buildWhereClause({
      patientId,
      demoStep: demo.demoStep,
      demoShiftOrder: demo.demoShiftOrder,
    });

    const query = `
      SELECT
        log_id,
        patient_id,
        patient_name,
        created_at,
        event_ts,
        checklist_payload,
        details_json,
        event_action,
        demo_step,
        demo_shift,
        demo_shift_order
      FROM mdro_checklist_logs
      WHERE ${whereSql}
      ORDER BY NVL(event_ts, created_at) DESC, log_id DESC
      FETCH FIRST 1 ROWS ONLY
    `;

    const result = await db.execute(query, binds);
    const row = result.rows?.[0];

    if (!row) {
      return res.json({ snapshot: null });
    }

    return res.json({ snapshot: toSnapshotSummaryRow(row) });
  } catch (error) {
    console.error("GET /api/transfer-checklist/snapshots/latest error:", error);
    return res.status(500).json({ error: "Failed to fetch latest transfer checklist snapshot" });
  }
});

module.exports = router;
