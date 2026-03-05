"use client"

import { useState } from "react"
import {
  Wind,
  Bug,
  Bell,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Circle,
  Info,
} from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { ExplainData, ExplainAxis, SepsisSignalDirection } from "@/lib/types"

// ─── Section 1: Clinical Trajectory (3-Axis Summary Cards) ───

const AXIS_CONFIG: Record<
  string,
  { icon: typeof Wind; accent: string; accentBg: string }
> = {
  respiratory: {
    icon: Wind,
    accent: "text-sky-700 dark:text-sky-300",
    accentBg: "bg-sky-50 dark:bg-sky-950/30 border-sky-200/60 dark:border-sky-800/40",
  },
  infection: {
    icon: Bug,
    accent: "text-amber-700 dark:text-amber-300",
    accentBg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40",
  },
  intervention: {
    icon: Bell,
    accent: "text-slate-700 dark:text-slate-300",
    accentBg: "bg-slate-50 dark:bg-slate-900/30 border-slate-200/60 dark:border-slate-700/40",
  },
}

function TrajectoryAxisCard({ axis }: { axis: ExplainAxis }) {
  const config = AXIS_CONFIG[axis.id] ?? AXIS_CONFIG.intervention
  const Icon = config.icon

  return (
    <div className={cn("rounded-lg border p-4 space-y-3", config.accentBg)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", config.accent)} />
        <h4 className={cn("text-xs font-semibold", config.accent)}>
          {axis.label}
        </h4>
      </div>

      {/* Summary sentence */}
      <p className="text-sm leading-relaxed text-foreground">{axis.summary}</p>

      {/* Recent events */}
      <ul className="space-y-1.5">
        {axis.events.map((evt, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
            <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-muted-foreground/40" />
            <span className="flex-1">{evt.text}</span>
            {evt.timestamp && (
              <span className="shrink-0 text-[10px] text-muted-foreground/50">
                {evt.timestamp}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Section 2: Recent Sepsis Signal (Direction-Only Panel) ───

const SIGNAL_LABEL: Record<SepsisSignalDirection, string> = {
  rising: "최근 sepsis 위험 신호 상승",
  stable: "최근 sepsis 위험 신호 유지",
  declining: "최근 sepsis 위험 신호 감소",
}

const SIGNAL_STYLE: Record<
  SepsisSignalDirection,
  { dot: string; text: string; bg: string }
> = {
  rising: {
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-950/20 border-amber-200/50 dark:border-amber-800/30",
  },
  stable: {
    dot: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-900/20 border-slate-200/50 dark:border-slate-700/30",
  },
  declining: {
    dot: "bg-teal-500",
    text: "text-teal-700 dark:text-teal-300",
    bg: "bg-teal-50 dark:bg-teal-950/20 border-teal-200/50 dark:border-teal-800/30",
  },
}

function SepsisSignalPanel({
  direction,
  factors,
}: {
  direction: SepsisSignalDirection
  factors: string[]
}) {
  const style = SIGNAL_STYLE[direction]

  return (
    <Card className={cn("border", style.bg)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", style.dot)} />
          <span className={style.text}>{SIGNAL_LABEL[direction]}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[10px] text-muted-foreground/60">
          기여 요인 (Top 3)
        </p>
        <ul className="space-y-1.5">
          {factors.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed"
            >
              <span className="shrink-0 mt-1 text-[10px] text-muted-foreground/50">
                {i + 1}.
              </span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// ─── Section 3: Sepsis Early Response Checklist ───

function EarlyResponseChecklist({
  items,
  onToggle,
}: {
  items: ExplainData["earlyResponseChecklist"]
  onToggle: (id: string, checked: boolean) => void
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          Sepsis Early Response Checklist
        </CardTitle>
        <p className="text-[10px] text-muted-foreground/60">
          확인/점검 항목 (판단을 유도하지 않습니다)
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <label
            key={item.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 transition-colors cursor-pointer",
              item.checked
                ? "bg-muted/30 border-muted-foreground/20"
                : "bg-background border-border hover:bg-muted/30"
            )}
          >
            <Checkbox
              checked={item.checked}
              onCheckedChange={(checked) =>
                onToggle(item.id, checked as boolean)
              }
            />
            <span
              className={cn(
                "flex-1 text-xs leading-relaxed",
                item.checked
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              )}
            >
              {item.label}
            </span>
            {item.checked ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
            )}
          </label>
        ))}
      </CardContent>
    </Card>
  )
}

// ─── Section 4: Trend Graph (Collapsed by Default) ───

function CollapsibleTrendGraph({
  data,
}: {
  data: ExplainData["trendGraph"]
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Card className="bg-card border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between px-6 py-3 text-left"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="text-sm font-medium text-muted-foreground">
          Trend Graph (추세 확인 보조)
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <CardContent className="pt-0 pb-4 space-y-3">
          <p className="text-[10px] text-muted-foreground/50">
            해석을 강요하지 않는 참고 자료입니다. 임계치 기준선은 점선으로 표시됩니다.
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 5, right: 10, left: -15, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  opacity={0.3}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[85, 100]}
                  label={{
                    value: "SpO\u2082",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--muted-foreground)",
                    fontSize: 9,
                    offset: 15,
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: "CRP / Actions",
                    angle: 90,
                    position: "insideRight",
                    fill: "var(--muted-foreground)",
                    fontSize: 9,
                    offset: 15,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "11px",
                  }}
                />
                {/* SpO2 threshold */}
                <ReferenceLine
                  yAxisId="left"
                  y={92}
                  stroke="#94a3b8"
                  strokeDasharray="5 5"
                  label={{
                    value: "SpO\u2082 92%",
                    fill: "#94a3b8",
                    fontSize: 9,
                    position: "insideBottomLeft",
                  }}
                />
                {/* Respiratory (SpO2) - soft teal */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="respiratory"
                  stroke="#5eaaa8"
                  strokeWidth={1.5}
                  dot={false}
                  name="SpO\u2082 (%)"
                />
                {/* Infection (CRP) - muted amber */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="infection"
                  stroke="#d4a056"
                  strokeWidth={1.5}
                  dot={false}
                  name="CRP (mg/dL)"
                />
                {/* Intervention (actions) - neutral gray-blue */}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="intervention"
                  stroke="#7b8fa2"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                  name="Actions (count)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 justify-center">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-[#5eaaa8]" />
              <span className="text-[10px] text-muted-foreground">{'SpO\u2082'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-[#d4a056]" />
              <span className="text-[10px] text-muted-foreground">CRP</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-[#7b8fa2]" />
              <span className="text-[10px] text-muted-foreground">
                Clinical Actions
              </span>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// ─── Main Explain Panel ───

interface ExplainPanelProps {
  data: ExplainData
}

export function ExplainPanel({ data }: ExplainPanelProps) {
  const [checklist, setChecklist] = useState(data.earlyResponseChecklist)

  const handleToggle = (id: string, checked: boolean) => {
    setChecklist((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked } : item))
    )
  }

  return (
    <div className="space-y-5">
      {/* Disclaimer - top of Explain */}
      <div className="flex items-start gap-2 p-2 rounded bg-muted/30 border border-border">
        <Info className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          이 영역은 진단 또는 판단을 내리지 않습니다. 최근 5-7일간의 임상 변화를
          구조화하여 의료진의 빠른 맥락 파악을 돕는 요약판입니다.
        </p>
      </div>

      {/* Section 1: Clinical Trajectory (3 Axis Cards) */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-3">
          Clinical Trajectory (5-7일 요약)
        </h3>
        <div className="grid grid-cols-1 gap-3">
          {data.axes.map((axis) => (
            <TrajectoryAxisCard key={axis.id} axis={axis} />
          ))}
        </div>
      </div>

      {/* Section 2: Recent Sepsis Signal */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-3">
          Recent Sepsis Signal
        </h3>
        <SepsisSignalPanel
          direction={data.sepsisSignal.direction}
          factors={data.sepsisSignal.contributingFactors}
        />
      </div>

      {/* Section 3: Early Response Checklist */}
      <EarlyResponseChecklist items={checklist} onToggle={handleToggle} />

      {/* Section 4: Trend Graph (collapsed) */}
      <CollapsibleTrendGraph data={data.trendGraph} />

      {/* Bottom disclaimer */}
      <p className="text-[10px] text-muted-foreground/40 text-center leading-relaxed">
        모든 최종 판단과 조치는 의료진의 몫으로 남겨둡니다.
      </p>
    </div>
  )
}
