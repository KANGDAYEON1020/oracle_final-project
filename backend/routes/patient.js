const express = require("express");
const db = require("../db");
const OpenAI = require("openai");
const {
  buildDemoMeta,
  getShiftOrder,
} = require("../helpers/demo-filter");

const router = express.Router();

// ============================================================
// 공통 헬퍼
// ============================================================

/**
 * Oracle IN 절 바인드 생성
 * @returns {{ placeholders: string, binds: object }}
 */
function buildInClause(ids, prefix = "a") {
  const binds = {};
  const parts = ids.map((id, i) => {
    binds[`${prefix}${i}`] = id;
    return `:${prefix}${i}`;
  });
  return { placeholders: parts.join(","), binds };
}

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseCsvParam(raw) {
  if (raw == null) return [];
  return Array.from(
    new Set(
      String(raw)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function shiftTimestamp(value, deltaHours) {
  if (!value) return null;
  const base =
    value instanceof Date ? value : new Date(value);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + deltaHours * 60 * 60 * 1000);
}

function computeEffectiveMaxD(dMin, demoOffset, demoStep) {
  const step = toFiniteNumber(demoStep);
  const minD = toFiniteNumber(dMin);
  const offset = toFiniteNumber(demoOffset);
  if (!step || minD == null) return null;
  return minD + (step - (offset || 0) - 1);
}

function buildShiftAwareDNumberDatetimeFilter({
  demoStep,
  demoShiftOrder,
  dNumberExpr,
  dMinExpr,
  demoOffsetExpr,
  datetimeExpr,
}) {
  const step = toFiniteNumber(demoStep);
  if (step == null) return { sql: "", binds: {} };

  const effectiveMaxDExpr = `(${dMinExpr} + (:demoStep - ${demoOffsetExpr} - 1))`;
  const binds = { demoStep: step };
  let sql = ` AND ${dNumberExpr} <= ${effectiveMaxDExpr}`;

  const normalizedShiftOrder = toFiniteNumber(demoShiftOrder);
  if (normalizedShiftOrder != null) {
    binds.demoShiftOrder = normalizedShiftOrder;
    const inferredShiftExpr = `CASE
      WHEN ${datetimeExpr} IS NULL THEN 99
      WHEN TO_NUMBER(TO_CHAR(${datetimeExpr}, 'HH24')) BETWEEN 6 AND 13 THEN 1
      WHEN TO_NUMBER(TO_CHAR(${datetimeExpr}, 'HH24')) BETWEEN 14 AND 21 THEN 2
      ELSE 3
    END`;

    sql += `
      AND (
        ${dNumberExpr} < ${effectiveMaxDExpr}
        OR (
          ${dNumberExpr} = ${effectiveMaxDExpr}
          AND ${inferredShiftExpr} <= :demoShiftOrder
        )
      )
    `;
  }

  return { sql, binds };
}

function buildShiftAwareEffectiveDFilter({
  effectiveMaxD,
  demoShiftOrder,
  dNumberExpr,
  datetimeExpr,
}) {
  const normalizedMaxD = toFiniteNumber(effectiveMaxD);
  if (normalizedMaxD == null) return { sql: "", binds: {} };

  const binds = { effectiveMaxD: normalizedMaxD };
  let sql = ` AND ${dNumberExpr} <= :effectiveMaxD`;

  const normalizedShiftOrder = toFiniteNumber(demoShiftOrder);
  if (normalizedShiftOrder != null) {
    binds.demoShiftOrder = normalizedShiftOrder;
    const inferredShiftExpr = `CASE
      WHEN ${datetimeExpr} IS NULL THEN 99
      WHEN TO_NUMBER(TO_CHAR(${datetimeExpr}, 'HH24')) BETWEEN 6 AND 13 THEN 1
      WHEN TO_NUMBER(TO_CHAR(${datetimeExpr}, 'HH24')) BETWEEN 14 AND 21 THEN 2
      ELSE 3
    END`;

    sql += `
      AND (
        ${dNumberExpr} < :effectiveMaxD
        OR (
          ${dNumberExpr} = :effectiveMaxD
          AND ${inferredShiftExpr} <= :demoShiftOrder
        )
      )
    `;
  }

  return { sql, binds };
}

const TRAJECTORY_SEVERITY_RANK = {
  info: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

const TRAJECTORY_SEVERITY_SCORE = {
  info: 20,
  low: 40,
  medium: 60,
  high: 80,
  critical: 100,
};

function getTrajectoryShiftOrder(rawShift) {
  const value = String(rawShift || "").trim().toUpperCase();
  if (value === "DAY") return 1;
  if (value === "EVENING") return 2;
  if (value === "NIGHT") return 3;
  return 99;
}

function getTrajectoryShiftLabel(shiftOrder) {
  if (shiftOrder === 1) return "Day";
  if (shiftOrder === 2) return "Evening";
  if (shiftOrder === 3) return "Night";
  return null;
}

function normalizeShiftLabel(rawShift) {
  const token = String(rawShift || "").trim().toUpperCase();
  if (token === "DAY") return "Day";
  if (token === "EVENING") return "Evening";
  if (token === "NIGHT") return "Night";
  return null;
}

function normalizeMdroType(rawType, diagnosisCode = null) {
  const fromName = String(rawType || "").trim();
  if (fromName) return fromName;

  const token = String(diagnosisCode || "").trim().toUpperCase();
  if (token.startsWith("MDRO_")) {
    const suffix = token.slice("MDRO_".length).trim();
    if (suffix) return suffix;
  }
  return "MDRO";
}

function buildMdroStatusPayload({
  mdroType,
  diagnosisCode = null,
  confirmedAt = null,
  confirmedHd = null,
  confirmedDNumber = null,
  confirmedShift = null,
}) {
  return {
    isMDRO: true,
    mdroType: normalizeMdroType(mdroType, diagnosisCode),
    isolationRequired: true,
    isolationImplemented: false,
    confirmedAt: confirmedAt instanceof Date ? confirmedAt.toISOString() : null,
    confirmedHd: toFiniteNumber(confirmedHd),
    confirmedDNumber: toFiniteNumber(confirmedDNumber),
    confirmedShift: normalizeShiftLabel(confirmedShift),
  };
}

function labelizeSnakeToken(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .split("_")
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}

function normalizeTrajectoryEventLabel(renderText, eventType, axisType) {
  const compactText = String(renderText || "").replace(/\s+/g, " ").trim();
  if (compactText) return compactText.length > 72 ? `${compactText.slice(0, 71)}…` : compactText;

  const eventTypeMap = {
    abx_escalation: "항생제 강화",
    abx_escalate_or_change: "항생제 변경",
    resp_support_increase: "호흡 보조 증가",
    hemodynamic_instability: "혈역학 불안정",
    notify_first_seen: "의료진 알림 필요",
    monitoring_escalated: "모니터링 강화",
    vitals_frequency_escalated: "활력징후 모니터링 강화",
    isolation_gap: "격리 공백",
  };

  const eventToken = String(eventType || "").trim().toLowerCase();
  if (eventToken && eventTypeMap[eventToken]) return eventTypeMap[eventToken];
  if (eventToken) return labelizeSnakeToken(eventToken);

  const axisToken = String(axisType || "").trim().toLowerCase();
  if (axisToken) return `${labelizeSnakeToken(axisToken)} 변화`;
  return "임상 이벤트";
}

function normalizeTrajectorySeverity(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v in TRAJECTORY_SEVERITY_RANK) return v;
  if (v === "warning") return "high";
  if (v === "urgent") return "high";
  if (v === "stable") return "low";
  return null;
}

function mapDashboardStatusFromTrajectory(baseStatus, maxSeverity) {
  if (baseStatus === "transferred") return "transferred";

  const sev = normalizeTrajectorySeverity(maxSeverity);
  if (!sev) return baseStatus;
  if (sev === "critical") return "critical";
  if (sev === "high" || sev === "medium") return "warning";
  return "stable";
}

function mapRiskLevelFromTrajectoryAndScore(statusAtDemo, severity, riskScore) {
  if (statusAtDemo === "critical") return "Critical";
  if (statusAtDemo === "warning") return "High";

  const normalizedSeverity = normalizeTrajectorySeverity(severity);
  if (normalizedSeverity === "critical") return "Critical";
  if (normalizedSeverity === "high") return "High";
  if (normalizedSeverity === "medium") return "Moderate";
  if (normalizedSeverity === "low") return "Stable";
  if (normalizedSeverity === "info") return "Low";

  const score = toFiniteNumber(riskScore) || 0;
  if (score >= 0.6) return "Moderate";
  if (score >= 0.3) return "Stable";
  return "Low";
}

function computeCurrentHdAtDemo(dMin, demoOffset, demoStep, fallbackCurrentHd) {
  const effectiveMaxD = computeEffectiveMaxD(dMin, demoOffset, demoStep);
  const normalizedMinD = toFiniteNumber(dMin);
  if (effectiveMaxD != null && normalizedMinD != null) {
    const hdAtDemo = Math.floor(effectiveMaxD - normalizedMinD + 1);
    if (hdAtDemo > 0) return hdAtDemo;
  }

  const fallback = toFiniteNumber(fallbackCurrentHd);
  if (fallback != null && fallback > 0) return Math.floor(fallback);
  return null;
}

function computeAdmittedAtDemo(demoDate, currentHdAtDemo) {
  if (!demoDate) return null;
  const hd = toFiniteNumber(currentHdAtDemo);
  if (hd == null || hd <= 0) return null;

  const demoDateStart = new Date(`${demoDate}T00:00:00.000Z`);
  if (Number.isNaN(demoDateStart.getTime())) return null;

  demoDateStart.setUTCDate(demoDateStart.getUTCDate() - (Math.floor(hd) - 1));
  return demoDateStart.toISOString();
}

function formatClockLabel(value) {
  const base = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(base.getTime())) return "--:--";
  const month = String(base.getMonth() + 1).padStart(2, "0");
  const day = String(base.getDate()).padStart(2, "0");
  const hour = String(base.getHours()).padStart(2, "0");
  const minute = String(base.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

function buildSepsisTrend24h(rows, fallbackScore = null, fallbackTimestamp = null) {
  const normalizedRows = (rows || [])
    .map((row) => {
      const timestamp = row.PREDICTION_DATETIME instanceof Date
        ? row.PREDICTION_DATETIME
        : row.PREDICTION_DATETIME
          ? new Date(row.PREDICTION_DATETIME)
          : null;
      const score = toFiniteNumber(row.RISK_SCORE);
      if (!timestamp || Number.isNaN(timestamp.getTime()) || score == null) return null;
      return { timestamp, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const fallbackTs = fallbackTimestamp ? new Date(fallbackTimestamp) : null;
  const latestTimestamp =
    normalizedRows.length > 0
      ? normalizedRows[normalizedRows.length - 1].timestamp
      : fallbackTs && !Number.isNaN(fallbackTs.getTime())
        ? fallbackTs
        : new Date();
  const latestMs = latestTimestamp.getTime();
  const startMs = latestMs - (24 * 60 * 60 * 1000);

  const recentRows = normalizedRows.filter((row) => {
    const ts = row.timestamp.getTime();
    return ts >= startMs && ts <= latestMs;
  });

  if (!recentRows.length) {
    const fallback = toFiniteNumber(fallbackScore);
    if (fallback == null) return [];
    return [
      {
        time: formatClockLabel(latestTimestamp),
        risk: Math.max(0, Math.min(100, Math.round(fallback * 100))),
        predictedAt: latestTimestamp.toISOString(),
      },
    ];
  }

  return recentRows.map((row) => ({
    time: formatClockLabel(row.timestamp),
    risk: Math.max(0, Math.min(100, Math.round((row.score || 0) * 100))),
    predictedAt: row.timestamp.toISOString(),
  }));
}

const SEPSIS_FLASK_ENABLED =
  String(process.env.SEPSIS_FLASK_ENABLED || "false").trim().toLowerCase() !== "false";
const SEPSIS_FLASK_BASE_URL =
  String(process.env.SEPSIS_FLASK_BASE_URL || "http://127.0.0.1:8002")
    .trim()
    .replace(/\/+$/, "");
const SEPSIS_FLASK_TIMEOUT_MS = Math.max(
  500,
  toFiniteNumber(process.env.SEPSIS_FLASK_TIMEOUT_MS) || 3000,
);

const SEPSIS_LEVEL_UI = {
  CRITICAL: "HIGH",
  HIGH: "HIGH",
  MEDIUM: "WARNING",
  WARNING: "WARNING",
  LOW: "LOW",
  STABLE: "LOW",
};

const SHIFT_ORDER_TO_HOUR = {
  1: 8,
  2: 16,
  3: 23,
};

function normalizeSepsisRiskLevel(raw) {
  const token = String(raw || "").trim().toUpperCase();
  if (!token) return "LOW";
  if (token === "CRITICAL") return "CRITICAL";
  if (token === "HIGH") return "HIGH";
  if (token === "MEDIUM") return "MEDIUM";
  if (token === "WARNING") return "WARNING";
  if (token === "LOW") return "LOW";
  if (token === "STABLE") return "LOW";
  return "LOW";
}

function toUiSepsisLevel(raw) {
  const normalized = normalizeSepsisRiskLevel(raw);
  return SEPSIS_LEVEL_UI[normalized] || "LOW";
}

function normalizeLabToken(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function toNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const matched = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!matched) return null;
  const parsed = Number.parseFloat(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickLatestLabValue(labs, tokenCandidates) {
  const targets = new Set(tokenCandidates.map((token) => normalizeLabToken(token)));
  for (const row of labs || []) {
    const code = normalizeLabToken(row.category);
    const name = normalizeLabToken(row.name);
    if (!targets.has(code) && !targets.has(name)) continue;
    const numeric = toNumericValue(row.value);
    if (numeric != null) return numeric;
  }
  return null;
}

function parseSepsisFactors(rawFactors) {
  const list = Array.isArray(rawFactors) ? rawFactors : [];
  return list.map((factor) => ({
    factor: factor.interpretation || factor.feature || String(factor),
    value:
      Math.abs(
        toFiniteNumber(factor.shap) ??
        toFiniteNumber(factor.contribution) ??
        0,
      ),
    rawValue: factor.value != null ? String(factor.value) : undefined,
    shap: toFiniteNumber(factor.shap),
    direction: String(factor.direction || "").toUpperCase() || undefined,
  }));
}

function buildSepsisFeatureSnapshot({
  patient,
  vitals,
  labs = [],
  lactate,
  effectiveMaxD,
  demoStep,
  demoShiftOrder,
}) {
  const hr = toFiniteNumber(vitals?.heartRate);
  const sbp = toFiniteNumber(vitals?.bloodPressureSystolic);
  const dbp = toFiniteNumber(vitals?.bloodPressureDiastolic);
  const rr = toFiniteNumber(vitals?.respiratoryRate);
  const spo2 = toFiniteNumber(vitals?.oxygenSaturation);
  const age = toFiniteNumber(patient?.age);

  const lactateValue = toFiniteNumber(lactate) ?? pickLatestLabValue(labs, ["LACTATE"]);
  const wbc = pickLatestLabValue(labs, ["WBC", "WHITEBLOODCELL", "WHITEBLOODCELLS"]);
  const creatinine = pickLatestLabValue(labs, ["CREATININE", "CREA"]);
  const platelets = pickLatestLabValue(labs, ["PLATELETS", "PLT"]);
  const bilirubin = pickLatestLabValue(labs, ["BILIRUBIN", "TBIL", "TOTALBILIRUBIN"]);
  const sodium = pickLatestLabValue(labs, ["SODIUM", "NA"]);
  const potassium = pickLatestLabValue(labs, ["POTASSIUM", "K"]);
  const ph = pickLatestLabValue(labs, ["PH"]);

  const mbp =
    sbp != null && dbp != null ? Math.round(((sbp + (2 * dbp)) / 3) * 100) / 100 : null;
  const pulsePressure = sbp != null && dbp != null ? sbp - dbp : null;
  const shockIndex = hr != null && sbp != null && sbp !== 0 ? hr / sbp : null;
  const hd = computeCurrentHdAtDemo(
    patient?._dMin,
    patient?._demoOffset,
    demoStep,
    patient?.currentHd,
  );
  const shiftHour = SHIFT_ORDER_TO_HOUR[toFiniteNumber(demoShiftOrder)] || 8;
  const observationHour =
    hd != null ? Math.max(0, ((Math.floor(hd) - 1) * 24) + shiftHour) : null;

  const snapshot = {
    hr,
    hr_max: hr,
    sbp,
    dbp,
    mbp,
    rr,
    rr_max: rr,
    spo2,
    lactate: lactateValue,
    wbc,
    creatinine,
    platelets,
    bilirubin,
    sodium,
    potassium,
    ph,
    shock_index: shockIndex,
    pulse_pressure: pulsePressure,
    anchor_age: age,
    observation_hour: observationHour,
    abga_checked: ph != null ? 1 : 0,
    icu_micu: 1,
    icu_micu_sicu: 0,
  };

  const featureSnapshot = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (value == null) continue;
    if (Number.isFinite(value)) featureSnapshot[key] = value;
  }
  return {
    featureSnapshot,
    hd: hd ?? (effectiveMaxD != null ? Math.max(1, Math.floor(effectiveMaxD)) : null),
    dNumber: effectiveMaxD != null ? Math.floor(effectiveMaxD) : null,
  };
}

function buildSepsisInferUrls() {
  const primary = `${SEPSIS_FLASK_BASE_URL}/v1/sepsis/infer`;
  const urls = [primary];
  const localhostRegex = /^(https?:\/\/)localhost(?=[:/]|$)/i;
  if (localhostRegex.test(SEPSIS_FLASK_BASE_URL)) {
    const fallbackBase = SEPSIS_FLASK_BASE_URL.replace(localhostRegex, "$1127.0.0.1");
    urls.push(`${fallbackBase}/v1/sepsis/infer`);
  }
  return Array.from(new Set(urls));
}

function formatSepsisFetchError(error) {
  const parts = [];
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").trim();
  const causeCode = String(error?.cause?.code || "").trim();
  const causeMessage = String(error?.cause?.message || "").trim();
  if (name) parts.push(name);
  if (message) parts.push(message);
  if (causeCode) parts.push(`cause=${causeCode}`);
  if (causeMessage) parts.push(`causeMessage=${causeMessage}`);
  return parts.join(" | ") || "unknown error";
}

async function callSepsisFlaskInfer(payload) {
  if (!SEPSIS_FLASK_ENABLED) return null;
  const urls = buildSepsisInferUrls();
  let lastError = null;

  for (const url of urls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEPSIS_FLASK_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = body?.message || `Flask infer failed (${res.status})`;
        throw new Error(message);
      }
      if (!body || body.status !== "ok") {
        throw new Error(body?.message || "Invalid Flask infer response");
      }
      return body;
    } catch (error) {
      lastError = `${url} :: ${formatSepsisFetchError(error)}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError || "Flask infer failed");
}

async function inferSepsisFromFlask({
  patient,
  admissionId,
  vitals,
  labs = [],
  lactate,
  effectiveMaxD,
  demoStep,
  demoShiftOrder,
}) {
  if (!SEPSIS_FLASK_ENABLED) return null;
  const { featureSnapshot, hd, dNumber } = buildSepsisFeatureSnapshot({
    patient,
    vitals,
    labs,
    lactate,
    effectiveMaxD,
    demoStep,
    demoShiftOrder,
  });
  if (Object.keys(featureSnapshot).length === 0) return null;

  try {
    const inferred = await callSepsisFlaskInfer({
      patientId: patient?.id || null,
      admissionId,
      hd,
      dNumber,
      featureSnapshot,
    });
    if (!inferred) return null;

    const normalizedLevel = normalizeSepsisRiskLevel(inferred.risk_level);
    const factors = parseSepsisFactors(inferred.contributing_factors);
    const recommendations = Array.isArray(inferred.recommendations)
      ? inferred.recommendations.map((item) => String(item)).filter(Boolean)
      : [];

    const riskScore = toFiniteNumber(inferred.risk_score);
    if (riskScore == null) return null;

    return {
      source: "flask",
      riskScore,
      riskLevel: normalizedLevel,
      riskLevelUi: toUiSepsisLevel(normalizedLevel),
      predictedAt: inferred.predicted_at || new Date().toISOString(),
      hd,
      dNumber,
      factors,
      recommendations,
      sepsisExplanation: {
        riskScore,
        factors,
        generatedAt: inferred.predicted_at || new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error("Sepsis Flask fallback error:", formatSepsisFetchError(error));
    return null;
  }
}

/**
 * infection_code 첫 글자 → 격리 체크리스트 타입 매핑
 * P (Pneumonia)  → RESP_ISOLATION
 * G (Waterborne) → GI_WATERBORNE
 * M (MDRO)       → MDRO
 * U (UTI), T (Tick-borne) → null (격리 불필요, 단 MDRO 배양 양성 시 별도 처리)
 */
function infectionCodeToChecklistType(code) {
  if (!code) return null;
  const prefix = code[0].toUpperCase();
  switch (prefix) {
    case "P": return "RESP_ISOLATION";
    case "G": return "GI_WATERBORNE";
    case "M": return "MDRO";
    default: return null;
  }
}

/** Oracle row → 기본 환자 JSON */
function formatPatientBase(row) {
  return {
    id: row.PATIENT_ID,
    name: row.NAME,
    age: row.AGE,
    gender: row.GENDER,
    infection: row.INFECTION_CODE,
    infection_type: infectionCodeToChecklistType(row.INFECTION_CODE),
    admissionDate: row.ADMIT_DATE ? row.ADMIT_DATE.toISOString() : null,
    simAdmitDate: row.SIM_ADMIT_DATE ? row.SIM_ADMIT_DATE.toISOString() : null,
    dischargeDate: row.DISCHARGE_DATE ? row.DISCHARGE_DATE.toISOString() : null,
    status:
      row.STATUS === "transferred"
        ? "transferred"
        : row.ALERT_LEVEL === "critical"
          ? "critical"
          : row.ALERT_LEVEL === "high"
            ? "warning"
            : "stable",
    currentHd: row.CURRENT_HD,
    diagnosis: row.PRIMARY_DIAGNOSIS,
    primaryDisease: row.PRIMARY_DIAGNOSIS,
    alertLevel: row.ALERT_LEVEL,
    attendingDoctor: row.ATTENDING_DOCTOR,
    attendingNurse: row.ATTENDING_NURSE,
    createdAt: row.CREATED_AT ? row.CREATED_AT.toISOString() : null,
    // 서브쿼리 매핑용 (응답에서 제거하지 않아도 FE에서 무시)
    _admissionId: row.ADMISSION_ID,
    _dMin: row.D_MIN,
    _dMax: row.D_MAX,
    _dLength: row.D_LENGTH,
    _demoOffset: row.DEMO_D_OFFSET,
  };
}

const STATUS_SUMMARY_MODEL = String(
  process.env.OPEN_AI_STATUS_SUMMARY_MODEL || "gpt-4o-mini",
).trim();
const STATUS_SUMMARY_CACHE_TTL_MS = Math.max(
  30 * 1000,
  toFiniteNumber(process.env.STATUS_SUMMARY_CACHE_TTL_MS) || 5 * 60 * 1000,
);
const statusSummaryCache = new Map();
let openaiClient = null;

function getOpenAIClient() {
  if (openaiClient) return openaiClient;

  const apiKey = String(
    process.env.OPEN_AI_API || process.env.OPENAI_API_KEY || "",
  ).trim();
  if (!apiKey) return null;

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

function mapTrajectorySeverityKo(rawSeverity) {
  const severity = normalizeTrajectorySeverity(rawSeverity);
  if (severity === "critical") return "위중";
  if (severity === "high") return "높음";
  if (severity === "medium") return "중간";
  if (severity === "low") return "낮음";
  if (severity === "info") return "정보";
  return "미상";
}

function mapSepsisLevelKo(rawLevel, rawUiLevel) {
  const ui = String(rawUiLevel || "").trim().toUpperCase();
  if (ui === "HIGH") return "고위험";
  if (ui === "WARNING") return "주의";
  if (ui === "LOW") return "저위험";

  const token = String(rawLevel || "").trim().toUpperCase();
  if (token === "CRITICAL" || token === "HIGH") return "고위험";
  if (token === "MEDIUM" || token === "WARNING") return "주의";
  if (token === "LOW" || token === "STABLE") return "저위험";
  return "미상";
}

function normalizeCompactText(value, maxLength = 140) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function pickLatestLabByTokens(labs, tokens) {
  const tokenSet = new Set(tokens.map((token) => normalizeLabToken(token)));
  for (const lab of labs || []) {
    const code = normalizeLabToken(lab.category);
    const name = normalizeLabToken(lab.name);
    const isMatch = tokenSet.has(code) || Array.from(tokenSet).some((token) => name.includes(token));
    if (!isMatch) continue;

    const numeric = toNumericValue(lab.value);
    if (numeric == null) continue;

    return {
      name: lab.name || lab.category || "",
      value: numeric,
      rawValue: String(lab.value ?? ""),
      unit: lab.unit || "",
      date: lab.date || null,
      status: lab.status || null,
    };
  }

  return null;
}

function buildStatusSummaryCacheKey({
  patientId,
  admissionId,
  demoStep,
  demoShift,
  effectiveMaxD,
  demoShiftOrder,
}) {
  return [
    String(patientId || "").trim(),
    String(admissionId || "").trim(),
    String(demoStep ?? ""),
    String(demoShift || ""),
    String(effectiveMaxD ?? ""),
    String(demoShiftOrder ?? ""),
  ].join("|");
}

function getCachedStatusSummary(cacheKey) {
  const cached = statusSummaryCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    statusSummaryCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedStatusSummary(cacheKey, payload) {
  statusSummaryCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + STATUS_SUMMARY_CACHE_TTL_MS,
  });
}

function buildStatusSummaryInput({
  patient,
  currentHdAtDemo,
  demoMeta,
  vitals,
  labs,
  sepsis,
  trajectoryRisk,
  mdroStatus,
  timeline,
}) {
  const latestVital = (vitals || [])[0] || null;
  const keyLabs = [
    pickLatestLabByTokens(labs, ["WBC"]),
    pickLatestLabByTokens(labs, ["CRP"]),
    pickLatestLabByTokens(labs, ["PROCALCITONIN", "PCT"]),
    pickLatestLabByTokens(labs, ["LACTATE", "LAC"]),
    pickLatestLabByTokens(labs, ["CREATININE", "CRE"]),
  ].filter(Boolean);

  const recentEvents = (timeline || [])
    .filter((event) => event?.date && event?.summary)
    .slice(-5)
    .reverse()
    .map((event) => ({
      at: event.date,
      title: event.title || "",
      summary: normalizeCompactText(event.summary, 110),
    }));

  const factors = (sepsis?.factors || [])
    .slice(0, 3)
    .map((factor) => ({
      factor: normalizeCompactText(factor.factor, 36),
      value: factor.rawValue ?? factor.value ?? null,
    }));

  return {
    patient: {
      id: patient.id,
      name: patient.name,
      age: patient.age,
      gender: patient.gender,
      diagnosis: patient.primaryDisease || patient.diagnosis || null,
      currentHdAtDemo: currentHdAtDemo ?? patient.currentHd ?? null,
      demoStep: demoMeta?.demoStep ?? null,
      demoShift: demoMeta?.demoShift ?? null,
      demoDate: demoMeta?.demoDate ?? null,
      demoDayLabel: demoMeta?.demoDayLabel ?? null,
    },
    vitals: latestVital
      ? {
        timestamp: latestVital.timestamp || null,
        temperature: latestVital.temperature ?? null,
        heartRate: latestVital.heartRate ?? null,
        respiratoryRate: latestVital.respiratoryRate ?? null,
        spo2: latestVital.oxygenSaturation ?? null,
        bp: latestVital.bloodPressureSystolic != null && latestVital.bloodPressureDiastolic != null
          ? `${latestVital.bloodPressureSystolic}/${latestVital.bloodPressureDiastolic}`
          : null,
      }
      : null,
    keyLabs,
    sepsis: sepsis
      ? {
        predictedAt: sepsis.predictedAt || null,
        riskScore: sepsis.riskScore ?? null,
        riskLevel: sepsis.riskLevelUi || sepsis.riskLevel || null,
        factors,
      }
      : null,
    trajectoryRisk: trajectoryRisk
      ? {
        latestSeverity: trajectoryRisk.latestSeverity || null,
        maxSeverity: trajectoryRisk.maxSeverity || null,
        eventCount: trajectoryRisk.eventCount || 0,
        lastEventAt: trajectoryRisk.lastEventAt || null,
      }
      : null,
    mdro: mdroStatus?.isMDRO
      ? {
        isMDRO: true,
        mdroType: mdroStatus.mdroType || null,
      }
      : { isMDRO: false, mdroType: null },
    recentEvents,
  };
}

function buildFallbackStatusSummary({
  patient,
  currentHdAtDemo,
  summaryInput,
}) {
  const lines = [];
  const hd = toFiniteNumber(currentHdAtDemo ?? patient.currentHd);
  const diagnosis = patient.primaryDisease || patient.diagnosis;

  lines.push(
    `${patient.name} 환자는 ${hd != null ? `입원 ${Math.max(1, Math.floor(hd))}일차` : "현재"}${
      diagnosis ? `이며, ${diagnosis} 관련 경과를 추적 중입니다.` : " 상태를 추적 중입니다."
    }`,
  );

  if (summaryInput.sepsis && summaryInput.sepsis.riskScore != null) {
    const riskPct = Math.max(0, Math.min(100, Math.round(summaryInput.sepsis.riskScore * 100)));
    const riskLabel = mapSepsisLevelKo(summaryInput.sepsis.riskLevel, summaryInput.sepsis.riskLevel);
    lines.push(
      `최근 Sepsis 위험도는 ${riskPct}%(${riskLabel})이며, 예측 시각은 ${
        summaryInput.sepsis.predictedAt ? formatClockLabel(summaryInput.sepsis.predictedAt) : "미상"
      }입니다.`,
    );
  }

  if (summaryInput.trajectoryRisk?.latestSeverity) {
    lines.push(
      `Trajectory 기준 최근 중증도는 ${mapTrajectorySeverityKo(summaryInput.trajectoryRisk.latestSeverity)} 단계이고, 누적 이벤트 ${summaryInput.trajectoryRisk.eventCount || 0}건이 기록되었습니다.`,
    );
  }

  const latestVital = summaryInput.vitals;
  if (latestVital) {
    const vitalBits = [];
    if (toFiniteNumber(latestVital.temperature) != null) vitalBits.push(`체온 ${Number(latestVital.temperature).toFixed(1)}℃`);
    if (toFiniteNumber(latestVital.heartRate) != null) vitalBits.push(`심박수 ${Math.round(Number(latestVital.heartRate))}/min`);
    if (toFiniteNumber(latestVital.respiratoryRate) != null) vitalBits.push(`호흡수 ${Math.round(Number(latestVital.respiratoryRate))}/min`);
    if (toFiniteNumber(latestVital.spo2) != null) vitalBits.push(`SpO2 ${Math.round(Number(latestVital.spo2))}%`);
    if (vitalBits.length > 0) {
      lines.push(`최신 활력징후는 ${vitalBits.join(", ")}입니다.`);
    }
  }

  if (summaryInput.mdro?.isMDRO) {
    lines.push(`${summaryInput.mdro.mdroType || "MDRO"} 관련 격리 관리가 필요한 상태입니다.`);
  }

  if (summaryInput.recentEvents && summaryInput.recentEvents.length > 0) {
    const topEvent = summaryInput.recentEvents[0];
    lines.push(`최근 이벤트: ${normalizeCompactText(topEvent.summary || topEvent.title, 80)}.`);
  }

  const unique = Array.from(new Set(lines.map((line) => normalizeCompactText(line, 180)).filter(Boolean)));
  return unique.slice(0, 3).join(" ");
}

function buildStatusSummaryPrompts(summaryInput) {
  const systemPrompt = [
    "당신은 감염내과/중환자실 의료진이 보는 환자 Trajectory 브리핑 작성자입니다.",
    "반드시 제공된 데이터만 사용하고, 없는 정보는 추정하지 마세요.",
    "진단/처방/권고를 쓰지 말고 현재 상태의 사실만 요약하세요.",
    "의료진이 5초 안에 이해할 수 있게 임상 용어는 유지하되 문장은 짧고 직관적으로 작성하세요.",
    "한국어 2~3문장으로 작성하세요.",
    "1문장: 지난 24~72시간의 전체 흐름(악화/호전/혼재/큰 변화 없음).",
    "2문장: 가장 중요한 근거 1~2개(시간, 수치 변화, 핵심 이벤트).",
    "필요 시 3문장: 현재 모니터링 포인트 1개.",
    "영문 event_type/raw key 이름은 그대로 쓰지 말고 임상 한국어로 자연스럽게 풀어 쓰세요.",
    "과장 표현, 불필요한 수식어, 장황한 배경 설명은 금지합니다.",
    "응답은 순수 본문만 출력하세요.",
  ].join("\n");

  const userPrompt = [
    "아래 JSON을 바탕으로 Trajectory 중심 환자 상태를 요약해 주세요.",
    "출력 스타일: 당직 의사 인수인계 메모 톤, 사실 중심, 즉시 판독 가능.",
    "",
    JSON.stringify(summaryInput, null, 2),
  ].join("\n");

  return { systemPrompt, userPrompt };
}

async function generateStatusSummary(summaryInput, fallbackSummary) {
  const client = getOpenAIClient();
  if (!client) {
    return {
      summary: fallbackSummary,
      source: "fallback",
      model: "fallback-rule-based",
    };
  }

  try {
    const { systemPrompt, userPrompt } = buildStatusSummaryPrompts(summaryInput);
    const response = await client.chat.completions.create({
      model: STATUS_SUMMARY_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 280,
    });

    const raw = response.choices?.[0]?.message?.content || "";
    const summary = normalizeCompactText(raw, 480);
    if (!summary) {
      return {
        summary: fallbackSummary,
        source: "fallback",
        model: "fallback-rule-based",
      };
    }

    return {
      summary,
      source: "openai",
      model: STATUS_SUMMARY_MODEL,
    };
  } catch (error) {
    console.error("[patient/status-summary] OpenAI fallback:", error.message);
    return {
      summary: fallbackSummary,
      source: "fallback",
      model: "fallback-rule-based",
      error: error.message,
    };
  }
}

// ============================================================
// 배치 조회 헬퍼 (리스트용) — Map<admissionId, data>
// ============================================================

/** 최신 바이탈 1건 per admission */
async function batchLatestVitals(admissionIds, demoStep = null, demoShiftOrder = null) {
  if (!admissionIds.length) return new Map();
  const { placeholders, binds } = buildInClause(admissionIds);
  const demoFilter = buildShiftAwareDNumberDatetimeFilter({
    demoStep,
    demoShiftOrder,
    dNumberExpr: "n.d_number",
    dMinExpr: "NVL(a.d_min, 0)",
    demoOffsetExpr: "NVL(a.demo_d_offset, 0)",
    datetimeExpr: "n.note_datetime",
  });

  const result = await db.execute(
    `SELECT admission_id, note_datetime, temp, hr, rr, bp_sys, bp_dia, spo2
     FROM (
       SELECT n.admission_id, n.note_datetime, n.temp, n.hr, n.rr, n.bp_sys, n.bp_dia, n.spo2,
              ROW_NUMBER() OVER (PARTITION BY n.admission_id ORDER BY n.note_datetime DESC) rn
       FROM nursing_notes n
       JOIN admissions a ON a.admission_id = n.admission_id
       WHERE n.admission_id IN (${placeholders})
         AND (n.temp IS NOT NULL OR n.hr IS NOT NULL)
         ${demoFilter.sql}
     ) WHERE rn = 1`,
    { ...binds, ...demoFilter.binds },
  );

  const map = new Map();
  for (const r of result.rows) {
    map.set(r.ADMISSION_ID, {
      timestamp: r.NOTE_DATETIME?.toISOString() || null,
      heartRate: r.HR,
      bloodPressureSystolic: r.BP_SYS,
      bloodPressureDiastolic: r.BP_DIA,
      oxygenSaturation: r.SPO2,
      temperature: r.TEMP,
      respiratoryRate: r.RR,
    });
  }
  return map;
}

/** 최신 패혈증 위험도 per admission */
async function batchLatestSepsis(admissionIds, demoStep = null, demoShiftOrder = null) {
  void demoStep;
  void demoShiftOrder;
  if (!admissionIds.length) return new Map();
  return new Map();
}

/** MDRO 보유 여부 per admission */
async function batchMdroStatus(admissionIds, demoStep = null, demoShiftOrder = null) {
  if (!admissionIds.length) return new Map();
  const map = new Map();

  const { placeholders, binds } = buildInClause(admissionIds, "md");
  const diagnosisDemoFilter = buildShiftAwareDNumberDatetimeFilter({
    demoStep,
    demoShiftOrder,
    dNumberExpr: "d.confirmed_d_number",
    dMinExpr: "NVL(a.d_min, 0)",
    demoOffsetExpr: "NVL(a.demo_d_offset, 0)",
    datetimeExpr: "d.confirmed_at",
  });

  try {
    const diagnosisResult = await db.execute(
      `SELECT admission_id, diagnosis_name, diagnosis_code, confirmed_at,
              confirmed_hd, confirmed_d_number, confirmed_shift
       FROM (
         SELECT
           d.admission_id,
           d.diagnosis_name,
           d.diagnosis_code,
           d.confirmed_at,
           d.confirmed_hd,
           d.confirmed_d_number,
           d.confirmed_shift,
           ROW_NUMBER() OVER (
             PARTITION BY d.admission_id
             ORDER BY d.confirmed_at DESC NULLS LAST, d.diagnosis_id DESC
           ) AS rn
         FROM infection_diagnoses d
         JOIN admissions a ON a.admission_id = d.admission_id
         WHERE d.admission_id IN (${placeholders})
           AND UPPER(NVL(d.diagnosis_group, '')) = 'MDRO'
           AND UPPER(NVL(d.status, '')) = 'CONFIRMED'
           ${diagnosisDemoFilter.sql}
       )
       WHERE rn = 1`,
      { ...binds, ...diagnosisDemoFilter.binds },
    );

    for (const row of diagnosisResult.rows) {
      map.set(
        row.ADMISSION_ID,
        buildMdroStatusPayload({
          mdroType: row.DIAGNOSIS_NAME,
          diagnosisCode: row.DIAGNOSIS_CODE,
          confirmedAt: row.CONFIRMED_AT,
          confirmedHd: row.CONFIRMED_HD,
          confirmedDNumber: row.CONFIRMED_D_NUMBER,
          confirmedShift: row.CONFIRMED_SHIFT,
        }),
      );
    }
  } catch (err) {
    const message = String(err?.message || err || "");
    if (!(message.includes("ORA-00942") || message.includes("ORA-00904"))) {
      throw err;
    }
  }

  const unresolvedAdmissionIds = admissionIds.filter((aid) => !map.has(aid));
  if (!unresolvedAdmissionIds.length) return map;

  const { placeholders: fallbackPlaceholders, binds: fallbackBinds } = buildInClause(
    unresolvedAdmissionIds,
    "mb",
  );
  const fallbackDemoFilter = buildShiftAwareDNumberDatetimeFilter({
    demoStep,
    demoShiftOrder,
    dNumberExpr: "m.d_number",
    dMinExpr: "NVL(a.d_min, 0)",
    demoOffsetExpr: "NVL(a.demo_d_offset, 0)",
    datetimeExpr: "NVL(m.result_datetime, m.collection_datetime)",
  });

  const result = await db.execute(
    `SELECT admission_id, mdro_type, confirmed_at, confirmed_hd, confirmed_d_number, confirmed_shift
     FROM (
       SELECT
         m.admission_id,
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
         ROW_NUMBER() OVER (
           PARTITION BY m.admission_id
           ORDER BY NVL(m.result_datetime, m.collection_datetime) DESC, m.result_id DESC
         ) AS rn
       FROM microbiology_results m
       JOIN admissions a ON a.admission_id = m.admission_id
       WHERE m.admission_id IN (${fallbackPlaceholders})
         AND NVL(m.is_mdro, 0) = 1
         AND UPPER(NVL(m.result_status, NVL(m.status, 'FINAL'))) IN ('FINAL', 'CONFIRMED', 'POSITIVE')
         ${fallbackDemoFilter.sql}
     )
     WHERE rn = 1`,
    { ...fallbackBinds, ...fallbackDemoFilter.binds },
  );

  for (const row of result.rows) {
    map.set(
      row.ADMISSION_ID,
      buildMdroStatusPayload({
        mdroType: row.MDRO_TYPE,
        confirmedAt: row.CONFIRMED_AT,
        confirmedHd: row.CONFIRMED_HD,
        confirmedDNumber: row.CONFIRMED_D_NUMBER,
        confirmedShift: row.CONFIRMED_SHIFT,
      }),
    );
  }

  return map;
}

/** 최신 Lactate 값 per admission */
async function batchLatestLactate(admissionIds, demoStep = null, demoShiftOrder = null) {
  if (!admissionIds.length) return new Map();
  const { placeholders, binds } = buildInClause(admissionIds);
  const demoFilter = buildShiftAwareDNumberDatetimeFilter({
    demoStep,
    demoShiftOrder,
    dNumberExpr: "l.d_number",
    dMinExpr: "NVL(a.d_min, 0)",
    demoOffsetExpr: "NVL(a.demo_d_offset, 0)",
    datetimeExpr: "l.result_datetime",
  });

  const result = await db.execute(
    `SELECT admission_id, value
     FROM (
       SELECT l.admission_id, l.value,
              ROW_NUMBER() OVER (PARTITION BY l.admission_id ORDER BY l.result_datetime DESC) rn
       FROM lab_results l
       JOIN admissions a ON a.admission_id = l.admission_id
       WHERE l.admission_id IN (${placeholders})
         AND l.item_code = 'LACTATE'
         ${demoFilter.sql}
     ) WHERE rn = 1`,
    { ...binds, ...demoFilter.binds },
  );

  const map = new Map();
  for (const r of result.rows) {
    map.set(r.ADMISSION_ID, parseFloat(r.VALUE) || null);
  }
  return map;
}

/** care gap 신호 per admission (trajectory_events 기반) */
async function batchCareGapSignals(admissionIds, demoStep = null, demoShiftOrder = null) {
  if (!admissionIds.length) return new Map();
  const { placeholders, binds } = buildInClause(admissionIds, "cg");

  const result = await db.execute(
    `SELECT te.admission_id,
            MAX(
              CASE
                WHEN LOWER(NVL(te.event_type, '')) IN (
                  'isolation_gap',
                  'notify_first_seen',
                  'prn_increase',
                  'monitoring_escalated',
                  'vitals_frequency_escalated'
                ) THEN 1
                ELSE 0
              END
            ) AS has_care_gap
     FROM trajectory_events te
     JOIN admissions a ON a.admission_id = te.admission_id
     WHERE te.admission_id IN (${placeholders})
       AND (
         :demoStep IS NULL OR
         (
           te.d_number <= (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
           AND (
             :demoShiftOrder IS NULL
             OR te.d_number < (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
             OR (
               te.d_number = (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
               AND CASE UPPER(NVL(te.shift, ''))
                     WHEN 'DAY' THEN 1
                     WHEN 'EVENING' THEN 2
                     WHEN 'NIGHT' THEN 3
                     ELSE 99
                   END <= :demoShiftOrder
             )
           )
         )
       )
     GROUP BY te.admission_id`,
    { ...binds, demoStep, demoShiftOrder },
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.ADMISSION_ID, Number(row.HAS_CARE_GAP || 0) > 0);
  }
  return map;
}

/** pending lab 신호 per admission (microbiology pending 기반) */
async function batchPendingLabSignals(admissionIds, demoStep = null, demoShiftOrder = null) {
  if (!admissionIds.length) return new Map();
  const { placeholders, binds } = buildInClause(admissionIds, "pl");
  const demoFilter = buildShiftAwareDNumberDatetimeFilter({
    demoStep,
    demoShiftOrder,
    dNumberExpr: "m.d_number",
    dMinExpr: "NVL(a.d_min, 0)",
    demoOffsetExpr: "NVL(a.demo_d_offset, 0)",
    datetimeExpr: "m.collection_datetime",
  });

  const result = await db.execute(
    `SELECT m.admission_id,
            MAX(
              CASE
                WHEN UPPER(NVL(m.result_status, NVL(m.status, ''))) = 'PENDING' THEN 1
                ELSE 0
              END
            ) AS has_pending
     FROM microbiology_results m
     JOIN admissions a ON a.admission_id = m.admission_id
     WHERE m.admission_id IN (${placeholders})
       ${demoFilter.sql}
     GROUP BY m.admission_id`,
    { ...binds, ...demoFilter.binds },
  );

  const map = new Map();
  for (const row of result.rows) {
    map.set(row.ADMISSION_ID, Number(row.HAS_PENDING || 0) > 0);
  }
  return map;
}

/** trajectory severity 요약 per admission */
async function batchTrajectoryRisk(admissionIds, demoStep = null, demoShiftOrder = null) {
  if (!admissionIds.length) return new Map();
  const { placeholders, binds } = buildInClause(admissionIds, "t");

  const result = await db.execute(
    `SELECT te.admission_id, te.severity, te.event_datetime, te.d_number, te.shift,
            te.event_type, te.axis_type, te.render_text
     FROM trajectory_events te
     JOIN admissions a ON a.admission_id = te.admission_id
     WHERE te.admission_id IN (${placeholders})
       AND (
         :demoStep IS NULL OR
         (
           te.d_number <= (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
           AND (
             :demoShiftOrder IS NULL
             OR te.d_number < (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
             OR (
               te.d_number = (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
               AND CASE UPPER(NVL(te.shift, ''))
                     WHEN 'DAY' THEN 1
                     WHEN 'EVENING' THEN 2
                     WHEN 'NIGHT' THEN 3
                     ELSE 99
                   END <= :demoShiftOrder
             )
           )
         )
       )
     ORDER BY te.admission_id, te.event_datetime DESC`,
    { ...binds, demoStep, demoShiftOrder },
  );

  const map = new Map();
  for (const r of result.rows) {
    const aid = r.ADMISSION_ID;
    const sev = normalizeTrajectorySeverity(r.SEVERITY);
    if (!sev) continue;

    const eventAt = r.EVENT_DATETIME ? r.EVENT_DATETIME.toISOString() : null;
    const eventAtMs = r.EVENT_DATETIME ? r.EVENT_DATETIME.getTime() : null;
    const eventLabel = normalizeTrajectoryEventLabel(
      r.RENDER_TEXT,
      r.EVENT_TYPE,
      r.AXIS_TYPE,
    );

    let entry = map.get(aid);
    if (!entry) {
      entry = {
        maxSeverity: sev,
        latestSeverity: sev,
        eventCount: 0,
        lastEventAt: eventAt,
        riskTrend: [],
        _maxRank: TRAJECTORY_SEVERITY_RANK[sev] || 0,
        _lastEventMs: eventAtMs || 0,
        _trendByBucket: new Map(),
        _latestEventLabel: eventLabel || null,
        _topIssueLabels: [],
      };
      map.set(aid, entry);
    } else if (!entry._latestEventLabel && eventLabel) {
      entry._latestEventLabel = eventLabel;
    }

    entry.eventCount += 1;

    const rank = TRAJECTORY_SEVERITY_RANK[sev] || 0;
    if (rank >= (TRAJECTORY_SEVERITY_RANK.medium || 3) && eventLabel) {
      const normalized = eventLabel.trim();
      if (normalized && !entry._topIssueLabels.includes(normalized)) {
        entry._topIssueLabels.push(normalized);
      }
    }
    if (rank > entry._maxRank) {
      entry._maxRank = rank;
      entry.maxSeverity = sev;
    }

    if (eventAtMs != null && eventAtMs > entry._lastEventMs) {
      entry._lastEventMs = eventAtMs;
      entry.latestSeverity = sev;
      entry.lastEventAt = eventAt;
    }

    const dNumber = toFiniteNumber(r.D_NUMBER);
    if (dNumber != null) {
      const shiftOrder = getTrajectoryShiftOrder(r.SHIFT);
      const bucketKey = `${dNumber}|${shiftOrder}`;
      const currentRank = TRAJECTORY_SEVERITY_RANK[sev] || 0;
      const existing = entry._trendByBucket.get(bucketKey);
      const existingRank = existing ? TRAJECTORY_SEVERITY_RANK[existing.severity] || 0 : -1;

      if (!existing || currentRank > existingRank) {
        entry._trendByBucket.set(bucketKey, {
          dNumber: Math.floor(dNumber),
          shiftOrder,
          shift: getTrajectoryShiftLabel(shiftOrder),
          severity: sev,
          score: TRAJECTORY_SEVERITY_SCORE[sev] || 0,
          eventAt,
          _eventAtMs: eventAtMs || 0,
        });
      } else if (existing && eventAtMs != null && eventAtMs > (existing._eventAtMs || 0)) {
        existing.eventAt = eventAt;
        existing._eventAtMs = eventAtMs;
      }
    }
  }

  // 내부 계산 필드 제거
  for (const [aid, entry] of map.entries()) {
    const trendPoints = Array.from(entry._trendByBucket.values())
      .sort((a, b) => {
        if (a.dNumber !== b.dNumber) return a.dNumber - b.dNumber;
        if (a.shiftOrder !== b.shiftOrder) return a.shiftOrder - b.shiftOrder;
        return (a._eventAtMs || 0) - (b._eventAtMs || 0);
      })
      .slice(-5)
      .map((point) => ({
        dNumber: point.dNumber,
        shift: point.shift,
        severity: point.severity,
        score: point.score,
        eventAt: point.eventAt || null,
      }));

    const issueLabels = Array.from(new Set(entry._topIssueLabels || []))
      .filter(Boolean)
      .slice(0, 2);
    if (
      issueLabels.length === 0 &&
      entry._latestEventLabel &&
      (TRAJECTORY_SEVERITY_RANK[entry.latestSeverity] || 0) >= (TRAJECTORY_SEVERITY_RANK.medium || 3)
    ) {
      issueLabels.push(entry._latestEventLabel);
    }

    map.set(aid, {
      maxSeverity: entry.maxSeverity,
      latestSeverity: entry.latestSeverity,
      eventCount: entry.eventCount,
      lastEventAt: entry.lastEventAt,
      riskTrend: trendPoints,
      latestEventLabel: entry._latestEventLabel || null,
      topIssueLabels: issueLabels,
    });
  }

  return map;
}

/** 병상/병실/병동 정보 per patient_id */
async function batchBedInfo(patientIds) {
  if (!patientIds.length) return new Map();
  const { placeholders, binds } = buildInClause(patientIds, "p");

  const result = await db.execute(
    `SELECT
        src.patient_id,
        r.room_number,
        w.ward_id,
        w.ward_name,
        w.floor,
        src.priority
     FROM (
       SELECT
         b.patient_id AS patient_id,
         b.bed_id     AS bed_id,
         1            AS priority
       FROM beds b
       WHERE b.patient_id IN (${placeholders})

       UNION ALL

       SELECT
         ps.patient_id     AS patient_id,
         ps.current_bed_id AS bed_id,
         2                 AS priority
       FROM patient_status ps
       WHERE ps.patient_id IN (${placeholders})
         AND ps.current_bed_id IS NOT NULL
     ) src
     JOIN beds b   ON b.bed_id = src.bed_id
     JOIN rooms r  ON b.room_id = r.room_id
     JOIN wards w  ON r.ward_id = w.ward_id
     ORDER BY src.patient_id, src.priority`,
    binds,
  );

  const map = new Map();
  for (const r of result.rows) {
    if (map.has(r.PATIENT_ID)) continue;
    map.set(r.PATIENT_ID, {
      roomNumber: r.ROOM_NUMBER,
      ward: r.WARD_NAME || r.WARD_ID,
      floor: r.FLOOR ? `${r.FLOOR}F` : null,
    });
  }
  return map;
}

// ============================================================
// 상세 조회 헬퍼 (단일 환자)
// ============================================================

/** 전체 바이탈 기록 */
async function fetchVitals(admissionId, demoContext = null) {
  const effectiveMaxD = toFiniteNumber(demoContext?.effectiveMaxD);
  const demoShiftOrder = toFiniteNumber(demoContext?.demoShiftOrder);
  const demoFilter = buildShiftAwareEffectiveDFilter({
    effectiveMaxD,
    demoShiftOrder,
    dNumberExpr: "n.d_number",
    datetimeExpr: "n.note_datetime",
  });
  const binds = { aid: admissionId, ...demoFilter.binds };

  const result = await db.execute(
    `SELECT note_datetime, temp, hr, rr, bp_sys, bp_dia, spo2
     FROM nursing_notes n
     WHERE n.admission_id = :aid
       ${demoFilter.sql}
       AND (n.temp IS NOT NULL OR n.hr IS NOT NULL)
     ORDER BY n.note_datetime DESC`,
    binds,
  );

  return result.rows.map((r) => ({
    timestamp: r.NOTE_DATETIME?.toISOString() || null,
    heartRate: r.HR,
    bloodPressureSystolic: r.BP_SYS,
    bloodPressureDiastolic: r.BP_DIA,
    oxygenSaturation: r.SPO2,
    temperature: r.TEMP,
    respiratoryRate: r.RR,
  }));
}

/** 전체 검사 결과 */
async function fetchLabResults(admissionId, demoContext = null) {
  const effectiveMaxD = toFiniteNumber(demoContext?.effectiveMaxD);
  const demoShiftOrder = toFiniteNumber(demoContext?.demoShiftOrder);
  const demoFilter = buildShiftAwareEffectiveDFilter({
    effectiveMaxD,
    demoShiftOrder,
    dNumberExpr: "l.d_number",
    datetimeExpr: "l.result_datetime",
  });
  const binds = { aid: admissionId, ...demoFilter.binds };

  const result = await db.execute(
    `SELECT result_id, result_datetime, item_code, item_name, value, unit,
            reference_range, is_abnormal
     FROM lab_results l
     WHERE l.admission_id = :aid
       ${demoFilter.sql}
     ORDER BY l.result_datetime DESC, l.item_code`,
    binds,
  );

  return result.rows.map((r) => ({
    id: String(r.RESULT_ID),
    category: r.ITEM_CODE,
    name: r.ITEM_NAME,
    value: r.VALUE,
    unit: r.UNIT,
    normalRange: r.REFERENCE_RANGE || "",
    status: r.IS_ABNORMAL ? "high" : "normal",
    date: r.RESULT_DATETIME?.toISOString() || null,
  }));
}

/** 전체 영상 결과 */
async function fetchImagingResults(admissionId, demoContext = null) {
  const effectiveMaxD = toFiniteNumber(demoContext?.effectiveMaxD);
  const demoShiftOrder = toFiniteNumber(demoContext?.demoShiftOrder);
  const demoFilter = buildShiftAwareEffectiveDFilter({
    effectiveMaxD,
    demoShiftOrder,
    dNumberExpr: "r.d_number",
    datetimeExpr: "r.study_datetime",
  });
  const binds = { aid: admissionId, ...demoFilter.binds };

  const result = await db.execute(
    `SELECT report_id, study_type, study_datetime, findings, conclusion, severity_score
     FROM radiology_reports r
     WHERE r.admission_id = :aid
       ${demoFilter.sql}
     ORDER BY r.study_datetime DESC`,
    binds,
  );

  return result.rows.map((r) => ({
    id: String(r.REPORT_ID),
    type: r.STUDY_TYPE,
    date: r.STUDY_DATETIME?.toISOString() || null,
    findings: r.FINDINGS || "",
    impression: r.CONCLUSION || "",
    status: r.SEVERITY_SCORE === "severe" ? "abnormal" : "normal",
  }));
}

/** 전체 배양 결과 */
async function fetchCultureResults(admissionId, demoContext = null) {
  const effectiveMaxD = toFiniteNumber(demoContext?.effectiveMaxD);
  const demoShiftOrder = toFiniteNumber(demoContext?.demoShiftOrder);
  const demoFilter = buildShiftAwareEffectiveDFilter({
    effectiveMaxD,
    demoShiftOrder,
    dNumberExpr: "m.d_number",
    datetimeExpr: "m.collection_datetime",
  });
  const binds = { aid: admissionId, ...demoFilter.binds };

  const result = await db.execute(
    `SELECT result_id, specimen_type, collection_datetime, organism,
            result_status, susceptibility_json, is_mdro, mdro_type
     FROM microbiology_results m
     WHERE m.admission_id = :aid
       ${demoFilter.sql}
     ORDER BY m.collection_datetime DESC`,
    binds,
  );

  return result.rows.map((r) => {
    let sensitivity = [];
    if (r.SUSCEPTIBILITY_JSON) {
      try {
        const parsed = JSON.parse(r.SUSCEPTIBILITY_JSON);
        sensitivity = parsed
          .filter((s) => s.interpretation === "S" || s.result === "S")
          .map((s) => s.antibiotic || s.drug || s.name);
      } catch {
        /* ignore */
      }
    }
    return {
      id: String(r.RESULT_ID),
      specimen: r.SPECIMEN_TYPE,
      date: r.COLLECTION_DATETIME?.toISOString() || null,
      organism: r.ORGANISM || "",
      result:
        r.RESULT_STATUS === "FINAL" && r.ORGANISM
          ? "positive"
          : r.RESULT_STATUS === "PENDING"
            ? "pending"
            : "negative",
      sensitivity,
    };
  });
}

/** 최신 패혈증 점수 + 설명 */
async function fetchSepsisScore(admissionId, demoContext = null) {
  void admissionId;
  void demoContext;
  return null;
}

async function fetchSepsisHistory(admissionId, demoContext = null) {
  void admissionId;
  void demoContext;
  return [];
}

async function getSepsisForAdmission({
  patient,
  admissionId,
  vitals,
  labs = [],
  lactate,
  demoContext = null,
  demoStep = null,
}) {
  let sepsis = await fetchSepsisScore(admissionId, demoContext);
  if (sepsis) return sepsis;

  const inferred = await inferSepsisFromFlask({
    patient,
    admissionId,
    vitals,
    labs,
    lactate,
    effectiveMaxD: toFiniteNumber(demoContext?.effectiveMaxD),
    demoStep,
    demoShiftOrder: toFiniteNumber(demoContext?.demoShiftOrder),
  });
  return inferred || null;
}

/** trajectory 이벤트 (타임라인) */
async function fetchTimeline(admissionId, demoContext = null) {
  const effectiveMaxD = toFiniteNumber(demoContext?.effectiveMaxD);
  const demoShiftOrder = toFiniteNumber(demoContext?.demoShiftOrder);
  const binds = { aid: admissionId };
  let demoSql = "";

  if (effectiveMaxD != null) {
    binds.effectiveMaxD = effectiveMaxD;
    demoSql += " AND d_number <= :effectiveMaxD";
  }

  if (effectiveMaxD != null && demoShiftOrder != null) {
    binds.demoShiftOrder = demoShiftOrder;
    demoSql += `
      AND (
        d_number < :effectiveMaxD
        OR (
          d_number = :effectiveMaxD
          AND CASE UPPER(NVL(shift, ''))
                WHEN 'DAY' THEN 1
                WHEN 'EVENING' THEN 2
                WHEN 'NIGHT' THEN 3
                ELSE 99
              END <= :demoShiftOrder
        )
      )
    `;
  }

  const result = await db.execute(
    `SELECT event_id, event_type, event_datetime, axis_type, render_text, severity
     FROM trajectory_events
     WHERE admission_id = :aid
       ${demoSql}
     ORDER BY event_datetime ASC`,
    binds,
  );

  const typeMap = {
    infection: "culture",
    respiratory: "imaging",
    lab: "lab",
    clinical_action: "note",
  };

  return result.rows.map((r) => ({
    id: String(r.EVENT_ID),
    date: r.EVENT_DATETIME?.toISOString() || null,
    type: typeMap[r.AXIS_TYPE] || "note",
    title: r.EVENT_TYPE,
    summary: r.RENDER_TEXT || "",
    nlpChips: [],
  }));
}

/** 단일 환자 병상 정보 */
async function fetchBedInfoSingle(patientId) {
  const result = await db.execute(
    `SELECT room_number, ward_id, ward_name, floor
     FROM (
       SELECT
         r.room_number,
         w.ward_id,
         w.ward_name,
         w.floor,
         1 AS priority
       FROM beds b
       JOIN rooms r ON b.room_id = r.room_id
       JOIN wards w ON r.ward_id = w.ward_id
       WHERE b.patient_id = :pid

       UNION ALL

       SELECT
         r.room_number,
         w.ward_id,
         w.ward_name,
         w.floor,
         2 AS priority
       FROM patient_status ps
       JOIN beds b ON b.bed_id = ps.current_bed_id
       JOIN rooms r ON b.room_id = r.room_id
       JOIN wards w ON r.ward_id = w.ward_id
       WHERE ps.patient_id = :pid
         AND ps.current_bed_id IS NOT NULL
     )
     ORDER BY priority
     FETCH FIRST 1 ROWS ONLY`,
    { pid: patientId },
  );

  if (!result.rows.length) return null;
  const r = result.rows[0];
  return {
    roomNumber: r.ROOM_NUMBER,
    ward: r.WARD_NAME || r.WARD_ID,
    floor: r.FLOOR ? `${r.FLOOR}F` : null,
  };
}

// ============================================================
// GET /api/patients — 전체 환자 목록 (풍부한 데이터)
// ============================================================
router.get("/", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const demoShiftOrder = getShiftOrder(req.demoShift);

    // 1. 기본 정보: patients + admissions
    const baseResult = await db.execute(
      `
      SELECT
        p.patient_id, p.name, p.age, p.gender, p.infection_code, p.created_at,
        a.admission_id, a.admit_date, a.sim_admit_date, a.discharge_date,
        a.status, a.current_hd, a.primary_diagnosis,
        a.alert_level, a.attending_doctor, a.attending_nurse,
        a.demo_d_offset, a.d_min, a.d_max, a.d_length
      FROM patients p
      LEFT JOIN (
        SELECT * FROM (
            SELECT a.*, ROW_NUMBER() OVER (PARTITION BY patient_id ORDER BY admit_date DESC) as rn
            FROM admissions a
        ) adm WHERE rn = 1
          AND (
            :demoStep IS NULL OR
            (
              :demoStep >= NVL(demo_d_offset, 0) + 1
              AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
              AND (
                :demoShiftOrder IS NULL OR EXISTS (
                  SELECT 1
                  FROM trajectory_events te
                  WHERE te.admission_id = adm.admission_id
                    AND te.d_number <= (NVL(adm.d_min, 0) + (:demoStep - NVL(adm.demo_d_offset, 0) - 1))
                    AND (
                      te.d_number < (NVL(adm.d_min, 0) + (:demoStep - NVL(adm.demo_d_offset, 0) - 1))
                      OR (
                        te.d_number = (NVL(adm.d_min, 0) + (:demoStep - NVL(adm.demo_d_offset, 0) - 1))
                        AND CASE UPPER(NVL(te.shift, ''))
                              WHEN 'DAY' THEN 1
                              WHEN 'EVENING' THEN 2
                              WHEN 'NIGHT' THEN 3
                              ELSE 99
                            END <= :demoShiftOrder
                      )
                    )
                )
              )
            )
          )
      ) a ON p.patient_id = a.patient_id
      ORDER BY p.patient_id
    `,
      { demoStep, demoShiftOrder },
    );

    let patients = baseResult.rows.map(formatPatientBase);
    if (req.demoEnabled) {
      patients = patients.filter((p) => Boolean(p._admissionId));
    }

    // 2. admission_id / patient_id 수집
    const admissionIds = patients.map((p) => p._admissionId).filter(Boolean);
    const patientIds = patients.map((p) => p.id);

    // 3. 배치 서브쿼리 병렬 실행
    const [vitalsMap, sepsisMap, mdroMap, lactateMap, bedMap, trajectoryRiskMap, careGapMap, pendingLabMap] =
      await Promise.all([
        batchLatestVitals(admissionIds, demoStep, demoShiftOrder),
        batchLatestSepsis(admissionIds, demoStep, demoShiftOrder),
        batchMdroStatus(admissionIds, demoStep, demoShiftOrder),
        batchLatestLactate(admissionIds, demoStep, demoShiftOrder),
        batchBedInfo(patientIds),
        batchTrajectoryRisk(admissionIds, demoStep, demoShiftOrder),
        batchCareGapSignals(admissionIds, demoStep, demoShiftOrder),
        batchPendingLabSignals(admissionIds, demoStep, demoShiftOrder),
      ]);

    const missingSepsisPatients = patients.filter(
      (patient) => patient._admissionId && !sepsisMap.has(patient._admissionId),
    );
    if (missingSepsisPatients.length > 0) {
      await Promise.all(
        missingSepsisPatients.map(async (patient) => {
          const admissionId = patient._admissionId;
          const effectiveMaxD = computeEffectiveMaxD(
            patient._dMin,
            patient._demoOffset,
            demoStep,
          );
          const inferred = await inferSepsisFromFlask({
            patient,
            admissionId,
            vitals: vitalsMap.get(admissionId) || null,
            labs: [],
            lactate: lactateMap.get(admissionId) ?? null,
            effectiveMaxD,
            demoStep,
            demoShiftOrder,
          });
          if (inferred) {
            sepsisMap.set(admissionId, inferred);
          }
        }),
      );
    }

    // 4. 병합
    const enriched = patients.map((p) => {
      const aid = p._admissionId;
      const vital = vitalsMap.get(aid);
      const sepsis = sepsisMap.get(aid);
      const mdro = mdroMap.get(aid);
      const lactate = lactateMap.get(aid);
      const bed = bedMap.get(p.id);
      const trajectoryRisk = trajectoryRiskMap.get(aid) || null;
      const hasCareGapSignal = careGapMap.get(aid) || false;
      const hasPendingLabSignal = pendingLabMap.get(aid) || false;
      const trajectoryDisplaySeverity =
        trajectoryRisk?.latestSeverity || trajectoryRisk?.maxSeverity || null;
      const demoMeta = buildDemoMeta({
        demoStep,
        demoShift: req.demoShift,
        demoBaseDate: req.demoBaseDate,
        dMin: p._dMin,
        demoOffset: p._demoOffset,
      });
      const currentHdAtDemo = computeCurrentHdAtDemo(
        p._dMin,
        p._demoOffset,
        demoStep,
        p.currentHd,
      );
      const admittedAtDemo = computeAdmittedAtDemo(
        demoMeta?.demoDate || null,
        currentHdAtDemo,
      );
      const statusAtDemo = mapDashboardStatusFromTrajectory(
        p.status,
        trajectoryDisplaySeverity,
      );
      const riskLevelAtDemo = mapRiskLevelFromTrajectoryAndScore(
        statusAtDemo,
        trajectoryDisplaySeverity,
        sepsis?.riskScore ?? null,
      );

      return {
        ...p,
        status: statusAtDemo,
        statusAtDemo,
        riskLevelAtDemo,
        currentHdAtDemo,
        admittedAtDemo,
        hasCareGapSignal,
        hasPendingLabSignal,
        // 병상 정보
        roomNumber: bed?.roomNumber || null,
        ward: bed?.ward || null,
        floor: bed?.floor || null,
        trajectoryRisk,
        // 최신 바이탈 (배열 형태)
        vitals: vital ? [vital] : [],
        // 패혈증 위험도
        riskScore: sepsis?.riskScore ?? null,
        sepsisExplanation: sepsis?.sepsisExplanation || null,
        // MDRO
        mdroStatus: mdro || {
          isMDRO: false,
          mdroType: null,
          isolationRequired: false,
          isolationImplemented: false,
          confirmedAt: null,
          confirmedHd: null,
          confirmedDNumber: null,
          confirmedShift: null,
        },
        // Lactate
        lactate: lactate ?? null,
        // 빈 배열 (리스트에서는 상세 데이터 미포함)
        labResults: [],
        imagingResults: [],
        cultureResults: [],
        timeline: [],
        ...(demoMeta || {}),
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("GET /api/patients error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/patients/summary — 대시보드 KPI 집계 (shift-aware)
// ============================================================
router.get("/summary", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const demoShift = req.demoShift ?? null;
    const demoShiftOrder = getShiftOrder(req.demoShift);
    const requestedPatientIds = parseCsvParam(req.query.patientIds);

    const baseBinds = {
      demoStep,
      demoShiftOrder,
    };

    let patientFilterSql = "";
    if (requestedPatientIds.length) {
      const { placeholders, binds } = buildInClause(requestedPatientIds, "pid");
      patientFilterSql = ` AND a.patient_id IN (${placeholders})`;
      Object.assign(baseBinds, binds);
    }

    const scopeResult = await db.execute(
      `
      SELECT scope.patient_id,
             scope.admission_id
      FROM (
        SELECT a.patient_id,
               a.admission_id,
               a.d_min,
               a.demo_d_offset,
               a.d_length,
               ROW_NUMBER() OVER (
                 PARTITION BY a.patient_id
                 ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
               ) rn
        FROM admissions a
        WHERE 1 = 1
          ${patientFilterSql}
      ) scope
      WHERE scope.rn = 1
        AND (
          :demoStep IS NULL OR
          (
            :demoStep >= NVL(scope.demo_d_offset, 0) + 1
            AND :demoStep <= NVL(scope.demo_d_offset, 0) + NVL(scope.d_length, 0)
            AND (
              :demoShiftOrder IS NULL OR EXISTS (
                SELECT 1
                FROM trajectory_events te
                WHERE te.admission_id = scope.admission_id
                  AND te.d_number <= (NVL(scope.d_min, 0) + (:demoStep - NVL(scope.demo_d_offset, 0) - 1))
                  AND (
                    te.d_number < (NVL(scope.d_min, 0) + (:demoStep - NVL(scope.demo_d_offset, 0) - 1))
                    OR (
                      te.d_number = (NVL(scope.d_min, 0) + (:demoStep - NVL(scope.demo_d_offset, 0) - 1))
                      AND CASE UPPER(NVL(te.shift, ''))
                            WHEN 'DAY' THEN 1
                            WHEN 'EVENING' THEN 2
                            WHEN 'NIGHT' THEN 3
                            ELSE 99
                          END <= :demoShiftOrder
                    )
                  )
              )
            )
          )
        )
    `,
      baseBinds,
    );

    if (!scopeResult.rows.length) {
      return res.json({
        meta: {
          patientCount: 0,
          admissionCount: 0,
          demoStep,
          demoShift,
          referenceNow: null,
        },
        data: {
          highRiskPatientCount: 0,
          criticalPatientCount: 0,
          highRiskDelta: 0,
          criticalEventsCount: 0,
          criticalEventsRecent2h: 0,
          mdroUpdatedCount: 0,
          mdroBreakdown: { cre: 0, vre: 0, mrsa: 0, other: 0 },
          pendingResultsCount: 0,
          transferIcuCandidateCount: 0,
          transferClassification: { icu: 0, transfer: 0 },
        },
      });
    }

    const admissionIds = scopeResult.rows.map((row) => row.ADMISSION_ID);
    const { placeholders: admissionPlaceholders, binds: admissionBinds } =
      buildInClause(admissionIds, "aid");

    const commonBinds = {
      ...admissionBinds,
    };
    if (demoStep != null) {
      commonBinds.demoStep = demoStep;
    }

    const trajectoryMetricBinds = {
      ...commonBinds,
    };
    if (demoStep != null && demoShiftOrder != null) {
      trajectoryMetricBinds.demoShiftOrder = demoShiftOrder;
    }

    const demoTrajectoryFilterSql =
      demoStep == null
        ? ""
        : `
          AND te.d_number <= (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
          ${demoShiftOrder == null
          ? ""
          : `
          AND (
            te.d_number < (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
            OR (
              te.d_number = (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))
              AND CASE UPPER(NVL(te.shift, ''))
                    WHEN 'DAY' THEN 1
                    WHEN 'EVENING' THEN 2
                    WHEN 'NIGHT' THEN 3
                    ELSE 99
                  END <= :demoShiftOrder
            )
          )`
        }
        `;

    const referenceResult = await db.execute(
      `SELECT MAX(te.event_datetime) AS reference_now
       FROM trajectory_events te
       JOIN admissions a ON a.admission_id = te.admission_id
       WHERE te.admission_id IN (${admissionPlaceholders})
         ${demoTrajectoryFilterSql}`,
      trajectoryMetricBinds,
    );

    let referenceNow = referenceResult.rows[0]?.REFERENCE_NOW || null;
    if (!referenceNow) {
      const nowResult = await db.execute(
        "SELECT CURRENT_TIMESTAMP AS reference_now FROM dual",
      );
      referenceNow = nowResult.rows[0]?.REFERENCE_NOW || null;
    }
    trajectoryMetricBinds.referenceNow = referenceNow;
    const nonShiftMetricBinds = {
      ...commonBinds,
      referenceNow,
    };
    const previousCutoff = shiftTimestamp(referenceNow, -24);
    const criticalWindowStart = shiftTimestamp(referenceNow, -12);
    const criticalRecentStart = shiftTimestamp(referenceNow, -2);
    const mdroWindowStart = shiftTimestamp(referenceNow, -72);
    const destabilizingWindowStart = shiftTimestamp(referenceNow, -24);

    const severityRankSql = `CASE LOWER(NVL(te.severity, ''))
      WHEN 'critical' THEN 5
      WHEN 'high' THEN 4
      WHEN 'medium' THEN 3
      WHEN 'low' THEN 2
      WHEN 'info' THEN 1
      ELSE 0
    END`;

    const previousWindowSql =
      demoStep == null
        ? "te.event_datetime <= :previousCutoff"
        : "te.d_number <= (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 2))";

    const riskSummaryBinds = { ...trajectoryMetricBinds };
    if (demoStep == null) {
      riskSummaryBinds.previousCutoff = previousCutoff;
    }

    const riskSummaryResult = await db.execute(
      `SELECT te.admission_id,
              MAX(CASE WHEN ${severityRankSql} >= 4 THEN 1 ELSE 0 END) AS high_now,
              MAX(CASE WHEN ${severityRankSql} >= 5 THEN 1 ELSE 0 END) AS critical_now,
              MAX(CASE WHEN (${previousWindowSql}) AND ${severityRankSql} >= 4 THEN 1 ELSE 0 END) AS high_prev
       FROM trajectory_events te
       JOIN admissions a ON a.admission_id = te.admission_id
       WHERE te.admission_id IN (${admissionPlaceholders})
         AND te.event_datetime <= :referenceNow
         ${demoTrajectoryFilterSql}
       GROUP BY te.admission_id`,
      riskSummaryBinds,
    );

    const criticalEventsBinds = {
      ...trajectoryMetricBinds,
      criticalWindowStart,
      criticalRecentStart,
    };

    const criticalEventsResult = await db.execute(
      `SELECT
          SUM(CASE
                WHEN LOWER(NVL(te.severity, '')) = 'critical'
                 AND te.event_datetime >= :criticalWindowStart
                THEN 1 ELSE 0
              END) AS critical_events_12h,
          SUM(CASE
                WHEN LOWER(NVL(te.severity, '')) = 'critical'
                 AND te.event_datetime >= :criticalRecentStart
                THEN 1 ELSE 0
              END) AS critical_events_2h
       FROM trajectory_events te
       JOIN admissions a ON a.admission_id = te.admission_id
       WHERE te.admission_id IN (${admissionPlaceholders})
         AND te.event_datetime <= :referenceNow
         ${demoTrajectoryFilterSql}`,
      criticalEventsBinds,
    );

    const demoMicroFilterSql =
      demoStep == null
        ? ""
        : " AND m.d_number <= (NVL(a.d_min, 0) + (:demoStep - NVL(a.demo_d_offset, 0) - 1))";

    const mdroBinds = {
      ...nonShiftMetricBinds,
      mdroWindowStart,
    };

    const mdroResult = await db.execute(
      `SELECT
          COUNT(DISTINCT m.admission_id) AS mdro_total,
          COUNT(DISTINCT CASE WHEN UPPER(NVL(m.mdro_type, '')) = 'CRE' THEN m.admission_id END) AS mdro_cre,
          COUNT(DISTINCT CASE WHEN UPPER(NVL(m.mdro_type, '')) = 'VRE' THEN m.admission_id END) AS mdro_vre,
          COUNT(DISTINCT CASE WHEN UPPER(NVL(m.mdro_type, '')) = 'MRSA' THEN m.admission_id END) AS mdro_mrsa
       FROM microbiology_results m
       JOIN admissions a ON a.admission_id = m.admission_id
       WHERE m.admission_id IN (${admissionPlaceholders})
         AND m.is_mdro = 1
         AND m.collection_datetime <= :referenceNow
         AND m.collection_datetime >= :mdroWindowStart
         ${demoMicroFilterSql}`,
      mdroBinds,
    );

    const pendingResult = await db.execute(
      `SELECT COUNT(*) AS pending_count
       FROM microbiology_results m
       JOIN admissions a ON a.admission_id = m.admission_id
       WHERE m.admission_id IN (${admissionPlaceholders})
         AND UPPER(NVL(m.result_status, '')) = 'PENDING'
         AND m.collection_datetime <= :referenceNow
         ${demoMicroFilterSql}`,
      nonShiftMetricBinds,
    );

    const destabilizingBinds = {
      ...trajectoryMetricBinds,
      destabilizingWindowStart,
    };

    const destabilizingResult = await db.execute(
      `SELECT te.admission_id,
              MAX(CASE WHEN te.event_type = 'hemodynamic_instability' THEN 1 ELSE 0 END) AS has_hemodynamic,
              MAX(CASE WHEN te.event_type = 'resp_support_increase' THEN 1 ELSE 0 END) AS has_resp_support,
              MAX(CASE WHEN te.event_type IN ('abx_escalation', 'abx_escalate_or_change') THEN 1 ELSE 0 END) AS has_abx_escalation
       FROM trajectory_events te
       JOIN admissions a ON a.admission_id = te.admission_id
       WHERE te.admission_id IN (${admissionPlaceholders})
         AND te.event_datetime <= :referenceNow
         AND te.event_datetime >= :destabilizingWindowStart
         ${demoTrajectoryFilterSql}
       GROUP BY te.admission_id`,
      destabilizingBinds,
    );

    const destabilizingMap = new Map();
    for (const row of destabilizingResult.rows) {
      destabilizingMap.set(row.ADMISSION_ID, {
        hasHemodynamic: Number(row.HAS_HEMODYNAMIC || 0) > 0,
        hasRespSupport: Number(row.HAS_RESP_SUPPORT || 0) > 0,
        hasAbxEscalation: Number(row.HAS_ABX_ESCALATION || 0) > 0,
      });
    }

    let highRiskPatientCount = 0;
    let criticalPatientCount = 0;
    let previousHighRiskPatientCount = 0;
    let transferIcuCandidateCount = 0;
    const transferClassification = { icu: 0, transfer: 0 };

    for (const row of riskSummaryResult.rows) {
      const admissionId = row.ADMISSION_ID;
      const isHighNow = Number(row.HIGH_NOW || 0) > 0;
      const isCriticalNow = Number(row.CRITICAL_NOW || 0) > 0;
      const wasHighPrev = Number(row.HIGH_PREV || 0) > 0;

      if (isHighNow) highRiskPatientCount += 1;
      if (isCriticalNow) criticalPatientCount += 1;
      if (wasHighPrev) previousHighRiskPatientCount += 1;

      const destabilizing = destabilizingMap.get(admissionId) || {
        hasHemodynamic: false,
        hasRespSupport: false,
        hasAbxEscalation: false,
      };
      const isCandidate =
        isCriticalNow ||
        destabilizing.hasHemodynamic ||
        destabilizing.hasRespSupport ||
        destabilizing.hasAbxEscalation;
      if (!isCandidate) continue;

      transferIcuCandidateCount += 1;
      if (isCriticalNow || destabilizing.hasHemodynamic || destabilizing.hasRespSupport) {
        transferClassification.icu += 1;
      } else {
        transferClassification.transfer += 1;
      }
    }

    const criticalEventsRow = criticalEventsResult.rows[0] || {};
    const mdroRow = mdroResult.rows[0] || {};
    const pendingRow = pendingResult.rows[0] || {};
    const mdroTotal = Number(mdroRow.MDRO_TOTAL || 0);
    const mdroCre = Number(mdroRow.MDRO_CRE || 0);
    const mdroVre = Number(mdroRow.MDRO_VRE || 0);
    const mdroMrsa = Number(mdroRow.MDRO_MRSA || 0);

    res.json({
      meta: {
        patientCount: scopeResult.rows.length,
        admissionCount: admissionIds.length,
        demoStep,
        demoShift,
        referenceNow:
          referenceNow && typeof referenceNow.toISOString === "function"
            ? referenceNow.toISOString()
            : null,
      },
      data: {
        highRiskPatientCount,
        criticalPatientCount,
        highRiskDelta: highRiskPatientCount - previousHighRiskPatientCount,
        criticalEventsCount: Number(criticalEventsRow.CRITICAL_EVENTS_12H || 0),
        criticalEventsRecent2h: Number(criticalEventsRow.CRITICAL_EVENTS_2H || 0),
        mdroUpdatedCount: mdroTotal,
        mdroBreakdown: {
          cre: mdroCre,
          vre: mdroVre,
          mrsa: mdroMrsa,
          other: Math.max(0, mdroTotal - mdroCre - mdroVre - mdroMrsa),
        },
        pendingResultsCount: Number(pendingRow.PENDING_COUNT || 0),
        transferIcuCandidateCount,
        transferClassification,
      },
    });
  } catch (err) {
    console.error("GET /api/patients/summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/patients/:id — 개별 환자 (전체 임상 데이터 포함)
// ============================================================
router.get("/:id", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const demoShiftOrder = getShiftOrder(req.demoShift);

    // 1. 기본 정보
    const baseResult = await db.execute(
      `SELECT
        p.patient_id, p.name, p.age, p.gender, p.infection_code, p.created_at,
        a.admission_id, a.admit_date, a.sim_admit_date, a.discharge_date,
        a.status, a.current_hd, a.primary_diagnosis,
        a.alert_level, a.attending_doctor, a.attending_nurse,
        a.demo_d_offset, a.d_min, a.d_max, a.d_length
      FROM patients p
      LEFT JOIN (
        SELECT * FROM (
          SELECT a.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY a.patient_id
                   ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
                 ) rn
          FROM admissions a
          WHERE a.patient_id = :id
        ) adm
        WHERE rn = 1
          AND (
            :demoStep IS NULL OR
            (
              :demoStep >= NVL(demo_d_offset, 0) + 1
              AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
            )
          )
      ) a ON p.patient_id = a.patient_id
      WHERE p.patient_id = :id`,
      { id: req.params.id, demoStep },
    );

    if (!baseResult.rows.length) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patient = formatPatientBase(baseResult.rows[0]);
    const aid = patient._admissionId;

    if (!aid) {
      if (req.demoEnabled) {
        return res.status(404).json({
          error: "Patient not visible at current demo step",
          demoStep,
          demoShift: req.demoShift || null,
        });
      }

      // admission 없으면 기본 정보만 반환
      return res.json({
        ...patient,
        vitals: [],
        labResults: [],
        imagingResults: [],
        cultureResults: [],
        timeline: [],
      });
    }

    const effectiveMaxD = computeEffectiveMaxD(
      patient._dMin,
      patient._demoOffset,
      demoStep,
    );
    const demoContext = {
      effectiveMaxD,
      demoShiftOrder,
    };

    // 2. 병렬 서브쿼리
    const [vitals, labs, imaging, cultures, timeline, bed, trajectoryRiskMap, mdroMap] =
      await Promise.all([
        fetchVitals(aid, demoContext),
        fetchLabResults(aid, demoContext),
        fetchImagingResults(aid, demoContext),
        fetchCultureResults(aid, demoContext),
        fetchTimeline(aid, demoContext),
        fetchBedInfoSingle(req.params.id),
        batchTrajectoryRisk([aid], demoStep, demoShiftOrder),
        batchMdroStatus([aid], demoStep, demoShiftOrder),
      ]);
    const trajectoryRisk = trajectoryRiskMap.get(aid) || null;
    const mdroInfo = mdroMap.get(aid);

    // 최신 Lactate
    const lactateResult = labs.find((l) => l.category === "LACTATE");
    const lactate = lactateResult ? parseFloat(lactateResult.value) : null;
    const sepsis = await getSepsisForAdmission({
      patient,
      admissionId: aid,
      vitals: vitals[0] || null,
      labs,
      lactate,
      demoContext,
      demoStep,
    });

    const demoMeta = buildDemoMeta({
      demoStep,
      demoShift: req.demoShift,
      demoBaseDate: req.demoBaseDate,
      dMin: patient._dMin,
      demoOffset: patient._demoOffset,
    });

    // 3. 병합
    res.json({
      ...patient,
      status: mapDashboardStatusFromTrajectory(patient.status, trajectoryRisk?.maxSeverity),
      // 병상
      roomNumber: bed?.roomNumber || null,
      ward: bed?.ward || null,
      floor: bed?.floor || null,
      trajectoryRisk,
      // 임상 배열 데이터
      vitals,
      labResults: labs,
      imagingResults: imaging,
      cultureResults: cultures,
      timeline,
      // 패혈증
      riskScore: sepsis?.riskScore ?? null,
      sepsisExplanation: sepsis?.sepsisExplanation || null,
      // MDRO
      mdroStatus: mdroInfo
        ? mdroInfo
        : {
          isMDRO: false,
          isolationRequired: false,
          isolationImplemented: false,
          confirmedAt: null,
          confirmedHd: null,
          confirmedDNumber: null,
          confirmedShift: null,
        },
      // Lactate
      lactate,
      ...(demoMeta || {}),
    });
  } catch (err) {
    console.error("GET /api/patients/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/patients/:id/sepsis — Shift-aware Sepsis 모델 요약
// ============================================================
router.get("/:id/sepsis", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const demoShiftOrder = getShiftOrder(req.demoShift);

    const baseResult = await db.execute(
      `SELECT
        p.patient_id, p.name, p.age, p.gender, p.infection_code, p.created_at,
        a.admission_id, a.admit_date, a.sim_admit_date, a.discharge_date,
        a.status, a.current_hd, a.primary_diagnosis,
        a.alert_level, a.attending_doctor, a.attending_nurse,
        a.demo_d_offset, a.d_min, a.d_max, a.d_length
      FROM patients p
      LEFT JOIN (
        SELECT * FROM (
          SELECT a.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY a.patient_id
                   ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
                 ) rn
          FROM admissions a
          WHERE a.patient_id = :id
        ) adm
        WHERE rn = 1
          AND (
            :demoStep IS NULL OR
            (
              :demoStep >= NVL(demo_d_offset, 0) + 1
              AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
            )
          )
      ) a ON p.patient_id = a.patient_id
      WHERE p.patient_id = :id`,
      { id: req.params.id, demoStep },
    );

    if (!baseResult.rows.length) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patient = formatPatientBase(baseResult.rows[0]);
    const admissionId = patient._admissionId;
    if (!admissionId) {
      return res.status(404).json({ error: "Admission not found for patient" });
    }

    const effectiveMaxD = computeEffectiveMaxD(
      patient._dMin,
      patient._demoOffset,
      demoStep,
    );
    const demoContext = { effectiveMaxD, demoShiftOrder };

    const [vitals, labs, lactateMap] = await Promise.all([
      fetchVitals(admissionId, demoContext),
      fetchLabResults(admissionId, demoContext),
      batchLatestLactate([admissionId], demoStep, demoShiftOrder),
    ]);
    const lactate = lactateMap.get(admissionId) ?? null;

    const sepsis = await getSepsisForAdmission({
      patient,
      admissionId,
      vitals: vitals[0] || null,
      labs,
      lactate,
      demoContext,
      demoStep,
    });

    if (!sepsis) {
      return res.json({
        patientId: req.params.id,
        admissionId,
        source: "none",
        riskScore: null,
        riskLevel: null,
        riskLevelUi: null,
        predictedAt: null,
        trend24h: [],
        signals: [],
        recommendations: [],
      });
    }

    const sepsisHistory = await fetchSepsisHistory(admissionId, demoContext);
    const trend24h = buildSepsisTrend24h(
      sepsisHistory,
      sepsis.riskScore,
      sepsis.predictedAt,
    );

    res.json({
      patientId: req.params.id,
      admissionId,
      source: sepsis.source || "flask",
      riskScore: sepsis.riskScore,
      riskLevel: sepsis.riskLevel,
      riskLevelUi: sepsis.riskLevelUi,
      predictedAt: sepsis.predictedAt || null,
      trend24h,
      signals: (sepsis.factors || []).slice(0, 5).map((factor) => ({
        signal: factor.factor,
        score: Number((toFiniteNumber(factor.value) || 0).toFixed(2)),
        rawValue: factor.rawValue ?? null,
      })),
      recommendations: sepsis.recommendations || [],
    });
  } catch (err) {
    console.error("GET /api/patients/:id/sepsis error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/patients/:id/status-summary — OpenAI 기반 현재 상태 요약
// ============================================================
router.get("/:id/status-summary", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const demoShiftOrder = getShiftOrder(req.demoShift);
    const forceRefresh = String(req.query.force || "").trim() === "1";

    const baseResult = await db.execute(
      `SELECT
        p.patient_id, p.name, p.age, p.gender, p.infection_code, p.created_at,
        a.admission_id, a.admit_date, a.sim_admit_date, a.discharge_date,
        a.status, a.current_hd, a.primary_diagnosis,
        a.alert_level, a.attending_doctor, a.attending_nurse,
        a.demo_d_offset, a.d_min, a.d_max, a.d_length
      FROM patients p
      LEFT JOIN (
        SELECT * FROM (
          SELECT a.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY a.patient_id
                   ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
                 ) rn
          FROM admissions a
          WHERE a.patient_id = :id
        ) adm
        WHERE rn = 1
          AND (
            :demoStep IS NULL OR
            (
              :demoStep >= NVL(demo_d_offset, 0) + 1
              AND :demoStep <= NVL(d_length, 0) + NVL(demo_d_offset, 0)
            )
          )
      ) a ON p.patient_id = a.patient_id
      WHERE p.patient_id = :id`,
      { id: req.params.id, demoStep },
    );

    if (!baseResult.rows.length) {
      return res.status(404).json({ error: "Patient not found" });
    }

    const patient = formatPatientBase(baseResult.rows[0]);
    const admissionId = patient._admissionId;
    if (!admissionId) {
      return res.status(404).json({ error: "Admission not found for patient" });
    }

    const effectiveMaxD = computeEffectiveMaxD(
      patient._dMin,
      patient._demoOffset,
      demoStep,
    );
    const demoContext = { effectiveMaxD, demoShiftOrder };
    const cacheKey = buildStatusSummaryCacheKey({
      patientId: req.params.id,
      admissionId,
      demoStep,
      demoShift: req.demoShift,
      effectiveMaxD,
      demoShiftOrder,
    });

    if (!forceRefresh) {
      const cached = getCachedStatusSummary(cacheKey);
      if (cached) {
        return res.json({
          ...cached,
          cached: true,
        });
      }
    }

    const [
      vitals,
      labs,
      timeline,
      mdroMap,
      lactateMap,
      trajectoryRiskMap,
    ] = await Promise.all([
      fetchVitals(admissionId, demoContext),
      fetchLabResults(admissionId, demoContext),
      fetchTimeline(admissionId, demoContext),
      batchMdroStatus([admissionId], demoStep, demoShiftOrder),
      batchLatestLactate([admissionId], demoStep, demoShiftOrder),
      batchTrajectoryRisk([admissionId], demoStep, demoShiftOrder),
    ]);

    const lactate = lactateMap.get(admissionId) ?? null;
    const sepsis = await getSepsisForAdmission({
      patient,
      admissionId,
      vitals: vitals[0] || null,
      labs,
      lactate,
      demoContext,
      demoStep,
    });

    const trajectoryRisk = trajectoryRiskMap.get(admissionId) || null;
    const mdroStatus = mdroMap.get(admissionId) || {
      isMDRO: false,
      mdroType: null,
      isolationRequired: false,
      isolationImplemented: false,
      confirmedAt: null,
      confirmedHd: null,
      confirmedDNumber: null,
      confirmedShift: null,
    };
    const currentHdAtDemo = computeCurrentHdAtDemo(
      patient._dMin,
      patient._demoOffset,
      demoStep,
      patient.currentHd,
    );
    const demoMeta = buildDemoMeta({
      demoStep,
      demoShift: req.demoShift,
      demoBaseDate: req.demoBaseDate,
      dMin: patient._dMin,
      demoOffset: patient._demoOffset,
    });

    const summaryInput = buildStatusSummaryInput({
      patient,
      currentHdAtDemo,
      demoMeta,
      vitals,
      labs,
      sepsis,
      trajectoryRisk,
      mdroStatus,
      timeline,
    });
    const fallbackSummary = buildFallbackStatusSummary({
      patient,
      currentHdAtDemo,
      summaryInput,
    });
    const generated = await generateStatusSummary(summaryInput, fallbackSummary);

    const payload = {
      patientId: req.params.id,
      admissionId,
      summary: generated.summary,
      source: generated.source,
      model: generated.model,
      generatedAt: new Date().toISOString(),
      demoStep: demoMeta?.demoStep ?? demoStep ?? null,
      demoShift: req.demoShift ?? null,
      cached: false,
    };

    setCachedStatusSummary(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error("GET /api/patients/:id/status-summary error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/patients/:id/documents — 임상 문서 요약 (기존 유지)
// ============================================================
router.get("/:id/documents", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const admResult = await db.execute(
      `SELECT admission_id, d_min, demo_d_offset, d_length
       FROM (
         SELECT a.*,
                ROW_NUMBER() OVER (
                  PARTITION BY a.patient_id
                  ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
                ) rn
         FROM admissions a
         WHERE a.patient_id = :id
       )
       WHERE rn = 1
         AND (
           :demoStep IS NULL OR
           (
             :demoStep >= NVL(demo_d_offset, 0) + 1
             AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
           )
         )`,
      { id: req.params.id, demoStep },
    );

    if (!admResult.rows.length) {
      return res.status(404).json({ error: "Admission not found" });
    }

    const admissionId = admResult.rows[0].ADMISSION_ID;
    const effectiveMaxD = computeEffectiveMaxD(
      admResult.rows[0].D_MIN,
      admResult.rows[0].DEMO_D_OFFSET,
      demoStep,
    );
    const docDemoSql = effectiveMaxD == null ? "" : " AND d_number <= :effectiveMaxD";
    const docBinds = effectiveMaxD == null
      ? { id: admissionId }
      : { id: admissionId, effectiveMaxD };

    const [nursing, physician, labs, micro, radiology] = await Promise.all([
      db.execute(
        `SELECT note_id, note_datetime, note_type, assessment, hd, d_number
         FROM nursing_notes WHERE admission_id = :id
         ${docDemoSql}
         ORDER BY note_datetime DESC`,
        docBinds,
      ),
      db.execute(
        `SELECT note_id, note_datetime, note_type, diagnosis, hd, d_number
         FROM physician_notes WHERE admission_id = :id
         ${docDemoSql}
         ORDER BY note_datetime DESC`,
        docBinds,
      ),
      db.execute(
        `SELECT result_id, result_datetime, item_code, item_name, value, unit, is_abnormal, hd, d_number
         FROM lab_results WHERE admission_id = :id
         ${docDemoSql}
         ORDER BY result_datetime DESC`,
        docBinds,
      ),
      db.execute(
        `SELECT result_id, collection_datetime, specimen_type, organism, is_mdro, mdro_type, result_status, hd, d_number
         FROM microbiology_results WHERE admission_id = :id
         ${docDemoSql}
         ORDER BY collection_datetime DESC`,
        docBinds,
      ),
      db.execute(
        `SELECT report_id, study_type, study_datetime, findings, conclusion, severity_score, hd, d_number
         FROM radiology_reports WHERE admission_id = :id
         ${docDemoSql}
         ORDER BY study_datetime DESC`,
        docBinds,
      ),
    ]);

    res.json({
      patient_id: req.params.id,
      admission_id: admissionId,
      counts: {
        nursing_notes: nursing.rows.length,
        physician_notes: physician.rows.length,
        lab_results: labs.rows.length,
        microbiology: micro.rows.length,
        radiology: radiology.rows.length,
      },
      nursing_notes: nursing.rows,
      physician_notes: physician.rows,
      lab_results: labs.rows,
      microbiology: micro.rows,
      radiology: radiology.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/patients/:id/trajectory — 축별 임상 경과 요약
// ============================================================

const AXIS_KEYWORDS = [
  { axis: "respiratory", label: "호흡기 (Respiratory)", patterns: [/respiratory/i, /pneumonia/i, /dyspnea/i, /spo2/i, /o2/i, /호흡/i, /hypoxe/i, /lung/i, /chest/i, /accessory muscle/i] },
  { axis: "infection", label: "감염 (Infection)", patterns: [/infection/i, /mrsa/i, /vre/i, /mdro/i, /감염/i, /sepsis/i, /bacteremia/i, /fever/i, /발열/i] },
  { axis: "gi", label: "소화기 (GI)", patterns: [/gi\b/i, /diarrhea/i, /c\.\s*diff/i, /colitis/i, /소화/i, /장/i, /vomit/i, /nausea/i] },
  { axis: "renal", label: "신장 (Renal)", patterns: [/renal/i, /kidney/i, /uti/i, /urin/i, /creatinine/i, /신장/i, /요로/i] },
  { axis: "neuro", label: "신경계 (Neuro)", patterns: [/neuro/i, /gcs/i, /의식/i, /mental/i, /seizure/i, /신경/i] },
  { axis: "clinical_action", label: "임상 조치 (Clinical)", patterns: [] },
];

function classifyAxis(text) {
  if (!text) return "clinical_action";
  for (const { axis, patterns } of AXIS_KEYWORDS) {
    if (patterns.length && patterns.some((p) => p.test(text))) return axis;
  }
  return "clinical_action";
}

function determineTrend(descriptions) {
  if (!descriptions.length) return "stable";
  const recent = descriptions.slice(-3).join(" ").toLowerCase();
  const worseningPatterns = /worsen|악화|deteriorat|exacerbat|distress|decline/i;
  const improvingPatterns = /improv|호전|stable.*improv|recovery|개선/i;
  if (improvingPatterns.test(recent)) return "improving";
  if (worseningPatterns.test(recent)) return "worsening";
  return "stable";
}

router.get("/:id/trajectory", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const admResult = await db.execute(
      `SELECT admission_id, d_min, demo_d_offset, d_length
       FROM (
         SELECT a.*,
                ROW_NUMBER() OVER (
                  PARTITION BY a.patient_id
                  ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
                ) rn
         FROM admissions a
         WHERE a.patient_id = :id
       )
       WHERE rn = 1
         AND (
           :demoStep IS NULL OR
           (
             :demoStep >= NVL(demo_d_offset, 0) + 1
             AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
           )
         )`,
      { id: req.params.id, demoStep },
    );
    if (!admResult.rows.length) {
      return res.status(404).json({ error: "Admission not found" });
    }
    const admissionId = admResult.rows[0].ADMISSION_ID;
    const effectiveMaxD = computeEffectiveMaxD(
      admResult.rows[0].D_MIN,
      admResult.rows[0].DEMO_D_OFFSET,
      demoStep,
    );
    const demoShiftOrder = getShiftOrder(req.demoShift);

    const result = await db.execute(
      `SELECT event_id, render_text, severity, event_datetime, d_number, shift
       FROM trajectory_events
       WHERE admission_id = :aid
         AND (:effectiveMaxD IS NULL OR d_number <= :effectiveMaxD)
         AND (
           :effectiveMaxD IS NULL OR :demoShiftOrder IS NULL OR
           d_number < :effectiveMaxD OR
           (
             d_number = :effectiveMaxD
             AND CASE UPPER(NVL(shift, ''))
                   WHEN 'DAY' THEN 1
                   WHEN 'EVENING' THEN 2
                   WHEN 'NIGHT' THEN 3
                   ELSE 99
                 END <= :demoShiftOrder
           )
         )
       ORDER BY event_datetime ASC`,
      { aid: admissionId, effectiveMaxD, demoShiftOrder },
    );

    // Group events by classified axis
    const groups = new Map();
    for (const r of result.rows) {
      const text = r.RENDER_TEXT || "";
      const axis = classifyAxis(text);
      if (!groups.has(axis)) groups.set(axis, []);
      groups.get(axis).push({
        text,
        severity: r.SEVERITY,
        eventId: String(r.EVENT_ID),
      });
    }

    // Build TrajectoryAxis[] from groups
    const labelMap = Object.fromEntries(AXIS_KEYWORDS.map((a) => [a.axis, a.label]));
    const trajectory = [];
    for (const [axis, events] of groups) {
      const descriptions = events.map((e) => e.text);
      trajectory.push({
        axis,
        label: labelMap[axis] || axis,
        trend: determineTrend(descriptions),
        supportingFacts: descriptions.slice(-3),
        evidenceIds: events.slice(-3).map((e) => e.eventId),
      });
    }

    res.json({ trajectory });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/patients — 환자 생성
// ============================================================
router.post("/", async (req, res) => {
  const { patient_id, name, age, gender, infection_code } = req.body;

  if (!patient_id || !name || !age || !gender) {
    return res
      .status(400)
      .json({
        error: "Missing required fields: patient_id, name, age, gender",
      });
  }

  try {
    await db.execute(
      `INSERT INTO patients (patient_id, name, age, gender, infection_code)
       VALUES (:patient_id, :name, :age, :gender, :infection_code)`,
      [patient_id, name, age, gender, infection_code || null],
    );

    res.status(201).json({ patient_id, name, age, gender, infection_code });
  } catch (err) {
    if (err.message.includes("ORA-00001")) {
      return res.status(400).json({ error: "Patient ID already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PUT /api/patients/:id — 환자 수정
// ============================================================
router.put("/:id", async (req, res) => {
  const { name, age, gender, infection_code } = req.body;

  try {
    const result = await db.execute(
      `UPDATE patients SET
        name = NVL(:name, name),
        age = NVL(:age, age),
        gender = NVL(:gender, gender),
        infection_code = NVL(:infection_code, infection_code)
       WHERE patient_id = :id`,
      [
        name || null,
        age || null,
        gender || null,
        infection_code || null,
        req.params.id,
      ],
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Patient not found" });
    }

    res.json({ message: "Patient updated", patient_id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DELETE /api/patients/:id — 환자 삭제
// ============================================================
router.delete("/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM admissions WHERE patient_id = :id", [
      req.params.id,
    ]);
    const result = await db.execute(
      "DELETE FROM patients WHERE patient_id = :id",
      [req.params.id],
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Patient not found" });
    }

    res.json({ message: "Patient deleted", patient_id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
