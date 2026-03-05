"use client"

import { useMemo, useState } from "react"
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  User,
  Activity,
  AlertTriangle,
  FileText,
  Search,
  CheckCircle2,
  Filter,
  Building2,
  Stethoscope,
  Clock,
  Sparkles,
  Info,
  ChevronDown
} from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Eye, BookOpen, ClipboardList, TrendingDown, ShieldAlert, Bug, Users, ShieldOff, Loader2 } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn, cleanAlertString } from "@/lib/utils"
import type { Patient } from "@/lib/types"
import { useNotifications } from "@/lib/notification-context"
import {
  Sepsis6ChecklistV2,
  ClinicalTrajectoryPanel,
  SHAPWaterfallChart,
  WardSHAPSummaryChart,
  NumericFourAxisChart,
  ClinicalDocumentTimeline,
  EnhancedDocumentTimeline,
  ReferralNoteCard,
  GuidelineRAGPanel,
  SeverityAssessmentPanel,
  FusedAlertList
} from "@/components/clinical/nlp-components"
import { ExplainPanel } from "@/components/clinical/explain-panel"
import type { WardSHAPSummary } from "@/lib/types"

interface FirstPageProps {
  patients: Patient[]
  selectedPatient: Patient | null
  onPatientSelect: (patient: Patient) => void
  onTransfer: (patientId: string) => void
  onGoToTransferPage: () => void
}

type SortKey = "riskScore" | "lastUpdated" | "name" | "ward"
type SortDirection = "asc" | "desc"
type WardFilter = "all" | "2F" | "3F" | "5F"
type DiseaseFilter = "all" | "폐렴" | "요로감염" | "GI감염" | "MDRO"
type DoctorFilter = "all" | string
type WatchFilter = "highRisk" | "newMDRO" | "clusterSuspected" | "isolationNotApplied"

// Watch filter definitions
const WATCH_FILTERS: { key: WatchFilter; label: string; description: string }[] = [
  { key: "highRisk", label: "High risk", description: "24-48h 내 임상 위험 이벤트" },
  { key: "newMDRO", label: "New MDRO", description: "72h 내 MDRO 신규 확정" },
  { key: "clusterSuspected", label: "Cluster suspected", description: "집단 발생 의심" },
  { key: "isolationNotApplied", label: "격리 미조치", description: "격리 필요 but 미시행" },
]

// ─── Representative Event Selection (6-axis priority chain) ───
// Watch card shows exactly ONE event per patient: the highest-priority
// event from the last 24-48h, selected by the fixed chain:
//
//   ① Escalation
//   ② Infection Control / Operation
//   ③ Respiratory support change
//   ④ Hemodynamics / Organ dysfunction
//   ⑤ Infection activity
//   ⑥ Clinical action
//
// Display rules: verb-included sentence, time info, fact-only, no judgment.

type EventCandidate = { text: string; severity: "critical" | "warning" }

function getTemporalEvent(patient: Patient): EventCandidate | null {
  // ① Escalation — ICU evaluation, transfer considered, rapid response
  const hasEscalation = patient.nlpAlertTags?.some(
    t => t.label.includes("ICU") || t.label.includes("전원") ||
      t.evidence?.toLowerCase().includes("transfer") ||
      t.evidence?.toLowerCase().includes("rapid response")
  )
  if (hasEscalation) {
    // Find the most specific escalation tag
    const icuTag = patient.nlpAlertTags?.find(t => t.label.includes("ICU") || t.label.includes("전원"))
    if (icuTag) {
      return { text: "ICU evaluation mentioned (2h)", severity: "critical" }
    }
    return { text: "Transfer considered (12h)", severity: "critical" }
  }

  // ② Infection Control / Operation — Isolation gap, Cluster, New MDRO
  if (patient.mdroStatus?.isolationRequired && !patient.mdroStatus?.isolationImplemented) {
    return { text: "Isolation required, not applied", severity: "critical" }
  }
  if (patient.clusterSuspected) {
    const ward = patient.floor || patient.ward
    const mdro = patient.mdroStatus?.mdroType || "GI"
    return { text: `Cluster suspected (${mdro}, ${ward})`, severity: "critical" }
  }
  if (patient.mdroStatus?.isMDRO && patient.mdroStatus?.mdroType) {
    return { text: `MDRO confirmed (${patient.mdroStatus.mdroType})`, severity: "warning" }
  }

  // ③ Respiratory support change — O₂ started/escalated, device upgrade, SpO₂ drop
  const respAxis = patient.numericTrajectory?.axes.find(a => a.axis === "respiratory")
  if (respAxis?.change === "up") {
    const o2Supp = respAxis.supplementary?.find(s => s.label === "O2 LPM")
    const deviceSupp = respAxis.supplementary?.find(s => s.label === "O2 Device" || s.label === "Device")
    if (o2Supp?.value && o2Supp.value !== "RA") {
      return { text: `O\u2082 escalated to ${o2Supp.value} (24h)`, severity: "critical" }
    }
    if (deviceSupp?.value) {
      return { text: `Respiratory device changed to ${deviceSupp.value} (24h)`, severity: "critical" }
    }
    // SpO₂ drop detected via respiratory axis worsening
    return { text: `SpO\u2082 dropped to ${respAxis.currentValue}% (24h)`, severity: "critical" }
  }

  // ④ Hemodynamics / Organ dysfunction — MAP < 65, Lactate ≥ 2, Platelet drop, Cr rise
  const latestVitals = patient.vitals[patient.vitals.length - 1]
  if (latestVitals) {
    const map = Math.round((latestVitals.bloodPressureSystolic + 2 * latestVitals.bloodPressureDiastolic) / 3)
    if (map < 65) {
      return { text: `MAP dropped to ${map} mmHg (6h)`, severity: "critical" }
    }
  }
  if ((patient.lactate ?? 0) >= 4) {
    return { text: `Lactate increased to ${patient.lactate} mmol/L (12h)`, severity: "critical" }
  }
  if ((patient.lactate ?? 0) >= 2) {
    return { text: `Lactate reached ${patient.lactate} mmol/L (24h)`, severity: "warning" }
  }
  // Organ dysfunction axis (platelet, creatinine) via organDysfunction trajectory
  const organAxis = patient.numericTrajectory?.axes.find(a => a.axis === "organDysfunction")
  if (organAxis?.change === "up" && organAxis.status === "critical") {
    return { text: `Organ dysfunction score rose to ${organAxis.currentValue} (48h)`, severity: "critical" }
  }

  // ⑤ Infection activity — CRP spike, WBC change, Culture ordered, Abx changed
  const infAxis = patient.numericTrajectory?.axes.find(a => a.axis === "infection")
  if (infAxis?.change === "up") {
    return {
      text: `CRP ${infAxis.prevValue} \u2192 ${infAxis.currentValue} (48h)`,
      severity: infAxis.status === "critical" ? "critical" : "warning",
    }
  }

  // ⑥ Clinical action — Notify surge, Monitoring intensified, PRN surge, New orders burst
  const actionAxis = patient.numericTrajectory?.axes.find(a => a.axis === "clinicalAction")
  if (actionAxis?.change === "up" && actionAxis.actionBreakdown) {
    const bd = actionAxis.actionBreakdown
    if (bd.monitoringChange > 0) {
      return { text: "Monitoring intensified (q2h)", severity: "warning" }
    }
    if (bd.notify >= 3) {
      return { text: `Dr. notify ${bd.notify} times (24h)`, severity: "warning" }
    }
    if (bd.newOrder >= 2) {
      return { text: `${bd.newOrder} new orders placed (24h)`, severity: "warning" }
    }
  }

  return null
}

// Helper to clean up long alert strings (e.g., combined MDRO + Isolation alerts)


// Categorical tags generator
// Rules: noun-only, no time info, outline pill form, pastel/gray tones
function getCategoricalTags(patient: Patient): { label: string; type: "mdro" | "isolation" | "cluster" }[] {
  const tags: { label: string; type: "mdro" | "isolation" | "cluster" }[] = []
  if (patient.mdroStatus?.isMDRO && patient.mdroStatus?.mdroType) {
    tags.push({ label: cleanAlertString(patient.mdroStatus.mdroType), type: "mdro" })
  }
  if (patient.mdroStatus?.isolationRequired && !patient.mdroStatus?.isolationImplemented) {
    tags.push({ label: "Isolation gap", type: "isolation" })
  }
  if (patient.clusterSuspected) {
    tags.push({ label: "Cluster suspected", type: "cluster" })
  }
  return tags
}

// Watch filter matching logic
function matchesWatchFilter(patient: Patient, filter: WatchFilter): boolean {
  switch (filter) {
    case "highRisk": {
      // Matches patients with events from axes ①–④ (Escalation through Hemodynamics)
      const hasEscalation = patient.nlpAlertTags?.some(
        t => t.label.includes("ICU") || t.label.includes("전원") ||
          t.evidence?.toLowerCase().includes("transfer")
      )
      const hasRespChange = patient.numericTrajectory?.axes.find(a => a.axis === "respiratory")?.change === "up"
      const latestV = patient.vitals[patient.vitals.length - 1]
      const map = latestV ? Math.round((latestV.bloodPressureSystolic + 2 * latestV.bloodPressureDiastolic) / 3) : 999
      const hasHemoDys = map < 65 || (patient.lactate ?? 0) >= 2
      return hasEscalation === true || hasRespChange === true || hasHemoDys
    }
    case "newMDRO":
      return patient.mdroStatus?.isMDRO === true
    case "clusterSuspected":
      return patient.clusterSuspected === true
    case "isolationNotApplied":
      return patient.mdroStatus?.isolationRequired === true && patient.mdroStatus?.isolationImplemented === false
    default:
      return false
  }
}

// ─── Watch Sort: 5-group hierarchy ───
// Group 0: S3 CRITICAL (Ack required) — driven by notification engine
// Group 1: 격리 미조치 (Isolation gap)
// Group 2: Cluster suspected
// Group 3: MDRO confirmed
// Group 4: High risk (기타 — Escalation / Resp / Hemo / Infection / Action events)
// Group 5: Stable
//
// Within each group: most recent event first.

type WatchGroup = 0 | 1 | 2 | 3 | 4 | 5
type WatchGroupLabel = "S3 CRITICAL" | "격리 미조치" | "Cluster suspected" | "MDRO confirmed" | "High risk" | "Stable"

const WATCH_GROUP_LABELS: Record<WatchGroup, WatchGroupLabel> = {
  0: "S3 CRITICAL",
  1: "격리 미조치",
  2: "Cluster suspected",
  3: "MDRO confirmed",
  4: "High risk",
  5: "Stable",
}

// Severity tier description shown next to group header (explanatory only, minimal emphasis)
const WATCH_GROUP_SEVERITY_HINT: Record<WatchGroup, string | null> = {
  0: "Ack required",
  1: "확인/조치 권장",
  2: "확인/조치 권장",
  3: "확인/조치 권장",
  4: "확인/조치 권장",
  5: null,
}

const WATCH_GROUP_COLORS: Record<WatchGroup, { text: string; border: string; bg: string; dot: string }> = {
  0: { text: "text-[#ef4444]", border: "border-[#ef4444]/20", bg: "bg-[#ef4444]/5", dot: "bg-[#ef4444]" },
  1: { text: "text-[#ef4444]", border: "border-[#ef4444]/20", bg: "bg-[#ef4444]/5", dot: "bg-[#ef4444]" },
  2: { text: "text-[#f59e0b]", border: "border-[#f59e0b]/20", bg: "bg-[#f59e0b]/5", dot: "bg-[#f59e0b]" },
  3: { text: "text-[#f59e0b]", border: "border-[#f59e0b]/20", bg: "bg-[#f59e0b]/5", dot: "bg-[#f59e0b]" },
  4: { text: "text-[#f59e0b]", border: "border-[#f59e0b]/20", bg: "bg-[#f59e0b]/5", dot: "bg-[#f59e0b]" },
  5: { text: "text-muted-foreground", border: "border-border", bg: "bg-transparent", dot: "bg-[#10b981]" },
}

function getWatchGroupForPatient(patient: Patient, s3PinnedIds: Set<string>): WatchGroup {
  // Group 0: S3 pinned (unacknowledged S3 notifications)
  if (s3PinnedIds.has(patient.id)) return 0

  // Group 1: Isolation gap
  if (patient.mdroStatus?.isolationRequired && !patient.mdroStatus?.isolationImplemented) return 1

  // Group 2: Cluster suspected
  if (patient.clusterSuspected) return 2

  // Group 3: MDRO confirmed
  if (patient.mdroStatus?.isMDRO && patient.mdroStatus?.mdroType) return 3

  // Group 4: High risk — any clinical event from axes 1-6
  const hasEscalation = patient.nlpAlertTags?.some(
    t => t.label.includes("ICU") || t.label.includes("전원") ||
      t.evidence?.toLowerCase().includes("transfer") ||
      t.evidence?.toLowerCase().includes("rapid response")
  )
  if (hasEscalation) return 4

  const respAxis = patient.numericTrajectory?.axes.find(a => a.axis === "respiratory")
  if (respAxis?.change === "up") return 4

  const latestVitals = patient.vitals[patient.vitals.length - 1]
  if (latestVitals) {
    const map = Math.round((latestVitals.bloodPressureSystolic + 2 * latestVitals.bloodPressureDiastolic) / 3)
    if (map < 65) return 4
  }
  if ((patient.lactate ?? 0) >= 2) return 4

  const infAxis = patient.numericTrajectory?.axes.find(a => a.axis === "infection")
  if (infAxis?.change === "up") return 4

  const organAxis = patient.numericTrajectory?.axes.find(a => a.axis === "organDysfunction")
  if (organAxis?.change === "up" && organAxis.status === "critical") return 4

  const actionAxis = patient.numericTrajectory?.axes.find(a => a.axis === "clinicalAction")
  if (actionAxis?.change === "up") return 4

  // Group 5: Stable
  return 5
}

// Risk level helpers
const getRiskLevel = (status: string) => {
  switch (status) {
    case "critical": return { label: "위급", color: "bg-[#ef4444]", textColor: "text-[#ef4444]" }
    case "warning": return { label: "주의", color: "bg-[#f59e0b]", textColor: "text-[#f59e0b]" }
    case "stable": return { label: "안정", color: "bg-[#10b981]", textColor: "text-[#10b981]" }
    default: return { label: "이송", color: "bg-gray-400", textColor: "text-gray-400" }
  }
}

const getRiskGradient = (status: string) => {
  switch (status) {
    case "critical": return "gradient-critical"
    case "warning": return "gradient-warning"
    default: return "gradient-stable"
  }
}

export function FirstPage({
  patients,
  selectedPatient,
  onPatientSelect,
  onGoToTransferPage,
}: FirstPageProps) {
  const [sortKey, setSortKey] = useState<SortKey>("riskScore")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState<"vitals" | "trends" | "explain" | "guideline" | "documents">("vitals")
  // Property filters (dropdowns)
  const [wardFilter, setWardFilter] = useState<WardFilter>("all")
  const [diseaseFilter, setDiseaseFilter] = useState<DiseaseFilter>("all")
  const [doctorFilter, setDoctorFilter] = useState<DoctorFilter>("all")
  // Watch filters (toggle buttons, multi-select)
  const [activeWatchFilters, setActiveWatchFilters] = useState<Set<WatchFilter>>(new Set())
  const [isKpiExpanded, setIsKpiExpanded] = useState(false)
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false)

  // S3 pin-to-top: unacknowledged S3 patients are pinned
  const { unacknowledgedS3 } = useNotifications()
  const s3PinnedPatientIds = useMemo(() => {
    return new Set(unacknowledgedS3.map((n) => n.patientId))
  }, [unacknowledgedS3])

  // Ward-level SHAP summary: aggregate from patients' sepsisExplanation
  const wardSHAPSummary = useMemo<WardSHAPSummary>(() => {
    const withSepsis = patients.filter(p => p.sepsisExplanation?.factors?.length)
    if (!withSepsis.length) return { avgRiskScore: 0, factors: [] }

    const avgRiskScore = withSepsis.reduce(
      (s, p) => s + (p.sepsisExplanation?.riskScore || 0), 0
    ) / withSepsis.length

    const factorMap = new Map<string, { total: number; count: number }>()
    for (const p of withSepsis) {
      for (const f of p.sepsisExplanation!.factors) {
        const e = factorMap.get(f.factor) || { total: 0, count: 0 }
        e.total += f.value
        e.count++
        factorMap.set(f.factor, e)
      }
    }

    return {
      avgRiskScore,
      factors: Array.from(factorMap.entries())
        .map(([factor, { total, count }]) => ({
          factor,
          avgValue: total / count,
          patientCount: count,
        }))
        .sort((a, b) => Math.abs(b.avgValue) - Math.abs(a.avgValue)),
    }
  }, [patients])

  const toggleWatchFilter = (filter: WatchFilter) => {
    setActiveWatchFilters(prev => {
      const next = new Set(prev)
      if (next.has(filter)) {
        next.delete(filter)
      } else {
        next.add(filter)
      }
      return next
    })
  }

  // Extract unique doctors from patient list
  const uniqueDoctors = useMemo(() => {
    const docs = new Set(patients.map(p => p.attendingDoctor).filter(Boolean))
    return Array.from(docs).sort()
  }, [patients])

  // Filter counts for display
  const filterCounts = useMemo(() => ({
    all: patients.length,
    "2F": patients.filter(p => p.floor === "2F").length,
    "3F": patients.filter(p => p.floor === "3F").length,
    "5F": patients.filter(p => p.floor === "5F").length,
  }), [patients])

  // Watch filter counts
  const watchFilterCounts = useMemo(() => ({
    highRisk: patients.filter(p => matchesWatchFilter(p, "highRisk")).length,
    newMDRO: patients.filter(p => matchesWatchFilter(p, "newMDRO")).length,
    clusterSuspected: patients.filter(p => matchesWatchFilter(p, "clusterSuspected")).length,
    isolationNotApplied: patients.filter(p => matchesWatchFilter(p, "isolationNotApplied")).length,
  }), [patients])

  const filteredAndSortedPatients = useMemo(() => {
    let filtered = patients

    // Apply Watch filters (OR logic: patient matches if ANY active watch filter matches)
    if (activeWatchFilters.size > 0) {
      filtered = filtered.filter(p =>
        Array.from(activeWatchFilters).some(f => matchesWatchFilter(p, f))
      )
    }

    // Apply property filters (AND logic)
    if (wardFilter !== "all") {
      filtered = filtered.filter(p => p.floor === wardFilter)
    }

    if (diseaseFilter !== "all") {
      filtered = filtered.filter(p =>
        p.primaryDisease?.includes(diseaseFilter) ||
        p.diagnosis.includes(diseaseFilter)
      )
    }

    if (doctorFilter !== "all") {
      filtered = filtered.filter(p => p.attendingDoctor === doctorFilter)
    }

    // Apply search query
    if (searchQuery) {
      filtered = filtered.filter(p =>
        p.name.includes(searchQuery) ||
        p.diagnosis.includes(searchQuery) ||
        p.roomNumber.includes(searchQuery) ||
        p.attendingDoctor?.includes(searchQuery)
      )
    }

    // Sort: 5-group hierarchy (S3 > 격리미조치 > Cluster > MDRO > High risk > Stable)
    // Within each group: most recent event timestamp first
    return [...filtered].sort((a, b) => {
      const groupA = getWatchGroupForPatient(a, s3PinnedPatientIds)
      const groupB = getWatchGroupForPatient(b, s3PinnedPatientIds)
      if (groupA !== groupB) return groupA - groupB

      // Within same group: secondary sort by user-selected key
      let comparison = 0
      switch (sortKey) {
        case "riskScore":
          comparison = a.riskScore - b.riskScore
          break
        case "lastUpdated": {
          const parseTime = (t: string) => {
            if (t?.includes("분")) return Number.parseInt(t) || 0
            if (t?.includes("시간")) return (Number.parseInt(t) || 0) * 60
            return 999
          }
          comparison = parseTime(a.lastUpdated || "") - parseTime(b.lastUpdated || "")
          break
        }
        case "name":
          comparison = a.name.localeCompare(b.name)
          break
        case "ward":
          comparison = (a.floor || "").localeCompare(b.floor || "")
          break
      }
      return sortDirection === "desc" ? -comparison : comparison
    })
  }, [patients, sortKey, sortDirection, searchQuery, wardFilter, diseaseFilter, doctorFilter, activeWatchFilters, s3PinnedPatientIds])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("desc")
    }
  }

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="ml-1 h-3 w-3" />
    return sortDirection === "asc"
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />
  }

  return (
    <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
      {/* Left: Filter + Patient List (30% on desktop, 100% on mobile) */}
      <div className="w-full md:w-[30%] min-w-[340px] md:max-w-[440px] shrink-0 border-r border-border bg-card flex flex-col h-[400px] md:h-auto border-b md:border-b-0">


        {/* Mobile Filter Toggle */}
        <div className="md:hidden px-4 py-2 border-b border-border flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-10 transition-colors hover:bg-white/80">
          <span className="text-xs font-semibold text-muted-foreground">환자 필터 & 검색 옵션</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMobileFilterOpen(!isMobileFilterOpen)}
            className="h-7 text-xs hover:bg-slate-100"
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            필터
            <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", isMobileFilterOpen && "rotate-180")} />
          </Button>
        </div>

        {/* Filter Sections Container */}
        <div className={cn(
          "flex-col border-b border-border md:border-b-0 transition-all duration-300 ease-in-out",
          !isMobileFilterOpen ? "hidden md:flex" : "flex animate-in slide-in-from-top-2"
        )}>
          {/* [1] Watch 필터 - Toggle Buttons */}
          <div className="px-4 pt-4 pb-3 border-b border-border text-foreground">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setIsKpiExpanded(!isKpiExpanded)}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground md:cursor-default"
              >
                <span>Watch 필터</span>
                <ChevronDown className={cn("h-3 w-3 md:hidden transition-transform", isKpiExpanded && "rotate-180")} />
              </button>

              {activeWatchFilters.size > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveWatchFilters(new Set())}
                  className="text-[10px] text-primary hover:underline"
                >
                  초기화
                </button>
              )}
            </div>

            <div className={cn(
              "grid grid-cols-1 gap-1.5 md:flex md:flex-wrap transition-all duration-300 ease-in-out overflow-hidden md:h-auto md:opacity-100",
              isKpiExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0 md:max-h-none"
            )}>
              {WATCH_FILTERS.map((wf) => {
                const isActive = activeWatchFilters.has(wf.key)
                const count = watchFilterCounts[wf.key]
                const IconMap: Record<WatchFilter, typeof ShieldAlert> = {
                  highRisk: AlertTriangle,
                  newMDRO: Bug,
                  clusterSuspected: Users,
                  isolationNotApplied: ShieldOff,
                }
                const WfIcon = IconMap[wf.key]
                const colorMap: Record<WatchFilter, string> = {
                  highRisk: "border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]",
                  newMDRO: "border-[#f59e0b] bg-[#f59e0b]/10 text-[#f59e0b]",
                  clusterSuspected: "border-[#8b5cf6] bg-[#8b5cf6]/10 text-[#8b5cf6]",
                  isolationNotApplied: "border-[#ef4444] bg-[#ef4444]/10 text-[#ef4444]",
                }
                return (
                  <TooltipProvider key={wf.key}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => toggleWatchFilter(wf.key)}
                          className={cn(
                            "flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-all justify-between md:justify-start",
                            isActive
                              ? colorMap[wf.key]
                              : "border-border bg-transparent text-muted-foreground hover:bg-muted/50"
                          )}
                        >
                          <div className="flex items-center gap-1">
                            <WfIcon className="hidden md:block h-3 w-3" />
                            <span>{wf.label}</span>
                          </div>
                          <span className={cn(
                            "ml-0.5 text-[10px] font-bold rounded-full px-1.5 min-w-[18px] text-center",
                            isActive ? "bg-white/30" : "bg-muted"
                          )}>
                            {count}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">{wf.description}</p>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                )
              })}
            </div>
          </div>

          {/* [2] 속성 필터 - Dropdowns */}
          <div className="px-4 py-3 border-b border-border space-y-2 text-foreground">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">속성 필터</h3>
            <div className="grid grid-cols-3 gap-2">
              {/* Ward */}
              <Select value={wardFilter} onValueChange={(v) => setWardFilter(v as WardFilter)}>
                <SelectTrigger className="h-7 text-[11px] bg-transparent">
                  <Building2 className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="병동" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 ({filterCounts.all})</SelectItem>
                  <SelectItem value="2F">2F ({filterCounts["2F"]})</SelectItem>
                  <SelectItem value="3F">3F ({filterCounts["3F"]})</SelectItem>
                  <SelectItem value="5F">5F ({filterCounts["5F"]})</SelectItem>
                </SelectContent>
              </Select>
              {/* Disease */}
              <Select value={diseaseFilter} onValueChange={(v) => setDiseaseFilter(v as DiseaseFilter)}>
                <SelectTrigger className="h-7 text-[11px] bg-transparent">
                  <Stethoscope className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="질병" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="폐렴">폐렴</SelectItem>
                  <SelectItem value="요로감염">요로감염</SelectItem>
                  <SelectItem value="GI감염">GI 감염</SelectItem>
                  <SelectItem value="MDRO">MDRO</SelectItem>
                </SelectContent>
              </Select>
              {/* Doctor */}
              <Select value={doctorFilter} onValueChange={(v) => setDoctorFilter(v as DoctorFilter)}>
                <SelectTrigger className="h-7 text-[11px] bg-transparent">
                  <User className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="담당의" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  {uniqueDoctors.map(doc => (
                    <SelectItem key={doc} value={doc}>{doc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

        </div>
        {/* [3] Search + Count */}
        <div className="px-4 py-2 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="이름 / 병실 / 담당의 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-7 text-xs"
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-[10px] text-muted-foreground">
              {filteredAndSortedPatients.length}명 표시
              {activeWatchFilters.size > 0 && ` (Watch 필터 ${activeWatchFilters.size}개 적용)`}
            </span>
            <span className="text-[10px] text-muted-foreground">
              S3 {'>'} 격리미조치 {'>'} Cluster {'>'} MDRO {'>'} High risk {'>'} Stable
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            정보성 이벤트(S1)는 알림함에서 확인할 수 있습니다.
          </p>
        </div>

        {/* [4] Patient List Cards */}
        <ScrollArea className="flex-1">
          {filteredAndSortedPatients.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <Search className="h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">조건에 맞는 환자가 없습니다</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                필터 조건을 변경하거나 검색어를 수정해 주세요
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveWatchFilters(new Set())
                  setWardFilter("all")
                  setDiseaseFilter("all")
                  setDoctorFilter("all")
                  setSearchQuery("")
                }}
                className="mt-3 text-xs text-primary hover:underline"
              >
                모든 필터 초기화
              </button>
            </div>
          ) : (
            <GroupedPatientList
              patients={filteredAndSortedPatients}
              s3PinnedPatientIds={s3PinnedPatientIds}
              selectedPatient={selectedPatient}
              onPatientSelect={onPatientSelect}
            />
          )}
        </ScrollArea>
      </div>

      {/* Right: Patient Dashboard (70%) */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        {!selectedPatient ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-muted-foreground">
              <User className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2">환자를 선택하세요</p>
            </div>
          </div>
        ) : selectedPatient.status === "transferred" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center text-muted-foreground">
              <ArrowRight className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2 text-lg font-medium">{selectedPatient.name} 환자</p>
              <p className="mt-1">전원이 완료되었습니다</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <ScrollArea className="flex-1">
              <div className="p-6 space-y-5 animate-fade-in">
                {/* Patient Snapshot Header - Updated with last updated time */}
                <PatientSnapshotHeader patient={selectedPatient} />

                {/* Tabs: Main / Trajectory / Documents / Guideline */}
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
                  <TabsList className="grid w-full grid-cols-5 mb-4">
                    <TabsTrigger value="vitals" className="flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      모니터링
                    </TabsTrigger>
                    <TabsTrigger value="trends" className="flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Trajectory
                    </TabsTrigger>
                    <TabsTrigger value="explain" className="flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Explain
                    </TabsTrigger>
                    <TabsTrigger value="documents" className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4" />
                      문서/전원
                    </TabsTrigger>
                    <TabsTrigger value="guideline" className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      가이드라인
                    </TabsTrigger>
                  </TabsList>

                  {/* Main (Vitals) Tab - 24-48h Monitoring */}
                  <TabsContent value="vitals" className="space-y-5 mt-0">
                    {/* Patient Status Summary Table */}
                    <PatientStatusSummaryTable patient={selectedPatient} />

                    {/* Combined Severity Engine + Risk Heatmap */}
                    <CombinedSeverityHeatmap patient={selectedPatient} />

                    {/* 3 Vital Trend Charts (SpO2, MAP, RR+Lactate) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <VitalTrendChart
                        title="SpO2"
                        data={selectedPatient.vitals.map(v => ({
                          time: new Date(v.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
                          value: v.oxygenSaturation
                        }))}
                        currentValue={selectedPatient.vitals[selectedPatient.vitals.length - 1]?.oxygenSaturation ?? 0}
                        unit="%"
                        thresholdHigh={100}
                        thresholdLow={92}
                        thresholdLabel="92% 임계선"
                        color="#ef4444"
                      />
                      <VitalTrendChart
                        title="MAP (평균혈압)"
                        data={selectedPatient.vitals.map(v => ({
                          time: new Date(v.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
                          value: Math.round((v.bloodPressureSystolic + 2 * v.bloodPressureDiastolic) / 3)
                        }))}
                        currentValue={Math.round(((selectedPatient.vitals[selectedPatient.vitals.length - 1]?.bloodPressureSystolic ?? 0) + 2 * (selectedPatient.vitals[selectedPatient.vitals.length - 1]?.bloodPressureDiastolic ?? 0)) / 3)}
                        unit="mmHg"
                        thresholdHigh={105}
                        thresholdLow={65}
                        thresholdLabel="65mmHg 임계선"
                        color="#f97316"
                      />
                      <DualAxisChart
                        title="RR + 젖산"
                        rrData={selectedPatient.vitals.map(v => ({
                          time: new Date(v.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
                          rr: v.respiratoryRate,
                          lactate: selectedPatient.lactate ?? 1.5
                        }))}
                        currentRR={selectedPatient.vitals[selectedPatient.vitals.length - 1]?.respiratoryRate ?? 0}
                        currentLactate={selectedPatient.lactate ?? 1.5}
                      />
                    </div>

                    {/* Recent Change Summary & Attention Points with Disclaimer */}
                    <RecentChangeSummaryCard patient={selectedPatient} />

                    {/* Fusion Alerts as Event Cards */}
                    {selectedPatient.fusedAlerts && selectedPatient.fusedAlerts.length > 0 && (
                      <FusionAlertCards alerts={selectedPatient.fusedAlerts} />
                    )}
                  </TabsContent>

                  {/* Trajectory Tab - 7-day detailed trends */}
                  <TabsContent value="trends" className="space-y-5 mt-0">
                    {/* Model-based risk assessment status (explanatory, no emphasis) */}
                    <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                      본 환자는 모델 기반 위험 평가가 적용되어 있으며, 임상 이벤트와 결합된 경우에만 알림으로 노출됩니다.
                    </p>

                    {/* v2.0 Clinical Trajectory Panel - 4 Numeric Axes */}
                    {selectedPatient.numericTrajectory && (
                      <ClinicalTrajectoryPanel trajectory={selectedPatient.numericTrajectory} />
                    )}

                    {/* v2.0 Numeric 4-Axis Line Chart */}
                    {selectedPatient.numericTrajectory && (
                      <NumericFourAxisChart axes={selectedPatient.numericTrajectory.axes} />
                    )}

                    {/* Action Candidates / Review Checklist / Considerations */}
                    <ActionCandidatesCard patient={selectedPatient} />

                    {/* SHAP-based Sepsis Explanation */}
                    {selectedPatient.sepsisExplanation && (
                      <SHAPWaterfallChart explanation={selectedPatient.sepsisExplanation} />
                    )}

                    {/* Ward-level SHAP Summary */}
                    <WardSHAPSummaryChart summary={wardSHAPSummary} />
                  </TabsContent>

                  {/* Explain Tab - Sepsis-oriented clinical trajectory summary */}
                  <TabsContent value="explain" className="space-y-5 mt-0">
                    {selectedPatient.explainData ? (
                      <ExplainPanel data={selectedPatient.explainData} />
                    ) : (
                      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                        <Info className="h-8 w-8 opacity-40 mb-3" />
                        <p className="text-sm font-medium">Explain 데이터가 없습니다</p>
                        <p className="text-xs mt-1 text-muted-foreground/60">
                          해당 환자의 5-7일 임상 변화 데이터가 아직 수집되지 않았습니다.
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  {/* Documents/Transfer Tab */}
                  <TabsContent value="documents" className="space-y-5 mt-0">
                    {/* Patient Status Summary Table (same as Main) */}
                    <PatientStatusSummaryTable patient={selectedPatient} />

                    {/* Enhanced Clinical Document Timeline */}
                    {selectedPatient.enhancedTimeline && (
                      <EnhancedDocumentTimeline events={selectedPatient.enhancedTimeline} />
                    )}

                    {/* Current Treatment & Transfer Reason & Requests */}
                    <div className="grid grid-cols-2 gap-4">
                      {selectedPatient.referralNote && (
                        <ReferralNoteCard referralNote={selectedPatient.referralNote} />
                      )}

                      {selectedPatient.diagnosisGuideline && (
                        <GuidelineRAGPanel guideline={selectedPatient.diagnosisGuideline} />
                      )}

                      {!selectedPatient.referralNote && !selectedPatient.diagnosisGuideline && (
                        <div className="col-span-2 p-8 text-center text-muted-foreground border rounded-lg bg-muted/30">
                          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>전원 의뢰서 및 가이드라인이 생성되지 않았습니다</p>
                          <p className="text-xs mt-1">환자 상태가 안정적이거나 진단이 확정되지 않은 경우입니다</p>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Guideline Tab */}
                  <TabsContent value="guideline" className="space-y-5 mt-0">
                    <GuidelinePanel patient={selectedPatient} />
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>

            {/* Bottom: Transfer Button (Fixed) */}
            <div className="p-4 border-t border-border bg-card">
              <Button
                onClick={onGoToTransferPage}
                size="lg"
                className="w-full bg-gradient-to-r from-[#ef4444] to-[#f97316] hover:from-[#dc2626] hover:to-[#ea580c] text-white"
              >
                <FileText className="mr-2 h-5 w-5" />
                전원 의뢰서 보내���
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Grouped Patient List (extracted for performance) ───
function GroupedPatientList({
  patients,
  s3PinnedPatientIds,
  selectedPatient,
  onPatientSelect,
}: {
  patients: Patient[]
  s3PinnedPatientIds: Set<string>
  selectedPatient: Patient | null
  onPatientSelect: (patient: Patient) => void
}) {
  // Pre-compute group for each patient
  const patientGroups = useMemo(() => {
    const groups = new Map<string, WatchGroup>()
    for (const p of patients) {
      groups.set(p.id, getWatchGroupForPatient(p, s3PinnedPatientIds))
    }
    return groups
  }, [patients, s3PinnedPatientIds])

  // Pre-compute group counts
  const groupCounts = useMemo(() => {
    const counts = new Map<WatchGroup, number>()
    for (const g of patientGroups.values()) {
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
    return counts
  }, [patientGroups])

  return (
    <div className="p-2 space-y-0">
      {patients.map((patient, idx) => {
        const risk = getRiskLevel(patient.status)
        const temporalEvent = getTemporalEvent(patient)
        const categoricalTags = getCategoricalTags(patient)
        const isSelected = selectedPatient?.id === patient.id
        const group = patientGroups.get(patient.id) ?? (5 as WatchGroup)
        const groupStyle = WATCH_GROUP_COLORS[group]

        // Show group divider when group changes
        const prevGroup = idx > 0 ? patientGroups.get(patients[idx - 1].id) : null
        const showDivider = idx === 0 || group !== prevGroup

        return (
          <div key={patient.id}>
            {/* Group divider */}
            {showDivider && (
              <div className={cn(
                "flex items-center gap-2 px-3 pt-3 pb-1.5",
                idx > 0 && "mt-2 border-t border-border"
              )}>
                <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", groupStyle.dot)} />
                <span className={cn("text-[10px] font-bold uppercase tracking-wider", groupStyle.text)}>
                  {WATCH_GROUP_LABELS[group]}
                </span>
                {WATCH_GROUP_SEVERITY_HINT[group] && (
                  <span className="text-[10px] text-muted-foreground/50">
                    {'·'} {WATCH_GROUP_SEVERITY_HINT[group]}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground/60">
                  {groupCounts.get(group) ?? 0}
                </span>
                <div className="flex-1 h-px bg-border/50" />
              </div>
            )}

            {/* Patient card */}
            <button
              type="button"
              onClick={() => onPatientSelect(patient)}
              className={cn(
                "w-full text-left rounded-lg p-3 transition-all border mb-1",
                group === 0 && "border-[#ef4444]/30 bg-[#ef4444]/5",
                group === 0 && isSelected && "ring-1 ring-[#ef4444]/30",
                group !== 0 && isSelected && "bg-primary/5 border-primary/30 ring-1 ring-primary/20",
                group !== 0 && !isSelected && "border-transparent hover:bg-muted/50 hover:border-border",
              )}
            >
              {/* S3 Pin indicator - Keeping as it's a critical alert state, but maybe user meant strictly ONLY fields? I'll keep it as it's part of the 'row' state usually */}
              {group === 0 && (
                <div className="flex items-center gap-1 mb-1.5 text-[10px] font-bold text-[#ef4444] uppercase tracking-wider">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Ack required</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Name */}
                  <span className="font-semibold text-sm text-foreground shrink-0 flex items-center gap-1">
                    {patient.name}
                    <span className="text-xs font-normal text-muted-foreground">({patient.roomNumber}호)</span>
                  </span>

                  {/* Tags - Truncated with ellipsis */}
                  {categoricalTags.length > 0 && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px] bg-muted/50 px-1 rounded border border-border/50 shrink-1">
                      {categoricalTags.map(t => t.label).join(", ")}
                    </span>
                  )}

                  {/* Ward (Room) */}
                  <span className="text-xs text-muted-foreground truncate shrink-0">
                    {patient.floor}
                  </span>
                </div>

                {/* Sepsis Risk */}
                {(() => {
                  const rs = patient.sepsisExplanation?.riskScore
                  let label = "Low"
                  let color = "bg-emerald-100 text-emerald-700 border-emerald-200"

                  if (rs !== undefined && rs !== null) {
                    if (rs >= 0.6) {
                      label = "High"
                      color = "bg-rose-100 text-rose-700 border-rose-200"
                    } else if (rs >= 0.3) {
                      label = "Moderate"
                      color = "bg-amber-100 text-amber-700 border-amber-200"
                    }
                  }

                  return (
                    <Badge className={cn("text-[10px] px-2 py-0.5 border shadow-sm font-semibold shrink-0 cursor-default", color, "hover:bg-opacity-80")}>
                      Sepsis {label}
                    </Badge>
                  )
                })()}
              </div>
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Patient Snapshot Header - Updated with last updated time
function PatientSnapshotHeader({ patient }: { patient: Patient }) {
  const risk = getRiskLevel(patient.status)
  const latestVitals = patient.vitals[patient.vitals.length - 1]

  return (
    <Card className={cn("border-2 overflow-hidden", getRiskGradient(patient.status))}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("w-3 h-3 rounded-full animate-pulse", risk.color)} />
            <div>
              {/* Name (Age/Gender), Ward/Room, Attending, Primary Disease, Last Updated */}
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">
                  {patient.name} ({patient.age}/{patient.gender === "M" ? "남" : "여"})
                </h2>
                <Badge variant="outline" className="text-xs">
                  {patient.floor} {patient.roomNumber}호
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {patient.attendingDoctor}
                </Badge>
                <Badge className={cn("text-white", risk.color)}>
                  {risk.label}
                </Badge>
              </div>
              {/* Primary Disease + Key Vitals */}
              <p className="text-sm text-muted-foreground mt-1">
                {patient.primaryDisease} | SpO2 {latestVitals?.oxygenSaturation}% | BP {latestVitals?.bloodPressureSystolic}/{latestVitals?.bloodPressureDiastolic} | RR {latestVitals?.respiratoryRate}
              </p>
            </div>
          </div>
          <div className="text-right">
            {/* Last Updated Time */}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>최근 업데이트: {patient.lastUpdated}</span>
            </div>
            {patient.status === "critical" && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 mt-2">
                <AlertTriangle className="h-4 w-4 text-[#ef4444]" />
                <span className="text-xs font-medium text-[#ef4444]">6시간 내 급변 위험</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Patient Status Summary Table - 5 Categories with expandable date records
function PatientStatusSummaryTable({ patient }: { patient: Patient }) {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  // Generate mock historical records for each category
  const generateHistoricalRecords = (category: string) => {
    const today = new Date()
    const records: { date: string; summary: string; detail: string }[] = []

    for (let i = 0; i < 5; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" })

      switch (category) {
        case "nursing":
          records.push({
            date: dateStr,
            summary: i === 0 ? "최근 기록" : `${i}일 전`,
            detail: i === 0
              ? `V/S stable, SpO2 ${patient.vitals[patient.vitals.length - 1]?.oxygenSaturation ?? 95}% 유지, 식이 양호`
              : `V/S 안정, 일반 상태 양호, 투약 순응도 좋음`
          })
          break
        case "doctor":
          records.push({
            date: dateStr,
            summary: i === 0 ? "최근 기록" : `${i}일 전`,
            detail: i === 0
              ? `${patient.diagnosis} 치료 중, 항생제 D${3 + i} 유지, 호전 추세`
              : `경과 관찰 중, 특이 소견 없음`
          })
          break
        case "cxr":
          records.push({
            date: dateStr,
            summary: i === 0 ? "최근 촬영" : `${i}일 전`,
            detail: i === 0
              ? patient.imagingResults?.[0]?.impression || "양측 폐야 clear, 심비대 없음"
              : "이전 대비 호전 추세"
          })
          break
        case "lab":
          records.push({
            date: dateStr,
            summary: i === 0 ? "최근 결과" : `${i}일 전`,
            detail: i === 0
              ? `WBC ${patient.labResults.find(l => l.name === "WBC")?.value ?? "7.2"}, CRP ${patient.labResults.find(l => l.name === "CRP")?.value ?? "2.5"}, Cr ${patient.labResults.find(l => l.name === "Creatinine")?.value ?? "0.9"}`
              : `WBC ${(7 + i * 0.5).toFixed(1)}, CRP ${(3 + i * 0.8).toFixed(1)}`
          })
          break
        case "culture":
          records.push({
            date: dateStr,
            summary: i === 0 ? "최근 결과" : `${i}일 전`,
            detail: i === 0
              ? patient.cultureResults?.[0]?.result === "positive"
                ? `${patient.cultureResults[0].organism} 검출, ${patient.cultureResults[0].sensitivity?.join(", ")} 감수성`
                : "배양 음성 또는 대기 중"
              : "이전 배양 결과 없음"
          })
          break
      }
    }
    return records
  }

  const categories = [
    {
      id: "nursing",
      label: "간호기록",
      icon: FileText,
      latestValue: `V/S stable, SpO2 ${patient.vitals[patient.vitals.length - 1]?.oxygenSaturation ?? 95}%`,
      status: "normal"
    },
    {
      id: "doctor",
      label: "의사 경과기록",
      icon: Stethoscope,
      latestValue: `${patient.diagnosis} 치료 D${Math.floor((Date.now() - new Date(patient.admissionDate).getTime()) / (1000 * 60 * 60 * 24)) + 1}`,
      status: patient.status === "critical" ? "critical" : patient.status === "warning" ? "warning" : "normal"
    },
    {
      id: "cxr",
      label: "CXR 판독",
      icon: Eye,
      latestValue: patient.imagingResults?.[0]?.impression?.slice(0, 30) || "최근 촬영 없음",
      status: patient.imagingResults?.[0]?.status === "abnormal" ? "warning" : "normal"
    },
    {
      id: "lab",
      label: "Lab 결과",
      icon: Activity,
      latestValue: `WBC ${patient.labResults.find(l => l.name === "WBC")?.value ?? "N/A"}, CRP ${patient.labResults.find(l => l.name === "CRP")?.value ?? "N/A"}`,
      status: patient.labResults.find(l => l.name === "WBC")?.status === "high" ? "warning" : "normal"
    },
    {
      id: "culture",
      label: "배양 결과",
      icon: AlertTriangle,
      latestValue: patient.cultureResults?.[0]?.result === "positive"
        ? `${patient.cultureResults[0].organism} 검출`
        : patient.cultureResults?.[0]?.result === "pending" ? "결과 대기 중" : "음성",
      status: patient.cultureResults?.[0]?.result === "positive" ? "warning" : "normal"
    }
  ]

  const getStatusBg = (status: string) => {
    switch (status) {
      case "critical": return "bg-[#ef4444]/10 border-[#ef4444]/30 hover:bg-[#ef4444]/20"
      case "warning": return "bg-[#f59e0b]/10 border-[#f59e0b]/30 hover:bg-[#f59e0b]/20"
      default: return "bg-background border-border hover:bg-muted/50"
    }
  }

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case "critical": return "text-[#ef4444]"
      case "warning": return "text-[#f59e0b]"
      default: return "text-foreground"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          환자 상태 요약표
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          각 항목을 클릭하면 이전 기록이 날짜별로 표시됩니다
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 5 Category Buttons */}
        <div className="grid grid-cols-5 gap-2">
          {categories.map((cat) => {
            const Icon = cat.icon
            const isExpanded = expandedCategory === cat.id
            return (
              <button
                type="button"
                key={cat.id}
                onClick={() => {
                  setExpandedCategory(isExpanded ? null : cat.id)
                  setSelectedDate(null)
                }}
                className={cn(
                  "p-3 rounded-lg border text-left transition-all",
                  getStatusBg(cat.status),
                  isExpanded && "ring-2 ring-primary"
                )}
              >
                <div className="flex items-center gap-1 mb-1">
                  <Icon className={cn("h-3 w-3", getStatusTextColor(cat.status))} />
                  <span className="text-[10px] font-medium text-muted-foreground">{cat.label}</span>
                </div>
                <p className={cn("text-xs font-medium truncate", getStatusTextColor(cat.status))}>
                  {cat.latestValue}
                </p>
              </button>
            )
          })}
        </div>

        {/* Expanded History Panel */}
        {expandedCategory && (
          <div className="border rounded-lg p-3 bg-muted/30 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium">
                {categories.find(c => c.id === expandedCategory)?.label} 기록
              </h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setExpandedCategory(null)}
              >
                닫기
              </Button>
            </div>

            {/* Date List */}
            <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
              {generateHistoricalRecords(expandedCategory).map((record, i) => (
                <Button
                  key={i}
                  variant={selectedDate === record.date ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs shrink-0 bg-transparent"
                  onClick={() => setSelectedDate(selectedDate === record.date ? null : record.date)}
                >
                  {record.date}
                  {i === 0 && <Badge variant="secondary" className="ml-1 text-[9px] px-1">최신</Badge>}
                </Button>
              ))}
            </div>

            {/* Selected Date Detail */}
            {selectedDate && (
              <div className="p-3 rounded bg-background border animate-fade-in">
                <p className="text-xs font-medium text-muted-foreground mb-1">{selectedDate} 기록</p>
                <p className="text-sm">
                  {generateHistoricalRecords(expandedCategory).find(r => r.date === selectedDate)?.detail}
                </p>
              </div>
            )}

            {/* Default: Show latest record */}
            {!selectedDate && (
              <div className="p-3 rounded bg-background border">
                <p className="text-xs font-medium text-muted-foreground mb-1">가장 최근 기록</p>
                <p className="text-sm">
                  {generateHistoricalRecords(expandedCategory)[0]?.detail}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// 검사결과 (Combined Severity Engine + Risk Heatmap)
function CombinedSeverityHeatmap({ patient }: { patient: Patient }) {
  const latestVitals = patient.vitals[patient.vitals.length - 1]

  // Combined factors from both Severity Engine and Risk Heatmap
  const riskItems = [
    {
      label: "SpO2",
      value: `${latestVitals?.oxygenSaturation ?? 0}%`,
      status: (latestVitals?.oxygenSaturation ?? 100) < 92 ? "low" : "normal",
      tooltip: "산소포화도 92% 미만 시 산소요법 필요"
    },
    {
      label: "Lactate",
      value: `${patient.lactate ?? "N/A"}`,
      status: (patient.lactate ?? 0) > 4 ? "high" : (patient.lactate ?? 0) > 2 ? "high" : "normal",
      tooltip: "젖산 2mmol/L 이상 시 조직 저산소증"
    },
    {
      label: "O2 요구량",
      value: patient.numericTrajectory?.axes.find(a => a.axis === "respiratory")?.supplementary?.find(s => s.label === "O2 LPM")?.value || "RA",
      status: (patient.numericTrajectory?.axes.find(a => a.axis === "respiratory")?.status) === "critical" ? "high" : "normal",
      tooltip: "산소 요구량 증가 추세 확인"
    },
    {
      label: "MAP",
      value: `${Math.round(((latestVitals?.bloodPressureSystolic ?? 0) + 2 * (latestVitals?.bloodPressureDiastolic ?? 0)) / 3)}`,
      status: Math.round(((latestVitals?.bloodPressureSystolic ?? 0) + 2 * (latestVitals?.bloodPressureDiastolic ?? 0)) / 3) < 65 ? "low" : "normal",
      tooltip: "평균동맥압 65mmHg 미만 시 쇼크 위험"
    },
    {
      label: "CRP",
      value: patient.labResults.find(l => l.name === "CRP")?.value ?? "N/A",
      status: Number.parseFloat(patient.labResults.find(l => l.name === "CRP")?.value ?? "0") > 10 ? "high" : "normal",
      tooltip: "C-반응성 단백 수치"
    },
    {
      label: "Platelet",
      value: patient.labResults.find(l => l.name === "Platelet")?.value ?? "N/A",
      status: Number.parseFloat(patient.labResults.find(l => l.name === "Platelet")?.value ?? "999") < 100 ? "low" : "normal",
      tooltip: "혈소판 100 미만 시 DIC 위험"
    },
    {
      label: "RR",
      value: `${latestVitals?.respiratoryRate ?? 0}`,
      status: (latestVitals?.respiratoryRate ?? 0) > 22 ? "high" : (latestVitals?.respiratoryRate ?? 0) < 12 ? "low" : "normal",
      tooltip: "호흡수 정상범위: 12-20회/분"
    },
    {
      label: "GCS",
      value: "15",
      status: "normal",
      tooltip: "Glasgow Coma Scale 점수"
    },
    {
      label: "체온",
      value: `${latestVitals?.temperature.toFixed(1)}°C`,
      status: (latestVitals?.temperature ?? 37) > 38.5 ? "high" : (latestVitals?.temperature ?? 37) < 36 ? "low" : "normal",
      tooltip: "정상범위: 36.0-37.5°C"
    },
    {
      label: "HR",
      value: `${latestVitals?.heartRate ?? 0}`,
      status: (latestVitals?.heartRate ?? 80) > 100 ? "high" : (latestVitals?.heartRate ?? 80) < 60 ? "low" : "normal",
      tooltip: "정상범위: 60-100 bpm"
    },
  ]

  const getHeatmapColor = (status: string) => {
    switch (status) {
      case "high": return "bg-white border-2 border-border text-[#ef4444]"
      case "low": return "bg-white border-2 border-border text-[#3b82f6]"
      default: return "bg-white border-2 border-border text-foreground"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          검사결과
        </CardTitle>
        <p className="text-[10px] text-muted-foreground mt-1">
          <span className="inline-flex items-center gap-1"><span className="text-[#ef4444] font-bold">Red</span> 정상 이상</span>
          <span className="mx-2">|</span>
          <span className="inline-flex items-center gap-1"><span className="text-[#3b82f6] font-bold">Blue</span> 정상 이하</span>
          <span className="mx-2">|</span>
          <span className="inline-flex items-center gap-1"><span className="text-foreground">Black</span> 정상</span>
        </p>
      </CardHeader>
      <CardContent>
        <TooltipProvider>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {riskItems.map((item) => (
              <UITooltip key={item.label}>
                <TooltipTrigger asChild>
                  <div className={cn(
                    "p-2 rounded-lg cursor-pointer transition-all hover:scale-105",
                    getHeatmapColor(item.status)
                  )}>
                    <p className="text-[10px] font-medium opacity-60">{item.label}</p>
                    <p className="text-sm font-bold mt-0.5">{item.value}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{item.tooltip}</p>
                </TooltipContent>
              </UITooltip>
            ))}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  )
}

// Recent Change Summary & Attention Points with Disclaimer
function RecentChangeSummaryCard({ patient }: { patient: Patient }) {
  // Generate recent changes based on patient data
  const recentChanges = [
    patient.numericTrajectory?.axes.find(a => a.axis === "respiratory")?.change === "up" &&
    "산소 요구량 증가 추세",
    patient.numericTrajectory?.axes.find(a => a.axis === "infection")?.change === "up" &&
    "염증수치 상승 중",
    (patient.lactate ?? 0) > 2 && "Lactate 상승",
    patient.status === "critical" && "중증도 위급 상태",
  ].filter(Boolean)

  const attentionPoints = [
    patient.status === "critical" && "6시간 내 재평가 필요",
    patient.mdroStatus?.isMDRO && !patient.mdroStatus.isolationImplemented && "격리 조치 미시행",
    (patient.qsofa ?? 0) >= 2 && "패혈증 진행 가능성 - Sepsis 6 확인",
    patient.cultureResults?.some(c => c.result === "pending") && "배양 결과 대기 중",
  ].filter(Boolean)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Recent Change Summary & Attention Points
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4">
          {/* Recent Changes */}
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">최근 변화 (자동 생성)</p>
            {recentChanges.length > 0 ? (
              <ul className="space-y-1.5">
                {recentChanges.map((change, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <ArrowUp className="h-3 w-3 text-[#ef4444]" />
                    {change}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">특이 변화 없음</p>
            )}
          </div>

          {/* Attention Points */}
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <p className="text-xs font-medium text-muted-foreground mb-2">검토 포인트</p>
            {attentionPoints.length > 0 ? (
              <ul className="space-y-1.5">
                {attentionPoints.map((point, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3 w-3 text-[#f59e0b]" />
                    {point}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">특이 검토 사항 없음</p>
            )}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="flex items-start gap-2 p-2 rounded bg-muted/30 border border-border">
          <Info className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[10px] text-muted-foreground">
            본 항목은 최근 문서 기반 변화 요약이며, 임상 판단을 대체하지 않습니다.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// Fusion Alerts as Event Cards
function FusionAlertCards({ alerts }: { alerts: NonNullable<Patient["fusedAlerts"]> }) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical": return "border-[#ef4444] bg-white"
      case "high": return "border-[#f59e0b] bg-white"
      case "medium": return "border-[#3b82f6] bg-white"
      default: return "border-border bg-white"
    }
  }

  const getPriorityTextColor = (priority: string) => {
    switch (priority) {
      case "critical": return "text-[#ef4444]"
      case "high": return "text-[#f59e0b]"
      case "medium": return "text-[#3b82f6]"
      default: return "text-foreground"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#ef4444]" />
          융합 알림
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          서로 다른 축에서 동시에 변화가 발생해, 놓치면 위험할 가능성이 높아진 상태
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "p-3 rounded-lg border-2 transition-all hover:shadow-md",
                getPriorityColor(alert.priority)
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <h4 className={cn("text-sm font-bold", getPriorityTextColor(alert.priority))}>
                  {alert.title}
                </h4>
                <Badge variant="outline" className={cn("text-[9px]", getPriorityTextColor(alert.priority))}>
                  {alert.category}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{alert.evidenceSnippet}</p>
              {alert.actionRequired && (
                <div className="flex items-center gap-1 text-[10px] text-foreground">
                  <ArrowRight className="h-3 w-3" />
                  {alert.actionRequired}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Vital Trend Chart Component
function VitalTrendChart({
  title, data, currentValue, unit, thresholdHigh, thresholdLow, thresholdLabel, color
}: {
  title: string
  data: { time: string; value: number }[]
  currentValue: number
  unit: string
  thresholdHigh: number
  thresholdLow: number
  thresholdLabel: string
  color: string
}) {
  const isAboveNormal = currentValue > thresholdHigh
  const isBelowNormal = currentValue < thresholdLow
  const isAbnormal = isAboveNormal || isBelowNormal
  const abnormalColor = isAboveNormal ? "#ef4444" : "#3b82f6"

  return (
    <Card className="bg-card border-border hover:shadow-lg transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
          <div className="flex items-center gap-1">
            <span className={cn("text-2xl font-bold", isAbnormal ? (isAboveNormal ? "text-[#ef4444]" : "text-[#3b82f6]") : "text-foreground")}>
              {currentValue}
            </span>
            <span className="text-sm text-muted-foreground">{unit}</span>
            {isAboveNormal && <ArrowUp className="h-4 w-4 text-[#ef4444]" />}
            {isBelowNormal && <ArrowDown className="h-4 w-4 text-[#3b82f6]" />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis
                dataKey="time"
                tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px"
                }}
              />
              <ReferenceLine
                y={thresholdLow}
                stroke={color}
                strokeDasharray="5 5"
                label={{ value: thresholdLabel, fill: color, fontSize: 9 }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={isAbnormal ? abnormalColor : "var(--primary)"}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: isAbnormal ? abnormalColor : "var(--primary)" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {isAbnormal && (
          <p className={cn("text-[10px] mt-2 flex items-center gap-1", isAboveNormal ? "text-[#ef4444]" : "text-[#3b82f6]")}>
            {isAboveNormal ? <ArrowUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isAboveNormal ? "정상범위 이상" : "정상범위 이하"}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Dual Axis Chart for RR + Lactate
function DualAxisChart({
  title, rrData, currentRR, currentLactate
}: {
  title: string
  rrData: { time: string; rr: number; lactate: number }[]
  currentRR: number
  currentLactate: number
}) {
  return (
    <Card className="bg-card border-border hover:shadow-lg transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className={cn("text-lg font-bold", currentRR > 22 ? "text-[#ef4444]" : currentRR < 12 ? "text-[#3b82f6]" : "text-foreground")}>
                RR {currentRR}
              </span>
              {currentRR > 22 && <ArrowUp className="h-3 w-3 text-[#ef4444]" />}
              {currentRR < 12 && <ArrowDown className="h-3 w-3 text-[#3b82f6]" />}
            </div>
            <div className="flex items-center gap-1">
              <span className={cn("text-lg font-bold", currentLactate > 2 ? "text-[#ef4444]" : "text-foreground")}>
                Lac {currentLactate}
              </span>
              {currentLactate > 2 && <ArrowUp className="h-3 w-3 text-[#ef4444]" />}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rrData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis
                dataKey="time"
                tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px"
                }}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="rr"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                name="RR"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="lactate"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
                name="Lactate"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// Action Candidates / Review Checklist / Considerations for Trajectory Tab
function ActionCandidatesCard({ patient }: { patient: Patient }) {
  const actionItems = patient.severityAssessment?.recommendedActions || []

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Action Candidates / Review Checklist
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">확인 여부 중심</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {actionItems.length > 0 ? (
            actionItems.map((item, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-center justify-between p-2 rounded-lg border",
                  item.completed ? "bg-[#10b981]/10 border-[#10b981]/30" : "bg-background border-border"
                )}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={cn(
                    "h-4 w-4",
                    item.completed ? "text-[#10b981]" : "text-muted-foreground"
                  )} />
                  <span className="text-xs">{item.action}</span>
                </div>
                <Badge variant="outline" className={cn(
                  "text-[9px]",
                  item.priority === "immediate" ? "border-[#ef4444] text-[#ef4444]" :
                    item.priority === "urgent" ? "border-[#f59e0b] text-[#f59e0b]" :
                      "border-muted-foreground text-muted-foreground"
                )}>
                  {item.priority}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">권장 조치 없음</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Guideline Panel for Guideline Tab
function GuidelinePanel({ patient }: { patient: Patient }) {
  const primaryDiagnosis = patient.diagnosis.split("+")[0].trim()

  const guidelines = [
    {
      title: "초기 평가 및 안정화",
      items: [
        "활력징후 모니터링 (15분 간격)",
        "산소포화도 95% 이상 유지 목표",
        "정맥로 확보 및 ��액 치료 시작",
        "필요 시 산소 투여 (비강 캐뉼라 시작)"
      ]
    },
    {
      title: "검사 및 평가",
      items: [
        "CBC, Chemistry, 혈액가스분석",
        "Procalcitonin, CRP 등 염증지표",
        "혈액/객담/소변 배양검사",
        "흉부 X-ray (필요 시 CT)"
      ]
    },
    {
      title: "치료 프로토콜",
      items: [
        primaryDiagnosis.includes("폐렴") ? "경험적 항생제: Ceftriaxone + Azithromycin" : "원인균에 따른 항생제 선택",
        "수액 요법: 30mL/kg crystalloid (패혈증 시)",
        "산소 요법: SpO2 92-96% 목표",
        "필요 시 승압제 고려 (Norepinephrine)"
      ]
    },
    {
      title: "전원 기준",
      items: [
        "HFNC/NIV 필요하나 장비 부족",
        "6-12시간 내 악화 대응 인력 부족",
        "중환자실 관리 필요",
        "전문 시술/수술 필요"
      ]
    }
  ]

  const riskBannerByStatus: Record<
    Patient["status"],
    { label: string; color: string; description: string }
  > = {
    critical: { label: "고위험", color: "bg-[#ef4444]", description: "즉시 전원 또는 ICU 평가 필요" },
    warning: { label: "중등도 위험", color: "bg-[#f59e0b]", description: "면밀한 모니터링 필요" },
    stable: { label: "저위험", color: "bg-[#10b981]", description: "현 병원에서 관리 가능" },
    transferred: { label: "전원 완료", color: "bg-gray-500", description: "해당 환자는 이미 전원되었습니다" },
  }
  const riskBanner = riskBannerByStatus[patient.status]

  return (
    <div className="space-y-4">
      {/* Note about patient selection */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border">
        <p className="text-[10px] text-muted-foreground">
          다른 환자를 클릭하면 원래 클릭됐던 항목이 rollback됩니다
        </p>
      </div>

      {/* Disease-specific guideline header */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium text-foreground">
              &apos;{primaryDiagnosis}&apos; 확진 환자 가이드라인
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Risk Banner */}
      <Card className={cn("border-2",
        patient.status === "critical" ? "border-[#ef4444] bg-[#ef4444]/5" :
          patient.status === "warning" ? "border-[#f59e0b] bg-[#f59e0b]/5" :
            "border-[#10b981] bg-[#10b981]/5"
      )}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className={cn("h-5 w-5",
                patient.status === "critical" ? "text-[#ef4444]" :
                  patient.status === "warning" ? "text-[#f59e0b]" :
                    "text-[#10b981]"
              )} />
              <div>
                <Badge className={cn("text-white", riskBanner.color)}>
                  {riskBanner.label}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">{riskBanner.description}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">CURB-65</p>
              <p className="text-lg font-bold">{patient.curb65 ?? 0}점</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Guideline Sections - All white boxes */}
      <div className="grid grid-cols-2 gap-4">
        {guidelines.map((section, idx) => (
          <Card key={idx} className="bg-white border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {section.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
