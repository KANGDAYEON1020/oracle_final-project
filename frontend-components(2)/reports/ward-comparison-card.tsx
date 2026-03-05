"use client"

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { WardComparisonData } from "@/lib/report-types"

interface WardComparisonCardProps {
    data: WardComparisonData
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

export function WardComparisonCard({ data }: WardComparisonCardProps) {
    const chartData = data.wards.map(w => ({
        name: `${w.floor} ${w.name}`,
        events: w.events,
        mdro: w.mdro
    }))

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    Ward Comparison
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                    병동별 이벤트 비교 · Monthly period only
                </p>
            </CardHeader>
            <CardContent>
                <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 15%, 90%)" />
                            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }} />
                            <YAxis tick={{ fontSize: 10, fill: "hsl(215, 12%, 50%)" }} />
                            <Tooltip content={<ChartTooltip />} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Bar dataKey="events" name="Total Events" fill="hsl(210, 55%, 48%)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                            <Bar dataKey="mdro" name="MDRO" fill="hsl(175, 35%, 48%)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    )
}
