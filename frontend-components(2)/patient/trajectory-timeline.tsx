"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  TrendingUp,
  TrendingDown,
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import type { AxisType } from "@/lib/explain-types"

export type Priority = "HIGH" | "MED" | "LOW"

export interface TimelineTransition {
  label?: string
  previous: string
  current: string
  direction?: "up" | "down"
}

export interface TimelineTag {
  label: string
  variant: "destructive" | "warning" | "info" | "success" | "default"
}

export interface TimelineEvent {
  id: string
  tsMs: number
  time: string
  dateGroup: string
  priority: Priority
  eventLabel: string
  description: string
  transitions: TimelineTransition[]
  evidence: {
    docTitle: string
    docType: string
    sentence: string
  }
  tags?: TimelineTag[]
  axis: AxisType
  docType: string
  eventType?: string
}

const AXIS_BADGE_LABEL: Record<AxisType, string> = {
  resp: "호흡",
  inf: "감염/검사",
  action: "조치",
  esc: "악화",
  iso: "감염관리",
  sym: "증상",
}

interface TrajectoryTimelineProps {
  events: TimelineEvent[]
  selectedEventId: string | null
  onSelectEvent: (event: TimelineEvent) => void
}

export function TrajectoryTimeline({
  events,
  selectedEventId,
  onSelectEvent,
}: TrajectoryTimelineProps) {
  const grouped: { dateGroup: string; items: TimelineEvent[] }[] = []
  events.forEach((event) => {
    const last = grouped[grouped.length - 1]
    if (last && last.dateGroup === event.dateGroup) {
      last.items.push(event)
    } else {
      grouped.push({ dateGroup: event.dateGroup, items: [event] })
    }
  })

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0 px-5 py-4">
        {grouped.map((group, gi) => (
          <div key={group.dateGroup + gi} className="flex flex-col">
            <div className="sticky top-0 z-10 -mx-1 mb-2 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="flex items-center gap-3">
                <span className="rounded-md bg-blue-50 px-2.5 py-1 text-[13px] font-bold text-blue-700 shadow-sm ring-1 ring-blue-200 whitespace-nowrap dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-800">
                  {group.dateGroup}
                </span>
                <div className="h-[2px] flex-1 bg-blue-500/40 dark:bg-blue-500/60" />
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {group.items.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  isSelected={selectedEventId === event.id}
                  onClick={() => onSelectEvent(event)}
                />
              ))}
            </div>

            {gi < grouped.length - 1 && <div className="h-2" />}
          </div>
        ))}

        {events.length === 0 && (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            현재 필터에 해당하는 이벤트가 없습니다.
          </div>
        )}
      </div>
    </ScrollArea>
  )
}

function SeverityDot({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "block h-2.5 w-2.5 rounded-full flex-shrink-0",
        priority === "HIGH" && "bg-primary",
        priority === "MED" && "bg-primary/60",
        priority === "LOW" && "bg-primary/30",
      )}
    />
  )
}

function EventCard({
  event,
  isSelected,
  onClick,
}: {
  event: TimelineEvent
  isSelected: boolean
  onClick: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [warningExpanded, setWarningExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isSelected && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [isSelected])

  const primary = event.transitions[0]
  const more = event.transitions.slice(1)
  const isWarningEvent = Boolean(event.tags?.some((tag) => tag.label === "주의"))
  const showWarningAccordion = isWarningEvent && !warningExpanded

  const handleCardClick = () => {
    if (isWarningEvent && !warningExpanded) {
      setWarningExpanded(true)
    }
    onClick()
  }

  return (
    <div className="flex items-start gap-3" ref={cardRef}>
      <div className="flex flex-col items-end gap-1 pt-3 w-14 flex-shrink-0">
        <span className="text-[13px] font-mono font-bold text-foreground leading-none">
          {event.time}
        </span>
        <SeverityDot priority={event.priority} />
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            handleCardClick()
          }
        }}
        className={cn(
          "flex-1 rounded-lg border text-left transition-all cursor-pointer outline-none",
          isSelected
            ? "border-primary/40 bg-primary/[0.03] shadow-sm ring-1 ring-primary/20"
            : "border-border bg-card hover:border-border hover:bg-muted/30",
        )}
      >
        <div className="p-3 flex flex-col gap-2">
          {showWarningAccordion ? (
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-[13px] font-bold text-foreground leading-tight truncate">
                {event.eventLabel}
              </h3>
              <span className="inline-flex items-center rounded border border-primary/20 bg-primary/[0.06] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary whitespace-nowrap">
                {AXIS_BADGE_LABEL[event.axis]}
              </span>
              <span className="inline-flex items-center rounded border border-orange-300 bg-orange-50 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300 whitespace-nowrap">
                주의
              </span>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                [{event.docType}]
              </span>
              <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground/80 flex-shrink-0" />
            </div>
          ) : null}

          {!showWarningAccordion ? (
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="text-[13px] font-bold text-foreground leading-tight">
                    {event.eventLabel}
                  </h3>
                  <span className="inline-flex items-center rounded border border-primary/20 bg-primary/[0.06] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                    {AXIS_BADGE_LABEL[event.axis]}
                  </span>
                  {event.tags?.map((tag, i) => (
                    <span
                      key={i}
                      className={cn(
                        "inline-flex items-center rounded border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide",
                        tag.variant === "destructive" &&
                        "border-destructive/20 bg-destructive/[0.06] text-destructive",
                        tag.variant === "warning" &&
                        "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
                        tag.variant === "info" &&
                        "border-primary/20 bg-primary/[0.06] text-primary",
                        tag.variant === "success" &&
                        "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-600",
                        tag.variant === "default" &&
                        "border-border bg-muted/70 text-muted-foreground",
                      )}
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
                <p className="text-[12px] text-muted-foreground leading-snug line-clamp-2">
                  {event.description}
                </p>
              </div>
              <span className="rounded border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap flex-shrink-0">
                {event.docType}
              </span>
            </div>
          ) : null}

          {!showWarningAccordion && primary && (
            <div className="rounded bg-muted/45 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                {primary.label && (
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {primary.label}
                  </span>
                )}
                <span className="text-[13px] font-bold text-foreground line-through decoration-muted-foreground/40 decoration-[1px]">
                  {primary.previous}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
                <CurrentValue value={primary.current} direction={primary.direction} />
                {primary.direction && (
                  <span
                    className={cn(
                      "flex-shrink-0",
                      primary.direction === "up" ? "text-orange-500" : "text-primary",
                    )}
                  >
                    {primary.direction === "up" ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {!showWarningAccordion && more.length > 0 && (
            <div className="rounded border border-border/80 bg-background/60 px-2 py-1.5">
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setExpanded((v) => !v)
                }}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                추가 {more.length}개
              </button>
              {expanded && (
                <div className="mt-1.5 flex flex-col gap-1">
                  {more.map((t, i) => (
                    <div key={`${t.label ?? "delta"}-${i}`} className="flex items-center gap-1.5 text-[11px]">
                      {t.label && <span className="text-muted-foreground">{t.label}</span>}
                      <span className="text-muted-foreground line-through decoration-muted-foreground/40">
                        {t.previous}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                      <span className="font-semibold text-foreground">{t.current}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!showWarningAccordion && (
            <div className="flex items-start gap-2 pt-0.5">
              <FileText className="h-3 w-3 text-muted-foreground/60 flex-shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {event.evidence.docTitle}
                  <span className="text-muted-foreground/50 font-normal ml-1">
                    ({event.evidence.docType})
                  </span>
                </span>
                <p className="text-[11px] text-muted-foreground/80 leading-snug line-clamp-2 italic">
                  "{event.evidence.sentence}"
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CurrentValue({
  value,
  direction,
}: {
  value: string
  direction?: "up" | "down"
}) {
  const isSpecial =
    value.includes("Gram") ||
    value === "HFNC" ||
    value.includes("Linezolid")

  if (isSpecial) {
    return (
      <span className="inline-flex items-center rounded bg-foreground/[0.08] px-1.5 py-0.5 text-[12px] font-bold text-foreground">
        {value}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "text-[12px] font-bold",
        direction ? "text-foreground" : "text-primary",
      )}
    >
      {value}
    </span>
  )
}
