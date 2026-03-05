"use client"

import { useState, useMemo, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ArrowUp, ArrowDown, Minus, Info } from "lucide-react"
import {
    ComposedChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Scatter,
    Cell
} from "recharts"

// --- Types ---

interface MonthPoint {
    label: string      // "Mar", "Apr"...
    fullLabel: string  // "2025-03"
    value: number
}

interface SeasonalData {
    group: string
    metric: 'cases' | 'incidence'
    data: MonthPoint[]
}

// --- Mock Data Generator ---

// --- Constants ---

const MONTHS = ["Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb"]

// --- Component ---

export function SeasonalStripPanel() {
    const [selectedGroup, setSelectedGroup] = useState("Respiratory")
    const [selectedDisease, setSelectedDisease] = useState("All")
    // YoY removed as per user request for performance

    // Data State
    const [apiData, setApiData] = useState<any>(null)
    const [loading, setLoading] = useState(false)

    // Fetch API Data (1 Year)
    useMemo(() => {
        const fetchApiData = async () => {
            setLoading(true)
            try {
                // Requesting 365 days (1 year)
                const res = await fetch(`/api/public/infection-status/summary?days=365&scope=national`)
                const json = await res.json()
                setApiData(json)
            } catch (error) {
                console.error("Failed to fetch seasonal data", error)
            } finally {
                setLoading(false)
            }
        }
        fetchApiData()
    }, [])

    // Get Available Diseases for Selected Group
    const availableDiseases = useMemo(() => {
        if (!apiData || !apiData.disease_trends) return []

        const diseases = new Set<string>()
        apiData.disease_trends.forEach((d: any) => {
            // Determine Group (Same logic as below)
            let group = "Other"
            const n = d.name
            if (n.includes("인플루엔자") || n.includes("호흡기") || n.includes("코로나") || n.includes("백일해") || n.includes("성홍열") || n.includes("폐렴구균") || n.includes("수두") || n.includes("홍역") || n.includes("유행성이하선염")) group = "Respiratory"
            else if (n.includes("장관") || n.includes("노로") || n.includes("살모넬라") || n.includes("캠필로박터") || n.includes("간염") || n.includes("이질") || n.includes("장티푸스") || n.includes("콜레라") || n.includes("식중독")) group = "GI"
            else if (n.includes("쯔쯔가무시") || n.includes("말라리아") || n.includes("일본뇌염") || n.includes("뎅기열") || n.includes("열성혈소판")) group = "Vector-borne"
            else if (n.includes("CRE") || n.includes("VRE") || n.includes("MRSA") || n.includes("VRSA") || n.includes("카바페넴")) group = "MDRO"

            if (group === selectedGroup) {
                diseases.add(n)
            }
        })
        return Array.from(diseases).sort()
    }, [apiData, selectedGroup])

    // Reset selected disease when group changes
    useEffect(() => {
        setSelectedDisease("All")
    }, [selectedGroup])

    // Process & Group Data
    const data = useMemo(() => {
        if (!apiData || !apiData.disease_trends) return []

        // 1. Initialize Monthly Buckets for Selected Group
        // We need 12 buckets for "Current Year"
        const currentYearBuckets = new Array(12).fill(0)

        // 2. Iterate and Aggregate
        apiData.disease_trends.forEach((d: any) => {
            // Determine Group
            let group = "Other"
            const n = d.name
            if (n.includes("인플루엔자") || n.includes("호흡기") || n.includes("코로나") || n.includes("백일해") || n.includes("성홍열") || n.includes("폐렴구균") || n.includes("수두") || n.includes("홍역") || n.includes("유행성이하선염")) group = "Respiratory"
            else if (n.includes("장관") || n.includes("노로") || n.includes("살모넬라") || n.includes("캠필로박터") || n.includes("간염") || n.includes("이질") || n.includes("장티푸스") || n.includes("콜레라") || n.includes("식중독")) group = "GI"
            else if (n.includes("쯔쯔가무시") || n.includes("말라리아") || n.includes("일본뇌염") || n.includes("뎅기열") || n.includes("열성혈소판")) group = "Vector-borne"
            else if (n.includes("CRE") || n.includes("VRE") || n.includes("MRSA") || n.includes("VRSA") || n.includes("카바페넴")) group = "MDRO"


            if (group !== selectedGroup) return

            // Filter by Disease if specific one selected
            if (selectedDisease !== "All" && n !== selectedDisease) return

            // Sparkline has 52 weeks (oldest -> newest) for 1 year
            const points = d.sparkline || []
            const totalPoints = points.length

            // Reverse iterate (Newest first)
            for (let i = 0; i < totalPoints; i++) {
                const val = points[totalPoints - 1 - i].value
                const weeksBack = i

                const monthBack = Math.floor(weeksBack / 4.345) // Approx weeks per month

                if (monthBack < 12) {
                    // Current Year (0..11 months back)
                    // Bucket 0 is "Oldest" (11 months ago), Bucket 11 is "Newest" (0 months ago)
                    const bucketIdx = 11 - monthBack
                    if (bucketIdx >= 0) currentYearBuckets[bucketIdx] += val
                }
            }
        })

        // 3. Format as MonthPoint[]
        const today = new Date()
        const result: MonthPoint[] = []

        for (let i = 0; i < 12; i++) {
            const monthOffset = i - 11
            const d = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)

            const monthName = d.toLocaleString('en-US', { month: 'short' })
            const fullLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

            result.push({
                label: monthName,
                fullLabel: fullLabel,
                value: Math.round(currentYearBuckets[i]),
            })
        }

        return result
    }, [apiData, selectedGroup, selectedDisease])
    // KPIs
    const kpis = useMemo(() => {
        if (!data || data.length === 0) return {
            currentCases: 0,
            momentum: "Flat"
        }

        const lastIdx = data.length - 1
        const thisMonth = data[lastIdx]

        // Momentum: Check last 3 months trend
        const last3 = data.slice(-3)
        let upCount = 0
        let downCount = 0
        for (let i = 1; i < last3.length; i++) {
            if (last3[i].value > last3[i - 1].value) upCount++
            else if (last3[i].value < last3[i - 1].value) downCount++
        }

        let momentum = "Flat"
        if (upCount >= 2) momentum = "Uptrend"
        if (downCount >= 2) momentum = "Downtrend"

        return {
            currentCases: thisMonth.value,
            momentum
        }
    }, [data])

    // Auto Insight
    const insight = useMemo(() => {
        if (!data || data.length === 0) return "Loading or no data available..."

        // Detect peak season
        const maxVal = Math.max(...data.map(d => d.value))
        const maxIdx = data.findIndex(d => d.value === maxVal)

        let pattern = "혼합된 계절성 (Mixed seasonality)"
        // Winter: Nov(8) ~ Feb(11)
        // Summer: Jun(3) ~ Sep(6)
        if (maxIdx >= 8 || maxIdx <= 1) pattern = "겨울 유행 패턴 (Winter-peaking pattern)"
        else if (maxIdx >= 3 && maxIdx <= 6) pattern = "여름 유행 패턴 (Summer-peaking pattern)"
        else if (selectedGroup === "MDRO") pattern = "비계절성 (Non-seasonal trend)"

        let trendText = "안정적 (stable)"
        if (kpis.momentum === "Uptrend") trendText = "3개월 연속 상승 (trending up for 3 months)"
        if (kpis.momentum === "Downtrend") trendText = "하락세 (trending down)"

        return `${pattern}. 현재 ${trendText}입니다.`
    }, [data, kpis, selectedGroup, selectedDisease])

    // Custom Tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const d = payload[0].payload as MonthPoint

            return (
                <div className="bg-white p-3 border rounded shadow-lg text-xs z-50">
                    <p className="font-bold mb-1">{d.fullLabel} ({d.label})</p>
                    <div className="flex items-center space-x-2">
                        <span className="text-gray-500">Cases:</span>
                        <span className="font-medium text-blue-600">{d.value.toLocaleString()}</span>
                    </div>
                </div>
            )
        }
        return null
    }

    return (
        <Card className="w-full h-full shadow-md border-t-4 border-t-blue-500">
            <CardHeader className="pb-2">
                <div className="flex flex-col space-y-2 md:flex-row md:items-center md:justify-between md:space-y-0">
                    <div>
                        <CardTitle className="text-lg font-bold">계절성 감염병 (Seasonality)</CardTitle>
                        <CardDescription className="text-xs text-gray-400 mt-1">
                            최근 12개월 추이 (Current 12 months Trend)
                        </CardDescription>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center space-x-2">
                        {/* 1. Group Dropdown */}
                        <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                            <SelectTrigger className="w-[110px] h-8 text-xs font-medium">
                                <SelectValue placeholder="Group" />
                            </SelectTrigger>
                            <SelectContent align="end">
                                <SelectItem value="Respiratory">Respiratory</SelectItem>
                                <SelectItem value="GI">GI / Waterborne</SelectItem>
                                <SelectItem value="Vector-borne">Vector-borne</SelectItem>
                                <SelectItem value="MDRO">MDRO / HAI</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* 2. Disease Detail Dropdown */}
                        <Select value={selectedDisease} onValueChange={setSelectedDisease}>
                            <SelectTrigger className="w-[140px] h-8 text-xs">
                                <SelectValue placeholder="All Diseases" />
                            </SelectTrigger>
                            <SelectContent align="end">
                                <SelectItem value="All">All Diseases</SelectItem>
                                {availableDiseases.map(d => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                {/* Main Visual: Seasonal Strip */}
                <div className="h-[200px] w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: "#6b7280" }}
                                axisLine={{ stroke: "#e5e7eb" }}
                                tickLine={false}
                                interval={1} // Show every other label
                            />
                            <YAxis
                                tick={{ fontSize: 11, fill: "#6b7280" }}
                                axisLine={false}
                                tickLine={false}
                                tickCount={3}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb", opacity: 0.5 }} />

                            {/* Current Year Bar */}
                            <Bar
                                dataKey="value"
                                barSize={20}
                                radius={[2, 2, 0, 0]}
                            >
                                {data.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={index === data.length - 1 ? "#3b82f6" : "#cbd5e1"}
                                        stroke={index === data.length - 1 ? "#2563eb" : "none"}
                                        strokeWidth={index === data.length - 1 ? 2 : 0}
                                    />
                                ))}
                            </Bar>
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* Footer: KPIs & Insight */}
                <div className="mt-4 pt-4 border-t grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Insight Text */}
                    <div className="md:col-span-4 lg:col-span-4 bg-blue-50 text-blue-800 text-xs px-3 py-2 rounded flex items-center mb-2">
                        <Info className="w-4 h-4 mr-2 flex-shrink-0" />
                        <span className="font-medium">{insight}</span>
                    </div>

                    {/* KPI Cards */}
                    <div className="bg-gray-50 rounded p-3 flex flex-col justify-center col-span-2">
                        <span className="text-[10px] uppercase text-gray-500 font-semibold">이번 달 ({data[data.length - 1]?.label})</span>
                        <div className="text-xl font-bold text-gray-900 mt-1">
                            {kpis.currentCases.toLocaleString()}
                            <span className="text-xs font-normal text-gray-400 ml-1">cases</span>
                        </div>
                    </div>

                    <div className="bg-gray-50 rounded p-3 flex flex-col justify-center col-span-2">
                        <span className="text-[10px] uppercase text-gray-500 font-semibold">모멘텀 (3 Mo)</span>
                        <div className="text-xl font-bold text-gray-900 mt-1 flex items-center">
                            {kpis.momentum === "Uptrend" && <ArrowUp className="w-4 h-4 mr-1 text-red-500" />}
                            {kpis.momentum === "Downtrend" && <ArrowDown className="w-4 h-4 mr-1 text-green-500" />}
                            {kpis.momentum === "Flat" && <Minus className="w-4 h-4 mr-1 text-gray-400" />}
                            {kpis.momentum === "Uptrend" ? "상승 (Up)" : kpis.momentum === "Downtrend" ? "하락 (Down)" : "보합 (Flat)"}
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
