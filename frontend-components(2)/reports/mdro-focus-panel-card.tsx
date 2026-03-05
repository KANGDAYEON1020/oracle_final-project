"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { MdroFocusData, ReportPeriod } from "@/lib/report-types"

interface MdroFocusPanelCardProps {
    data: MdroFocusData
    period: ReportPeriod
}

export function MdroFocusPanelCard({ data, period }: MdroFocusPanelCardProps) {
    const periodLabel = period === '7d' ? '7일' : period === '1M' ? '1개월' : period === '3M' ? '3개월' : '연간'

    return (
        <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground">
                    MDRO Focus Panel
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">
                    다제내성균 집중 관리 현황 · Snapshot + {periodLabel} 기간 데이터
                </p>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="text-left py-2 px-1 font-medium text-muted-foreground">Organism</th>
                                <th className="text-center py-2 px-1 font-medium text-muted-foreground" title="현재 관리 중">
                                    관리 중
                                    <span className="block text-[9px] font-normal">(현재)</span>
                                </th>
                                <th className="text-center py-2 px-1 font-medium text-muted-foreground" title="격리 미조치">
                                    격리Gap
                                    <span className="block text-[9px] font-normal">(현재)</span>
                                </th>
                                <th className="text-center py-2 px-1 font-medium text-muted-foreground" title="기간 내 신규">
                                    신규
                                    <span className="block text-[9px] font-normal">({periodLabel})</span>
                                </th>
                                <th className="text-center py-2 px-1 font-medium text-muted-foreground" title="기간 내 지연이벤트">
                                    지연
                                    <span className="block text-[9px] font-normal">({periodLabel})</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.organisms.map((org) => (
                                <tr key={org.type} className="border-b border-border/50 last:border-0">
                                    <td className="py-2.5 px-1">
                                        <div className="flex items-center gap-2">
                                            <Badge
                                                variant={org.type === 'CRE' ? 'destructive' : org.type === 'VRE' ? 'default' : 'secondary'}
                                                className="text-[10px] px-1.5 py-0"
                                            >
                                                {org.type}
                                            </Badge>
                                            <span className="text-muted-foreground text-[10px] hidden sm:inline">{org.typeKo}</span>
                                        </div>
                                    </td>
                                    <td className="text-center py-2.5 px-1 font-semibold text-foreground">
                                        {org.underManagement}
                                    </td>
                                    <td className="text-center py-2.5 px-1">
                                        {org.openIsolationGap > 0 ? (
                                            <span className="text-red-500 font-bold">{org.openIsolationGap}</span>
                                        ) : (
                                            <span className="text-green-500">0</span>
                                        )}
                                    </td>
                                    <td className="text-center py-2.5 px-1 text-foreground">
                                        {org.newInPeriod}
                                    </td>
                                    <td className="text-center py-2.5 px-1">
                                        {org.delayEventsInPeriod > 0 ? (
                                            <span className="text-orange-500">{org.delayEventsInPeriod}</span>
                                        ) : (
                                            <span className="text-muted-foreground">0</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="bg-muted/30">
                                <td className="py-2 px-1 font-medium text-foreground">Total</td>
                                <td className="text-center py-2 px-1 font-bold text-foreground">
                                    {data.organisms.reduce((s, o) => s + o.underManagement, 0)}
                                </td>
                                <td className="text-center py-2 px-1 font-bold">
                                    {data.organisms.reduce((s, o) => s + o.openIsolationGap, 0) > 0 ? (
                                        <span className="text-red-500">{data.organisms.reduce((s, o) => s + o.openIsolationGap, 0)}</span>
                                    ) : (
                                        <span className="text-green-500">0</span>
                                    )}
                                </td>
                                <td className="text-center py-2 px-1 font-semibold text-foreground">
                                    {data.organisms.reduce((s, o) => s + o.newInPeriod, 0)}
                                </td>
                                <td className="text-center py-2 px-1 font-semibold text-orange-500">
                                    {data.organisms.reduce((s, o) => s + o.delayEventsInPeriod, 0)}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </CardContent>
        </Card>
    )
}
