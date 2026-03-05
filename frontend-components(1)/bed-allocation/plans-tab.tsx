"use client"

import { useState } from "react"
import { Check, ChevronDown, ChevronUp, Clock, FileText, RotateCcw, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Plan } from "@/lib/bed-allocation/types"

interface PlansTabProps {
  plans: Plan[]
  onViewPlan?: (plan: Plan) => void
  onRollback?: (plan: Plan) => void
}

export function PlansTab({ plans, onViewPlan, onRollback }: PlansTabProps) {
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<string>>(new Set())

  const orderedPlans = [...plans].sort((a, b) => {
    const left = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime()
    const right = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime()
    return right - left
  })
  const resumablePlans = orderedPlans.filter(
    (plan) => plan.status === "DRAFT" || plan.status === "READY_TO_COMMIT"
  )
  const latestResumablePlan = resumablePlans.find((plan) => plan.items.length > 0) || resumablePlans[0] || null

  const statusConfig = {
    DRAFT: { label: "초안", icon: FileText, className: "bg-muted text-muted-foreground" },
    READY_TO_COMMIT: { label: "확정대기", icon: Clock, className: "bg-primary/20 text-primary" },
    COMMITTED: { label: "확정", icon: Check, className: "bg-success/20 text-success" },
    CANCELLED: { label: "취소", icon: X, className: "bg-destructive/20 text-destructive" },
  }

  const strategyLabel: Record<string, string> = {
    single: "1인실 우선",
    cohort_same_key_same_sex: "동일 코호트/동성",
    multibed_with_precautions: "다인실 주의배정",
  }

  const tierLabel: Record<string, string> = {
    S: "Tier S",
    A: "Tier A",
    B: "Tier B",
  }

  const togglePlanExpanded = (planId: string) => {
    setExpandedPlanIds((prev) => {
      const next = new Set(prev)
      if (next.has(planId)) next.delete(planId)
      else next.add(planId)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border p-3 md:p-4">
        <h2 className="text-sm font-semibold text-foreground md:text-base">배치안 히스토리</h2>
        <p className="text-xs text-muted-foreground md:text-sm">최근 배치안 목록</p>
      </div>

      <div className="flex-1 overflow-auto p-3 md:p-4">
        {plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <FileText className="h-12 w-12 mb-4 opacity-50" />
            <p>배치안 히스토리가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {resumablePlans.length > 0 && onViewPlan && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 md:p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-foreground md:text-sm">
                    이어갈 수 있는 초안 <span className="font-semibold">{resumablePlans.length}건</span>
                  </p>
                  {latestResumablePlan && (
                    <span className="text-[11px] text-muted-foreground">{latestResumablePlan.id}</span>
                  )}
                </div>
                <Button
                  variant="default"
                  size="sm"
                  className="h-9 w-full gap-2"
                  disabled={!latestResumablePlan || latestResumablePlan.items.length === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!latestResumablePlan || latestResumablePlan.items.length === 0) return
                    onViewPlan(latestResumablePlan)
                  }}
                >
                  <FileText className="h-4 w-4" />
                  최근 초안 이어서 보기
                </Button>
                {latestResumablePlan?.items.length === 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    초안 항목이 없어 바로 이어갈 수 없습니다. 대기 환자에서 새 배치안을 생성해 주세요.
                  </p>
                )}
              </div>
            )}

            {orderedPlans.map((plan) => {
              const status = statusConfig[plan.status]
              const StatusIcon = status.icon
              const isExpanded = expandedPlanIds.has(plan.id)

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "rounded-xl border border-border bg-card p-3 transition-all md:p-4"
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-foreground md:text-base">{plan.id}</h3>
                      <p className="text-[11px] text-muted-foreground md:text-xs">
                        {plan.createdAt.toLocaleString("ko-KR")}
                      </p>
                    </div>
                    <Badge className={cn("flex items-center gap-1 text-[11px]", status.className)}>
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  </div>

                  <div className="mb-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 md:text-sm">
                    <span className="text-muted-foreground">
                      생성자: <span className="text-foreground">{plan.createdBy}</span>
                    </span>
                    <span className="text-muted-foreground">
                      범위: <span className="text-foreground">{plan.scope.join(", ")}</span>
                    </span>
                    <span className="text-muted-foreground">
                      환자: <span className="text-foreground">{plan.items.length}명</span>
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="mb-2 h-9 w-full justify-between bg-transparent"
                    onClick={() => togglePlanExpanded(plan.id)}
                  >
                    <span className="text-xs md:text-sm">
                      {isExpanded ? "배치 상세 접기" : "배치 상세 보기"}
                    </span>
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>

                  {isExpanded && (
                    <div className="mb-3 space-y-2 rounded-lg border border-border/70 bg-muted/30 p-2 md:p-3">
                      {plan.items.length === 0 ? (
                        <p className="text-xs text-muted-foreground">표시할 항목이 없습니다.</p>
                      ) : (
                        plan.items.map((item) => {
                          const fromWard = item.fromWard || "-"
                          const fromRoom = item.fromRoom || "-"
                          const fromBed = item.fromBedId || "-"
                          const toWard = item.toWard || "-"
                          const toRoom = item.toRoom || "-"
                          const toBed = item.toBed || "미정"

                          return (
                            <div
                              key={`${plan.id}-${item.caseId}-${item.toBed || "pending"}`}
                              className="rounded-md border border-border bg-card p-2"
                            >
                              <div className="mb-1 flex items-center gap-1.5">
                                <span className="text-sm font-semibold text-foreground">
                                  {item.patient.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {item.patient.age}세/{item.patient.gender === "M" ? "남" : "여"}
                                </span>
                                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                  {item.patient.infectionLabel || item.patient.infection}
                                </Badge>
                                {item.tier && (
                                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                    {tierLabel[item.tier] || item.tier}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {fromWard} {fromRoom} / {fromBed} → {toWard} {toRoom} / {toBed}
                              </p>
                              {item.strategy && (
                                <p className="text-[11px] text-muted-foreground">
                                  전략: {strategyLabel[item.strategy] || item.strategy}
                                </p>
                              )}
                              {item.conflict && (
                                <p className="mt-1 text-[11px] text-destructive">{item.conflict}</p>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}

                  {(plan.status === "DRAFT" || plan.status === "READY_TO_COMMIT") && onViewPlan && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mb-2 h-9 w-full gap-2 bg-transparent"
                      disabled={plan.items.length === 0}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (plan.items.length === 0) return
                        onViewPlan(plan)
                      }}
                    >
                      <FileText className="h-4 w-4" />
                      초안 이어서 보기
                    </Button>
                  )}
                  {(plan.status === "DRAFT" || plan.status === "READY_TO_COMMIT") && plan.items.length === 0 && (
                    <p className="mb-2 text-[11px] text-muted-foreground">초안 항목이 없어 이어서 보기가 비활성화되었습니다.</p>
                  )}

                  {/* 롤백 버튼 (확정된 plan만) */}
                  {plan.status === "COMMITTED" && onRollback && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 w-full gap-2 bg-transparent text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRollback(plan)
                      }}
                    >
                      <RotateCcw className="h-4 w-4" />
                      배치 취소 (롤백)
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
