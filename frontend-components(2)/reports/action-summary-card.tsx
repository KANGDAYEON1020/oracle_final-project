"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, TrendingUp, Users } from "lucide-react"
import type { ActionSummaryData } from "@/lib/report-types"

interface ActionSummaryCardProps {
    data: ActionSummaryData
}

function getIconForBullet(text: string) {
    if (text.includes('격리') || text.includes('Gap')) return AlertCircle
    if (text.includes('증가') || text.includes('추세')) return TrendingUp
    return Users
}

function getColorForBullet(text: string) {
    if (text.includes('격리 미조치') || text.includes('지연')) return 'text-red-500'
    if (text.includes('증가')) return 'text-orange-500'
    if (text.includes('감소') || text.includes('없음')) return 'text-green-500'
    return 'text-blue-500'
}

export function ActionSummaryCard({ data }: ActionSummaryCardProps) {
    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    Key Observations
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                    주요 관찰 사항 · Factual summary only, not clinical recommendations
                </p>
            </CardHeader>
            <CardContent>
                <ul className="space-y-3">
                    {data.bulletPoints.map((point, idx) => {
                        const Icon = getIconForBullet(point)
                        const colorClass = getColorForBullet(point)
                        return (
                            <li key={idx} className="flex items-start gap-2.5">
                                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${colorClass}`} />
                                <span className="text-sm text-foreground leading-relaxed">{point}</span>
                            </li>
                        )
                    })}
                </ul>
                {data.bulletPoints.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">특이 사항 없음</p>
                )}
            </CardContent>
        </Card>
    )
}
