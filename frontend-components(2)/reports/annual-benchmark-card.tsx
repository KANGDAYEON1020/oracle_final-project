"use client"

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { AnnualBenchmarkData } from "@/lib/report-types"

interface AnnualBenchmarkCardProps {
    data: AnnualBenchmarkData
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
    if (active && payload && payload.length) {
        return (
            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
                <p className="text-xs font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">
                    Rate: <span className="font-semibold text-foreground">{payload[0].value}%</span>
                </p>
            </div>
        )
    }
    return null
}

export function AnnualBenchmarkCard({ data }: AnnualBenchmarkCardProps) {
    const avgRate = data.internalTrend.reduce((s, d) => s + d.rate, 0) / data.internalTrend.length

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-foreground">
                        Annual Benchmark
                    </CardTitle>
                    {data.externalBenchmark && (
                        <Badge variant="outline" className="text-[10px]">
                            External: {data.externalBenchmark}%
                        </Badge>
                    )}
                </div>
                <p className="text-[10px] text-muted-foreground">
                    연간 벤치마크 · Internal trend vs external reference (placeholder)
                </p>
            </CardHeader>
            <CardContent>
                <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.internalTrend} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                            <XAxis dataKey="month" tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }} />
                            <YAxis
                                tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }}
                                domain={[0, 'dataMax + 1']}
                                tickFormatter={(v) => `${v}%`}
                            />
                            <Tooltip content={<ChartTooltip />} />
                            {data.externalBenchmark && (
                                <ReferenceLine
                                    y={data.externalBenchmark}
                                    stroke="hsl(0, 60%, 50%)"
                                    strokeDasharray="5 5"
                                    label={{ value: 'Ext', position: 'right', fontSize: 9, fill: 'hsl(0, 60%, 50%)' }}
                                />
                            )}
                            <Line
                                type="monotone"
                                dataKey="rate"
                                stroke="hsl(210, 55%, 48%)"
                                strokeWidth={2}
                                dot={{ r: 3, fill: "hsl(210, 55%, 48%)" }}
                                activeDot={{ r: 5 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Internal Avg: <span className="font-semibold text-foreground">{avgRate.toFixed(2)}%</span></span>
                    {data.externalBenchmark && (
                        <span className={avgRate < data.externalBenchmark ? 'text-green-500' : 'text-orange-500'}>
                            {avgRate < data.externalBenchmark ? '✓ Below benchmark' : '↑ Above benchmark'}
                        </span>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
