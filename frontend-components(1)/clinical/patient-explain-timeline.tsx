"use client"

import { useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TrendingUp, TrendingDown, Eye } from "lucide-react"
import { AXIS_META, SEVERITY_COLOR, buildFlagLabels } from "@/lib/explain-types"
import {
  formatExplainValue,
  localizeExplainFieldLabel,
  localizeRawDiffLine,
} from "@/lib/explain-localize"
import type { ExplainEvent, AxisType, SeverityLevel } from "@/lib/explain-types"

// ── Priority mapping ──

type Priority = "HIGH" | "MED" | "LOW"

function severityToPriority(severity: SeverityLevel): Priority {
  if (severity === "critical" || severity === "high") return "HIGH"
  if (severity === "medium") return "MED"
  return "LOW"
}

// ── Axis icon mapping ──

const AXIS_ICON: Record<AxisType, string> = {
  resp: "\uD83E\uDEC1",
  inf: "\uD83E\uDDEA",
  action: "\u26A1",
  esc: "\uD83D\uDCC8",
  iso: "\uD83D\uDEE1\uFE0F",
  sym: "\u2764\uFE0F\u200D\uD83E\uDE79",
}

// ── Transition derivation from now_prev ──

interface TransitionLine {
  label: string
  previous: string
  current: string
  direction?: "up" | "down"
}

function deriveTransitions(event: ExplainEvent): TransitionLine[] {
  const { now, prev } = event.now_prev
  const lines: TransitionLine[] = []

  for (const key of Object.keys(now)) {
    const nowVal = now[key]
    const prevVal = prev[key]
    const nowStr = formatExplainValue(nowVal)
    const prevStr = formatExplainValue(prevVal)

    if (nowStr === prevStr) continue

    let direction: "up" | "down" | undefined
    if (typeof nowVal === "number" && typeof prevVal === "number") {
      direction = nowVal > prevVal ? "up" : nowVal < prevVal ? "down" : undefined
    }

    lines.push({ label: localizeExplainFieldLabel(key), previous: prevStr, current: nowStr, direction })
  }

  return lines.length > 0 ? lines : [{ label: "", previous: "—", current: localizeRawDiffLine(event.now_prev.diff_line) }]
}

// ── Tag derivation from evidence flags ──

function deriveTags(event: ExplainEvent): { label: string; variant: "destructive" | "warning" | "info" | "default" }[] {
  const tags: { label: string; variant: "destructive" | "warning" | "info" | "default" }[] = []

  const flagLabels = event.evidence_after?.flags ? buildFlagLabels(event.evidence_after.flags) : []
  for (const fl of flagLabels) {
    if (fl === "[부정]") tags.push({ label: "부정", variant: "default" })
    else if (fl === "[불확실]") tags.push({ label: "불확실", variant: "warning" })
    else if (fl === "[계획]") tags.push({ label: "계획", variant: "info" })
  }

  if (!event.issue_only) {
    tags.push({ label: "맥락", variant: "default" })
  }

  return tags
}

// ── Date group formatting ──

function formatDateGroup(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const eventDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diffDays = Math.floor((today.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "오늘"
    if (diffDays === 1) return "어제"
    if (diffDays === 2) return "2일 전"
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return iso
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  } catch {
    return iso
  }
}

// ── Priority Badge ──

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded px-2 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide min-w-[38px]",
        priority === "HIGH" && "bg-destructive/10 text-destructive border border-destructive/20",
        priority === "MED" && "bg-warning/10 text-warning border border-warning/20",
        priority === "LOW" && "bg-muted text-muted-foreground border border-border",
      )}
    >
      {priority}
    </span>
  )
}

// ── Event Row ──

function EventRow({
  event,
  isSelected,
  onClick,
}: {
  event: ExplainEvent
  isSelected: boolean
  onClick: () => void
}) {
  const priority = severityToPriority(event.severity)
  const transitions = deriveTransitions(event)
  const tags = deriveTags(event)
  const dateGroup = formatDateGroup(event.ts)
  const time = formatTime(event.ts)
  const axisIcon = AXIS_ICON[event.axis]
  const meta = AXIS_META[event.axis]

  return (
    <button
      onClick={onClick}
      className={cn(
        "grid grid-cols-[72px_56px_1fr_1fr_160px] items-start gap-3 w-full text-left px-5 py-3 border-b border-border/60 transition-all group relative",
        isSelected
          ? "bg-primary/[0.04] border-l-[3px] border-l-primary pl-[17px]"
          : "hover:bg-muted/40 border-l-[3px] border-l-transparent",
        !event.issue_only && !isSelected && "opacity-60",
      )}
    >
      {/* Time */}
      <div className="flex flex-col pt-0.5">
        <span className="text-[10px] text-muted-foreground leading-tight font-medium">
          {dateGroup}
        </span>
        <span className="text-[13px] font-mono font-semibold text-foreground leading-tight mt-0.5">
          {time}
        </span>
      </div>

      {/* Priority badge */}
      <div className="pt-1">
        <PriorityBadge priority={priority} />
      </div>

      {/* Event type */}
      <div className="flex flex-col gap-0.5 pt-0.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm leading-none flex-shrink-0">{axisIcon}</span>
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            [{event.event_type}]
          </span>
        </div>
        <span className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2">
          {event.summary_ko}
        </span>
      </div>

      {/* Transitions / Delta */}
      <div className="flex flex-col gap-1 pt-0.5 min-w-0">
        {transitions.slice(0, 3).map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap text-[12px]">
            {t.label && (
              <span className="text-muted-foreground text-[10px] font-medium font-mono">
                {t.label}:
              </span>
            )}
            <span className="text-muted-foreground line-through decoration-muted-foreground/40 text-[12px]">
              {t.previous}
            </span>
            <span className="text-muted-foreground/60 text-[10px]">{"\u2192"}</span>
            <span className={cn("font-bold text-[12px]", t.direction ? "text-foreground" : "text-primary")}>
              {t.current}
            </span>
            {t.direction && (
              <span className={cn("flex-shrink-0", t.direction === "up" ? "text-destructive" : "text-primary")}>
                {t.direction === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              </span>
            )}
          </div>
        ))}
        {transitions.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{transitions.length - 3}개 항목</span>
        )}
      </div>

      {/* Tags */}
      <div className="flex items-start gap-1 pt-0.5 flex-wrap justify-end">
        {tags.map((tag, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
              tag.variant === "destructive" && "border-destructive/20 bg-destructive/[0.06] text-destructive",
              tag.variant === "warning" && "border-warning/20 bg-warning/[0.06] text-warning-foreground",
              tag.variant === "info" && "border-primary/20 bg-primary/[0.06] text-primary",
              tag.variant === "default" && "border-border bg-muted text-muted-foreground",
            )}
          >
            {tag.label}
          </span>
        ))}
        {isSelected && <Eye className="h-4 w-4 text-primary ml-1 flex-shrink-0" />}
      </div>
    </button>
  )
}

// ── Main Timeline Component ──

interface PatientExplainTimelineProps {
  events: ExplainEvent[]
  selectedEventId: string | null
  onSelectEvent: (eventId: string) => void
  searchQuery?: string
}

export function PatientExplainTimeline({
  events,
  selectedEventId,
  onSelectEvent,
  searchQuery = "",
}: PatientExplainTimelineProps) {
  const selectedRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [selectedEventId])

  // Apply local search filter
  const filtered = searchQuery.trim()
    ? events.filter((e) => {
        const q = searchQuery.toLowerCase()
        return (
          e.summary_ko.toLowerCase().includes(q) ||
          e.event_type.toLowerCase().includes(q) ||
          e.now_prev.diff_line.toLowerCase().includes(q) ||
          AXIS_META[e.axis].labelKo.includes(q)
        )
      })
    : events

  // Group by dateGroup
  const grouped: { dateGroup: string; items: ExplainEvent[] }[] = []
  filtered.forEach((event) => {
    const dg = formatDateGroup(event.ts)
    const last = grouped[grouped.length - 1]
    if (last && last.dateGroup === dg) {
      last.items.push(event)
    } else {
      grouped.push({ dateGroup: dg, items: [event] })
    }
  })

  return (
    <div className="flex flex-col h-full">
      {/* Column header */}
      <div className="grid grid-cols-[72px_56px_1fr_1fr_160px] items-center gap-3 px-5 py-2 border-b border-border flex-shrink-0 bg-muted/30">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          시간
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          심각도
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          이벤트
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          변화 (이전 → 현재)
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-right">
          태그
        </span>
      </div>

      {/* Event rows */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col">
          {grouped.map((group, gi) => (
            <div key={group.dateGroup + gi}>
              {gi > 0 && (
                <div className="flex items-center gap-3 px-5 py-2 bg-muted/20">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.dateGroup}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              )}
              {group.items.map((event) => (
                <div
                  key={event.event_id}
                  ref={selectedEventId === event.event_id ? selectedRef : undefined}
                >
                  <EventRow
                    event={event}
                    isSelected={selectedEventId === event.event_id}
                    onClick={() => onSelectEvent(event.event_id)}
                  />
                </div>
              ))}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              {searchQuery.trim()
                ? "검색 결과가 없습니다."
                : "해당 기간에 변화 이벤트가 없습니다."}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
