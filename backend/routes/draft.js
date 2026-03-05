const express = require("express");
const db = require("../db");
const OpenAI = require("openai");
const { getShiftOrder } = require("../helpers/demo-filter");

const router = express.Router();

// ============================================================
// 상수
// ============================================================

const VALID_DOC_TYPES = [
  "referral", "return", "summary", "discharge", "admission", "certificate",
];

const RANGE_LIMITS = {
  "72h": 10,
  "7d": 20,
  all: 999,
  custom: 20,
};

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
const SHIFT_ORDER_TO_HOUR = {
  1: 8,
  2: 16,
  3: 23,
};

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveDemoState(req, source = null) {
  const sourceStep = source && Number.isInteger(Number(source.demoStep))
    ? Number(source.demoStep)
    : null;
  const sourceShift = source ? String(source.demoShift || "").trim() : "";

  const step = sourceStep || req.demoStep || null;
  const shift = sourceShift || req.demoShift || null;

  return {
    demoStep: step,
    demoShift: shift,
    demoShiftOrder: getShiftOrder(shift),
  };
}

function computeEffectiveMaxD(dMin, demoOffset, demoStep) {
  const step = toFiniteNumber(demoStep);
  const minD = toFiniteNumber(dMin);
  const offset = toFiniteNumber(demoOffset);
  if (!step || minD == null) return null;
  return minD + (step - (offset || 0) - 1);
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
    const code = normalizeLabToken(row.item_code);
    const name = normalizeLabToken(row.item_name);
    if (!targets.has(code) && !targets.has(name)) continue;
    const numeric = toNumericValue(row.value);
    if (numeric != null) return numeric;
  }
  return null;
}

function buildSepsisFeatureSnapshot({ patient, labs = [], nursing = [], demo = {} }) {
  const latestNursing = Array.isArray(nursing) && nursing.length ? nursing[0] : null;
  const hr = toFiniteNumber(latestNursing?.hr);
  const sbp = toFiniteNumber(latestNursing?.bp_sys);
  const dbp = toFiniteNumber(latestNursing?.bp_dia);
  const rr = toFiniteNumber(latestNursing?.rr);
  const spo2 = toFiniteNumber(latestNursing?.spo2);
  const age = toFiniteNumber(patient?.age);

  const lactate = pickLatestLabValue(labs, ["LACTATE"]);
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

  const hd = toFiniteNumber(patient?.current_hd);
  const shiftHour = SHIFT_ORDER_TO_HOUR[toFiniteNumber(demo.demoShiftOrder)] || 8;
  const observationHour =
    hd != null ? Math.max(0, ((Math.floor(hd) - 1) * 24) + shiftHour) : null;
  const dNumber = toFiniteNumber(demo.effectiveMaxD);

  const snapshot = {
    hr,
    hr_max: hr,
    sbp,
    dbp,
    mbp,
    rr,
    rr_max: rr,
    spo2,
    lactate,
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
    hd: hd != null ? Math.floor(hd) : (dNumber != null ? Math.max(1, Math.floor(dNumber)) : null),
    dNumber: dNumber != null ? Math.floor(dNumber) : null,
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

// ============================================================
// 1. Data Helpers (Oracle 쿼리)
// ============================================================

/** 환자 + 입원 정보 조회 */
async function getPatient(patientId, demoStep = null) {
  const result = await db.execute(
    `SELECT
       p.patient_id, p.name, p.age, p.gender, p.infection_code,
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
         WHERE a.patient_id = :pid
       )
       WHERE rn = 1
         AND (
           :demoStep IS NULL OR
           (
             :demoStep >= NVL(demo_d_offset, 0) + 1
             AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
           )
         )
     ) a ON p.patient_id = a.patient_id
     WHERE p.patient_id = :pid
     FETCH FIRST 1 ROWS ONLY`,
    { pid: patientId, demoStep }
  );

  if (!result.rows.length) return null;
  const r = result.rows[0];

  const admitDate = r.ADMIT_DATE || r.SIM_ADMIT_DATE;
  const effectiveMaxD = computeEffectiveMaxD(r.D_MIN, r.DEMO_D_OFFSET, demoStep);
  let losDays = 0;
  if (effectiveMaxD != null && r.D_MIN != null) {
    losDays = Math.max(1, effectiveMaxD - Number(r.D_MIN) + 1);
  } else if (admitDate) {
    losDays = Math.max(
      1,
      Math.ceil((Date.now() - new Date(admitDate).getTime()) / (1000 * 60 * 60 * 24))
    );
  }

  return {
    patient_id: r.PATIENT_ID,
    name: r.NAME,
    age: r.AGE,
    sex: r.GENDER,
    infection_code: r.INFECTION_CODE,
    admission_id: r.ADMISSION_ID,
    admission_date: admitDate ? admitDate.toISOString().slice(0, 10) : null,
    discharge_date: r.DISCHARGE_DATE ? r.DISCHARGE_DATE.toISOString().slice(0, 10) : null,
    status: r.STATUS,
    current_hd: r.CURRENT_HD || losDays,
    los_days: losDays,
    primary_diagnosis: r.PRIMARY_DIAGNOSIS,
    alert_level: r.ALERT_LEVEL,
    attending_doctor: r.ATTENDING_DOCTOR,
    attending_nurse: r.ATTENDING_NURSE,
    d_min: r.D_MIN,
    d_max: r.D_MAX,
    d_length: r.D_LENGTH,
    demo_d_offset: r.DEMO_D_OFFSET,
    effective_max_d: effectiveMaxD,
  };
}

/** trajectory_events 조회 (range로 최근 N건 제한) */
async function getEvents(admissionId, range, demo = {}) {
  const limit = RANGE_LIMITS[range] || 20;
  const binds = { aid: admissionId };
  let demoSql = "";

  if (toFiniteNumber(demo.effectiveMaxD) != null) {
    binds.effectiveMaxD = Number(demo.effectiveMaxD);
    demoSql += " AND d_number <= :effectiveMaxD";
  }
  if (toFiniteNumber(demo.effectiveMaxD) != null && toFiniteNumber(demo.demoShiftOrder) != null) {
    binds.demoShiftOrder = Number(demo.demoShiftOrder);
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
    `SELECT event_id, event_type, event_datetime, axis_type,
            render_text, severity, supporting_docs_json, hd, d_number, shift
     FROM trajectory_events
     WHERE admission_id = :aid
       ${demoSql}
     ORDER BY event_datetime ASC`,
    binds
  );

  const rows = result.rows;
  const sliced = range === "all" ? rows : rows.slice(-limit);

  return sliced.map((r) => {
    let supportingDocs = [];
    if (r.SUPPORTING_DOCS_JSON) {
      try { supportingDocs = JSON.parse(r.SUPPORTING_DOCS_JSON); } catch { /* ignore */ }
    }
    return {
      event_id: r.EVENT_ID,
      event_type: r.EVENT_TYPE,
      event_time: r.EVENT_DATETIME ? r.EVENT_DATETIME.toISOString() : null,
      axis: r.AXIS_TYPE,
      description: r.RENDER_TEXT || r.EVENT_TYPE,
      severity: r.SEVERITY || "LOW",
      evidence: { reason: r.RENDER_TEXT || "" },
      supporting_docs: supportingDocs,
      hd: r.HD,
      d_number: r.D_NUMBER,
    };
  });
}

/** 최신 패혈증 위험도 1건 (Flask infer only) */
async function getLatestSepsis({ patient, admissionId, labs = [], nursing = [], demo = {} }) {
  if (!SEPSIS_FLASK_ENABLED) return null;

  const { featureSnapshot, hd, dNumber } = buildSepsisFeatureSnapshot({
    patient,
    labs,
    nursing,
    demo,
  });
  if (!Object.keys(featureSnapshot).length) return null;

  try {
    const inferred = await callSepsisFlaskInfer({
      patientId: patient?.patient_id || null,
      admissionId,
      hd,
      dNumber,
      featureSnapshot,
    });
    if (!inferred) return null;

    const riskScore = toFiniteNumber(inferred.risk_score);
    if (riskScore == null) return null;

    return {
      source: "flask",
      risk_score: riskScore,
      risk_level: String(inferred.risk_level || "LOW").toUpperCase(),
      score_time: inferred.predicted_at || new Date().toISOString(),
      top_risk_factors: Array.isArray(inferred.contributing_factors)
        ? inferred.contributing_factors
        : [],
      recommendations: Array.isArray(inferred.recommendations)
        ? inferred.recommendations.map((item) => String(item)).filter(Boolean)
        : [],
      hd,
      d_number: dNumber,
    };
  } catch (error) {
    console.error("[draft] Sepsis Flask infer failed:", formatSepsisFetchError(error));
    return null;
  }
}

/** 항목별 최신 검사 결과 */
async function getRecentLabs(admissionId, demo = {}) {
  const binds = { aid: admissionId };
  const demoSql = toFiniteNumber(demo.effectiveMaxD) == null
    ? ""
    : " AND d_number <= :effectiveMaxD";
  if (toFiniteNumber(demo.effectiveMaxD) != null) {
    binds.effectiveMaxD = Number(demo.effectiveMaxD);
  }

  const result = await db.execute(
    `SELECT item_code, item_name, value, unit, reference_range,
            is_abnormal, result_datetime
     FROM (
       SELECT item_code, item_name, value, unit, reference_range,
              is_abnormal, result_datetime,
              ROW_NUMBER() OVER (PARTITION BY item_code ORDER BY result_datetime DESC) rn
       FROM lab_results
       WHERE admission_id = :aid
         ${demoSql}
     ) WHERE rn = 1
     ORDER BY result_datetime DESC`,
    binds
  );

  return result.rows.map((r) => ({
    item_code: r.ITEM_CODE,
    item_name: r.ITEM_NAME,
    value: r.VALUE,
    unit: r.UNIT,
    reference_range: r.REFERENCE_RANGE,
    is_abnormal: !!r.IS_ABNORMAL,
    result_datetime: r.RESULT_DATETIME ? r.RESULT_DATETIME.toISOString() : null,
  }));
}

/** 최근 간호 기록 3건 (활력징후 + 임상 소견) */
async function getRecentNursing(admissionId, demo = {}) {
  const binds = { aid: admissionId };
  const demoSql = toFiniteNumber(demo.effectiveMaxD) == null
    ? ""
    : " AND d_number <= :effectiveMaxD";
  if (toFiniteNumber(demo.effectiveMaxD) != null) {
    binds.effectiveMaxD = Number(demo.effectiveMaxD);
  }

  const result = await db.execute(
    `SELECT note_datetime, temp, hr, rr, bp_sys, bp_dia, spo2,
            o2_device, o2_flow, subjective, objective, assessment, plan_action
     FROM nursing_notes
     WHERE admission_id = :aid
       ${demoSql}
     ORDER BY note_datetime DESC
     FETCH FIRST 3 ROWS ONLY`,
    binds
  );

  return result.rows.map((r) => ({
    note_datetime: r.NOTE_DATETIME ? r.NOTE_DATETIME.toISOString() : null,
    temp: r.TEMP,
    hr: r.HR,
    rr: r.RR,
    bp_sys: r.BP_SYS,
    bp_dia: r.BP_DIA,
    spo2: r.SPO2,
    o2_device: r.O2_DEVICE,
    o2_flow: r.O2_FLOW,
    subjective: r.SUBJECTIVE || "",
    objective: r.OBJECTIVE || "",
    assessment: r.ASSESSMENT || "",
    plan_action: r.PLAN_ACTION || "",
  }));
}

// ============================================================
// 2. OpenAI NLG
// ============================================================

let openaiClient = null;

function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPEN_AI_API;
    if (!apiKey) throw new Error("OPEN_AI_API key not found in environment");
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function buildNlgPrompt(patient, events, sepsisScore, docType) {
  const eventLines = events.map((e) => {
    const src = e.evidence?.reason || e.description || "";
    return `  - [${e.event_time}] ${e.description} (axis: ${e.axis}, severity: ${e.severity})\n    Evidence: ${src}`;
  });
  const eventsText = eventLines.length ? eventLines.join("\n") : "  (이벤트 없음)";

  let sepsisText = "없음";
  if (sepsisScore) {
    const factors = (sepsisScore.top_risk_factors || []).slice(0, 3);
    const factorLines = factors.map(
      (f) => `    - ${f.interpretation || f.feature || String(f)}: ${f.value != null ? f.value : ""}`
    );
    sepsisText = `Score: ${sepsisScore.risk_score} (${sepsisScore.risk_level})\n${factorLines.join("\n")}`;
  }

  const systemPrompt = `당신은 의무기록 서술 작성기입니다.
역할: 주어진 정형 데이터(이벤트, 수치)를 진료 의뢰서의 서술 섹션으로 변환합니다.

[엄격한 규칙]
1. 의학적 판단을 절대 하지 마세요. "확진", "악화 예상", "~로 진단됨", "~일 것으로 사료됨" 같은 판단 표현 금지.
2. 오직 제공된 이벤트/수치만 서술하세요. 없는 정보를 추가하지 마세요.
3. 각 사실 문장에는 반드시 [출처 시각] 형태의 인용을 포함하세요.
4. 아래 출력 템플릿을 정확히 따르세요.
5. 한국어로 작성하세요.`;

  const userPrompt = `[환자 정보]
- 연령/성별: ${patient.age}세 / ${patient.sex}
- 입원일: ${patient.admission_date}
- 재원일수: ${patient.los_days}일 (HD ${patient.current_hd})
- 진단: ${patient.primary_diagnosis || "미정"}
- Alert Level: ${patient.alert_level || "N/A"}

[이벤트 타임라인]
${eventsText}

[Sepsis Risk]
${sepsisText}
${getOutputTemplate(docType)}`;

  return { systemPrompt, userPrompt };
}

function getOutputTemplate(docType) {
  switch (docType) {
    case "admission":
      return `
[출력 템플릿 - 반드시 이 형식을 따르세요]

===CC_START===
[주호소]
- (가장 최근의 주요 증상이나 입원 사유, 1-2 문장)
===CC_END===

===PI_START===
[현병력]
- (입원 ~ 현재까지의 경과를 시간순으로 서술)
- (주요 이벤트와 증상 변화 위주)
===PI_END===

===PLAN_START===
[치료계획]
1. (감염 관리 계획)
2. (모니터링 계획)
===PLAN_END===`;

    case "discharge":
      return `
[출력 템플릿 - 반드시 이 형식을 따르세요]

===COURSE_START===
[입원 경과]
- (입원부터 퇴원까지의 치료 경과 요약, 시간순)
===COURSE_END===

===INSTRUCTIONS_START===
[퇴원 지시]
1. (외래 추적 계획)
2. (약물 지시)
3. (주의 사항)
===INSTRUCTIONS_END===`;

    case "summary":
      return `
[출력 템플릿 - 반드시 이 형식을 따르세요]

===SUMMARY_START===
[경과 요약]
- (주요 이벤트와 치료 경과를 시간순으로 요약)
===SUMMARY_END===

===STATUS_START===
[현재 상태]
- (현재 활력징후, 감염 상태, 치료 현황)
===STATUS_END===`;

    case "return":
      return `
[출력 템플릿 - 반드시 이 형식을 따르세요]

===COURSE_START===
[치료 경과]
- (전원 후 치료 경과 요약)
===COURSE_END===

===FOLLOWUP_START===
[추적 계획]
1. (외래 추적)
2. (약물)
3. (검사)
===FOLLOWUP_END===`;

    case "certificate":
      return `
[출력 템플릿 - 반드시 이 형식을 따르세요]

===STATEMENT_START===
[소견]
- (진단명, 치료 기간, 현재 상태를 사실 기반으로 서술)
- (판단 표현 금지 - "사료됩니다" 대신 "치료 중입니다" 등 사실 표현)
===STATEMENT_END===`;

    case "referral":
    default:
      return `
[출력 템플릿 - 반드시 이 형식을 따르세요]

===OPINION_START===
[현병력]
- (이벤트 기반 사실 bullet 3-5개, 각각 [시각] 인용 포함)

[주요 소견]
1. 근거: (이벤트/수치 기반 사실) [출처 시각]
2. 근거: (이벤트/수치 기반 사실) [출처 시각]
3. 근거: (이벤트/수치 기반 사실) [출처 시각]
===OPINION_END===

===REASON_START===
[의뢰 사유]
- (이벤트 기반 사실 bullet 2-3개)

[미결 항목]
1. (추가 평가/처치가 필요한 항목)
2. (추가 평가/처치가 필요한 항목)
3. (추가 평가/처치가 필요한 항목)
===REASON_END===`;
  }
}

function extractSection(text, startTag, endTag) {
  if (text.includes(startTag) && text.includes(endTag)) {
    return text.split(startTag)[1].split(endTag)[0].trim();
  }
  return "";
}

function parseNlgResponse(responseText, docType) {
  switch (docType) {
    case "admission":
      return {
        cc: extractSection(responseText, "===CC_START===", "===CC_END==="),
        pi: extractSection(responseText, "===PI_START===", "===PI_END==="),
        plan: extractSection(responseText, "===PLAN_START===", "===PLAN_END==="),
      };
    case "discharge":
      return {
        course: extractSection(responseText, "===COURSE_START===", "===COURSE_END==="),
        instructions: extractSection(responseText, "===INSTRUCTIONS_START===", "===INSTRUCTIONS_END==="),
      };
    case "summary":
      return {
        summary: extractSection(responseText, "===SUMMARY_START===", "===SUMMARY_END==="),
        status: extractSection(responseText, "===STATUS_START===", "===STATUS_END==="),
      };
    case "return":
      return {
        course: extractSection(responseText, "===COURSE_START===", "===COURSE_END==="),
        followup: extractSection(responseText, "===FOLLOWUP_START===", "===FOLLOWUP_END==="),
      };
    case "certificate":
      return {
        statement: extractSection(responseText, "===STATEMENT_START===", "===STATEMENT_END==="),
      };
    case "referral":
    default:
      return {
        opinion: extractSection(responseText, "===OPINION_START===", "===OPINION_END==="),
        reason: extractSection(responseText, "===REASON_START===", "===REASON_END==="),
      };
  }
}

async function generateNlg(patient, events, sepsisScore, docType) {
  const client = getOpenAIClient();
  const { systemPrompt, userPrompt } = buildNlgPrompt(patient, events, sepsisScore, docType);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 1500,
  });

  const rawText = response.choices[0]?.message?.content || "";
  const parsed = parseNlgResponse(rawText, docType);
  return { ...parsed, _raw: rawText };
}

// ============================================================
// 3. Fallback (규칙 기반)
// ============================================================

function fallbackOpinion(patient, events, sepsisScore) {
  const lines = ["[현병력]"];
  for (const e of events.slice(-5)) {
    lines.push(`- ${e.description} [${e.event_time}]`);
  }
  lines.push("");
  lines.push("[주요 소견]");
  if (sepsisScore) {
    lines.push(`1. Sepsis risk score: ${sepsisScore.risk_score} (${sepsisScore.risk_level}) [${sepsisScore.score_time}]`);
  }
  let idx = sepsisScore ? 2 : 1;
  for (const e of events.slice(-3)) {
    lines.push(`${idx}. ${e.description} [${e.event_time}]`);
    idx++;
  }
  return lines.join("\n");
}

function fallbackReason(patient, events, sepsisScore) {
  const lines = ["[의뢰 사유]"];
  lines.push(`- ${patient.age}세 ${patient.sex} 환자, 재원 ${patient.los_days}일차`);
  if (sepsisScore && ["high", "critical"].includes((sepsisScore.risk_level || "").toLowerCase())) {
    lines.push(`- Sepsis 고위험 상태 (score: ${sepsisScore.risk_score})`);
  }
  lines.push("");
  lines.push("[미결 항목]");
  lines.push("1. 상급 기관 감염내과 전문 치료 평가");
  lines.push("2. 중환자실 입실 필요성 평가");
  lines.push("3. 추가 미생물 배양 및 항생제 감수성 확인");
  return lines.join("\n");
}

function fallbackAdmission(patient, events, sepsisScore) {
  return {
    cc: `발열 및 전신 위약감 (HD ${patient.current_hd})`,
    pi: fallbackOpinion(patient, events, sepsisScore).replace("[현병력]\n", ""),
    plan: "1. 감염 내과 협진\n2. 항생제 치료 지속",
  };
}

// ============================================================
// 4. Section Builders
// ============================================================

function buildReferralSections(patient, events, sepsisScore, nlgResult, labs) {
  const today = new Date().toISOString().slice(0, 10);

  // 진단 auto-fill
  const diagnosisLines = [];
  if (patient.primary_diagnosis) {
    diagnosisLines.push(`1. ${patient.primary_diagnosis}`);
  }
  const feverEvents = events.filter((e) => e.event_type === "fever_onset");
  if (feverEvents.length) {
    diagnosisLines.push(`${diagnosisLines.length + 1}. 발열 관련 감염 의심 [${feverEvents.slice(-1)[0].event_time?.slice(0, 10)}]`);
  }
  const bpEvents = events.filter((e) => e.event_type === "bp_drop");
  if (bpEvents.length) {
    diagnosisLines.push(`${diagnosisLines.length + 1}. 혈역학적 불안정 [${bpEvents.slice(-1)[0].event_time?.slice(0, 10)}]`);
  }
  if (sepsisScore && ["high", "critical"].includes((sepsisScore.risk_level || "").toLowerCase())) {
    diagnosisLines.push(`${diagnosisLines.length + 1}. Sepsis 고위험 (score: ${sepsisScore.risk_score})`);
  }
  if (!diagnosisLines.length) diagnosisLines.push("1. 상세 진단은 의사 확인 필요");

  // 투약 auto-fill
  const medLines = [];
  for (const e of events) {
    const evidenceText = e.evidence?.reason || "";
    if (/antibiotics|항생제/i.test(evidenceText)) {
      medLines.push(`- ${evidenceText.split("\n")[0]} [${e.event_time?.slice(0, 10)}]`);
    }
  }
  if (!medLines.length) medLines.push("- (투약 이력은 처방 시스템에서 자동 연동 예정)");

  // 검사 auto-fill
  const labLines = [];
  if (labs && labs.length) {
    for (const l of labs.slice(0, 6)) {
      const mark = l.is_abnormal ? " (이상)" : "";
      labLines.push(`- ${l.item_name}: ${l.value} ${l.unit || ""}${mark} [${l.result_datetime?.slice(0, 10)}]`);
    }
  } else if (sepsisScore && sepsisScore.top_risk_factors) {
    for (const f of sepsisScore.top_risk_factors) {
      labLines.push(`- ${f.interpretation || f.feature}: ${f.value || ""} [${sepsisScore.score_time?.slice(0, 10)}]`);
    }
  }
  if (!labLines.length) labLines.push("- (검사 결과는 LIS 연동 예정)");

  return [
    {
      id: "header",
      title: "기본 정보 (Basic Information)",
      fields: [
        { key: "referralDate", label: "진료의뢰일", value: today, type: "date", required: true },
        { key: "deptName", label: "진료과", value: "감염내과", type: "text", required: true },
        { key: "physicianName", label: "의사명", value: patient.attending_doctor || "담당의", type: "text", required: true },
        { key: "patientName", label: "성명", value: patient.name || `Patient ${patient.patient_id}`, type: "text", required: true },
        { key: "patientId", label: "환자번호", value: patient.patient_id, type: "text", required: true },
        { key: "patientSexAge", label: "성별/나이", value: `${patient.sex} / ${patient.age}세`, type: "text" },
        { key: "patientType", label: "진료 구분", value: "입원", type: "text", required: true },
        { key: "admissionDate", label: "입원일", value: patient.admission_date || "", type: "date" },
        { key: "losDay", label: "재원일수", value: `HD ${patient.current_hd}일차 (${patient.los_days}일)`, type: "text" },
      ],
      narrative: "",
    },
    {
      id: "recipient",
      title: "수신 기관 정보 (Recipient)",
      fields: [
        { key: "recvOrgName", label: "요양기관명", value: "", type: "text", required: true },
        { key: "recvDept", label: "진료과/센터", value: "", type: "text" },
      ],
      narrative: "",
    },
    {
      id: "diagnoses",
      title: "진단명 (Diagnoses)",
      fields: [
        { key: "diagnosisList", label: "진단 목록", value: diagnosisLines.join("\n"), type: "textarea", required: true },
      ],
      narrative: "",
    },
    {
      id: "opinion",
      title: "병력 및 소견 (Clinical Opinion)",
      fields: [],
      narrative: nlgResult.opinion || "",
    },
    {
      id: "reason",
      title: "의뢰 내용 (Reason for Referral)",
      fields: [],
      narrative: nlgResult.reason || "",
    },
    {
      id: "medications",
      title: "약물 처방 내역 (Medications)",
      fields: [
        { key: "medList", label: "투약 목록", value: medLines.join("\n"), type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "labs",
      title: "주요 검사 내역 (Labs)",
      fields: [
        { key: "labList", label: "검사 결과", value: labLines.join("\n"), type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "appointment",
      title: "예약/기타 (Appointment)",
      fields: [
        { key: "desiredDate", label: "예약 희망 일시", value: "", type: "text" },
        { key: "returnRequest", label: "회송 요청", value: "", type: "text" },
      ],
      narrative: "",
    },
  ];
}

function buildAdmissionSections(patient, events, sepsisScore, nlgResult, labs, nursing) {
  const today = new Date().toISOString().slice(0, 10);

  // DOB
  let patientDob = "Unknown";
  if (patient.admission_date && patient.age) {
    try {
      const admYear = parseInt(patient.admission_date.slice(0, 4), 10);
      patientDob = `${admYear - patient.age}-01-01`;
    } catch { /* ignore */ }
  }

  // 활력징후
  let vitalString = "120/80 - 80 - 20 - 36.5";
  if (nursing && nursing.length) {
    const n = nursing[0];
    vitalString = `${n.bp_sys || "-"}/${n.bp_dia || "-"} - ${n.hr || "-"} - ${n.rr || "-"} - ${n.temp || "-"}`;
  }

  // ROS / PE
  let rosValue = "특이사항 없음";
  let peValue = "Alert, oriented. Chest: CTAB. Abd: Soft, non-tender.";
  if (events.some((e) => e.event_type === "fever_onset")) {
    rosValue = "General: Fever/Chills (+/-)";
    peValue += " Skin: Warm.";
  }

  return [
    {
      id: "basic_info",
      title: "A. 기본 정보",
      fields: [
        { key: "patientName", label: "환자 성명", value: patient.name || `Patient ${patient.patient_id}`, type: "text", required: true },
        { key: "patientId", label: "등록번호", value: patient.patient_id, type: "text", required: true },
        { key: "patientDob", label: "생년월일", value: patientDob, type: "text" },
        { key: "patientAge", label: "나이", value: `${patient.age}세`, type: "text" },
        { key: "patientSex", label: "성별", value: patient.sex, type: "text" },
      ],
      narrative: "",
    },
    {
      id: "chiefComplaint",
      title: "주소 (Chief Complaint)",
      fields: [
        { key: "cc", label: "주소", value: nlgResult.cc || "", type: "text", required: true },
      ],
      narrative: "",
    },
    {
      id: "hpi",
      title: "현병력 (HPI)",
      fields: [],
      narrative: nlgResult.pi || "",
    },
    {
      id: "past_history",
      title: "B. 입원 정보",
      fields: [
        { key: "admissionRoute", label: "1. 입원경로", value: "응급실", type: "text" },
        { key: "admissionReason", label: "2. 입원동기", value: "상기 주소로 입원함", type: "text" },
        { key: "onset", label: "3. 발병일", value: "내원 5일 전", type: "text" },
        { key: "diagnosis", label: "4. 주진단", value: patient.primary_diagnosis || "상세불명의 폐렴", type: "text" },
        { key: "pastHistory", label: "5. 과거력", value: "고혈압(-), 당뇨(-), 결핵(-), 간염(-)", type: "textarea" },
        { key: "surgeryHistory", label: "6. 수술력", value: "특이사항 없음", type: "textarea" },
        { key: "medicationHistory", label: "7. 투약력", value: "특이사항 없음", type: "textarea" },
        { key: "socialHistory", label: "8. 개인력(음주/흡연)", value: "음주(-), 흡연(-)", type: "textarea" },
        { key: "familyHistory", label: "9. 가족력", value: "특이사항 없음", type: "textarea" },
        { key: "ros", label: "10. 계통문진", value: rosValue, type: "textarea" },
        { key: "physicalExam", label: "11. 신체검진", value: peValue, type: "textarea" },
        { key: "initialDiagnosis", label: "13. 초기진단", value: patient.primary_diagnosis || "상세불명의 감염", type: "text" },
        { key: "plan", label: "14. 치료계획", value: nlgResult.plan || "", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "other_info",
      title: "C. 기타 정보",
      fields: [
        { key: "height", label: "2. 신장(cm)", value: "170", type: "text" },
        { key: "weight", label: "3. 체중(kg)", value: "65", type: "text" },
        { key: "mentalStatus", label: "4. 의식상태", value: "Alert", type: "text" },
        { key: "vitalSigns", label: "5. 활력징후", value: vitalString, type: "text" },
        { key: "pain", label: "6. 통증평가", value: "NRS 0", type: "text" },
      ],
      narrative: "",
    },
    {
      id: "admin_info",
      title: "Z. 작성 정보",
      fields: [
        { key: "admissionDate", label: "1. 최초 입원일시", value: patient.admission_date || "", type: "date", required: true },
        { key: "dept", label: "2. 진료과", value: "감염내과", type: "text" },
        { key: "doctorName", label: "3. 담당의사", value: patient.attending_doctor || "담당의", type: "text" },
        { key: "writerName", label: "4. 작성자", value: "작성자", type: "text" },
        { key: "writeDate", label: "5. 작성일시", value: today, type: "date" },
      ],
      narrative: "",
    },
  ];
}

function buildDischargeSections(patient, events, sepsisScore, nlgResult, labs) {
  const today = new Date().toISOString().slice(0, 10);

  const labLines = [];
  if (labs && labs.length) {
    for (const l of labs.slice(0, 8)) {
      const mark = l.is_abnormal ? " (이상)" : "";
      labLines.push(`- ${l.item_name}: ${l.value} ${l.unit || ""}${mark}`);
    }
  }

  return [
    {
      id: "diagnoses",
      title: "진단명",
      fields: [
        { key: "primaryDiagnosis", label: "주진단", value: patient.primary_diagnosis || "", type: "text", required: true },
      ],
      narrative: "",
    },
    {
      id: "hospitalCourse",
      title: "입원 경과 (Hospital Course)",
      fields: [],
      narrative: nlgResult.course || "",
    },
    {
      id: "majorResults",
      title: "주요 검사 결과",
      fields: [
        { key: "labSummary", label: "검사 요약", value: labLines.join("\n") || "(검사 결과 없음)", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "dischargeMeds",
      title: "퇴원 약물",
      fields: [
        { key: "medList", label: "투약 목록", value: "(처방 시스템에서 자동 연동 예정)", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "condition",
      title: "퇴원 시 상태",
      fields: [
        { key: "conditionSummary", label: "퇴원 상태", value: "", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "instructions",
      title: "퇴원 지시 (Discharge Instructions)",
      fields: [],
      narrative: nlgResult.instructions || "",
    },
  ];
}

function buildSummarySections(patient, events, sepsisScore, nlgResult, labs) {
  const today = new Date().toISOString().slice(0, 10);

  const labLines = [];
  if (labs && labs.length) {
    for (const l of labs.slice(0, 8)) {
      const mark = l.is_abnormal ? " (이상)" : "";
      labLines.push(`- ${l.item_name}: ${l.value} ${l.unit || ""}${mark}`);
    }
  }

  return [
    {
      id: "header",
      title: "기본 정보",
      fields: [
        { key: "patientName", label: "성명", value: patient.name || `Patient ${patient.patient_id}`, type: "text" },
        { key: "patientId", label: "환자번호", value: patient.patient_id, type: "text" },
        { key: "admissionDate", label: "입원일", value: patient.admission_date || "", type: "date" },
        { key: "summaryDate", label: "요약 작성일", value: today, type: "date" },
      ],
      narrative: "",
    },
    {
      id: "problemList",
      title: "문제 목록 (Problem List)",
      fields: [
        { key: "problems", label: "진단/문제", value: patient.primary_diagnosis || "", type: "textarea" },
      ],
      narrative: nlgResult.summary || "",
    },
    {
      id: "medications",
      title: "투약 현황",
      fields: [
        { key: "medList", label: "투약 목록", value: "(처방 시스템에서 자동 연동 예정)", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "labs",
      title: "주요 검사",
      fields: [
        { key: "labList", label: "검사 결과", value: labLines.join("\n") || "(검사 결과 없음)", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "vitals",
      title: "활력징후 / 현재 상태",
      fields: [],
      narrative: nlgResult.status || "",
    },
  ];
}

function buildReturnSections(patient, events, sepsisScore, nlgResult, labs) {
  const today = new Date().toISOString().slice(0, 10);

  const labLines = [];
  if (labs && labs.length) {
    for (const l of labs.slice(0, 6)) {
      const mark = l.is_abnormal ? " (이상)" : "";
      labLines.push(`- ${l.item_name}: ${l.value} ${l.unit || ""}${mark}`);
    }
  }

  return [
    {
      id: "header",
      title: "기본 정보",
      fields: [
        { key: "patientName", label: "성명", value: patient.name || `Patient ${patient.patient_id}`, type: "text" },
        { key: "patientId", label: "환자번호", value: patient.patient_id, type: "text" },
        { key: "returnDate", label: "회송일", value: today, type: "date", required: true },
      ],
      narrative: "",
    },
    {
      id: "courseSummary",
      title: "치료 경과",
      fields: [],
      narrative: nlgResult.course || "",
    },
    {
      id: "currentStatus",
      title: "현재 상태",
      fields: [
        { key: "statusSummary", label: "상태 요약", value: "", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "medications",
      title: "투약 현황",
      fields: [
        { key: "medList", label: "투약 목록", value: "(처방 시스템에서 자동 연동 예정)", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "keyResults",
      title: "주요 검사 결과",
      fields: [
        { key: "labList", label: "검사 결과", value: labLines.join("\n") || "(검사 결과 없음)", type: "textarea" },
      ],
      narrative: "",
    },
    {
      id: "followup",
      title: "추적 계획 (Follow-up)",
      fields: [],
      narrative: nlgResult.followup || "",
    },
  ];
}

function buildCertificateSections(patient, events, sepsisScore, nlgResult) {
  const today = new Date().toISOString().slice(0, 10);

  return [
    {
      id: "diagnosis",
      title: "진단명",
      fields: [
        { key: "diagnosisName", label: "진단명", value: patient.primary_diagnosis || "", type: "text", required: true },
      ],
      narrative: "",
    },
    {
      id: "dates",
      title: "기간",
      fields: [
        { key: "admissionDate", label: "입원일", value: patient.admission_date || "", type: "date" },
        { key: "issueDate", label: "발급일", value: today, type: "date", required: true },
      ],
      narrative: "",
    },
    {
      id: "treatmentPeriod",
      title: "치료 기간",
      fields: [
        { key: "period", label: "치료 기간", value: `${patient.los_days}일 (HD ${patient.current_hd})`, type: "text" },
      ],
      narrative: "",
    },
    {
      id: "statement",
      title: "소견",
      fields: [],
      narrative: nlgResult.statement || "",
    },
  ];
}

// ============================================================
// 5. Evidence Builder
// ============================================================

function buildEvidenceItems(events) {
  const sourceTypeMap = {
    physician_notified: "doctor",
    fever_onset: "nursing",
    bp_drop: "nursing",
    o2_start: "nursing",
    spo2_drop: "nursing",
    wbc_rising: "lab",
    crp_rising: "lab",
    culture_positive: "micro",
    imaging_worsening: "imaging",
  };

  const lastEvents = events.slice(-15);
  return lastEvents.map((e, i) => ({
    id: `ev-${i + 1}`,
    timestamp: e.event_time || "",
    docName: `${e.event_type} (${e.axis})`,
    quote: e.evidence?.reason || e.description || "",
    sourceType: sourceTypeMap[e.event_type] || "nursing",
    confidence: 0.85 + 0.1 * (i % 3),
    relatedSectionId:
      e.axis === "INFECTION_ACTIVITY" || e.axis === "infection_activity"
        ? "opinion"
        : "reason",
  }));
}

// ============================================================
// 6. Routes
// ============================================================

/** POST /generate — 문서 초안 생성 */
router.post("/generate", async (req, res) => {
  try {
    const { patient_id, doc_type = "referral", range = "7d" } = req.body;
    const demo = resolveDemoState(req, req.body);

    if (!patient_id) {
      return res.status(400).json({ error: "patient_id is required" });
    }
    if (!VALID_DOC_TYPES.includes(doc_type)) {
      return res.status(400).json({
        error: `Invalid doc_type. Must be one of: ${VALID_DOC_TYPES.join(", ")}`,
      });
    }

    // 1. 환자 조회
    const patient = await getPatient(patient_id, demo.demoStep);
    if (!patient) {
      return res.status(404).json({ error: `Patient ${patient_id} not found` });
    }
    if (!patient.admission_id) {
      return res.status(404).json({ error: `No admission found for patient ${patient_id}` });
    }

    const demoFilter = {
      effectiveMaxD: patient.effective_max_d,
      demoShiftOrder: demo.demoShiftOrder,
    };

    // 2. 구조화 데이터 병렬 조회
    const [events, labs, nursing] = await Promise.all([
      getEvents(patient.admission_id, range, demoFilter),
      getRecentLabs(patient.admission_id, demoFilter),
      getRecentNursing(patient.admission_id, demoFilter),
    ]);
    const sepsisScore = await getLatestSepsis({
      patient,
      admissionId: patient.admission_id,
      labs,
      nursing,
      demo: demoFilter,
    });

    // 3. LLM NLG (실패 시 fallback)
    let nlgResult;
    let usedFallback = false;
    try {
      nlgResult = await generateNlg(patient, events, sepsisScore, doc_type);
    } catch (llmError) {
      console.error("[draft] LLM error, using fallback:", llmError.message);
      usedFallback = true;

      if (doc_type === "admission") {
        nlgResult = { ...fallbackAdmission(patient, events, sepsisScore), _raw: `[FALLBACK] ${llmError.message}` };
      } else {
        const opText = fallbackOpinion(patient, events, sepsisScore);
        const rsText = fallbackReason(patient, events, sepsisScore);
        nlgResult = {
          opinion: opText, reason: rsText,
          course: opText, summary: opText, status: "",
          instructions: "", followup: "", statement: opText,
          _raw: `[FALLBACK] ${llmError.message}`,
        };
      }
    }

    // 4. doc_type별 섹션 빌드
    let sections;
    switch (doc_type) {
      case "admission":
        sections = buildAdmissionSections(patient, events, sepsisScore, nlgResult, labs, nursing);
        break;
      case "discharge":
        sections = buildDischargeSections(patient, events, sepsisScore, nlgResult, labs);
        break;
      case "summary":
        sections = buildSummarySections(patient, events, sepsisScore, nlgResult, labs);
        break;
      case "return":
        sections = buildReturnSections(patient, events, sepsisScore, nlgResult, labs);
        break;
      case "certificate":
        sections = buildCertificateSections(patient, events, sepsisScore, nlgResult);
        break;
      case "referral":
      default:
        sections = buildReferralSections(patient, events, sepsisScore, nlgResult, labs);
        break;
    }

    // 5. 원본 스냅샷 (FE revert용)
    for (const s of sections) {
      s.originalNarrative = s.narrative || "";
      s.originalFields = s.fields.map((f) => ({ ...f }));
    }

    // 6. Evidence
    const evidence = buildEvidenceItems(events);

    // 7. 응답
    res.json({
      docType: doc_type,
      patientId: patient_id,
      range,
      sections,
      evidence,
      validationIssues: [],
      meta: {
        generated_at: new Date().toISOString(),
        llm_model: usedFallback ? "fallback-rule-based" : "gpt-4o-mini",
        events_used: events.length,
        sepsis_score_used: sepsisScore !== null,
        used_fallback: usedFallback,
        demo_step: demo.demoStep,
        demo_shift: demo.demoShift,
      },
    });
  } catch (err) {
    console.error("POST /api/draft/generate error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /patients — 초안 대상 환자 목록 */
router.get("/patients", async (req, res) => {
  try {
    const demoStep = req.demoStep ?? null;
    const result = await db.execute(
      `
      SELECT
        p.patient_id, p.name, p.age, p.gender,
        a.admit_date, a.sim_admit_date, a.current_hd
      FROM patients p
      LEFT JOIN (
        SELECT * FROM (
          SELECT a.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY a.patient_id
                   ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
                 ) rn
          FROM admissions a
          WHERE a.status = 'active'
        )
        WHERE rn = 1
          AND (
            :demoStep IS NULL OR
            (
              :demoStep >= NVL(demo_d_offset, 0) + 1
              AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
            )
          )
      ) a ON p.patient_id = a.patient_id
      WHERE a.status = 'active'
      ORDER BY p.patient_id
    `,
      { demoStep },
    );

    const patients = result.rows.map((r) => ({
      id: r.PATIENT_ID,
      name: r.NAME || `Patient ${r.PATIENT_ID}`,
      sex: r.GENDER,
      age: r.AGE,
      ward: "감염내과",
      admissionDate: (r.SIM_ADMIT_DATE || r.ADMIT_DATE)
        ? (r.SIM_ADMIT_DATE || r.ADMIT_DATE).toISOString().slice(0, 10)
        : null,
      mrn: r.PATIENT_ID,
    }));

    res.json({ patients });
  } catch (err) {
    console.error("GET /api/draft/patients error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Saved Drafts CRUD  (Oracle: saved_drafts)
// ============================================================
const crypto = require("crypto");

/**
 * GET /saved       → list (최근 20건)
 * GET /saved/:id   → detail
 * POST /saved      → create or update (id 포함 시 update)
 * PATCH /saved/:id → status/내용 부분 업데이트
 */

// ── List ────────────────────────────────────────────────────
router.get("/saved", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await db.execute(
      `SELECT draft_id, doc_type, patient_id, patient_name, status,
              TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
              TO_CHAR(updated_at,'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at
         FROM saved_drafts
        ORDER BY updated_at DESC
        FETCH FIRST :limit ROWS ONLY`,
      [limit]
    );
    const drafts = (result.rows || []).map((r) => ({
      id: r.DRAFT_ID,
      docType: r.DOC_TYPE,
      patientId: r.PATIENT_ID,
      patientName: r.PATIENT_NAME,
      status: r.STATUS,
      createdAt: r.CREATED_AT,
      updatedAt: r.UPDATED_AT,
    }));
    res.json({ drafts });
  } catch (err) {
    console.error("GET /saved error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Detail ──────────────────────────────────────────────────
router.get("/saved/:id", async (req, res) => {
  try {
    const result = await db.execute(
      `SELECT draft_id, doc_type, patient_id, patient_name, status,
              sections_json, evidence_json, validation_issues_json,
              TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
              TO_CHAR(updated_at,'YYYY-MM-DD"T"HH24:MI:SS') AS updated_at
         FROM saved_drafts WHERE draft_id = :id`,
      [req.params.id]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: "Draft not found" });
    }
    const r = result.rows[0];
    res.json({
      id: r.DRAFT_ID,
      docType: r.DOC_TYPE,
      patientId: r.PATIENT_ID,
      patientName: r.PATIENT_NAME,
      status: r.STATUS,
      sections: safeParse(r.SECTIONS_JSON, []),
      evidence: safeParse(r.EVIDENCE_JSON, []),
      validationIssues: safeParse(r.VALIDATION_ISSUES_JSON, []),
      createdAt: r.CREATED_AT,
      updatedAt: r.UPDATED_AT,
    });
  } catch (err) {
    console.error("GET /saved/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Create / Upsert ─────────────────────────────────────────
router.post("/saved", async (req, res) => {
  try {
    const { id, docType, patientId, patientName, status, sections, evidence, validationIssues } = req.body;

    if (!docType || !patientId) {
      return res.status(400).json({ error: "docType and patientId are required" });
    }

    const draftId = id || crypto.randomUUID();
    const now = new Date();

    // Upsert: try update first, insert if not found
    if (id) {
      const existing = await db.execute(
        "SELECT draft_id FROM saved_drafts WHERE draft_id = :id",
        [id]
      );
      if (existing.rows && existing.rows.length > 0) {
        await db.execute(
          `UPDATE saved_drafts SET
              status = :status,
              sections_json = :sections,
              evidence_json = :evidence,
              validation_issues_json = :issues,
              patient_name = :pname,
              updated_at = :now
           WHERE draft_id = :id`,
          {
            status: status || "draft",
            sections: JSON.stringify(sections || []),
            evidence: JSON.stringify(evidence || []),
            issues: JSON.stringify(validationIssues || []),
            pname: patientName || "",
            now,
            id,
          }
        );
        return res.json({ id, status: status || "draft" });
      }
    }

    // Insert
    await db.execute(
      `INSERT INTO saved_drafts
          (draft_id, doc_type, patient_id, patient_name, status,
           sections_json, evidence_json, validation_issues_json, created_at, updated_at)
       VALUES (:id, :docType, :patientId, :pname, :status,
               :sections, :evidence, :issues, :now, :now)`,
      {
        id: draftId,
        docType,
        patientId,
        pname: patientName || "",
        status: status || "draft",
        sections: JSON.stringify(sections || []),
        evidence: JSON.stringify(evidence || []),
        issues: JSON.stringify(validationIssues || []),
        now,
      }
    );
    res.json({ id: draftId, status: status || "draft" });
  } catch (err) {
    console.error("POST /saved error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Partial Update (status, sections, validationIssues) ─────
router.patch("/saved/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, sections, validationIssues } = req.body;

    if (status && !["draft", "validated", "exported"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const sets = ["updated_at = :now"];
    const params = { now: new Date(), id };

    if (status !== undefined) {
      sets.push("status = :status");
      params.status = status;
    }
    if (sections !== undefined) {
      sets.push("sections_json = :sections");
      params.sections = JSON.stringify(sections);
    }
    if (validationIssues !== undefined) {
      sets.push("validation_issues_json = :issues");
      params.issues = JSON.stringify(validationIssues);
    }

    const result = await db.execute(
      `UPDATE saved_drafts SET ${sets.join(", ")} WHERE draft_id = :id`,
      params
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Draft not found" });
    }
    res.json({ id, status: status || "updated" });
  } catch (err) {
    console.error("PATCH /saved/:id error:", err);
    res.status(500).json({ error: err.message });
  }
});

function safeParse(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
