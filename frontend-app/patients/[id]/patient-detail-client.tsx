"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ExplainProvider, useExplainStore } from "@/lib/explain-store"
import { PatientHeader, type PatientHeaderAlert } from "@/components/patient/now-snapshot-header"
import {
  AxisNavTabs,
  type PatientAxisKey,
  type TrajectoryTagSortKey,
} from "@/components/patient/axis-nav-tabs"
import {
  TrajectoryTimeline,
  type Priority,
  type TimelineEvent,
  type TimelineTag,
  type TimelineTransition,
} from "@/components/patient/trajectory-timeline"
import { TrajectoryRightPanel } from "@/components/explain/TrajectoryRightPanel"
import {
  type SeverityStripBin,
  type SeverityStripLevel,
} from "@/components/patient/severity-timeline-strip"
import { AppSidebar, type SidebarPage } from "@/components/dashboard/app-sidebar"
import { BottomNav } from "@/components/dashboard/bottom-nav"
import { V1Header } from "@/components/dashboard/v1-header"
import { HeaderTicker } from "@/components/clinical/notification-overlays"
import { AXIS_META, buildFlagLabels } from "@/lib/explain-types"
import {
  buildLocalizedDiffLine,
  formatExplainValue,
  localizeExplainFieldLabel,
  localizeRawDiffLine,
} from "@/lib/explain-localize"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FileTab, FileTabPanel, FileTabs, FileTabsList } from "@/components/ui/file-tabs"
import { fetchPatient, fetchPatientSepsis, fetchPatientStatusSummary } from "@/lib/api"
import { usePatients } from "@/lib/hooks/use-patients"
import { NotificationProvider } from "@/lib/notification-context"
import { SettingsProvider, useSettings } from "@/lib/settings-context"
import { useDemoClock } from "@/lib/demo-clock-context"
import { AlertCircle, ChevronDown, Loader2, RefreshCw, X } from "lucide-react"
import type { AxisSnapshot, ExplainEvent, RangeType, SeverityLevel } from "@/lib/explain-types"
import type {
  LabResult,
  Patient,
  PatientSepsisResponse,
  PatientStatusSummaryResponse,
  VitalSign,
} from "@/lib/types"

const DOC_TYPE_LABEL: Record<string, string> = {
  nursing_note: "간호 기록",
  physician_note: "의사 기록",
  lab_result: "검사 결과",
  microbiology: "미생물 검사",
  radiology: "영상 판독",
}

const EVENT_LABEL_KO: Record<string, string> = {
  hypoxia_detected: "저산소 악화",
  inflammation_rising: "염증수치 상승",
  symptom_worsening: "증상 악화",
  medication_start: "항생제 시작",
  monitoring_escalation: "모니터링 강화",
  mdro_confirmed: "격리 권고",
  cxr_no_change: "영상 변화 없음",
  routine_vitals: "정기 활력 관찰",
}

const IMPROVING_EVENT_TYPES = new Set([
  "cxr_severity_down",
  "temp_down",
  "wbc_down",
  "crp_down",
  "platelet_recover",
  "pain_relief",
])

const RANGE_OPTIONS: RangeType[] = ["24h", "72h", "7d"]

const RANGE_TOTAL_HOURS: Record<RangeType, number> = {
  "24h": 24,
  "72h": 72,
  "7d": 168,
}

const RANGE_BIN_HOURS: Record<RangeType, number> = {
  "24h": 2,
  "72h": 6,
  "7d": 12,
}

const DEMO_BASE_DATE = new Date(2026, 1, 9) // 2026-02-09 (local)
const DAY_MS = 24 * 60 * 60 * 1000

type PatientDetailTab = "trajectory" | "basic-data" | "sepsis-ml"

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  } catch {
    return iso
  }
}

function formatDateGroup(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}. ${d.getDate()}.`
  } catch {
    return iso
  }
}

function formatBinClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function severityToPriority(severity: SeverityLevel): Priority {
  if (severity === "critical" || severity === "high") return "HIGH"
  if (severity === "medium") return "MED"
  return "LOW"
}

function priorityToLevel(priority: Priority): SeverityStripLevel {
  if (priority === "HIGH") return "HIGH"
  if (priority === "MED") return "MED"
  return "LOW"
}

function levelRank(level: SeverityStripLevel): number {
  if (level === "HIGH") return 3
  if (level === "MED") return 2
  if (level === "LOW") return 1
  return 0
}

function labelizeEventType(value: string): string {
  return value
    .split("_")
    .map((v) => v.slice(0, 1).toUpperCase() + v.slice(1))
    .join(" ")
}

function stripHdDSuffix(text: string): string {
  return text.replace(/\s*\(\s*HD\s*-?\d+\s+D\s*[+-]?\s*\d+\s*\)\s*$/i, "").trim()
}

function hasTemplatePlaceholders(text: string): boolean {
  return /\{[^{}]+\}/.test(text)
}

function buildTimelineDescription(event: ExplainEvent): string {
  const summary = stripHdDSuffix(event.summary_ko || "")
  if (!summary) return buildLocalizedDiffLine(event.now_prev)
  if (hasTemplatePlaceholders(summary)) return buildLocalizedDiffLine(event.now_prev)
  return summary
}

function compactSummaryText(value: string, maxLength = 54): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function pickNowPrevNumber(record: Record<string, unknown>, candidates: string[]): number | null {
  for (const key of candidates) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const matched = value.match(/-?\d+(\.\d+)?/)
      if (matched) {
        const parsed = Number.parseFloat(matched[0])
        if (Number.isFinite(parsed)) return parsed
      }
    }
  }
  return null
}

function pickNowPrevString(record: Record<string, unknown>, candidates: string[]): string {
  for (const key of candidates) {
    const value = record[key]
    if (value == null) continue
    const normalized = String(value).trim()
    if (normalized) return normalized.toLowerCase()
  }
  return ""
}

function isTrivialSpo2Change(event: ExplainEvent): boolean {
  const eventType = String(event.event_type || "").toLowerCase()
  const diffLine = String(event.now_prev?.diff_line || "")
  const summary = String(event.summary_ko || "")
  const hasSpo2Hint =
    eventType.includes("spo2") ||
    /spo2|산소\s*포화도/i.test(diffLine) ||
    /spo2|산소\s*포화도/i.test(summary)
  if (!hasSpo2Hint) return false

  const now = event.now_prev?.now ?? {}
  const prev = event.now_prev?.prev ?? {}

  let to = pickNowPrevNumber(now, ["spo2_value", "spo2", "oxygen_saturation", "oxygenSaturation"])
  let from = pickNowPrevNumber(prev, ["spo2_value", "spo2", "oxygen_saturation", "oxygenSaturation"])

  if (to == null || from == null) {
    const matched = diffLine.match(
      /(\d+(?:\.\d+)?)\s*%?\s*(?:→|->|>|-)\s*(\d+(?:\.\d+)?)\s*%?/,
    )
    if (matched) {
      from = Number.parseFloat(matched[1])
      to = Number.parseFloat(matched[2])
    }
  }
  if (to == null || from == null) return false

  const nowFlow = pickNowPrevNumber(now, ["o2_flow_lpm", "o2_flow", "oxygen_flow", "fio2", "fiO2"])
  const prevFlow = pickNowPrevNumber(prev, ["o2_flow_lpm", "o2_flow", "oxygen_flow", "fio2", "fiO2"])
  const flowChanged =
    nowFlow != null && prevFlow != null && Math.abs(nowFlow - prevFlow) > 0.01

  const nowDevice = pickNowPrevString(now, ["o2_device", "oxygen_device"])
  const prevDevice = pickNowPrevString(prev, ["o2_device", "oxygen_device"])
  const deviceChanged =
    nowDevice.length > 0 && prevDevice.length > 0 && nowDevice !== prevDevice

  const o2Changed = flowChanged || deviceChanged
  const diff = Math.abs(to - from)
  const belowThreshold = to <= 92

  return diff <= 1 && !o2Changed && !belowThreshold
}

function normalizeSummaryToken(value: string): string {
  return value
    .replace(/^.*?:\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/["']/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function isUnknownSummaryToken(value: string): boolean {
  return /^(?:n\/?a|na|none|null|unknown|not available|없음|미상|—|-)$/i.test(value)
}

function isMeaningfulSummaryText(text: string): boolean {
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim()
  if (!normalizedText) return false

  const arrowMatch = normalizedText.match(/([^,;]+?)\s*(?:→|->)\s*([^,;]+)/)
  if (arrowMatch) {
    const left = normalizeSummaryToken(arrowMatch[1])
    const right = normalizeSummaryToken(arrowMatch[2])
    if (!left || !right) return false
    if (left === right) return false
    if (isUnknownSummaryToken(left) && isUnknownSummaryToken(right)) return false
    return true
  }

  const token = normalizeSummaryToken(normalizedText)
  if (!token) return false
  if (isUnknownSummaryToken(token)) return false
  return true
}

function isTrajectorySummaryCandidate(event: ExplainEvent): boolean {
  if (isTrivialSpo2Change(event)) return false
  if (hasMeaningfulNowPrevChange(event)) return true

  const summary = stripHdDSuffix(event.summary_ko || "")
  if (summary && !hasTemplatePlaceholders(summary)) {
    return isMeaningfulSummaryText(summary)
  }

  return isMeaningfulSummaryText(buildLocalizedDiffLine(event.now_prev))
}

function hasMeaningfulNowPrevChange(
  event: ExplainEvent,
  preferredKeys: string[] = [],
): boolean {
  const now = event.now_prev?.now ?? {}
  const prev = event.now_prev?.prev ?? {}
  const ignoredKeys = new Set(["delta", "delta_pct"])

  const keys =
    preferredKeys.length > 0
      ? preferredKeys.filter((key) => !ignoredKeys.has(key))
      : Array.from(new Set([...Object.keys(now), ...Object.keys(prev)])).filter(
        (key) => !ignoredKeys.has(key),
      )

  for (const key of keys) {
    const nowVal = now[key]
    const prevVal = prev[key]
    if (nowVal == null && prevVal == null) continue

    if (typeof nowVal === "number" && typeof prevVal === "number") {
      if (Math.abs(nowVal - prevVal) > 0.0001) return true
      continue
    }

    const nowText = String(nowVal ?? "").trim().toLowerCase()
    const prevText = String(prevVal ?? "").trim().toLowerCase()
    if (nowText !== prevText) return true
  }

  const diffLine = String(event.now_prev?.diff_line || "")
  const arrowMatch = diffLine.match(/([^,;]+?)\s*→\s*([^,;]+)/)
  if (arrowMatch) {
    const left = arrowMatch[1].replace(/.*:\s*/, "").trim().toLowerCase()
    const right = arrowMatch[2].trim().toLowerCase()
    if (left && right && left !== right) return true
  }

  return false
}

function isWorseningIssueEvent(event: ExplainEvent): boolean {
  const eventType = String(event.event_type || "").toLowerCase()
  if (event.evidence_after?.flags?.negated) return false
  if (IMPROVING_EVENT_TYPES.has(eventType)) return false

  if (eventType.includes("spo2")) {
    if (isTrivialSpo2Change(event)) return false

    const now = event.now_prev?.now ?? {}
    const prev = event.now_prev?.prev ?? {}
    const diffLine = String(event.now_prev?.diff_line || "")

    let to = pickNowPrevNumber(now, ["spo2_value", "spo2", "oxygen_saturation", "oxygenSaturation"])
    let from = pickNowPrevNumber(prev, ["spo2_value", "spo2", "oxygen_saturation", "oxygenSaturation"])
    if (to == null || from == null) {
      const matched = diffLine.match(
        /(\d+(?:\.\d+)?)\s*%?\s*(?:→|->|>|-)\s*(\d+(?:\.\d+)?)\s*%?/,
      )
      if (matched) {
        from = Number.parseFloat(matched[1])
        to = Number.parseFloat(matched[2])
      }
    }

    if (to != null && from != null) {
      if (to >= from) return false
      if (to <= 92) return true
      return from - to >= 2
    }

    return hasMeaningfulNowPrevChange(event, ["spo2_value", "spo2", "oxygen_saturation", "oxygenSaturation"])
  }

  if (eventType === "culture_result_arrived") {
    const now = event.now_prev?.now ?? {}
    const summary = String(event.summary_ko || "").toLowerCase()
    const cultureStatus = pickNowPrevString(now, ["culture_status", "culture_result", "culture_result_text"])
    const text = `${cultureStatus} ${summary}`
    if (/(negative|no[_\s-]?growth|음성)/i.test(text)) return false
    if (/(positive|양성)/i.test(text)) return true
    return false
  }

  if (eventType === "hemodynamic_instability") {
    const now = event.now_prev?.now ?? {}
    const prev = event.now_prev?.prev ?? {}

    const nowSbp = pickNowPrevNumber(now, ["sbp_mmhg", "sbp"])
    const prevSbp = pickNowPrevNumber(prev, ["sbp_mmhg", "sbp"])
    const nowMap = pickNowPrevNumber(now, ["map_mmhg", "map"])
    const prevMap = pickNowPrevNumber(prev, ["map_mmhg", "map"])

    const deltas: number[] = []
    if (nowSbp != null && prevSbp != null) deltas.push(nowSbp - prevSbp)
    if (nowMap != null && prevMap != null) deltas.push(nowMap - prevMap)

    if (deltas.length > 0) {
      const hasBetter = deltas.some((delta) => delta > 0)
      const hasWorse = deltas.some((delta) => delta < 0)
      if (hasWorse && !hasBetter) return true
      if (hasBetter && !hasWorse) return false
    }

    const nowBelow = (nowSbp != null && nowSbp < 90) || (nowMap != null && nowMap < 65)
    const prevBelow = (prevSbp != null && prevSbp < 90) || (prevMap != null && prevMap < 65)
    if (nowBelow && !prevBelow) return true
    if (!nowBelow && prevBelow) return false
    return false
  }

  if (eventType === "vitals_frequency_escalated" || eventType === "monitoring_escalated") {
    return hasMeaningfulNowPrevChange(event, ["vitals_frequency", "monitoring_level", "monitoring"])
  }

  return event.issue_only
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getDemoDateByStep(step: number): Date {
  const d = new Date(DEMO_BASE_DATE)
  d.setDate(d.getDate() + Math.max(0, step - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function remapEventTsToDemoClock(eventTsIso: string, anchorTsMs: number | null, demoStep: number): Date {
  const raw = new Date(eventTsIso)
  if (!Number.isFinite(raw.getTime()) || !Number.isFinite(anchorTsMs ?? NaN)) return raw

  const anchor = new Date(anchorTsMs as number)
  const rawDay = startOfLocalDay(raw).getTime()
  const anchorDay = startOfLocalDay(anchor).getTime()
  const dayOffset = Math.max(0, Math.floor((anchorDay - rawDay) / DAY_MS))

  const demoDay = getDemoDateByStep(demoStep)
  demoDay.setDate(demoDay.getDate() - dayOffset)
  demoDay.setHours(raw.getHours(), raw.getMinutes(), raw.getSeconds(), raw.getMilliseconds())
  return demoDay
}

function deriveTransitions(event: ExplainEvent): TimelineTransition[] {
  const now = event.now_prev.now ?? {}
  const prev = event.now_prev.prev ?? {}
  const transitions: TimelineTransition[] = []

  for (const key of Object.keys(now)) {
    const nowVal = now[key]
    const prevVal = prev[key]
    const current = formatExplainValue(nowVal)
    const previous = formatExplainValue(prevVal)

    if (current === previous) continue

    let direction: "up" | "down" | undefined
    if (typeof nowVal === "number" && typeof prevVal === "number") {
      direction = nowVal > prevVal ? "up" : nowVal < prevVal ? "down" : undefined
    }

    transitions.push({
      label: localizeExplainFieldLabel(key),
      previous,
      current,
      direction,
    })
  }

  if (transitions.length === 0) {
    return [{ previous: "-", current: localizeRawDiffLine(event.now_prev.diff_line) }]
  }
  return transitions
}

function deriveTags(event: ExplainEvent): TimelineTag[] {
  const tags: TimelineTag[] = []

  if (IMPROVING_EVENT_TYPES.has(event.event_type)) {
    tags.push({ label: "호전", variant: "success" })
  } else if (event.issue_only && isWorseningIssueEvent(event)) {
    tags.push({ label: "악화", variant: "destructive" })
  } else if (event.issue_only) {
    tags.push({ label: "주의", variant: "warning" })
  }

  const flags = buildFlagLabels(event.evidence_after.flags)
  if (flags.includes("[계획]")) tags.push({ label: "계획", variant: "info" })
  if (flags.includes("[불확실]")) tags.push({ label: "불확실", variant: "warning" })
  if (flags.includes("[부정]")) tags.push({ label: "부정", variant: "default" })
  if (!event.issue_only && !IMPROVING_EVENT_TYPES.has(event.event_type)) {
    tags.push({ label: "참고", variant: "default" })
  }

  return tags.slice(0, 4)
}

function mapEventToTimeline(
  event: ExplainEvent,
  anchorTsMs: number | null,
  demoStep: number,
): TimelineEvent {
  const docType = DOC_TYPE_LABEL[event.evidence_after.doc_type] ?? event.evidence_after.doc_type
  const eventLabel = EVENT_LABEL_KO[event.event_type] ?? labelizeEventType(event.event_type)
  const mappedTs = remapEventTsToDemoClock(event.ts, anchorTsMs, demoStep)
  const mappedIso = mappedTs.toISOString()

  return {
    id: event.event_id,
    tsMs: mappedTs.getTime(),
    time: formatTime(mappedIso),
    dateGroup: formatDateGroup(mappedIso),
    priority: severityToPriority(event.severity),
    eventLabel,
    description: buildTimelineDescription(event),
    transitions: deriveTransitions(event),
    evidence: {
      docTitle: event.evidence_after.doc_id,
      docType,
      sentence: event.evidence_after.span,
    },
    tags: deriveTags(event),
    axis: event.axis,
    docType,
    eventType: event.event_type, // Exposing event_type for CXR filtering
  }
}

function buildAlerts(axisSnapshots: AxisSnapshot[]): PatientHeaderAlert[] {
  const worsening = axisSnapshots.filter((s) => s.state === "worsening")
  if (worsening.length === 0) return []

  const severe = worsening.filter((s) => s.delta_score <= -2)
  if (severe.length > 0) {
    const axes = severe.map((s) => AXIS_META[s.axis].labelKo).join(", ")
    return [{ label: `고위험: ${axes}`, variant: "destructive" }]
  }

  const axes = worsening.map((s) => AXIS_META[s.axis].labelKo).join(", ")
  return [{ label: `주의: ${axes}`, variant: "warning" }]
}



function formatMetricValue(value: number, precision = 0): string {
  if (!Number.isFinite(value)) return "-"
  return precision > 0 ? value.toFixed(precision) : String(Math.round(value))
}

function formatMetricTime(iso: string, demoStep?: number, anchorTsMs?: number | null): string {
  const raw = new Date(iso)
  if (Number.isNaN(raw.getTime())) return "-"
  const date =
    typeof demoStep === "number"
      ? remapEventTsToDemoClock(iso, anchorTsMs ?? null, demoStep)
      : raw
  return date.toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

type RangeStatus = "in-range" | "below" | "above"

interface MetricDefinition {
  id: string
  label: string
  unit: string
  range?: string
  precision?: number
  value: number | null
  timestamp?: string
  history: MetricHistoryPoint[]
}

interface MetricGroupDefinition {
  id: string
  title: string
  metrics: MetricDefinition[]
}

interface MetricHistoryPoint {
  value: number
  timestamp: string
}

type VitalNumericField =
  | "oxygenSaturation"
  | "respiratoryRate"
  | "temperature"
  | "heartRate"
  | "bloodPressureSystolic"
  | "bloodPressureDiastolic"

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const matched = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/)
    if (!matched) return null
    const parsed = Number.parseFloat(matched[0])
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeLabToken(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase()
}

function normalizeHistory(points: Array<MetricHistoryPoint | null>): MetricHistoryPoint[] {
  return points
    .filter((point): point is MetricHistoryPoint => point !== null)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

function pickVitalMetricSeries(
  vitals: VitalSign[] | undefined,
  field: VitalNumericField,
): { value: number | null; timestamp?: string; history: MetricHistoryPoint[] } {
  if (!vitals || vitals.length === 0) return { value: null, history: [] }

  const history = normalizeHistory(
    vitals.map((row) => {
      const value = toFiniteNumber(row[field])
      if (value === null || !row.timestamp) return null
      return { value, timestamp: row.timestamp }
    }),
  )

  if (history.length === 0) return { value: null, history: [] }
  return { value: history[0].value, timestamp: history[0].timestamp, history }
}

function pickLabMetricSeries(
  labs: LabResult[] | undefined,
  tokens: string[],
): { value: number | null; timestamp?: string; history: MetricHistoryPoint[] } {
  if (!labs || labs.length === 0) return { value: null, history: [] }

  const history = normalizeHistory(
    labs.map((row) => {
      const code = normalizeLabToken(row.category)
      const name = normalizeLabToken(row.name)
      const isMatch = tokens.some((token) => code === token || name.includes(token))
      if (!isMatch) return null
      const value = toFiniteNumber(row.value)
      if (value === null || !row.date) return null
      return { value, timestamp: row.date }
    }),
  )

  if (history.length === 0) return { value: null, history: [] }
  return { value: history[0].value, timestamp: history[0].timestamp, history }
}

function parseRangeStatus(value: number, range?: string): RangeStatus {
  if (!range) return "in-range"

  const gtMatch = range.match(/>\s*(\d+\.?\d*)/)
  const ltMatch = range.match(/<\s*(\d+\.?\d*)/)
  const rangeMatch = range.match(/(\d+\.?\d*)\s*-\s*(\d+\.?\d*)/)
  const exactMatch = range.match(/^(\d+\.?\d*)$/)

  if (gtMatch) {
    const threshold = Number.parseFloat(gtMatch[1])
    return value > threshold ? "in-range" : "below"
  }

  if (ltMatch) {
    const threshold = Number.parseFloat(ltMatch[1])
    return value < threshold ? "in-range" : "above"
  }

  if (rangeMatch) {
    const min = Number.parseFloat(rangeMatch[1])
    const max = Number.parseFloat(rangeMatch[2])
    if (value < min) return "below"
    if (value > max) return "above"
    return "in-range"
  }

  if (exactMatch) {
    const target = Number.parseFloat(exactMatch[1])
    if (value < target) return "below"
    if (value > target) return "above"
    return "in-range"
  }

  return "in-range"
}

function getValueColorClass(status: RangeStatus): string {
  if (status === "above") return "text-red-500"
  if (status === "below") return "text-blue-500"
  return "text-foreground"
}

function getRangeStatusLabel(status: RangeStatus): string {
  if (status === "above") return "Above Range"
  if (status === "below") return "Below Range"
  return "In-Range"
}

function RangeStatusInline({ status }: { status: RangeStatus }) {
  const textClass =
    status === "above"
      ? "text-red-500"
      : status === "below"
        ? "text-blue-500"
        : "text-muted-foreground"

  const markerClass =
    status === "above"
      ? "absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-[3px] bg-red-500"
      : status === "below"
        ? "absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-[3px] bg-blue-500"
        : "absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-violet-500"

  return (
    <div className="w-[84px] shrink-0 xl:w-[96px]">
      <p className={`text-right text-[10px] font-medium ${textClass}`}>
        {getRangeStatusLabel(status)}
      </p>
      <div className="relative mt-0.5 h-2 w-full rounded-full bg-muted/70">
        <div className={markerClass} />
      </div>
    </div>
  )
}

function BasicMetricItem({
  metric,
  demoStep,
  anchorTsMs,
}: {
  metric: MetricDefinition
  demoStep: number
  anchorTsMs: number | null
}) {
  const [expanded, setExpanded] = useState(false)

  if (metric.value === null) {
    return (
      <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2.5">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {metric.label}{metric.range ? ` (${metric.range})` : ""}
        </div>
        <div className="text-2xl font-bold text-muted-foreground/50">-</div>
      </div>
    )
  }

  const status = metric.range ? parseRangeStatus(metric.value, metric.range) : "in-range"
  const valueColorClass = getValueColorClass(status)
  const hasHistory = metric.history.length > 1

  return (
    <div className="rounded-md border border-border/70 bg-background/70 px-3 py-2.5">
      <button
        type="button"
        className={
          hasHistory
            ? "w-full cursor-pointer text-left transition-colors hover:bg-muted/40"
            : "w-full cursor-default text-left"
        }
        onClick={() => {
          if (hasHistory) setExpanded((prev) => !prev)
        }}
      >
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {metric.label}{metric.range ? ` (${metric.range})` : ""}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className={`text-2xl font-bold ${valueColorClass}`}>
            {formatMetricValue(metric.value, metric.precision ?? 1)}{" "}
            {metric.unit ? <span className="text-sm font-medium text-muted-foreground">{metric.unit}</span> : null}
          </div>

          <div className="flex items-center gap-1.5">
            {metric.range ? <RangeStatusInline status={status} /> : null}
            {hasHistory ? (
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            ) : null}
          </div>
        </div>

        <p className="mt-1 text-[10px] text-muted-foreground">
          {metric.timestamp ? formatMetricTime(metric.timestamp, demoStep, anchorTsMs) : "-"}
        </p>
      </button>

      {expanded && hasHistory ? (
        <div className="mt-2 border-t border-border/70 pt-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Recent Measurements</p>
          <div className="mt-1.5 space-y-1">
            {metric.history.slice(0, 5).map((point) => (
              <div key={`${metric.id}-${point.timestamp}`} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">
                  {formatMetricTime(point.timestamp, demoStep, anchorTsMs)}
                </span>
                <span className="font-medium text-foreground">
                  {formatMetricValue(point.value, metric.precision ?? 1)} {metric.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function buildMetricGroupsFromOraclePatient(patient: Patient | null): MetricGroupDefinition[] {
  const vitals = patient?.vitals ?? []
  const labs = patient?.labResults ?? []

  const spo2 = pickVitalMetricSeries(vitals, "oxygenSaturation")
  const rr = pickVitalMetricSeries(vitals, "respiratoryRate")
  const temp = pickVitalMetricSeries(vitals, "temperature")

  const hr = pickVitalMetricSeries(vitals, "heartRate")
  const sbp = pickVitalMetricSeries(vitals, "bloodPressureSystolic")
  const dbp = pickVitalMetricSeries(vitals, "bloodPressureDiastolic")

  const wbc = pickLabMetricSeries(labs, ["WBC"])
  const crp = pickLabMetricSeries(labs, ["CRP"])
  const pct = pickLabMetricSeries(labs, ["PROCALCITONIN", "PCT"])

  const creatinine = pickLabMetricSeries(labs, ["CREATININE", "CRE"])
  const bun = pickLabMetricSeries(labs, ["BUN"])
  const lactate = pickLabMetricSeries(labs, ["LACTATE", "LAC"])

  return [
    {
      id: "respiratory",
      title: "Respiratory",
      metrics: [
        { id: "spo2", label: "SpO2", unit: "%", range: "> 95", precision: 0, ...spo2 },
        { id: "rr", label: "RR", unit: "/min", range: "12-20", precision: 0, ...rr },
        { id: "temp", label: "Temperature", unit: "℃", range: "36.5-37.5", precision: 1, ...temp },
      ],
    },
    {
      id: "hemodynamics",
      title: "Hemodynamics",
      metrics: [
        { id: "hr", label: "Heart Rate", unit: "bpm", range: "60-100", precision: 0, ...hr },
        { id: "bp-sys", label: "SBP", unit: "mmHg", range: "90-140", precision: 0, ...sbp },
        { id: "bp-dia", label: "DBP", unit: "mmHg", range: "60-90", precision: 0, ...dbp },
      ],
    },
    {
      id: "infection",
      title: "Infection / Inflammation",
      metrics: [
        { id: "wbc", label: "WBC", unit: "K/uL", range: "4.5-11.0", precision: 1, ...wbc },
        { id: "crp", label: "CRP", unit: "mg/L", range: "< 10", precision: 1, ...crp },
        { id: "pct", label: "Procalcitonin", unit: "ng/mL", range: "< 0.5", precision: 2, ...pct },
      ],
    },
    {
      id: "renal",
      title: "Renal / Perfusion",
      metrics: [
        { id: "creatinine", label: "Creatinine", unit: "mg/dL", range: "0.7-1.3", precision: 2, ...creatinine },
        { id: "bun", label: "BUN", unit: "mg/dL", range: "7-20", precision: 1, ...bun },
        { id: "lactate", label: "Lactate", unit: "mmol/L", range: "< 2.0", precision: 2, ...lactate },
      ],
    },
  ]
}

function VitalDataPanel({
  patient,
  demoStep,
  loading,
  error,
}: {
  patient: Patient | null
  demoStep: number
  loading: boolean
  error: string | null
}) {
  const metricGroups = useMemo(() => buildMetricGroupsFromOraclePatient(patient), [patient])
  const metricAnchorTsMs = useMemo(() => {
    const timestamps = metricGroups
      .flatMap((group) =>
        group.metrics.flatMap((metric) => {
          const points = [
            ...(metric.timestamp ? [metric.timestamp] : []),
            ...metric.history.map((historyPoint) => historyPoint.timestamp),
          ];
          return points;
        }),
      )
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value))

    if (timestamps.length === 0) return null
    return Math.max(...timestamps)
  }, [metricGroups])
  const availableCount = metricGroups
    .flatMap((group) => group.metrics)
    .filter((metric) => metric.value !== null).length

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {metricGroups.map((group) => {
            const latestTs = group.metrics
              .map((metric) => metric.timestamp ?? null)
              .filter((value): value is string => Boolean(value))
              .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]

            return (
              <div key={group.id} className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
                  <span className="text-[10px] text-muted-foreground">
                    {latestTs ? formatMetricTime(latestTs, demoStep, metricAnchorTsMs) : "-"}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {group.metrics.map((metric) => (
                    <BasicMetricItem
                      key={metric.id}
                      metric={metric}
                      demoStep={demoStep}
                      anchorTsMs={metricAnchorTsMs}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}

type SepsisRiskLevel = "HIGH" | "WARNING" | "LOW"

interface SepsisTrendPoint {
  time: string
  risk: number
}

interface SepsisSignalPoint {
  signal: string
  score: number
}

function normalizeSepsisLevel(level: string | null | undefined): SepsisRiskLevel {
  const token = String(level || "").trim().toUpperCase()
  if (token === "HIGH") return "HIGH"
  if (token === "WARNING" || token === "MEDIUM") return "WARNING"
  return "LOW"
}

function SepsisMlPanel({
  sepsis,
  loading,
  error,
  onRetry,
}: {
  sepsis: PatientSepsisResponse | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
        <p className="text-sm text-muted-foreground">Sepsis 모델 결과를 불러오는 중...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-muted/40"
        >
          다시 시도
        </button>
      </div>
    )
  }

  if (!sepsis || sepsis.riskScore == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Sepsis 모델 결과가 없습니다.</p>
      </div>
    )
  }

  const riskScore = Math.max(0, Math.min(1, sepsis.riskScore))
  const riskLevel = normalizeSepsisLevel(sepsis.riskLevelUi || sepsis.riskLevel)
  const trendData: SepsisTrendPoint[] =
    sepsis.trend24h && sepsis.trend24h.length > 0
      ? sepsis.trend24h.map((point) => ({
        time: point.time,
        risk: point.risk,
      }))
      : [{ time: "현재", risk: Math.round(riskScore * 100) }]
  const signals: SepsisSignalPoint[] =
    sepsis.signals && sepsis.signals.length > 0
      ? sepsis.signals.map((signal) => ({
        signal: signal.signal,
        score: signal.score,
      }))
      : [{ signal: "관측 신호 없음", score: 0 }]

  const trendStart = trendData[0]?.risk ?? 0
  const trendEnd = trendData[trendData.length - 1]?.risk ?? 0
  const isRising = trendEnd > trendStart
  const trendColor = isRising ? "#ef4444" : "#22c55e"

  return (
    <ScrollArea className="h-full">
      <div className="px-5 py-4 flex flex-col gap-4">
        {/* ── Sepsis Risk Card ── */}
        <div
          className="rounded-xl border-2 px-4 py-3"
          style={{
            borderColor: riskLevel === "HIGH" ? "#fca5a5" : riskLevel === "WARNING" ? "#fcd34d" : "#86efac",
            background: riskLevel === "HIGH" ? "rgba(254,226,226,0.5)" : riskLevel === "WARNING" ? "rgba(254,249,195,0.5)" : "rgba(220,252,231,0.5)",
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sepsis 조기 예측
          </p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="text-[28px] font-bold leading-none" style={{ color: riskLevel === "HIGH" ? "#dc2626" : riskLevel === "WARNING" ? "#d97706" : "#16a34a" }}>
              {(riskScore * 100).toFixed(1)}%
            </p>
            <span
              className="mb-0.5 inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase text-white"
              style={{
                background: riskLevel === "HIGH" ? "#ef4444" : riskLevel === "WARNING" ? "#f97316" : "#22c55e",
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
              }}
            >
              {riskLevel}
            </span>
          </div>
        </div>

        {/* ── Charts grid: side by side on desktop ── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* ── 24h Risk Trend ── */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <h3 className="text-[13px] font-semibold text-foreground">24h Risk Trend</h3>
            </div>
            <div style={{ width: "100%", height: 200 }}>
              <SepsisLineChart data={trendData} color={trendColor} />
            </div>
            <p className="mt-2 text-[12px] font-medium" style={{ color: trendColor }}>
              {isRising ? "↑ Rising trend over 24h" : "↓ Falling trend over 24h"}
            </p>
          </div>

          {/* ── Top contributing signals ── */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              <h3 className="text-[13px] font-semibold text-foreground">Top contributing signals</h3>
            </div>
            <div style={{ width: "100%", height: 200 }}>
              <SepsisSignalChart data={signals} />
            </div>
            <div className="mt-2 flex items-center justify-center gap-5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-[2px]" style={{ background: "#ef4444" }} />
                <span className="text-muted-foreground">Higher score = stronger contribution</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollArea>
  )
}

/* ── Lightweight Recharts wrappers ── */
function SepsisLineChart({ data, color }: { data: { time: string; risk: number }[]; color: string }) {
  /* Lazy import: recharts components are tree-shaken so we use them inline */
  const {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  } = require("recharts")

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, 100]}
        />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--card))",
            color: "hsl(var(--foreground))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
          formatter={(value: number) => [`${value}%`, "Risk"]}
        />
        <Line
          type="monotone"
          dataKey="risk"
          name="Sepsis Risk"
          stroke={color}
          strokeWidth={3}
          dot={{ fill: color, r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function SepsisSignalChart({ data }: { data: SepsisSignalPoint[] }) {
  const {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  } = require("recharts")

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
      >
        <XAxis type="number" domain={[0, "auto"]} hide />
        <YAxis type="category" dataKey="signal" tick={{ fontSize: 11 }} width={120} />
        <Tooltip
          cursor={{ fill: "transparent" }}
          content={({ active, payload }: { active: boolean; payload: Array<{ payload: SepsisSignalPoint }> }) => {
            if (active && payload && payload.length) {
              const d = payload[0].payload
              return (
                <div
                  style={{
                    background: "hsl(var(--card))",
                    color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--border))",
                    padding: "8px",
                    borderRadius: "8px",
                    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  }}
                >
                  <p style={{ fontWeight: 600, fontSize: "12px", marginBottom: "4px" }}>{d.signal}</p>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }}>
                    Score:{" "}
                    <span style={{ fontWeight: 600, color: "#ef4444" }}>
                      {d.score.toFixed(2)}
                    </span>
                  </p>
                </div>
              )
            }
            return null
          }}
        />
        <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" />
        <Bar dataKey="score" radius={[2, 2, 2, 2]}>
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill="#ef4444" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function ErrorView({ error, onRetry }: { error: string; onRetry: () => void }) {
  const isNotFound = error.includes("PATIENT_NOT_FOUND") || error.includes("찾을 수 없")
  const isNoData = error.includes("NO_NLP_DATA") || error.includes("분석 데이터")

  return (
    <div className="flex flex-col items-center justify-center gap-4 flex-1">
      <AlertCircle className="h-10 w-10 text-muted-foreground opacity-50" />
      <div className="text-center space-y-1">
        {isNotFound && (
          <p className="text-sm font-medium text-foreground">환자를 찾을 수 없습니다.</p>
        )}
        {isNoData && (
          <>
            <p className="text-sm font-medium text-foreground">아직 분석 데이터가 없습니다.</p>
            <p className="text-xs text-muted-foreground">잠시 후 다시 확인해 주십시오.</p>
          </>
        )}
        {!isNotFound && !isNoData && (
          <p className="text-sm text-muted-foreground">{error}</p>
        )}
      </div>
      {!isNotFound && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-muted/40 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          다시 시도
        </button>
      )}
    </div>
  )
}

function StatusSummaryPanel({
  summary,
  loading,
  error,
  onRetry,
}: {
  summary: PatientStatusSummaryResponse | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <section className="border-b border-border bg-card px-4 py-3 md:px-5 xl:px-6" aria-label="AI 상태 요약">
      <div className="rounded-xl border border-border bg-background/80 px-4 py-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">AI Clinical Summary</p>
            <h3 className="text-sm font-semibold text-foreground">현재 환자 상태 요약</h3>
          </div>
          <div className="flex items-center gap-2">
            {summary?.source ? (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                {summary.source === "openai" ? "OpenAI" : "Fallback"}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              새로고침
            </button>
          </div>
        </div>

        {error ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        ) : loading && !summary ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="h-4 w-4 animate-spin text-primary/70" />
            <p className="text-xs text-muted-foreground">요약을 생성하는 중입니다...</p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-foreground/90">
            {summary?.summary || "아직 생성된 요약이 없습니다."}
          </p>
        )}

        {summary?.generatedAt ? (
          <p className="mt-2 text-[10px] text-muted-foreground">
            {new Date(summary.generatedAt).toLocaleString("ko-KR", { hour12: false })}
            {summary.cached ? " · cache" : ""}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function TrajectorySummaryPanel({ summary }: { summary: string }) {
  return (
    <section className="border-b border-border bg-card px-4 py-2.5 md:px-5 xl:px-6" aria-label="Trajectory 요약">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Trajectory Summary</p>
      <p className="mt-1 truncate text-sm text-foreground/90" title={summary}>
        {summary}
      </p>
    </section>
  )
}

function PatientDetailContent({ patientId }: { patientId: string }) {
  const { state, loadPayload } = useExplainStore()
  const { payload, loading, error, range } = state
  const { demoStep, demoShift } = useDemoClock()

  const [activeAxis, setActiveAxis] = useState<PatientAxisKey>("all")
  const [activeTagFilters, setActiveTagFilters] = useState<TrajectoryTagSortKey[]>([])
  const [activeDocFilters, setActiveDocFilters] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<PatientDetailTab>("trajectory")
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [activeBinKey, setActiveBinKey] = useState<string | null>(null)
  const [oraclePatient, setOraclePatient] = useState<Patient | null>(null)
  const [oraclePatientLoading, setOraclePatientLoading] = useState(false)
  const [oraclePatientError, setOraclePatientError] = useState<string | null>(null)
  const [statusSummary, setStatusSummary] = useState<PatientStatusSummaryResponse | null>(null)
  const [statusSummaryLoading, setStatusSummaryLoading] = useState(false)
  const [statusSummaryError, setStatusSummaryError] = useState<string | null>(null)
  const [sepsisModel, setSepsisModel] = useState<PatientSepsisResponse | null>(null)
  const [sepsisModelLoading, setSepsisModelLoading] = useState(false)
  const [sepsisModelError, setSepsisModelError] = useState<string | null>(null)
  const demoInitializedRef = useRef(false)
  const previousDemoRef = useRef<{ step: number; shift: string | null } | null>(null)
  const statusSummaryRequestRef = useRef(0)

  useEffect(() => {
    loadPayload(patientId, "72h", { demoStep, demoShift })
    setActiveAxis("all")
    setActiveTagFilters([])
    setActiveTab("trajectory")
    setSelectedEventId(null)
    setActiveBinKey(null)
  }, [patientId, loadPayload])

  useEffect(() => {
    const previous = previousDemoRef.current
    const hasDemoChanged =
      !previous ||
      previous.step !== demoStep ||
      previous.shift !== demoShift
    previousDemoRef.current = { step: demoStep, shift: demoShift }

    if (!demoInitializedRef.current) {
      demoInitializedRef.current = true
      return
    }
    if (!hasDemoChanged) return
    loadPayload(patientId, range, { demoStep, demoShift })
  }, [demoShift, demoStep, patientId, loadPayload, range])

  useEffect(() => {
    let cancelled = false

    setOraclePatientLoading(true)
    setOraclePatientError(null)

    fetchPatient(patientId, { demoStep, demoShift })
      .then((patient) => {
        if (!cancelled) setOraclePatient(patient)
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : "기본 데이터 조회 실패"
        setOraclePatient(null)
        setOraclePatientError(msg)
      })
      .finally(() => {
        if (!cancelled) setOraclePatientLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [demoShift, demoStep, patientId])

  const loadStatusSummary = useCallback((force = false) => {
    const requestId = statusSummaryRequestRef.current + 1
    statusSummaryRequestRef.current = requestId

    setStatusSummaryLoading(true)
    setStatusSummaryError(null)

    fetchPatientStatusSummary(patientId, { demoStep, demoShift }, { force })
      .then((payload) => {
        if (requestId !== statusSummaryRequestRef.current) return
        setStatusSummary(payload)
      })
      .catch((err) => {
        if (requestId !== statusSummaryRequestRef.current) return
        const msg = err instanceof Error ? err.message : "상태 요약 조회 실패"
        setStatusSummary(null)
        setStatusSummaryError(msg)
      })
      .finally(() => {
        if (requestId !== statusSummaryRequestRef.current) return
        setStatusSummaryLoading(false)
      })
  }, [demoShift, demoStep, patientId])

  useEffect(() => {
    loadStatusSummary(false)
    return () => {
      statusSummaryRequestRef.current += 1
    }
  }, [loadStatusSummary])

  useEffect(() => {
    let cancelled = false

    setSepsisModelLoading(true)
    setSepsisModelError(null)

    fetchPatientSepsis(patientId, { demoStep, demoShift })
      .then((payload) => {
        if (!cancelled) setSepsisModel(payload)
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : "Sepsis 모델 조회 실패"
        setSepsisModel(null)
        setSepsisModelError(msg)
      })
      .finally(() => {
        if (!cancelled) setSepsisModelLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [demoShift, demoStep, patientId])

  const handleRetry = () => {
    loadPayload(patientId, range, { demoStep, demoShift })
  }

  const handleSepsisRetry = useCallback(() => {
    setSepsisModelLoading(true)
    setSepsisModelError(null)
    fetchPatientSepsis(patientId, { demoStep, demoShift })
      .then((payload) => setSepsisModel(payload))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Sepsis 모델 조회 실패"
        setSepsisModel(null)
        setSepsisModelError(msg)
      })
      .finally(() => setSepsisModelLoading(false))
  }, [demoShift, demoStep, patientId])

  const handleStatusSummaryRetry = useCallback(() => {
    loadStatusSummary(true)
  }, [loadStatusSummary])

  const handleRangeChange = (nextRange: RangeType) => {
    if (nextRange === range) return
    setSelectedEventId(null)
    setActiveBinKey(null)
    loadPayload(patientId, nextRange, { demoStep, demoShift })
  }

  const allEvents = useMemo(() => {
    if (!payload) return []
    return [...payload.events, ...payload.context_events]
  }, [payload])

  const timelineEvents = useMemo(() => {
    const anchorTsMs =
      allEvents.length > 0
        ? Math.max(
          ...allEvents.map((event) => {
            const ts = new Date(event.ts).getTime()
            return Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY
          }),
        )
        : null

    return allEvents.map((event) => mapEventToTimeline(event, anchorTsMs, demoStep))
  }, [allEvents, demoStep])
  const activeBin = useMemo(() => {
    if (!activeBinKey) return null
    const [startMs, endMs] = activeBinKey.split('-').map(Number)
    return { startMs, endMs }
  }, [activeBinKey])

  const filteredEvents = useMemo(() => {
    let events = timelineEvents

    if (activeAxis !== "all") {
      events = events.filter((e) => e.axis === activeAxis)
    }

    if (activeTagFilters.length > 0) {
      const selectedLabels = new Set<string>(
        activeTagFilters.map((key) =>
          key === "worsening" ? "악화" : key === "improving" ? "호전" : "주의",
        ),
      )
      events = events.filter((event) =>
        event.tags?.some((tag) => selectedLabels.has(tag.label)),
      )
    }

    if (activeDocFilters.length > 0) {
      events = events.filter((event) => {
        // If the event's document type was not selected, drop it
        if (!activeDocFilters.includes(event.docType)) return false

        // If it's an imaging document, only include it if it's genuinely a CXR event
        // This prevents O2-related events (which might errantly carry an 'R_' doc_id) from showing up
        if (event.docType === "영상 판독") {
          return event.eventType ? event.eventType.toLowerCase().includes("cxr") : false
        }

        return true
      })
    }

    return [...events].sort((a, b) => b.tsMs - a.tsMs)
  }, [timelineEvents, activeAxis, activeTagFilters, activeDocFilters])



  useEffect(() => {
    if (filteredEvents.length === 0) {
      if (selectedEventId !== null) setSelectedEventId(null)
      return
    }
    if (!selectedEventId || !filteredEvents.some((e) => e.id === selectedEventId)) {
      setSelectedEventId(filteredEvents[0].id)
    }
  }, [filteredEvents, selectedEventId])

  const alerts = useMemo(
    () => (payload ? buildAlerts(payload.axis_snapshot) : []),
    [payload],
  )
  const trajectorySummaryLine = useMemo(() => {
    const snapshots = payload?.axis_snapshot ?? []
    if (snapshots.length === 0) {
      return "최근 72시간 변화 요약 데이터가 없습니다."
    }

    const worsening = snapshots
      .filter((snapshot) => snapshot.state === "worsening")
      .sort((a, b) => a.delta_score - b.delta_score)
    const improving = snapshots
      .filter((snapshot) => snapshot.state === "improving")
      .sort((a, b) => b.delta_score - a.delta_score)

    const topWorsen = worsening.slice(0, 2)
    const topImprove = improving.slice(0, 1)
    const axisLabel = (axis: string) => AXIS_META[axis as keyof typeof AXIS_META]?.labelKo || axis

    const candidateEvents = allEvents.filter((event) => isTrajectorySummaryCandidate(event))
    const latestEvent = [...candidateEvents].sort(
      (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
    )[0]
    const latestEventLabel = latestEvent
      ? (EVENT_LABEL_KO[latestEvent.event_type] ?? labelizeEventType(latestEvent.event_type))
      : null
    const latestEventTime = latestEvent
      ? new Date(latestEvent.ts).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
      : null

    const trendSentence = (() => {
      if (topWorsen.length > 0 && topImprove.length > 0) {
        return `최근 72시간은 ${topWorsen.map((snapshot) => axisLabel(snapshot.axis)).join(", ")} 축 악화와 ${topImprove
          .map((snapshot) => axisLabel(snapshot.axis))
          .join(", ")} 축 호전이 혼재합니다`
      }
      if (topWorsen.length > 0) {
        return `최근 72시간은 ${topWorsen.map((snapshot) => axisLabel(snapshot.axis)).join(", ")} 축 중심으로 악화 신호가 이어집니다`
      }
      if (topImprove.length > 0) {
        return `최근 72시간은 ${topImprove.map((snapshot) => axisLabel(snapshot.axis)).join(", ")} 축 중심으로 호전 추세입니다`
      }
      return "최근 72시간은 뚜렷한 악화 없이 비교적 안정적입니다"
    })()

    const latestEventDescription = latestEvent
      ? compactSummaryText(buildTimelineDescription(latestEvent), 52)
      : ""
    const eventCore = compactSummaryText(
      latestEventDescription || latestEventLabel || "요약 가능한 최근 이벤트가 없습니다",
      52,
    )
    const latestSentence = latestEvent
      ? `${latestEventTime ? `${latestEventTime} 기준` : "최근"} 핵심 변화는 ${eventCore}입니다`
      : "최근 핵심 변화는 확인되지 않습니다"

    return `${trendSentence}. ${latestSentence}.`
  }, [allEvents, payload])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 flex-1">
        <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
        <p className="text-sm text-muted-foreground">분석 데이터를 불러오는 중...</p>
      </div>
    )
  }

  if (error) {
    return <ErrorView error={error} onRetry={handleRetry} />
  }

  if (!payload) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 flex-1">
        <p className="text-sm text-muted-foreground">설명(Explain) 데이터가 없습니다.</p>
        <button
          type="button"
          onClick={handleRetry}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-muted/40 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          다시 시도
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <PatientHeader
        patient={payload.patient}
        alerts={alerts}
        axisSnapshots={payload.axis_snapshot}
      />

      <FileTabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as PatientDetailTab)}
        className="flex-1 min-h-0 overflow-hidden"
      >
        <div className="overflow-x-auto border-b border-border bg-card px-4 pt-2 md:px-5 xl:px-6">
          <FileTabsList aria-label="환자 상세 탭" className="min-w-max">
            <FileTab value="trajectory">Trajectory</FileTab>
            <FileTab value="basic-data">Basic Data</FileTab>
            <FileTab value="sepsis-ml">Sepsis ML</FileTab>
          </FileTabsList>
        </div>

        <FileTabPanel
          value="trajectory"
          className="flex-1 min-h-0 rounded-none border-0 bg-background p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <div className="flex h-full min-h-0 flex-col">
            <TrajectorySummaryPanel summary={trajectorySummaryLine} />
            <AxisNavTabs
              activeAxis={activeAxis}
              onChangeAxis={setActiveAxis}
              activeTagFilters={activeTagFilters}
              onChangeTagFilters={setActiveTagFilters}
              activeDocFilters={activeDocFilters}
              onChangeDocFilters={setActiveDocFilters}
            />

            <section className="border-b border-border bg-card px-4 py-2 md:px-5 xl:px-6">
              <div className="flex items-center gap-1.5 mb-1.5">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleRangeChange(option)}
                    className={
                      option === range
                        ? "rounded-md px-2.5 py-1 text-[11px] font-semibold bg-primary text-primary-foreground"
                        : "rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    }
                  >
                    {option}
                  </button>
                ))}
                {activeBin && (
                  <button
                    type="button"
                    onClick={() => setActiveBinKey(null)}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                    시간 필터 해제
                  </button>
                )}
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {filteredEvents.length}건
                </span>
              </div>

            </section>

            <main className="flex flex-1 min-h-0">
              <section
                className="w-full xl:w-[70%] min-w-0 bg-background"
                aria-label="이벤트 타임라인"
              >
                <TrajectoryTimeline
                  events={filteredEvents}
                  selectedEventId={selectedEventId}
                  onSelectEvent={(event) => {
                    setSelectedEventId(event.id)
                  }}
                />
              </section>

              <aside className="hidden xl:flex w-[30%] min-h-0 border-l border-border bg-card p-0" aria-label="시간대별 변화 요약">
                <TrajectoryRightPanel
                  events={timelineEvents}
                  range={range}
                  activeBinKey={activeBinKey}
                  onBinClick={(binKey) => setActiveBinKey((prev) => (prev === binKey ? null : binKey))}
                  selectedEventId={selectedEventId}
                  onSelectEvent={(event) => setSelectedEventId(event.id)}
                />
              </aside>
            </main>

            <section className="min-h-[300px] max-h-[50vh] flex flex-col border-t border-border bg-card xl:hidden" aria-label="시간대별 변화 요약">
              <TrajectoryRightPanel
                events={timelineEvents}
                range={range}
                activeBinKey={activeBinKey}
                onBinClick={(binKey) => setActiveBinKey((prev) => (prev === binKey ? null : binKey))}
                selectedEventId={selectedEventId}
                onSelectEvent={(event) => setSelectedEventId(event.id)}
              />
            </section>
          </div>
        </FileTabPanel>

        <FileTabPanel
          value="basic-data"
          className="flex-1 min-h-0 rounded-none border-0 bg-background p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <div className="flex h-full min-h-0 flex-col">
            <StatusSummaryPanel
              summary={statusSummary}
              loading={statusSummaryLoading}
              error={statusSummaryError}
              onRetry={handleStatusSummaryRetry}
            />
            <main className="flex flex-1 min-h-0">
              <section className="w-full min-w-0 bg-background" aria-label="기본 데이터">
                <VitalDataPanel
                  patient={oraclePatient}
                  demoStep={demoStep}
                  loading={oraclePatientLoading}
                  error={oraclePatientError}
                />
              </section>
            </main>
          </div>
        </FileTabPanel>

        <FileTabPanel
          value="sepsis-ml"
          className="flex-1 min-h-0 rounded-none border-0 bg-background p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          <main className="flex h-full min-h-0">
            <section className="w-full min-w-0 bg-background" aria-label="Sepsis ML 요약">
              <SepsisMlPanel
                sepsis={sepsisModel}
                loading={sepsisModelLoading}
                error={sepsisModelError}
                onRetry={handleSepsisRetry}
              />
            </section>
          </main>
        </FileTabPanel>
      </FileTabs>
    </div>
  )
}

interface PatientDetailClientProps {
  patientId: string
}

function PatientDetailShell({ patientId }: PatientDetailClientProps) {
  const router = useRouter()
  const { patients } = usePatients()
  const { showTicker } = useSettings()

  const handleNavigate = useCallback(
    (page: SidebarPage) => {
      if (page === "pc") {
        router.push("/")
      } else if (page === "infection") {
        router.push("/?view=infection")
      } else if (page === "transfer") {
        router.push("/patients")
      } else if (page === "report") {
        router.push("/bed-allocation")
      } else if (page === "isolation") {
        router.push(`/isolation-checklist?patientId=${patientId}`)
      } else if (page === "transferChecklist") {
        router.push(`/transfer-checklist?patientId=${patientId}`)
      }
    },
    [router, patientId],
  )

  return (
    <NotificationProvider
      patients={patients}
      onNavigateToPatient={(targetPatientId) => router.push(`/patients/${targetPatientId}`)}
    >
      <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
        <div className="hidden h-full xl:flex">
          <AppSidebar currentPage="transfer" onNavigate={handleNavigate} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pb-16 xl:pb-0">
          <V1Header
            title="환자 상세"
            subtitle={`${patientId} · 설명 타임라인`}
            subtitlePlacement="right"
          />
          {showTicker && <HeaderTicker />}
          <div className="min-h-0 flex-1">
            <ExplainProvider>
              <PatientDetailContent patientId={patientId} />
            </ExplainProvider>
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 z-50 xl:hidden">
          <BottomNav currentPage="transfer" onNavigate={handleNavigate} />
        </div>
      </div>
    </NotificationProvider>
  )
}

export function PatientDetailClient({ patientId }: PatientDetailClientProps) {
  return (
    <SettingsProvider>
      <PatientDetailShell patientId={patientId} />
    </SettingsProvider>
  )
}
