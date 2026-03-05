"use client"

import { useMemo, useState } from "react"
import { LayoutGrid, ChevronDown, Star, Filter } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { PatientCardComponent } from "./patient-card"
import type { Patient } from "@/lib/types"
import type { PatientCard, RiskLevel, PatientTag } from "@/lib/types"
import { useNotifications } from "@/lib/notification-context"
import {
  buildKpiPatientIdSets,
  type KpiPatientIdSets,
} from "@/lib/dashboard-kpi-filters"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const filterChips = [
  "Deterioration",
  "Infection Suspected",
  "Pending Results",
  "Care Gaps",
  "Isolation/MDRO",
  "Cluster Suspected",
]

const riskOrder = { Critical: 0, Urgent: 1, Watch: 2, Low: 3 }
const shiftOrder = { Day: 1, Evening: 2, Night: 3 }

function getShiftRank(shift: string | undefined | null): number {
  if (!shift) return 99
  return shiftOrder[shift as keyof typeof shiftOrder] ?? 99
}

function buildPatientSearchBlob(patient: PatientCard): string {
  const tags = patient.tags.map((tag) => tag.label).join(" ")
  return `${tags} ${patient.evidenceSnippet}`.toLowerCase()
}

function matchesChip(patient: PatientCard, chip: string): boolean {
  const blob = buildPatientSearchBlob(patient)
  if (chip === "Deterioration") {
    return patient.riskLevel === "Critical" || patient.riskLevel === "Urgent" || /악화|worsen/.test(blob)
  }
  if (chip === "Infection Suspected") {
    return /infection|감염|temp|crp|wbc|culture/.test(blob)
  }
  if (chip === "Pending Results") {
    return /pending|대기/.test(blob)
  }
  if (chip === "Care Gaps") {
    return /gap|미적용|조치 필요|check/.test(blob)
  }
  if (chip === "Isolation/MDRO") {
    return /isolation|mdro|격리|mrsa|vre|cre/.test(blob)
  }
  if (chip === "Cluster Suspected") {
    return /cluster/.test(blob)
  }
  return false
}

function matchesKpiFilter(
  patient: PatientCard,
  kpiId: string | null,
  kpiPatientIdSets: KpiPatientIdSets,
): boolean {
  if (!kpiId) return true
  if (kpiId === "high-risk") {
    return kpiPatientIdSets["high-risk"].has(String(patient.id))
  }
  if (kpiId === "critical-events") {
    return kpiPatientIdSets["critical-events"].has(String(patient.id))
  }
  if (kpiId === "mdro-updates") {
    return kpiPatientIdSets["mdro-updates"].has(String(patient.id))
  }
  if (kpiId === "pending-results") {
    return kpiPatientIdSets["pending-results"].has(String(patient.id))
  }
  if (kpiId === "transfer-icu") {
    return kpiPatientIdSets["transfer-icu"].has(String(patient.id))
  }

  return true
}

function mapTrajectorySeverityToRiskLevel(severity: unknown): RiskLevel | null {
  const normalized = String(severity ?? "").trim().toLowerCase()
  if (!normalized) return null
  if (normalized === "critical") return "Critical"
  if (normalized === "high" || normalized === "medium") return "Urgent"
  if (normalized === "low" || normalized === "info") return "Low"
  return null
}

function normalizeTrajectorySeverityToken(severity: unknown): string {
  return String(severity ?? "").trim().toLowerCase()
}

function toTrajectorySeverityKo(severity: unknown): string {
  const normalized = normalizeTrajectorySeverityToken(severity)
  if (normalized === "critical") return "위중"
  if (normalized === "high") return "높음"
  if (normalized === "medium") return "주의"
  if (normalized === "low") return "낮음"
  if (normalized === "info") return "정보"
  return "미상"
}

function toTrajectoryStateKo(severity: unknown): string {
  const normalized = normalizeTrajectorySeverityToken(severity)
  if (normalized === "critical" || normalized === "high" || normalized === "medium") return "악화"
  if (normalized === "low" || normalized === "info") return "안정"
  return "변동"
}

function toClockLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function compactText(value: unknown, maxLength = 52): string {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function parseSpo2Pair(label: string): { from: number; to: number } | null {
  const matched = label.match(/(\d+(?:\.\d+)?)\s*%?\s*(?:→|->|>|-)\s*(\d+(?:\.\d+)?)\s*%?/)
  if (!matched) return null
  const from = Number.parseFloat(matched[1])
  const to = Number.parseFloat(matched[2])
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  return { from, to }
}

function isGenericSeverityEventLabel(label: string): boolean {
  const compact = label.replace(/\s+/g, " ").trim()
  if (!compact) return false
  if (/^(위중|높음|주의|낮음|정보)\s*이벤트$/.test(compact)) return true
  return /^(critical|high|medium|low|info)\s*event$/i.test(compact)
}

function isTrivialSpo2Label(label: unknown): boolean {
  const text = String(label ?? "").trim()
  if (!text) return false
  if (!/spo2|산소\s*포화도/i.test(text)) return false

  const pair = parseSpo2Pair(text)
  if (!pair) return false

  const diff = Math.abs(pair.to - pair.from)
  const belowThreshold = pair.to <= 92
  const o2Changed = /(?:\bo2\b|fio2|flow|l\/min|리터|고유량|마스크|nasal|device|산소\s*(증가|감소|변경|공급|요법))/i.test(
    text,
  )
  return diff <= 1 && !belowThreshold && !o2Changed
}

function buildTrajectoryEvidenceSnippet(p: Patient): string | null {
  const risk = p.trajectoryRisk
  if (!risk) return null

  const latestSeverity = risk.latestSeverity || risk.maxSeverity || null
  const state = toTrajectoryStateKo(latestSeverity)
  const severityKo = toTrajectorySeverityKo(latestSeverity)

  const worseningLabelsFromTags = Array.from(
    new Set(
      (p.nlpAlertTags || [])
        .filter((tag) => tag.trajectory === "worsening")
        .map((tag) => compactText(tag.label, 22))
        .filter((label) => !isTrivialSpo2Label(label))
        .filter((label) => !isGenericSeverityEventLabel(label))
        .filter(Boolean),
    ),
  )
  const trajectoryIssueLabels = (risk.topIssueLabels || [])
    .map((label) => compactText(label, 22))
    .filter((label) => !isTrivialSpo2Label(label))
    .filter((label) => !isGenericSeverityEventLabel(label))

  const issueLabels = Array.from(
    new Set(
      [
        ...trajectoryIssueLabels,
        ...worseningLabelsFromTags,
        p.hasCareGapSignal ? "격리·조치 공백" : "",
        p.hasPendingLabSignal ? "검사결과 대기" : "",
        p.mdroStatus?.isMDRO ? `${p.mdroStatus.mdroType || "MDRO"} 관리` : "",
      ].filter(Boolean),
    ),
  )

  const trendPoints = Array.isArray(risk.riskTrend) ? risk.riskTrend : []
  const latestPoint = trendPoints.length > 0 ? trendPoints[trendPoints.length - 1] : null
  const latestTime = toClockLabel(latestPoint?.eventAt || risk.lastEventAt || null)
  const latestEventLabelCandidate = compactText(risk.latestEventLabel || "", 32)
  const latestEventLabel =
    latestEventLabelCandidate &&
      !isTrivialSpo2Label(latestEventLabelCandidate) &&
      !isGenericSeverityEventLabel(latestEventLabelCandidate)
      ? latestEventLabelCandidate
      : ""

  let firstLine = "큰 악화 없음"
  if (issueLabels.length > 0 && state === "악화") {
    firstLine = `악화: ${issueLabels.slice(0, 2).join(", ")}${latestTime ? ` (${latestTime})` : ""}`
  } else if (issueLabels.length > 0 && state !== "안정") {
    firstLine = `변화: ${issueLabels.slice(0, 2).join(", ")}${latestTime ? ` (${latestTime})` : ""}`
  } else if (state === "악화") {
    firstLine = `악화: ${severityKo}${latestTime ? ` (${latestTime})` : ""}`
  } else if (state === "안정") {
    firstLine = `안정: ${severityKo}${latestTime ? ` (${latestTime})` : ""}`
  }

  const recentEventLabelRaw =
    latestEventLabel ||
    issueLabels[0] ||
    (latestPoint
      ? `D${latestPoint.dNumber}${latestPoint.shift ? ` ${latestPoint.shift}` : ""} 경과 기록`
      : "") ||
    compactText(p.diagnosis, 24)
  const recentEventLabel = recentEventLabelRaw.replace(/^최근\s*/, "").trim()
  const secondLine = recentEventLabel
    ? `최근 ${latestTime ? `${latestTime} ` : ""}${recentEventLabel}`
    : "최근 이벤트 없음"

  return `${firstLine}\n${secondLine}`
}

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

function formatBedLabel(patient: Patient): string {
  const patientWithOptionalWardBed = patient as Patient & { ward_bed?: unknown }
  const parsed = parseWardBed(patientWithOptionalWardBed.ward_bed)

  const ward =
    normalizeLocationValue(patient.ward) ??
    normalizeLocationValue(patient.floor) ??
    parsed.ward
  const roomNumber =
    normalizeLocationValue(patient.roomNumber) ??
    parsed.roomNumber

  if (ward && roomNumber) return `${ward} ${roomNumber}호`
  if (roomNumber) return `${roomNumber}호`
  if (ward) return ward
  return "-"
}

// Adapter function to convert V2 Patient to V1 PatientCard
function adaptPatientToCard(p: Patient): PatientCard {
  // Prefer trajectory severity for risk-level display.
  let riskLevel: RiskLevel = "Low"
  const trajectoryRiskLevel = mapTrajectorySeverityToRiskLevel(
    p.trajectoryRisk?.maxSeverity,
  )
  if (trajectoryRiskLevel) {
    riskLevel = trajectoryRiskLevel
  } else if (p.status === "critical") riskLevel = "Critical"
  else if (p.status === "warning") riskLevel = "Urgent"
  else if (p.status === "transferred") riskLevel = "Watch"

  // HD Day: DB의 current_hd 사용, 없으면 입원일 기준 계산
  const hdDay = (p as any).currentHd ?? (() => {
    if (!p.admissionDate) return 1
    const admitDate = new Date(p.admissionDate).getTime()
    const now = Date.now()
    return Math.max(1, Math.floor((now - admitDate) / (1000 * 60 * 60 * 24)))
  })()

  const tags: PatientTag[] = []

  // 1. Structured Data Tags (MDRO, Isolation, Cluster)
  if (p.mdroStatus?.isMDRO) {
    tags.push({ label: p.mdroStatus.mdroType || "MDRO", variant: "purple" })
  }

  if (p.clusterSuspected) {
    tags.push({ label: "Cluster Suspected", variant: "purple" })
  }

  if (p.mdroStatus?.isolationRequired && !p.mdroStatus.isolationImplemented) {
    tags.push({ label: "Isolation Gap", variant: "warning" })
  } else if (p.mdroStatus?.isolationRequired) {
    tags.push({ label: "Isolation", variant: "warning" })
  }

  // 2. Map NLP Alert Tags
  (p.nlpAlertTags || []).forEach(tag => {
    let variant: PatientTag['variant'] = "default"

    // Heuristic color mapping
    if (tag.label.includes("MDRO") || tag.label.includes("내성")) variant = "purple"
    else if (tag.trajectory === "worsening") variant = "destructive"
    else if (tag.type === "uncertainty") variant = "warning"
    else if (tag.type === "plan") variant = "info"
    else if (tag.trajectory === "improving" || tag.type === "negation") variant = "success"

    // Deduplication: Don't add if a similar tag exists from structured data
    const isDuplicate = tags.some(t => t.label === tag.label || (tag.label.includes("MDRO") && t.variant === "purple"))

    if (!isDuplicate) {
      tags.push({ label: tag.label, variant })
    }
  })

  // Fallback if no tags
  if (tags.length === 0) {
    if (riskLevel === "Critical") tags.push({ label: "Critical Risk", variant: "destructive" })
    else if (riskLevel === "Urgent") tags.push({ label: "Warning", variant: "warning" })
    else if (riskLevel === "Watch") tags.push({ label: "Observation", variant: "default" })
    else if (riskLevel === "Low") tags.push({ label: "Low Risk", variant: "success" })
  }

  return {
    id: p.id,
    name: p.name,
    age: p.age,
    sex: p.gender,
    patientId: p.id, // Using full ID as patient ID for display
    bed: formatBedLabel(p),
    hdDay,
    demoDayLabel: p.demoDayLabel ?? undefined,
    demoShift: p.demoShift ?? undefined,
    riskLevel,
    tags,
    evidenceSnippet:
      buildTrajectoryEvidenceSnippet(p) ||
      p.evidenceSnippet ||
      (p.aiSummary ? p.aiSummary.slice(0, 80) + "..." : p.diagnosis || ""),
    evidenceHighlight: undefined, // specific highlight logic could be added if available
    primaryAction: "view",
    secondaryAction: undefined
  }
}

interface PatientWatchlistProps {
  patients: Patient[]
  activeKpi?: string | null
  currentShift?: "Day" | "Evening" | "Night" | null
}

export function PatientWatchlist({ patients, activeKpi = null, currentShift = null }: PatientWatchlistProps) {
  const { notifications } = useNotifications()
  const [showRiskyOnly, setShowRiskyOnly] = useState(false)
  const [activeChips, setActiveChips] = useState<string[]>([])
  const [showAll, setShowAll] = useState(false)
  const [sortBy, setSortBy] = useState<"Risk Level" | "HD Day" | "Bed" | "Name">("Risk Level")
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false)

  const toggleFavorite = (id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleChip = (chip: string) => {
    setActiveChips((prev) =>
      prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]
    )
  }

  const adaptedPatients = useMemo(() => patients.map(adaptPatientToCard), [patients])
  const kpiPatientIdSets = useMemo(
    () => buildKpiPatientIdSets(patients, notifications),
    [notifications, patients],
  )

  // Sort logic
  const sortedPatients = [...adaptedPatients].sort((a, b) => {
    if (sortBy === "Risk Level") {
      const levelA = riskOrder[a.riskLevel as keyof typeof riskOrder] ?? 99
      const levelB = riskOrder[b.riskLevel as keyof typeof riskOrder] ?? 99
      if (levelA !== levelB) return levelA - levelB
      if (b.hdDay !== a.hdDay) return b.hdDay - a.hdDay
      const shiftDiff = getShiftRank(a.demoShift ?? currentShift) - getShiftRank(b.demoShift ?? currentShift)
      if (shiftDiff !== 0) return shiftDiff
      return a.name.localeCompare(b.name)
    }
    if (sortBy === "HD Day") {
      if (b.hdDay !== a.hdDay) return b.hdDay - a.hdDay
      const shiftDiff = getShiftRank(a.demoShift ?? currentShift) - getShiftRank(b.demoShift ?? currentShift)
      if (shiftDiff !== 0) return shiftDiff
      return a.name.localeCompare(b.name)
    }
    if (sortBy === "Bed") {
      const bedDiff = a.bed.localeCompare(b.bed)
      if (bedDiff !== 0) return bedDiff
      return a.name.localeCompare(b.name)
    }
    if (sortBy === "Name") {
      return a.name.localeCompare(b.name)
    }
    return 0
  })

  const filteredPatients = sortedPatients
    .filter((p) => matchesKpiFilter(p, activeKpi, kpiPatientIdSets))
    .filter((p) => (showRiskyOnly ? p.riskLevel !== "Low" : true))
    .filter((p) => (showFavoritesOnly ? favoriteIds.has(p.id) : true))
    .filter((p) => (activeChips.length === 0 ? true : activeChips.some((chip) => matchesChip(p, chip))))


  const visiblePatients = showAll
    ? filteredPatients
    : filteredPatients.slice(0, 50)
  // API responses can include duplicated patient IDs (e.g., multiple admissions).
  // Add a deterministic suffix for duplicates so React keys stay unique.
  const patientIdCounts = new Map<string, number>()
  const visiblePatientsWithKeys = visiblePatients.map((patient) => {
    const count = patientIdCounts.get(patient.id) ?? 0
    patientIdCounts.set(patient.id, count + 1)
    return {
      patient,
      renderKey: count === 0 ? patient.id : `${patient.id}-${count}`,
    }
  })

  const remaining = filteredPatients.length - visiblePatients.length

  return (
    <section className="flex flex-col gap-4">
      {/* Section header */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-bold">Prioritized Patient Watchlist</h2>
          </div>
          {/* Mobile Filter Toggle */}
          <button
            onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
            className="md:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background text-sm font-medium hover:bg-accent"
          >
            <Filter className="h-4 w-4" />
            <span>Filters</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", isMobileFilterOpen && "rotate-180")} />
          </button>
        </div>

<div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="showRisky"
                checked={showRiskyOnly}
                onCheckedChange={(v) => setShowRiskyOnly(v === true)}
                className="data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
              />
              <label
                htmlFor="showRisky"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Show Risky Only
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors",
                  showFavoritesOnly
                    ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-600"
                    : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    showFavoritesOnly ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground"
                  )}
                />
                <span>Favorites</span>
              </button>

              <Select value={sortBy} onValueChange={(val: any) => setSortBy(val)}>
                <SelectTrigger id="patient-watchlist-sort-trigger" aria-controls="patient-watchlist-sort-content" className="w-[140px] h-9">
                  <SelectValue placeholder="Risk Level" />
                </SelectTrigger>
                <SelectContent id="patient-watchlist-sort-content">
                  <SelectItem value="Risk Level">Risk Level</SelectItem>
                  <SelectItem value="HD Day">HD Day</SelectItem>
                  <SelectItem value="Bed">Bed</SelectItem>
                  <SelectItem value="Name">Name</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

        <div className={cn(
          "flex flex-col gap-4 transition-all duration-300 ease-in-out overflow-hidden md:overflow-visible",
          !isMobileFilterOpen ? "max-h-0 md:max-h-none opacity-0 md:opacity-100" : "max-h-[500px] opacity-100"
        )}>
          {/* Filter chips */}
          <div className="mb-5 flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => toggleChip(chip)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  activeChips.includes(chip)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Patient grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {visiblePatientsWithKeys.map(({ patient, renderKey }) => (
          <PatientCardComponent
            key={renderKey}
            patient={patient}
            isFavorite={favoriteIds.has(patient.id)}
            onToggleFavorite={() => toggleFavorite(patient.id)}
          />
        ))}
      </div>

      {/* Show more */}
      {remaining > 0 && !showAll && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-6 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-accent"
          >
            {"Show "}
            {remaining}
            {" more patients"}
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      )}
    </section>
  )
}
