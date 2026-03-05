"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import html2canvas from "html2canvas"
import jsPDF from "jspdf"
import { KpiCard } from "@/components/dashboard/kpi-card"
import {
    InfectionTypeChart,
    INFECTION_TYPES,
    type InfectionTypeDatum,
    type InfectionTypeName,
} from "@/components/dashboard/infection-type-chart"
import { WeeklyTrendChart, MonthlyTrendChart, type DiseaseTrend } from "@/components/dashboard/trend-charts"
import { MdroPanel } from "@/components/dashboard/mdro-panel"
import { ActionSummary } from "@/components/dashboard/action-summary"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { fetchPatients } from "@/lib/api"
import { useDemoClock } from "@/lib/demo-clock-context"
import { listGapMetrics } from "@/lib/mdro-checklist-service"
import type { Patient } from "@/lib/types"
import {
    ShieldAlert,
    Activity,
    AlertTriangle,
    ArrowRightLeft,
    Calendar,
    Download,
} from "lucide-react"

const DATE_RANGE_OPTIONS = [
    { value: "Last 7 days", mobileLabel: "7일", desktopLabel: "Last 7 days", days: 7 },
    { value: "Last 1 month", mobileLabel: "1개월", desktopLabel: "Last 1 month", days: 30 },
    { value: "Last 3 months", mobileLabel: "3개월", desktopLabel: "Last 3 months", days: 90 },
] as const

type DateRangeValue = (typeof DATE_RANGE_OPTIONS)[number]["value"]

interface InfectionDashboardProps {
    onNavigateToPatients?: () => void
    showPageTitle?: boolean
}

interface PatientDerivedStats {
    mdroPatients: number
    isolationGapCases: number
    infectionTransfers: number
}

function resolvePatientInfectionType(patient: Patient): InfectionTypeName {
    const infectionCode =
        (patient as Patient & { infection?: string | null }).infection ??
        (patient as Patient & { infection_type?: string | null }).infection_type ??
        null

    if (!infectionCode) return "Others"

    const prefix = infectionCode.charAt(0).toUpperCase()
    if (prefix === "P") return "Pneumonia"
    if (prefix === "G") return "GI"
    if (prefix === "U") return "UTI"
    if (prefix === "T") return "Tickborne"
    return "Others"
}

function aggregateInfectionTypeData(patients: Patient[]): InfectionTypeDatum[] {
    const counts: Partial<Record<InfectionTypeName, number>> = {}
    for (const patient of patients) {
        const type = resolvePatientInfectionType(patient)
        counts[type] = (counts[type] || 0) + 1
    }

    return INFECTION_TYPES.map(({ name, nameKo }) => ({
        name,
        nameKo,
        value: counts[name] || 0,
    }))
}

function pickTopDisease(data: InfectionTypeDatum[]): DiseaseTrend | null {
    const top = [...data].sort((a, b) => b.value - a.value)[0]
    if (!top || top.value <= 0) return null
    return {
        name: top.name,
        current: top.value,
        previous: 0,
        growthRate: 0,
        sparkline: [],
    }
}

function trendDirection(deltaRate: number | null | undefined): "up" | "down" | "flat" {
    if (deltaRate == null || !Number.isFinite(deltaRate) || deltaRate === 0) return "flat"
    return deltaRate > 0 ? "up" : "down"
}

function formatDelta(deltaRate: number | null | undefined): string {
    if (deltaRate == null || !Number.isFinite(deltaRate)) return "N/A"
    const rounded = Math.round(deltaRate * 10) / 10
    return `${rounded > 0 ? "+" : ""}${rounded}%`
}

function formatGapThresholdRatio(ratio: number): string {
    if (!Number.isFinite(ratio) || ratio < 0) return "N/A"
    const asPercent = Math.round(ratio * 1000) / 10
    return `${asPercent}% ≥4h`
}

export function InfectionDashboard({ onNavigateToPatients, showPageTitle = true }: InfectionDashboardProps) {
    const [dateRange, setDateRange] = useState<DateRangeValue>("Last 7 days")
    const contentRef = useRef<HTMLDivElement>(null)
    const [isExporting, setIsExporting] = useState(false)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [summaryError, setSummaryError] = useState<string | null>(null)
    const [infectionTypeData, setInfectionTypeData] = useState<InfectionTypeDatum[]>(
        () => INFECTION_TYPES.map((type) => ({ ...type, value: 0 })),
    )
    const [previousMonitoringEvents, setPreviousMonitoringEvents] = useState<number | null>(null)
    const [patientStats, setPatientStats] = useState<PatientDerivedStats>({
        mdroPatients: 0,
        isolationGapCases: 0,
        infectionTransfers: 0,
    })
    const [gapMetricStats, setGapMetricStats] = useState<{
        openCases: number
        avgGapHours: number
        thresholdExceededCount: number
        thresholdExceededRatio: number
    } | null>(null)
    const { demoStep, demoShift } = useDemoClock()

    const goToPatients = () => onNavigateToPatients?.()

    const selectedDays = useMemo(() => {
        return DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.days ?? 7
    }, [dateRange])

    useEffect(() => {
        let cancelled = false

        const loadPatients = async () => {
            setSummaryLoading(true)
            setSummaryError(null)
            try {
                const prevDemoStep = Number.isFinite(demoStep) && demoStep > 1 ? demoStep - 1 : null
                const [patients, prevPatients] = await Promise.all([
                    fetchPatients({ demoStep, demoShift }),
                    prevDemoStep != null
                        ? fetchPatients({ demoStep: prevDemoStep, demoShift })
                        : Promise.resolve(null),
                ])
                if (cancelled) return

                const mdroPatients = patients.filter((patient) => patient?.mdroStatus?.isMDRO === true).length
                const isolationGapCases = patients.filter(
                    (patient) =>
                        patient?.mdroStatus?.isolationRequired === true &&
                        patient?.mdroStatus?.isolationImplemented === false
                ).length
                const infectionTransfers = patients.filter((patient) => patient?.status === "transferred").length
                const currentInfectionTypeData = aggregateInfectionTypeData(patients)
                const prevMonitoringTotal = prevPatients
                    ? aggregateInfectionTypeData(prevPatients).reduce((sum, item) => sum + item.value, 0)
                    : null

                setPatientStats({
                    mdroPatients,
                    isolationGapCases,
                    infectionTransfers,
                })
                setInfectionTypeData(currentInfectionTypeData)
                setPreviousMonitoringEvents(prevMonitoringTotal)
            } catch (error) {
                if (!cancelled) {
                    setPatientStats({ mdroPatients: 0, isolationGapCases: 0, infectionTransfers: 0 })
                    setInfectionTypeData(INFECTION_TYPES.map((type) => ({ ...type, value: 0 })))
                    setPreviousMonitoringEvents(null)
                    setSummaryError(error instanceof Error ? error.message : "병원 내부 환자 집계 실패")
                }
            } finally {
                if (!cancelled) {
                    setSummaryLoading(false)
                }
            }
        }

        void loadPatients()
        return () => {
            cancelled = true
        }
    }, [demoShift, demoStep])

    useEffect(() => {
        let cancelled = false

        const loadGapMetrics = async () => {
            try {
                const metrics = await listGapMetrics({
                    days: selectedDays,
                    thresholdHours: 4,
                    demoStep,
                    demoShift,
                })
                if (cancelled) return
                setGapMetricStats({
                    openCases: metrics.open_cases,
                    avgGapHours: metrics.avg_gap_hours,
                    thresholdExceededCount: metrics.threshold_exceeded_count,
                    thresholdExceededRatio: metrics.threshold_exceeded_ratio,
                })
            } catch {
                if (!cancelled) {
                    setGapMetricStats(null)
                }
            }
        }

        void loadGapMetrics()
        return () => {
            cancelled = true
        }
    }, [demoShift, demoStep, selectedDays])

    const monitoringEvents = useMemo(
        () => infectionTypeData.reduce((sum, item) => sum + item.value, 0),
        [infectionTypeData],
    )
    const latestDayCases = useMemo(
        () => (monitoringEvents > 0 ? Math.max(1, Math.round(monitoringEvents / Math.max(1, selectedDays))) : 0),
        [monitoringEvents, selectedDays],
    )
    const deltaRate = useMemo(() => {
        if (previousMonitoringEvents == null || previousMonitoringEvents <= 0) return null
        const raw = ((monitoringEvents - previousMonitoringEvents) / previousMonitoringEvents) * 100
        return Math.round(raw * 10) / 10
    }, [monitoringEvents, previousMonitoringEvents])
    const topDisease = useMemo(() => pickTopDisease(infectionTypeData), [infectionTypeData])
    const isolationGapValue = gapMetricStats?.openCases ?? patientStats.isolationGapCases
    const isolationGapTrend = (gapMetricStats?.thresholdExceededCount ?? 0) > 0 ? "up" : "flat"
    const isolationGapTrendValue = gapMetricStats
        ? `${formatGapThresholdRatio(gapMetricStats.thresholdExceededRatio)} · avg ${gapMetricStats.avgGapHours}h`
        : "N/A"

    const handleDownloadPdf = async () => {
        if (!contentRef.current) return

        try {
            setIsExporting(true)
            const element = contentRef.current

            await new Promise(resolve => setTimeout(resolve, 500))

            const canvas = await html2canvas(element, {
                scale: 1.5,
                logging: false,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                removeContainer: true,
                foreignObjectRendering: false,
                onclone: (clonedDoc) => {
                    const allElements = clonedDoc.querySelectorAll('*')
                    allElements.forEach((el) => {
                        const htmlEl = el as HTMLElement
                        if (htmlEl.style) {
                            const computed = window.getComputedStyle(el)
                            const bgColor = computed.backgroundColor
                            const color = computed.color

                            if (bgColor.includes('oklab') || bgColor.includes('oklch')) {
                                htmlEl.style.backgroundColor = '#ffffff'
                            }
                            if (color.includes('oklab') || color.includes('oklch')) {
                                htmlEl.style.color = '#1a1a1a'
                            }
                        }
                    })
                }
            })

            const imgData = canvas.toDataURL("image/jpeg", 0.8)
            const pdf = new jsPDF("l", "mm", "a4")
            const pdfWidth = pdf.internal.pageSize.getWidth()
            const pdfHeight = pdf.internal.pageSize.getHeight()
            const imgWidth = canvas.width
            const imgHeight = canvas.height
            const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight)

            const imgPrWidth = imgWidth * ratio * 0.95
            const imgPrHeight = imgHeight * ratio * 0.95

            const x = (pdfWidth - imgPrWidth) / 2
            const y = (pdfHeight - imgPrHeight) / 2

            pdf.addImage(imgData, "JPEG", x, y, imgPrWidth, imgPrHeight)

            const now = new Date()
            const timestamp = now.getFullYear().toString() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') + '_' +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0')
            pdf.save(`Infection_Monitoring_Report_${timestamp}.pdf`)
        } catch (error) {
            console.error("PDF generation failed:", error)
            alert("PDF 생성에 실패했습니다. 다시 시도해 주세요.")
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <ScrollArea className="h-0 flex-1">
                <div ref={contentRef} className="mx-auto w-full max-w-[1280px] bg-background px-4 py-4 md:px-5 md:py-5 xl:px-8 xl:py-6">
                    <div
                        className={
                            showPageTitle
                                ? "mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
                                : "mb-4 flex justify-center lg:justify-end"
                        }
                    >
                        {showPageTitle ? (
                            <div className="w-full text-center lg:text-left">
                                <h1 className="w-full truncate whitespace-nowrap text-base font-bold text-foreground md:text-lg xl:text-xl">
                                    <span className="xl:hidden">감염병 현황</span>
                                    <span className="hidden xl:inline">감염병 현황 (Infection Status)</span>
                                </h1>
                                <p className="mt-0.5 text-xs text-muted-foreground md:text-sm">
                                    병원 내 감염 모니터링 개요
                                </p>
                            </div>
                        ) : null}
                        <div className="flex w-full items-center justify-center gap-2 lg:w-auto lg:justify-end">
                            <div className="flex w-full items-center gap-1 rounded-lg border border-border bg-card p-1 lg:w-auto">
                                <Calendar className="ml-2 hidden h-4 w-4 text-muted-foreground lg:block" />
                                {DATE_RANGE_OPTIONS.map((range) => (
                                    <Button
                                        key={range.value}
                                        variant={dateRange === range.value ? "default" : "ghost"}
                                        size="sm"
                                        className="h-9 flex-1 px-0 text-xs lg:h-8 lg:flex-none lg:px-3"
                                        onClick={() => setDateRange(range.value)}
                                    >
                                        <span className="xl:hidden">{range.mobileLabel}</span>
                                        <span className="hidden xl:inline">{range.desktopLabel}</span>
                                    </Button>
                                ))}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-2 ml-2 hidden xl:flex"
                                onClick={handleDownloadPdf}
                                disabled={isExporting}
                            >
                                <Download className="h-4 w-4" />
                                {isExporting ? "저장 중..." : "보고서 저장"}
                            </Button>
                        </div>
                    </div>

                    <>
                        {summaryError ? (
                            <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                                병원 내부 환자 데이터를 불러오지 못해 일부 카드가 빈 상태로 표시됩니다.
                            </div>
                        ) : null}

                        <div className="mx-auto mb-6 grid w-full grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
                            <KpiCard
                                title="MDRO Patients"
                                titleKo="다제내성균 관리 환자"
                                value={patientStats.mdroPatients}
                                trend="flat"
                                trendValue="N/A"
                                icon={ShieldAlert}
                                onClick={goToPatients}
                            />
                            <KpiCard
                                title={`Monitoring Events (${selectedDays}d)`}
                                titleKo={`모니터링 이벤트 (${selectedDays}일)`}
                                value={monitoringEvents}
                                trend={trendDirection(deltaRate)}
                                trendValue={formatDelta(deltaRate)}
                                icon={Activity}
                                onClick={goToPatients}
                            />
                            <KpiCard
                                title="Isolation Gap Cases"
                                titleKo="격리 지연 사례"
                                value={isolationGapValue}
                                trend={isolationGapTrend}
                                trendValue={isolationGapTrendValue}
                                icon={AlertTriangle}
                                onClick={goToPatients}
                            />
                            <KpiCard
                                title="Infection Transfers"
                                titleKo="감염 관련 전동"
                                value={patientStats.infectionTransfers}
                                trend="flat"
                                trendValue="N/A"
                                icon={ArrowRightLeft}
                                onClick={goToPatients}
                            />
                        </div>

                        <div className="mx-auto mb-6 grid w-full grid-cols-1 gap-4 xl:grid-cols-2">
                            <InfectionTypeChart data={infectionTypeData} loading={summaryLoading} />
                            <WeeklyTrendChart
                                loading={summaryLoading}
                                error={summaryError}
                            />
                        </div>

                        <div className="mx-auto grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            <div className="col-span-1 md:col-span-2 xl:col-span-2">
                                <MdroPanel />
                            </div>
                            <div className="col-span-1 md:col-span-2 xl:col-span-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-4">
                                <MonthlyTrendChart
                                    loading={summaryLoading}
                                    error={summaryError}
                                />
                                <ActionSummary
                                    totalCases={monitoringEvents}
                                    latestDayCases={latestDayCases}
                                    deltaRate={deltaRate}
                                    topDisease={topDisease}
                                    loading={summaryLoading}
                                    error={summaryError}
                                />
                            </div>
                        </div>
                    </>
                </div>
            </ScrollArea >
        </div >
    )
}
