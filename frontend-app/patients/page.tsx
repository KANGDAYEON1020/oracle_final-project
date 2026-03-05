"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Download, Printer, ChevronLeft, ChevronRight, Filter, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

// Layout Components
import { AppSidebar, SidebarPage } from "@/components/dashboard/app-sidebar"
import { V1Header } from "@/components/dashboard/v1-header"
import { HeaderSearch } from "@/components/dashboard/header-search"
import { WardSwitcher } from "@/components/dashboard/ward-switcher"
import { NotificationProvider } from "@/lib/notification-context"
import { usePatients } from "@/lib/hooks/use-patients"
import { SettingsProvider, useSettings } from "@/lib/settings-context"
import { HeaderTicker } from "@/components/clinical/notification-overlays"
import type { Patient } from "@/lib/types"

// --- Helpers to derive display fields from Patient ---

type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "warning" | "purple"

function getDisplayStatus(p: Patient): Patient["status"] {
    return p.statusAtDemo ?? p.status
}

function deriveStatusBadges(p: Patient): { label: string; variant: BadgeVariant }[] {
    const badges: { label: string; variant: BadgeVariant }[] = []

    // MDRO
    if (p.mdroStatus?.isMDRO) {
        badges.push({ label: p.mdroStatus.mdroType || "MDRO", variant: "purple" })
    }
    if (p.mdroStatus?.isolationRequired && !p.mdroStatus.isolationImplemented) {
        badges.push({ label: "Isolation Gap", variant: "warning" })
    }

    // NLP alert tags
    ; (p.nlpAlertTags || []).forEach(tag => {
        let variant: BadgeVariant = "secondary"
        if (tag.label.includes("MDRO") || tag.label.includes("내성")) variant = "purple"
        else if (tag.trajectory === "worsening") variant = "destructive"
        else if (tag.type === "uncertainty") variant = "warning"

        const dup = badges.some(b => b.label === tag.label)
        if (!dup) badges.push({ label: tag.label, variant })
    })

    // Fallback badge from status
    if (badges.length === 0) {
        const status = getDisplayStatus(p)
        if (status === "critical") badges.push({ label: "Critical", variant: "destructive" })
        else if (status === "warning") badges.push({ label: "Warning", variant: "warning" })
        else badges.push({ label: "Stable", variant: "outline" })
    }

    return badges
}

type RiskLevel = "Critical" | "High" | "Moderate" | "Stable" | "Low"
type SortField = "patientId" | "riskLevel" | "sepsisRisk" | "admissionDate"
type SortDirection = "asc" | "desc"
type TrajectorySeverity = "critical" | "high" | "medium" | "low" | "info"

function deriveRiskLevel(p: Patient): RiskLevel {
    if (p.riskLevelAtDemo) return p.riskLevelAtDemo
    const status = getDisplayStatus(p)
    if (status === "critical") return "Critical"
    if (status === "warning") return "High"
    const score = p.riskScore ?? 0
    if (score >= 0.6) return "Moderate"
    if (score >= 0.3) return "Stable"
    return "Low"
}

type SepsisDisplayRisk = "High" | "Moderate" | "Low" | "N/A"

function deriveSepsisRisk(p: Patient): { risk: SepsisDisplayRisk; score?: number } {
    const rs = p.riskScore ?? p.sepsisExplanation?.riskScore
    if (rs == null) return { risk: "N/A", score: undefined }
    if (rs >= 0.6) return { risk: "High", score: rs }
    if (rs >= 0.3) return { risk: "Moderate", score: rs }
    return { risk: "Low", score: rs }
}

function formatAdmDate(p: Patient): string {
    const dateStr = p.admittedAtDemo ?? p.simAdmitDate ?? p.admissionDate
    if (!dateStr) return "-"
    const d = new Date(dateStr)
    return `Admitted: ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
}

function deriveHdDay(p: Patient): number {
    if (p.currentHdAtDemo && Number.isFinite(p.currentHdAtDemo)) return p.currentHdAtDemo
    if (p.currentHd && Number.isFinite(p.currentHd)) return p.currentHd
    if (!p.admissionDate) return 1
    const diff = Date.now() - new Date(p.admissionDate).getTime()
    return Math.max(1, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

function getRiskSortValue(p: Patient): number {
    const level = deriveRiskLevel(p)
    const levelRank: Record<RiskLevel, number> = {
        Critical: 5,
        High: 4,
        Moderate: 3,
        Stable: 2,
        Low: 1,
    }
    return levelRank[level] + (p.riskScore ?? 0) / 100
}

function getSepsisSortValue(p: Patient): number {
    const sepsis = deriveSepsisRisk(p)
    const riskRank: Record<SepsisDisplayRisk, number> = {
        High: 3,
        Moderate: 2,
        Low: 1,
        "N/A": 0,
    }
    return riskRank[sepsis.risk] + ((sepsis.score ?? 0))
}

function getAdmissionTimestamp(p: Patient): number | null {
    const admittedAt = p.admittedAtDemo ?? p.simAdmitDate ?? p.admissionDate
    if (!admittedAt) return null
    const ts = new Date(admittedAt).getTime()
    return Number.isNaN(ts) ? null : ts
}

function severityToTrendScore(severity: TrajectorySeverity | null | undefined): number | null {
    if (severity === "critical") return 100
    if (severity === "high") return 80
    if (severity === "medium") return 60
    if (severity === "low") return 40
    if (severity === "info") return 20
    return null
}

function deriveRiskSparklineData(p: Patient): number[] {
    const trendScores = (p.trajectoryRisk?.riskTrend || [])
        .map(point => Number(point.score))
        .filter(score => Number.isFinite(score))

    if (trendScores.length >= 2) {
        return trendScores
    }

    if (trendScores.length === 1) {
        return [trendScores[0], trendScores[0]]
    }

    const severityFallback = severityToTrendScore(p.trajectoryRisk?.latestSeverity || p.trajectoryRisk?.maxSeverity)
    if (severityFallback != null) {
        return [severityFallback, severityFallback]
    }

    const riskScore = typeof p.riskScore === "number" && Number.isFinite(p.riskScore) ? p.riskScore : 0
    const normalized = Math.max(0, Math.min(100, Math.round(riskScore * 100)))
    return [normalized, normalized]
}

function getRiskPalette(riskLevel: RiskLevel): {
    pill: string
    bar: string
} {
    switch (riskLevel) {
        case "Critical":
            return {
                pill: "bg-rose-100 text-rose-700 border-rose-200",
                bar: "bg-rose-500",
            }
        case "High":
            return {
                pill: "bg-orange-100 text-orange-700 border-orange-200",
                bar: "bg-orange-500",
            }
        case "Moderate":
            return {
                pill: "bg-amber-100 text-amber-700 border-amber-200",
                bar: "bg-amber-500",
            }
        case "Stable":
            return {
                pill: "bg-sky-100 text-sky-700 border-sky-200",
                bar: "bg-sky-500",
            }
        default:
            return {
                pill: "bg-emerald-100 text-emerald-700 border-emerald-200",
                bar: "bg-emerald-500",
            }
    }
}

// --- Components ---

function SimpleSparkline({ data, color }: { data: number[], color: string }) {
    const WIDTH = 72
    const HEIGHT = 24
    const normalizedData = data.length >= 2 ? data : [data[0] ?? 0, data[0] ?? 0]
    const max = Math.max(...normalizedData, 100)
    const min = Math.min(...normalizedData, 0)
    const range = Math.max(1, max - min)

    const points = normalizedData.map((d, i) => {
        const x = (i / (normalizedData.length - 1)) * WIDTH
        const rawY = HEIGHT - ((d - min) / range) * HEIGHT
        const y = Math.max(0, Math.min(HEIGHT, rawY))
        return `${x},${y}`
    }).join(" ")

    return (
        <svg
            width={WIDTH}
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="block overflow-hidden"
        >
            <polyline
                fill="none"
                stroke={color}
                strokeWidth="2"
                points={points}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
    )
}

function SepsisRiskBadge({ risk, score }: { risk: string, score?: number }) {
    let colorClass = "bg-slate-100 text-slate-700 border-slate-200"
    if (risk === "High") colorClass = "bg-rose-100 text-rose-700 border-rose-200"
    if (risk === "Moderate") colorClass = "bg-amber-100 text-amber-700 border-amber-200"
    if (risk === "Low") colorClass = "bg-emerald-100 text-emerald-700 border-emerald-200"

    return (
        <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold ${colorClass}`}>
            <span>{risk}</span>
            {score !== undefined && (
                <span className="opacity-75 font-normal text-[10px] ml-1 border-l pl-1 border-current">
                    {(score * 100).toFixed(0)}%
                </span>
            )}
        </div>
    )
}

function TabletRiskIndicator({ riskLevel, riskScore }: { riskLevel: RiskLevel; riskScore: number }) {
    const palette = getRiskPalette(riskLevel)
    const normalizedScore = Math.max(0, Math.min(100, Math.round(riskScore * 100)))
    const barWidth = Math.max(12, normalizedScore)

    return (
        <div className="flex flex-col items-end gap-1.5 w-full min-w-[92px]">
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold", palette.pill)}>
                {riskLevel}
            </span>
            <div className="w-full max-w-[96px]">
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className={cn("h-full rounded-full", palette.bar)} style={{ width: `${barWidth}%` }} />
                </div>
                <span className="mt-1 block text-right text-[10px] text-slate-500">
                    score {normalizedScore}
                </span>
            </div>
        </div>
    )
}

function TabletSepsisIndicator({ risk, score }: { risk: SepsisDisplayRisk; score?: number }) {
    let colorClass = "bg-slate-100 text-slate-700 border-slate-200"
    if (risk === "High") colorClass = "bg-rose-100 text-rose-700 border-rose-200"
    if (risk === "Moderate") colorClass = "bg-amber-100 text-amber-700 border-amber-200"
    if (risk === "Low") colorClass = "bg-emerald-100 text-emerald-700 border-emerald-200"

    return (
        <div className="flex flex-col items-end gap-1 min-w-[84px]">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colorClass}`}>
                {risk}
            </span>
            {score !== undefined ? (
                <span className="text-[10px] text-slate-500">{(score * 100).toFixed(0)}%</span>
            ) : (
                <span className="text-[10px] text-slate-400">-</span>
            )}
        </div>
    )
}

function PatientListContent({ patients, loading }: { patients: Patient[]; loading: boolean }) {
    const router = useRouter()
    const [filter, setFilter] = useState("All Patients")
    const [searchQuery, setSearchQuery] = useState("")
    const [isFilterExpanded, setIsFilterExpanded] = useState(false)
    const [currentPage, setCurrentPage] = useState(1)
    const [isTabletViewport, setIsTabletViewport] = useState(false)
    const [sortField, setSortField] = useState<SortField>("patientId")
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
    const filters = ["All Patients", "Deterioration", "Infection Suspected", "Care Gaps", "Isolation/MDRO", "Pending Labs"]
    const { showTicker } = useSettings()
    const PAGE_SIZE = isTabletViewport ? 10 : 7

    useEffect(() => {
        // iPad Pro 11" CSS viewport 기준: 834x1194 (portrait) / 1194x834 (landscape)
        // width+height 범위를 모두 제한해 iPad 클래스 뷰포트에서만 tablet UX를 적용한다.
        const mediaQuery = window.matchMedia(
            "(min-width: 834px) and (max-width: 1194px) and (min-height: 834px) and (max-height: 1194px)"
        )
        const updateViewport = () => setIsTabletViewport(mediaQuery.matches)
        updateViewport()

        mediaQuery.addEventListener("change", updateViewport)
        return () => mediaQuery.removeEventListener("change", updateViewport)
    }, [])

    const filteredPatients = useMemo(() => {
        let list = patients

        // Search filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            list = list.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.id.toLowerCase().includes(q) ||
                (p.roomNumber || "").toLowerCase().includes(q) ||
                (p.ward || "").toLowerCase().includes(q)
            )
        }

        // Category filter
        if (filter === "Isolation/MDRO") {
            list = list.filter(p => p.mdroStatus?.isMDRO)
        } else if (filter === "Deterioration") {
            list = list.filter(p => {
                const status = getDisplayStatus(p)
                return status === "critical" || status === "warning"
            })
        } else if (filter === "Infection Suspected") {
            list = list.filter(p => {
                const status = getDisplayStatus(p)
                return status === "critical" || (p.riskScore != null && p.riskScore >= 0.3)
            })
        } else if (filter === "Care Gaps") {
            list = list.filter(p => p.hasCareGapSignal === true)
        } else if (filter === "Pending Labs") {
            list = list.filter(p => p.hasPendingLabSignal === true)
        }

        return list
    }, [patients, filter, searchQuery])

    const sortedPatients = useMemo(() => {
        const list = [...filteredPatients]

        list.sort((a, b) => {
            let cmp = 0

            if (sortField === "patientId") {
                cmp = a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" })
            } else if (sortField === "riskLevel") {
                cmp = getRiskSortValue(a) - getRiskSortValue(b)
            } else if (sortField === "sepsisRisk") {
                cmp = getSepsisSortValue(a) - getSepsisSortValue(b)
            } else if (sortField === "admissionDate") {
                const aTs = getAdmissionTimestamp(a)
                const bTs = getAdmissionTimestamp(b)
                if (aTs == null && bTs == null) cmp = 0
                else if (aTs == null) cmp = 1
                else if (bTs == null) cmp = -1
                else cmp = aTs - bTs
            }

            return sortDirection === "asc" ? cmp : -cmp
        })

        return list
    }, [filteredPatients, sortField, sortDirection])

    useEffect(() => {
        setCurrentPage(1)
    }, [filter, searchQuery, sortField, sortDirection, PAGE_SIZE])

    const totalPages = Math.max(1, Math.ceil(sortedPatients.length / PAGE_SIZE))

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages)
        }
    }, [currentPage, totalPages])

    const paginatedPatients = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE
        return sortedPatients.slice(start, start + PAGE_SIZE)
    }, [sortedPatients, currentPage, PAGE_SIZE])

    const pageStart = sortedPatients.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
    const pageEnd = Math.min(currentPage * PAGE_SIZE, sortedPatients.length)

    return (
        <div className="flex flex-col h-full">
            <V1Header
                title="Patient Census"
                titleControls={<WardSwitcher />}
                rightContent={<HeaderSearch placeholder="Search by name, ID, or bed..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />}
            />
            {showTicker && <HeaderTicker />}

            <main className="flex-1 min-h-0 overflow-hidden p-0 md:p-6 bg-slate-50/50">
                <div className="flex h-full flex-col">
                    {/* Main Content Card */}
                    <Card className="flex-1 min-h-0 flex flex-col shadow-none md:shadow-sm border-0 md:border border-slate-200 bg-white overflow-hidden rounded-none md:rounded-xl">
                        {/* Toolbar */}
                        <div className="p-2 md:p-4 border-b flex flex-col gap-4 bg-white sticky top-0 z-10">
                            <div className="flex flex-row items-center justify-between gap-2 w-full">
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                                        className="text-muted-foreground hover:text-foreground p-0 hover:bg-transparent"
                                    >
                                        <Filter className="w-4 h-4 mr-2" />
                                        <span className="text-xs font-semibold uppercase tracking-wider">Filter</span>
                                        <ChevronDown className={cn("ml-1 h-4 w-4 transition-transform duration-200", isFilterExpanded && "rotate-180")} />
                                    </Button>
                                </div>

                                <div className="flex items-center gap-2 ml-auto">
                                    <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                                        <SelectTrigger size="sm" className="h-8 w-[100px] text-xs">
                                            <SelectValue placeholder="정렬 기준" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="patientId">환자번호</SelectItem>
                                            <SelectItem value="riskLevel">위험도</SelectItem>
                                            <SelectItem value="sepsisRisk">패혈증 위험</SelectItem>
                                            <SelectItem value="admissionDate">입원일</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={sortDirection} onValueChange={(v) => setSortDirection(v as SortDirection)}>
                                        <SelectTrigger size="sm" className="h-8 w-[80px] text-xs">
                                            <SelectValue placeholder="정렬 방향" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="asc">오름차순</SelectItem>
                                            <SelectItem value="desc">내림차순</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:bg-slate-100 hidden sm:inline-flex">
                                        <Download className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:bg-slate-100 hidden sm:inline-flex">
                                        <Printer className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            {/* Collapsible Filters */}
                            {isFilterExpanded && (
                                <div className="flex items-center gap-2 flex-wrap pt-2 animate-in slide-in-from-top-2 duration-200">
                                    {filters.map(f => (
                                        <Button
                                            key={f}
                                            variant={filter === f ? "default" : "outline"}
                                            size="sm"
                                            onClick={() => setFilter(f)}
                                            className={`rounded-full text-xs h-7 px-3 ${filter === f ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"}`}
                                        >
                                            {f}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Table */}
                        <div className="flex-1 overflow-auto">
                            {loading ? (
                                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                                    Loading patients...
                                </div>
                            ) : sortedPatients.length === 0 ? (
                                <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                                    No patients found.
                                </div>
                            ) : (
                                <Table className="table-fixed">
                                    <TableHeader className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
                                        <TableRow className="hover:bg-transparent border-slate-200">
                                            <TableHead className="hidden md:table-cell w-[132px] min-w-[132px] font-semibold text-xs uppercase tracking-wider text-slate-500 pl-6 pr-4">ID</TableHead>
                                            <TableHead className="w-auto md:w-[20%] font-semibold text-xs uppercase tracking-wider text-slate-500">
                                                환자
                                            </TableHead>
                                            <TableHead className="w-auto md:w-[13%] font-semibold text-xs uppercase tracking-wider text-slate-500">
                                                병동 / 병상
                                            </TableHead>
                                            <TableHead className="hidden md:table-cell w-[18%] font-semibold text-xs uppercase tracking-wider text-slate-500">
                                                진단명 / 입원일
                                            </TableHead>
                                            <TableHead className="w-auto md:w-[20%] font-semibold text-xs uppercase tracking-wider text-slate-500">
                                                상태 지표
                                            </TableHead>
                                            <TableHead className="hidden md:table-cell w-[12%] xl:w-[10%] font-semibold text-xs uppercase tracking-wider text-slate-500">
                                                위험도
                                            </TableHead>
                                            <TableHead className="w-auto md:w-[14%] xl:w-[12%] font-semibold text-xs uppercase tracking-wider text-slate-500 text-right pr-6">
                                                패혈증 위험
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedPatients.map((patient, index) => {
                                            const badges = deriveStatusBadges(patient)
                                            const riskLevel = deriveRiskLevel(patient)
                                            const sepsis = deriveSepsisRisk(patient)
                                            const hdDay = deriveHdDay(patient)
                                            const riskScore = patient.riskScore ?? 0
                                            const sparkData = deriveRiskSparklineData(patient)

                                            return (
                                                <TableRow
                                                    key={`${patient.id}-${index}`}
                                                    className="hover:bg-slate-50/50 border-slate-100 transition-colors cursor-pointer group"
                                                    onClick={() => router.push(`/patients/${patient.id}`)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault()
                                                            router.push(`/patients/${patient.id}`)
                                                        }
                                                    }}
                                                    tabIndex={0}
                                                >
                                                    <TableCell className="hidden md:table-cell font-medium text-slate-500 pl-6 pr-4 align-top py-3">
                                                        <span className="block whitespace-nowrap">{patient.id}</span>
                                                    </TableCell>
                                                    <TableCell className="align-top py-3 pl-4">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                                                                {patient.name}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                                {patient.age}{patient.gender} • Day {hdDay}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="align-top py-3">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="font-medium text-slate-800 truncate">{patient.ward || "-"}</span>
                                                            <span className="text-xs text-muted-foreground truncate">{patient.roomNumber || "-"}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="hidden md:table-cell align-top py-3">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span
                                                                className="block max-w-full truncate font-medium text-slate-800"
                                                                title={patient.diagnosis || "-"}
                                                            >
                                                                {patient.diagnosis || "-"}
                                                            </span>
                                                            <span className="text-xs text-muted-foreground truncate">{formatAdmDate(patient)}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="align-top py-3">
                                                        <div className="flex flex-wrap gap-1.5 items-start max-w-full">
                                                            {badges.map((badge, idx) => {
                                                                let colorClass = ""
                                                                if (badge.variant === "warning") colorClass = "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100"
                                                                else if (badge.variant === "destructive") colorClass = "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                                                                else if (badge.variant === "purple") colorClass = "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
                                                                else if (badge.variant === "outline") colorClass = "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                                                else colorClass = "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"

                                                                return (
                                                                    <Badge
                                                                        key={idx}
                                                                        variant={badge.variant as any}
                                                                        className={`max-w-full truncate font-medium text-[11px] px-2 py-0.5 rounded-md border shadow-sm ${colorClass}`}
                                                                        title={badge.label}
                                                                    >
                                                                        {badge.label}
                                                                    </Badge>
                                                                )
                                                            })}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="hidden md:table-cell align-top py-3">
                                                        {isTabletViewport ? (
                                                            <TabletRiskIndicator riskLevel={riskLevel} riskScore={riskScore} />
                                                        ) : (
                                                            <div className="flex flex-col items-center gap-1 w-full max-w-[80px]">
                                                                <SimpleSparkline
                                                                    data={sparkData}
                                                                    color={
                                                                        riskLevel === "Critical" ? "#ef4444" :
                                                                            riskLevel === "High" ? "#f97316" :
                                                                                riskLevel === "Moderate" ? "#64748b" :
                                                                                    "#10b981"
                                                                    }
                                                                />
                                                                <span className={`text-[10px] font-semibold
                                                ${riskLevel === "Critical" ? "text-rose-600" :
                                                                        riskLevel === "High" ? "text-orange-600" :
                                                                            riskLevel === "Moderate" ? "text-slate-600" : "text-emerald-600"}
                                            `}>
                                                                    {riskLevel}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="align-top py-3 text-right pr-6">
                                                        <div className="flex justify-end">
                                                            {isTabletViewport ? (
                                                                <TabletSepsisIndicator risk={sepsis.risk} score={sepsis.score} />
                                                            ) : (
                                                                <SepsisRiskBadge risk={sepsis.risk} score={sepsis.score} />
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </div>

                        {/* Pagination Footer */}
                        <div className="p-2 md:p-4 border-t bg-slate-50/50 flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                                총 <strong>{sortedPatients.length}</strong>명 중 <strong>{pageStart}-{pageEnd}</strong> 표시
                            </span>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2"
                                    disabled={currentPage === 1}
                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                    이전
                                </Button>
                                <span className="min-w-[72px] text-center">
                                    {currentPage} / {totalPages} 페이지
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2"
                                    disabled={currentPage === totalPages}
                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                >
                                    다음
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>
            </main>
        </div>
    )
}

import { BottomNav } from "@/components/dashboard/bottom-nav"

// ... imports ...

export default function PatientListPage() {
    const router = useRouter()
    const { patients, loading } = usePatients()

    const handleNavigate = useCallback((page: SidebarPage) => {
        if (page === 'pc') {
            router.push('/')
        } else if (page === 'infection') {
            router.push('/?view=infection')
        } else if (page === 'transfer') {
            router.push('/patients')
        } else if (page === 'report') {
            router.push('/bed-allocation')
        } else if (page === 'isolation') {
            router.push('/isolation-checklist')
        } else if (page === 'transferChecklist') {
            router.push('/transfer-checklist')
        }
    }, [router])

    return (
        <SettingsProvider>
            <NotificationProvider patients={patients} onNavigateToPatient={() => { }}>
                <div className="flex h-dvh overflow-hidden bg-background flex-col md:flex-row">
                    <div className="hidden xl:flex h-full">
                        <AppSidebar
                            currentPage="transfer"
                            onNavigate={handleNavigate}
                        />
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden pb-16 xl:pb-0">
                        <PatientListContent patients={patients} loading={loading} />
                    </div>
                    <div className="xl:hidden fixed bottom-0 left-0 right-0 z-50">
                        <BottomNav
                            currentPage="transfer"
                            onNavigate={handleNavigate}
                        />
                    </div>
                </div>
            </NotificationProvider>
        </SettingsProvider>
    )
}
