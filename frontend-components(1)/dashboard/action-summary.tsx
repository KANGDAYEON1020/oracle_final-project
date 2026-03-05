"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText } from "lucide-react"
import type { DiseaseTrend } from "@/components/dashboard/trend-charts"

interface ActionSummaryProps {
  totalCases: number | null
  latestDayCases: number | null
  deltaRate: number | null
  topDisease: DiseaseTrend | null
  loading?: boolean
  error?: string | null
}

function formatSignedPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}

export function ActionSummary({
  totalCases,
  latestDayCases,
  deltaRate,
  topDisease,
  loading = false,
  error = null,
}: ActionSummaryProps) {
  const hasData = totalCases != null && totalCases > 0

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-semibold text-foreground">조치 요약 (Action Summary)</CardTitle>
        </div>
        <p className="text-[10px] text-muted-foreground">환자 데이터 기반 운영 요약</p>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">요약 데이터를 불러오는 중입니다...</p>
          ) : error ? (
            <p className="text-sm text-muted-foreground">요약 데이터를 불러오지 못했습니다.</p>
          ) : !hasData ? (
            <p className="text-sm text-muted-foreground">표시 가능한 운영 요약 데이터가 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm text-foreground leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                최근 기간 총 이벤트 {totalCases}건, 일평균 {latestDayCases ?? 0}건
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                전 기간 대비 변화율 {formatSignedPercent(deltaRate)}
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-destructive/70" />
                최다 질환: {topDisease?.name ?? "N/A"} ({topDisease ? `${topDisease.current}건` : "N/A"})
              </li>
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
