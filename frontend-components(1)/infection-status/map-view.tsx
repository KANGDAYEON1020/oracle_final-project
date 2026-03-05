"use client"

import React, { useState, useMemo, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import {
  Activity,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { getRegionByCode } from "@/lib/region-mapping"
import type { InfectionSummaryResponse, InfectionRegionRow } from "@/lib/types"
import * as d3 from "d3"
import { geoPath, geoMercator } from "d3-geo"
import type { FeatureCollection, Feature, Geometry } from "geojson"

interface MapViewProps {
  data: InfectionSummaryResponse
  selectedRegion: string | null
  onSelectRegion: (code: string | null) => void
  days: number
  disease: string
}

// GeoJSON code to our internal code mapping
// Based on skorea_provinces_geo_simple.json feature codes
const GEOJSON_CODE_MAP: Record<string, string> = {
  "11": "seoul",      // 서울특별시
  "21": "busan",      // 부산광역시
  "22": "daegu",      // 대구광역시
  "23": "incheon",    // 인천광역시
  "24": "gwangju",    // 광주광역시
  "25": "daejeon",    // 대전광역시
  "26": "ulsan",      // 울산광역시
  "29": "sejong",     // 세종특별자치시
  "31": "gyeonggi",   // 경기도
  "32": "gangwon",    // 강원도
  "33": "chungbuk",   // 충청북도
  "34": "chungnam",   // 충청남도
  "35": "jeonbuk",    // 전라북도
  "36": "jeonnam",    // 전라남도
  "37": "gyeongbuk",  // 경상북도
  "38": "gyeongnam",  // 경상남도
  "39": "jeju",       // 제주특별자치도
}

// 5-step color scale (blue-based, not overly alarming)
const COLOR_SCALE = [
  "hsl(210, 30%, 92%)",  // very low
  "hsl(210, 40%, 78%)",  // low
  "hsl(210, 50%, 62%)",  // medium
  "hsl(210, 55%, 48%)",  // high
  "hsl(210, 60%, 35%)",  // very high
]
const NEUTRAL_COLOR = "hsl(210, 10%, 88%)"

function getColorForValue(value: number | null, thresholds: number[]): string {
  if (value === null || value === undefined) return NEUTRAL_COLOR
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) return COLOR_SCALE[i]
  }
  return COLOR_SCALE[0]
}

function computeThresholds(values: number[]): number[] {
  if (values.length === 0) return [0, 1, 2, 3, 4]
  const sorted = [...values].sort((a, b) => a - b)
  const steps = 5
  return Array.from({ length: steps }, (_, i) => {
    const idx = Math.floor((i / steps) * sorted.length)
    return sorted[idx]
  })
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {"발생: "}
          <span className="font-semibold text-foreground">{payload[0].value}</span>
          {"건"}
        </p>
      </div>
    )
  }
  return null
}

interface GeoFeature {
  type: "Feature"
  properties: {
    code: string
    name: string
    name_eng: string
    base_year: string
  }
  geometry: Geometry
}

export function InfectionMapView({
  data,
  selectedRegion,
  onSelectRegion,
  days,
  disease,
}: MapViewProps) {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const [geoData, setGeoData] = useState<FeatureCollection | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load GeoJSON data
  useEffect(() => {
    fetch("/skorea_provinces_geo_simple.json")
      .then((res) => res.json())
      .then((data) => {
        setGeoData(data)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error("Failed to load GeoJSON:", err)
        setIsLoading(false)
      })
  }, [])

  // Build value map from data
  const valueMap = useMemo(() => {
    const map = new Map<string, InfectionRegionRow>()
    for (const row of data.map_data) {
      map.set(row.region_code, row)
    }
    return map
  }, [data.map_data])

  // Compute thresholds from data
  const thresholds = useMemo(() => {
    const values = data.map_data.map((r) => r.value).filter((v) => v > 0)
    return computeThresholds(values)
  }, [data.map_data])

  // Create projection and path generator for SVG
  const { projection, pathGenerator } = useMemo(() => {
    if (!geoData) return { projection: null, pathGenerator: null }

    // Create Mercator projection centered on Korea
    const proj = geoMercator()
      .center([127.5, 36.0])
      .scale(5000)
      .translate([400, 350])

    const path = geoPath().projection(proj)

    return { projection: proj, pathGenerator: path }
  }, [geoData])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGElement>) => {
    const svgRect = e.currentTarget.closest("svg")?.getBoundingClientRect()
    if (svgRect) {
      setTooltipPos({
        x: e.clientX - svgRect.left,
        y: e.clientY - svgRect.top,
      })
    }
  }, [])

  // Get our internal code from GeoJSON code
  const getInternalCode = (geoJsonCode: string): string => {
    return GEOJSON_CODE_MAP[geoJsonCode] || geoJsonCode
  }

  const selectedRow = selectedRegion ? valueMap.get(selectedRegion) : null
  const selectedInfo = selectedRegion ? getRegionByCode(selectedRegion) : null

  // Get hovered region info from KOSTAT code
  const hoveredInternalCode = hoveredRegion ? getInternalCode(hoveredRegion) : null
  const hoveredRow = hoveredInternalCode ? valueMap.get(hoveredInternalCode) : null
  const hoveredInfo = hoveredInternalCode ? getRegionByCode(hoveredInternalCode) : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">{"지도를 불러오는 중..."}</span>
      </div>
    )
  }

  return (
    <div className="flex gap-4">
      {/* Map Area (70%) */}
      <div className="flex-[7]">
        <Card className="border border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              {"시/도별 발생 현황 지도"}
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              {disease} &middot; {"최근 "}{days}{"일"} &middot; Choropleth Map
            </p>
          </CardHeader>
          <CardContent className="relative">
            <div className="relative">
              <svg
                viewBox="0 0 800 700"
                className="w-full"
                style={{ maxHeight: "560px" }}
              >
                {geoData && pathGenerator && geoData.features.map((feature) => {
                  const geoFeature = feature as unknown as GeoFeature
                  const kostatCode = geoFeature.properties.code
                  const internalCode = getInternalCode(kostatCode)
                  const row = valueMap.get(internalCode)
                  const value = row?.value ?? null
                  const fillColor = getColorForValue(value, thresholds)
                  const isSelected = selectedRegion === internalCode
                  const isHovered = hoveredRegion === kostatCode

                  return (
                    <g key={kostatCode}>
                      <path
                        d={pathGenerator(feature as Feature) || ""}
                        fill={fillColor}
                        stroke={
                          isSelected
                            ? "hsl(210, 55%, 48%)"
                            : isHovered
                              ? "hsl(210, 40%, 60%)"
                              : "hsl(210, 15%, 96%)"
                        }
                        strokeWidth={isSelected ? 2.5 : isHovered ? 1.8 : 0.8}
                        className="cursor-pointer transition-all duration-150"
                        onClick={() =>
                          onSelectRegion(isSelected ? null : internalCode)
                        }
                        onMouseEnter={() => setHoveredRegion(kostatCode)}
                        onMouseLeave={() => setHoveredRegion(null)}
                        onMouseMove={handleMouseMove}
                      />
                    </g>
                  )
                })}
              </svg>

              {/* Tooltip overlay */}
              {hoveredRegion && hoveredInfo && (
                <div
                  className="pointer-events-none absolute z-10 rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
                  style={{
                    left: tooltipPos.x + 12,
                    top: tooltipPos.y - 10,
                    transform: "translateY(-100%)",
                  }}
                >
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {hoveredInfo?.nameKo ?? hoveredRegion}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {hoveredInfo?.nameEn}
                      </span>
                    </p>
                    {hoveredRow ? (
                      <>
                        <p className="text-xs text-muted-foreground">
                          {"발생: "}
                          <span className="font-semibold text-foreground">
                            {hoveredRow.value.toLocaleString()}
                          </span>
                          {"건"}
                        </p>
                        {hoveredRow.delta !== null && (
                          <p
                            className={cn(
                              "text-[10px] font-medium",
                              hoveredRow.delta > 0 && "text-destructive",
                              hoveredRow.delta < 0 && "text-accent",
                              hoveredRow.delta === 0 && "text-muted-foreground"
                            )}
                          >
                            {"증감: "}{hoveredRow.delta > 0 ? "+" : ""}{hoveredRow.delta}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[10px] text-muted-foreground">{"데이터 없음"}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="mt-4 flex items-center justify-center gap-1">
              <span className="mr-2 text-[10px] text-muted-foreground">{"낮음"}</span>
              {COLOR_SCALE.map((color, i) => (
                <div key={i} className="flex flex-col items-center">
                  <div
                    className="h-3.5 w-10 rounded-sm"
                    style={{ backgroundColor: color }}
                  />
                  <span className="mt-0.5 text-[8px] text-muted-foreground tabular-nums">
                    {thresholds[i]?.toLocaleString() ?? ""}
                  </span>
                </div>
              ))}
              <span className="ml-2 text-[10px] text-muted-foreground">{"높음"}</span>
              <div className="ml-3 flex items-center gap-1">
                <div
                  className="h-3.5 w-10 rounded-sm"
                  style={{ backgroundColor: NEUTRAL_COLOR }}
                />
                <span className="text-[9px] text-muted-foreground">N/A</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detail Panel (30%) */}
      <div className="flex-[3] flex flex-col gap-4">
        {/* Selected region info */}
        <Card className="border border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              {selectedInfo
                ? selectedInfo.nameKo
                : "지역 선택"}
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              {selectedInfo
                ? `${selectedInfo.nameEn} - Detail`
                : "지도에서 지역을 클릭하세요"}
            </p>
          </CardHeader>
          <CardContent>
            {selectedRow ? (
              <div className="flex flex-col gap-3">
                {/* Mini KPIs */}
                <div className="grid grid-cols-1 gap-2">
                  <MiniStat
                    label="누적 발생"
                    labelEn="Total"
                    value={selectedRow.value.toLocaleString()}
                    icon={Activity}
                  />
                  <MiniStat
                    label="일평균"
                    labelEn="Daily Avg"
                    value={Math.round(selectedRow.value / days).toLocaleString()}
                    icon={Calendar}
                  />
                  <MiniStat
                    label="증감"
                    labelEn="Delta"
                    value={
                      selectedRow.delta !== null
                        ? `${selectedRow.delta > 0 ? "+" : ""}${selectedRow.delta}`
                        : "N/A"
                    }
                    trend={
                      selectedRow.delta !== null
                        ? selectedRow.delta > 0
                          ? "up"
                          : selectedRow.delta < 0
                            ? "down"
                            : "flat"
                        : "flat"
                    }
                    icon={TrendingUp}
                  />
                  <MiniStat
                    label="순위"
                    labelEn="Rank"
                    value={`${selectedRow.rank} / ${data.map_data.length}`}
                    icon={Activity}
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-8 text-center">
                {"지도에서 시/도를 클릭하면"}<br />{"상세 정보가 표시됩니다."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Trend chart for selected region */}
        {selectedRegion && (
          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold text-foreground">
                {"추이"} ({selectedInfo?.nameKo})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.series}
                    margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: "hsl(215, 12%, 50%)" }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(215, 12%, 50%)" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(210, 55%, 48%)"
                      strokeWidth={2}
                      dot={{ r: 2, fill: "hsl(210, 55%, 48%)" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Region Ranking */}
        <Card className="border border-border bg-card flex-1 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-foreground">
              {"지역 랭킹"} TOP 10
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-y-auto max-h-[240px]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-muted/50 border-b border-border sticky top-0">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">{"지역"}</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">{"발생"}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.table.slice(0, 10).map((row) => {
                    const info = getRegionByCode(row.region_code)
                    const isHighlighted = selectedRegion === row.region_code
                    return (
                      <tr
                        key={row.region_code}
                        className={cn(
                          "border-t border-border cursor-pointer hover:bg-primary/[0.03] transition-colors",
                          isHighlighted && "bg-primary/[0.06]"
                        )}
                        onClick={() =>
                          onSelectRegion(isHighlighted ? null : row.region_code)
                        }
                      >
                        <td className="px-3 py-1.5">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[9px] font-semibold min-w-[20px] justify-center",
                              row.rank <= 3 && "bg-primary/10 text-primary"
                            )}
                          >
                            {row.rank}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 font-medium text-foreground">
                          {info?.nameKo ?? row.region_name}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-foreground">
                          {row.value.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MiniStat({
  label,
  labelEn,
  value,
  trend,
  icon: Icon,
}: {
  label: string
  labelEn: string
  value: string
  trend?: "up" | "down" | "flat"
  icon: React.ComponentType<{ className?: string }>
}) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/8">
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-[9px] text-muted-foreground">
          {label} <span className="opacity-60">{labelEn}</span>
        </p>
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold text-foreground">{value}</span>
          {trend && trend !== "flat" && (
            <TrendIcon
              className={cn(
                "h-3 w-3",
                trend === "up" && "text-destructive",
                trend === "down" && "text-accent"
              )}
            />
          )}
        </div>
      </div>
    </div>
  )
}
