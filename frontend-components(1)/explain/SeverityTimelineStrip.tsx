"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { SEVERITY_COLOR, StripBin } from "@/lib/explain-types"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

interface SeverityTimelineStripProps {
    bins: StripBin[]
    selectedBin: string | null
    hoveredBin: string | null
    onBinClick: (binStart: string) => void
    onBinHover?: (binStart: string | null) => void
    className?: string
}

function formatBinTime(iso: string): string {
    try {
        const d = new Date(iso)
        const month = d.getMonth() + 1
        const day = d.getDate()
        const hh = String(d.getHours()).padStart(2, "0")
        return `${month}/${day} ${hh}시`
    } catch {
        return iso
    }
}

// Fixed Dot size for cleaner look, or slight variation
function getDotSize(count: number): string {
    if (count >= 5) return "h-3.5 w-3.5"
    if (count >= 3) return "h-3 w-3"
    return "h-2.5 w-2.5"
}

// Map severity to reference image categories
// High Severity (Red), Warning (Orange), Routine (Grey)
function getVisualSeverity(severity: string) {
    switch (severity) {
        case "critical":
        case "high":
            return { label: "High Severity", color: "#EF4444" } // Red-500
        case "medium":
            return { label: "Warning", color: "#F97316" } // Orange-500
        case "low":
        case "info":
        case "none":
        default:
            return { label: "Routine", color: "#9CA3AF" } // Gray-400
    }
}

export function SeverityTimelineStrip({
    bins,
    selectedBin,
    onBinClick,
    onBinHover,
    className,
}: SeverityTimelineStripProps) {
    if (bins.length === 0) {
        return (
            <div className={cn("rounded-xl border border-border bg-card px-4 py-2", className)}>
                <p className="text-xs text-muted-foreground">시간대별 정보가 없습니다.</p>
            </div>
        )
    }

    // Calculate relative day labels (D-3, D-2, D-1, Today)
    // Assuming bins are sorted and end at "Now"
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

    // Helper to check if a bin is the start of a new day (approximate for labeling)
    const getDayLabel = (binIso: string, index: number) => {
        const binDate = new Date(binIso)
        const binTime = binDate.getTime()

        // Simple logic: Label D-3, D-2, D-1 at 00:00 or closest bin
        const diffDays = Math.floor((todayStart - binTime) / (1000 * 60 * 60 * 24))

        // Only label if it's roughly the start of the day (e.g. 00:00-03:00) or specific index
        // For this visualization, we might just want to place labels at fixed % positions if we can't calculate exactly
        // But let's try to find day boundaries.

        if (binDate.getHours() === 0) {
            if (diffDays === 0) return "Today"
            if (diffDays > 0) return `D-${diffDays}`
        }
        return null
    }

    return (
        <div className={cn("w-full py-6 select-none", className)}>
            {/* Header / Legend */}
            <div className="flex items-center justify-between px-1 mb-6">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                    Event Trajectory ({bins.length > 24 ? "72H" : "24H"})
                </span>
                <div className="flex items-center gap-4">
                    {/* Legend manually matches the image */}
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#EF4444" }} />
                        <span className="text-[10px] text-muted-foreground">High Severity</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#F97316" }} />
                        <span className="text-[10px] text-muted-foreground">Warning</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#9CA3AF" }} />
                        <span className="text-[10px] text-muted-foreground">Routine</span>
                    </div>
                </div>
            </div>

            {/* Timeline Container */}
            <div className="relative h-4 flex items-center w-full px-4 mb-2">
                {/* The Line */}
                <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-border/60 -translate-y-1/2 z-0" />

                <TooltipProvider delayDuration={0}>
                    <div className="flex justify-between w-full relative z-10 items-center">
                        {bins.map((bin, idx) => {
                            const isSelected = selectedBin === bin.bin_start
                            const { color } = getVisualSeverity(bin.max_severity)
                            const hasEvents = bin.event_count > 0
                            const dotSize = getDotSize(bin.event_count)

                            const dayLabel = getDayLabel(bin.bin_start, idx)

                            // Invisible button for interaction if no events, or visible dot
                            return (
                                <div key={bin.bin_start} className="relative flex flex-col items-center justify-center flex-1 h-8 group">
                                    {/* Day Label (Absolute positioned below) */}
                                    {dayLabel && (
                                        <div className="absolute top-6 text-[10px] font-medium text-muted-foreground/70 whitespace-nowrap">
                                            {dayLabel}
                                        </div>
                                    )}

                                    {hasEvents ? (
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <button
                                                    onClick={() => onBinClick(bin.bin_start)}
                                                    onMouseEnter={() => onBinHover?.(bin.bin_start)}
                                                    onMouseLeave={() => onBinHover?.(null)}
                                                    className="outline-none"
                                                >
                                                    <div
                                                        className={cn(
                                                            "rounded-full transition-all duration-200",
                                                            dotSize,
                                                            isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-125",
                                                            !isSelected && "hover:scale-125"
                                                        )}
                                                        style={{
                                                            backgroundColor: color,
                                                            boxShadow: isSelected ? `0 0 8px ${color}40` : "none"
                                                        }}
                                                    />
                                                </button>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="text-xs p-2">
                                                <p className="font-semibold mb-0.5">{formatBinTime(bin.bin_start)}</p>
                                                <p className="text-[11px]">이벤트 <span className="font-bold">{bin.event_count}</span>건</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    ) : (
                                        // Small tick for empty bins to keep grid rhythm, or just empty space
                                        <div className="w-1 h-1 rounded-full bg-border/40" />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </TooltipProvider>

                {/* 'Now' Marker at the very end */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col items-center z-20 pointer-events-none">
                    <div className="h-6 w-[2px] bg-blue-500/80 rounded-full" />
                    <div className="absolute top-6 text-[10px] font-bold text-blue-500 whitespace-nowrap">Now</div>
                </div>
            </div>

            {/* Explicit D-3 Start Label if getting cut off by dynamic logic */}
            <div className="relative h-6 w-full">
                {/* Just a spacer container for the absolute labels above to not overlap things below */}
            </div>

        </div>
    )
}
