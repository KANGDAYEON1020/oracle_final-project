"use client"

import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { TrendChartData, ReportPeriod } from "@/lib/report-types"

interface TrendChartCardProps {
    data: TrendChartData
    period: ReportPeriod
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string }) {
    if (active && payload && payload.length) {
        return (
            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
                <p className="mb-1 text-xs font-medium text-foreground">{label}</p>
                {payload.map((p) => (
                    <p key={p.name} className="text-xs text-muted-foreground">
                        <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: p.color }} />
                        {p.name}: <span className="font-semibold text-foreground">{p.value}</span>
                    </p>
                ))}
            </div>
        )
    }
    return null
}

function getBucketLabel(bucket: TrendChartData['bucket']): string {
    return bucket === 'day' ? '일별' : bucket === 'week' ? '주별' : '월별'
}

export function TrendChartCard({ data, period }: TrendChartCardProps) {
    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    Monitoring Event Trend
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                    {getBucketLabel(data.bucket)} 추이 · Total events with MDRO overlay
                </p>
            </CardHeader>
            <CardContent>
                <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.dataPoints} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }} />
                            <YAxis tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend
                                wrapperStyle={{ fontSize: 11 }}
                                formatter={(value: string) => <span className="text-xs text-foreground">{value}</span>}
                            />
                            <Line
                                type="monotone"
                                dataKey="total"
                                name="Total Events"
                                stroke="hsl(210, 55%, 48%)"
                                strokeWidth={2}
                                dot={{ r: 3, fill: "hsl(210, 55%, 48%)" }}
                                activeDot={{ r: 5 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="mdro"
                                name="MDRO Events"
                                stroke="hsl(175, 35%, 48%)"
                                strokeWidth={2}
                                strokeDasharray="5 5"
                                dot={{ r: 3, fill: "hsl(175, 35%, 48%)" }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    )
}
