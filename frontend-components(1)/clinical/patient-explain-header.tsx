"use client"

import type { PatientMeta, AxisSnapshot, AxisState } from "@/lib/explain-types"
import { AXIS_META } from "@/lib/explain-types"
import { formatAdmitDayLabel } from "@/lib/admit-day"
import { AlertTriangle, Siren, MapPin, Calendar, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

interface PatientExplainHeaderProps {
  patient: PatientMeta
  axisSnapshots: AxisSnapshot[]
  range: string
  onRangeChange: (r: "24h" | "72h" | "7d") => void
}

const TAG_LABEL: Record<string, string> = {
  mdro_confirmed_mrsa: "MRSA",
  mdro_confirmed_vre: "VRE",
  mdro_confirmed_cre: "CRE",
  contact_precaution: "접촉주의",
  droplet_precaution: "비말주의",
  airborne_precaution: "공기주의",
}

function buildAlerts(snapshots: AxisSnapshot[]): { label: string; variant: "destructive" | "warning" }[] {
  const alerts: { label: string; variant: "destructive" | "warning" }[] = []

  const worsening = snapshots.filter((s) => s.state === "worsening")
  const worseningHigh = worsening.filter((s) => s.delta_score <= -2)

  if (worseningHigh.length > 0) {
    const axes = worseningHigh.map((s) => AXIS_META[s.axis].labelKo).join(", ")
    alerts.push({ label: `임상 위험: ${axes} 급격 악화`, variant: "destructive" })
  } else if (worsening.length > 0) {
    const axes = worsening.map((s) => AXIS_META[s.axis].labelKo).join(", ")
    alerts.push({ label: `주의: ${axes} 악화 관찰`, variant: "warning" })
  }

  return alerts
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

export function PatientExplainHeader({
  patient,
  axisSnapshots,
  range,
  onRangeChange,
}: PatientExplainHeaderProps) {
  const alerts = buildAlerts(axisSnapshots)
  const ranges: ("24h" | "72h" | "7d")[] = ["24h", "72h", "7d"]
  const initials = patient.name.charAt(0)

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-6 h-[56px] flex-shrink-0">
      {/* Left: Logo + Patient Info */}
      <div className="flex items-center gap-5">
        {/* App logo */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-[9px] font-bold tracking-tighter flex-shrink-0">
            IG
          </div>
          <span className="text-sm font-bold text-foreground tracking-tight hidden xl:inline">
            INFECT-GUARD
          </span>
        </div>

        <div className="h-6 w-px bg-border" />

        {/* Avatar + Name */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-[13px] font-semibold text-foreground leading-tight">
                {patient.name} ({patient.sex_age})
              </h1>
              {patient.tags?.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                    tag.includes("mdro")
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-400",
                  )}
                >
                  {TAG_LABEL[tag] ?? tag}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
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
        </div>
      </div>

      {/* Right: Alerts + Range toggle */}
      <div className="flex items-center gap-3">
        {/* Alert badges */}
        {alerts.map((alert, i) => {
          const isDestructive = alert.variant === "destructive"
          return (
            <div
              key={i}
              className={
                isDestructive
                  ? "flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/[0.06] px-2.5 py-1.5"
                  : "flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/[0.06] px-2.5 py-1.5"
              }
            >
              {isDestructive ? (
                <Siren className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-warning flex-shrink-0" />
              )}
              <span
                className={
                  isDestructive
                    ? "text-[11px] font-semibold text-destructive whitespace-nowrap"
                    : "text-[11px] font-semibold text-warning-foreground whitespace-nowrap"
                }
              >
                {alert.label}
              </span>
            </div>
          )
        })}

        {/* Range toggle */}
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                range === r
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
