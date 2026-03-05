"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EventsByTypeData } from "@/lib/report-types"

interface EventsByTypeCardProps {
    data: EventsByTypeData
}

const COLORS = [
    "hsl(210, 55%, 48%)",
    "hsl(175, 35%, 48%)",
    "hsl(220, 25%, 35%)",
    "hsl(35, 60%, 55%)",
    "hsl(0, 45%, 58%)"
]

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { type: string; typeKo: string; count: number; percentage: number } }> }) {
    if (active && payload && payload.length) {
        const d = payload[0].payload
        return (
            <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
                <p className="text-sm font-medium text-foreground">{d.type}</p>
                <p className="text-xs text-muted-foreground">{d.typeKo}</p>
                <p className="text-sm font-bold text-foreground">{d.count} events ({d.percentage}%)</p>
            </div>
        )
    }
    return null
}

export function EventsByTypeCard({ data }: EventsByTypeCardProps) {
    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    Infection Monitoring Events by Type
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                    감염 유형별 모니터링 이벤트 · Counts represent infection monitoring events, not confirmed diagnoses.
                </p>
            </CardHeader>
            <CardContent>
                <div className="flex items-center gap-6">
                    <div className="h-[180px] w-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={data.categories}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={3}
                                    dataKey="count"
                                    nameKey="type"
                                    stroke="none"
                                >
                                    {data.categories.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip content={<CustomTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-2">
                        {data.categories.map((item, i) => (
                            <div key={item.type} className="flex items-center gap-2.5">
                                <div
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: COLORS[i] }}
                                />
                                <span className="w-20 text-xs text-foreground">{item.type}</span>
                                <span className="w-16 text-xs text-muted-foreground">{item.typeKo}</span>
                                <span className="ml-auto text-xs font-semibold text-foreground">{item.count}</span>
                                <span className="text-[10px] text-muted-foreground w-10 text-right">
                                    ({item.percentage}%)
                                </span>
                            </div>
                        ))}
                        <div className="border-t border-border pt-2 mt-1">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground">Total</span>
                                <span className="text-xs font-bold text-foreground">{data.total}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
