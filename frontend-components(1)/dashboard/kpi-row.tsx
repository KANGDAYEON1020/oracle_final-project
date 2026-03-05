"use client"

import React from "react"

import { cn } from "@/lib/utils"
import type { Patient } from "@/lib/types"
import { useNotifications } from "@/lib/notification-context"
import {
  buildScopedNotifications,
  isPendingNotification,
  normalizeKey,
} from "@/lib/dashboard-kpi-filters"
import {
  TrendingUp,
  AlertTriangle,
  FlaskConical,
  ShieldAlert,
  Activity,
  ChevronDown,
} from "lucide-react"

interface KpiCard {
  id: string
  label: string
  value: number
  subtext: string
  trend?: string
  icon: React.ElementType
  variant: "default" | "warning" | "critical" | "info"
}

function formatSignedNumber(value: number): string {
  if (value > 0) return `+${value}`
  return `${value}`
}

function parseDateTimeToMs(input: string | undefined): number | null {
  if (!input) return null

  const normalized = input.includes("T")
    ? input
    : input.includes(" ")
      ? input.replace(" ", "T")
      : input

  const hasTimezone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized)
  const iso = hasTimezone
    ? normalized
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
      ? `${normalized}:00Z`
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)
        ? `${normalized}Z`
        : normalized

  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return ms
}

function isHighRiskSignalType(type: string | undefined): boolean {
  const normalized = normalizeKey(type)
  return (
    normalized === "deterioration" ||
    normalized === "isolation" ||
    normalized === "icu_escalation" ||
    normalized === "sepsis_critical"
  )
}

function getReferenceNowMs(patients: Patient[]): number {
  const timestamps: number[] = []

  for (const patient of patients) {
    const lastUpdatedMs = parseDateTimeToMs(patient.lastUpdatedTimestamp)
    if (lastUpdatedMs != null) timestamps.push(lastUpdatedMs)

    for (const alert of patient.fusedAlerts ?? []) {
      const alertMs = parseDateTimeToMs(alert.createdAt)
      if (alertMs != null) timestamps.push(alertMs)
    }

    const isolationStartedMs = parseDateTimeToMs(patient.mdroStatus?.isolationStarted)
    if (isolationStartedMs != null) timestamps.push(isolationStartedMs)
  }

  return timestamps.length > 0 ? Math.max(...timestamps) : Date.now()
}

function getTrajectoryRiskLevel(patient: Patient): 0 | 1 | 2 | null {
  const normalized = String(patient.trajectoryRisk?.maxSeverity ?? "")
    .trim()
    .toLowerCase()

  if (!normalized) return null
  if (normalized === "critical") return 2
  if (normalized === "high" || normalized === "medium") return 1
  if (normalized === "low" || normalized === "info") return 0
  return null
}

function getRiskLevelToday(patient: Patient): 0 | 1 | 2 {
  const trajectoryLevel = getTrajectoryRiskLevel(patient)
  if (trajectoryLevel != null) return trajectoryLevel
  if (patient.status === "critical") return 2
  if (patient.status === "warning") return 1
  return 0
}

function getRiskLevelYesterday(patient: Patient, referenceNowMs: number): 0 | 1 | 2 {
  const today = getRiskLevelToday(patient)
  const lastEventAt = patient.trajectoryRisk?.lastEventAt
  const lastEventMs = parseDateTimeToMs(lastEventAt ?? undefined)
  if (lastEventMs == null) return today

  const diffMs = referenceNowMs - lastEventMs
  if (diffMs >= 0 && diffMs <= 24 * 60 * 60 * 1000) {
    return (Math.max(0, today - 1) as 0 | 1 | 2)
  }
  return today
}

function isTransferOrIcuCandidate(patient: Patient, hasAlertSignal: boolean): boolean {
  const isWorsening =
    hasAlertSignal ||
    (patient.nlpAlertTags ?? []).some((tag) =>
      /악화|위험|deterioration|instability/i.test(`${tag.label} ${tag.evidence}`)
    )

  const meetsCriteria =
    getRiskLevelToday(patient) === 2 ||
    (patient.qsofa ?? 0) >= 2 ||
    (patient.lactate ?? 0) >= 2.5

  return isWorsening && meetsCriteria
}

const variantStyles = {
  default: {
    border: "border-border",
    iconBg: "bg-accent",
    iconColor: "text-accent-foreground",
    valueBg: "",
  },
  warning: {
    border: "border-warning/30",
    iconBg: "bg-warning/10",
    iconColor: "text-warning",
    valueBg: "",
  },
  critical: {
    border: "border-destructive/30",
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive",
    valueBg: "",
  },
  info: {
    border: "border-primary/30",
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
    valueBg: "",
  },
}

interface KpiRowProps {
  activeFilter: string | null
  onFilterChange: (id: string | null) => void
  patients: Patient[]
}

export function KpiRow({ activeFilter, onFilterChange, patients }: KpiRowProps) {
  const [isExpanded, setIsExpanded] = React.useState(false)
  const { notifications } = useNotifications()
  const referenceNowMs = getReferenceNowMs(patients)
  const scopedNotifications = React.useMemo(
    () => buildScopedNotifications(patients, notifications),
    [notifications, patients],
  )

  const criticalPatientCount = patients.filter((p) => getRiskLevelToday(p) >= 2).length
  const highRiskPatientCount = patients.filter((p) => getRiskLevelToday(p) >= 1).length
  const scopedNotificationTimestamps = scopedNotifications
    .map((notification) => parseDateTimeToMs(notification.createdAt))
    .filter((ms): ms is number => ms != null)
  const signalReferenceNowMs =
    scopedNotificationTimestamps.length > 0
      ? Math.max(referenceNowMs, Date.now(), ...scopedNotificationTimestamps)
      : Math.max(referenceNowMs, Date.now())
  const currentWindowStartMs = signalReferenceNowMs - 24 * 60 * 60 * 1000
  const previousWindowStartMs = signalReferenceNowMs - 48 * 60 * 60 * 1000

  const currentHighRiskSignalPatientIds = new Set<string>()
  const previousHighRiskSignalPatientIds = new Set<string>()
  for (const notification of scopedNotifications) {
    if (!(notification.severity === "S3" || isHighRiskSignalType(notification.type))) continue
    const createdAtMs = parseDateTimeToMs(notification.createdAt)
    if (createdAtMs == null) continue
    const patientKey = normalizeKey(notification.patientId || notification.patientName)
    if (!patientKey) continue

    if (createdAtMs >= currentWindowStartMs && createdAtMs <= signalReferenceNowMs) {
      currentHighRiskSignalPatientIds.add(patientKey)
      continue
    }
    if (createdAtMs >= previousWindowStartMs && createdAtMs < currentWindowStartMs) {
      previousHighRiskSignalPatientIds.add(patientKey)
    }
  }
  const fallbackRiskDelta = highRiskPatientCount - patients.filter(
    (p) => getRiskLevelYesterday(p, referenceNowMs) >= 1
  ).length
  const highRiskDelta =
    currentHighRiskSignalPatientIds.size > 0 || previousHighRiskSignalPatientIds.size > 0
      ? currentHighRiskSignalPatientIds.size - previousHighRiskSignalPatientIds.size
      : fallbackRiskDelta

  const criticalEvents = scopedNotifications.filter((notification) => notification.severity === "S3")
  const criticalCreatedAtValues = criticalEvents
    .map((notification) => parseDateTimeToMs(notification.createdAt))
    .filter((ms): ms is number => ms != null)
  const criticalReferenceNowMs =
    criticalCreatedAtValues.length > 0
      ? Math.max(referenceNowMs, Date.now(), ...criticalCreatedAtValues)
      : Math.max(referenceNowMs, Date.now())
  const criticalEventsRecent2h = criticalEvents.filter((notification) => {
    const createdAtMs = parseDateTimeToMs(notification.createdAt)
    if (createdAtMs == null) return false
    const diffMs = criticalReferenceNowMs - createdAtMs
    return diffMs >= 0 && diffMs <= 2 * 60 * 60 * 1000
  }).length
  const mdroUpdatedPatients = patients.filter((p) => {
    if (!p.mdroStatus?.isMDRO) return false
    const updatedAtMs =
      parseDateTimeToMs(p.lastUpdatedTimestamp) ??
      parseDateTimeToMs(p.mdroStatus.isolationStarted) ??
      null
    if (updatedAtMs == null) return true
    const diffMs = referenceNowMs - updatedAtMs
    return diffMs >= 0 && diffMs <= 72 * 60 * 60 * 1000
  })
  const mdroCounts = mdroUpdatedPatients.reduce(
    (acc, p) => {
      const type = p.mdroStatus?.mdroType
      if (type === "CRE") acc.cre += 1
      else if (type === "VRE") acc.vre += 1
      else if (type === "MRSA") acc.mrsa += 1
      return acc
    },
    { cre: 0, vre: 0, mrsa: 0 }
  )

  const pendingResultsCount = scopedNotifications.filter((notification) => {
    return isPendingNotification(notification)
  }).length

  const transferSignalByPatientId = new Map<string, { icu: boolean; transfer: boolean }>()
  for (const notification of scopedNotifications) {
    const patientKey = normalizeKey(notification.patientId || notification.patientName)
    if (!patientKey) continue
    const current = transferSignalByPatientId.get(patientKey) ?? { icu: false, transfer: false }
    const text = `${notification.title} ${notification.evidence}`.toLowerCase()
    if (
      notification.severity === "S3" ||
      /icu|중환자실|hemodynamic|resp_support|critical/.test(text)
    ) {
      current.icu = true
    } else if (
      notification.type === "deterioration" ||
      notification.type === "care_gap" ||
      /전원|transfer|악화|불안정/.test(text)
    ) {
      current.transfer = true
    }
    transferSignalByPatientId.set(patientKey, current)
  }

  const transferCandidates = patients.filter((patient) => {
    const signal =
      transferSignalByPatientId.get(normalizeKey(String(patient.id || ""))) ??
      transferSignalByPatientId.get(normalizeKey(patient.name))
    return isTransferOrIcuCandidate(patient, Boolean(signal?.icu || signal?.transfer))
  })
  const transferClassification = transferCandidates.reduce(
    (acc, p) => {
      const signal =
        transferSignalByPatientId.get(normalizeKey(String(p.id || ""))) ??
        transferSignalByPatientId.get(normalizeKey(p.name))
      const text = [p.aiSummary, ...(p.nlpAlertTags ?? []).map((t) => `${t.label} ${t.evidence}`)].join(" ")

      const isIcu = Boolean(signal?.icu) || /ICU|중환자실/i.test(text) || p.status === "critical"
      const isTransfer = Boolean(signal?.transfer) || /상급병원|전원|transfer/i.test(text)

      if (isIcu) acc.icu += 1
      else if (isTransfer) acc.transfer += 1
      else acc.transfer += 1

      return acc
    },
    { icu: 0, transfer: 0 }
  )

  const kpiData: KpiCard[] = [
    {
      id: "high-risk",
      label: "고위험 환자 수 (24h)",
      value: highRiskPatientCount,
      subtext: `Critical ${criticalPatientCount}명`,
      trend: `전일 대비 ${formatSignedNumber(highRiskDelta)}`,
      icon: TrendingUp,
      variant: "warning",
    },
    {
      id: "critical-events",
      label: "Critical 이벤트 수 (ACTIVE)",
      value: criticalEvents.length,
      subtext: `최근 2h 신규 ${criticalEventsRecent2h}건`,
      icon: Activity,
      variant: "critical",
    },
    {
      id: "mdro-updates",
      label: "MDRO 신규/업데이트 (72h)",
      value: mdroUpdatedPatients.length,
      subtext: `CRE ${mdroCounts.cre} / VRE ${mdroCounts.vre} / MRSA ${mdroCounts.mrsa}`,
      icon: AlertTriangle,
      variant: "info",
    },
    {
      id: "pending-results",
      label: "주요 결과 대기 (Pending Results)",
      value: pendingResultsCount,
      subtext: "blood/sputum culture / CXR / PCR",
      icon: FlaskConical,
      variant: "default",
    },
    {
      id: "transfer-icu",
      label: "전원/ICU 고려 후보 (Transfer/ICU Candidate)",
      value: transferCandidates.length,
      subtext: `ICU ${transferClassification.icu} / 전원 ${transferClassification.transfer}`,
      icon: ShieldAlert,
      variant: "warning",
    },
  ]

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full md:hidden px-1 mb-2"
      >
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">주요 지표</span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {isExpanded ? "접기" : "펼치기"}
          <ChevronDown className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-180")} />
        </div>
      </button>

      <div className={cn(
        "grid grid-cols-1 gap-4 md:grid-cols-5",
        !isExpanded && "hidden md:grid"
      )}>
        {kpiData.map((kpi) => {
          const styles = variantStyles[kpi.variant]
          const isActive = activeFilter === kpi.id
          return (
            <button
              key={kpi.id}
              type="button"
              onClick={() => onFilterChange(isActive ? null : kpi.id)}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-4 text-left transition-all hover:shadow-md",
                styles.border,
                isActive && "ring-2 ring-primary shadow-md"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {kpi.label}
                </span>
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg hidden md:flex",
                    styles.iconBg
                  )}
                >
                  <kpi.icon className={cn("h-4 w-4", styles.iconColor)} />
                </div>
              </div>
              <span className="mt-2 text-3xl font-bold text-card-foreground">
                {kpi.value}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                {kpi.subtext}
              </span>
              {kpi.trend && (
                <span className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-primary hidden md:flex">
                  <TrendingUp className="h-3 w-3" />
                  {kpi.trend}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
