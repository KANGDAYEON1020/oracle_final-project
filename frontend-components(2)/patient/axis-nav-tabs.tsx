"use client"

import type { AxisType } from "@/lib/explain-types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type PatientAxisKey = "all" | AxisType
export type TrajectoryTagSortKey = "worsening" | "improving" | "warning"

const AXIS_TABS: { key: PatientAxisKey; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "resp", label: "호흡" },
  { key: "inf", label: "감염/검사" },
  { key: "action", label: "조치" },
  { key: "esc", label: "악화" },
  { key: "iso", label: "감염관리" },
  { key: "sym", label: "증상" },
]

const TAG_SORT_BUTTONS: { key: TrajectoryTagSortKey; label: string }[] = [
  { key: "worsening", label: "악화" },
  { key: "improving", label: "호전" },
  { key: "warning", label: "주의" },
]

export type PatientDocFilterKey = "간호 기록" | "의사 기록" | "영상 판독" | "미생물 검사"

const DOC_FILTER_BUTTONS: { key: PatientDocFilterKey; label: string }[] = [
  { key: "간호 기록", label: "간호기록" },
  { key: "의사 기록", label: "의사기록" },
  { key: "영상 판독", label: "영상" },
  { key: "미생물 검사", label: "미생물" },
]

interface AxisNavTabsProps {
  activeAxis: PatientAxisKey
  onChangeAxis: (axis: PatientAxisKey) => void
  activeTagFilters: TrajectoryTagSortKey[]
  onChangeTagFilters: (next: TrajectoryTagSortKey[]) => void
  activeDocFilters: string[]
  onChangeDocFilters: (next: string[]) => void
}

export function AxisNavTabs({
  activeAxis,
  onChangeAxis,
  activeTagFilters,
  onChangeTagFilters,
  activeDocFilters,
  onChangeDocFilters,
}: AxisNavTabsProps) {
  return (
    <div className="flex min-h-10 flex-shrink-0 items-center gap-2.5 border-b border-border bg-card px-4 py-1.5 md:px-5 xl:px-6">
      <div className="flex items-center gap-2">
        <Select value={activeAxis} onValueChange={(v) => onChangeAxis(v as PatientAxisKey)}>
          <SelectTrigger
            size="sm"
            className="h-7 min-w-[124px] bg-background text-xs"
            aria-label="임상 축 선택"
          >
            <SelectValue placeholder="전체" />
          </SelectTrigger>
          <SelectContent>
            {AXIS_TABS.map((tab) => (
              <SelectItem key={tab.key} value={tab.key}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        {TAG_SORT_BUTTONS.map((option) => {
          const active = activeTagFilters.includes(option.key)
          const activeClass =
            option.key === "worsening"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : option.key === "improving"
                ? "border-emerald-400/40 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300"

          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                const next = active
                  ? activeTagFilters.filter((item) => item !== option.key)
                  : [...activeTagFilters, option.key]
                onChangeTagFilters(next)
              }}
              className={
                active
                  ? `rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${activeClass}`
                  : "rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              }
            >
              {option.label}
            </button>
          )
        })}

        <div className="w-px h-4 bg-border mx-1" />

        {DOC_FILTER_BUTTONS.map((option) => {
          const active = activeDocFilters.includes(option.key)
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                const next = active
                  ? activeDocFilters.filter((item) => item !== option.key)
                  : [...activeDocFilters, option.key]
                onChangeDocFilters(next)
              }}
              className={
                active
                  ? "rounded-md border border-primary/50 bg-primary/10 text-primary px-2 py-1 text-[11px] font-semibold transition-colors"
                  : "rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              }
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
