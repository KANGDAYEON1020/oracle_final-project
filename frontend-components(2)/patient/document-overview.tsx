"use client"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { buildLocalizedDiffLine } from "@/lib/explain-localize"
import {
  FileText,
  ExternalLink,
  Sparkles,
  Clock3,
  ShieldAlert,
} from "lucide-react"
import { AXIS_META, buildFlagLabels } from "@/lib/explain-types"
import type { ExplainEvent } from "@/lib/explain-types"

interface DocumentOverviewProps {
  event: ExplainEvent | null
  patientName: string
}

const DOC_TYPE_LABEL: Record<string, string> = {
  nursing_note: "간호 기록",
  physician_note: "의사 기록",
  lab_result: "검사 결과",
  microbiology: "미생물 검사",
  radiology: "영상 판독",
}

const EVENT_LABEL_KO: Record<string, string> = {
  hypoxia_detected: "저산소 악화",
  inflammation_rising: "염증수치 상승",
  symptom_worsening: "증상 악화",
  medication_start: "항생제 시작",
  monitoring_escalation: "모니터링 강화",
  mdro_confirmed: "격리 권고",
  routine_vitals: "정기 활력 관찰",
}

const SEVERITY_LABEL_KO: Record<ExplainEvent["severity"], string> = {
  critical: "치명",
  high: "높음",
  medium: "중간",
  low: "낮음",
  info: "참고",
  none: "없음",
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

function labelizeEventType(value: string): string {
  if (EVENT_LABEL_KO[value]) return EVENT_LABEL_KO[value]
  return value
    .split("_")
    .map((v) => v.slice(0, 1).toUpperCase() + v.slice(1))
    .join(" ")
}

export function DocumentOverview({ event, patientName }: DocumentOverviewProps) {
  if (!event) {
    return (
      <div className="flex flex-col h-full border-l border-border bg-card">
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-border flex-shrink-0 bg-muted/30">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              문서 요약
            </span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          이벤트를 선택하면 요약이 표시됩니다.
        </div>
      </div>
    )
  }

  const flagLabels = buildFlagLabels(event.evidence_after.flags)
  const axisLabel = AXIS_META[event.axis].labelKo
  const docTitle = DOC_TYPE_LABEL[event.evidence_after.doc_type] ?? event.evidence_after.doc_type
  const whatChanged = buildLocalizedDiffLine(event.now_prev)
  const previewLine = event.evidence_after.span_window || event.evidence_after.span

  return (
    <div className="flex flex-col h-full border-l border-border bg-card">
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-border flex-shrink-0 bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            문서 요약
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 flex flex-col gap-3">
          <div className="rounded-lg border border-primary/15 bg-primary/[0.03] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-[11px] font-bold text-primary uppercase tracking-wide">
                  변화 요약
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(event.confidence * 100)}%
              </span>
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-foreground/90 line-clamp-2">
              {whatChanged}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background px-3 py-2.5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <div className="text-muted-foreground">환자</div>
              <div className="font-medium text-foreground truncate">{patientName}</div>
              <div className="text-muted-foreground">축</div>
              <div className="font-medium text-foreground">{axisLabel}</div>
              <div className="text-muted-foreground">이벤트</div>
              <div className="font-medium text-foreground truncate">{labelizeEventType(event.event_type)}</div>
              <div className="text-muted-foreground">문서</div>
              <div className="font-medium text-foreground truncate">{docTitle}</div>
              <div className="text-muted-foreground">시각</div>
              <div className="font-medium text-foreground">{formatDocTs(event.evidence_after.doc_ts)}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {flagLabels.slice(0, 3).map((label) => (
              <span
                key={label}
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  label === "[계획]" && "border-primary/20 bg-primary/[0.06] text-primary",
                  label === "[불확실]" && "border-warning/20 bg-warning/[0.06] text-warning-foreground",
                  label === "[부정]" && "border-border bg-muted text-muted-foreground",
                )}
              >
                {label}
              </span>
            ))}
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {SEVERITY_LABEL_KO[event.severity]}
            </span>
          </div>

          <details className="rounded-md border border-border bg-muted/30 p-2">
            <summary className="cursor-pointer list-none text-[11px] text-muted-foreground flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" />
              근거 미리보기 (접힘 기본)
            </summary>
            <p className="mt-2 text-[11px] leading-snug text-foreground/70 line-clamp-3">
              {previewLine}
            </p>
          </details>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/[0.04] px-3 py-2 text-[12px] font-medium text-primary hover:bg-primary/[0.08] transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            EMR에서 원문 보기
          </button>

          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Clock3 className="h-3 w-3" />
            원문 확인은 EMR에서 진행합니다.
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
