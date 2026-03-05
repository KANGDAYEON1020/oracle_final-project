"use client"

import React from "react"

import { useRef } from "react"
import { useState } from "react"
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  HelpCircle,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  Sparkles,
  BarChart3,
  Info,
  Wind,
  Activity,
  ArrowRight,
  Bell,
  Pill,
  Monitor,
  ClipboardPlus,
  FlaskConical,
  Stethoscope,
  FileImage,
  Bug,
  Bed,
  ShieldCheck,
  ShieldAlert,
  Users,
  MapPin,
  AlertTriangle,
  Zap,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { 
  NLPTag, 
  DocumentComparison, 
  TimelineEvent, 
  NLPTagType,
  NumericTrajectoryAxis,
  SepsisExplanation,
  WardSHAPSummary,
  EnhancedTimelineEvent, 
  ReferralNote, 
  DiagnosisGuideline,
  GuidelineItem,
  MDROBedAssignment,
  SeverityAssessment,
  FusedAlert,
  ClusterAlert
} from "@/lib/types"

// NLP Tag Badge Component with Tooltip
interface NLPTagBadgeProps {
  tag: NLPTag
  size?: "sm" | "md"
}

const getTagStyles = (type: NLPTagType) => {
  switch (type) {
    case "negation":
      return { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-300", icon: XCircle }
    case "uncertainty":
      return { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", icon: HelpCircle }
    case "trajectory":
      return { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", icon: TrendingUp }
    case "plan":
      return { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400", icon: FileText }
    default:
      return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-700 dark:text-gray-300", icon: Info }
  }
}

export function NLPTagBadge({ tag, size = "md" }: NLPTagBadgeProps) {
  const styles = getTagStyles(tag.type)
  const Icon = styles.icon

  // Override icon for trajectory based on direction
  const TrajectoryIcon = tag.trajectory === "worsening" ? TrendingUp : 
                         tag.trajectory === "improving" ? TrendingDown : Minus

  return (
    <TooltipProvider>
      <UITooltip>
        <TooltipTrigger asChild>
          <Badge 
            variant="outline" 
            className={cn(
              "cursor-pointer transition-all hover:scale-105",
              styles.bg, 
              styles.text,
              size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1"
            )}
          >
            {tag.type === "trajectory" ? (
              <TrajectoryIcon className={cn("mr-1", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
            ) : (
              <Icon className={cn("mr-1", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
            )}
            {tag.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">
            <span className="font-medium">Text: </span>
            <span className="text-muted-foreground italic">&apos;{tag.evidence}&apos;</span>
          </p>
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}

// Evidence Snippet Component (for Dashboard Cards) - Feature 1: bg-yellow-100 underline highlight
interface EvidenceSnippetProps {
  snippet: string
  tags?: NLPTag[]
}

export function EvidenceSnippet({ snippet, tags = [] }: EvidenceSnippetProps) {
  return (
    <div className="mt-2 p-2 rounded-md bg-muted/50 border border-border/50">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">근거: </span>
        <span className="bg-yellow-100 dark:bg-yellow-500/30 underline decoration-yellow-500 decoration-2 underline-offset-2 px-1 py-0.5 rounded text-foreground font-medium">
          {snippet}
        </span>
      </p>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.map((tag, i) => (
            <NLPTagBadge key={i} tag={tag} size="sm" />
          ))}
        </div>
      )}
    </div>
  )
}

// =========================================================
// v2.0 Enhanced Clinical Document Timeline
// =========================================================

// Structured Nursing Record Display
function NursingRecordCard({ data }: { data: NonNullable<EnhancedTimelineEvent["nursingData"]> }) {
  return (
    <div className="space-y-3 p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-200/50 dark:border-blue-800/30">
      {/* Subjective Complaint */}
      {data.subjectiveComplaint && (
        <div className="flex items-start gap-2">
          <Badge variant="outline" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-[10px] shrink-0">
            주관적 호소
          </Badge>
          <p className="text-xs italic">&quot;{data.subjectiveComplaint}&quot;</p>
        </div>
      )}

      {/* Vital Signs */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">활력징후</p>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1.5 p-1.5 rounded bg-background border">
            <span className="text-[10px] text-muted-foreground">SpO2</span>
            <span className={cn(
              "text-xs font-bold",
              data.vitalSigns.spO2 < 94 ? "text-[#ef4444]" : "text-foreground"
            )}>
              {data.vitalSigns.spO2}%
            </span>
            {data.vitalSigns.o2Flow && (
              <span className="text-[10px] text-muted-foreground">
                ({data.vitalSigns.o2Device} {data.vitalSigns.o2Flow})
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 p-1.5 rounded bg-background border">
            <span className="text-[10px] text-muted-foreground">Temp</span>
            <span className={cn(
              "text-xs font-bold",
              data.vitalSigns.temp >= 38 ? "text-[#ef4444]" : "text-foreground"
            )}>
              {data.vitalSigns.temp.toFixed(1)}°C
            </span>
          </div>
          {data.vitalSigns.hr && (
            <div className="flex items-center gap-1.5 p-1.5 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground">HR</span>
              <span className="text-xs font-bold">{data.vitalSigns.hr}</span>
            </div>
          )}
          {data.vitalSigns.bp && (
            <div className="flex items-center gap-1.5 p-1.5 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground">BP</span>
              <span className="text-xs font-bold">{data.vitalSigns.bp}</span>
            </div>
          )}
          {data.vitalSigns.rr && (
            <div className="flex items-center gap-1.5 p-1.5 rounded bg-background border">
              <span className="text-[10px] text-muted-foreground">RR</span>
              <span className={cn(
                "text-xs font-bold",
                data.vitalSigns.rr > 24 ? "text-[#ef4444]" : "text-foreground"
              )}>
                {data.vitalSigns.rr}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Interventions */}
      {(data.interventions.o2Escalation || data.interventions.nebulizer || data.interventions.suction || (data.interventions.medication && data.interventions.medication.length > 0)) && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5">처치</p>
          <div className="flex flex-wrap gap-1.5">
            {data.interventions.o2Escalation && (
              <Badge variant="outline" className="bg-[#ef4444]/10 text-[#ef4444] text-[10px]">
                O2 {data.interventions.o2Escalation}
              </Badge>
            )}
            {data.interventions.nebulizer && (
              <Badge variant="outline" className="bg-[#3b82f6]/10 text-[#3b82f6] text-[10px]">
                Nebulizer
              </Badge>
            )}
            {data.interventions.suction && (
              <Badge variant="outline" className="bg-[#f59e0b]/10 text-[#f59e0b] text-[10px]">
                Suction
              </Badge>
            )}
            {data.interventions.medication?.map((med, i) => (
              <Badge key={i} variant="outline" className="bg-[#10b981]/10 text-[#10b981] text-[10px]">
                {med}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Notify */}
      {data.notify && data.notify.count > 0 && (
        <div className="flex items-center gap-2 p-2 rounded bg-[#ef4444]/10 border border-[#ef4444]/20">
          <Bell className="h-3.5 w-3.5 text-[#ef4444]" />
          <span className="text-xs text-[#ef4444] font-medium">
            Dr. Notify {data.notify.count}회
          </span>
          {data.notify.reason && (
            <span className="text-[10px] text-muted-foreground">- {data.notify.reason}</span>
          )}
        </div>
      )}

      {/* New Orders */}
      {data.newOrders && data.newOrders.length > 0 && (
        <div>
          <p className="text-[10px] font-medium text-muted-foreground mb-1">새 오더</p>
          <div className="flex flex-wrap gap-1">
            {data.newOrders.map((order, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">
                {order}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Structured Doctor Note Display
function DoctorNoteCard({ data }: { data: NonNullable<EnhancedTimelineEvent["doctorData"]> }) {
  return (
    <div className="space-y-3 p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200/50 dark:border-emerald-800/30">
      {/* Diagnosis */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">진단</p>
        <div className="flex flex-wrap gap-1.5">
          {data.diagnosis.map((dx, i) => (
            <Badge key={i} className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-[10px]">
              {dx}
            </Badge>
          ))}
        </div>
      </div>

      {/* Status Summary */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-1">상태 요약</p>
        <p className="text-xs">{data.statusSummary}</p>
      </div>

      {/* Plan */}
      <div>
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">계획</p>
        <div className="space-y-1">
          {data.plan.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <ArrowRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              {p}
            </div>
          ))}
        </div>
      </div>

      {/* Comparison to Previous */}
      {data.comparisonToPrev && (
        <div className="p-2 rounded bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground mb-1">이전 대비</p>
          <p className="text-xs italic">{data.comparisonToPrev}</p>
        </div>
      )}
    </div>
  )
}

// Structured CXR Report Display
function CXRReportCard({ data }: { data: NonNullable<EnhancedTimelineEvent["cxrData"]> }) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "severe": return "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30"
      case "moderate": return "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30"
      default: return "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30"
    }
  }

  return (
    <div className="space-y-3 p-3 bg-slate-50/50 dark:bg-slate-950/20 rounded-lg border border-slate-200/50 dark:border-slate-800/30">
      {/* Location / Type / Extent / Severity */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded bg-background border">
          <p className="text-[10px] text-muted-foreground">부위</p>
          <p className="text-xs font-bold">{data.location}</p>
        </div>
        <div className="p-2 rounded bg-background border">
          <p className="text-[10px] text-muted-foreground">유형</p>
          <p className="text-xs font-bold">{data.type}</p>
        </div>
        <div className="p-2 rounded bg-background border">
          <p className="text-[10px] text-muted-foreground">범위</p>
          <p className="text-xs font-bold">{data.extent}</p>
        </div>
        <div className={cn("p-2 rounded border", getSeverityColor(data.severity))}>
          <p className="text-[10px] opacity-70">강도</p>
          <p className="text-xs font-bold uppercase">{data.severity}</p>
        </div>
      </div>

      {/* Comparison */}
      {data.comparison && (
        <div className="p-2 rounded bg-muted/50 border border-border">
          <p className="text-[10px] text-muted-foreground mb-1">비교</p>
          <p className="text-xs italic">{data.comparison}</p>
        </div>
      )}
    </div>
  )
}

// Structured Culture Result Display
function CultureResultCard({ data }: { data: NonNullable<EnhancedTimelineEvent["cultureData"]> }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "positive": return "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30"
      case "negative": return "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30"
      default: return "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30"
    }
  }

  return (
    <div className="space-y-3 p-3 bg-purple-50/50 dark:bg-purple-950/20 rounded-lg border border-purple-200/50 dark:border-purple-800/30">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground">검체</p>
          <p className="text-sm font-bold">{data.specimen}</p>
        </div>
        <Badge className={cn("text-xs", getStatusColor(data.status))}>
          {data.status === "positive" ? "양성" : data.status === "negative" ? "음성" : "대기"}
        </Badge>
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-4 text-xs">
        <div>
          <p className="text-[10px] text-muted-foreground">채취</p>
          <p>{data.collectionTime}</p>
        </div>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <div>
          <p className="text-[10px] text-muted-foreground">결과</p>
          <p>{data.resultTime || "대기 중"}</p>
        </div>
      </div>

      {/* Organism & Resistance */}
      {data.organism && (
        <div className="p-2 rounded bg-[#ef4444]/5 border border-[#ef4444]/20">
          <p className="text-xs font-bold text-[#ef4444]">{data.organism}</p>
          {data.resistance && data.resistance.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {data.resistance.map((r, i) => (
                <Badge key={i} variant="destructive" className="text-[10px]">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Structured Lab Result Display
function LabResultCard({ data }: { data: NonNullable<EnhancedTimelineEvent["labData"]> }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "critical": return "text-[#ef4444] bg-[#ef4444]/10"
      case "high": return "text-[#f59e0b] bg-[#f59e0b]/10"
      case "low": return "text-[#3b82f6] bg-[#3b82f6]/10"
      default: return "text-[#10b981] bg-[#10b981]/10"
    }
  }

  return (
    <div className="space-y-2 p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/30">
      <p className="text-[10px] font-medium text-muted-foreground">감염 활성도 지표</p>
      <div className="grid grid-cols-3 gap-2">
        {/* Required */}
        <div className={cn("p-2 rounded border", getStatusColor(data.wbc.status))}>
          <p className="text-[10px] opacity-70">WBC</p>
          <p className="text-sm font-bold">{data.wbc.value}</p>
        </div>
        <div className={cn("p-2 rounded border", getStatusColor(data.crp.status))}>
          <p className="text-[10px] opacity-70">CRP</p>
          <p className="text-sm font-bold">{data.crp.value}</p>
        </div>
        <div className={cn("p-2 rounded border", getStatusColor(data.temp.status))}>
          <p className="text-[10px] opacity-70">Temp</p>
          <p className="text-sm font-bold">{data.temp.value}°C</p>
        </div>
        {/* Optional */}
        {data.lactate && (
          <div className={cn("p-2 rounded border", getStatusColor(data.lactate.status))}>
            <p className="text-[10px] opacity-70">Lactate</p>
            <p className="text-sm font-bold">{data.lactate.value}</p>
          </div>
        )}
        {data.creatinine && (
          <div className={cn("p-2 rounded border", getStatusColor(data.creatinine.status))}>
            <p className="text-[10px] opacity-70">Cr</p>
            <p className="text-sm font-bold">{data.creatinine.value}</p>
          </div>
        )}
        {data.platelet && (
          <div className={cn("p-2 rounded border", getStatusColor(data.platelet.status))}>
            <p className="text-[10px] opacity-70">Plt</p>
            <p className="text-sm font-bold">{data.platelet.value}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// Main Enhanced Document Timeline Component
interface EnhancedDocumentTimelineProps {
  events: EnhancedTimelineEvent[]
}

export function EnhancedDocumentTimeline({ events }: EnhancedDocumentTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "imaging": return FileImage
      case "lab": return FlaskConical
      case "note": return Stethoscope
      case "culture": return Bug
      default: return FileText
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case "imaging": return "bg-slate-500"
      case "lab": return "bg-amber-500"
      case "note": return "bg-blue-500"
      case "culture": return "bg-purple-500"
      default: return "bg-gray-500"
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "imaging": return "CXR"
      case "lab": return "Lab"
      case "note": return "기록"
      case "culture": return "배양"
      default: return "문서"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          임상 문서 타임라인 (상세)
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          간호기록, 의사기록, CXR, Lab, 배양 결과의 구조화된 뷰
        </p>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {events.map((event, index) => {
              const Icon = getTypeIcon(event.type)
              const isExpanded = expandedId === event.id

              return (
                <div key={event.id} className="relative">
                  {/* Timeline line */}
                  {index < events.length - 1 && (
                    <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-border" />
                  )}

                  <div className="flex gap-3">
                    {/* Timeline dot */}
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                      getTypeColor(event.type)
                    )}>
                      <Icon className="h-3 w-3 text-white" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-4">
                      <button
                        type="button"
                        className="w-full text-left cursor-pointer group"
                        onClick={() => setExpandedId(isExpanded ? null : event.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {getTypeLabel(event.type)}
                            </Badge>
                            <p className="text-sm font-medium group-hover:text-primary transition-colors">
                              {event.title}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-muted-foreground">{event.date}</p>
                            <ChevronRight className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              isExpanded && "rotate-90"
                            )} />
                          </div>
                        </div>

                        {/* Summary */}
                        <p className="text-xs text-muted-foreground mt-1">{event.summary}</p>

                        {/* NLP Chips */}
                        {event.nlpChips.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {event.nlpChips.map((chip, i) => (
                              <Badge 
                                key={i}
                                variant="outline" 
                                className={cn(
                                  "text-[10px]",
                                  getTagStyles(chip.type).bg,
                                  getTagStyles(chip.type).text
                                )}
                              >
                                {chip.label}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>

                      {/* Expanded Structured Data */}
                      {isExpanded && (
                        <div className="mt-3 animate-fade-in">
                          {event.nursingData && <NursingRecordCard data={event.nursingData} />}
                          {event.doctorData && <DoctorNoteCard data={event.doctorData} />}
                          {event.cxrData && <CXRReportCard data={event.cxrData} />}
                          {event.cultureData && <CultureResultCard data={event.cultureData} />}
                          {event.labData && <LabResultCard data={event.labData} />}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

// =========================================================
// v2.0 Referral Note Auto-draft Component
// =========================================================

interface ReferralNoteCardProps {
  referralNote: ReferralNote
  onCopy?: () => void
}

export function ReferralNoteCard({ referralNote, onCopy }: ReferralNoteCardProps) {
  const [copied, setCopied] = useState(false)
  const noteRef = useRef<HTMLDivElement>(null)

  const handleCopy = async () => {
    if (noteRef.current) {
      const text = noteRef.current.innerText
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      onCopy?.()
    }
  }

  const getStatusBadge = (status: "normal" | "warning" | "critical") => {
    const colors = {
      normal: "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30",
      warning: "bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30",
      critical: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30"
    }
    const labels = { normal: "정상", warning: "주의", critical: "위험" }
    return <Badge className={cn("text-[10px]", colors[status])}>{labels[status]}</Badge>
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            전원 의뢰서 초안
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              자동 생성
            </Badge>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
            >
              {copied ? <CheckCircle className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          최근 24-72시간 추이 요약 | 최종 책임은 의료진에게 있습니다
        </p>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[450px] pr-4">
          <div ref={noteRef} className="space-y-4 text-sm">
            {/* Patient Summary */}
            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2">환자 요약</p>
              <p>
                {referralNote.patientSummary.age}세 {referralNote.patientSummary.gender === "M" ? "남성" : "여성"} / 
                {referralNote.patientSummary.primaryDiagnosis}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                입원일: {referralNote.patientSummary.admissionDate} (D{referralNote.patientSummary.currentDay})
              </p>
            </div>

            {/* Trajectory Snapshot */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">5-7일 Trajectory 요약</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded border bg-background">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">호흡기</span>
                    {getStatusBadge(referralNote.trajectorySnapshot.respiratory.status)}
                  </div>
                  <p className="text-xs">{referralNote.trajectorySnapshot.respiratory.summary}</p>
                </div>
                <div className="p-2 rounded border bg-background">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">감염 활성도</span>
                    {getStatusBadge(referralNote.trajectorySnapshot.infection.status)}
                  </div>
                  <p className="text-xs">{referralNote.trajectorySnapshot.infection.summary}</p>
                </div>
                <div className="p-2 rounded border bg-background">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">임상 개입</span>
                    {getStatusBadge(referralNote.trajectorySnapshot.clinicalAction.status)}
                  </div>
                  <p className="text-xs">{referralNote.trajectorySnapshot.clinicalAction.summary}</p>
                </div>
                <div className="p-2 rounded border bg-background">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">중증도</span>
                    {getStatusBadge(referralNote.trajectorySnapshot.severity.status)}
                  </div>
                  <p className="text-xs">{referralNote.trajectorySnapshot.severity.summary}</p>
                </div>
              </div>
            </div>

            {/* Recent Results */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">최근 검사/영상/배양 결과</p>
              <div className="space-y-2">
                {/* Labs */}
                <div className="p-2 rounded bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/30">
                  <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1">Lab</p>
                  <div className="flex flex-wrap gap-2">
                    {referralNote.recentResults.labs.map((lab, i) => (
                      <span key={i} className={cn(
                        "text-xs px-1.5 py-0.5 rounded",
                        lab.status === "critical" ? "bg-[#ef4444]/10 text-[#ef4444]" :
                        lab.status === "high" ? "bg-[#f59e0b]/10 text-[#f59e0b]" :
                        "bg-muted"
                      )}>
                        {lab.key}: {lab.value}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Imaging */}
                <div className="p-2 rounded bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/30">
                  <p className="text-[10px] font-medium text-slate-700 dark:text-slate-300 mb-1">영상</p>
                  {referralNote.recentResults.imaging.map((img, i) => (
                    <p key={i} className="text-xs">
                      {img.date} {img.type}: {img.finding}
                    </p>
                  ))}
                </div>
                {/* Culture */}
                <div className="p-2 rounded bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/50 dark:border-purple-800/30">
                  <p className="text-[10px] font-medium text-purple-700 dark:text-purple-300 mb-1">배양</p>
                  {referralNote.recentResults.culture.map((cx, i) => (
                    <p key={i} className="text-xs">
                      {cx.date} {cx.specimen}: {cx.result}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {/* Current Treatment */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">현재 치료</p>
              <div className="p-2 rounded bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 dark:border-emerald-800/30">
                <div className="space-y-1 text-xs">
                  <p><strong>항생제:</strong> {referralNote.currentTreatment.antibiotics.join(", ")}</p>
                  {referralNote.currentTreatment.oxygenTherapy && (
                    <p><strong>산소:</strong> {referralNote.currentTreatment.oxygenTherapy}</p>
                  )}
                  {referralNote.currentTreatment.fluids && (
                    <p><strong>수액:</strong> {referralNote.currentTreatment.fluids}</p>
                  )}
                  {referralNote.currentTreatment.interventions && referralNote.currentTreatment.interventions.length > 0 && (
                    <p><strong>중재:</strong> {referralNote.currentTreatment.interventions.join(", ")}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Transfer Reason */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">전원 사유 (근거 기반)</p>
              <div className="p-2 rounded bg-[#ef4444]/5 border border-[#ef4444]/20">
                <ul className="space-y-1.5">
                  {referralNote.transferReason.map((reason, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <AlertCircle className="h-3 w-3 text-[#ef4444] shrink-0 mt-0.5" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Request Items */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">요청사항</p>
              <div className="flex flex-wrap gap-1.5">
                {referralNote.requestItems.map((item, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="border-t border-border pt-3">
              <p className="text-[10px] text-destructive text-center">
                ※ 본 문서는 자동 생성된 초안이며, 최종 책임은 담당 의료진에게 있습니다
              </p>
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

// =========================================================
// v2.0 Guideline RAG for Confirmed Diagnosis
// =========================================================

interface GuidelineRAGPanelProps {
  guideline: DiagnosisGuideline
  onItemCheck?: (itemId: string, checked: boolean) => void
}

export function GuidelineRAGPanel({ guideline, onItemCheck }: GuidelineRAGPanelProps) {
  const [localGuideline, setLocalGuideline] = useState(guideline)

  const handleCheck = (category: keyof Pick<DiagnosisGuideline, "checkNow" | "contraindications" | "transferCriteria">, itemId: string) => {
    setLocalGuideline(prev => ({
      ...prev,
      [category]: prev[category].map(item => 
        item.id === itemId ? { ...item, checked: !item.checked } : item
      )
    }))
    const item = localGuideline[category].find(i => i.id === itemId)
    if (item) {
      onItemCheck?.(itemId, !item.checked)
    }
  }

  const checkedTransferCount = localGuideline.transferCriteria.filter(i => i.checked).length

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            확진 환자 가이드라인
          </CardTitle>
          <Badge className="bg-primary/10 text-primary text-[10px]">
            {guideline.diagnosis}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          확진일: {guideline.confirmedAt} | 진단 확�� 환자에 한해 제공
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Check Now - 지금 꼭 확인할 5개 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30 text-[10px]">
              지금 꼭 확인할 것
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {localGuideline.checkNow.filter(i => i.checked).length}/{localGuideline.checkNow.length} 완료
            </span>
          </div>
          <div className="space-y-1.5">
            {localGuideline.checkNow.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => handleCheck("checkNow", item.id)}
                className={cn(
                  "w-full flex items-center gap-2 p-2 rounded-lg border transition-all text-left",
                  item.checked 
                    ? "bg-[#10b981]/10 border-[#10b981]/30" 
                    : item.critical 
                    ? "bg-[#ef4444]/5 border-[#ef4444]/20 hover:border-[#ef4444]/40"
                    : "bg-muted/30 border-border hover:border-muted-foreground"
                )}
              >
                {item.checked ? (
                  <CheckCircle className="h-4 w-4 text-[#10b981] shrink-0" />
                ) : (
                  <div className={cn(
                    "w-4 h-4 rounded-full border-2 shrink-0",
                    item.critical ? "border-[#ef4444]" : "border-muted-foreground"
                  )} />
                )}
                <span className={cn(
                  "text-xs flex-1",
                  item.checked && "line-through text-muted-foreground"
                )}>
                  {item.text}
                </span>
                {item.critical && !item.checked && (
                  <Badge variant="destructive" className="text-[10px]">필수</Badge>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Contraindications - 금기/주의 */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30 text-[10px]">
              금기/주의
            </Badge>
          </div>
          <div className="space-y-1.5">
            {localGuideline.contraindications.map(item => (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-2 p-2 rounded-lg border",
                  item.critical 
                    ? "bg-[#f59e0b]/5 border-[#f59e0b]/20"
                    : "bg-muted/30 border-border"
                )}
              >
                <AlertCircle className={cn(
                  "h-4 w-4 shrink-0",
                  item.critical ? "text-[#f59e0b]" : "text-muted-foreground"
                )} />
                <span className="text-xs">{item.text}</span>
                {item.critical && (
                  <Badge className="bg-[#f59e0b]/10 text-[#f59e0b] text-[10px] ml-auto">확인 필수</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Transfer Criteria - 전원 고려 조건 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30 text-[10px]">
                전원 고려 조건
              </Badge>
            </div>
            {checkedTransferCount >= 2 && (
              <Badge variant="destructive" className="text-[10px] animate-pulse">
                {checkedTransferCount}개 충족 - 전원 고려
              </Badge>
            )}
          </div>
          <div className="space-y-1.5">
            {localGuideline.transferCriteria.map(item => (
              <button
                type="button"
                key={item.id}
                onClick={() => handleCheck("transferCriteria", item.id)}
                className={cn(
                  "w-full flex items-center gap-2 p-2 rounded-lg border transition-all text-left",
                  item.checked 
                    ? "bg-[#ef4444]/10 border-[#ef4444]/30" 
                    : "bg-muted/30 border-border hover:border-muted-foreground"
                )}
              >
                {item.checked ? (
                  <CheckCircle className="h-4 w-4 text-[#ef4444] shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-muted-foreground shrink-0" />
                )}
                <span className={cn(
                  "text-xs flex-1",
                  item.checked && "text-[#ef4444] font-medium"
                )}>
                  {item.text}
                </span>
                {item.critical && (
                  <Badge variant="outline" className="text-[10px]">주요</Badge>
                )}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            2개 이상 충족 시 전원 적극 고려
          </p>
        </div>

        {/* Disclaimer */}
        <div className="border-t border-border pt-3">
          <p className="text-[10px] text-destructive text-center">
            ※ 가이드라인은 참고용이며, 최종 판단은 담당 의료진에게 있습니다
          </p>
        </div>
      </CardContent>
    </Card>
  )
}


// =========================================================
// v2.0 Clinical Document Timeline with Button Categories
// =========================================================
type DocumentCategory = "lab" | "nursing" | "imaging" | "culture"

interface ClinicalDocumentTimelineProps {
  events: TimelineEvent[]
}

export function ClinicalDocumentTimeline({ events }: ClinicalDocumentTimelineProps) {
  // Group events by type and find which have recent changes (24-48h)
  const groupedEvents = {
    lab: events.filter(e => e.type === "lab"),
    nursing: events.filter(e => e.type === "note"),
    imaging: events.filter(e => e.type === "imaging"),
    culture: events.filter(e => e.type === "culture")
  }

  // Find category with most recent change (default selection)
  const getRecentChangeCategory = (): DocumentCategory => {
    const now = new Date()
    const priorities: { category: DocumentCategory; date: Date | null }[] = [
      { category: "lab", date: groupedEvents.lab[0] ? new Date(groupedEvents.lab[0].date) : null },
      { category: "nursing", date: groupedEvents.nursing[0] ? new Date(groupedEvents.nursing[0].date) : null },
      { category: "imaging", date: groupedEvents.imaging[0] ? new Date(groupedEvents.imaging[0].date) : null },
      { category: "culture", date: groupedEvents.culture[0] ? new Date(groupedEvents.culture[0].date) : null }
    ]
    
    const sorted = priorities
      .filter(p => p.date !== null)
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    
    return sorted[0]?.category ?? "lab"
  }

  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory>(getRecentChangeCategory())

  // Check if category has recent changes (within 48 hours)
  const hasRecentChange = (category: DocumentCategory): boolean => {
    const categoryMap: Record<DocumentCategory, typeof groupedEvents.lab> = {
      lab: groupedEvents.lab,
      nursing: groupedEvents.nursing,
      imaging: groupedEvents.imaging,
      culture: groupedEvents.culture
    }
    const items = categoryMap[category]
    if (!items.length) return false
    
    const latestDate = new Date(items[0].date)
    const now = new Date()
    const hoursDiff = (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60)
    return hoursDiff <= 48
  }

  const categoryConfig: { key: DocumentCategory; label: string; icon: React.ReactNode }[] = [
    { key: "lab", label: "Lab", icon: <FlaskConical className="h-3 w-3" /> },
    { key: "nursing", label: "간호", icon: <Stethoscope className="h-3 w-3" /> },
    { key: "imaging", label: "영상", icon: <FileImage className="h-3 w-3" /> },
    { key: "culture", label: "배양", icon: <Bug className="h-3 w-3" /> }
  ]

  const currentEvents = (() => {
    switch (selectedCategory) {
      case "lab": return groupedEvents.lab
      case "nursing": return groupedEvents.nursing
      case "imaging": return groupedEvents.imaging
      case "culture": return groupedEvents.culture
    }
  })()

  const latestEvent = currentEvents[0]
  const previousEvents = currentEvents.slice(1, 4)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          임상 문서 타임라인
        </CardTitle>
        <p className="text-[10px] text-muted-foreground">
          카테고리를 선택하여 최근 기록을 확인하세요
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Category Toggle Buttons */}
        <div className="flex gap-2">
          {categoryConfig.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedCategory(key)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                selectedCategory === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
              )}
            >
              {icon}
              {label}
              {/* Recent change dot indicator */}
              {hasRecentChange(key) && selectedCategory !== key && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#ef4444] animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* Latest Record - Always Visible */}
        {latestEvent ? (
          <div className="p-3 rounded-lg bg-primary/5 border-2 border-primary/30">
            <div className="flex items-center justify-between mb-2">
              <Badge className="bg-primary text-primary-foreground text-[10px]">
                최신
              </Badge>
              <span className="text-[10px] text-muted-foreground">{latestEvent.date}</span>
            </div>
            <p className="text-sm font-medium text-foreground">{latestEvent.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{latestEvent.summary}</p>
            {/* Key values - numeric focused */}
            {latestEvent.nlpChips && latestEvent.nlpChips.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {latestEvent.nlpChips.map((chip, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {chip.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 text-center text-muted-foreground text-xs">
            해당 카테고리에 기록이 없습니다
          </div>
        )}

        {/* Previous Records - Scrollable List */}
        {previousEvents.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground">이전 기록</p>
            <ScrollArea className="h-32">
              <div className="space-y-2 pr-2">
                {previousEvents.map((event) => (
                  <div 
                    key={event.id}
                    className="p-2 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate">{event.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{event.date}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{event.summary}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  )
}


// Prev vs Current Comparison Panel (Core NLP Feature) - Feature 3: Click to highlight + scroll
interface DocumentComparisonPanelProps {
  comparison: DocumentComparison
}

export function DocumentComparisonPanel({ comparison }: DocumentComparisonPanelProps) {
  const [selectedHighlight, setSelectedHighlight] = useState<{ type: "prev" | "current"; text: string } | null>(null)
  const prevRef = useRef<HTMLDivElement>(null)
  const currentRef = useRef<HTMLDivElement>(null)

  const handleHighlightClick = (type: "prev" | "current", text: string) => {
    setSelectedHighlight({ type, text })
    // Scroll to the other panel
    if (type === "prev" && currentRef.current) {
      currentRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    } else if (type === "current" && prevRef.current) {
      prevRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }

  const trajectoryInfo = {
    worsening: { label: "악화", color: "text-[#ef4444]", bg: "bg-[#ef4444]/10", icon: TrendingUp },
    improving: { label: "호전", color: "text-[#10b981]", bg: "bg-[#10b981]/10", icon: TrendingDown },
    stable: { label: "유지", color: "text-[#3b82f6]", bg: "bg-[#3b82f6]/10", icon: Minus },
  }

  const info = trajectoryInfo[comparison.trajectory]
  const TrajectoryIcon = info.icon

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Prev vs Current 변화 추이
          </CardTitle>
          <Badge className={cn("text-white", 
            comparison.trajectory === "worsening" ? "bg-[#ef4444]" :
            comparison.trajectory === "improving" ? "bg-[#10b981]" : "bg-[#3b82f6]"
          )}>
            <TrajectoryIcon className="h-3 w-3 mr-1" />
            {info.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Card */}
        <div className={cn("p-3 rounded-lg border-2", info.bg, 
          comparison.trajectory === "worsening" ? "border-[#ef4444]/30" :
          comparison.trajectory === "improving" ? "border-[#10b981]/30" : "border-[#3b82f6]/30"
        )}>
          <p className="text-xs font-medium text-muted-foreground mb-1">핵심 변화</p>
          <div className="flex flex-wrap gap-1.5">
            {comparison.keyChanges.map((change, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {change}
              </Badge>
            ))}
          </div>
        </div>

        {/* Side by Side Comparison */}
        <div className="grid grid-cols-2 gap-4">
          {/* Previous */}
          <div className="space-y-2" ref={prevRef}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              이전 ({comparison.prevDate})
            </div>
            <div className={cn(
              "p-3 rounded-lg bg-muted/30 border text-sm leading-relaxed transition-all",
              selectedHighlight?.type === "current" ? "border-primary ring-2 ring-primary/20" : "border-border"
            )}>
              {comparison.evidenceHighlights.prev.map((highlight, i) => (
                <span key={i}>
                  {comparison.prevText.split(highlight).map((part, j, arr) => (
                    <span key={j}>
                      {part}
                      {j < arr.length - 1 && (
                        <button
                          type="button"
                          onClick={() => handleHighlightClick("prev", highlight)}
                          className={cn(
                            "bg-blue-100 dark:bg-blue-500/30 px-1 py-0.5 rounded font-medium cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-500/50 transition-colors underline decoration-blue-500 decoration-2 underline-offset-2",
                            selectedHighlight?.text === highlight && "ring-2 ring-blue-500"
                          )}
                        >
                          {highlight}
                        </button>
                      )}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>

          {/* Current */}
          <div className="space-y-2" ref={currentRef}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              현재 ({comparison.currentDate})
            </div>
            <div className={cn(
              "p-3 rounded-lg bg-muted/30 border text-sm leading-relaxed transition-all",
              selectedHighlight?.type === "prev" ? "border-primary ring-2 ring-primary/20" : "border-border"
            )}>
              {comparison.evidenceHighlights.current.map((highlight, i) => (
                <span key={i}>
                  {comparison.currentText.split(highlight).map((part, j, arr) => (
                    <span key={j}>
                      {part}
                      {j < arr.length - 1 && (
                        <button
                          type="button"
                          onClick={() => handleHighlightClick("current", highlight)}
                          className={cn(
                            "px-1 py-0.5 rounded font-medium cursor-pointer transition-colors underline decoration-2 underline-offset-2",
                            comparison.trajectory === "worsening" 
                              ? "bg-red-100 dark:bg-red-500/30 hover:bg-red-200 dark:hover:bg-red-500/50 decoration-red-500" 
                              : comparison.trajectory === "improving"
                              ? "bg-green-100 dark:bg-green-500/30 hover:bg-green-200 dark:hover:bg-green-500/50 decoration-green-500"
                              : "bg-blue-100 dark:bg-blue-500/30 hover:bg-blue-200 dark:hover:bg-blue-500/50 decoration-blue-500",
                            selectedHighlight?.text === highlight && "ring-2 ring-offset-1 ring-current"
                          )}
                        >
                          {highlight}
                        </button>
                      )}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground text-center italic">
          NLP가 전후 문서를 비교하여 요약한 결과입니다
        </p>
      </CardContent>
    </Card>
  )
}

// Timeline with NLP Chips
interface NLPTimelineProps {
  events: TimelineEvent[]
}

export function NLPTimeline({ events }: NLPTimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const getTypeIcon = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "imaging": return FileText
      case "lab": return BarChart3
      case "note": return FileText
      case "culture": return AlertCircle
      default: return FileText
    }
  }

  const getTypeColor = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "imaging": return "bg-purple-500"
      case "lab": return "bg-blue-500"
      case "note": return "bg-emerald-500"
      case "culture": return "bg-amber-500"
      default: return "bg-gray-500"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          문서 타임라인 (NLP 요약)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[280px] pr-4">
          <div className="space-y-4">
            {events.map((event, index) => {
              const Icon = getTypeIcon(event.type)
              const isExpanded = expandedId === event.id

              return (
                <div key={event.id} className="relative">
                  {/* Timeline line */}
                  {index < events.length - 1 && (
                    <div className="absolute left-[11px] top-8 bottom-0 w-0.5 bg-border" />
                  )}

                  <div 
                    className="flex gap-3 cursor-pointer group"
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    onKeyDown={(e) => e.key === "Enter" && setExpandedId(isExpanded ? null : event.id)}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Timeline dot */}
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                      getTypeColor(event.type)
                    )}>
                      <Icon className="h-3 w-3 text-white" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium group-hover:text-primary transition-colors">
                            {event.title}
                          </p>
                          <p className="text-[10px] text-muted-foreground">{event.date}</p>
                        </div>
                        <ChevronRight className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          isExpanded && "rotate-90"
                        )} />
                      </div>

                      {/* NLP Chips */}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {event.nlpChips.map((chip, i) => (
                          <Popover key={i}>
                            <PopoverTrigger asChild>
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-[10px] cursor-pointer hover:scale-105 transition-transform",
                                  getTagStyles(chip.type).bg,
                                  getTagStyles(chip.type).text
                                )}
                              >
                                {chip.label}
                              </Badge>
                            </PopoverTrigger>
                            <PopoverContent side="top" className="w-72 p-3">
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-primary">근거 문장</p>
                                <p className="text-sm bg-yellow-100 dark:bg-yellow-500/30 p-2 rounded border border-yellow-300 dark:border-yellow-600 italic">
                                  &quot;{chip.evidence}&quot;
                                </p>
                                <p className="text-[10px] text-muted-foreground">클릭하여 원문 확인</p>
                              </div>
                            </PopoverContent>
                          </Popover>
                        ))}
                      </div>

                      {/* Expanded summary */}
                      {isExpanded && (
                        <div className="mt-2 p-2 rounded-md bg-muted/50 border border-border/50 animate-fade-in">
                          <p className="text-xs text-muted-foreground">{event.summary}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

// Keyword Trend Chart (Ward-level) - Feature 5: Select filter for real-time chart change
interface KeywordTrendChartProps {
  data: { keyword: string; today: number; yesterday: number; change: number }[]
}

type FilterType = "all" | "worsening" | "improving" | "uncertainty"

export function KeywordTrendChart({ data }: KeywordTrendChartProps) {
  const [filter, setFilter] = useState<FilterType>("all")

  const filteredData = data.filter((item) => {
    if (filter === "all") return true
    if (filter === "worsening") return item.keyword.includes("악화") || item.change > 50
    if (filter === "improving") return item.keyword.includes("호전") || item.change < 0
    if (filter === "uncertainty") return item.keyword.includes("의심")
    return true
  })

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            키워드/태그 분포 (병동)
          </CardTitle>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="text-xs px-2 py-1 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">전체</option>
            <option value="worsening">악화 키워드</option>
            <option value="improving">호전 키워드</option>
            <option value="uncertainty">불확실성</option>
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredData} layout="vertical" margin={{ left: 80, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
              <YAxis 
                type="category" 
                dataKey="keyword" 
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={80}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px"
                }}
                formatter={(value: number, name: string) => [value, name === "today" ? "오늘" : "어제"]}
              />
              <Bar dataKey="yesterday" fill="var(--muted)" name="어제" radius={[0, 4, 4, 0]} />
              <Bar dataKey="today" name="오늘" radius={[0, 4, 4, 0]}>
                {filteredData.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.change > 50 ? "#ef4444" : entry.change > 0 ? "#f59e0b" : "#10b981"} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Change indicators */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {filteredData.slice(0, 4).map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30">
              <span className="text-muted-foreground truncate">{item.keyword.split(" ")[0]}</span>
              <span className={cn(
                "font-medium",
                item.change > 0 ? "text-[#ef4444]" : "text-[#10b981]"
              )}>
                {item.change > 0 ? "+" : ""}{item.change}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// LLM Summary Card
interface LLMSummaryCardProps {
  summary: {
    overview: string
    notableChanges: string[]
    caveats: string
    generatedAt: string
  }
}

export function LLMSummaryCard({ summary }: LLMSummaryCardProps) {
  return (
    <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI 트렌드 요약
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {summary.generatedAt}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overview */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">개요</p>
          <p className="text-sm leading-relaxed">{summary.overview}</p>
        </div>

        {/* Notable Changes */}
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">주요 변화</p>
          <div className="space-y-1.5">
            {summary.notableChanges.map((change, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                {change}
              </div>
            ))}
          </div>
        </div>

        {/* Caveats */}
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">{summary.caveats}</p>
          </div>
        </div>

        {/* Disclaimer - Feature 6 */}
        <div className="border-t border-border pt-3 mt-2">
          <p className="text-[11px] text-destructive font-medium text-center">
            ※ 본 정보는 진단이 아닙니다
          </p>
          <p className="text-[10px] text-muted-foreground text-center mt-1">
            AI 생성 요약이며, 임상적 판단의 보조 자료로만 활용하세요
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// v1.4 Trajectory Axis Cards (2x2 Grid) - Legacy
interface TrajectoryAxisCardsV2Props {
  axes: {
    axis: string
    label: string
    currentValue: string
    prevValue: string
    change: "up" | "down" | "stable"
    detail: string
    trendData: { day: string; value: number }[]
  }[]
}

export function TrajectoryAxisCardsV2({ axes }: TrajectoryAxisCardsV2Props) {
  const getAxisIcon = (axis: string) => {
    switch (axis) {
      case "respiratory": return <Wind className="h-4 w-4" />
      case "infection": return <AlertCircle className="h-4 w-4" />
      case "imaging": return <FileText className="h-4 w-4" />
      case "culture": return <Activity className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const getChangeColor = (change: string) => {
    switch (change) {
      case "up": return "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]"
      case "down": return "text-[#10b981] bg-[#10b981]/10 border-[#10b981]"
      default: return "text-muted-foreground bg-muted/50 border-border"
    }
  }

  const getChangeArrow = (change: string) => {
    switch (change) {
      case "up": return <TrendingUp className="h-4 w-4" />
      case "down": return <TrendingDown className="h-4 w-4" />
      default: return <ArrowRight className="h-4 w-4" />
    }
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {axes.map((axis) => (
        <Card key={axis.axis} className={cn("border-2", getChangeColor(axis.change))}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className={cn("p-2 rounded-lg", getChangeColor(axis.change))}>
                  {getAxisIcon(axis.axis)}
                </div>
                <div>
                  <p className="text-sm font-medium">{axis.label}</p>
                  <p className="text-xs text-muted-foreground">{axis.detail}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-lg font-bold">{axis.currentValue}</span>
                  {getChangeArrow(axis.change)}
                </div>
                <p className="text-[10px] text-muted-foreground">이전: {axis.prevValue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// =========================================================
// v2.0 Clinical Trajectory Panel - 4 Numeric Axes
// =========================================================

// Status indicator component
function StatusIndicator({ status }: { status: "normal" | "warning" | "critical" }) {
  const colors = {
    normal: "bg-[#10b981]",
    warning: "bg-[#f59e0b]",
    critical: "bg-[#ef4444]"
  }
  return <div className={cn("w-2.5 h-2.5 rounded-full", colors[status])} />
}

// Summary Card for each axis
interface TrajectoryValueCardProps {
  axis: NumericTrajectoryAxis
  isExpanded: boolean
  onToggle: () => void
  isMuted?: boolean // For conditional display of organDysfunction
}

function TrajectoryValueCard({ axis, isExpanded, onToggle, isMuted = false }: TrajectoryValueCardProps) {
  const getAxisIcon = (axisType: string) => {
    switch (axisType) {
      case "respiratory": return <Wind className="h-4 w-4" />
      case "infection": return <AlertCircle className="h-4 w-4" />
      case "clinicalAction": return <Activity className="h-4 w-4" />
      case "organDysfunction": return <TrendingDown className="h-4 w-4" />
      default: return <Activity className="h-4 w-4" />
    }
  }

  const statusColors = {
    normal: { bg: "bg-[#10b981]/10", border: "border-[#10b981]/30", text: "text-[#10b981]" },
    warning: { bg: "bg-[#f59e0b]/10", border: "border-[#f59e0b]/30", text: "text-[#f59e0b]" },
    critical: { bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/30", text: "text-[#ef4444]" }
  }
  
  // Muted colors for organDysfunction when not relevant
  const mutedColors = { bg: "bg-muted/30", border: "border-border", text: "text-muted-foreground" }
  const colors = isMuted ? mutedColors : statusColors[axis.status]

  return (
    <div className="space-y-2">
      <TooltipProvider>
        <UITooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "w-full p-3 rounded-lg border-2 transition-all hover:shadow-md cursor-pointer text-left",
                colors.bg, colors.border,
                isMuted && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn("p-1.5 rounded-md", colors.bg)}>
                    {getAxisIcon(axis.axis)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{axis.label}</p>
                    <p className={cn("text-lg font-bold", colors.text)}>{axis.displayValue}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!isMuted && <StatusIndicator status={axis.status} />}
                  <ChevronRight className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )} />
                </div>
              </div>
            </button>
          </TooltipTrigger>
          {/* Clinical Action Breakdown Tooltip */}
          {axis.axis === "clinicalAction" && axis.actionBreakdown && (
            <TooltipContent side="right" className="p-3">
              <p className="text-xs font-medium mb-2">왜 바빠졌는지:</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <Bell className="h-3 w-3 text-[#ef4444]" />
                  <span>Notify: {axis.actionBreakdown.notify}회</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Pill className="h-3 w-3 text-[#f59e0b]" />
                  <span>PRN: {axis.actionBreakdown.prn}회</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Monitor className="h-3 w-3 text-[#3b82f6]" />
                  <span>Monitoring 변경: {axis.actionBreakdown.monitoringChange}회</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <ClipboardPlus className="h-3 w-3 text-[#10b981]" />
                  <span>New Order: {axis.actionBreakdown.newOrder}회</span>
                </div>
              </div>
            </TooltipContent>
          )}
        </UITooltip>
      </TooltipProvider>

      {/* Expanded Timeline */}
      {isExpanded && (
        <div className="ml-2 pl-4 border-l-2 border-border space-y-2 animate-fade-in">
          {/* Clinical Action Breakdown Detail (visible on expand) */}
          {axis.axis === "clinicalAction" && axis.actionBreakdown && (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="flex items-center gap-1.5 p-1.5 rounded bg-[#ef4444]/10 border border-[#ef4444]/20">
                <Bell className="h-3 w-3 text-[#ef4444]" />
                <span className="text-[10px]">Notify {axis.actionBreakdown.notify}</span>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 rounded bg-[#f59e0b]/10 border border-[#f59e0b]/20">
                <Pill className="h-3 w-3 text-[#f59e0b]" />
                <span className="text-[10px]">PRN {axis.actionBreakdown.prn}</span>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 rounded bg-[#3b82f6]/10 border border-[#3b82f6]/20">
                <Monitor className="h-3 w-3 text-[#3b82f6]" />
                <span className="text-[10px]">Monitor {axis.actionBreakdown.monitoringChange}</span>
              </div>
              <div className="flex items-center gap-1.5 p-1.5 rounded bg-[#10b981]/10 border border-[#10b981]/20">
                <ClipboardPlus className="h-3 w-3 text-[#10b981]" />
                <span className="text-[10px]">Order {axis.actionBreakdown.newOrder}</span>
              </div>
            </div>
          )}

          {/* Supplementary data */}
          {axis.supplementary && axis.supplementary.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {axis.supplementary.map((sup, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  {sup.label}: {sup.value}
                </Badge>
              ))}
            </div>
          )}

          {/* Timeline of last 5 values */}
          <div className="text-xs text-muted-foreground mb-1">최근 5회 기록</div>
          <div className="flex flex-wrap gap-2">
            {axis.trendData.slice(-5).reverse().map((point, i) => (
              <TooltipProvider key={i}>
                <UITooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "px-2 py-1 rounded text-xs border transition-colors cursor-pointer",
                        i === 0 ? "bg-primary/10 border-primary font-medium" : "bg-muted/50 border-border hover:border-muted-foreground"
                      )}
                    >
                      {point.day} <span className="font-medium">{point.value}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    {point.sourceDoc ? (
                      <div className="space-y-1">
                        <p className="text-xs font-medium">{point.sourceDoc.title}</p>
                        <p className="text-[10px] text-muted-foreground">{point.sourceDoc.date}</p>
                        <p className="text-[10px] text-primary">클릭하여 문서 보기</p>
                      </div>
                    ) : (
                      <p className="text-xs">문서 정보 없음</p>
                    )}
                  </TooltipContent>
                </UITooltip>
              </TooltipProvider>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Main Clinical Trajectory Panel
interface ClinicalTrajectoryPanelProps {
  trajectory: {
    axes: NumericTrajectoryAxis[]
    rli?: number
  }
  // Tags that indicate organDysfunction should be highlighted (e.g., "SFTS", "Tick-borne", "Viral hemorrhagic")
  relevantTags?: string[]
}

// Tags that indicate organ dysfunction axis should be emphasized
const ORGAN_HIGHLIGHT_TAGS = ["SFTS", "Tick-borne", "Viral hemorrhagic", "DIC", "TTP", "HUS"]

export function ClinicalTrajectoryPanel({ trajectory, relevantTags = [] }: ClinicalTrajectoryPanelProps) {
  const [expandedAxis, setExpandedAxis] = useState<string | null>(null)

  const handleToggle = (axisId: string) => {
    setExpandedAxis(expandedAxis === axisId ? null : axisId)
  }

  // Check if organDysfunction should be highlighted based on tags
  const shouldHighlightOrgan = relevantTags.some(tag => 
    ORGAN_HIGHLIGHT_TAGS.some(highlight => tag.toLowerCase().includes(highlight.toLowerCase()))
  )

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            7일 Clinical Trajectory
          </CardTitle>
          {trajectory.rli !== undefined && (
            <Badge variant="outline" className="text-[10px]">
              RLI: {(trajectory.rli * 100).toFixed(0)}%
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          수치 클릭 시 최근 5회 기록과 근거 문서를 확인할 수 있습니다
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary Cards - 2x2 Grid */}
        <div className="grid grid-cols-2 gap-3">
          {trajectory.axes.map((axis) => {
            // Mute organDysfunction axis unless relevant tags present or status is critical/warning
            const isMuted = axis.axis === "organDysfunction" && 
              !shouldHighlightOrgan && 
              axis.status === "normal"
            
            return (
              <TrajectoryValueCard
                key={axis.axis}
                axis={axis}
                isExpanded={expandedAxis === axis.axis}
                onToggle={() => handleToggle(axis.axis)}
                isMuted={isMuted}
              />
            )
          })}
        </div>

        {/* Disclaimer */}
        <div className="border-t border-border pt-3 mt-2">
          <p className="text-[10px] text-muted-foreground text-center italic">
            이 그래프는 변화 추이 시각화 목적이며, 진단이나 판정이 아닙니다
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// =========================================================
// v2.0 SHAP-based Sepsis Explanation Panel
// =========================================================

// SHAP Waterfall Chart for individual patient
interface SHAPWaterfallChartProps {
  explanation: SepsisExplanation
}

export function SHAPWaterfallChart({ explanation }: SHAPWaterfallChartProps) {
  // Sort factors by absolute value for waterfall display
  const sortedFactors = [...explanation.factors].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))

  const getRiskColor = (score: number) => {
    if (score >= 0.7) return { bg: "bg-[#ef4444]", text: "text-[#ef4444]" }
    if (score >= 0.4) return { bg: "bg-[#f59e0b]", text: "text-[#f59e0b]" }
    return { bg: "bg-[#10b981]", text: "text-[#10b981]" }
  }

  const riskColors = getRiskColor(explanation.riskScore)

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Sepsis 위험 요인 분석 (SHAP)
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">
            {explanation.generatedAt}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Risk Score Display */}
        <div className={cn("p-4 rounded-lg border-2", `${riskColors.bg}/10`, `border-${riskColors.text.replace('text-', '')}/30`)}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Sepsis 위험 점수</p>
              <p className={cn("text-3xl font-bold", riskColors.text)}>
                {(explanation.riskScore * 100).toFixed(0)}%
              </p>
            </div>
            <div className="w-32 h-3 bg-muted rounded-full overflow-hidden">
              <div 
                className={cn("h-full rounded-full transition-all", riskColors.bg)}
                style={{ width: `${explanation.riskScore * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* SHAP Waterfall Chart */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">요인별 기여도</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={sortedFactors} 
                layout="vertical" 
                margin={{ left: 80, right: 50, top: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis 
                  type="number" 
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  domain={[-0.2, 0.2]}
                  tickFormatter={(v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
                />
                <YAxis 
                  type="category" 
                  dataKey="factor" 
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  width={75}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    fontSize: "12px"
                  }}
                  formatter={(value) => {
                    const numericValue = typeof value === "number" ? value : Number(value)
                    const riskLabel: string = numericValue > 0 ? "위험 증가" : "위험 감소"
                    return [
                      `${numericValue > 0 ? "+" : ""}${(numericValue * 100).toFixed(1)}%`,
                      riskLabel,
                    ]
                  }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {sortedFactors.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.value > 0 ? "#ef4444" : "#10b981"} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Factor List with Raw Values + Change Day */}
        <div className="grid grid-cols-2 gap-2">
          {sortedFactors.slice(0, 6).map((factor, i) => (
            <div 
              key={i}
              className={cn(
                "flex items-center justify-between p-2 rounded-lg border text-xs",
                factor.value > 0 
                  ? "bg-[#ef4444]/5 border-[#ef4444]/20" 
                  : "bg-[#10b981]/5 border-[#10b981]/20"
              )}
            >
              <span className="text-muted-foreground">{factor.factor}</span>
              <div className="text-right">
                <div className="flex items-center gap-1 justify-end">
                  <span className={cn(
                    "font-medium",
                    factor.value > 0 ? "text-[#ef4444]" : "text-[#10b981]"
                  )}>
                    {factor.value > 0 ? '+' : ''}{(factor.value * 100).toFixed(0)}%
                  </span>
                  {/* Change Day indicator - connects to Trajectory */}
                  {factor.changeDay && (
                    <span className={cn(
                      "text-[9px] px-1 rounded",
                      factor.value > 0 ? "bg-[#ef4444]/20 text-[#ef4444]" : "bg-[#10b981]/20 text-[#10b981]"
                    )}>
                      {factor.value > 0 ? "↑" : "↓"} {factor.changeDay}
                    </span>
                  )}
                </div>
                {factor.rawValue && (
                  <p className="text-[10px] text-muted-foreground">{factor.rawValue}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="border-t border-border pt-3">
          <p className="text-[10px] text-muted-foreground text-center italic">
            관측 가능한 수치와 이벤트만 사용하며, 진단명은 포함하지 않습니다
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// Ward-level SHAP Summary Bar Chart
interface WardSHAPSummaryChartProps {
  summary: WardSHAPSummary
}

export function WardSHAPSummaryChart({ summary }: WardSHAPSummaryChartProps) {
  // Sort by absolute value
  const sortedFactors = [...summary.factors].sort((a, b) => Math.abs(b.avgValue) - Math.abs(a.avgValue))

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            병동 Sepsis 위험 요인 (평균)
          </CardTitle>
          <Badge variant="outline" className={cn(
            "text-[10px]",
            summary.avgRiskScore >= 0.5 ? "border-[#ef4444] text-[#ef4444]" : "border-[#f59e0b] text-[#f59e0b]"
          )}>
            평균 위험: {(summary.avgRiskScore * 100).toFixed(0)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bar Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={sortedFactors} 
              layout="vertical" 
              margin={{ left: 80, right: 40, top: 5, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis 
                type="number" 
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                tickFormatter={(v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
              />
              <YAxis 
                type="category" 
                dataKey="factor" 
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={75}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px"
                }}
                formatter={(value: number, _, props) => {
                  const factor = props.payload as { factor: string; avgValue: number; patientCount: number }
                  return [
                    `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}% (${factor.patientCount}명)`,
                    value > 0 ? '위험 증가' : '위험 감소'
                  ]
                }}
              />
              <Bar dataKey="avgValue" radius={[0, 4, 4, 0]}>
                {sortedFactors.map((entry, index) => (
                  <Cell 
                    key={`cell-${index}`} 
                    fill={entry.avgValue > 0 ? "#ef4444" : "#10b981"} 
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Factor List with Patient Count - Operational View */}
        <div className="space-y-1.5">
          {sortedFactors.slice(0, 5).map((factor, i) => (
            <div 
              key={i}
              className={cn(
                "flex items-center justify-between p-2 rounded-lg border text-xs",
                factor.avgValue > 0 
                  ? "bg-[#ef4444]/5 border-[#ef4444]/20" 
                  : "bg-[#10b981]/5 border-[#10b981]/20"
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn(
                  "font-medium",
                  factor.avgValue > 0 ? "text-[#ef4444]" : "text-[#10b981]"
                )}>
                  {factor.factor}
                </span>
                <span className={cn(
                  "font-medium",
                  factor.avgValue > 0 ? "text-[#ef4444]" : "text-[#10b981]"
                )}>
                  {factor.avgValue > 0 ? '+' : ''}{(factor.avgValue * 100).toFixed(0)}%
                </span>
              </div>
              {/* Patient count - key for operational/infection control */}
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px]",
                  factor.avgValue > 0 ? "border-[#ef4444]/50 text-[#ef4444]" : "border-[#10b981]/50 text-[#10b981]"
                )}
              >
                {factor.patientCount}명
              </Badge>
            </div>
          ))}
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/20">
            <p className="text-[10px] text-muted-foreground">위험 증가 요인</p>
            <p className="text-sm font-medium text-[#ef4444]">
              {sortedFactors.filter(f => f.avgValue > 0).length}개
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/20">
            <p className="text-[10px] text-muted-foreground">위험 감소 요인</p>
            <p className="text-sm font-medium text-[#10b981]">
              {sortedFactors.filter(f => f.avgValue < 0).length}개
            </p>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="border-t border-border pt-3">
          <p className="text-[10px] text-muted-foreground text-center italic">
            MAP, Lactate, RR, O2 escalation, CRP, Plt 등 관측 가능한 수치만 사용
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// Numeric 4-Axis Line Chart (new design)
interface NumericFourAxisChartProps {
  axes: NumericTrajectoryAxis[]
}

export function NumericFourAxisChart({ axes }: NumericFourAxisChartProps) {
  // Combine data for chart - normalize values for display
  const combinedData = axes[0]?.trendData.map((_, i) => {
    const respiratory = axes.find(a => a.axis === "respiratory")
    const infection = axes.find(a => a.axis === "infection")
    const clinicalAction = axes.find(a => a.axis === "clinicalAction")
    const organDysfunction = axes.find(a => a.axis === "organDysfunction")

    return {
      day: axes[0].trendData[i].day,
      // Normalize SpO2 to show decline (100 - SpO2) so higher = worse
      respiratory: respiratory ? (100 - respiratory.trendData[i]?.value) : 0,
      infection: infection ? infection.trendData[i]?.value : 0,
      clinicalAction: clinicalAction ? clinicalAction.trendData[i]?.value * 10 : 0, // Scale up for visibility
      organDysfunction: organDysfunction ? (300 - organDysfunction.trendData[i]?.value) / 3 : 0, // Inverse Plt
    }
  }) ?? []

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            7일 변화 추이 (4축)
          </CardTitle>
          <Badge variant="outline" className="text-[9px] text-muted-foreground">
            Normalized Index
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          4축이 동일 스케일이 아님 - 정규화하여 상승 = 부담 증가를 의미
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={combinedData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis 
                dataKey="day" 
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                label={{ value: "Normalized", angle: -90, position: "insideLeft", fontSize: 9, fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "11px"
                }}
              />
              <Legend 
                wrapperStyle={{ fontSize: "10px" }}
                iconType="line"
              />
              <Line type="monotone" dataKey="respiratory" name="호흡 (100-SpO2)" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="infection" name="감염 (CRP)" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="clinicalAction" name="개입 강도" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="organDysfunction" name="장기부전 (inv Plt)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {/* Legend clarification */}
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-[9px] text-muted-foreground text-center">
            각 축별 색상으로 구분 | 상승 = 임상적 부담 증가
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// v1.4 Four Axis Line Chart
interface FourAxisChartV2Props {
  axes: {
    axis: string
    label: string
    trendData: { day: string; value: number }[]
  }[]
}

export function FourAxisChartV2({ axes }: FourAxisChartV2Props) {
  const combinedData = axes[0]?.trendData.map((_, i) => ({
    day: axes[0].trendData[i].day,
    respiratory: axes.find(a => a.axis === "respiratory")?.trendData[i]?.value ?? 0,
    infection: axes.find(a => a.axis === "infection")?.trendData[i]?.value ?? 0,
    imaging: axes.find(a => a.axis === "imaging")?.trendData[i]?.value ?? 0,
    culture: axes.find(a => a.axis === "culture")?.trendData[i]?.value ?? 0,
  })) ?? []

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          7일 Clinical Trajectory (4축)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={combinedData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
              <XAxis 
                dataKey="day" 
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Legend 
                wrapperStyle={{ fontSize: "11px" }}
                iconType="line"
              />
              <Line type="monotone" dataKey="respiratory" name="호흡기" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="infection" name="감염" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="imaging" name="영상" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="culture" name="배양" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

// v1.4 Enhanced Timeline with Document Type Icons
interface EnhancedTimelineV2Props {
  events: {
    id: string
    date: string
    type: "imaging" | "lab" | "note" | "culture"
    title: string
    summary: string
    nlpChips?: { type: string; label: string; evidence: string }[]
  }[]
}

export function EnhancedTimelineV2({ events }: EnhancedTimelineV2Props) {
  const getDocIcon = (type: string, title: string) => {
    switch (type) {
      case "imaging": return <FileText className="h-4 w-4 text-[#f59e0b]" />
      case "note": return title.includes("간호") 
        ? <Clock className="h-4 w-4 text-[#3b82f6]" />
        : <Activity className="h-4 w-4 text-[#8b5cf6]" />
      case "lab": return <Activity className="h-4 w-4 text-[#8b5cf6]" />
      case "culture": return <AlertCircle className="h-4 w-4 text-[#10b981]" />
      default: return <FileText className="h-4 w-4" />
    }
  }

  const getDocLabel = (type: string, title: string) => {
    switch (type) {
      case "imaging": return "CXR"
      case "note": return title.includes("간호") ? "간호" : "의사"
      case "lab": return "검사"
      case "culture": return "배양"
      default: return type
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          임상 문서 타임라인
        </CardTitle>
        <div className="flex gap-4 mt-2">
          <span className="text-[10px] flex items-center gap-1"><Clock className="h-3 w-3 text-[#3b82f6]" /> 간호</span>
          <span className="text-[10px] flex items-center gap-1"><Activity className="h-3 w-3 text-[#8b5cf6]" /> 의사</span>
          <span className="text-[10px] flex items-center gap-1"><FileText className="h-3 w-3 text-[#f59e0b]" /> CXR</span>
          <span className="text-[10px] flex items-center gap-1"><AlertCircle className="h-3 w-3 text-[#10b981]" /> 배양</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
              <div className="flex flex-col items-center">
                <div className="p-2 rounded-full bg-muted">
                  {getDocIcon(event.type, event.title)}
                </div>
                <div className="w-px h-full bg-border mt-1" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{getDocLabel(event.type, event.title)}</Badge>
                  <span className="text-[10px] text-muted-foreground">{event.date}</span>
                </div>
                <p className="text-sm font-medium mt-1">{event.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{event.summary}</p>
                {event.nlpChips && event.nlpChips.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {event.nlpChips.map((chip, i) => (
                      <Badge 
                        key={i} 
                        variant="outline" 
                        className={cn(
                          "text-[9px]",
                          chip.label.includes("worsening") || chip.label.includes("↑")
                            ? "border-[#ef4444] text-[#ef4444]" 
                            : chip.label.includes("improving") || chip.label.includes("↓")
                            ? "border-[#10b981] text-[#10b981]"
                            : "border-[#f59e0b] text-[#f59e0b]"
                        )}
                      >
                        {chip.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// v1.4 Sepsis 6 Checklist
interface Sepsis6ChecklistV2Props {
  items: {
    id: string
    label: string
    completed: boolean
    time?: string
  }[]
  patientStatus: string
}

export function Sepsis6ChecklistV2({ items, patientStatus }: Sepsis6ChecklistV2Props) {
  const completedCount = items.filter(i => i.completed).length
  const totalCount = items.length
  const progress = (completedCount / totalCount) * 100

  return (
    <Card className={cn(
      "border-2",
      patientStatus === "critical" ? "border-[#ef4444] bg-[#ef4444]/5" :
      patientStatus === "warning" ? "border-[#f59e0b] bg-[#f59e0b]/5" :
      "border-[#10b981] bg-[#10b981]/5"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertCircle className={cn(
              "h-4 w-4",
              patientStatus === "critical" ? "text-[#ef4444]" :
              patientStatus === "warning" ? "text-[#f59e0b]" :
              "text-[#10b981]"
            )} />
            Sepsis 6 체크리스트
          </CardTitle>
          <Badge className={cn(
            "text-white",
            completedCount === totalCount ? "bg-[#10b981]" :
            completedCount >= 3 ? "bg-[#f59e0b]" :
            "bg-[#ef4444]"
          )}>
            {completedCount}/{totalCount} 완료
          </Badge>
        </div>
        <div className="w-full h-2 bg-muted rounded-full mt-2">
          <div 
            className={cn(
              "h-2 rounded-full transition-all",
              completedCount === totalCount ? "bg-[#10b981]" :
              completedCount >= 3 ? "bg-[#f59e0b]" :
              "bg-[#ef4444]"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <div 
              key={item.id} 
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg border transition-colors",
                item.completed 
                  ? "bg-[#10b981]/10 border-[#10b981]/30" 
                  : "bg-muted/30 border-border"
              )}
            >
              {item.completed ? (
                <CheckCircle className="h-4 w-4 text-[#10b981] shrink-0" />
              ) : (
                <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  "text-xs truncate",
                  item.completed ? "text-[#10b981]" : "text-muted-foreground"
                )}>
                  {item.label}
                </p>
                {item.time && (
                  <p className="text-[10px] text-muted-foreground">{item.time}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// =========================================================
// MDRO Bed Assignment Panel (PRD Section 3.2)
// =========================================================
interface MDROBedAssignmentPanelProps {
  assignment: MDROBedAssignment
  onAssignBed?: (bedId: string) => void
}

export function MDROBedAssignmentPanel({ assignment, onAssignBed }: MDROBedAssignmentPanelProps) {
  const getIsolationTypeLabel = (type: string) => {
    switch (type) {
      case "contact": return "접촉격리"
      case "droplet": return "비말격리"
      case "airborne": return "공기격리"
      default: return "표준주의"
    }
  }

  const getIsolationTypeColor = (type: string) => {
    switch (type) {
      case "contact": return "bg-[#f59e0b] text-white"
      case "droplet": return "bg-[#3b82f6] text-white"
      case "airborne": return "bg-[#ef4444] text-white"
      default: return "bg-gray-500 text-white"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bed className="h-4 w-4 text-[#f59e0b]" />
            MDRO 병상 자동 배정
          </CardTitle>
          <Badge className={getIsolationTypeColor(assignment.requiredIsolation)}>
            {getIsolationTypeLabel(assignment.requiredIsolation)}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {assignment.patientName} 환자 | {assignment.mdroType ? `${assignment.mdroType} 감염` : "격리 필요"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recommendations */}
        {assignment.recommendations.length > 0 ? (
          <div className="space-y-3">
            <p className="text-xs font-medium text-foreground">추천 병상 (Top {assignment.recommendations.length})</p>
            {assignment.recommendations.map((rec, index) => (
              <div 
                key={rec.bed.id}
                className={cn(
                  "p-3 rounded-lg border transition-all",
                  index === 0 
                    ? "bg-[#10b981]/10 border-[#10b981]/30" 
                    : "bg-muted/30 border-border"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">
                      {rec.bed.roomNumber}호 {rec.bed.bedNumber}번 병상
                    </span>
                    {index === 0 && (
                      <Badge className="bg-[#10b981] text-white text-[10px]">추천</Badge>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    적합도 {rec.score}%
                  </Badge>
                </div>

                {/* Match Reasons */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {rec.matchReasons.map((reason, i) => (
                    <Badge 
                      key={i} 
                      variant="outline" 
                      className="text-[10px] bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30"
                    >
                      <CheckCircle className="h-2.5 w-2.5 mr-1" />
                      {reason}
                    </Badge>
                  ))}
                  {rec.cohortCompatible && (
                    <Badge 
                      variant="outline" 
                      className="text-[10px] bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30"
                    >
                      <Users className="h-2.5 w-2.5 mr-1" />
                      코호트 가능
                    </Badge>
                  )}
                </div>

                {/* Warnings */}
                {rec.warnings && rec.warnings.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {rec.warnings.map((warning, i) => (
                      <Badge 
                        key={i} 
                        variant="outline" 
                        className="text-[10px] bg-[#f59e0b]/10 text-[#f59e0b] border-[#f59e0b]/30"
                      >
                        <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                        {warning}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Bed Features */}
                <div className="flex gap-2 text-[10px] text-muted-foreground mb-2">
                  {rec.bed.features.privateRoom && <span>1인실</span>}
                  {rec.bed.features.anteroom && <span>전실</span>}
                  {rec.bed.features.negativePressure && <span>음압</span>}
                </div>

                {/* Action Button */}
                <Button 
                  size="sm" 
                  className={cn(
                    "w-full h-7 text-xs",
                    index === 0 
                      ? "bg-[#10b981] hover:bg-[#059669] text-white" 
                      : "bg-transparent"
                  )}
                  variant={index === 0 ? "default" : "outline"}
                  onClick={() => onAssignBed?.(rec.bed.id)}
                >
                  <ArrowRight className="h-3 w-3 mr-1" />
                  이 병상으로 이동
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30 text-center">
            <ShieldAlert className="h-6 w-6 text-[#ef4444] mx-auto mb-2" />
            <p className="text-sm font-medium text-[#ef4444]">빈 격리 병상 없음</p>
            <p className="text-xs text-muted-foreground mt-1">
              {assignment.unavailableReasons.join(" / ")}
            </p>
          </div>
        )}

        {/* Unavailable Reasons */}
        {assignment.unavailableReasons.length > 0 && assignment.recommendations.length > 0 && (
          <div className="p-2 rounded bg-muted/50 border border-border">
            <p className="text-[10px] text-muted-foreground">
              참고: {assignment.unavailableReasons.join(" / ")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// =========================================================
// Severity Assessment Panel (PRD Section 3.5)
// =========================================================
interface SeverityAssessmentPanelProps {
  assessment: SeverityAssessment
}

export function SeverityAssessmentPanel({ assessment }: SeverityAssessmentPanelProps) {
  const getLevelColor = (level: string) => {
    switch (level) {
      case "critical": return "bg-[#ef4444] text-white"
      case "high": return "bg-[#f97316] text-white"
      case "medium": return "bg-[#f59e0b] text-white"
      default: return "bg-[#10b981] text-white"
    }
  }

  const getLevelLabel = (level: string) => {
    switch (level) {
      case "critical": return "위급"
      case "high": return "고위험"
      case "medium": return "주의"
      default: return "안정"
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "immediate": return "text-[#ef4444] bg-[#ef4444]/10 border-[#ef4444]/30"
      case "urgent": return "text-[#f59e0b] bg-[#f59e0b]/10 border-[#f59e0b]/30"
      default: return "text-[#10b981] bg-[#10b981]/10 border-[#10b981]/30"
    }
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-[#f59e0b]" />
            중증 엔진 (Severity Engine)
          </CardTitle>
          <Badge className={getLevelColor(assessment.level)}>
            {getLevelLabel(assessment.level)} ({assessment.score}점)
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Sepsis ML 기반 중증 이행 위험 평가 | 진단이 아닌 설명 가능한 위험 분석
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contributing Factors */}
        <div>
          <p className="text-xs font-medium text-foreground mb-2">기여 요인</p>
          <div className="space-y-1.5">
            {assessment.contributingFactors.map((factor, i) => (
              <div 
                key={i}
                className="flex items-center justify-between p-2 rounded border bg-muted/30"
              >
                <div className="flex items-center gap-2">
                  {factor.impact === "negative" ? (
                    <TrendingUp className="h-3.5 w-3.5 text-[#ef4444]" />
                  ) : factor.impact === "positive" ? (
                    <TrendingDown className="h-3.5 w-3.5 text-[#10b981]" />
                  ) : (
                    <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="text-xs">{factor.factor}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs font-medium",
                    factor.impact === "negative" ? "text-[#ef4444]" :
                    factor.impact === "positive" ? "text-[#10b981]" :
                    "text-muted-foreground"
                  )}>
                    {factor.value}
                  </span>
                  <div 
                    className="h-1.5 w-12 bg-muted rounded-full overflow-hidden"
                  >
                    <div 
                      className={cn(
                        "h-full rounded-full",
                        factor.impact === "negative" ? "bg-[#ef4444]" :
                        factor.impact === "positive" ? "bg-[#10b981]" :
                        "bg-muted-foreground"
                      )}
                      style={{ width: `${factor.weight * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended Actions */}
        <div>
          <p className="text-xs font-medium text-foreground mb-2">권장 조치</p>
          <div className="space-y-1.5">
            {assessment.recommendedActions.map((action, i) => (
              <div 
                key={i}
                className={cn(
                  "flex items-center gap-2 p-2 rounded border text-xs",
                  action.completed 
                    ? "bg-[#10b981]/10 border-[#10b981]/30 text-[#10b981]"
                    : getPriorityColor(action.priority)
                )}
              >
                {action.completed ? (
                  <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="flex-1">{action.action}</span>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-[9px]",
                    action.completed ? "border-[#10b981]/30" : ""
                  )}
                >
                  {action.priority === "immediate" ? "즉시" : 
                   action.priority === "urgent" ? "긴급" : "일반"}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Escalation Triggers */}
        {assessment.escalationTriggers.length > 0 && (
          <div className="p-3 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30">
            <p className="text-xs font-medium text-[#ef4444] mb-2 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              에스컬레이션 트리거
            </p>
            <div className="space-y-1">
              {assessment.escalationTriggers.map((trigger, i) => (
                <p key={i} className="text-[10px] text-[#ef4444]/80">
                  {trigger}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// =========================================================
// Fused Alert List Panel (PRD Section 5.2.3)
// =========================================================
interface FusedAlertListProps {
  alerts: FusedAlert[]
}

export function FusedAlertList({ alerts }: FusedAlertListProps) {
  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case "critical": return "border-l-[#ef4444] bg-[#ef4444]/5"
      case "high": return "border-l-[#f97316] bg-[#f97316]/5"
      case "medium": return "border-l-[#f59e0b] bg-[#f59e0b]/5"
      default: return "border-l-[#10b981] bg-[#10b981]/5"
    }
  }

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case "critical": return "위급"
      case "high": return "고위험"
      case "medium": return "주의"
      default: return "정보"
    }
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "mdro": return ShieldAlert
      case "respiratory": return Wind
      case "sepsis": return Activity
      case "cluster": return Users
      case "lab": return FlaskConical
      case "imaging": return FileImage
      default: return Bell
    }
  }

  if (alerts.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6 text-center">
          <CheckCircle className="h-8 w-8 text-[#10b981] mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">활성 알림 없음</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#f59e0b]" />
          융합 알림 (Alert Fusion)
          <Badge variant="outline" className="ml-auto text-xs">
            {alerts.length}건
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {alerts.map((alert) => {
            const CategoryIcon = getCategoryIcon(alert.category)
            return (
              <div 
                key={alert.id}
                className={cn(
                  "p-3 rounded-lg border-l-4 border",
                  getPriorityStyle(alert.priority)
                )}
              >
                <div className="flex items-start gap-2">
                  <CategoryIcon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{alert.title}</span>
                      <Badge 
                        variant="outline" 
                        className="text-[9px]"
                      >
                        {getPriorityLabel(alert.priority)}
                      </Badge>
                    </div>
                    {/* Evidence Snippet */}
                    <p className="text-xs text-muted-foreground mb-2">
                      {alert.evidenceSnippet}
                    </p>
                    {/* Source Documents */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {alert.sourceDocuments.map((doc, i) => (
                        <Badge 
                          key={i}
                          variant="outline" 
                          className="text-[9px] bg-muted/50"
                        >
                          {doc.type} ({doc.date.split(" ")[0]})
                        </Badge>
                      ))}
                    </div>
                    {/* Action Required */}
                    {alert.actionRequired && (
                      <div className="flex items-center gap-1 text-xs text-primary">
                        <ArrowRight className="h-3 w-3" />
                        {alert.actionRequired}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

// =========================================================
// Cluster Alert Panel (PRD Section 3.2)
// =========================================================
interface ClusterAlertPanelProps {
  cluster: ClusterAlert
}

export function ClusterAlertPanel({ cluster }: ClusterAlertPanelProps) {
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "high": return "bg-[#ef4444] text-white"
      case "medium": return "bg-[#f59e0b] text-white"
      default: return "bg-[#10b981] text-white"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "text-[#ef4444]"
      case "monitoring": return "text-[#f59e0b]"
      default: return "text-[#10b981]"
    }
  }

  return (
    <Card className="bg-card border-[#8b5cf6]/30 border-2">
      <CardHeader className="pb-3 bg-[#8b5cf6]/10">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4 text-[#8b5cf6]" />
            클러스터 의심
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={getRiskColor(cluster.riskLevel)}>
              {cluster.riskLevel === "high" ? "고위험" : 
               cluster.riskLevel === "medium" ? "중위험" : "저위험"}
            </Badge>
            <Badge variant="outline" className={getStatusColor(cluster.status)}>
              {cluster.status === "active" ? "활성" : 
               cluster.status === "monitoring" ? "모니터링" : "해소"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        {/* Cluster Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 rounded bg-muted/50">
            <p className="text-[10px] text-muted-foreground">병동</p>
            <p className="text-sm font-medium">{cluster.ward}</p>
          </div>
          <div className="p-2 rounded bg-muted/50">
            <p className="text-[10px] text-muted-foreground">감지 시간</p>
            <p className="text-sm font-medium">{cluster.detectedAt}</p>
          </div>
          {cluster.mdroType && (
            <div className="p-2 rounded bg-[#f59e0b]/10 border border-[#f59e0b]/30">
              <p className="text-[10px] text-muted-foreground">MDRO 타입</p>
              <p className="text-sm font-medium text-[#f59e0b]">{cluster.mdroType}</p>
            </div>
          )}
          <div className="p-2 rounded bg-muted/50">
            <p className="text-[10px] text-muted-foreground">관련 환자</p>
            <p className="text-sm font-medium">{cluster.patientCount}명</p>
          </div>
        </div>

        {/* Affected Patients */}
        <div>
          <p className="text-xs font-medium text-foreground mb-2">관련 환자</p>
          <div className="flex flex-wrap gap-1.5">
            {cluster.patients.map((patient) => (
              <Badge 
                key={patient.id}
                variant="outline"
                className="text-xs"
              >
                {patient.name} ({patient.roomNumber}호)
              </Badge>
            ))}
          </div>
        </div>

        {/* Common Factors */}
        <div>
          <p className="text-xs font-medium text-foreground mb-2">공통 요인</p>
          <div className="space-y-1">
            {cluster.commonFactors.map((factor, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <ChevronRight className="h-3 w-3" />
                {factor}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
