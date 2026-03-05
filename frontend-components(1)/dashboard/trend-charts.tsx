"use client"

import { useMemo } from "react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface DiseaseTrendPoint {
  period: string
  value: number
}

export interface DiseaseTrend {
  name: string
  current: number
  previous: number
  growthRate: number
  sparkline: DiseaseTrendPoint[]
}




interface MonthlyTrendChartProps {
  diseaseTrends?: DiseaseTrend[]
  loading?: boolean
  error?: string | null
}

function formatPeriodLabel(period: string): string {
  const text = String(period ?? "")
  if (/^\d{6,}$/.test(text)) {
    return `W${text.slice(-2)}`
  }
  return text || "-"
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string }) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
        <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
        {payload.map((item) => (
          <p key={item.name} className="text-xs text-muted-foreground">
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}: <span className="font-semibold text-foreground">{item.value}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
      {message}
    </div>
  )
}

const TREND_COLORS = [
  "hsl(210, 55%, 48%)",
  "hsl(175, 35%, 48%)",
  "hsl(35, 60%, 55%)",
  "hsl(0, 45%, 58%)",
  "hsl(270, 40%, 55%)",
]

const WEEKLY_TREND_NAMES = ["폐렴 (Pneumonia)", "소화기 (GI)", "요로감염 (UTI)", "진드기매개 (Tickborne)", "기타 (Others)"]

const WEEKLY_TREND_MOCK: Record<string, string | number>[] = [
  { week: "W1 (1/6)", "폐렴 (Pneumonia)": 5, "소화기 (GI)": 3, "요로감염 (UTI)": 2, "진드기매개 (Tickborne)": 1, "기타 (Others)": 1 },
  { week: "W2 (1/13)", "폐렴 (Pneumonia)": 7, "소화기 (GI)": 4, "요로감염 (UTI)": 3, "진드기매개 (Tickborne)": 2, "기타 (Others)": 2 },
  { week: "W3 (1/20)", "폐렴 (Pneumonia)": 6, "소화기 (GI)": 2, "요로감염 (UTI)": 4, "진드기매개 (Tickborne)": 1, "기타 (Others)": 2 },
  { week: "W4 (1/27)", "폐렴 (Pneumonia)": 9, "소화기 (GI)": 5, "요로감염 (UTI)": 3, "진드기매개 (Tickborne)": 3, "기타 (Others)": 2 },
  { week: "W5 (2/3)", "폐렴 (Pneumonia)": 8, "소화기 (GI)": 4, "요로감염 (UTI)": 2, "진드기매개 (Tickborne)": 2, "기타 (Others)": 3 },
  { week: "W6 (2/10)", "폐렴 (Pneumonia)": 11, "소화기 (GI)": 6, "요로감염 (UTI)": 3, "진드기매개 (Tickborne)": 2, "기타 (Others)": 3 },
  { week: "W7 (2/17)", "폐렴 (Pneumonia)": 9, "소화기 (GI)": 5, "요로감염 (UTI)": 4, "진드기매개 (Tickborne)": 1, "기타 (Others)": 2 },
  { week: "W8 (2/24)", "폐렴 (Pneumonia)": 7, "소화기 (GI)": 4, "요로감염 (UTI)": 3, "진드기매개 (Tickborne)": 2, "기타 (Others)": 1 },
]

export function WeeklyTrendChart({ loading = false, error = null }: { loading?: boolean; error?: string | null }) {
  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">주간 추이 (Weekly Trend)</CardTitle>
        <p className="text-[10px] text-muted-foreground">감염 유형별 주간 환자 수 (Top 5, Mock Data)</p>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] md:h-[240px] xl:h-[220px]">
          {loading ? (
            <EmptyState message="주간 추이 로딩 중..." />
          ) : error ? (
            <EmptyState message="주간 추이 데이터를 불러오지 못했습니다." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={WEEKLY_TREND_MOCK} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(value: string) => <span className="text-[10px] text-foreground">{value}</span>}
                />
                {WEEKLY_TREND_NAMES.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    name={name}
                    stroke={TREND_COLORS[i % TREND_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2, fill: TREND_COLORS[i % TREND_COLORS.length] }}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const WEEKLY_MOCK_DATA = [
  { week: "W1 (1/6)", count: 12 },
  { week: "W2 (1/13)", count: 18 },
  { week: "W3 (1/20)", count: 15 },
  { week: "W4 (1/27)", count: 22 },
  { week: "W5 (2/3)", count: 19 },
  { week: "W6 (2/10)", count: 25 },
  { week: "W7 (2/17)", count: 21 },
  { week: "W8 (2/24)", count: 17 },
]

export function MonthlyTrendChart({ loading = false, error = null }: { loading?: boolean; error?: string | null }) {
  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-foreground">주간 전체 추이 (Weekly Total)</CardTitle>
        <p className="text-[10px] text-muted-foreground">전체 감염 유형 주간 합계 (Mock Data)</p>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] md:h-[240px] xl:h-[220px]">
          {loading ? (
            <EmptyState message="주간 추이 로딩 중..." />
          ) : error ? (
            <EmptyState message="주간 추이 데이터를 불러오지 못했습니다." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={WEEKLY_MOCK_DATA} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="count"
                  name="발생 건수 (Events)"
                  fill="hsl(210, 55%, 48%)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
