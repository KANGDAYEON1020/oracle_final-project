"use client"

import { cn } from "@/lib/utils"
import { AXIS_META, SEVERITY_COLOR } from "@/lib/explain-types"
import type { ExplainEvent } from "@/lib/explain-types"
import { ExternalLink, ArrowRight } from "lucide-react"

interface ChangeProofPanelProps {
  event: ExplainEvent | null
  onRelatedEventClick?: (eventId: string) => void
  className?: string
}

function formatDocTs(iso: string): string {
  try {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const MM = String(d.getMonth() + 1).padStart(2, "0")
    const dd = String(d.getDate()).padStart(2, "0")
    const hh = String(d.getHours()).padStart(2, "0")
    const mm = String(d.getMinutes()).padStart(2, "0")
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}`
  } catch {
    return iso
  }
}

const DOC_TYPE_LABEL: Record<string, string> = {
  nursing_note: "간호 기록",
  physician_note: "의사 기록",
  lab_result: "검사 결과",
  microbiology: "미생물검사",
  radiology: "영상의학",
}

export function ChangeProofPanel({
  event,
  onRelatedEventClick,
  className,
}: ChangeProofPanelProps) {
  if (!event) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-border bg-card p-4",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">이벤트를 선택하면 상세 정보가 표시됩니다.</p>
      </div>
    )
  }

  const meta = AXIS_META[event.axis]
  const sevColor = SEVERITY_COLOR[event.severity]

  // EMR link simulation
  const handleOpenEmr = () => {
    alert(`Open EMR for document: ${event.evidence_after?.doc_id ?? "unknown"}`)
  }

  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden flex flex-col h-[150px]", className)}>
      {/* Compact Header */}
      <div className="border-b border-border px-4 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{meta.labelKo} Change</span>
          <div className="h-3 w-[1px] bg-border" />
          <span className="text-[11px] text-muted-foreground/80 font-mono">{event.event_id}</span>
        </div>

        <button
          onClick={handleOpenEmr}
          className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline hover:text-primary/80 transition-colors"
        >
          <span>EMR 원문 보기</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 p-3 flex flex-col justify-center gap-3">
        {/* Metadata Row */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground mb-0.5">Time</span>
            <span className="font-medium">{formatDocTs(event.ts)}</span>
          </div>
          <div className="h-6 w-[1px] bg-border" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground mb-0.5">Severity</span>
            <span className="font-bold flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: sevColor.bg }} />
              <span style={{ color: sevColor.bg }}>{event.severity.toUpperCase()}</span>
            </span>
          </div>
          <div className="h-6 w-[1px] bg-border" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground mb-0.5">Confidence</span>
            <span className="font-medium">{Math.round(event.confidence * 100)}%</span>
          </div>
          <div className="h-6 w-[1px] bg-border" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground mb-0.5">Source</span>
            <span className="font-medium">
              {event.evidence_after?.doc_type ? (DOC_TYPE_LABEL[event.evidence_after.doc_type] ?? event.evidence_after.doc_type) : "N/A"}
            </span>
          </div>
        </div>

        {/* Brief Context if available */}
        {event.related_event_ids && event.related_event_ids.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
            <span>Related:</span>
            <div className="flex gap-1">
              {event.related_event_ids.slice(0, 3).map(rid => (
                <span key={rid} className="bg-muted px-1 rounded text-[10px] font-mono">{rid}</span>
              ))}
              {event.related_event_ids.length > 3 && <span>...</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
