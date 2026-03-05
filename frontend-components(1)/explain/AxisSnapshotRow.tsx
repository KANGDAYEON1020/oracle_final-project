"use client"

import { cn } from "@/lib/utils"
import { AXIS_META, AXIS_STATE_COLOR } from "@/lib/explain-types"
import type { AxisSnapshot, AxisType } from "@/lib/explain-types"
import {
  Wind, Thermometer, Activity, TrendingUp, Shield, Heart,
  TrendingDown, Minus,
} from "lucide-react"

interface AxisSnapshotRowProps {
  snapshots: AxisSnapshot[]
  activeAxis: AxisType | null
  onAxisClick: (axis: AxisType, topEventId: string | null) => void
  onAxisHover?: (axis: AxisType | null) => void
  className?: string
}

const AXIS_ICONS: Record<AxisType, React.ElementType> = {
  resp: Wind,
  inf: Thermometer,
  action: Activity,
  esc: TrendingUp,
  iso: Shield,
  sym: Heart,
}

function DeltaArrow({ delta }: { delta: number }) {
  if (delta < 0) return <TrendingDown className="h-3 w-3 text-red-400" />
  if (delta > 0) return <TrendingUp className="h-3 w-3 text-emerald-400" />
  return <Minus className="h-3 w-3 text-muted-foreground" />
}

function AxisCard({
  snapshot,
  isActive,
  onClick,
  onHover,
}: {
  snapshot: AxisSnapshot
  isActive: boolean
  onClick: () => void
  onHover?: (hovered: boolean) => void
}) {
  const meta = AXIS_META[snapshot.axis]
  const stateStyle = AXIS_STATE_COLOR[snapshot.state]
  const Icon = AXIS_ICONS[snapshot.axis]

  const stateLabel: Record<string, string> = {
    worsening: "악화",
    stable: "안정",
    improving: "호전",
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={cn(
        "group flex flex-col gap-2 rounded-xl border p-3 text-left transition-all hover:shadow-md",
        "min-w-[140px] flex-1",
        isActive
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/30",
      )}
    >
      {/* 헤더: 아이콘 + 축 이름 + state */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{meta.labelKo}</span>
        </div>
        <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", stateStyle.className)}>
          {stateLabel[snapshot.state]}
        </span>
      </div>

      {/* now_prev_line */}
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
        {snapshot.now_prev_line}
      </p>

      {/* delta + confidence */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5">
          <DeltaArrow delta={snapshot.delta_score} />
          <span className="text-[10px] text-muted-foreground">
            {snapshot.delta_score > 0 ? "+" : ""}{snapshot.delta_score}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {Math.round(snapshot.confidence * 100)}%
        </span>
      </div>

      {/* top_evidence_line — 1줄 */}
      {snapshot.top_evidence_line && (
        <p className="truncate rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground italic">
          "{snapshot.top_evidence_line}"
        </p>
      )}

      {/* top_event_id 없음 안내 */}
      {!snapshot.top_event_id && (
        <p className="text-[10px] text-muted-foreground/60">대표 이벤트 없음</p>
      )}
    </button>
  )
}

export function AxisSnapshotRow({
  snapshots,
  activeAxis,
  onAxisClick,
  onAxisHover,
  className,
}: AxisSnapshotRowProps) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-1", className)}>
      {snapshots.map((snap) => (
        <AxisCard
          key={snap.axis}
          snapshot={snap}
          isActive={activeAxis === snap.axis}
          onClick={() => onAxisClick(snap.axis, snap.top_event_id)}
          onHover={(hovered) => onAxisHover?.(hovered ? snap.axis : null)}
        />
      ))}
    </div>
  )
}
