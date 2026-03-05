import type { NowPrev } from "@/lib/explain-types";

const FIELD_LABEL_KO: Record<string, string> = {
  spo2_value: "산소 포화도",
  temp_value: "체온",
  wbc_value: "백혈구",
  crp_value: "CRP",
  platelet_value: "혈소판",
  abx_event: "항생제 변화",
  isolation_applied: "격리 적용",
  isolation_required: "격리 필요",
  notify_mentioned: "의료진 보고",
  cxr_severity: "cxr 중증도",
  resp_support_event: "호흡 보조 변화",
  altered_mentation: "의식 변화",
  pain_nrs_value: "통증 점수",
  pain_location_hint: "통증 부위",
  mdro_status: "MDRO 상태",
  mdro_flag: "MDRO 균주",
  culture_ordered: "배양 오더",
  culture_status: "배양 결과",
  prn_interventions: "PRN 처치",
  new: "신규",
  diarrhea: "설사",
  nausea_vomiting: "오심/구토",
  symptom_name: "증상",
};

const VALUE_LABEL_KO: Record<string, string> = {
  true: "있음",
  false: "없음",
  unknown: "미상",
  none: "없음",
  null: "없음",
  start: "시작",
  change: "변경",
  escalate: "상향",
  increase: "증가",
  preliminary: "예비",
  positive: "양성",
  negative: "음성",
  pending: "대기",
  no_growth: "무증식",
  confirmed: "확정",
  suspected: "의심",
  mild: "경증",
  moderate: "중등도",
  severe: "중증",
  minimal: "미미",
  normal: "정상",
  blood: "혈액",
  stool: "대변",
  sputum: "객담",
  urine: "소변",
  "specimen collection": "검체 채취",
  "c. diff toxin": "C. diff 독소",
  "culture 시행": "배양 시행",
  "while cultur": "배양 시행",
  iv_fluid: "정맥 수액",
  suction: "흡인",
  antipyretic: "해열제",
  analgesic: "진통제",
  antiemetic: "항구토제",
  neb: "네뷸라이저",
  oxygen_prn: "산소 PRN",
};

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toDisplayScalar(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "있음" : "없음";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (VALUE_LABEL_KO[normalized]) return VALUE_LABEL_KO[normalized];
    return value;
  }
  return String(value);
}

export function localizeExplainFieldLabel(field: string): string {
  return FIELD_LABEL_KO[field] || field;
}

export function formatExplainValue(value: unknown): string {
  if (Array.isArray(value)) {
    const rendered = value.map((item) => toDisplayScalar(item));
    return `[${rendered.join(", ")}]`;
  }
  return toDisplayScalar(value);
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, idx) => String(item) === String(right[idx]));
  }
  return String(left) === String(right);
}

export function localizeRawDiffLine(raw: string): string {
  if (!raw) return raw;

  let localized = raw;
  for (const [key, label] of Object.entries(FIELD_LABEL_KO)) {
    localized = localized.replace(new RegExp(`\\b${key}\\b`, "g"), label);
  }

  const valuePairs = Object.entries(VALUE_LABEL_KO).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [rawValue, label] of valuePairs) {
    const escaped = escapeRegExp(rawValue);
    localized = localized.replace(new RegExp(`\\b${escaped}\\b`, "gi"), label);
  }

  return localized;
}

export function buildLocalizedDiffLine(nowPrev: NowPrev): string {
  const now = nowPrev?.now || {};
  const prev = nowPrev?.prev || {};
  const parts: string[] = [];

  for (const key of Object.keys(now)) {
    const label = localizeExplainFieldLabel(key);
    const currentValue = now[key];
    const previousValue = prev[key];

    if (previousValue === undefined || previousValue === null) {
      parts.push(`${label}: ${formatExplainValue(currentValue)}`);
      continue;
    }

    if (isSameValue(previousValue, currentValue)) {
      continue;
    }

    parts.push(
      `${label}: ${formatExplainValue(previousValue)} → ${formatExplainValue(currentValue)}`,
    );
  }

  if (parts.length > 0) return parts.join(", ");
  return localizeRawDiffLine(nowPrev?.diff_line || "");
}
