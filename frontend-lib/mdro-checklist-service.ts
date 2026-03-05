import type { ChecklistMode, ChecklistType } from "@/lib/checklist-engine"
import {
  type DemoQueryParams,
  appendDemoParams,
  buildPathWithQuery,
} from "@/lib/demo-query"

type Source = "backend" | "local"

const LOCAL_LOGS_KEY = "look-checklist-logs-v2"
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000
const MAX_LOCAL_LOG_COUNT = 5000

export type ChecklistLogAction =
  | "check"
  | "uncheck"
  | "select_option"
  | "unselect_option"
  | "select_risk_group"
  | "unselect_risk_group"
  | "select_alternative"
  | "unselect_alternative"
  | "clear_all"
  | "update_note"
  | "apply_isolation"
  | "unapply_isolation"
  | "set_applied_status"
  | "apply_recommended_markers"
  | "snapshot_save"

export interface ChecklistLogEventInput extends DemoQueryParams {
  patient_id: string
  patient_name?: string
  checklist_type: ChecklistType
  infection_type?: ChecklistType
  mode: ChecklistMode
  subtype?: string
  changed_item_id?: string
  changed_item_label?: string
  action: ChecklistLogAction
  actor_role: "간호사" | "감염관리실" | "의사" | "기타"
  actor_name?: string
  reason?: string
  tags?: string[]
  details?: Record<string, unknown>
  timestamp?: string
}

export interface ChecklistLogSummary {
  id: string
  patient_id: string
  patient_name?: string
  checklist_type: ChecklistType
  infection_type: ChecklistType
  mode: ChecklistMode
  subtype?: string
  changed_item_id?: string
  changed_item_label?: string
  action: ChecklistLogAction
  actor_role: string
  actor_name?: string
  reason?: string
  tags: string[]
  details?: Record<string, unknown>
  created_at: string
  timestamp?: string
  demo_step?: number | null
  demo_shift?: string | null
}

export interface ChecklistLogsResponse {
  total: number
  logs: ChecklistLogSummary[]
}

export interface ListChecklistLogsParams extends DemoQueryParams {
  patientId?: string
  checklistType?: ChecklistType
  infectionType?: ChecklistType
  category?: "all" | "isolation" | "admin" | "alternative"
  limit?: number
}

export interface ListGapMetricsParams extends DemoQueryParams {
  thresholdHours?: number
  includeCases?: boolean
  days?: number
  patientId?: string
  checklistType?: ChecklistType
  infectionType?: ChecklistType
  category?: "all" | "isolation" | "admin" | "alternative"
  dateFrom?: string
  dateTo?: string
}

export interface GapCaseSummary {
  patient_id: string
  patient_name?: string
  checklist_type: ChecklistType
  infection_type: ChecklistType
  started_at: string
  ended_at: string | null
  start_log_id: string
  end_log_id: string | null
  status: "open" | "closed"
  duration_hours: number
}

export interface GapMetricsResponse {
  generated_at: string
  threshold_hours: number
  total_logs: number
  total_cases: number
  open_cases: number
  closed_cases: number
  avg_gap_hours: number
  median_gap_hours: number
  max_gap_hours: number
  threshold_exceeded_count: number
  threshold_exceeded_ratio: number
  cases?: GapCaseSummary[]
}

function getApiBase(): string {
  const envBase = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (envBase) return envBase.replace(/\/$/, "")
  if (typeof window !== "undefined" && window.location.hostname === "localhost") {
    return `http://localhost:${process.env.EXPRESS_PORT || "5002"}`
  }
  return ""
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? DEFAULT_LIMIT), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

function parseIso(value: unknown, fallbackIso: string): string {
  if (typeof value !== "string" || !value) return fallbackIso
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallbackIso : parsed.toISOString()
}

function toMs(value: string | undefined | null): number {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function loadLocalLogs(): ChecklistLogSummary[] {
  if (typeof window === "undefined") return []
  const raw = window.localStorage.getItem(LOCAL_LOGS_KEY)
  if (!raw) return []
  const parsed = safeJsonParse<ChecklistLogSummary[]>(raw, [])
  return Array.isArray(parsed) ? parsed : []
}

function saveLocalLogs(logs: ChecklistLogSummary[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LOCAL_LOGS_KEY, JSON.stringify(logs))
}

function toChecklistType(value: unknown, fallback: ChecklistType = "MDRO"): ChecklistType {
  if (value === "MDRO" || value === "GI_WATERBORNE" || value === "RESP_ISOLATION") return value
  return fallback
}

function toChecklistMode(value: unknown, fallback: ChecklistMode = "suspected"): ChecklistMode {
  if (value === "confirmed" || value === "suspected") return value
  return fallback
}

function toChecklistLogAction(
  value: unknown,
  fallback: ChecklistLogAction = "snapshot_save",
): ChecklistLogAction {
  const action = String(value ?? "")
  switch (action) {
    case "check":
    case "uncheck":
    case "select_option":
    case "unselect_option":
    case "select_risk_group":
    case "unselect_risk_group":
    case "select_alternative":
    case "unselect_alternative":
    case "clear_all":
    case "update_note":
    case "apply_isolation":
    case "unapply_isolation":
    case "set_applied_status":
    case "apply_recommended_markers":
    case "snapshot_save":
      return action
    default:
      return fallback
  }
}

function toChecklistLogSummary(
  row: Record<string, unknown>,
  fallbackInput?: ChecklistLogEventInput,
): ChecklistLogSummary {
  return {
    id: String(row.id ?? fallbackInput?.patient_id ?? ""),
    patient_id: String(row.patient_id ?? fallbackInput?.patient_id ?? ""),
    patient_name: (row.patient_name as string | undefined) ?? fallbackInput?.patient_name,
    checklist_type: toChecklistType(row.checklist_type, fallbackInput?.checklist_type ?? "MDRO"),
    infection_type: toChecklistType(
      row.infection_type ?? row.checklist_type,
      fallbackInput?.infection_type ?? fallbackInput?.checklist_type ?? "MDRO",
    ),
    mode: toChecklistMode(row.mode, fallbackInput?.mode ?? "suspected"),
    subtype: (row.subtype as string | undefined) ?? fallbackInput?.subtype,
    changed_item_id:
      (row.changed_item_id as string | undefined) ?? fallbackInput?.changed_item_id,
    changed_item_label:
      (row.changed_item_label as string | undefined) ?? fallbackInput?.changed_item_label,
    action: toChecklistLogAction(row.action, fallbackInput?.action ?? "snapshot_save"),
    actor_role: (row.actor_role as string | undefined) ?? fallbackInput?.actor_role ?? "간호사",
    actor_name: (row.actor_name as string | undefined) ?? fallbackInput?.actor_name,
    reason: (row.reason as string | undefined) ?? fallbackInput?.reason,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : (fallbackInput?.tags ?? []),
    details: (row.details as Record<string, unknown> | undefined) ?? fallbackInput?.details,
    created_at: String(row.created_at ?? fallbackInput?.timestamp ?? new Date().toISOString()),
    timestamp: (row.timestamp as string | undefined) ?? fallbackInput?.timestamp,
    demo_step:
      row.demo_step == null ? null : Number.isFinite(Number(row.demo_step)) ? Number(row.demo_step) : null,
    demo_shift: (row.demo_shift as string | undefined) ?? null,
  }
}

function makeLocalLog(input: ChecklistLogEventInput): ChecklistLogSummary {
  const createdAt = new Date().toISOString()
  const timestamp = parseIso(input.timestamp, createdAt)
  return {
    id: `local-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`,
    patient_id: input.patient_id,
    patient_name: input.patient_name,
    checklist_type: input.checklist_type,
    infection_type: input.infection_type ?? input.checklist_type,
    mode: input.mode,
    subtype: input.subtype,
    changed_item_id: input.changed_item_id,
    changed_item_label: input.changed_item_label,
    action: input.action,
    actor_role: input.actor_role,
    actor_name: input.actor_name,
    reason: input.reason,
    tags: Array.isArray(input.tags) ? input.tags : [],
    details: input.details,
    created_at: createdAt,
    timestamp,
    demo_step: input.demoStep ?? null,
    demo_shift: input.demoShift ?? null,
  }
}

function filterLocalLogs(
  logs: ChecklistLogSummary[],
  params: ListChecklistLogsParams,
): ChecklistLogSummary[] {
  return logs
    .filter((log) => {
      if (params.patientId && log.patient_id !== params.patientId) return false
      if (params.checklistType && log.checklist_type !== params.checklistType) return false
      if (params.infectionType && log.infection_type !== params.infectionType) return false
      if (params.category && params.category !== "all" && !log.tags.includes(params.category)) return false

      if (params.demoStep != null && log.demo_step != null && log.demo_step !== params.demoStep) {
        return false
      }
      if (params.demoShift && log.demo_shift && log.demo_shift.toLowerCase() !== params.demoShift.toLowerCase()) {
        return false
      }

      return true
    })
    .sort((a, b) => toMs(b.timestamp ?? b.created_at) - toMs(a.timestamp ?? a.created_at))
}

export async function createChecklistLogEvent(
  input: ChecklistLogEventInput,
): Promise<{ log: ChecklistLogSummary; source: Source }> {
  const base = getApiBase()
  const params = new URLSearchParams()
  appendDemoParams(params, { demoStep: input.demoStep, demoShift: input.demoShift })
  const url = buildPathWithQuery(`${base}/api/nlp/mdro/checklists/logs`, params)

  const { demoStep, demoShift, ...payload } = input
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new Error(`log create failed: ${res.status}`)
    }

    const raw = (await res.json()) as Record<string, unknown>
    return { log: toChecklistLogSummary(raw, input), source: "backend" }
  } catch (error) {
    console.warn("createChecklistLogEvent backend unavailable, falling back to local storage", error)
    const localLog = makeLocalLog(input)
    const logs = loadLocalLogs()
    logs.unshift(localLog)
    if (logs.length > MAX_LOCAL_LOG_COUNT) logs.length = MAX_LOCAL_LOG_COUNT
    saveLocalLogs(logs)
    return { log: localLog, source: "local" }
  }
}

export async function listChecklistLogs(
  params: ListChecklistLogsParams,
): Promise<{ data: ChecklistLogsResponse; source: Source }> {
  const query = new URLSearchParams()
  if (params.patientId) query.set("patient_id", params.patientId)
  if (params.checklistType) query.set("checklist_type", params.checklistType)
  if (params.infectionType) query.set("infection_type", params.infectionType)
  if (params.category && params.category !== "all") query.set("category", params.category)
  if (params.limit) query.set("limit", String(params.limit))
  appendDemoParams(query, params)

  const base = getApiBase()
  const url = buildPathWithQuery(`${base}/api/nlp/mdro/checklists/logs`, query)
  try {
    const res = await fetch(url, { method: "GET" })
    if (!res.ok) {
      throw new Error(`logs fetch failed: ${res.status}`)
    }

    const raw = (await res.json()) as { total?: number; logs?: Record<string, unknown>[] }
    const logs = Array.isArray(raw.logs) ? raw.logs.map((row) => toChecklistLogSummary(row)) : []

    return {
      data: {
        total: Number.isFinite(Number(raw.total)) ? Number(raw.total) : logs.length,
        logs,
      },
      source: "backend",
    }
  } catch (error) {
    console.warn("listChecklistLogs backend unavailable, falling back to local storage", error)
    const limit = parseLimit(params.limit)
    const localLogs = filterLocalLogs(loadLocalLogs(), params)
    return {
      data: {
        total: localLogs.length,
        logs: localLogs.slice(0, limit),
      },
      source: "local",
    }
  }
}

export async function listGapMetrics(params: ListGapMetricsParams = {}): Promise<GapMetricsResponse> {
  const query = new URLSearchParams()
  if (params.thresholdHours != null) query.set("threshold_hours", String(params.thresholdHours))
  if (params.includeCases != null) query.set("include_cases", params.includeCases ? "true" : "false")
  if (params.days != null) query.set("days", String(params.days))
  if (params.patientId) query.set("patient_id", params.patientId)
  if (params.checklistType) query.set("checklist_type", params.checklistType)
  if (params.infectionType) query.set("infection_type", params.infectionType)
  if (params.category && params.category !== "all") query.set("category", params.category)
  if (params.dateFrom) query.set("date_from", params.dateFrom)
  if (params.dateTo) query.set("date_to", params.dateTo)
  appendDemoParams(query, params)

  const base = getApiBase()
  const url = buildPathWithQuery(`${base}/api/nlp/mdro/checklists/gap-metrics`, query)
  const res = await fetch(url, { method: "GET" })
  if (!res.ok) {
    throw new Error(`gap metrics fetch failed: ${res.status}`)
  }

  const raw = (await res.json()) as Record<string, unknown>
  const rawCases = Array.isArray(raw.cases) ? (raw.cases as Record<string, unknown>[]) : undefined
  const cases = rawCases?.map((row) => {
    const status: GapCaseSummary["status"] = row.status === "open" ? "open" : "closed"
    return {
      patient_id: String(row.patient_id ?? ""),
      patient_name: row.patient_name as string | undefined,
      checklist_type: toChecklistType(row.checklist_type),
      infection_type: toChecklistType(row.infection_type ?? row.checklist_type),
      started_at: String(row.started_at ?? ""),
      ended_at: row.ended_at == null ? null : String(row.ended_at),
      start_log_id: String(row.start_log_id ?? ""),
      end_log_id: row.end_log_id == null ? null : String(row.end_log_id),
      status,
      duration_hours: Number(row.duration_hours ?? 0),
    }
  })

  return {
    generated_at: String(raw.generated_at ?? new Date().toISOString()),
    threshold_hours: Number(raw.threshold_hours ?? 0),
    total_logs: Number(raw.total_logs ?? 0),
    total_cases: Number(raw.total_cases ?? 0),
    open_cases: Number(raw.open_cases ?? 0),
    closed_cases: Number(raw.closed_cases ?? 0),
    avg_gap_hours: Number(raw.avg_gap_hours ?? 0),
    median_gap_hours: Number(raw.median_gap_hours ?? 0),
    max_gap_hours: Number(raw.max_gap_hours ?? 0),
    threshold_exceeded_count: Number(raw.threshold_exceeded_count ?? 0),
    threshold_exceeded_ratio: Number(raw.threshold_exceeded_ratio ?? 0),
    cases,
  }
}
