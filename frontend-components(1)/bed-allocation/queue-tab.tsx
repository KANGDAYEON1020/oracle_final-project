"use client"

import { useState } from "react"
import { AlertCircle, ArrowRight, Clock, Filter, Sparkles, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TransferCase } from "@/lib/bed-allocation/types"
import { infectionColors, wardInfo } from "@/lib/bed-allocation/types"

interface QueueTabProps {
  cases: TransferCase[]
  onGeneratePlan: (selectedCases: TransferCase[]) => Promise<void> | void
}


type FilterType = "all" | "urgent" | "isolation" | "discharge"

export function QueueTab({ cases, onGeneratePlan }: QueueTabProps) {
  const [filter, setFilter] = useState<FilterType>("all")
  const [selectedCases, setSelectedCases] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  // 필터링된 케이스
  const filteredCases = cases.filter((c) => {
    if (filter === "all") return true
    if (filter === "urgent") return c.priority === "urgent"
    if (filter === "isolation") return c.reason === "격리" || c.toWard === "5F"
    if (filter === "discharge") return c.reason === "격리 해제"
    return true
  })

  // 상태별 카운트
  const waitingCases = cases.filter((c) => c.status === "WAITING")
  const waitingCount = waitingCases.length
  const plannedCount = cases.filter((c) => c.status === "PLANNED").length
  const exceptionCount = cases.filter((c) => c.status === "NEEDS_EXCEPTION").length

  const toggleSelect = (caseId: string) => {
    const newSelected = new Set(selectedCases)
    if (newSelected.has(caseId)) {
      newSelected.delete(caseId)
    } else {
      newSelected.add(caseId)
    }
    setSelectedCases(newSelected)
  }

  const selectAll = () => {
    const waitingCases = filteredCases.filter((c) => c.status === "WAITING")
    if (selectedCases.size === waitingCases.length) {
      setSelectedCases(new Set())
    } else {
      setSelectedCases(new Set(waitingCases.map((c) => c.id)))
    }
  }

  const handleGeneratePlan = async () => {
    if (isGenerating) return
    const selected = waitingCases.filter((c) => selectedCases.has(c.id))
    const targets = selected.length > 0 ? selected : waitingCases
    if (targets.length === 0) return

    setGenerateError(null)
    setIsGenerating(true)
    try {
      await onGeneratePlan(targets)
      setSelectedCases(new Set())
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "자동 배치안 생성에 실패했습니다.")
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 p-3 md:gap-3 md:p-4">
        <div className="rounded-lg border border-border bg-card p-2.5 md:rounded-xl md:p-4">
          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span className="text-[11px] md:text-sm">미배치</span>
          </div>
          <p className="text-lg font-bold text-foreground md:text-2xl">{waitingCount}명</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5 md:rounded-xl md:p-4">
          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span className="text-[11px] md:text-sm">배치안</span>
          </div>
          <p className="text-lg font-bold text-primary md:text-2xl">{plannedCount}명</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5 md:rounded-xl md:p-4">
          <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
            <span className="text-[11px] md:text-sm">예외</span>
          </div>
          <p className="text-lg font-bold text-destructive md:text-2xl">{exceptionCount}명</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2 md:px-4 md:pb-3">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
        {(["all", "urgent", "isolation", "discharge"] as FilterType[]).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            className={cn("h-8 shrink-0 px-3 text-xs", filter !== f && "bg-transparent")}
          >
            {f === "all" && "전체"}
            {f === "urgent" && "응급"}
            {f === "isolation" && "격리 필요"}
            {f === "discharge" && "격리 해제"}
          </Button>
        ))}
      </div>

      {/* Case List */}
      <div className="flex-1 overflow-auto px-3 pb-3 md:px-4 md:pb-4">
        <div className="mb-3 flex items-center justify-between rounded-md bg-background/90 py-1 backdrop-blur md:py-0">
          <span className="text-sm text-muted-foreground">
            {filteredCases.length}건
            {selectedCases.size > 0 && (
              <span className="ml-1 font-medium text-primary">· {selectedCases.size}명 선택됨</span>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={selectAll} className="h-8 px-2 text-xs">
            {selectedCases.size > 0 ? "선택 해제" : "전체 선택"}
          </Button>
        </div>

        {/* Responsive Grid: 1 col mobile, 2 col tablet, 3 col desktop */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredCases.map((transferCase) => (
            <CaseCard
              key={transferCase.id}
              transferCase={transferCase}
              isSelected={selectedCases.has(transferCase.id)}
              onToggle={() => toggleSelect(transferCase.id)}
            />
          ))}
        </div>
      </div>

      {/* Action Button */}
      <div
        className="border-t border-border bg-card/95 p-3 backdrop-blur md:p-4"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {generateError && (
          <p className="mb-2 text-xs text-destructive">{generateError}</p>
        )}
        <Button
          className="h-11 w-full gap-2 md:h-10"
          size="lg"
          onClick={handleGeneratePlan}
          disabled={isGenerating || waitingCases.length === 0}
        >
          <Sparkles className="h-4 w-4 md:h-5 md:w-5" />
          {isGenerating
            ? "배치안 생성 중..."
            : `자동 배치안 생성 ${selectedCases.size > 0 ? `(${selectedCases.size}명)` : ""}`}
        </Button>
      </div>
    </div>
  )
}

interface CaseCardProps {
  transferCase: TransferCase
  isSelected: boolean
  onToggle: () => void
}

function CaseCard({ transferCase, isSelected, onToggle }: CaseCardProps) {
  const { patient, status, fromWard, toWard, reason, priority, exceptionReason } = transferCase
  const colors = infectionColors[patient.infection] || infectionColors.MDRO
  const infectionLabel = patient.infectionLabel || patient.infection

  const statusBadge = {
    WAITING: { label: "대기", className: "bg-muted text-muted-foreground" },
    PLANNED: { label: "배치안", className: "bg-primary/20 text-primary" },
    COMMITTED: { label: "확정", className: "bg-success/20 text-success" },
    NEEDS_EXCEPTION: { label: "예외필요", className: "bg-destructive/20 text-destructive" },
  }[status]

  return (
    <div
      onClick={status === "WAITING" ? onToggle : undefined}
      className={cn(
        "relative rounded-xl border-2 bg-card p-3 transition-all md:p-4",
        status === "WAITING" && "cursor-pointer hover:border-primary/50",
        isSelected ? "border-primary bg-primary/5" : "border-border",
        status === "NEEDS_EXCEPTION" && "border-destructive/50"
      )}
    >
      {/* Selection Indicator */}
      {status === "WAITING" && (
        <div
          className={cn(
            "absolute right-3 top-3 h-5 w-5 rounded-full border-2 transition-all md:right-4 md:top-4",
            isSelected ? "bg-primary border-primary" : "border-muted-foreground"
          )}
        >
          {isSelected && (
            <svg className="w-full h-full text-primary-foreground" viewBox="0 0 24 24">
              <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
          )}
        </div>
      )}

      {/* Patient Info */}
      <div className="flex items-start gap-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full md:h-10 md:w-10", colors.bg)}>
          <User className={cn("h-4 w-4 md:h-5 md:w-5", colors.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 pr-6 md:pr-8">
            <span className="font-semibold text-foreground">{patient.name}</span>
            <span className="text-xs text-muted-foreground md:text-sm">
              {patient.age}세/{patient.gender === "M" ? "남" : "여"}
            </span>
            {priority === "urgent" && (
              <Badge variant="destructive" className="text-[10px]">
                응급
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn("text-xs", colors.badge)}>{infectionLabel}</Badge>
            <Badge className={statusBadge.className}>{statusBadge.label}</Badge>
          </div>

          {/* Transfer Direction */}
          {fromWard || toWard ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs md:gap-2 md:text-sm">
              <span className="text-muted-foreground">{fromWard ? wardInfo[fromWard].label : "신규"}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground md:h-4 md:w-4" />
              <span className={cn("font-medium", toWard === "5F" ? "text-destructive" : "text-foreground")}>
                {toWard ? wardInfo[toWard].label : "미정"}
              </span>
              <span className="truncate text-[11px] text-muted-foreground md:text-xs">({reason})</span>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground md:text-sm">
              신규 입원
            </div>
          )}

          {/* Exception Reason */}
          {exceptionReason && (
            <div className="mt-2 flex items-center gap-1 text-xs text-destructive md:text-sm">
              <AlertCircle className="h-4 w-4" />
              {exceptionReason}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
