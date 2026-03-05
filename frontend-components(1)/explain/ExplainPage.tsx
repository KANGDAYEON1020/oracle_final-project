"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { ExplainProvider, useExplainStore } from "@/lib/explain-store"
import { PatientHeaderCompact } from "@/components/explain/PatientHeaderCompact"
import { AxisSnapshotRow } from "@/components/explain/AxisSnapshotRow"

import { ChangeTimeline } from "@/components/explain/ChangeTimeline"
import { ChangeProofPanel } from "@/components/explain/ChangeProofPanel"
import { ShowContextToggle } from "@/components/explain/ShowContextToggle"
import { AlertCircle, Loader2, ArrowLeft, RefreshCw } from "lucide-react"
import type { RangeType } from "@/lib/explain-types"
import { useDemoClock } from "@/lib/demo-clock-context"

// ── 에러 뷰 ──────────────────────────────────────────

function ErrorView({ error, onRetry }: { error: string; onRetry: () => void }) {
  const isNotFound = error.includes("PATIENT_NOT_FOUND") || error.includes("찾을 수 없")
  const isNoData = error.includes("NO_NLP_DATA") || error.includes("분석 데이터")
  const isNetwork = error.includes("네트워크") || error.includes("fetch")

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <AlertCircle className="h-10 w-10 text-muted-foreground opacity-50" />
      <div className="text-center space-y-1">
        {isNotFound && (
          <p className="text-sm font-medium text-foreground">환자를 찾을 수 없습니다.</p>
        )}
        {isNoData && (
          <>
            <p className="text-sm font-medium text-foreground">아직 분석 데이터가 없습니다.</p>
            <p className="text-xs text-muted-foreground">잠시 후 다시 확인해 주십시오.</p>
          </>
        )}
        {!isNotFound && !isNoData && (
          <p className="text-sm text-muted-foreground">
            {isNetwork ? "네트워크 연결을 확인해 주십시오." : error}
          </p>
        )}
      </div>
      {!isNotFound && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground hover:bg-muted/40 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          다시 시도
        </button>
      )}
    </div>
  )
}

// ── 내부 컨텐츠 ───────────────────────────────────────

function ExplainContent({ patientId }: { patientId: string }) {
  const {
    state,
    filteredEvents,
    selectedEvent,
    activeStrip,
    loadPayload,
    selectEvent,
    setHoveredBin,
    toggleShowContext,
    handleAxisCardClick,
    handleStripBinClick,
    resetFilters,
  } = useExplainStore()
  const { demoStep, demoShift } = useDemoClock()

  const { payload, loading, error, filter, selectedEventId, hoveredBin, range } = state

  // 초기 로딩 (§ 4.4)
  useEffect(() => {
    loadPayload(patientId, "72h", { demoStep, demoShift })
  }, [demoShift, demoStep, patientId, loadPayload])

  const handleRangeChange = (r: RangeType) => {
    loadPayload(patientId, r, {
      showContext: filter.show_context,
      demoStep,
      demoShift,
    })
  }

  const handleRetry = () => {
    loadPayload(patientId, range, {
      showContext: filter.show_context,
      demoStep,
      demoShift,
    })
  }

  // 로딩
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
        <p className="text-sm text-muted-foreground">분석 데이터를 불러오는 중...</p>
      </div>
    )
  }

  // 에러
  if (error) {
    return <ErrorView error={error} onRetry={handleRetry} />
  }

  if (!payload) return null

  return (
    <div className="flex flex-col gap-4">
      {/* 환자 헤더 */}
      <PatientHeaderCompact
        patient={payload.patient}
        range={range}
        onRangeChange={handleRangeChange}
      />

      {/* 6축 스냅샷 */}
      <AxisSnapshotRow
        snapshots={payload.axis_snapshot}
        activeAxis={filter.axis}
        onAxisClick={handleAxisCardClick}
      />

      {/* [NEW] 시간대별 변화 분포 (TrajectoryRightPanel) */}
      <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-3">
        <p className="text-xs text-muted-foreground">시간대별 분포 요약은 환자 메인 화면에서 확인하세요.</p>
      </div>

      {/* 필터 바 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShowContextToggle
            showContext={filter.show_context}
            onToggle={toggleShowContext}
          />
          {(filter.axis || filter.time_bin) && (
            <button
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              필터 초기화
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredEvents.filter((e) => e.issue_only).length}건 변화 이벤트
        </span>
      </div>

      {/* 2분할: 타임라인(Events) + 증명 패널(Proof) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.8fr] gap-4">
        {/* Events List */}
        <ChangeTimeline
          events={filteredEvents}
          selectedEventId={selectedEventId}
          onEventSelect={selectEvent}
          showContextEvents={filter.show_context}
          className="max-h-[560px]"
        />

        {/* Change Proof (Compact) */}
        {/* Make it sticky if needed, but height is small now. */}
        <div className="lg:sticky lg:top-4 h-fit">
          <ChangeProofPanel
            event={selectedEvent}
            onRelatedEventClick={selectEvent}
          />
        </div>
      </div>
    </div>
  )
}

// ── 진입점 ExplainPage ────────────────────────────────

interface ExplainPageProps {
  patientId: string
  backHref?: string
  className?: string
}

export function ExplainPage({ patientId, backHref, className }: ExplainPageProps) {
  const router = useRouter()

  return (
    <ExplainProvider>
      <div className={cn("flex flex-col gap-0", className)}>
        <div className="flex items-center gap-2 px-1 pb-3">
          {backHref && (
            <button
              onClick={() => router.push(backHref)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              뒤로
            </button>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            Patient Explain v1
          </span>
        </div>

        <ExplainContent patientId={patientId} />
      </div>
    </ExplainProvider>
  )
}
