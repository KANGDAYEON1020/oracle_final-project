"use client"

import { useRouter } from "next/navigation"
import type { AxisSnapshot, PatientMeta } from "@/lib/explain-types"
import { AXIS_META } from "@/lib/explain-types"
import { formatAdmitDayLabel } from "@/lib/admit-day"
import { AlertTriangle, ArrowRightLeft, ShieldAlert } from "lucide-react"
import { cn } from "@/lib/utils"

export interface PatientHeaderAlert {
  label: string
  variant: "destructive" | "warning"
}

interface PatientHeaderProps {
  patient: PatientMeta
  alerts: PatientHeaderAlert[]
  axisSnapshots: AxisSnapshot[]
}

function parseSexAge(sexAge: string): { sex: string; age: string } {
  const [sex = "-", age = "-"] = sexAge.split("/")
  return { sex, age }
}

function summarizeAxes(snapshots: AxisSnapshot[]): string {
  const worsening = snapshots.filter((s) => s.state === "worsening")
  if (worsening.length === 0) return "중요 변화 없음"
  return worsening.map((s) => AXIS_META[s.axis].labelKo).join(", ")
}

export function PatientHeader({ patient, alerts, axisSnapshots }: PatientHeaderProps) {
  const router = useRouter()
  const { sex, age } = parseSexAge(patient.sex_age)
  const initials = patient.name.slice(0, 1)

  return (
    <header className="flex flex-shrink-0 flex-col gap-2 border-b border-border bg-card px-4 py-2 md:px-5 xl:h-14 xl:flex-row xl:items-center xl:justify-between xl:px-6 xl:py-0">
      <div className="flex w-full min-w-0 items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold flex-shrink-0">
            {initials}
          </div>
          <div className="flex flex-col">
            <h1 className="text-[13px] font-semibold text-foreground leading-tight">
              {patient.name} ({age}
              {sex})
            </h1>
            <span className="text-[11px] text-muted-foreground font-mono leading-tight">
              MRN: {patient.patient_id}
            </span>
          </div>
        </div>

        <div className="h-6 w-px bg-border hidden lg:block" />

        <div className="hidden lg:flex flex-col">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
            병상 위치
          </span>
          <span className="text-[13px] font-medium text-foreground mt-0.5 leading-tight">
            {patient.ward_bed}
          </span>
        </div>

        <div className="h-6 w-px bg-border hidden lg:block" />

        <div className="hidden lg:flex flex-col">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none">
            입원 경과
          </span>
          <span className="text-[13px] font-medium text-foreground mt-0.5 leading-tight">
            {formatAdmitDayLabel(patient.admit_day)}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {alerts.length === 0 ? (
            <div className="hidden lg:flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-1.5">
              <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">
                {summarizeAxes(axisSnapshots)}
              </span>
            </div>
          ) : (
            alerts.map((alert, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 md:px-3",
                  alert.variant === "destructive"
                    ? "border-destructive/30 bg-destructive/[0.06]"
                    : "border-warning/30 bg-warning/[0.08]",
                )}
              >
                <AlertTriangle
                  className={cn(
                    "h-3.5 w-3.5 flex-shrink-0",
                    alert.variant === "destructive" ? "text-destructive" : "text-warning",
                  )}
                />
                <span
                  className={cn(
                    "text-[11px] font-semibold whitespace-nowrap",
                    alert.variant === "destructive" ? "text-destructive" : "text-warning",
                  )}
                >
                  {alert.label}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex w-full flex-wrap items-center gap-2 xl:justify-end">
        <button
          type="button"
          onClick={() => router.push(`/isolation-checklist?patientId=${patient.patient_id}`)}
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 md:px-3 dark:border-rose-900/30 dark:bg-rose-900/20 dark:text-rose-400"
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          격리 체크리스트
        </button>
        <button
          type="button"
          onClick={() => router.push(`/transfer-checklist?patientId=${patient.patient_id}`)}
          className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 md:px-3 dark:border-blue-900/30 dark:bg-blue-900/20 dark:text-blue-400"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          전원 체크리스트
        </button>
      </div>
    </header>
  )
}
