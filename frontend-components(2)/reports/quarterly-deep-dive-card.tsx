"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock, CheckCircle, TrendingUp } from "lucide-react"
import type { QuarterlyDeepDiveData } from "@/lib/report-types"

interface QuarterlyDeepDiveCardProps {
    data: QuarterlyDeepDiveData
}

export function QuarterlyDeepDiveCard({ data }: QuarterlyDeepDiveCardProps) {
    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    Quarterly Deep Dive
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                    분기 심층 분석 · Proxy metrics only
                </p>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                        <Clock className="h-5 w-5 text-blue-500" />
                        <div>
                            <p className="text-xs text-muted-foreground">Avg. Length of Stay</p>
                            <p className="text-lg font-bold text-foreground">{data.avgLengthOfStay}일</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        <div>
                            <p className="text-xs text-muted-foreground">Isolation Compliance</p>
                            <p className="text-lg font-bold text-foreground">{data.isolationComplianceRate}%</p>
                        </div>
                    </div>
                </div>

                <div>
                    <p className="text-xs font-medium text-foreground mb-2 flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        Top Event Types (분기)
                    </p>
                    <div className="space-y-2">
                        {data.topEventTypes.map((item, idx) => (
                            <div key={item.type} className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                                    {idx + 1}
                                </span>
                                <span className="text-xs text-foreground flex-1">{item.type}</span>
                                <span className="text-[10px] text-muted-foreground">{item.typeKo}</span>
                                <span className="text-xs font-semibold text-foreground">{item.count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
