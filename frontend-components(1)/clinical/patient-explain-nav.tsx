"use client"

import { cn } from "@/lib/utils"
import { Search, SlidersHorizontal, Eye, EyeOff } from "lucide-react"
import { AXIS_META, AXIS_STATE_COLOR } from "@/lib/explain-types"
import type { AxisType, AxisSnapshot } from "@/lib/explain-types"

const AXIS_TABS: { key: AxisType | "all"; label: string; icon: string }[] = [
  { key: "all", label: "전체", icon: "" },
  { key: "resp", label: "호흡", icon: "\uD83E\uDEC1" },
  { key: "inf", label: "감염활동", icon: "\uD83E\uDDEA" },
  { key: "action", label: "임상조치", icon: "\u26A1" },
  { key: "esc", label: "에스컬레이션", icon: "\uD83D\uDCC8" },
  { key: "iso", label: "감염관리", icon: "\uD83D\uDEE1\uFE0F" },
  { key: "sym", label: "증상", icon: "\u2764\uFE0F\u200D\uD83E\uDE79" },
]

interface PatientExplainNavProps {
  activeAxis: AxisType | null
  onChangeAxis: (axis: AxisType | null) => void
  searchQuery: string
  onChangeSearch: (q: string) => void
  axisSnapshots: AxisSnapshot[]
  showContext: boolean
  onToggleContext: () => void
}

export function PatientExplainNav({
  activeAxis,
  onChangeAxis,
  searchQuery,
  onChangeSearch,
  axisSnapshots,
  showContext,
  onToggleContext,
}: PatientExplainNavProps) {
  const getAxisState = (axis: AxisType): AxisSnapshot | undefined => {
    return axisSnapshots.find((s) => s.axis === axis)
  }

  return (
    <div className="flex items-center gap-3 border-b border-border bg-card px-6 h-10 flex-shrink-0">
      {/* Axis tabs */}
      <nav className="flex items-center gap-1" role="tablist" aria-label="Clinical axis filter">
        {AXIS_TABS.map((tab) => {
          const isActive = tab.key === "all" ? activeAxis === null : activeAxis === tab.key
          const snapshot = tab.key !== "all" ? getAxisState(tab.key) : undefined
          const stateStyle = snapshot ? AXIS_STATE_COLOR[snapshot.state] : undefined

          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChangeAxis(tab.key === "all" ? null : tab.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors whitespace-nowrap",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {tab.icon && <span className="text-xs leading-none">{tab.icon}</span>}
              {tab.label}
              {/* Axis state indicator dot */}
              {snapshot && !isActive && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full flex-shrink-0",
                    snapshot.state === "worsening" && "bg-red-500",
                    snapshot.state === "stable" && "bg-amber-500",
                    snapshot.state === "improving" && "bg-emerald-500",
                  )}
                />
              )}
            </button>
          )
        })}
      </nav>

      {/* Right: Context toggle + Search + Filter */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Show Context Toggle */}
        <button
          onClick={onToggleContext}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors border",
            showContext
              ? "border-primary/30 bg-primary/[0.06] text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {showContext ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          맥락
        </button>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="이벤트 검색..."
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            className="h-7 w-44 rounded-md border border-border bg-background pl-7 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>
    </div>
  )
}
