const express = require("express");
const db = require("../db");
const { getShiftOrder } = require("../helpers/demo-filter");

const router = express.Router();

const RANGE_CONFIG = {
  "24h": { hours: 24, binHours: 2 },
  "72h": { hours: 72, binHours: 6 },
  "7d": { hours: 168, binHours: 12 },
};

const AXIS_KEYS = ["resp", "inf", "action", "esc", "iso", "sym"];

const AXIS_TYPE_TO_KEY = {
  RESPIRATORY: "resp",
  INFECTION_ACTIVITY: "inf",
  CLINICAL_ACTION: "action",
  INFECTION_CONTROL: "iso",
  SYMPTOM_SUBJECTIVE: "sym",
  SUPPLEMENTARY: "sym",
};

const DOC_PREFIX_META = {
  N_: { docType: "nursing_note", authorRole: "RN" },
  P_: { docType: "physician_note", authorRole: "MD" },
  L_: { docType: "lab_result", authorRole: "LAB" },
  M_: { docType: "microbiology", authorRole: "LAB" },
  R_: { docType: "radiology", authorRole: "RAD" },
};

const DOC_PREFIX_SOURCE_META = {
  N_: { sourceTable: "nursing_notes", pkCol: "note_id", dtCol: "note_datetime" },
  P_: { sourceTable: "physician_notes", pkCol: "note_id", dtCol: "note_datetime" },
  L_: { sourceTable: "lab_results", pkCol: "result_id", dtCol: "result_datetime" },
  M_: { sourceTable: "microbiology_results", pkCol: "result_id", dtCol: "collection_datetime" },
  R_: { sourceTable: "radiology_reports", pkCol: "report_id", dtCol: "study_datetime" },
};

const ISSUE_EVENT_TYPES = new Set([
  "o2_start_or_increase",
  "spo2_drop_same_o2",
  "cxr_severity_up",
  "abx_escalate_or_change",
  "culture_ordered_new",
  "platelet_drop",
  "culture_result_arrived",
  "temp_spike",
  "wbc_rise",
  "crp_rise",
  "monitoring_escalated",
  "vitals_frequency_escalated",
  "notify_first_seen",
  "prn_increase",
  "mdro_confirmed",
  "isolation_gap",
  "isolation_applied",
  "cluster_suspected",
  "mental_status_change",
  "pain_escalation",
  "new_symptom_detected",
  "pain_location_change",
]);

const SEVERITY_ORDER = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  none: 0,
};

const IMPROVING_STRIP_TYPES = new Set([
  "cxr_severity_down",
  "temp_down",
  "wbc_down",
  "crp_down",
  "platelet_recover",
  "pain_relief",
]);

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function computeEffectiveMaxD(dMin, demoOffset, demoStep) {
  const step = toFiniteNumber(demoStep);
  const minD = toFiniteNumber(dMin);
  const offset = toFiniteNumber(demoOffset);
  if (!step || minD == null) return null;
  return minD + (step - (offset || 0) - 1);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseJsonArray(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue !== "string") return [];
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSeverity(rawSeverity, priorityRank) {
  const upper = String(rawSeverity || "").trim().toUpperCase();
  if (upper === "CRITICAL") return "critical";
  if (upper === "HIGH") return "high";
  if (upper === "MEDIUM") return "medium";
  if (upper === "LOW") return "low";
  if (upper === "INFO") return "info";
  if (upper === "NONE") return "none";

  if (priorityRank === 1) return "high";
  if (priorityRank === 2) return "medium";
  if (priorityRank === 3) return "low";
  return "info";
}

// CXR 이벤트는 항상 radiology에서 비롯됨 → 어떤 doc_id가 선택되더라도 radiology로 분류
const CXR_EVENT_TYPES = new Set([
  "cxr_severity_up",
  "cxr_severity_down",
  "cxr_no_change",
]);

// eventType을 최우선으로 보고, 그 다음 doc_id prefix, 마지막 axisKey fallback
function inferDocMetaFromId(docId, axisKey, eventType) {
  // CXR 이벤트는 radiology로 확정
  if (eventType && CXR_EVENT_TYPES.has(String(eventType).toLowerCase())) {
    return { docType: "radiology", authorRole: "RAD" };
  }

  // 그 외: doc_id prefix 그대로 사용
  if (typeof docId === "string") {
    const upper = docId.trim().toUpperCase();
    for (const prefix of Object.keys(DOC_PREFIX_META)) {
      if (upper.startsWith(prefix)) return DOC_PREFIX_META[prefix];
    }
  }

  // prefix 매칭 실패 → axisKey fallback
  if (axisKey === "inf") return { docType: "lab_result", authorRole: "LAB" };
  if (axisKey === "iso") return { docType: "microbiology", authorRole: "LAB" };
  if (axisKey === "resp") return { docType: "nursing_note", authorRole: "RN" };
  return { docType: "physician_note", authorRole: "MD" };
}


function inferDocPrefix(docId) {
  if (typeof docId !== "string") return null;
  const upper = docId.trim().toUpperCase();
  if (!upper) return null;
  return Object.keys(DOC_PREFIX_META).find((candidate) => upper.startsWith(candidate)) || null;
}

function extractDocTimestampMs(docId) {
  if (typeof docId !== "string") return null;
  const upper = docId.trim().toUpperCase();
  const match = upper.match(/_(\d{8})_(\d{4})_(\d{3})$/);
  if (!match) return null;

  const ymd = match[1];
  const hm = match[2];
  const parsed = new Date(
    `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hm.slice(0, 2)}:${hm.slice(2, 4)}:00`,
  );
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getDocPrefixPriority(prefix, axisKey, eventType, diffKeys) {
  const key = prefix || "";
  const normalizedType = String(eventType || "").toLowerCase();

  const hasHemodynamicSignal =
    normalizedType.includes("hemodynamic") ||
    ["sbp_mmhg", "map_mmhg", "dbp_mmhg", "heart_rate_bpm", "hr_bpm", "pulse_bpm"].some((token) =>
      diffKeys.has(token),
    );
  if (hasHemodynamicSignal) {
    const map = { N_: 0, P_: 1, L_: 2, R_: 3, M_: 6 };
    return map[key] ?? 9;
  }

  if (axisKey === "iso") {
    const map = { M_: 0, P_: 1, N_: 2, L_: 3, R_: 4 };
    return map[key] ?? 9;
  }
  if (axisKey === "inf") {
    const map = { L_: 0, P_: 1, N_: 2, M_: 3, R_: 4 };
    return map[key] ?? 9;
  }
  if (axisKey === "resp") {
    const map = { N_: 0, P_: 1, R_: 2, L_: 3, M_: 4 };
    return map[key] ?? 9;
  }

  const defaultMap = { P_: 0, N_: 1, L_: 2, R_: 3, M_: 4 };
  return defaultMap[key] ?? 9;
}

function sortSupportingDocs(docIds, eventTsMs, axisKey, eventType, parsedDiff) {
  const targetTsMs = Number.isFinite(eventTsMs) ? eventTsMs : null;
  const diffKeys = new Set([
    ...Object.keys(parsedDiff?.now || {}).map((key) => String(key).toLowerCase()),
    ...Object.keys(parsedDiff?.prev || {}).map((key) => String(key).toLowerCase()),
  ]);

  return [...docIds]
    .map((docId, idx) => {
      const tsMs = extractDocTimestampMs(docId);
      const prefix = inferDocPrefix(docId);
      const prefixPriority = getDocPrefixPriority(prefix, axisKey, eventType, diffKeys);
      const deltaMs =
        tsMs != null && targetTsMs != null
          ? Math.abs(tsMs - targetTsMs)
          : Number.POSITIVE_INFINITY;

      return {
        docId,
        idx,
        tsMs,
        deltaMs,
        prefixPriority,
      };
    })
    .sort((a, b) => {
      const aHasTs = a.tsMs != null;
      const bHasTs = b.tsMs != null;
      if (aHasTs !== bHasTs) return aHasTs ? -1 : 1;
      if (a.deltaMs !== b.deltaMs) return a.deltaMs - b.deltaMs;
      if (a.prefixPriority !== b.prefixPriority) return a.prefixPriority - b.prefixPriority;
      return a.idx - b.idx;
    })
    .map((item) => item.docId);
}

function splitTopLevel(rawText, separators) {
  const parts = [];
  let start = 0;
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let idx = 0; idx < rawText.length; idx++) {
    const ch = rawText[idx];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && ch === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (!inSingleQuote && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === "(") roundDepth += 1;
    else if (ch === ")") roundDepth = Math.max(0, roundDepth - 1);
    else if (ch === "[") squareDepth += 1;
    else if (ch === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (ch === "{") curlyDepth += 1;
    else if (ch === "}") curlyDepth = Math.max(0, curlyDepth - 1);

    const isTopLevel =
      roundDepth === 0 &&
      squareDepth === 0 &&
      curlyDepth === 0;

    if (isTopLevel && separators.includes(ch)) {
      const token = rawText.slice(start, idx).trim();
      if (token) parts.push(token);
      start = idx + 1;
    }
  }

  const tail = rawText.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseEvidenceValue(rawValue) {
  if (rawValue == null) return null;
  const text = String(rawValue).trim();
  if (!text) return "";

  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    return text.slice(1, -1);
  }

  if (/^(true|false)$/i.test(text)) {
    return /^true$/i.test(text);
  }

  if (/^(none|null)$/i.test(text)) {
    return null;
  }

  if (/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric;
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, [","]).map((item) => parseEvidenceValue(item));
  }

  return text;
}

function parseDiffMap(rawText) {
  const now = {};
  const prev = {};

  if (!rawText || typeof rawText !== "string") {
    return { now, prev, diffLine: "" };
  }

  const parts = splitTopLevel(rawText, [",", ";"]);
  const diffPieces = [];

  for (const part of parts) {
    const changedMatch = part.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+?)\s*→\s*(.+)$/);
    if (changedMatch) {
      const key = changedMatch[1];
      const prevRaw = changedMatch[2].trim();
      const nowRaw = changedMatch[3].trim();
      prev[key] = parseEvidenceValue(prevRaw);
      now[key] = parseEvidenceValue(nowRaw);
      diffPieces.push(`${key}: ${prevRaw} → ${nowRaw}`);
      continue;
    }

    const singleMatch = part.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+)$/);
    if (singleMatch) {
      const key = singleMatch[1];
      const valueRaw = singleMatch[2].trim();
      now[key] = parseEvidenceValue(valueRaw);
      diffPieces.push(`${key}: ${valueRaw}`);
    }
  }

  return {
    now,
    prev,
    diffLine: diffPieces.length > 0 ? diffPieces.join(", ") : rawText,
  };
}

function isNoopCxrSeverityEvent(eventType, parsedDiff) {
  const normalizedType = String(eventType || "").toLowerCase();
  if (normalizedType !== "cxr_severity_up" && normalizedType !== "cxr_severity_down") {
    return false;
  }

  const now = parsedDiff?.now || {};
  const prev = parsedDiff?.prev || {};

  const normalize = (value) => String(value || "").trim().toLowerCase();
  const nowSeverity = normalize(now.cxr_severity);
  const prevSeverity = normalize(prev.cxr_severity);
  if (nowSeverity && prevSeverity && nowSeverity === prevSeverity) {
    return true;
  }

  const nowDelta = toFiniteNumber(now.delta);
  const prevDelta = toFiniteNumber(prev.delta);
  if ((nowDelta != null && nowDelta === 0) || (prevDelta != null && prevDelta === 0)) {
    return true;
  }

  return false;
}

function buildNoopCxrEventKey(row, parsedDiff, docsRaw) {
  const normalize = (value) => String(value || "").trim().toLowerCase();
  const prevSeverity = normalize(parsedDiff?.prev?.cxr_severity);
  const nowSeverity = normalize(parsedDiff?.now?.cxr_severity);
  const ts = toIso(row?.EVENT_DATETIME) || String(row?.EVENT_DATETIME || "");
  const primaryDoc = Array.isArray(docsRaw) && docsRaw.length > 0 ? String(docsRaw[0]) : "";
  return `${ts}|${prevSeverity}|${nowSeverity}|${primaryDoc}`;
}

function buildNoopCxrSummary(parsedDiff) {
  const prevSeverity = String(parsedDiff?.prev?.cxr_severity || "").trim();
  const nowSeverity = String(parsedDiff?.now?.cxr_severity || "").trim();
  if (prevSeverity && nowSeverity) {
    return `CXR 변화 없음: ${prevSeverity} → ${nowSeverity}`;
  }
  if (nowSeverity) return `CXR 변화 없음: ${nowSeverity}`;
  if (prevSeverity) return `CXR 변화 없음: ${prevSeverity}`;
  return "CXR 변화 없음";
}

function inferEventAxis(eventType, axisType) {
  const normalized = String(eventType || "").toLowerCase();
  if (/(escalat|worsen|deterior|drop|spike|notify_first_seen|critical)/i.test(normalized)) {
    return "esc";
  }
  return AXIS_TYPE_TO_KEY[String(axisType || "").toUpperCase()] || "action";
}

function inferFlags(renderText, evidenceText) {
  const text = `${renderText || ""} ${evidenceText || ""}`;
  return {
    plan: /(plan|계획|예정|검토)/i.test(text),
    uncertain: /(의심|suspect|possible|추정|가능성)/i.test(text),
    negated: /(없음|negative|neg\b|no\s|not\s)/i.test(text),
  };
}

function isIssueEvent(eventType, severityKey, renderText, evidenceText) {
  if (SEVERITY_ORDER[severityKey] >= SEVERITY_ORDER.medium) return true;
  const normalizedType = String(eventType || "").toLowerCase();
  if (ISSUE_EVENT_TYPES.has(normalizedType)) return true;
  const text = `${renderText || ""} ${evidenceText || ""}`;
  return /(악화|위험|high\s*risk|critical|escalat|drop|spike|격리\s*미적용)/i.test(text);
}

function parseAsOf(rawAsOf) {
  if (!rawAsOf) return null;
  const parsed = new Date(rawAsOf);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let idx = 0; idx < items.length; idx += size) {
    chunks.push(items.slice(idx, idx + size));
  }
  return chunks;
}

function buildInClause(prefix, values, binds) {
  return values
    .map((value, idx) => {
      const key = `${prefix}${idx}`;
      binds[key] = value;
      return `:${key}`;
    })
    .join(", ");
}

function parseDocRef(docId) {
  if (typeof docId !== "string") return null;
  const normalizedDocId = docId.trim();
  if (!normalizedDocId) return null;

  const upper = normalizedDocId.toUpperCase();
  const prefix = Object.keys(DOC_PREFIX_SOURCE_META).find((candidate) => upper.startsWith(candidate));
  if (!prefix) return null;

  const dateMatch = upper.match(/_(\d{8})_(\d{4})_(\d{3})$/);
  if (!dateMatch) return null;

  const ymd = dateMatch[1];
  const hm = dateMatch[2];
  const seq = Number(dateMatch[3]) || 1;
  const ts = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T${hm.slice(0, 2)}:${hm.slice(2, 4)}:00`;

  const sourceMeta = DOC_PREFIX_SOURCE_META[prefix];
  return {
    docId: normalizedDocId,
    sourceTable: sourceMeta.sourceTable,
    pkCol: sourceMeta.pkCol,
    dtCol: sourceMeta.dtCol,
    ts,
    seq: Math.max(1, seq),
  };
}

async function buildAdmissionSourceLookup(admissionId) {
  const lookup = new Map();

  const sequentialRefs = Object.values(DOC_PREFIX_SOURCE_META).filter(
    (meta) => meta.sourceTable !== "lab_results",
  );

  for (const meta of sequentialRefs) {
    const result = await db.execute(
      `
      SELECT
        ${meta.pkCol} AS source_id,
        TO_CHAR(${meta.dtCol}, 'YYYY-MM-DD"T"HH24:MI:SS') AS ts
      FROM ${meta.sourceTable}
      WHERE admission_id = :aid
      ORDER BY ${meta.pkCol}
      `,
      { aid: admissionId },
    );

    const groupedByTs = new Map();
    for (const row of result.rows) {
      const ts = row.TS;
      if (!ts) continue;
      if (!groupedByTs.has(ts)) groupedByTs.set(ts, []);
      groupedByTs.get(ts).push(row.SOURCE_ID);
    }

    for (const [ts, sourceIds] of groupedByTs.entries()) {
      sourceIds.forEach((sourceId, idx) => {
        lookup.set(`${meta.sourceTable}|${ts}|${idx + 1}`, sourceId);
      });
    }
  }

  const labResult = await db.execute(
    `
    SELECT
      TO_CHAR(result_datetime, 'YYYY-MM-DD"T"HH24:MI:SS') AS ts,
      MIN(result_id) AS source_id
    FROM lab_results
    WHERE admission_id = :aid
    GROUP BY result_datetime
    `,
    { aid: admissionId },
  );

  for (const row of labResult.rows) {
    if (!row.TS || row.SOURCE_ID == null) continue;
    lookup.set(`lab_results|${row.TS}|1`, row.SOURCE_ID);
  }

  return lookup;
}

function collectSupportingDocIds(rows) {
  const docIds = new Set();
  for (const row of rows) {
    const docs = parseJsonArray(row.SUPPORTING_DOCS_JSON).map((item) => String(item));
    for (const docId of docs) docIds.add(docId);
  }
  return [...docIds];
}

async function buildNlpDocumentMap(admissionId, sourceRefsByDocId) {
  const sourceIdsByTable = new Map();
  for (const sourceRef of sourceRefsByDocId.values()) {
    if (!sourceIdsByTable.has(sourceRef.sourceTable)) {
      sourceIdsByTable.set(sourceRef.sourceTable, new Set());
    }
    sourceIdsByTable.get(sourceRef.sourceTable).add(sourceRef.sourceId);
  }

  const nlpDocBySource = new Map();
  for (const [sourceTable, sourceIdSet] of sourceIdsByTable.entries()) {
    const sourceIds = [...sourceIdSet];
    if (sourceIds.length === 0) continue;

    const binds = { aid: admissionId, sourceTable };
    const inClause = buildInClause("sid", sourceIds, binds);
    const result = await db.execute(
      `
      SELECT document_id, source_id
      FROM nlp_documents
      WHERE admission_id = :aid
        AND source_table = :sourceTable
        AND source_id IN (${inClause})
      `,
      binds,
    );

    for (const row of result.rows) {
      const sourceKey = `${sourceTable}|${row.SOURCE_ID}`;
      if (!nlpDocBySource.has(sourceKey)) {
        nlpDocBySource.set(sourceKey, row.DOCUMENT_ID);
      }
    }
  }

  const nlpDocByRefDocId = new Map();
  for (const [docId, sourceRef] of sourceRefsByDocId.entries()) {
    const sourceKey = `${sourceRef.sourceTable}|${sourceRef.sourceId}`;
    const nlpDocId = nlpDocBySource.get(sourceKey);
    if (nlpDocId != null) {
      nlpDocByRefDocId.set(docId, nlpDocId);
    }
  }

  return nlpDocByRefDocId;
}

async function buildSpanMapByNlpDocument(nlpDocIds) {
  const spanMap = new Map();
  if (nlpDocIds.length === 0) return spanMap;

  const chunks = chunkArray(nlpDocIds, 900);
  for (const chunk of chunks) {
    const binds = {};
    const inClause = buildInClause("doc", chunk, binds);

    const result = await db.execute(
      `
      SELECT
        es.document_id,
        es.slot_name,
        es.text,
        es.confidence,
        es.method,
        ts.evidence_text
      FROM evidence_spans es
      LEFT JOIN tagged_slots ts
        ON ts.slot_id = es.slot_id
      WHERE es.document_id IN (${inClause})
      ORDER BY es.document_id, NVL(es.confidence, 0) DESC, es.span_id ASC
      `,
      binds,
    );

    for (const row of result.rows) {
      if (!spanMap.has(row.DOCUMENT_ID)) spanMap.set(row.DOCUMENT_ID, []);
      spanMap.get(row.DOCUMENT_ID).push({
        slotName: row.SLOT_NAME || "",
        text: row.TEXT || row.EVIDENCE_TEXT || "",
        confidence: row.CONFIDENCE,
        method: row.METHOD || "",
      });
    }
  }

  return spanMap;
}

function chooseEvidenceFromDocs(docIds, parsedDiff, docEvidenceMap, fallbackSpan, fallbackWindow) {
  const diffKeys = new Set([
    ...Object.keys(parsedDiff?.now || {}).map((key) => String(key).toLowerCase()),
    ...Object.keys(parsedDiff?.prev || {}).map((key) => String(key).toLowerCase()),
  ]);

  let fallbackCandidate = null;

  for (const docId of docIds) {
    const spans = docEvidenceMap.get(docId) || [];
    if (spans.length === 0) continue;

    const matchingSpans = spans.filter(
      (span) =>
        span.text &&
        span.slotName &&
        diffKeys.has(String(span.slotName).toLowerCase()),
    );
    if (matchingSpans.length === 0) {
      if (!fallbackCandidate) {
        const fallbackPreferred = spans.find((span) => span.text);
        if (!fallbackPreferred) continue;

        const fallbackWindowPieces = [fallbackPreferred.text];
        for (const span of spans) {
          if (!span.text || fallbackWindowPieces.includes(span.text)) continue;
          fallbackWindowPieces.push(span.text);
          if (fallbackWindowPieces.length >= 3) break;
        }

        const fallbackSlotRefs = [...new Set(spans.map((span) => span.slotName).filter(Boolean))].slice(0, 8);
        fallbackCandidate = {
          docId,
          span: fallbackPreferred.text,
          spanWindow: fallbackWindowPieces.join(" | "),
          slotRefs: fallbackSlotRefs,
        };
      }
      continue;
    }

    const preferred = matchingSpans[0];

    const windowPieces = [preferred.text];
    for (const span of spans) {
      if (!span.text || windowPieces.includes(span.text)) continue;
      windowPieces.push(span.text);
      if (windowPieces.length >= 3) break;
    }

    const slotRefs = [...new Set(spans.map((span) => span.slotName).filter(Boolean))].slice(0, 8);
    return {
      docId,
      span: preferred.text,
      spanWindow: windowPieces.join(" | "),
      slotRefs,
    };
  }

  if (fallbackCandidate) return fallbackCandidate;

  return {
    docId: docIds[0] || null,
    span: fallbackSpan,
    spanWindow: fallbackWindow,
    slotRefs: [],
  };
}

async function buildDocEvidenceMap(admissionId, rows) {
  const supportingDocIds = collectSupportingDocIds(rows);
  if (supportingDocIds.length === 0) return new Map();

  const parsedRefs = supportingDocIds.map(parseDocRef).filter(Boolean);
  if (parsedRefs.length === 0) return new Map();

  const sourceLookup = await buildAdmissionSourceLookup(admissionId);
  const sourceRefsByDocId = new Map();

  for (const ref of parsedRefs) {
    const sourceId =
      sourceLookup.get(`${ref.sourceTable}|${ref.ts}|${ref.seq}`) ||
      sourceLookup.get(`${ref.sourceTable}|${ref.ts}|1`);
    if (sourceId == null) continue;
    sourceRefsByDocId.set(ref.docId, {
      sourceTable: ref.sourceTable,
      sourceId,
    });
  }

  if (sourceRefsByDocId.size === 0) return new Map();

  const nlpDocByRefDocId = await buildNlpDocumentMap(admissionId, sourceRefsByDocId);
  if (nlpDocByRefDocId.size === 0) return new Map();

  const spanMapByNlpDoc = await buildSpanMapByNlpDocument([...new Set(nlpDocByRefDocId.values())]);
  const docEvidenceMap = new Map();

  for (const [docId, nlpDocId] of nlpDocByRefDocId.entries()) {
    docEvidenceMap.set(docId, spanMapByNlpDoc.get(nlpDocId) || []);
  }

  return docEvidenceMap;
}

function getRangeConfig(range) {
  return RANGE_CONFIG[range] || RANGE_CONFIG["72h"];
}

function eventComparatorByTimeAsc(a, b) {
  const diff = a.EVENT_DATETIME.getTime() - b.EVENT_DATETIME.getTime();
  if (diff !== 0) return diff;
  return Number(a.EVENT_ID) - Number(b.EVENT_ID);
}

function eventComparatorBySeverityThenTsDesc(a, b) {
  const sDiff = (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0);
  if (sDiff !== 0) return sDiff;
  return new Date(b.ts).getTime() - new Date(a.ts).getTime();
}

function buildTrajectoryStrip(events, range, anchorMs) {
  const { hours, binHours } = getRangeConfig(range);
  const windowMs = hours * 60 * 60 * 1000;
  const binMs = binHours * 60 * 60 * 1000;
  const startMs = anchorMs - windowMs;
  const binCount = Math.max(1, Math.ceil(windowMs / binMs));
  const buckets = Array.from({ length: binCount }, () => []);

  for (const event of events) {
    const tsMs = new Date(event.ts).getTime();
    if (tsMs < startMs || tsMs > anchorMs) continue;
    let idx = Math.floor((tsMs - startMs) / binMs);
    if (idx >= binCount) idx = binCount - 1;
    buckets[idx].push(event);
  }

  const bins = [];
  let previousRank = 0;
  for (let idx = 0; idx < binCount; idx++) {
    const binStart = startMs + idx * binMs;
    const binEnd = Math.min(anchorMs, binStart + binMs);
    const currentEvents = buckets[idx];

    let maxSeverity = "none";
    let topEvent = null;
    let improvementCount = 0;
    let deteriorationCount = 0;
    for (const event of currentEvents) {
      if ((SEVERITY_ORDER[event.severity] || 0) >= (SEVERITY_ORDER[maxSeverity] || 0)) {
        maxSeverity = event.severity;
        topEvent = event;
      }

      const eventType = String(event.event_type || "").toLowerCase();
      if (IMPROVING_STRIP_TYPES.has(eventType)) {
        improvementCount += 1;
      } else if (event.issue_only) {
        deteriorationCount += 1;
      }
    }

    const rank = SEVERITY_ORDER[maxSeverity] || 0;
    bins.push({
      bin_start: new Date(binStart).toISOString(),
      bin_end: new Date(binEnd).toISOString(),
      max_severity: maxSeverity,
      risk_score: rank > 0 ? clamp(rank * 2 + currentEvents.length * 0.4, 0, 10) : 0,
      event_count: currentEvents.length,
      improvement_count: improvementCount,
      deterioration_count: deteriorationCount,
      top_event_id: topEvent ? topEvent.event_id : null,
      turning_point: idx > 0 && Math.abs(rank - previousRank) >= 2,
    });
    previousRank = rank;
  }

  return bins;
}

function buildAxisSnapshot(events) {
  const byAxis = new Map();
  for (const axis of AXIS_KEYS) byAxis.set(axis, []);
  for (const event of events) {
    if (!byAxis.has(event.axis)) byAxis.set(event.axis, []);
    byAxis.get(event.axis).push(event);
  }

  return AXIS_KEYS.map((axis) => {
    const axisEvents = [...(byAxis.get(axis) || [])].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );

    if (axisEvents.length === 0) {
      return {
        axis,
        state: "stable",
        delta_score: 0,
        confidence: 0.55,
        now_prev_line: "변화 없음",
        top_evidence_line: "-",
        top_event_id: null,
      };
    }

    const mid = Math.max(1, Math.floor(axisEvents.length / 2));
    const prevPart = axisEvents.slice(0, mid);
    const nowPart = axisEvents.slice(mid);

    const avg = (arr) => {
      if (arr.length === 0) return 0;
      return arr.reduce((sum, row) => sum + (SEVERITY_ORDER[row.severity] || 0), 0) / arr.length;
    };

    const prevAvg = avg(prevPart);
    const nowAvg = avg(nowPart.length > 0 ? nowPart : prevPart);
    const diff = nowAvg - prevAvg;

    let state = "stable";
    let deltaScore = 0;
    if (diff > 0.4) {
      state = "worsening";
      deltaScore = -Math.max(1, Math.round(diff));
    } else if (diff < -0.4) {
      state = "improving";
      deltaScore = Math.max(1, Math.round(Math.abs(diff)));
    }

    const topEvent = [...axisEvents].sort(eventComparatorBySeverityThenTsDesc)[0];
    const confidence = clamp(0.58 + Math.min(0.32, axisEvents.length * 0.035 + Math.abs(diff) * 0.08), 0.58, 0.95);

    return {
      axis,
      state,
      delta_score: deltaScore,
      confidence,
      now_prev_line: topEvent?.now_prev?.diff_line || topEvent?.summary_ko || "변화 없음",
      top_evidence_line: topEvent?.evidence_after?.span || "-",
      top_event_id: topEvent?.event_id || null,
    };
  });
}

function buildPatientMeta(patientRow, anchorDate, latestEventDate, demo = {}) {
  const gender = patientRow.GENDER || "-";
  const age = patientRow.AGE != null ? String(patientRow.AGE) : "-";
  const ward = patientRow.WARD_NAME || patientRow.WARD_ID || "-";
  const room = patientRow.ROOM_NUMBER || "-";
  const wardBed = ward !== "-" || room !== "-" ? `${ward}-${room}` : "-";

  const baseAdmitDate = patientRow.SIM_ADMIT_DATE || patientRow.ADMIT_DATE;
  const currentHd = Number(patientRow.CURRENT_HD);
  const dMin = toFiniteNumber(patientRow.D_MIN);
  const effectiveMaxD = toFiniteNumber(demo.effectiveMaxD);
  let admitHd = Number.isFinite(currentHd) && currentHd > 0 ? Math.floor(currentHd) : 1;

  // Demo 컷오프 D를 환자별 HD로 환산: HD = (effectiveMaxD - dMin + 1)
  if (Number.isFinite(effectiveMaxD) && Number.isFinite(dMin)) {
    const hdAtCutoff = effectiveMaxD - dMin + 1;
    if (Number.isFinite(hdAtCutoff) && hdAtCutoff > 0) {
      admitHd = Math.floor(hdAtCutoff);
    }
  }

  if (
    (!Number.isFinite(effectiveMaxD) || !Number.isFinite(dMin)) &&
    (!Number.isFinite(currentHd) || currentHd <= 0) &&
    baseAdmitDate instanceof Date
  ) {
    const days = Math.floor((anchorDate.getTime() - baseAdmitDate.getTime()) / (24 * 60 * 60 * 1000));
    admitHd = Math.max(1, days + 1);
  }

  const tags = parseJsonArray(patientRow.INFECTION_TAGS_JSON).map((tag) => String(tag));

  return {
    patient_id: patientRow.PATIENT_ID,
    name: patientRow.NAME || patientRow.PATIENT_ID,
    sex_age: `${gender}/${age}`,
    ward_bed: wardBed,
    admit_day: `HD${admitHd}`,
    tags,
    last_updated: toIso(latestEventDate || anchorDate) || new Date().toISOString(),
  };
}

function buildExplainEvents(rows, range, startMs, endMs, docEvidenceMap = new Map()) {
  const { binHours } = getRangeConfig(range);
  const binMs = binHours * 60 * 60 * 1000;

  const rowsInWindow = rows.filter((row) => {
    const tsMs = row.EVENT_DATETIME.getTime();
    return tsMs > startMs && tsMs <= endMs;
  });

  const mappedEvents = [];
  const seenNoopCxrKeys = new Set();
  for (let idx = 0; idx < rowsInWindow.length; idx++) {
    const row = rowsInWindow[idx];
    let eventType = String(row.EVENT_TYPE || "").toLowerCase();
    let severity = normalizeSeverity(row.SEVERITY, row.PRIORITY_RANK);
    const axis = inferEventAxis(eventType, row.AXIS_TYPE);
    const tsMs = row.EVENT_DATETIME.getTime();

    const parsedDiff = parseDiffMap(row.EVIDENCE_TEXT || row.RENDER_TEXT || "");
    const docsRaw = parseJsonArray(row.SUPPORTING_DOCS_JSON).map((item) => String(item));
    let summaryOverride = null;
    let diffLineOverride = null;
    if (isNoopCxrSeverityEvent(eventType, parsedDiff)) {
      const noopKey = buildNoopCxrEventKey(row, parsedDiff, docsRaw);
      if (seenNoopCxrKeys.has(noopKey)) {
        continue;
      }
      seenNoopCxrKeys.add(noopKey);
      eventType = "cxr_no_change";
      severity = "low";
      summaryOverride = buildNoopCxrSummary(parsedDiff);
      diffLineOverride = "CXR 변화 없음";
    }

    const docs = sortSupportingDocs(docsRaw, tsMs, axis, eventType, parsedDiff);
    const primaryDoc = docs.length > 0 ? docs[0] : `TE_${row.EVENT_ID}`;
    const preferredDocs = [primaryDoc, ...docs.filter((docId) => docId !== primaryDoc)];
    const issueOnly = isIssueEvent(eventType, severity, row.RENDER_TEXT, row.EVIDENCE_TEXT);
    const afterEvidence = chooseEvidenceFromDocs(
      preferredDocs,
      parsedDiff,
      docEvidenceMap,
      row.RENDER_TEXT || row.EVIDENCE_TEXT || "",
      row.EVIDENCE_TEXT || row.RENDER_TEXT || "",
    );
    const selectedDocId = afterEvidence.docId || primaryDoc;
    const docMeta = inferDocMetaFromId(selectedDocId, axis, eventType);

    const previousSameAxisRow = (() => {
      for (let j = idx - 1; j >= 0; j--) {
        const prev = rowsInWindow[j];
        if (inferEventAxis(prev.EVENT_TYPE, prev.AXIS_TYPE) === axis) return prev;
      }
      return null;
    })();

    const previousEvidence = (() => {
      if (!previousSameAxisRow) return null;
      const previousEventType = String(previousSameAxisRow.EVENT_TYPE || "").toLowerCase();
      const previousAxis = inferEventAxis(
        previousSameAxisRow.EVENT_TYPE,
        previousSameAxisRow.AXIS_TYPE,
      );
      const previousParsedDiff = parseDiffMap(
        previousSameAxisRow.EVIDENCE_TEXT || previousSameAxisRow.RENDER_TEXT || "",
      );
      const previousDocsRaw = parseJsonArray(previousSameAxisRow.SUPPORTING_DOCS_JSON).map((item) =>
        String(item),
      );
      const previousDocs = sortSupportingDocs(
        previousDocsRaw,
        previousSameAxisRow.EVENT_DATETIME.getTime(),
        previousAxis,
        previousEventType,
        previousParsedDiff,
      );
      const previousPrimaryDoc = previousDocs.length > 0
        ? previousDocs[0]
        : `TE_${previousSameAxisRow.EVENT_ID}`;
      const previousChosenEvidence = chooseEvidenceFromDocs(
        [previousPrimaryDoc, ...previousDocs.filter((docId) => docId !== previousPrimaryDoc)],
        previousParsedDiff,
        docEvidenceMap,
        previousSameAxisRow.RENDER_TEXT || previousSameAxisRow.EVIDENCE_TEXT || "",
        previousSameAxisRow.EVIDENCE_TEXT || previousSameAxisRow.RENDER_TEXT || "",
      );
      const previousDocId = previousChosenEvidence.docId || previousPrimaryDoc;
      const previousDocMeta = inferDocMetaFromId(previousDocId, axis, previousEventType);

      return {
        doc_id: previousDocId,
        doc_type: previousDocMeta.docType,
        doc_ts: toIso(previousSameAxisRow.EVENT_DATETIME),
        author_role: previousDocMeta.authorRole,
        span: previousChosenEvidence.span,
        span_window: previousChosenEvidence.spanWindow,
        slot_refs: previousChosenEvidence.slotRefs.length > 0 ? previousChosenEvidence.slotRefs : previousDocs,
        flags: inferFlags(previousSameAxisRow.RENDER_TEXT, previousSameAxisRow.EVIDENCE_TEXT),
      };
    })();

    const confidenceBase = issueOnly ? 0.72 : 0.62;
    const confidenceBoost = (SEVERITY_ORDER[severity] || 0) * 0.035 + (row.PRIORITY_RANK === 1 ? 0.06 : 0);
    const confidence = clamp(confidenceBase + confidenceBoost, 0.52, 0.97);
    const binStart = startMs + Math.floor((tsMs - startMs) / binMs) * binMs;

    mappedEvents.push({
      event_id: String(row.EVENT_ID),
      ts: toIso(row.EVENT_DATETIME),
      time_bin: new Date(binStart).toISOString(),
      axis,
      event_type: eventType,
      summary_ko: summaryOverride || row.RENDER_TEXT || row.EVIDENCE_TEXT || `${eventType} 이벤트`,
      severity,
      confidence,
      issue_only: issueOnly,
      now_prev: {
        diff_line: diffLineOverride || parsedDiff.diffLine || row.EVIDENCE_TEXT || row.RENDER_TEXT || "",
        now: parsedDiff.now,
        prev: parsedDiff.prev,
      },
      evidence_after: {
        doc_id: selectedDocId,
        doc_type: docMeta.docType,
        doc_ts: toIso(row.EVENT_DATETIME),
        author_role: docMeta.authorRole,
        span: afterEvidence.span,
        span_window: afterEvidence.spanWindow,
        slot_refs: afterEvidence.slotRefs.length > 0 ? afterEvidence.slotRefs : docs,
        flags: inferFlags(row.RENDER_TEXT, row.EVIDENCE_TEXT),
      },
      evidence_before: previousEvidence,
      related_event_ids: previousSameAxisRow ? [String(previousSameAxisRow.EVENT_ID)] : [],
    });
  }

  return mappedEvents;
}

async function getPatientContext(patientId, demoStep = null) {
  const result = await db.execute(
    `
    SELECT
      p.patient_id,
      p.name,
      p.gender,
      p.age,
      a.admission_id,
      a.current_hd,
      a.admit_date,
      a.sim_admit_date,
      a.d_min,
      a.d_max,
      a.d_length,
      a.demo_d_offset,
      ps.infection_tags_json,
      ps.current_bed_id,
      w.ward_id,
      w.ward_name,
      r.room_number
    FROM patients p
    LEFT JOIN (
      SELECT admission_id, patient_id, current_hd, admit_date, sim_admit_date,
             d_min, d_max, d_length, demo_d_offset
      FROM (
        SELECT
          a.*,
          ROW_NUMBER() OVER (
            PARTITION BY a.patient_id
            ORDER BY NVL(a.sim_admit_date, a.admit_date) DESC NULLS LAST, a.admission_id DESC
          ) rn
        FROM admissions a
      )
      WHERE rn = 1
        AND (
          :demoStep IS NULL OR
          (
            :demoStep >= NVL(demo_d_offset, 0) + 1
            AND :demoStep <= NVL(demo_d_offset, 0) + NVL(d_length, 0)
          )
        )
    ) a
      ON a.patient_id = p.patient_id
    LEFT JOIN patient_status ps
      ON ps.admission_id = a.admission_id
    LEFT JOIN beds b
      ON b.bed_id = ps.current_bed_id
    LEFT JOIN rooms r
      ON r.room_id = b.room_id
    LEFT JOIN wards w
      ON w.ward_id = r.ward_id
    WHERE p.patient_id = :pid
    `,
    { pid: patientId, demoStep },
  );

  if (!result.rows.length) return null;
  const row = result.rows[0];

  if (!row.ROOM_NUMBER) {
    const fallbackBed = await db.execute(
      `
      SELECT
        r.room_number,
        w.ward_id,
        w.ward_name
      FROM beds b
      JOIN rooms r ON r.room_id = b.room_id
      JOIN wards w ON w.ward_id = r.ward_id
      WHERE b.patient_id = :pid
      FETCH FIRST 1 ROWS ONLY
      `,
      { pid: patientId },
    );

    if (fallbackBed.rows.length > 0) {
      const bedRow = fallbackBed.rows[0];
      row.ROOM_NUMBER = bedRow.ROOM_NUMBER;
      row.WARD_ID = bedRow.WARD_ID;
      row.WARD_NAME = bedRow.WARD_NAME;
    }
  }

  return row;
}

async function getTrajectoryRows(admissionId, demo = {}) {
  const effectiveMaxD = toFiniteNumber(demo.effectiveMaxD);
  const demoShiftOrder = toFiniteNumber(demo.demoShiftOrder);
  const binds = { aid: admissionId, effectiveMaxD, demoShiftOrder };

  const result = await db.execute(
    `
    SELECT
      event_id,
      event_type,
      event_datetime,
      axis_type,
      priority_rank,
      render_text,
      evidence_text,
      severity,
      supporting_docs_json,
      hd,
      d_number,
      shift
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
    ORDER BY event_datetime ASC, event_id ASC
    `,
    binds,
  );
  return result.rows;
}

function parseRange(rawRange) {
  const normalized = String(rawRange || "72h");
  if (!RANGE_CONFIG[normalized]) return null;
  return normalized;
}

async function buildPayloadFromRows(patientRow, rows, range, showContext, asOfDate, demo = {}) {
  const sortedRows = [...rows].sort(eventComparatorByTimeAsc);
  const latestEventDate = sortedRows.length > 0 ? sortedRows[sortedRows.length - 1].EVENT_DATETIME : null;
  const docEvidenceMap = await buildDocEvidenceMap(patientRow.ADMISSION_ID, sortedRows);

  const anchorDate = asOfDate || latestEventDate || new Date();
  const { hours } = getRangeConfig(range);
  const endMs = anchorDate.getTime();
  const startMs = endMs - hours * 60 * 60 * 1000;

  let mappedEvents = buildExplainEvents(sortedRows, range, startMs, endMs, docEvidenceMap);
  if (mappedEvents.length === 0 && sortedRows.length > 0) {
    const fallbackEnd = sortedRows[sortedRows.length - 1].EVENT_DATETIME.getTime();
    const fallbackStart = fallbackEnd - hours * 60 * 60 * 1000;
    mappedEvents = buildExplainEvents(sortedRows, range, fallbackStart, fallbackEnd, docEvidenceMap);
  }

  const issueEvents = mappedEvents.filter((event) => event.issue_only);
  const contextEvents = mappedEvents.filter((event) => !event.issue_only);
  const eventsForSnapshot = mappedEvents;

  const payload = {
    patient: buildPatientMeta(patientRow, anchorDate, latestEventDate, demo),
    range,
    axis_snapshot: buildAxisSnapshot(eventsForSnapshot),
    trajectory_strip: buildTrajectoryStrip(eventsForSnapshot, range, anchorDate.getTime()),
    events: issueEvents,
    context_events: showContext ? contextEvents : [],
  };

  return { payload, mappedEvents, issueEvents, contextEvents };
}

async function loadExplainData(patientId, range, showContext, asOfDate, demo = {}) {
  const patientRow = await getPatientContext(patientId, demo.demoStep);
  if (!patientRow) {
    return {
      error: {
        status: 404,
        body: {
          status: "error",
          code: "PATIENT_NOT_FOUND",
          message: "환자를 찾을 수 없습니다.",
        },
      },
    };
  }

  if (!patientRow.ADMISSION_ID) {
    return {
      error: {
        status: 404,
        body: {
          status: "error",
          code: "NO_NLP_DATA",
          message: "해당 환자의 Explain 데이터가 없습니다.",
        },
      },
    };
  }

  const effectiveMaxD = computeEffectiveMaxD(
    patientRow.D_MIN,
    patientRow.DEMO_D_OFFSET,
    demo.demoStep,
  );

  const rows = await getTrajectoryRows(patientRow.ADMISSION_ID, {
    effectiveMaxD,
    demoShiftOrder: demo.demoShiftOrder,
  });
  if (rows.length === 0) {
    return {
      error: {
        status: 404,
        body: {
          status: "error",
          code: "NO_NLP_DATA",
          message: "해당 환자의 Explain 데이터가 없습니다.",
        },
      },
    };
  }

  const built = await buildPayloadFromRows(
    patientRow,
    rows,
    range,
    showContext,
    asOfDate,
    { effectiveMaxD },
  );
  return { patientRow, rows, ...built };
}

router.get("/patients/:patientId/explain", async (req, res) => {
  try {
    const range = parseRange(req.query.range);
    if (!range) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_RANGE",
        message: "range 파라미터는 24h, 72h, 7d 중 하나여야 합니다.",
      });
    }

    const showContext = String(req.query.show_context || "false").toLowerCase() === "true";
    const asOfDate = parseAsOf(req.query.asOf);
    const demo = {
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
      demoShiftOrder: getShiftOrder(req.demoShift),
    };
    if (req.query.asOf && !asOfDate) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_ASOF",
        message: "asOf 파라미터 형식이 올바르지 않습니다.",
      });
    }

    const loaded = await loadExplainData(
      req.params.patientId,
      range,
      showContext,
      asOfDate,
      demo,
    );
    if (loaded.error) {
      return res.status(loaded.error.status).json(loaded.error.body);
    }

    return res.json({
      status: "ok",
      data: loaded.payload,
    });
  } catch (error) {
    console.error("GET /api/patients/:patientId/explain failed:", error);
    return res.status(500).json({
      status: "error",
      code: "INTERNAL_ERROR",
      message: "Explain 데이터를 조회하는 중 오류가 발생했습니다.",
    });
  }
});

router.get("/patients/:patientId/explain/events", async (req, res) => {
  try {
    const range = parseRange(req.query.range);
    if (!range) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_RANGE",
        message: "range 파라미터는 24h, 72h, 7d 중 하나여야 합니다.",
      });
    }

    const asOfDate = parseAsOf(req.query.asOf);
    const demo = {
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
      demoShiftOrder: getShiftOrder(req.demoShift),
    };
    if (req.query.asOf && !asOfDate) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_ASOF",
        message: "asOf 파라미터 형식이 올바르지 않습니다.",
      });
    }

    const axisFilter = String(req.query.axis || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const severityFilter = String(req.query.severity || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const issueOnly = String(req.query.issue_only || "true").toLowerCase() !== "false";
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const rawLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Number.isFinite(rawLimit) ? clamp(rawLimit, 1, 50) : 20;

    const loaded = await loadExplainData(
      req.params.patientId,
      range,
      true,
      asOfDate,
      demo,
    );
    if (loaded.error) {
      return res.status(loaded.error.status).json(loaded.error.body);
    }

    let events = [...loaded.issueEvents, ...loaded.contextEvents];
    if (axisFilter.length > 0) {
      const axisSet = new Set(axisFilter);
      events = events.filter((event) => axisSet.has(event.axis));
    }
    if (severityFilter.length > 0) {
      const severitySet = new Set(severityFilter);
      events = events.filter((event) => severitySet.has(event.severity));
    }
    if (issueOnly) {
      events = events.filter((event) => event.issue_only);
    }

    events.sort(eventComparatorBySeverityThenTsDesc);

    let startIdx = 0;
    if (cursor) {
      const cursorIndex = events.findIndex((event) => event.event_id === cursor);
      if (cursorIndex >= 0) startIdx = cursorIndex + 1;
    }

    const page = events.slice(startIdx, startIdx + limit);
    const hasMore = startIdx + limit < events.length;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].event_id : null;

    return res.json({
      status: "ok",
      data: {
        events: page,
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    });
  } catch (error) {
    console.error("GET /api/patients/:patientId/explain/events failed:", error);
    return res.status(500).json({
      status: "error",
      code: "INTERNAL_ERROR",
      message: "Explain 이벤트를 조회하는 중 오류가 발생했습니다.",
    });
  }
});

router.get("/patients/:patientId/explain/event/:eventId", async (req, res) => {
  try {
    const range = parseRange(req.query.range || "72h");
    if (!range) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_RANGE",
        message: "range 파라미터는 24h, 72h, 7d 중 하나여야 합니다.",
      });
    }

    const asOfDate = parseAsOf(req.query.asOf);
    const demo = {
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
      demoShiftOrder: getShiftOrder(req.demoShift),
    };
    if (req.query.asOf && !asOfDate) {
      return res.status(400).json({
        status: "error",
        code: "INVALID_ASOF",
        message: "asOf 파라미터 형식이 올바르지 않습니다.",
      });
    }

    const loaded = await loadExplainData(
      req.params.patientId,
      range,
      true,
      asOfDate,
      demo,
    );
    if (loaded.error) {
      return res.status(loaded.error.status).json(loaded.error.body);
    }

    const targetId = String(req.params.eventId);
    const target = [...loaded.issueEvents, ...loaded.contextEvents].find(
      (event) => event.event_id === targetId,
    );

    if (!target) {
      return res.status(404).json({
        status: "error",
        code: "EVENT_NOT_FOUND",
        message: "이벤트를 찾을 수 없습니다.",
      });
    }

    return res.json({
      status: "ok",
      data: target,
    });
  } catch (error) {
    console.error("GET /api/patients/:patientId/explain/event/:eventId failed:", error);
    return res.status(500).json({
      status: "error",
      code: "INTERNAL_ERROR",
      message: "Explain 이벤트 상세를 조회하는 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
