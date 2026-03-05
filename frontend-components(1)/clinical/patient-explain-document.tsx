"use client"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  buildLocalizedDiffLine,
  formatExplainValue,
  localizeExplainFieldLabel,
} from "@/lib/explain-localize"
import {
  Sparkles,
  User,
  Clock,
  FileCheck,
  FileText,
  Copy,
  ExternalLink,
  ArrowRight,
} from "lucide-react"
import { AXIS_META, SEVERITY_COLOR, buildFlagLabels } from "@/lib/explain-types"
import type { ExplainEvent, Evidence } from "@/lib/explain-types"

// ── Document type labels ──

const DOC_TYPE_LABEL: Record<string, string> = {
  nursing_note: "간호 기록",
  physician_note: "의사 기록",
  lab_result: "검사 결과",
  microbiology: "미생물검사",
  radiology: "영상의학",
}

const AUTHOR_ROLE_LABEL: Record<string, string> = {
  RN: "간호사",
  MD: "의사",
  LAB: "검사실",
  RAD: "영상의학과",
}

// ── Formatting helpers ──

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

// ── Flag badge styles ──

const FLAG_STYLES: Record<string, { className: string }> = {
  "[부정]": { className: "bg-gray-500/10 text-gray-400 border-gray-500/30 line-through" },
  "[불확실]": { className: "bg-amber-500/10 text-amber-400 border-amber-500/30 italic" },
  "[계획]": { className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
}

// ── Sub-components ──

function EvidenceSection({
  evidence,
  label,
  isNull,
}: {
  evidence: Evidence | null
  label: string
  isNull?: boolean
}) {
  const flagLabels = evidence ? buildFlagLabels(evidence.flags) : []

  return (
    <div>
      <h3 className="text-[11px] font-bold text-foreground uppercase tracking-wide mb-1.5">
        {label}:
      </h3>

      {isNull || !evidence ? (
        <p className="text-[13px] text-muted-foreground/70 italic leading-relaxed">
          첫 관찰 — 이전 기록이 없습니다.
        </p>
      ) : (
        <div className="space-y-2">
          {/* Document metadata */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <User className="h-3 w-3" />
              {AUTHOR_ROLE_LABEL[evidence.author_role] ?? evidence.author_role}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDocTs(evidence.doc_ts)}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <FileCheck className="h-3 w-3" />
              {DOC_TYPE_LABEL[evidence.doc_type] ?? evidence.doc_type}
            </span>
          </div>

          {/* Flag badges */}
          {flagLabels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {flagLabels.map((l) => (
                <span
                  key={l}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                    FLAG_STYLES[l]?.className ?? "bg-muted/30",
                  )}
                >
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Evidence span (원문 그대로, § 핵심원칙 3·10) */}
          <p className="text-[13px] text-foreground/70 leading-relaxed">
            <mark className="rounded px-1 py-0.5 font-semibold not-italic bg-primary/12 text-primary">
              {evidence.span}
            </mark>
          </p>

          {/* Span window (context) */}
          {evidence.span_window && evidence.span_window.trim() && (
            <p className="text-[13px] text-foreground/50 leading-relaxed italic">
              {evidence.span_window}
            </p>
          )}

          {/* Slot refs */}
          {evidence.slot_refs && evidence.slot_refs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {evidence.slot_refs.map((ref) => (
                <span
                  key={ref}
                  className="rounded-full bg-muted/40 border border-border px-2 py-0.5 text-[10px] text-muted-foreground font-mono"
                >
                  {ref}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Document Panel ──

interface PatientExplainDocumentProps {
  event: ExplainEvent | null
  onRelatedEventClick?: (eventId: string) => void
}

export function PatientExplainDocument({
  event,
  onRelatedEventClick,
}: PatientExplainDocumentProps) {
  if (!event) {
    return (
      <div className="flex flex-col h-full border-l border-border bg-card">
        <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border flex-shrink-0 bg-muted/30">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            근거 문서
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            이벤트를 선택하면 상세 정보가 표시됩니다.
          </p>
        </div>
      </div>
    )
  }

  const meta = AXIS_META[event.axis]
  const sevColor = SEVERITY_COLOR[event.severity]

  return (
    <div className="flex flex-col h-full border-l border-border bg-card">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border flex-shrink-0 bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            근거 문서
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open in new window"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 flex flex-col gap-5">
          {/* AI Summary Card */}
          <div className="rounded-lg border border-primary/15 bg-primary/[0.03] p-4">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-bold text-primary uppercase tracking-wide">
                  AI Summary
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                신뢰도 {Math.round(event.confidence * 100)}%
              </span>
            </div>

            <p className="text-[13px] text-foreground/80 leading-relaxed">
              {event.summary_ko}
            </p>

            {/* Tags: severity + axis */}
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <span
                className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: `${sevColor.bg}15`,
                  color: sevColor.bg,
                  borderColor: `${sevColor.bg}30`,
                }}
              >
                {event.severity.toUpperCase()}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-card px-2.5 py-0.5 text-[10px] font-medium text-primary">
                {meta.labelKo}
              </span>
              <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground font-mono">
                {event.event_type}
              </span>
            </div>
          </div>

          {/* What Changed (diff_line) */}
          <div className="rounded-lg bg-muted/30 border border-border px-4 py-3">
            <p className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
              What Changed
            </p>
            <p className="text-[13px] font-mono text-foreground leading-relaxed">
              {buildLocalizedDiffLine(event.now_prev)}
            </p>

            <div className="mt-3 flex items-start gap-4 text-[12px]">
              <div className="flex-1 space-y-0.5">
                <p className="text-muted-foreground font-medium text-[11px]">이전 (Before)</p>
                {Object.entries(event.now_prev.prev).map(([k, v]) => (
                  <p key={k} className="text-muted-foreground/80 font-mono text-[11px]">
                    {localizeExplainFieldLabel(k)}: {formatExplainValue(v)}
                  </p>
                ))}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-3" />
              <div className="flex-1 space-y-0.5">
                <p className="text-foreground font-medium text-[11px]">현재 (After)</p>
                {Object.entries(event.now_prev.now).map(([k, v]) => (
                  <p key={k} className="text-foreground/80 font-mono text-[11px]">
                    {localizeExplainFieldLabel(k)}: {formatExplainValue(v)}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-border" />

          {/* Evidence sections */}
          <div className="flex flex-col gap-4">
            <EvidenceSection
              evidence={event.evidence_after}
              label="AFTER (현재 근거)"
            />
            <EvidenceSection
              evidence={event.evidence_before}
              label="BEFORE (이전 근거)"
              isNull={event.evidence_before === null}
            />
          </div>

          {/* Related Events */}
          {event.related_event_ids && event.related_event_ids.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-foreground uppercase tracking-wide mb-2">
                연관 이벤트
              </p>
              <div className="flex flex-wrap gap-1.5">
                {event.related_event_ids.map((rid) => (
                  <button
                    key={rid}
                    onClick={() => onRelatedEventClick?.(rid)}
                    className="flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2.5 py-1 text-[11px] text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    {rid}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
