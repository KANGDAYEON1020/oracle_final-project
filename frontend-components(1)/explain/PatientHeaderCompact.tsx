"use client"

import { Badge } from "@/components/ui/badge"
import { formatAdmitDayLabel } from "@/lib/admit-day"
import { User, MapPin, Calendar, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PatientMeta } from "@/lib/explain-types"

interface PatientHeaderCompactProps {
  patient: PatientMeta
  range: string
  onRangeChange?: (r: "24h" | "72h" | "7d") => void
  className?: string
}

const TAG_STYLES: Record<string, string> = {
  mdro_confirmed_mrsa: "bg-red-500/10 text-red-400 border-red-500/30",
  contact_precaution: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  droplet_precaution: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  airborne_precaution: "bg-purple-500/10 text-purple-400 border-purple-500/30",
}

function tagLabel(tag: string): string {
  const map: Record<string, string> = {
    mdro_confirmed_mrsa: "MRSA",
    mdro_confirmed_vre: "VRE",
    mdro_confirmed_cre: "CRE",
    contact_precaution: "접촉주의",
    droplet_precaution: "비말주의",
    airborne_precaution: "공기주의",
  }
  return map[tag] ?? tag
}

export function PatientHeaderCompact({
  patient,
  range,
  onRangeChange,
  className,
}: PatientHeaderCompactProps) {
  const ranges: ("24h" | "72h" | "7d")[] = ["24h", "72h", "7d"]

  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3",
        className,
      )}
    >
      {/* 환자 기본 정보 */}
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-bold text-foreground truncate">{patient.name}</h1>
          <span className="text-sm text-muted-foreground">{patient.sex_age}</span>
          {patient.tags && patient.tags.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className={cn("text-xs px-1.5 py-0.5", TAG_STYLES[tag] ?? "bg-muted/30 text-muted-foreground")}
            >
              {tagLabel(tag)}
            </Badge>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {patient.ward_bed}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            입원 {formatAdmitDayLabel(patient.admit_day)}
          </span>
          <span className="flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            {formatLastUpdated(patient.last_updated)}
          </span>
        </div>
      </div>

      {/* 시간 범위 토글 */}
      {onRangeChange && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                range === r
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function formatLastUpdated(iso: string): string {
  try {
    const d = new Date(iso)
    const diffMs = Date.now() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return "방금 전"
    if (diffMin < 60) return `${diffMin}분 전`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}시간 전`
    return `${Math.floor(diffH / 24)}일 전`
  } catch {
    return iso
  }
}
