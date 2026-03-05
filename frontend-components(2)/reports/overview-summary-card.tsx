"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldAlert, Activity, AlertTriangle, ArrowRightLeft, TrendingUp, TrendingDown, Minus } from "lucide-react"
import type { OverviewSummaryData } from "@/lib/report-types"

interface OverviewSummaryCardProps {
    data: OverviewSummaryData
}

function TrendIndicator({ value, suffix = "" }: { value: number; suffix?: string }) {
    if (value === 0) {
        return (
            <span className="flex items-center text-xs text-muted-foreground">
                <Minus className="h-3 w-3 mr-0.5" />
                0{suffix}
            </span>
        )
    }

    const isPositive = value > 0
    return (
        <span className={`flex items-center text-xs ${isPositive ? 'text-orange-500' : 'text-green-500'}`}>
            {isPositive ? (
                <TrendingUp className="h-3 w-3 mr-0.5" />
            ) : (
                <TrendingDown className="h-3 w-3 mr-0.5" />
            )}
            {isPositive ? '+' : ''}{value}{suffix}
        </span>
    )
}

export function OverviewSummaryCard({ data }: OverviewSummaryCardProps) {
    const metrics = [
        {
            title: "MDRO Patients",
            titleKo: "다제내성균 관리 환자",
            value: data.mdroUnderManagement,
            icon: ShieldAlert,
            isSnapshot: true,
            iconColor: "text-purple-500"
        },
        {
            title: "Monitoring Events",
            titleKo: "모니터링 이벤트",
            value: data.monitoringEvents,
            delta: data.monitoringEventsDelta,
            icon: Activity,
            isSnapshot: false,
            iconColor: "text-blue-500"
        },
        {
            title: "Isolation Gap Cases",
            titleKo: "격리 지연 사례",
            value: data.openIsolationGapCases,
            icon: AlertTriangle,
            isSnapshot: true,
            iconColor: data.openIsolationGapCases > 0 ? "text-red-500" : "text-green-500"
        },
        {
            title: "Infection Transfers",
            titleKo: "감염 관련 전동",
            value: data.infectionTransfers,
            delta: data.transfersDelta,
            icon: ArrowRightLeft,
            isSnapshot: false,
            iconColor: "text-teal-500"
        }
    ]

    return (
        <div className="grid grid-cols-4 gap-4">
            {metrics.map((metric) => {
                const Icon = metric.icon
                return (
                    <Card key={metric.title} className="border border-border bg-card">
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-xs font-medium text-muted-foreground">
                                {metric.title}
                                {metric.isSnapshot && (
                                    <span className="ml-1 text-[10px] text-muted-foreground/60">(현재)</span>
                                )}
                            </CardTitle>
                            <Icon className={`h-4 w-4 ${metric.iconColor}`} />
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-foreground">{metric.value}</span>
                                {metric.delta !== undefined && (
                                    <TrendIndicator value={metric.delta} />
                                )}
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">{metric.titleKo}</p>
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}
