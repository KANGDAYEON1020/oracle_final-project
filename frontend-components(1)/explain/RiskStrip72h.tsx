"use client"

import { cn } from "@/lib/utils"
import { SEVERITY_COLOR, riskScoreToOpacity } from "@/lib/explain-types"
import type { StripBin } from "@/lib/explain-types"

interface RiskStrip72hProps {
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

function BinCell({
  bin,
  isSelected,
  isHovered,
  onClick,
  onHover,
}: {
  bin: StripBin
  isSelected: boolean
  isHovered: boolean
  onClick: () => void
  onHover: (v: boolean) => void
}) {
  const color = SEVERITY_COLOR[bin.max_severity]
  const opacity = riskScoreToOpacity(bin.risk_score)

  const bgStyle = {
    backgroundColor: color.bg,
    opacity: bin.max_severity === "none" ? 1 : opacity,
  }

  return (
    <div className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
      {/* turning_point 마커 (§ 6.3) */}
      <div className="h-2 flex items-center justify-center">
        {bin.turning_point && (
          <span style={{ color: color.bg }} className="text-[10px] leading-none">
            ▼
          </span>
        )}
      </div>

      {/* 색상 셀 */}
      <button
        onClick={onClick}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className={cn(
          "relative w-full rounded transition-all cursor-pointer",
          "h-8 flex items-center justify-center",
          isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          isHovered && !isSelected && "brightness-110 scale-y-110",
        )}
        style={bgStyle}
        title={`${formatBinTime(bin.bin_start)} — 이벤트 ${bin.event_count}건, risk ${bin.risk_score.toFixed(1)}`}
      >
        {bin.event_count > 0 && (
          <span
            className="text-[10px] font-bold leading-none select-none"
            style={{ color: color.text, opacity: 1 }}
          >
            {bin.event_count}
          </span>
        )}
      </button>

      {/* bin 시작 시각 라벨 */}
      <span className="text-[9px] text-muted-foreground truncate max-w-full px-0.5 text-center leading-tight">
        {formatBinTime(bin.bin_start)}
      </span>
    </div>
  )
}

export function RiskStrip72h({
  bins,
  selectedBin,
  hoveredBin,
  onBinClick,
  onBinHover,
  className,
}: RiskStrip72hProps) {
  if (bins.length === 0) {
    return (
      <div className={cn("rounded-xl border border-border bg-card px-4 py-3", className)}>
        <p className="text-xs text-muted-foreground">시간대별 정보가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className={cn("rounded-xl border border-border bg-card px-4 pt-2 pb-3", className)}>
      {/* 범례 */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          72h 리스크 스트립
        </span>
        <div className="flex items-center gap-2">
          {(["critical", "high", "medium", "low", "none"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: SEVERITY_COLOR[s].bg }}
              />
              <span className="text-[10px] text-muted-foreground capitalize">{s}</span>
            </span>
          ))}
        </div>
      </div>

      {/* 스트립 셀들 */}
      <div className="flex gap-1 items-end">
        {bins.map((bin) => (
          <BinCell
            key={bin.bin_start}
            bin={bin}
            isSelected={selectedBin === bin.bin_start}
            isHovered={hoveredBin === bin.bin_start}
            onClick={() => onBinClick(bin.bin_start)}
            onHover={(v) => onBinHover?.(v ? bin.bin_start : null)}
          />
        ))}
      </div>
    </div>
  )
}
