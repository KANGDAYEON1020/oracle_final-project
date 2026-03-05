"use client"

import React from "react"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
    Activity,
    TrendingUp,
    TrendingDown,
    Minus,
    Calendar,
    List,
    Map as MapIcon,
    Globe,
    MapPin,
    AlertCircle,
    Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { DISEASE_LIST } from "@/lib/types"
import type { InfectionSummaryResponse } from "@/lib/types"
import { getRegionByCode, REGIONS } from "@/lib/region-mapping"
import { InfectionListView } from "@/components/infection-status/list-view"
import { InfectionMapView } from "@/components/infection-status/map-view"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

const DAYS_OPTIONS = [
    { label: "7일", value: "7" },
    { label: "14일", value: "14" },
    { label: "30일", value: "30" },
] as const

export function NationalInfectionStatus() {
    const [scope, setScope] = useState<"national" | "regional">("national")
    const [view, setView] = useState<"list" | "map">("list")
    const [days, setDays] = useState("7")
    const [disease, setDisease] = useState(DISEASE_LIST[0])
    const [selectedRegion, setSelectedRegion] = useState<string | null>(null)

    // Build API URL
    const params = new URLSearchParams({
        scope,
        view,
        days,
        disease,
        metric: "cases",
    })
    if (selectedRegion) {
        params.set("region", selectedRegion)
    }

    const { data, error, isLoading } = useSWR<InfectionSummaryResponse>(
        `/api/public/infection-status/summary?${params.toString()}`,
        fetcher,
        { refreshInterval: 300000, revalidateOnFocus: false }
    )

    const handleRegionSelect = (regionCode: string | null) => {
        setSelectedRegion(regionCode)
    }

    return (
        <div className="space-y-4">
            {/* Toolbar: Scope + View + Filters */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Left: Toggles */}
                <div className="flex items-center gap-4">
                    {/* Scope Toggle */}
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                        <Button
                            variant={scope === "national" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => {
                                setScope("national")
                                setSelectedRegion(null)
                            }}
                        >
                            <Globe className="h-3.5 w-3.5" />
                            {"전국"}
                        </Button>
                        <Button
                            variant={scope === "regional" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => setScope("regional")}
                        >
                            <MapPin className="h-3.5 w-3.5" />
                            {"지역"}
                        </Button>
                    </div>

                    {/* View Toggle */}
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
                        <Button
                            variant={view === "list" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => setView("list")}
                        >
                            <List className="h-3.5 w-3.5" />
                            {"목록"}
                        </Button>
                        <Button
                            variant={view === "map" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => setView("map")}
                        >
                            <MapIcon className="h-3.5 w-3.5" />
                            {"지도"}
                        </Button>
                    </div>
                </div>

                {/* Right: Filters & Meta */}
                <div className="flex flex-wrap items-center gap-3">
                    {/* Period */}
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1">
                        <span className="text-[10px] text-muted-foreground">{"기간"}</span>
                        <div className="flex items-center gap-0.5">
                            {DAYS_OPTIONS.map((opt) => (
                                <Button
                                    key={opt.value}
                                    variant={days === opt.value ? "secondary" : "ghost"}
                                    size="sm"
                                    className={cn(
                                        "h-5 px-2 text-[10px]",
                                        days === opt.value && "bg-secondary text-secondary-foreground"
                                    )}
                                    onClick={() => setDays(opt.value)}
                                >
                                    {opt.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Disease */}
                    <Select value={disease} onValueChange={setDisease}>
                        <SelectTrigger className="h-7 w-40 text-xs bg-card">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {DISEASE_LIST.map((d) => (
                                <SelectItem key={d} value={d} className="text-xs">
                                    {d}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* Region (when scope=regional) */}
                    {scope === "regional" && (
                        <Select
                            value={selectedRegion ?? "all"}
                            onValueChange={(v) => handleRegionSelect(v === "all" ? null : v)}
                        >
                            <SelectTrigger className="h-7 w-32 text-xs bg-card">
                                <SelectValue placeholder="지역 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all" className="text-xs">
                                    {"전체"}
                                </SelectItem>
                                {REGIONS.map((r) => (
                                    <SelectItem key={r.code} value={r.code} className="text-xs">
                                        {r.nameKo}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {/* Check Update */}
                    {data?.meta.last_updated_at && (
                        <div className="hidden text-[10px] text-muted-foreground lg:block">
                            {new Date(data.meta.last_updated_at).toLocaleTimeString("ko-KR", { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                </div>
            </div>

            {/* KPI Cards */}
            {data && (
                <div className="grid grid-cols-3 gap-4">
                    <KpiMiniCard
                        title={"누적 발생"}
                        titleEn="Total Cases"
                        value={data.kpis.total_cases}
                        icon={Activity}
                    />
                    <KpiMiniCard
                        title={"최신일 발생"}
                        titleEn="Latest Day"
                        value={data.kpis.latest_day_cases}
                        icon={Calendar}
                    />
                    <KpiMiniCard
                        title={"증감률"}
                        titleEn="Delta Rate"
                        value={data.kpis.delta_rate !== null ? `${data.kpis.delta_rate > 0 ? "+" : ""}${data.kpis.delta_rate}%` : "N/A"}
                        trend={data.kpis.delta_rate !== null ? (data.kpis.delta_rate > 0 ? "up" : data.kpis.delta_rate < 0 ? "down" : "flat") : "flat"}
                        icon={TrendingUp}
                    />
                </div>
            )}

            {/* Loading */}
            {isLoading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="ml-2 text-sm text-muted-foreground">{"데이터를 불러오는 중..."}</span>
                </div>
            )}

            {/* Error */}
            {error && (
                <Card className="border-destructive/30 bg-destructive/5">
                    <CardContent className="flex items-center gap-3 py-6">
                        <AlertCircle className="h-5 w-5 text-destructive" />
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                {"공공데이터 연동 지연으로 최신 현황을 불러오지 못했습니다."}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Please try again later.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Empty */}
            {data && data.table.length === 0 && !isLoading && (
                <Card className="border-border">
                    <CardContent className="flex items-center justify-center py-12">
                        <p className="text-sm text-muted-foreground">
                            {"선택한 조건에서 조회된 데이터가 없습니다."}
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Main Content: List or Map */}
            {data && data.table.length > 0 && (
                <>
                    {view === "list" ? (
                        <InfectionListView
                            data={data}
                            selectedRegion={selectedRegion}
                            onSelectRegion={handleRegionSelect}
                            days={Number(days)}
                        />
                    ) : (
                        <InfectionMapView
                            data={data}
                            selectedRegion={selectedRegion}
                            onSelectRegion={handleRegionSelect}
                            days={Number(days)}
                            disease={disease}
                        />
                    )}
                </>
            )}
        </div>
    )
}

// Mini KPI card for this page
function KpiMiniCard({
    title,
    titleEn,
    value,
    trend,
    icon: Icon,
}: {
    title: string
    titleEn: string
    value: number | string
    trend?: "up" | "down" | "flat"
    icon: React.ComponentType<{ className?: string }>
}) {
    const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus

    return (
        <Card className="border border-border bg-card">
            <CardContent className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
                    <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <p className="text-[10px] text-muted-foreground">{title}</p>
                    <p className="text-[9px] text-muted-foreground/60">{titleEn}</p>
                    <div className="flex items-center gap-1.5">
                        <p className="text-2xl font-bold tracking-tight text-foreground">{value}</p>
                        {trend && trend !== "flat" && (
                            <TrendIcon
                                className={cn(
                                    "h-3.5 w-3.5",
                                    trend === "up" && "text-destructive",
                                    trend === "down" && "text-accent"
                                )}
                            />
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
