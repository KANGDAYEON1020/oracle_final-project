"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, Minus, Flame, ChevronDown, ChevronUp, Loader2, HelpCircle, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { LineChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
    Tooltip as UITooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

// --- Types & Data Models ---

type TimeRange = "7D" | "30D" | "3M"

interface MonthlyData {
    period: string
    value: number
}

interface DiseaseSeries {
    code: string
    name: string
    group: "Respiratory" | "GI" | "Vector-borne" | "MDRO" | "Other"
    values: number[] // aligned with timePoints
}

interface ProcessedDisease {
    name: string
    group: string
    currentCases: number
    prevCases: number
    growthRate: number
    momentum: "up" | "down" | "flat"
    trendScore: number // For rising impact
    fallingScore: number // For falling impact
    sparklineData: { period?: string; value: number }[]
    isHot: boolean
}

const GROUP_LABELS: Record<string, string> = {
    "Respiratory": "Respiratory",
    "GI": "GI (Enteric/Foodborne/Waterborne)",
    "Vector-borne": "Vector-borne",
    "MDRO": "MDRO / Healthcare-Associated Alert",
    "Other": "Other"
}

// --- Mock Data Generator (Robust) ---
// Simulating data points: 
// 7D: 7 points (daily) -> mocked as [10, 12, 11, 15, 18, 20, 22] etc.
// 30D: 5 points (weekly) 
// 3M: 12 points (weekly)

const MOCK_DISEASES: Omit<DiseaseSeries, 'values'>[] = [
    { code: "D01", name: "Influenza", group: "Respiratory" },
    { code: "D02", name: "COVID-19", group: "Respiratory" },
    { code: "D03", name: "Norovirus", group: "GI" },
    { code: "D04", name: "Chickenpox", group: "Other" },
    { code: "D05", name: "Mumps", group: "Respiratory" },
    { code: "D06", name: "Pertussis", group: "Respiratory" },
    { code: "D07", name: "Scarlet Fever", group: "Respiratory" },
    { code: "D08", name: "Salmonella", group: "GI" },
    { code: "D09", name: "Campylobacter", group: "GI" },
    { code: "D10", name: "Malaria", group: "Vector-borne" },
    { code: "D11", name: "Scrub Typhus", group: "Vector-borne" },
    { code: "D12", name: "Hepatitis A", group: "GI" },
]

function generateMockValues(base: number, volatility: number, trend: number, length: number): number[] {
    let current = base
    return Array.from({ length }, (_, i) => {
        const noise = (Math.random() - 0.5) * volatility
        // Add trend (compound)
        current = current * (1 + trend + noise)
        return Math.max(0, Math.round(current))
    })
}

// --- Component ---


import { SeasonalStripPanel } from "./SeasonalStripPanel"

// Helper: "202506" → "2025년 6주차"
function formatPeriodLabel(period?: string): string {
    if (!period) return ""
    const s = period.toString()
    if (s.length >= 5) {
        const year = s.slice(0, 4)
        const week = parseInt(s.slice(4), 10)
        return `${year}년 ${week}주차`
    }
    return s
}

// Helper: get current ISO week label (e.g. "2026년 7주차")
function getCurrentWeekLabel(): string {
    const now = new Date()
    const year = now.getFullYear()
    // ISO week calculation
    const jan1 = new Date(year, 0, 1)
    const dayOfYear = Math.floor((now.getTime() - jan1.getTime()) / 86400000) + 1
    const week = Math.ceil((dayOfYear + jan1.getDay()) / 7)
    return `${year}년 ${week}주차`
}

// Custom Recharts tooltip for sparklines
function SparklineTooltip({ active, payload }: any) {
    if (!active || !payload || payload.length === 0) return null
    const data = payload[0]?.payload
    return (
        <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
            <div className="text-gray-300 mb-0.5">{formatPeriodLabel(data?.period)}</div>
            <div className="font-bold">{data?.value?.toLocaleString()}명</div>
        </div>
    )
}

interface PublicSurveillanceTrendNowProps {
    dateRange: string
}

export function PublicSurveillanceTrendNow({ dateRange }: PublicSurveillanceTrendNowProps) {
    // Derive TimeRange from global dateRange string
    const timeRange: TimeRange = useMemo(() => {
        if (dateRange === "Last 7 days") return "7D"
        if (dateRange === "Last 3 months") return "3M"
        return "30D" // Default to 30D for "Last 1 month"
    }, [dateRange])

    const [detailsOpen, setDetailsOpen] = useState(false)
    const [sortBy, setSortBy] = useState<'impact' | 'volume'>('impact')

    // 1. Generate/Process Data based on TimeRange
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(false)

    // Fetch Data from API
    useMemo(() => {
        const fetchData = async () => {
            setLoading(true)
            try {
                // Determine days based on range
                let days = 30
                if (timeRange === "7D") days = 7
                if (timeRange === "3M") days = 90

                // ... fetch logic ...
                const res = await fetch(`/api/public/infection-status/summary?days=${days}&scope=national`)
                const json = await res.json()
                setData(json)
            } catch (error) {
                console.error("Failed to fetch surveillance data", error)
            } finally {
                setLoading(false)
            }
        }
        fetchData()
    }, [timeRange])

    // (Old Year Chart Logic Removed)

    const { summary, hotNow, risingMovers, fallingMovers, groupedTrends, latestDataWeek, isHotFallback } = useMemo(() => {
        if (!data || !data.disease_trends) return {
            summary: { totalCases: 0, totalGrowth: 0, hotGroup: "-" },
            hotNow: [],
            risingMovers: [],
            fallingMovers: [],
            groupedTrends: [],
            latestDataWeek: ""
        }

        const processed: ProcessedDisease[] = data.disease_trends.map((d: any) => {
            // Calculate Trend Score (Modified to prioritize volume for impact)
            const volumeScore = Math.log10(d.current + 1)
            // Weight volume more heavily (70%) than pure growth % (30%)
            let trendScore = (d.growthRate / 100) * 0.3 + (volumeScore / 4) * 0.7

            // Calculate Falling Score for declining diseases (absolute growth rate)
            // Use absolute growth rate to properly rank large drops
            let fallingScore = (Math.abs(d.growthRate) / 100) * 0.3 + (volumeScore / 4) * 0.7

            if (d.current < 5) {
                trendScore = 0
                fallingScore = 0
            }

            // Momentum logic (simple check of last 3 points in sparkline)
            let momentum: "up" | "down" | "flat" = "flat"
            if (d.sparkline && d.sparkline.length >= 3) {
                const last3 = d.sparkline.slice(-3)
                let upCount = 0
                for (let i = 1; i < last3.length; i++) {
                    if (last3[i].value > last3[i - 1].value) upCount++
                }
                if (upCount >= 2) momentum = "up"
                else if (upCount === 0) momentum = "down"
            }

            // Group Mapping
            let group = "Other"
            const n = d.name
            // Updated to match SeasonalStripPanel logic
            if (n.includes("인플루엔자") || n.includes("호흡기") || n.includes("코로나") || n.includes("백일해") || n.includes("성홍열") || n.includes("폐렴구균") || n.includes("수두") || n.includes("홍역") || n.includes("유행성이하선염")) group = "Respiratory"
            else if (n.includes("장관") || n.includes("노로") || n.includes("살모넬라") || n.includes("캠필로박터") || n.includes("간염") || n.includes("이질") || n.includes("장티푸스") || n.includes("콜레라") || n.includes("식중독")) group = "GI"
            else if (n.includes("쯔쯔가무시") || n.includes("말라리아") || n.includes("일본뇌염") || n.includes("뎅기열") || n.includes("열성혈소판")) group = "Vector-borne"
            else if (n.includes("CRE") || n.includes("VRE") || n.includes("MRSA") || n.includes("VRSA") || n.includes("카바페넴")) group = "MDRO"

            return {
                name: d.name,
                group,
                currentCases: d.current,
                prevCases: d.previous,
                growthRate: d.growthRate,
                momentum,
                trendScore,
                fallingScore,
                sparklineData: d.sparkline,
                isHot: d.growthRate > 15 && d.current > 50
            }
        })

        // Split into Rising and Falling
        // Rising: Growth >= 0
        const risingCandidates = processed.filter(d => d.growthRate >= 0)
        // Falling: Growth < 0
        const fallingCandidates = processed.filter(d => d.growthRate < 0)

        // Sort Rising
        const risingMovers = [...risingCandidates].sort((a, b) => {
            if (sortBy === 'volume') {
                return b.currentCases - a.currentCases
            }
            return b.trendScore - a.trendScore
        })

        // Sort Falling
        const fallingMovers = [...fallingCandidates].sort((a, b) => {
            if (sortBy === 'volume') {
                return b.currentCases - a.currentCases
            }
            // Use fallingScore (impact of decline)
            return b.fallingScore - a.fallingScore
        })

        // Hot Now: Top 3 positive movers. If none, fallback to top volume.
        let hotCandidates = [...risingCandidates]
            .filter(d => d.growthRate > 0)
            .sort((a, b) => b.trendScore - a.trendScore)

        // Fallback: If no rising trends, just show top volume (from all)
        const isHotFallback = hotCandidates.length === 0
        if (isHotFallback) {
            hotCandidates = [...processed].sort((a, b) => b.currentCases - a.currentCases)
        }

        const hotNow = hotCandidates.slice(0, 3)

        // Summary Totals
        const totalCases = data.kpis.total_cases
        const totalGrowth = data.kpis.delta_rate ?? 0

        // Group Hotness
        const groups = ["Respiratory", "GI", "Vector-borne", "MDRO", "Other"]
        const groupScores = groups.map(g => {
            const groupItems = processed.filter(p => p.group === g)
            const score = groupItems.reduce((acc, curr) => acc + curr.trendScore, 0)
            return { group: g, score }
        }).sort((a, b) => b.score - a.score)

        // Extract latest data week from sparkline data
        let latestDataWeek = ""
        if (processed.length > 0 && processed[0].sparklineData?.length > 0) {
            const lastPoint = processed[0].sparklineData[processed[0].sparklineData.length - 1]
            if (lastPoint?.period) {
                latestDataWeek = formatPeriodLabel(lastPoint.period)
            }
        }

        return {
            summary: { totalCases, totalGrowth, hotGroup: groupScores[0]?.group || "-" },
            hotNow,
            risingMovers,
            fallingMovers,
            groupedTrends: groupScores,
            latestDataWeek,
            isHotFallback // Return this new flag
        }
    }, [data, sortBy])


    return (
        <div className="w-full space-y-6 relative min-h-[400px]">
            {loading && (
                <div className="absolute inset-0 z-50 flex items-start justify-center pt-[200px] bg-white/50 backdrop-blur-[1px]">
                    <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        <span className="text-sm font-medium text-blue-600">Updating...</span>
                    </div>
                </div>
            )}

            {/* KPI Cards - 4 column grid matching hospital tab */}
            <div className="grid grid-cols-4 gap-4">
                <div className="rounded-xl border bg-card p-5 space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">총 발생 ({timeRange})</span>
                    <div className="text-3xl font-bold text-foreground">
                        {summary.totalCases.toLocaleString()}
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                        {summary.totalGrowth > 0 ? (
                            <TrendingUp className="w-4 h-4 text-rose-500" />
                        ) : (
                            <TrendingDown className="w-4 h-4 text-emerald-500" />
                        )}
                        <span className={summary.totalGrowth > 0 ? "text-rose-600 font-medium" : "text-emerald-600 font-medium"}>
                            {Math.abs(summary.totalGrowth).toFixed(1)}%
                        </span>
                        <span className="text-muted-foreground">vs prev {timeRange}</span>
                    </div>
                </div>

                <div className="rounded-xl border bg-card p-5 space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">주요 발생군</span>
                    <div className="text-2xl font-bold text-foreground flex items-center gap-2">
                        {summary.hotGroup}
                    </div>
                    <div className="text-sm text-muted-foreground">발생량 및 증가율 기반</div>
                </div>

                <div className="rounded-xl border bg-card p-5 space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">주의 단계</span>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge className={summary.totalGrowth > 10 ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"}>
                            {summary.totalGrowth > 10 ? "급증 (Surge)" : "안정 (Stable)"}
                        </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">{new Date().toLocaleDateString()} Updated</div>
                </div>

                <div className="rounded-xl border bg-card p-5 space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">급상승 Top</span>
                    {hotNow.length > 0 && !isHotFallback ? (
                        <>
                            <div className="text-lg font-bold text-foreground flex items-center gap-2">
                                <Flame className="w-4 h-4 text-orange-500 fill-orange-500" />
                                {hotNow[0]?.name}
                            </div>
                            <div className="text-sm text-rose-600 font-medium">
                                +{hotNow[0]?.growthRate.toFixed(1)}% ({hotNow[0]?.currentCases.toLocaleString()}건)
                            </div>
                        </>
                    ) : (
                        <div className="text-lg font-bold text-muted-foreground">—</div>
                    )}
                </div>
            </div>

            {/* 급상승 감염병 (What's Hot Now) - full width horizontal */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                            {isHotFallback ? (
                                <>
                                    <TrendingUp className="w-5 h-5 text-blue-500" />
                                    <span>최다 발생 감염병 (Most Active)</span>
                                </>
                            ) : (
                                <>
                                    <Flame className="w-5 h-5 text-orange-500 fill-orange-500" />
                                    <span>급상승 감염병 (What's Hot Now)</span>
                                </>
                            )}
                        </h3>
                        <TooltipProvider>
                            <UITooltip>
                                <TooltipTrigger asChild>
                                    <HelpCircle className="w-4 h-4 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-[300px]">
                                    <p className="font-medium mb-1 text-sm">
                                        {isHotFallback ? "데이터 집계 기준 안내" : "급상승 선정 기준"}
                                    </p>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        {isHotFallback
                                            ? "현재 기간 내 증가 추세를 보이는 질병이 없어, 발생량이 가장 많은 상위 3개 질병을 대신 표시합니다."
                                            : "최근 기간 동안 발생 증가율이 높고 발생량이 유의미한(5건 이상) 질병 상위 3개를 선정했습니다."}
                                    </p>
                                </TooltipContent>
                            </UITooltip>
                        </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                            현재 {getCurrentWeekLabel()}
                        </span>
                        {latestDataWeek && latestDataWeek !== getCurrentWeekLabel() && (
                            <span className="text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
                                📊 데이터 기준: {latestDataWeek}
                            </span>
                        )}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {hotNow.map((disease) => (
                        <div key={disease.name} className="relative overflow-hidden rounded-xl border bg-card p-5 hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-bold text-lg text-foreground">{disease.name}</span>
                                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5 font-normal">
                                            {disease.group}
                                        </Badge>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-2xl font-bold">{disease.currentCases.toLocaleString()}</span>
                                        <div className="flex items-baseline gap-2">
                                            {' '}<span className={`text-sm font-bold flex items-center ${disease.growthRate > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {disease.growthRate > 0 ? '+' : ''}{disease.growthRate.toFixed(1)}%
                                            </span>
                                            <span className="text-[10px] text-muted-foreground font-normal whitespace-nowrap">
                                                ({disease.prevCases.toLocaleString()})
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="h-12 mt-2 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={disease.sparklineData}>
                                        <RechartsTooltip content={<SparklineTooltip />} cursor={{ stroke: '#94a3b8', strokeWidth: 1 }} />
                                        <Line type="monotone" dataKey="value" stroke={disease.growthRate > 0 ? "#e11d48" : "#10b981"} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: disease.growthRate > 0 ? "#e11d48" : "#10b981" }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            {disease.momentum === 'up' && (
                                <div className="absolute top-4 right-4 animate-pulse">
                                    <span className="flex h-3 w-3 rounded-full bg-rose-500"></span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 주요 변동 (Top Movers) - full width */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">주요 변동 (Top Movers)</h3>
                        <TooltipProvider>
                            <UITooltip>
                                <TooltipTrigger>
                                    <HelpCircle className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs p-3">
                                    <p className="font-semibold mb-1">Ranking Criteria:</p>
                                    <p className="text-xs text-muted-foreground">
                                        <strong>Impact:</strong> Volume (70%) + Growth/Decline Rate (30%)
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        <strong>Volume:</strong> Pure case count ranking
                                    </p>
                                </TooltipContent>
                            </UITooltip>
                        </TooltipProvider>
                    </div>
                    <div className="flex bg-muted p-1 rounded-lg">
                        <button onClick={() => setSortBy('impact')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${sortBy === 'impact' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                            Impact
                        </button>
                        <button onClick={() => setSortBy('volume')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${sortBy === 'volume' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                            Volume
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* LEFT COLUMN: Rising Top 5 */}
                    <div className="border rounded-lg overflow-hidden h-fit flex flex-col">
                        <div className="bg-muted px-4 py-3 border-b flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ArrowUpRight className="w-4 h-4 text-rose-500" />
                                <h4 className="font-semibold text-sm">상승 Top 5 (Rising)</h4>
                            </div>
                            <span className="text-xs text-muted-foreground">증가 추세</span>
                        </div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground border-b text-xs">
                                <tr>
                                    <th className="px-4 py-2 font-medium w-12">순위</th>
                                    <th className="px-4 py-2 font-medium">감염병명</th>
                                    <th className="px-4 py-2 font-medium text-right">발생</th>
                                    <th className="px-4 py-2 font-medium text-center">증가율</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {risingMovers.length > 0 ? risingMovers.slice(0, 5).map((d, index) => (
                                    <tr key={d.name} className="hover:bg-muted/50">
                                        <td className="px-4 py-3 font-medium text-muted-foreground text-xs">#{index + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-foreground text-sm">{d.name}</div>
                                            <div className="text-[10px] text-muted-foreground">{d.group}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-foreground">{d.currentCases.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700`}>
                                                +{d.growthRate.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                            상승 중인 감염병이 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* RIGHT COLUMN: Falling Top 5 */}
                    <div className="border rounded-lg overflow-hidden h-fit flex flex-col">
                        <div className="bg-muted px-4 py-3 border-b flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ArrowDownRight className="w-4 h-4 text-emerald-500" />
                                <h4 className="font-semibold text-sm">하강 Top 5 (Falling)</h4>
                            </div>
                            <span className="text-xs text-muted-foreground">감소 추세</span>
                        </div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-muted/50 text-muted-foreground border-b text-xs">
                                <tr>
                                    <th className="px-4 py-2 font-medium w-12">순위</th>
                                    <th className="px-4 py-2 font-medium">감염병명</th>
                                    <th className="px-4 py-2 font-medium text-right">발생</th>
                                    <th className="px-4 py-2 font-medium text-center">증가율</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {fallingMovers.length > 0 ? fallingMovers.slice(0, 5).map((d, index) => (
                                    <tr key={d.name} className="hover:bg-muted/50">
                                        <td className="px-4 py-3 font-medium text-muted-foreground text-xs">#{index + 1}</td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-foreground text-sm">{d.name}</div>
                                            <div className="text-[10px] text-muted-foreground">{d.group}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium text-foreground">{d.currentCases.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700`}>
                                                {d.growthRate.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground text-sm">
                                            감소 중인 감염병이 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* 계절성 감염병 (Seasonal Strip Panel) - full width */}
            <div className="rounded-xl border bg-card p-6">
                <SeasonalStripPanel />
            </div>

            {/* Detailed Breakdown accordion */}
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="border rounded-lg bg-muted/30">
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full flex justify-between p-4 hover:bg-muted/50">
                        <span className="font-medium text-foreground text-sm">상세 분석 (Detailed Breakdown)</span>
                        {detailsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="p-4 border-t">
                    <h4 className="text-sm font-semibold mb-3">Drivers of Change (Top Rising)</h4>
                    <div className="bg-card p-3 rounded border space-y-2">
                        {risingMovers.slice(0, 5).map(m => {
                            const contribution = (m.currentCases / summary.totalCases) * 100
                            return (
                                <div key={m.name} className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span>{m.name}</span>
                                        <span className="text-muted-foreground">{contribution.toFixed(1)}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${contribution}%` }} />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div >
    )
}
