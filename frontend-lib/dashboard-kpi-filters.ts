import type { Notification } from "@/lib/notification-engine"
import type { Patient } from "@/lib/types"

export type DashboardKpiId =
  | "high-risk"
  | "critical-events"
  | "mdro-updates"
  | "pending-results"
  | "transfer-icu"

export type KpiPatientIdSets = Record<DashboardKpiId, Set<string>>

type TransferSignal = { icu: boolean; transfer: boolean }

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

export function normalizeKey(input: string | undefined | null): string {
  return String(input ?? "").trim().toLowerCase()
}

function isPendingSignalType(type: string | undefined): boolean {
  return normalizeKey(type) === "pending_result"
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

function isTransferOrIcuCandidate(patient: Patient, hasAlertSignal: boolean): boolean {
  const isWorsening =
    hasAlertSignal ||
    (patient.nlpAlertTags ?? []).some((tag) =>
      /악화|위험|deterioration|instability/i.test(`${tag.label} ${tag.evidence}`),
    )

  const meetsCriteria =
    getRiskLevelToday(patient) === 2 ||
    (patient.qsofa ?? 0) >= 2 ||
    (patient.lactate ?? 0) >= 2.5

  return isWorsening && meetsCriteria
}

function createPatientIdLookup(patients: Patient[]): Map<string, string> {
  const lookup = new Map<string, string>()

  for (const patient of patients) {
    const id = String(patient.id)
    const idKey = normalizeKey(id)
    const nameKey = normalizeKey(patient.name)
    if (idKey) lookup.set(idKey, id)
    if (nameKey) lookup.set(nameKey, id)
  }

  return lookup
}

function resolveNotificationPatientId(
  notification: Notification,
  patientIdLookup: Map<string, string>,
): string | null {
  const idKey = normalizeKey(notification.patientId)
  if (idKey) {
    const resolved = patientIdLookup.get(idKey)
    if (resolved) return resolved
  }

  const nameKey = normalizeKey(notification.patientName)
  if (nameKey) {
    const resolved = patientIdLookup.get(nameKey)
    if (resolved) return resolved
  }

  return null
}

export function isPendingNotification(notification: Notification): boolean {
  if (isPendingSignalType(notification.type)) return true
  const text = `${notification.title} ${notification.evidence}`.toLowerCase()
  return /pending|결과\s*대기|배양\s*대기|result\s*pending/.test(text)
}

export function buildScopedNotifications(
  patients: Patient[],
  notifications: Notification[],
): Notification[] {
  const scopedPatientKeys = new Set(
    patients
      .flatMap((patient) => [
        normalizeKey(String(patient.id || "")),
        normalizeKey(patient.name),
      ])
      .filter(Boolean),
  )

  return notifications.filter((notification) => {
    if (notification.acknowledged) return false

    const patientIdKey = normalizeKey(notification.patientId)
    const patientNameKey = normalizeKey(notification.patientName)
    return scopedPatientKeys.has(patientIdKey) || scopedPatientKeys.has(patientNameKey)
  })
}

function createEmptyKpiPatientIdSets(): KpiPatientIdSets {
  return {
    "high-risk": new Set<string>(),
    "critical-events": new Set<string>(),
    "mdro-updates": new Set<string>(),
    "pending-results": new Set<string>(),
    "transfer-icu": new Set<string>(),
  }
}

export function buildKpiPatientIdSets(
  patients: Patient[],
  notifications: Notification[],
): KpiPatientIdSets {
  const sets = createEmptyKpiPatientIdSets()
  const patientIdLookup = createPatientIdLookup(patients)
  const scopedNotifications = buildScopedNotifications(patients, notifications)

  for (const patient of patients) {
    if (getRiskLevelToday(patient) >= 1) {
      sets["high-risk"].add(String(patient.id))
    }
  }

  for (const notification of scopedNotifications) {
    const resolvedPatientId = resolveNotificationPatientId(notification, patientIdLookup)
    if (!resolvedPatientId) continue

    if (notification.severity === "S3") {
      sets["critical-events"].add(resolvedPatientId)
    }

    if (isPendingNotification(notification)) {
      sets["pending-results"].add(resolvedPatientId)
    }
  }

  const referenceNowMs = getReferenceNowMs(patients)
  for (const patient of patients) {
    if (!patient.mdroStatus?.isMDRO) continue

    const updatedAtMs =
      parseDateTimeToMs(patient.lastUpdatedTimestamp) ??
      parseDateTimeToMs(patient.mdroStatus.isolationStarted) ??
      null

    if (updatedAtMs == null) {
      sets["mdro-updates"].add(String(patient.id))
      continue
    }

    const diffMs = referenceNowMs - updatedAtMs
    if (diffMs >= 0 && diffMs <= 72 * 60 * 60 * 1000) {
      sets["mdro-updates"].add(String(patient.id))
    }
  }

  const transferSignalByPatientKey = new Map<string, TransferSignal>()
  for (const notification of scopedNotifications) {
    const patientKey = normalizeKey(notification.patientId || notification.patientName)
    if (!patientKey) continue

    const current = transferSignalByPatientKey.get(patientKey) ?? { icu: false, transfer: false }
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

    transferSignalByPatientKey.set(patientKey, current)
  }

  for (const patient of patients) {
    const signal =
      transferSignalByPatientKey.get(normalizeKey(String(patient.id || ""))) ??
      transferSignalByPatientKey.get(normalizeKey(patient.name))

    if (isTransferOrIcuCandidate(patient, Boolean(signal?.icu || signal?.transfer))) {
      sets["transfer-icu"].add(String(patient.id))
    }
  }

  return sets
}
