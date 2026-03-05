"use client"

import { useState, useMemo } from "react"
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
import { ChevronUp, ChevronDown, TrendingUp, TrendingDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { getRegionByCode } from "@/lib/region-mapping"
import type { InfectionSummaryResponse } from "@/lib/types"

interface ListViewProps {
  data: InfectionSummaryResponse
  selectedRegion: string | null
  onSelectRegion: (code: string | null) => void
  days: number
}

type SortKey = "rank" | "region_name" | "value" | "delta"
type SortDir = "asc" | "desc"

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; color: string }>
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

export function InfectionListView({ data, selectedRegion, onSelectRegion, days }: ListViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("rank")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir(key === "value" || key === "delta" ? "desc" : "asc")
    }
  }

  const sortedTable = useMemo(() => {
    const rows = [...data.table]
    rows.sort((a, b) => {
      let aVal: string | number = a[sortKey] ?? 0
      let bVal: string | number = b[sortKey] ?? 0
      if (sortKey === "region_name") {
        const aInfo = getRegionByCode(a.region_code)
        const bInfo = getRegionByCode(b.region_code)
        aVal = aInfo?.nameKo ?? a.region_name
        bVal = bInfo?.nameKo ?? b.region_name
      }
      if (typeof aVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal)
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
    })
    return rows
  }, [data.table, sortKey, sortDir])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return null
    return sortDir === "asc" ? (
      <ChevronUp className="ml-0.5 inline h-3 w-3" />
    ) : (
      <ChevronDown className="ml-0.5 inline h-3 w-3" />
    )
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Table (left 2 cols) */}
      <div className="col-span-2">
        <Card className="border border-border bg-card overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              {"지역별 발생 현황"}
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              Regional Cases Ranking &middot; {"최근 "}{days}{"일"}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    {([
                      { key: "rank" as SortKey, label: "순위", labelEn: "Rank" },
                      { key: "region_name" as SortKey, label: "지역", labelEn: "Region" },
                      { key: "value" as SortKey, label: "발생건수", labelEn: "Cases" },
                      { key: "delta" as SortKey, label: "증감", labelEn: "Delta" },
                    ]).map((col) => (
                      <th
                        key={col.key}
                        className="cursor-pointer px-4 py-3 text-left font-medium text-muted-foreground select-none transition-colors hover:text-foreground"
                        onClick={() => handleSort(col.key)}
                      >
                        <span>{col.label}</span>
                        <SortIcon col={col.key} />
                        <span className="ml-1 text-[9px] opacity-50">{col.labelEn}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedTable.map((row) => {
                    const regionInfo = getRegionByCode(row.region_code)
                    const isSelected = selectedRegion === row.region_code
                    return (
                      <tr
                        key={row.region_code}
                        className={cn(
                          "cursor-pointer border-t border-border transition-colors hover:bg-primary/[0.03]",
                          isSelected && "bg-primary/[0.06]"
                        )}
                        onClick={() => onSelectRegion(isSelected ? null : row.region_code)}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px] font-semibold min-w-[24px] justify-center",
                              row.rank <= 3 && "bg-primary/10 text-primary"
                            )}
                          >
                            {row.rank}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="font-medium text-foreground">
                              {regionInfo?.nameKo ?? row.region_name}
                            </span>
                            <span className="ml-1.5 text-[10px] text-muted-foreground">
                              {regionInfo?.nameEn ?? ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-foreground tabular-nums">
                          {row.value.toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          {row.delta !== null ? (
                            <span
                              className={cn(
                                "flex items-center gap-0.5 text-xs font-medium",
                                row.delta > 0 && "text-destructive",
                                row.delta < 0 && "text-accent",
                                row.delta === 0 && "text-muted-foreground"
                              )}
                            >
                              {row.delta > 0 ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : row.delta < 0 ? (
                                <TrendingDown className="h-3 w-3" />
                              ) : null}
                              {row.delta > 0 ? "+" : ""}
                              {row.delta}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
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

      {/* Trend Chart (right col) */}
      <div>
        <Card className="border border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">
              {"발생 추이"}
            </CardTitle>
            <p className="text-[10px] text-muted-foreground">
              {selectedRegion
                ? `${getRegionByCode(selectedRegion)?.nameKo ?? selectedRegion} - `
                : ""}
              {"최근 "}{days}{"일 Trend"}
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="hsl(210, 55%, 48%)"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: "hsl(210, 55%, 48%)" }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
