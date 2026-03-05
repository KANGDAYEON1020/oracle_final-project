"use client"

import type { RangeType } from "@/lib/explain-types"
import { cn } from "@/lib/utils"

export type SeverityStripLevel = "HIGH" | "MED" | "LOW" | "NONE"

export interface SeverityStripBin {
  key: string
  startMs: number
  endMs: number
  label: string
  count: number
  level: SeverityStripLevel
  topDelta?: string
}

interface SeverityTimelineStripProps {
  bins: SeverityStripBin[]
  range: RangeType
  activeBinKey: string | null
  onBinClick: (binKey: string) => void
}

const RANGE_TICKS: Record<RangeType, number[]> = {
  "24h": [1, 6, 12, 18, 24],
  "72h": [1, 12, 24, 36, 48, 72],
  "7d": [1, 2, 3, 4, 5, 6, 7],
}

const RANGE_TOTAL_UNITS: Record<RangeType, number> = {
  "24h": 24,
  "72h": 72,
  "7d": 7,
}

function dotSize(count: number): string {
  if (count >= 4) return "h-3.5 w-3.5"
  if (count >= 2) return "h-2.5 w-2.5"
  if (count >= 1) return "h-2 w-2"
  return "h-1.5 w-1.5"
}

function dotColor(level: SeverityStripLevel, count: number): string {
  if (count === 0 || level === "NONE") return "bg-muted-foreground/35"
  if (level === "HIGH") return "bg-orange-500"
  if (level === "MED") return "bg-warning"
  return "bg-primary"
}

export function SeverityTimelineStrip({
  bins,
  range,
  activeBinKey,
  onBinClick,
}: SeverityTimelineStripProps) {
  const ticks = RANGE_TICKS[range]
  const totalUnits = RANGE_TOTAL_UNITS[range]

  return (
    <div className="relative">
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <div className="relative flex h-6 items-center">
          {bins.map((bin) => {
            const isActive = activeBinKey === bin.key
            return (
              <div key={bin.key} className="group relative flex flex-1 justify-center">
                <button
                  type="button"
                  onClick={() => onBinClick(bin.key)}
                  className={cn(
                    "relative z-10 rounded-full transition-transform",
                    "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary/40",
                    isActive && "scale-110 ring-2 ring-primary/50 ring-offset-1 ring-offset-background",
                  )}
                  aria-label={`${bin.label}, ${bin.count} events, ${bin.level}`}
                >
                  <span className={cn("block rounded-full", dotSize(bin.count), dotColor(bin.level, bin.count))} />
                </button>

                {bin.count > 0 && (
                  <div className="pointer-events-none absolute bottom-full z-20 mb-2 hidden group-hover:block group-focus-within:block">
                    <div className="min-w-max rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-sm">
                      <p className="text-[11px] font-semibold text-foreground">
                        {bin.label} · {bin.count} events · {bin.level}
                      </p>
                      {bin.topDelta && (
                        <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
                          Top: {bin.topDelta}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="relative mt-0.5 h-5 select-none">
        {ticks.map((tick, index) => {
          const isLast = index === ticks.length - 1
          const positionStyle = isLast ? { right: "0%" } : { left: `${(tick / totalUnits) * 100}%` }
          return (
            <div
              key={`${range}-${tick}`}
              className={cn(
                "absolute top-0 flex flex-col items-center text-[10px] text-muted-foreground",
                !isLast && "-translate-x-1/2",
              )}
              style={positionStyle}
            >
              <span className="h-1 w-px bg-border/80" />
              <span className="mt-0.5">{tick}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
