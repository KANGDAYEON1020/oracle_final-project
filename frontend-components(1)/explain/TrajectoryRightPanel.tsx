"use client"

import * as React from "react"
import { useMemo, useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { RangeType } from "@/lib/explain-types"
import { TimelineEvent, TimelineTag } from "@/components/patient/trajectory-timeline"
import { ExternalLink, Info } from "lucide-react"

// Types
export interface TrajectoryRightPanelProps {
    events: TimelineEvent[]
    range: RangeType
    activeBinKey: string | null
    onBinClick: (binKey: string) => void
    selectedEventId: string | null
    onSelectEvent: (event: TimelineEvent) => void
}

interface BinData {
    key: string
    startMs: number
    endMs: number
    labelKo: string // e.g., "15일 07-10시" or "07-10시"
    startHour: number
    event_count: number
    worsen_count: number
    improve_count: number
    net: number // worsen - improve
    events: TimelineEvent[]
}

// ── Configuration ─────────────────────────────────────
const BIN_CONFIG: Record<RangeType, { totalHours: number; binHours: number }> = {
    "24h": { totalHours: 24, binHours: 1 },
    "72h": { totalHours: 72, binHours: 3 },
    "7d": { totalHours: 168, binHours: 12 },
}

function formatBinLabel(startMs: number, endMs: number, range: RangeType): string {
    const start = new Date(startMs)
    const end = new Date(endMs)
    // Check validity
    if (Number.isNaN(start.getTime())) return "-"

    const h1 = start.getHours().toString().padStart(2, "0")
    const h2 = end.getHours().toString().padStart(2, "0")
    const dayStr = start.getDate() + "일"

    if (range === "24h") {
        // Just time
        return `${h1}-${h2}시`
    } else if (range === "7d") {
        if (start.getHours() === 0 && end.getHours() === 12) {
            return `${dayStr} 오전`
        } else {
            return `${dayStr} 오후`
        }
    } else {
        // 72h: Day + Time
        return `${dayStr} ${h1}-${h2}시`
    }
}

function getNetColorClass(net: number, count: number, isActive: boolean): string {
    if (count === 0) return "bg-muted/30 border-transparent hover:bg-muted/50"

    // Worsen
    if (net > 0) {
        if (net >= 4) return "bg-red-600 border-red-700/50"
        if (net >= 2) return "bg-red-500/80 border-red-600/40"
        return "bg-red-400/60 border-red-500/30"
    }

    // Improve
    if (net < 0) {
        if (net <= -4) return "bg-emerald-600 border-emerald-700/50"
        if (net <= -2) return "bg-emerald-500/80 border-emerald-600/40"
        return "bg-emerald-400/60 border-emerald-500/30"
    }

    // Neutral (events exist, but net is 0)
    return "bg-slate-300 border-slate-400/30 dark:bg-slate-700 dark:border-slate-600/30"
}

export function TrajectoryRightPanel({
    events,
    range,
    activeBinKey,
    onBinClick,
    selectedEventId,
    onSelectEvent,
}: TrajectoryRightPanelProps) {

    // 1. Process Data & Bins
    const bins = useMemo(() => {
        const config = BIN_CONFIG[range]
        const totalMs = config.totalHours * 60 * 60 * 1000
        const binMs = config.binHours * 60 * 60 * 1000
        const binCount = Math.max(1, Math.ceil(totalMs / binMs))

        const endMs = events.length > 0 ? Math.max(...events.map((e) => e.tsMs)) : Date.now()
        const startMs = endMs - totalMs

        // Initialize bins
        const newBins: BinData[] = Array.from({ length: binCount }, (_, i) => {
            const bStart = startMs + i * binMs
            const bEnd = bStart + binMs
            return {
                key: `${bStart}-${bEnd}`,
                startMs: bStart,
                endMs: bEnd,
                labelKo: formatBinLabel(bStart, bEnd, range),
                startHour: new Date(bStart).getHours(),
                event_count: 0,
                worsen_count: 0,
                improve_count: 0,
                net: 0,
                events: [],
            }
        })

        // Distribute events
        events.forEach(event => {
            if (event.tsMs < startMs || event.tsMs > endMs) return
            let idx = Math.floor((event.tsMs - startMs) / binMs)
            if (idx >= binCount) idx = binCount - 1
            if (idx < 0) idx = 0

            const bin = newBins[idx]
            bin.events.push(event)
            bin.event_count++

            const isWorsen = event.tags?.some(t => t.label === "악화")
            const isImprove = event.tags?.some(t => t.label === "호전")

            if (isWorsen) bin.worsen_count++
            if (isImprove) bin.improve_count++
            bin.net = bin.worsen_count - bin.improve_count
        })

        // Sort events in each bin (newest first)
        newBins.forEach(b => {
            b.events.sort((a, b) => b.tsMs - a.tsMs)
        })

        return newBins
    }, [events, range])

    // 2. Compute Summary Line
    const summaryLine = useMemo(() => {
        if (bins.every(b => b.event_count === 0)) {
            return "해당 기간에 기록된 이벤트가 없습니다."
        }

        let maxWorsenBin = bins[0]
        let maxImproveBin = bins[0]
        let maxEventBin = bins[0]

        bins.forEach(b => {
            if (b.worsen_count > maxWorsenBin.worsen_count) maxWorsenBin = b
            if (b.improve_count > maxImproveBin.improve_count) maxImproveBin = b
            if (b.event_count > maxEventBin.event_count) maxEventBin = b
        })

        if (maxWorsenBin.worsen_count > 0) {
            return `악화가 ${maxWorsenBin.labelKo}에 집중(${maxWorsenBin.worsen_count}건)`
        } else if (maxImproveBin.improve_count > 0) {
            return `호전이 ${maxImproveBin.labelKo}에 발생(${maxImproveBin.improve_count}건)`
        } else {
            return `변화가 가장 많은 시간대: ${maxEventBin.labelKo}(총 ${maxEventBin.event_count}건)`
        }
    }, [bins])

    const activeBin = useMemo(() => bins.find(b => b.key === activeBinKey) || null, [bins, activeBinKey])

    const drilldownRef = useRef<HTMLDivElement>(null)

    // Wait to scroll to selected item on drilldown open
    useEffect(() => {
        if (activeBin && selectedEventId && drilldownRef.current) {
            const el = drilldownRef.current.querySelector(`[data-event-id="${selectedEventId}"]`)
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "nearest" })
            }
        }
    }, [activeBin, selectedEventId])

    return (
        <div className="flex flex-1 flex-col h-full bg-card min-h-0 min-w-0 font-sans p-4 md:p-5 xl:p-6 gap-4">

            {/* ── Header: Title & Legend ── */}
            <div className="flex flex-col gap-1.5 shrink-0">
                <div className="flex items-center justify-between">
                    <h2 className="text-[13px] font-bold text-foreground">
                        {range === "24h" ? "24시간" : range === "72h" ? "72시간" : "7일"} 변화 분포
                    </h2>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-700" />기록</div>
                        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />악화</div>
                        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />호전</div>
                    </div>
                </div>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Info className="w-3 h-3 text-muted-foreground/70" />
                    색이 진할수록 해당 시간대에 변화가 많습니다.
                </p>
            </div>

            {/* ── Top Panel: Summary & Strip ── */}
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3 shrink-0">
                <div className="text-[12px] font-semibold text-foreground leading-snug">
                    {summaryLine}
                </div>

                {/* Strip Container */}
                <div className="flex flex-col gap-1 w-full">
                    <div className="flex items-stretch gap-[2px] h-6 w-full">
                        {bins.map((bin) => {
                            const isActive = activeBinKey === bin.key
                            const colorClass = getNetColorClass(bin.net, bin.event_count, isActive)
                            return (
                                <button
                                    key={bin.key}
                                    type="button"
                                    onClick={() => onBinClick(bin.key)}
                                    className={cn(
                                        "flex-1 rounded-[2px] border transition-all duration-200 outline-none",
                                        colorClass,
                                        isActive ? "ring-2 ring-primary ring-offset-1 ring-offset-background scale-y-110 z-10" : "hover:opacity-80"
                                    )}
                                    title={`${bin.labelKo}: 총 ${bin.event_count}건 (악화 ${bin.worsen_count}건, 호전 ${bin.improve_count}건)`}
                                    aria-label={`Select bin ${bin.labelKo}`}
                                />
                            )
                        })}
                    </div>

                    {/* X-axis Labels (Minimal) */}
                    <div className="flex justify-between text-[9px] text-muted-foreground font-medium px-0.5">
                        {bins.length > 0 && <span>{new Date(bins[0].startMs).getHours()}:00</span>}
                        {bins.length > Math.floor(bins.length / 2) && <span>{new Date(bins[Math.floor(bins.length / 2)].startMs).getHours()}:00</span>}
                        {bins.length > 0 && <span>현재</span>}
                    </div>
                </div>
            </div>

            {/* ── Bottom Panel: Drilldown ── */}
            <div className="flex flex-col min-h-0 flex-1 border border-border rounded-lg bg-background overflow-hidden">
                {!activeBin ? (
                    <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-[12px]">
                        시간대를 선택하면 해당 구간의<br />이벤트와 근거를 보여줍니다.
                    </div>
                ) : (
                    <div className="flex flex-col h-full min-h-0 bg-accent/20">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 shrink-0">
                            <span className="text-[12px] font-bold text-foreground">
                                {activeBin.labelKo} <span className="text-muted-foreground font-normal ml-1">({activeBin.event_count}건)</span>
                            </span>
                            <button
                                type="button"
                                className="text-[10px] flex items-center gap-1 font-medium text-primary hover:underline"
                            >
                                전체 원문 보기 <ExternalLink className="w-3 h-3" />
                            </button>
                        </div>

                        <ScrollArea className="flex-1 min-h-0" ref={drilldownRef}>
                            <div className="p-2 space-y-1.5 flex flex-col">
                                {activeBin.events.length === 0 ? (
                                    <div className="text-[11px] text-muted-foreground p-4 text-center">
                                        선택한 시간대에 이벤트가 없습니다.
                                    </div>
                                ) : (
                                    activeBin.events.map((event) => {
                                        const isSelected = selectedEventId === event.id
                                        return (
                                            <DrilldownRow
                                                key={event.id}
                                                event={event}
                                                isSelected={isSelected}
                                                onClick={() => onSelectEvent(event)}
                                            />
                                        )
                                    })
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                )}
            </div>

        </div>
    )
}

function DrilldownRow({ event, isSelected, onClick }: { event: TimelineEvent, isSelected: boolean, onClick: () => void }) {
    return (
        <div
            role="button"
            tabIndex={0}
            data-event-id={event.id}
            onClick={onClick}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
            className={cn(
                "flex flex-col gap-1.5 p-2.5 rounded-md border text-left cursor-pointer transition-all",
                isSelected
                    ? "border-primary/40 bg-primary/[0.04] shadow-sm ring-1 ring-primary/20"
                    : "border-border bg-card hover:border-border hover:bg-muted/60"
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span className="text-[11px] font-mono font-bold text-foreground bg-muted px-1 rounded flex-shrink-0">
                        {event.time}
                    </span>
                    <span className="text-[12px] font-semibold text-foreground truncate max-w-[120px]" title={event.eventLabel}>
                        {event.eventLabel}
                    </span>

                    {event.tags?.filter(t => ["악화", "호전", "주의"].includes(t.label)).slice(0, 2).map((tag, i) => (
                        <span
                            key={i}
                            className={cn(
                                "inline-flex flex-shrink-0 items-center rounded border px-1 py-px text-[9px] font-semibold tracking-wide",
                                tag.label === "악화" && "border-red-500/30 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
                                tag.label === "호전" && "border-emerald-500/30 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
                                tag.label === "주의" && "border-orange-400/30 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400"
                            )}
                        >
                            {tag.label}
                        </span>
                    ))}
                </div>
                <span className="text-[10px] text-muted-foreground/80 flex-shrink-0 border border-border bg-muted/40 rounded px-1 max-w-[60px] truncate" title={event.docType}>
                    {event.docType}
                </span>
            </div>

            <div className="text-[11px] text-muted-foreground/90 pl-1 border-l-2 border-muted leading-tight line-clamp-2 italic">
                {event.evidence.sentence}
            </div>
        </div>
    )
}
