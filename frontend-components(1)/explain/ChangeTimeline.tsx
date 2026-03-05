"use client"

import { useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { buildLocalizedDiffLine } from "@/lib/explain-localize"
import { SEVERITY_COLOR, AXIS_META, buildFlagLabels } from "@/lib/explain-types"
import type { ExplainEvent } from "@/lib/explain-types"
import { ExternalLink, FileText } from "lucide-react"

interface ChangeTimelineProps {
  events: ExplainEvent[]
  selectedEventId: string | null
  onEventSelect: (eventId: string) => void
  showContextEvents?: boolean
  className?: string
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${month}/${day} ${hh}:${mm}`
  } catch {
    return iso
  }
}

function SeverityDot({ severity }: { severity: ExplainEvent["severity"] }) {
  const color = SEVERITY_COLOR[severity]
  return (
    <span
      className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color.bg }}
    />
  )
}

function FlagBadges({ flags }: { flags: ExplainEvent["evidence_after"]["flags"] }) {
  const labels = buildFlagLabels(flags)
  if (labels.length === 0) return null

  const styleMap: Record<string, string> = {
    "[부정]": "bg-gray-500/10 text-gray-400 border-gray-500/30 line-through",
    "[불확실]": "bg-amber-500/10 text-amber-400 border-amber-500/30 italic",
    "[계획]": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  }

  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((l) => (
        <span
          key={l}
          className={cn("rounded border px-1 text-[9px] font-medium", styleMap[l] ?? "bg-muted/30")}
        >
          {l}
        </span>
      ))}
    </span>
  )
}

function EventCard({
  event,
  isSelected,
  isContext,
  onClick,
}: {
  event: ExplainEvent
  isSelected: boolean
  isContext: boolean
  onClick: () => void
}) {
  const meta = AXIS_META[event.axis]
  const sevColor = SEVERITY_COLOR[event.severity]

  // Simulate EMR link click
  const handleOpenEmr = (e: React.MouseEvent) => {
    e.stopPropagation()
    alert(`Open EMR for event: ${event.event_id}`)
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "group w-full rounded-lg border text-left transition-all",
        "px-3 py-3 flex items-start gap-3",
        isSelected
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/30 hover:bg-card/80",
        isContext && !isSelected && "opacity-60",
      )}
    >
      <SeverityDot severity={event.severity} />

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Header: Time, Axis, Severity */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: `${sevColor.bg}15`, color: sevColor.bg }}
            >
              {event.severity.toUpperCase()}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground border border-border rounded px-1.5 py-0.5">
              {meta.labelKo}
            </span>
            {isContext && (
              <span className="text-[10px] text-muted-foreground/60 italic">맥락</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
            {formatEventTime(event.ts)}
          </span>
        </div>

        {/* Delta: Emphasized */}
        <p className="text-sm font-semibold text-foreground leading-snug break-words">
          {buildLocalizedDiffLine(event.now_prev)}
        </p>

        {/* Summary: Truncated */}
        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-1">
          {event.summary_ko}
        </p>

        {/* Footer: Flags + EMR Link */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1">
            {event.evidence_after?.flags && (
              <FlagBadges flags={event.evidence_after.flags} />
            )}
          </div>

          <div
            role="button"
            onClick={handleOpenEmr}
            className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary hover:underline transition-colors ml-auto"
          >
            <span>EMR 보기</span>
            <ExternalLink className="h-3 w-3" />
          </div>
        </div>
      </div>
    </button>
  )
}

export function ChangeTimeline({
  events,
  selectedEventId,
  onEventSelect,
  showContextEvents = false,
  className,
}: ChangeTimelineProps) {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (selectedEventId && cardRefs.current[selectedEventId]) {
      cardRefs.current[selectedEventId]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      })
    }
  }, [selectedEventId])

  if (events.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-8",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">해당 기간에 변화 이벤트가 없습니다.</p>
      </div>
    )
  }

  const issueEvents = events.filter((e) => e.issue_only)
  const contextEvents = events.filter((e) => !e.issue_only)

  return (
    <div className={cn("flex flex-col gap-2 overflow-y-auto pr-1", className)}>
      {issueEvents.map((event) => (
        <div key={event.event_id} ref={(el) => { cardRefs.current[event.event_id] = el }}>
          <EventCard
            event={event}
            isSelected={selectedEventId === event.event_id}
            isContext={false}
            onClick={() => onEventSelect(event.event_id)}
          />
        </div>
      ))}

      {showContextEvents && contextEvents.length > 0 && (
        <>
          <div className="flex items-center gap-2 mt-2 mb-1">
            <div className="flex-1 border-t border-dashed border-border" />
            <span className="text-[10px] text-muted-foreground shrink-0 uppercase tracking-wider">Context Events</span>
            <div className="flex-1 border-t border-dashed border-border" />
          </div>
          {contextEvents.map((event) => (
            <div key={event.event_id} ref={(el) => { cardRefs.current[event.event_id] = el }}>
              <EventCard
                event={event}
                isSelected={selectedEventId === event.event_id}
                isContext={true}
                onClick={() => onEventSelect(event.event_id)}
              />
            </div>
          ))}
        </>
      )}

      {showContextEvents && contextEvents.length === 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">
          표시할 맥락 이벤트가 없습니다.
        </p>
      )}
    </div>
  )
}
