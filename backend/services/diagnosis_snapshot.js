const { getShiftOrder } = require("../helpers/demo-filter");

const INFECTION_CODE_MAP = {
  P01: "Pneumonia",
  P04: "Pneumonia",
  P05: "Pneumonia",
  U01: "UTI",
  G01: "Waterborne",
  G02: "Waterborne",
  M01: "MDRO",
  M03: "MDRO",
  T01: "Tick-borne",
  T02: "Tick-borne",
  T03: "Tick-borne",
};

const DIAGNOSIS_GROUP_MAP = {
  RESP: "Pneumonia",
  GI: "Waterborne",
  MDRO: "MDRO",
  UTI: "UTI",
  TICK: "Tick-borne",
};

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildInClause(values, prefix = "a") {
  const normalized = Array.isArray(values) ? values : [];
  const binds = {};
  const placeholders = normalized.map((value, idx) => {
    const key = `${prefix}${idx}`;
    binds[key] = value;
    return `:${key}`;
  });
  return { placeholders: placeholders.join(", "), binds };
}

function normalizeDiagnosisShiftOrder(rawShift) {
  const token = String(rawShift || "").trim().toUpperCase();
  if (token === "DAY") return 1;
  if (token === "EVENING") return 2;
  if (token === "NIGHT") return 3;
  return 1;
}

function normalizeInfectionType(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return null;
  if (Object.values(INFECTION_CODE_MAP).includes(value)) return value;
  return INFECTION_CODE_MAP[value.toUpperCase()] || null;
}

function mapInfectionCodeToType(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return null;

  if (code.startsWith("INIT_")) {
    return INFECTION_CODE_MAP[code.slice("INIT_".length)] || null;
  }
  if (code.startsWith("MDRO_")) return "MDRO";
  if (code.startsWith("RESP_")) return "Pneumonia";
  if (code.startsWith("GI_")) return "Waterborne";
  if (code.startsWith("UTI_")) return "UTI";
  if (code.startsWith("TICK_")) return "Tick-borne";

  return INFECTION_CODE_MAP[code] || null;
}

function deriveMdroLabel(diagnosisName, diagnosisCode) {
  const fromName = String(diagnosisName || "").trim();
  if (fromName) return fromName;

  const code = String(diagnosisCode || "").trim().toUpperCase();
  if (code.startsWith("MDRO_")) {
    const token = code.slice("MDRO_".length).trim();
    if (token) return token;
  }
  return "MDRO";
}

function resolveInfectionFromDiagnosis(diagnosis) {
  if (!diagnosis) return null;
  const diagnosisCode = String(diagnosis.diagnosisCode || "").trim().toUpperCase();
  const diagnosisGroup = String(diagnosis.diagnosisGroup || "").trim().toUpperCase();
  const status = String(diagnosis.status || "").trim().toUpperCase();

  if (status === "CONFIRMED" && diagnosisGroup === "MDRO") {
    return {
      infection: "MDRO",
      infectionLabel: deriveMdroLabel(diagnosis.diagnosisName, diagnosisCode),
    };
  }

  const fromCode = mapInfectionCodeToType(diagnosisCode);
  if (fromCode) {
    return {
      infection: fromCode,
      infectionLabel: fromCode,
    };
  }

  const fromGroup = DIAGNOSIS_GROUP_MAP[diagnosisGroup];
  if (fromGroup) {
    return {
      infection: fromGroup,
      infectionLabel: fromGroup,
    };
  }

  return null;
}

function resolveInfectionPresentation({
  diagnosis = null,
  fallbackInfectionType = null,
  fallbackInfectionCode = null,
} = {}) {
  const fromDiagnosis = resolveInfectionFromDiagnosis(diagnosis);
  if (fromDiagnosis) return fromDiagnosis;

  const normalizedType = normalizeInfectionType(fallbackInfectionType);
  if (normalizedType) {
    return { infection: normalizedType, infectionLabel: normalizedType };
  }

  const fromCode = mapInfectionCodeToType(fallbackInfectionCode);
  if (fromCode) {
    return { infection: fromCode, infectionLabel: fromCode };
  }

  return { infection: "MDRO", infectionLabel: "MDRO" };
}

function computeEffectiveDemoSlot({ demoStep, demoShift, dMin, demoOffset }) {
  const step = toFiniteNumber(demoStep);
  if (!step) return null;

  const minD = toFiniteNumber(dMin) ?? 0;
  const offset = toFiniteNumber(demoOffset) ?? 0;
  const effectiveD = minD + (step - offset - 1);
  const shiftOrder = getShiftOrder(demoShift) || 3;

  return {
    dNumber: effectiveD,
    shiftOrder,
  };
}

function isSlotOnOrAfter(currentSlot, targetSlot) {
  if (!currentSlot || !targetSlot) return true;
  const currentD = toFiniteNumber(currentSlot.dNumber);
  const targetD = toFiniteNumber(targetSlot.dNumber);
  if (currentD == null || targetD == null) return true;

  if (currentD > targetD) return true;
  if (currentD < targetD) return false;

  const currentShiftOrder = toFiniteNumber(currentSlot.shiftOrder) ?? 3;
  const targetShiftOrder = toFiniteNumber(targetSlot.shiftOrder) ?? 1;
  return currentShiftOrder >= targetShiftOrder;
}

function isMissingDiagnosisTableError(error) {
  const text = String(error?.message || error || "");
  return text.includes("ORA-00942") || text.includes("ORA-00904");
}

function normalizeShiftToken(rawShift) {
  const token = String(rawShift || "").trim().toUpperCase();
  if (token === "DAY" || token === "EVENING" || token === "NIGHT") return token;
  return null;
}

function compareSlot(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const aD = toFiniteNumber(a.dNumber);
  const bD = toFiniteNumber(b.dNumber);
  if (aD == null && bD == null) return 0;
  if (aD == null) return 1;
  if (bD == null) return -1;
  if (aD !== bD) return aD < bD ? -1 : 1;
  const aShift = toFiniteNumber(a.shiftOrder) ?? 1;
  const bShift = toFiniteNumber(b.shiftOrder) ?? 1;
  if (aShift === bShift) return 0;
  return aShift < bShift ? -1 : 1;
}

function pickEarlierSlot(current, candidate) {
  if (!candidate) return current;
  if (!current) return candidate;
  return compareSlot(candidate, current) < 0 ? candidate : current;
}

function parseMdroLabelFromText(...candidates) {
  const text = candidates
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (!text) return "MDRO";
  if (/(^|\W)MRSA(\W|$)/.test(text)) return "MRSA";
  if (/(^|\W)CRE(\W|$)/.test(text)) return "CRE";
  if (/(^|\W)VRE(\W|$)/.test(text)) return "VRE";
  if (/(^|\W)CRAB(\W|$)/.test(text)) return "CRAB";
  if (/(^|\W)CRPA(\W|$)/.test(text)) return "CRPA";
  if (/(C\.?\s*DIFF|C\.?\s*DIFFICILE)/.test(text)) return "C_DIFF";
  return "MDRO";
}

function buildMdroConfirmedDiagnosis(label, slot) {
  const normalizedLabel = parseMdroLabelFromText(label);
  return {
    diagnosisCode: `MDRO_${normalizedLabel}`,
    diagnosisName: normalizedLabel,
    diagnosisGroup: "MDRO",
    status: "CONFIRMED",
    confirmedDNumber: slot?.dNumber ?? null,
    confirmedShift: slot?.shift ?? null,
  };
}

let infectionDiagnosisColumnCache = null;
let trajectoryEventColumnCache = null;

async function getInfectionDiagnosisColumns(execute) {
  if (infectionDiagnosisColumnCache) {
    return infectionDiagnosisColumnCache;
  }
  const result = await execute(
    `
      SELECT column_name
      FROM user_tab_columns
      WHERE table_name = 'INFECTION_DIAGNOSES'
    `,
  );
  infectionDiagnosisColumnCache = new Set(
    (result.rows || [])
      .map((row) => String(row?.COLUMN_NAME ?? row?.[0] ?? "").toUpperCase())
      .filter(Boolean),
  );
  return infectionDiagnosisColumnCache;
}

async function getTrajectoryEventColumns(execute) {
  if (trajectoryEventColumnCache) {
    return trajectoryEventColumnCache;
  }
  const result = await execute(
    `
      SELECT column_name
      FROM user_tab_columns
      WHERE table_name = 'TRAJECTORY_EVENTS'
    `,
  );
  trajectoryEventColumnCache = new Set(
    (result.rows || [])
      .map((row) => String(row?.COLUMN_NAME ?? row?.[0] ?? "").toUpperCase())
      .filter(Boolean),
  );
  return trajectoryEventColumnCache;
}

function buildMicroResultIdExpr({
  sourceTypeExpr = "d.source_type",
  sourceRefIdExpr = "d.source_ref_id",
} = {}) {
  const sourceTypeTokenExpr = `UPPER(TRIM(CAST(${sourceTypeExpr} AS VARCHAR2(64))))`;
  const sourceRefTokenExpr = `TRIM(CAST(${sourceRefIdExpr} AS VARCHAR2(128)))`;
  return `CASE
    WHEN ${sourceTypeTokenExpr} = 'MICROBIOLOGY'
      AND REGEXP_LIKE(${sourceRefTokenExpr}, '^[0-9]+$')
    THEN TO_NUMBER(${sourceRefTokenExpr})
    ELSE NULL
  END`;
}

async function fetchDiagnosisSnapshots(execute, admissionIds, { demoStep = null, demoShift = null } = {}) {
  const normalizedIds = [...new Set((Array.isArray(admissionIds) ? admissionIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id)))];
  const output = new Map();
  if (normalizedIds.length === 0) return output;

  const { placeholders, binds } = buildInClause(normalizedIds, "ad");
  const demoShiftOrder = getShiftOrder(demoShift) || 3;
  const effectiveMaxDExpr = "NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1)";
  let diagnosisColumns = new Set();
  try {
    diagnosisColumns = await getInfectionDiagnosisColumns(execute);
  } catch (error) {
    if (!isMissingDiagnosisTableError(error)) {
      throw error;
    }
    console.warn(
      "[diagnosis_snapshot] infection_diagnoses fallback:",
      String(error?.message || error),
    );
  }

  if (diagnosisColumns.size > 0) {
    const hasColumn = (columnName) => diagnosisColumns.has(columnName.toUpperCase());
    const confirmedDNumberExpr = hasColumn("CONFIRMED_D_NUMBER")
      ? "d.confirmed_d_number"
      : "CAST(NULL AS NUMBER)";
    const confirmedShiftExpr = hasColumn("CONFIRMED_SHIFT")
      ? "d.confirmed_shift"
      : "CAST(NULL AS VARCHAR2(10))";
    const sourceTypeExpr = hasColumn("SOURCE_TYPE")
      ? "d.source_type"
      : "CAST(NULL AS VARCHAR2(30))";
    const sourceRefIdExpr = hasColumn("SOURCE_REF_ID")
      ? "d.source_ref_id"
      : "CAST(NULL AS VARCHAR2(100))";
    const microResultIdExpr = buildMicroResultIdExpr({
      sourceTypeExpr,
      sourceRefIdExpr,
    });
    const resolvedSlotDExpr = `COALESCE(${confirmedDNumberExpr}, m.d_number)`;
    const resolvedSlotShiftExpr = `COALESCE(
      ${confirmedShiftExpr},
      CASE
        WHEN NVL(m.result_datetime, m.collection_datetime) IS NULL THEN NULL
        WHEN TO_NUMBER(TO_CHAR(NVL(m.result_datetime, m.collection_datetime), 'HH24')) BETWEEN 6 AND 13 THEN 'DAY'
        WHEN TO_NUMBER(TO_CHAR(NVL(m.result_datetime, m.collection_datetime), 'HH24')) BETWEEN 14 AND 21 THEN 'EVENING'
        ELSE 'NIGHT'
      END
    )`;
    const shiftOrderExpr = `CASE UPPER(NVL(${resolvedSlotShiftExpr}, ''))
      WHEN 'DAY' THEN 1
      WHEN 'EVENING' THEN 2
      WHEN 'NIGHT' THEN 3
      ELSE 1
    END`;

    try {
      const latestEffectiveResult = await execute(
        `
          SELECT
            admission_id,
            diagnosis_code,
            diagnosis_name,
            diagnosis_group,
            status,
            confirmed_d_number,
            confirmed_shift
          FROM (
            SELECT
              d.admission_id,
              d.diagnosis_code,
              d.diagnosis_name,
              d.diagnosis_group,
              d.status,
              ${resolvedSlotDExpr} AS confirmed_d_number,
              ${resolvedSlotShiftExpr} AS confirmed_shift,
              ROW_NUMBER() OVER (
                PARTITION BY d.admission_id
                ORDER BY
                  CASE WHEN UPPER(NVL(d.status, '')) = 'CONFIRMED' THEN 0 ELSE 1 END,
                  NVL(${resolvedSlotDExpr}, -99999) DESC,
                  ${shiftOrderExpr} DESC,
                  d.diagnosis_id DESC
              ) AS rn
            FROM infection_diagnoses d
            JOIN admissions a ON a.admission_id = d.admission_id
            LEFT JOIN microbiology_results m
              ON m.result_id = ${microResultIdExpr}
            WHERE d.admission_id IN (${placeholders})
              AND (
                UPPER(NVL(d.status, '')) <> 'CONFIRMED'
                OR :demoStep IS NULL
                OR ${resolvedSlotDExpr} < (${effectiveMaxDExpr})
                OR (
                  ${resolvedSlotDExpr} = (${effectiveMaxDExpr})
                  AND ${shiftOrderExpr} <= :demoShiftOrder
                )
              )
          )
          WHERE rn = 1
        `,
        {
          ...binds,
          demoStep: toFiniteNumber(demoStep),
          demoShiftOrder,
        },
      );

      for (const row of latestEffectiveResult.rows || []) {
        output.set(Number(row.ADMISSION_ID), {
          effectiveDiagnosis: {
            diagnosisCode: row.DIAGNOSIS_CODE || null,
            diagnosisName: row.DIAGNOSIS_NAME || null,
            diagnosisGroup: row.DIAGNOSIS_GROUP || null,
            status: row.STATUS || null,
            confirmedDNumber: toFiniteNumber(row.CONFIRMED_D_NUMBER),
            confirmedShift: row.CONFIRMED_SHIFT || null,
          },
          firstMdroConfirmedSlot: null,
        });
      }

      const firstMdroResult = await execute(
        `
          SELECT
            admission_id,
            confirmed_d_number,
            confirmed_shift
          FROM (
            SELECT
              d.admission_id,
              ${resolvedSlotDExpr} AS confirmed_d_number,
              ${resolvedSlotShiftExpr} AS confirmed_shift,
              d.diagnosis_id,
              ROW_NUMBER() OVER (
                PARTITION BY d.admission_id
                ORDER BY
                  NVL(${resolvedSlotDExpr}, 99999) ASC,
                  ${shiftOrderExpr} ASC,
                  d.diagnosis_id ASC
              ) AS rn
            FROM infection_diagnoses d
            LEFT JOIN microbiology_results m
              ON m.result_id = ${microResultIdExpr}
            WHERE d.admission_id IN (${placeholders})
              AND UPPER(NVL(d.status, '')) = 'CONFIRMED'
              AND UPPER(NVL(d.diagnosis_group, '')) = 'MDRO'
          )
          WHERE rn = 1
        `,
        binds,
      );

      for (const row of firstMdroResult.rows || []) {
        const admissionId = Number(row.ADMISSION_ID);
        if (!output.has(admissionId)) {
          output.set(admissionId, {
            effectiveDiagnosis: null,
            firstMdroConfirmedSlot: null,
          });
        }
        const existing = output.get(admissionId);
        existing.firstMdroConfirmedSlot = {
          dNumber: toFiniteNumber(row.CONFIRMED_D_NUMBER),
          shiftOrder: normalizeDiagnosisShiftOrder(row.CONFIRMED_SHIFT),
        };
        output.set(admissionId, existing);
      }
    } catch (error) {
      if (!isMissingDiagnosisTableError(error)) {
        throw error;
      }
      // Keep legacy fallback behavior but surface schema mismatch in logs.
      console.warn(
        "[diagnosis_snapshot] infection_diagnoses fallback:",
        String(error?.message || error),
      );
    }
  }

  // Trajectory fallback: when diagnosis table is stale/missing slot fields,
  // derive MDRO confirmed slot and label directly from timeline events.
  let trajectoryColumns = new Set();
  try {
    trajectoryColumns = await getTrajectoryEventColumns(execute);
  } catch (error) {
    if (!isMissingDiagnosisTableError(error)) {
      throw error;
    }
    console.warn(
      "[diagnosis_snapshot] trajectory_events fallback:",
      String(error?.message || error),
    );
  }

  if (trajectoryColumns.size > 0) {
    const hasTrajectoryColumn = (columnName) => trajectoryColumns.has(columnName.toUpperCase());
    const supportingDocsExpr = hasTrajectoryColumn("SUPPORTING_DATA_JSON")
      ? "te.supporting_data_json"
      : hasTrajectoryColumn("SUPPORTING_DOCS_JSON")
        ? "te.supporting_docs_json"
        : "CAST(NULL AS VARCHAR2(4000))";

    const trajShiftOrderExpr = `CASE UPPER(NVL(te.shift, ''))
      WHEN 'DAY' THEN 1
      WHEN 'EVENING' THEN 2
      WHEN 'NIGHT' THEN 3
      ELSE 1
    END`;
    const mdroEventPredicate = `(
      LOWER(NVL(te.event_type, '')) IN ('mdro_confirmed', 'new_mdro_detection', 'isolation_recommendation')
      OR LOWER(NVL(te.render_text, '')) LIKE 'mdro confirmed:%'
      OR LOWER(NVL(te.render_text, '')) LIKE 'new mdro detection:%'
    )`;

    try {
      const trajectoryFirst = await execute(
        `
          SELECT
            admission_id,
            d_number,
            shift,
            render_text,
            supporting_docs_json
          FROM (
            SELECT
              te.admission_id,
              te.d_number,
              te.shift,
              te.render_text,
              ${supportingDocsExpr} AS supporting_docs_json,
              te.event_id,
              ROW_NUMBER() OVER (
                PARTITION BY te.admission_id
                ORDER BY NVL(te.d_number, 99999) ASC, ${trajShiftOrderExpr} ASC, te.event_id ASC
              ) AS rn
            FROM trajectory_events te
            WHERE te.admission_id IN (${placeholders})
              AND te.d_number IS NOT NULL
              AND ${mdroEventPredicate}
          )
          WHERE rn = 1
        `,
        binds,
      );

      for (const row of trajectoryFirst.rows || []) {
        const admissionId = Number(row.ADMISSION_ID);
        if (!output.has(admissionId)) {
          output.set(admissionId, {
            effectiveDiagnosis: null,
            firstMdroConfirmedSlot: null,
          });
        }
        const existing = output.get(admissionId);
        const candidate = {
          dNumber: toFiniteNumber(row.D_NUMBER),
          shiftOrder: normalizeDiagnosisShiftOrder(row.SHIFT),
          shift: normalizeShiftToken(row.SHIFT),
        };
        existing.firstMdroConfirmedSlot = pickEarlierSlot(existing.firstMdroConfirmedSlot, candidate);
        output.set(admissionId, existing);
      }

      const trajectoryLatestBinds = {
        ...binds,
        demoStep: toFiniteNumber(demoStep),
        demoShiftOrder,
      };
      const trajectoryLatest = await execute(
        `
          SELECT
            admission_id,
            d_number,
            shift,
            render_text,
            supporting_docs_json
          FROM (
            SELECT
              te.admission_id,
              te.d_number,
              te.shift,
              te.render_text,
              ${supportingDocsExpr} AS supporting_docs_json,
              te.event_id,
              ROW_NUMBER() OVER (
                PARTITION BY te.admission_id
                ORDER BY te.d_number DESC, ${trajShiftOrderExpr} DESC, te.event_id DESC
              ) AS rn
            FROM trajectory_events te
            JOIN admissions a ON a.admission_id = te.admission_id
            WHERE te.admission_id IN (${placeholders})
              AND te.d_number IS NOT NULL
              AND ${mdroEventPredicate}
              AND (
                :demoStep IS NULL
                OR te.d_number < (${effectiveMaxDExpr})
                OR (
                  te.d_number = (${effectiveMaxDExpr})
                  AND ${trajShiftOrderExpr} <= :demoShiftOrder
                )
              )
          )
          WHERE rn = 1
        `,
        trajectoryLatestBinds,
      );

      for (const row of trajectoryLatest.rows || []) {
        const admissionId = Number(row.ADMISSION_ID);
        if (!output.has(admissionId)) {
          output.set(admissionId, {
            effectiveDiagnosis: null,
            firstMdroConfirmedSlot: null,
          });
        }
        const existing = output.get(admissionId);
        const slot = {
          dNumber: toFiniteNumber(row.D_NUMBER),
          shiftOrder: normalizeDiagnosisShiftOrder(row.SHIFT),
          shift: normalizeShiftToken(row.SHIFT),
        };
        const trajectoryDiagnosis = buildMdroConfirmedDiagnosis(
          parseMdroLabelFromText(row.RENDER_TEXT, row.SUPPORTING_DOCS_JSON),
          slot,
        );

        const current = existing.effectiveDiagnosis || null;
        const currentGroup = String(current?.diagnosisGroup || "").toUpperCase();
        const currentStatus = String(current?.status || "").toUpperCase();
        const shouldOverride =
          !current ||
          !(currentGroup === "MDRO" && currentStatus === "CONFIRMED");

        if (shouldOverride) {
          existing.effectiveDiagnosis = trajectoryDiagnosis;
        }
        existing.firstMdroConfirmedSlot = pickEarlierSlot(existing.firstMdroConfirmedSlot, slot);
        output.set(admissionId, existing);
      }
    } catch (error) {
      if (!isMissingDiagnosisTableError(error)) {
        throw error;
      }
      console.warn(
        "[diagnosis_snapshot] trajectory_events fallback:",
        String(error?.message || error),
      );
    }
  }

  return output;
}

module.exports = {
  mapInfectionCodeToType,
  resolveInfectionPresentation,
  computeEffectiveDemoSlot,
  isSlotOnOrAfter,
  fetchDiagnosisSnapshots,
};
