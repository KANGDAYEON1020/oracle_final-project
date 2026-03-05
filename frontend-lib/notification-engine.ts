"use client"

import type { Patient } from "@/lib/types"

// ─── Severity Levels (X-2) ───
export type AlarmSeverity = "S3" | "S2" | "S1"

export type AlertStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED"

export interface AlertApiItem {
  alertId: number
  legacyId?: string
  patientId?: string | null
  admissionId?: number | null
  alertType?: string | null
  type?: string | null
  severity?: string | null
  severityNormalized?: string | null
  isCritical?: boolean
  message?: string | null
  status?: AlertStatus | string | null
  createdAt?: string | null
  displayCreatedAt?: string | null
  snoozedUntil?: string | null
  snoozedAt?: string | null
  snoozedBy?: string | null
  isSnoozed?: boolean
  evidenceSnippet?: string | null
}

// ─── Notification Item ───
export interface Notification {
  id: string
  alertId?: number | null
  severity: AlarmSeverity
  patientId: string
  patientName: string
  roomNumber: string
  ward: string
  type: NotificationType
  title: string
  evidence: string // 근거 1줄
  createdAt: string // ISO timestamp
  acknowledged: boolean
  snoozedUntil?: string // ISO timestamp
  isSnoozed?: boolean
  dedupCount: number // 동일 타입 묶음 횟수
}

export type NotificationType =
  | "isolation"
  | "deterioration"
  | "pending_result"
  | "care_gap"
  | "cluster"
  | "plan_created"
  | "confirmation_needed"
  | "exception_needed"
  | "committed"
  | "isolation_required" // legacy
  | "icu_escalation" // legacy
  | "sepsis_critical" // legacy
  | "mdro_suspected" // legacy
  | "infection_change" // legacy
  | "sepsis_rising" // legacy
  | "action_needed" // legacy
  | "document_log" // legacy
  | "system_notice" // legacy
  | "unknown"

import { cn, cleanAlertString } from "@/lib/utils"

function normalizeLocationValue(value: unknown): string | null {
  if (value == null) return null
  const normalized = String(value).trim()
  if (!normalized || normalized === "-") return null
  return normalized
}

function parseWardBed(value: unknown): { ward?: string; roomNumber?: string } {
  const wardBed = normalizeLocationValue(value)
  if (!wardBed) return {}

  const parts = wardBed
    .replace(/\s+/g, "")
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length < 2) return {}

  return {
    ward: parts[0],
    roomNumber: parts.slice(1).join("-"),
  }
}

function getPatientLocationMeta(patient: Patient): { patientName: string; roomNumber: string; ward: string } {
  const patientWithOptionalWardBed = patient as Patient & { ward_bed?: unknown }
  const parsed = parseWardBed(patientWithOptionalWardBed.ward_bed)

  const roomNumber = normalizeLocationValue(patient.roomNumber) ?? parsed.roomNumber ?? "-"
  const ward =
    normalizeLocationValue(patient.ward) ??
    normalizeLocationValue(patient.floor) ??
    parsed.ward ??
    "-"

  return {
    patientName: patient.name ?? String(patient.id),
    roomNumber,
    ward,
  }
}

function normalizeAlarmSeverity(alert: AlertApiItem): AlarmSeverity {
  const normalized = String(alert.severityNormalized ?? alert.severity ?? "")
    .trim()
    .toUpperCase()
  if (alert.isCritical || normalized === "CRITICAL" || normalized === "S3") return "S3"
  if (normalized === "INFO" || normalized === "S1") return "S1"
  return "S2"
}

function normalizeNotificationType(rawType: string | null | undefined): NotificationType {
  const type = String(rawType ?? "")
    .trim()
    .toLowerCase()

  switch (type) {
    case "isolation":
    case "deterioration":
    case "pending_result":
    case "care_gap":
    case "cluster":
    case "plan_created":
    case "confirmation_needed":
    case "exception_needed":
    case "committed":
    case "isolation_required":
    case "icu_escalation":
    case "sepsis_critical":
    case "mdro_suspected":
    case "infection_change":
    case "sepsis_rising":
    case "action_needed":
    case "document_log":
    case "system_notice":
      return type
    default:
      return "unknown"
  }
}

function toSortableTimestamp(iso?: string | null): number {
  if (!iso) return 0
  const parsed = new Date(iso).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function createPatientMetaMap(patients: Patient[]) {
  const map = new Map<string, { patientName: string; roomNumber: string; ward: string }>()
  for (const patient of patients) {
    map.set(String(patient.id), getPatientLocationMeta(patient))
  }
  return map
}

export function buildNotificationsFromDbAlerts(
  alerts: AlertApiItem[],
  patients: Patient[],
): Notification[] {
  const patientMetaMap = createPatientMetaMap(patients)

  const notifications = alerts.map((alert) => {
    const patientId = alert.patientId == null ? "" : String(alert.patientId)
    let patientMeta = patientMetaMap.get(patientId)

    // Fallback: If patientId lookup failed, try to find by Name (handling case where alert.patientId is a Name)
    if (!patientMeta) {
      const foundByName = patients.find(p => p.name === patientId || p.name === alert.patientId)
      if (foundByName) {
        patientMeta = getPatientLocationMeta(foundByName)
      }
    }

    const id =
      alert.legacyId && String(alert.legacyId).trim()
        ? String(alert.legacyId)
        : `notif-${alert.alertId ?? `${patientId}-${Date.now()}`}`

    return {
      id,
      alertId: alert.alertId ?? null,
      severity: normalizeAlarmSeverity(alert),
      patientId,
      patientName: patientMeta?.patientName ?? (patientId || "미확인 환자"),
      roomNumber: patientMeta?.roomNumber ?? "-",
      ward: patientMeta?.ward ?? "-",
      type: normalizeNotificationType(alert.type ?? alert.alertType),
      title: cleanAlertString(alert.message ?? alert.alertType ?? "알림"),
      evidence: cleanAlertString(alert.evidenceSnippet) ?? "-",
      createdAt: alert.displayCreatedAt ?? alert.createdAt ?? new Date().toISOString(),
      acknowledged: String(alert.status ?? "").toUpperCase() !== "ACTIVE",
      snoozedUntil: alert.snoozedUntil ?? undefined,
      isSnoozed: Boolean(alert.isSnoozed),
      dedupCount: 1,
    } satisfies Notification
  })

  notifications.sort((a, b) => {
    const rankDiff = severityRank(a.severity) - severityRank(b.severity)
    if (rankDiff !== 0) return rankDiff
    return toSortableTimestamp(b.createdAt) - toSortableTimestamp(a.createdAt)
  })

  return notifications
}

function severityRank(s: AlarmSeverity): number {
  switch (s) {
    case "S3":
      return 0
    case "S2":
      return 1
    case "S1":
      return 2
  }
}

// ─── Severity display helpers ───
export function getSeverityConfig(severity: AlarmSeverity) {
  switch (severity) {
    case "S3":
      return {
        label: "CRITICAL",
        labelKr: "즉시 조치",
        bgClass: "bg-[#ef4444]",
        textClass: "text-[#ef4444]",
        borderClass: "border-[#ef4444]",
        bgMutedClass: "bg-[#ef4444]/10",
        dotClass: "bg-[#ef4444]",
      }
    case "S2":
      return {
        label: "ACTION",
        labelKr: "확인 필요",
        bgClass: "bg-[#f59e0b]",
        textClass: "text-[#f59e0b]",
        borderClass: "border-[#f59e0b]",
        bgMutedClass: "bg-[#f59e0b]/10",
        dotClass: "bg-[#f59e0b]",
      }
    case "S1":
      return {
        label: "INFO",
        labelKr: "정보",
        bgClass: "bg-muted-foreground",
        textClass: "text-muted-foreground",
        borderClass: "border-muted-foreground/30",
        bgMutedClass: "bg-muted",
        dotClass: "bg-muted-foreground",
      }
  }
}
