/**
 * PatientExplainPayload v1 TypeScript 타입 정의
 * 아키텍처 문서 § 2 (JSON 스키마) 기준
 */

// ── Enum 타입 ─────────────────────────────────────────

export type AxisType = "resp" | "inf" | "action" | "esc" | "iso" | "sym"

export type AxisState = "worsening" | "stable" | "improving"

export type SeverityLevel = "critical" | "high" | "medium" | "low" | "info" | "none"

export type RangeType = "24h" | "72h" | "7d"

export type DocType =
  | "nursing_note"
  | "physician_note"
  | "lab_result"
  | "microbiology"
  | "radiology"

export type AuthorRole = "RN" | "MD" | "LAB" | "RAD"

// ── 환자 메타 ─────────────────────────────────────────

export interface PatientMeta {
  patient_id: string
  name: string
  sex_age: string        // e.g. "M/72"
  ward_bed: string       // e.g. "52W-302-1"
  admit_day: string      // e.g. "D+4"
  tags?: string[]        // e.g. ["mdro_confirmed_mrsa"]
  last_updated: string   // ISO-8601
}

// ── 축 스냅샷 ─────────────────────────────────────────

export interface AxisSnapshot {
  axis: AxisType
  state: AxisState
  delta_score: number       // e.g. -2
  confidence: number        // 0.0~1.0
  now_prev_line: string
  top_evidence_line: string
  top_event_id: string | null
}

// ── 72h 스트립 ────────────────────────────────────────

export interface StripBin {
  bin_start: string          // ISO-8601
  bin_end: string            // ISO-8601
  max_severity: SeverityLevel
  risk_score: number         // 0.0~10.0
  event_count: number
  improvement_count?: number
  deterioration_count?: number
  top_event_id: string | null
  turning_point: boolean
}

// ── Evidence 구조 ─────────────────────────────────────

export interface EvidenceFlags {
  plan: boolean
  uncertain: boolean
  negated: boolean
}

export interface Evidence {
  doc_id: string
  doc_type: DocType
  doc_ts: string             // ISO-8601
  author_role: AuthorRole
  span: string               // 원문 그대로
  span_window?: string       // 전후 1~2문장
  slot_refs?: string[]
  flags: EvidenceFlags
}

// ── NowPrev ───────────────────────────────────────────

export interface NowPrev {
  diff_line: string
  now: Record<string, unknown>
  prev: Record<string, unknown>
}

// ── 이벤트 (issue_only / context 공통) ────────────────

export interface ExplainEvent {
  event_id: string
  ts: string                 // ISO-8601
  time_bin: string           // ISO-8601 bin_start
  axis: AxisType
  event_type: string
  summary_ko: string
  severity: SeverityLevel
  confidence: number
  issue_only: boolean
  now_prev: NowPrev
  evidence_after: Evidence
  evidence_before: Evidence | null
  related_event_ids?: string[]
}

// ── 시계열 포인트 ─────────────────────────────────────

export interface TimeseriesPoint {
  ts: string
  value: number
}

export interface Timeseries {
  spo2?: TimeseriesPoint[]
  temp?: TimeseriesPoint[]
  wbc?: TimeseriesPoint[]
  crp?: TimeseriesPoint[]
  hr?: TimeseriesPoint[]
  bp_sys?: TimeseriesPoint[]
  [key: string]: TimeseriesPoint[] | undefined
}

// ── PatientExplainPayload v1 ──────────────────────────

export interface PatientExplainPayload {
  patient: PatientMeta
  range: RangeType
  axis_snapshot: AxisSnapshot[]
  trajectory_strip: StripBin[]
  events: ExplainEvent[]
  context_events: ExplainEvent[]
  timeseries?: Timeseries
}

// ── API 응답 래퍼 ─────────────────────────────────────

export interface ExplainApiResponse {
  status: "ok" | "error"
  data?: PatientExplainPayload
  code?: string
  message?: string
}

export interface EventsApiResponse {
  status: "ok" | "error"
  data?: {
    events: ExplainEvent[]
    next_cursor: string | null
    has_more: boolean
  }
  code?: string
  message?: string
}

// ── Axis 메타 정보 (UI 표시용) ────────────────────────

export const AXIS_META: Record<AxisType, { label: string; labelKo: string; icon: string }> = {
  resp: { label: "Respiratory", labelKo: "호흡", icon: "wind" },
  inf: { label: "Infection Activity", labelKo: "감염활동", icon: "thermometer" },
  action: { label: "Clinical Action", labelKo: "임상조치", icon: "activity" },
  esc: { label: "Escalation", labelKo: "악화", icon: "trending-up" },
  iso: { label: "Infection Control", labelKo: "감염관리", icon: "shield" },
  sym: { label: "Symptoms", labelKo: "증상", icon: "heart-pulse" },
}

// ── 색상 규칙 (§ 6) ───────────────────────────────────

export const SEVERITY_COLOR: Record<SeverityLevel, { bg: string; text: string; border: string }> = {
  critical: { bg: "#DC2626", text: "#FFFFFF", border: "#DC2626" },
  high: { bg: "#EA580C", text: "#FFFFFF", border: "#EA580C" },
  medium: { bg: "#D97706", text: "#000000", border: "#D97706" },
  low: { bg: "#65A30D", text: "#000000", border: "#65A30D" },
  info: { bg: "#3B82F6", text: "#FFFFFF", border: "#3B82F6" },
  none: { bg: "#E5E7EB", text: "#6B7280", border: "#E5E7EB" },
}

export const AXIS_STATE_COLOR: Record<AxisState, { className: string }> = {
  worsening: { className: "text-red-500 bg-red-500/10 border-red-500/30" },
  stable: { className: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  improving: { className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30" },
}

/** R09: flags → [부정]/[불확실]/[계획] 라벨 */
export function buildFlagLabels(flags: EvidenceFlags): string[] {
  const labels: string[] = []
  if (flags.negated) labels.push("[부정]")
  if (flags.uncertain) labels.push("[불확실]")
  if (flags.plan) labels.push("[계획]")
  return labels
}

/** § 6.2: risk_score → opacity */
export function riskScoreToOpacity(score: number): number {
  return Math.max(0.4, Math.min(1.0, score / 10))
}
