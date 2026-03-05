"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, AlertCircle, Check, Edit3, Eye, User, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BedboardTab } from "./bedboard-tab"
import { PersistentBottomSheet } from "@/components/ui/persistent-bottom-sheet"
import { cn } from "@/lib/utils"
import type { Room, Plan, PlanItem } from "@/lib/bed-allocation/types"
import { infectionColors } from "@/lib/bed-allocation/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

interface PlanReviewProps {
  plan: Plan
  rooms: Room[]
  onBack: () => void
  onCommit: (plan: Plan) => Promise<void> | void
  onCancel: () => Promise<void> | void
  onUpdatePlan: (updatedPlan: Plan) => void
  onEscalateCase?: (planId: string, caseId: string, reasonText: string) => Promise<void> | void
}


export function PlanReview({ plan, rooms, onBack, onCommit, onCancel, onUpdatePlan, onEscalateCase }: PlanReviewProps) {
  const [selectedItem, setSelectedItem] = useState<PlanItem | null>(null)
  const [showCandidates, setShowCandidates] = useState(false)
  const [isExceptionModalOpen, setIsExceptionModalOpen] = useState(false)
  const [exceptionReason, setExceptionReason] = useState("")
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [showPlanSheet, setShowPlanSheet] = useState(false) // Mobile bottom sheet state - starts minimized
  const [isGenderWarningOpen, setIsGenderWarningOpen] = useState(false)
  const [genderConflicts, setGenderConflicts] = useState<string[]>([])


  // 미배치/충돌 항목
  const conflictItems = plan.items.filter((item) => item.conflict)
  const successItems = plan.items.filter((item) => !item.conflict)

  // 선택된 환자의 후보 베드 계산
  const getCandidateBeds = (): string[] => {
    if (!selectedItem) return []

    const candidateBeds: string[] = []
    const patientInfection = selectedItem.patient.infection

    rooms.forEach((room) => {
      // 같은 코호트이거나 빈 방만
      if (room.cohortType === null || room.cohortType === patientInfection) {
        room.beds.forEach((bed) => {
          if (!bed.patient) {
            candidateBeds.push(bed.id)
          }
        })
      }
    })

    return candidateBeds
  }

  const handleBedClick = (room: Room, bedId: string) => {
    if (!selectedItem) return

    // First, remove any existing assignment to this specific bed
    const updatedItems = plan.items
      .map((item) => {
        // If this item is assigned to the same bed, clear its assignment
        if (item.toRoom === room.roomNo && item.toBed === bedId && item.caseId !== selectedItem.caseId) {
          return {
            ...item,
            toWard: item.fromWard || "2F",
            toRoom: "미정",
            toRoomId: null,
            toBed: "",
            conflict: "배정 가능한 병상이 없습니다", // Mark as conflict since bed was taken
          }
        }
        // Update the selected item with new bed assignment
        if (item.caseId === selectedItem.caseId) {
          return {
            ...item,
            toWard: room.wardId,
            toRoom: room.roomNo,
            toRoomId: room.id,
            toBed: bedId,
            conflict: undefined, // Clear conflict
          }
        }
        return item
      })

    onUpdatePlan({ ...plan, items: updatedItems })
    setSelectedItem(null)
    setShowCandidates(false)
  }

  const handleException = async () => {
    if (!selectedItem || !exceptionReason.trim()) return

    if (onEscalateCase) {
      await onEscalateCase(plan.id, selectedItem.caseId, exceptionReason.trim())
    }

    // 항목 제거 및 예외 처리
    const updatedItems = plan.items.filter((item) => item.caseId !== selectedItem.caseId)
    onUpdatePlan({ ...plan, items: updatedItems })

    setIsExceptionModalOpen(false)
    setExceptionReason("")
    setSelectedItem(null)
  }

  // 확정 체크리스트
  const hasCleaningBeds = plan.items.some((item) => {
    const room = rooms.find((r) => r.roomNo === item.toRoom)
    return room?.needsCleaning
  })

  const hasIsolationTransfer = plan.items.some((item) => item.toWard === "5F")

  // 성별 충돌 체크 함수
  const checkGenderConflicts = (): string[] => {
    const conflicts: string[] = []
    const roomGenderMap = new Map<string, Set<string>>()

    // 기존 병실의 환자 성별 수집
    rooms.forEach((room) => {
      if (room.capacity > 1) {
        const genders = new Set<string>()
        room.beds.forEach((bed) => {
          if (bed.patient) {
            genders.add(bed.patient.gender)
          }
        })
        if (genders.size > 0) {
          roomGenderMap.set(room.roomNo, genders)
        }
      }
    })

    // Plan의 각 항목에 대해 성별 충돌 체크
    plan.items.forEach((item) => {
      if (!item.conflict) {
        const room = rooms.find((r) => r.roomNo === item.toRoom)
        if (room && room.capacity > 1) {
          const currentGenders = roomGenderMap.get(room.roomNo) || new Set<string>()

          // 이미 다른 성별이 있는 경우
          if (currentGenders.size > 0 && !currentGenders.has(item.patient.gender)) {
            const existingGender = Array.from(currentGenders)[0]
            conflicts.push(
              `${item.toRoom}호: ${item.patient.name} (${item.patient.gender === "M" ? "남" : "여"})을(를) ${existingGender === "M" ? "남성" : "여성"} 병실에 배정`
            )
          }

          // 현재 plan에서 같은 방에 배정되는 환자들끼리 성별 체크
          currentGenders.add(item.patient.gender)
          roomGenderMap.set(room.roomNo, currentGenders)

          // 성별이 섞인 경우
          if (currentGenders.size > 1) {
            if (!conflicts.some(c => c.includes(item.toRoom))) {
              conflicts.push(`${item.toRoom}호: 남녀 혼합 배정`)
            }
          }
        }
      }
    })

    return conflicts
  }

  // 확정 시도
  const handleConfirmAttempt = () => {
    const conflicts = checkGenderConflicts()
    if (conflicts.length > 0) {
      setGenderConflicts(conflicts)
      setIsGenderWarningOpen(true)
    } else {
      setIsConfirmModalOpen(true)
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card p-3 md:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 md:gap-3">
            <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 md:h-10 md:w-10">
              <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
            </Button>
            <div>
              <h1 className="text-sm font-bold text-foreground md:text-lg">{plan.id}</h1>
              <p className="text-[11px] text-muted-foreground md:text-xs">
                {plan.createdAt.toLocaleString("ko-KR")} · {plan.createdBy}
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="outline" className="bg-transparent" onClick={onCancel}>
              취소
            </Button>
            <Button onClick={handleConfirmAttempt}>
              확정 요청
            </Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground md:text-xs">
          <Badge variant="secondary" className="bg-primary/10 text-primary">
            배치 {successItems.length}
          </Badge>
          <Badge variant="secondary" className={cn(conflictItems.length > 0 && "bg-destructive/10 text-destructive")}>
            충돌 {conflictItems.length}
          </Badge>
          <span>범위: {plan.scope.join(", ")}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 md:hidden">
          <Button variant="outline" className="h-9 bg-transparent px-2 text-xs" onClick={() => setShowPlanSheet(true)}>
            항목 보기
          </Button>
          <Button variant="outline" className="h-9 px-2 text-xs" onClick={onCancel}>
            취소
          </Button>
          <Button className="h-9 px-2 text-xs" onClick={handleConfirmAttempt}>
            확정 요청
          </Button>
        </div>
      </header>

      {/* Main Content - Responsive Layout */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Bedboard - Full screen on mobile */}
        <div className="flex-1 overflow-hidden md:border-r md:border-border">
          <BedboardTab
            rooms={rooms}
            planItems={plan.items}
            selectedPatient={selectedItem?.patient || null}
            highlightedBeds={showCandidates ? getCandidateBeds() : []}
            mobileBottomInset="sheet"
            onBedClick={handleBedClick}
            isReadOnly={!selectedItem}
          />
        </div>

        {/* Desktop: Plan Items Panel (Right Side) */}
        <div className="hidden md:flex md:w-80 flex-col bg-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">배치안 항목</h2>
            <p className="text-xs text-muted-foreground">
              성공 {successItems.length}건 / 충돌 {conflictItems.length}건
            </p>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3">
            {/* Conflict Items */}
            {conflictItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  충돌/미배치 ({conflictItems.length})
                </h3>
                {conflictItems.map((item) => (
                  <PlanItemCard
                    key={item.caseId}
                    item={item}
                    isSelected={selectedItem?.caseId === item.caseId}
                    onSelect={() => {
                      setSelectedItem(item)
                      setShowCandidates(true)
                    }}
                    onException={() => {
                      setSelectedItem(item)
                      setIsExceptionModalOpen(true)
                    }}
                  />
                ))}
              </div>
            )}

            {/* Success Items */}
            {successItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  배치 완료 ({successItems.length})
                </h3>
                {successItems.map((item) => (
                  <PlanItemCard
                    key={item.caseId}
                    item={item}
                    isSelected={selectedItem?.caseId === item.caseId}
                    onSelect={() => {
                      setSelectedItem(item)
                      setShowCandidates(true)
                    }}
                    onException={() => {
                      setSelectedItem(item)
                      setIsExceptionModalOpen(true)
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Selected Item Actions */}
          {selectedItem && (
            <div className="p-4 border-t border-border space-y-2">
              <div className="text-sm text-muted-foreground mb-2">
                <span className="font-medium text-foreground">{selectedItem.patient.name}</span> 환자 선택됨
              </div>
              <Button
                variant="outline"
                className="w-full gap-2 bg-transparent"
                onClick={() => setShowCandidates(!showCandidates)}
              >
                <Eye className="h-4 w-4" />
                {showCandidates ? "후보 숨기기" : "후보 베드 보기"}
              </Button>
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => {
                  setSelectedItem(null)
                  setShowCandidates(false)
                }}
              >
                선택 해제
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: Persistent Bottom Sheet for Plan Items */}
      <PersistentBottomSheet
        isOpen={showPlanSheet}
        onOpenChange={setShowPlanSheet}
        title="배치안 항목"
        subtitle={`성공 ${successItems.length}건 · 충돌 ${conflictItems.length}건`}
        snapPoints={[0, 55, 88]}
        defaultSnap={1}
      >
        <div className="p-4">
          <div className="space-y-3">
            {/* Conflict Items */}
            {conflictItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  충돌/미배치 ({conflictItems.length})
                </h3>
                {conflictItems.map((item) => (
                  <PlanItemCard
                    key={item.caseId}
                    item={item}
                    isSelected={selectedItem?.caseId === item.caseId}
                    onSelect={() => {
                      setSelectedItem(item)
                      setShowCandidates(true)
                      setShowPlanSheet(false) // Close sheet when selecting
                    }}
                    onException={() => {
                      setSelectedItem(item)
                      setIsExceptionModalOpen(true)
                    }}
                  />
                ))}
              </div>
            )}

            {/* Success Items */}
            {successItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  배치 완료 ({successItems.length})
                </h3>
                {successItems.map((item) => (
                  <PlanItemCard
                    key={item.caseId}
                    item={item}
                    isSelected={selectedItem?.caseId === item.caseId}
                    onSelect={() => {
                      setSelectedItem(item)
                      setShowCandidates(true)
                      setShowPlanSheet(false) // Close sheet when selecting
                    }}
                    onException={() => {
                      setSelectedItem(item)
                      setIsExceptionModalOpen(true)
                    }}
                  />
                ))}
              </div>
            )}

            {/* Selected Item Actions */}
            {selectedItem && (
              <div className="pt-4 border-t border-border space-y-2">
                <div className="text-sm text-muted-foreground mb-2">
                  <span className="font-medium text-foreground">{selectedItem.patient.name}</span> 환자 선택됨
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setShowCandidates(!showCandidates)}
                >
                  <Eye className="h-4 w-4" />
                  {showCandidates ? "후보 숨기기" : "후보 베드 보기"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => {
                    setSelectedItem(null)
                    setShowCandidates(false)
                  }}
                >
                  선택 해제
                </Button>
              </div>
            )}
          </div>
        </div>
      </PersistentBottomSheet>

      {/* Exception Modal */}
      <Dialog open={isExceptionModalOpen} onOpenChange={setIsExceptionModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>예외 처리</DialogTitle>
            <DialogDescription>
              {selectedItem?.patient.name} 환자를 배치안에서 제외하고 예외 처리합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium text-foreground">예외 사유</label>
            <Textarea
              value={exceptionReason}
              onChange={(e) => setExceptionReason(e.target.value)}
              placeholder="예외 처리 사유를 입력하세요"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="bg-transparent" onClick={() => setIsExceptionModalOpen(false)}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleException} disabled={!exceptionReason.trim()}>
              예외 처리
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Gender Warning Modal */}
      <Dialog open={isGenderWarningOpen} onOpenChange={setIsGenderWarningOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">성별 충돌 경고</DialogTitle>
            <DialogDescription>
              다인실에서 남녀를 같은 방에 배정할 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <h4 className="text-sm font-medium text-foreground">충돌 항목:</h4>
            <div className="space-y-1">
              {genderConflicts.map((conflict, index) => (
                <div key={index} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <span className="text-destructive">{conflict}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 rounded-lg bg-muted/50 text-sm">
              <p className="text-muted-foreground">
                충돌하는 환자를 선택하여 다른 병실로 재배정하거나 예외 처리해주세요.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsGenderWarningOpen(false)}>
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Modal */}
      <Dialog open={isConfirmModalOpen} onOpenChange={setIsConfirmModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>배치안 확정</DialogTitle>
            <DialogDescription>확정하면 병상 상태/격리 상태가 업데이트됩니다.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <h4 className="text-sm font-medium text-foreground">확인 사항</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center", hasCleaningBeds ? "bg-warning/20" : "bg-muted")}>
                  {hasCleaningBeds ? <AlertCircle className="h-3 w-3 text-warning" /> : <Check className="h-3 w-3 text-muted-foreground" />}
                </div>
                <span className={hasCleaningBeds ? "text-warning" : "text-muted-foreground"}>청소 필요 베드 포함 {hasCleaningBeds ? "있음" : "없음"}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className={cn("w-5 h-5 rounded flex items-center justify-center", hasIsolationTransfer ? "bg-primary/20" : "bg-muted")}>
                  {hasIsolationTransfer ? <Check className="h-3 w-3 text-primary" /> : <Check className="h-3 w-3 text-muted-foreground" />}
                </div>
                <span className={hasIsolationTransfer ? "text-foreground" : "text-muted-foreground"}>
                  격리병동(5F) 이동 {hasIsolationTransfer ? "포함" : "없음"}
                </span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <span className="font-medium text-foreground">{successItems.length}명</span>의 환자가 배치됩니다.
              {conflictItems.length > 0 && (
                <span className="text-muted-foreground ml-1">
                  ({conflictItems.length}명 제외됨)
                </span>
              )}
            </div>

            {/* Conflict Warning */}
            {conflictItems.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-sm font-medium text-destructive flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  제외되는 항목 ({conflictItems.length})
                </h4>
                <div className="max-h-32 overflow-y-auto space-y-2 bg-destructive/5 rounded-lg p-3">
                  {conflictItems.map((item) => (
                    <div key={item.caseId} className="text-xs space-y-0.5">
                      <div className="font-medium text-destructive">
                        {item.patient.name} ({item.patient.infectionLabel || item.patient.infection})
                      </div>
                      <div className="text-destructive/80 pl-2 border-l-2 border-destructive/20">
                        {item.conflict?.trim() || "충돌 사유를 확인할 수 없습니다"}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  위 항목들은 충돌로 인해 배치안에서 제외됩니다. 계속하시겠습니까?
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="bg-transparent" onClick={() => setIsConfirmModalOpen(false)}>
              취소
            </Button>
            <Button
              onClick={() => {
                onCommit(plan)
                setIsConfirmModalOpen(false)
              }}
            >
              확정
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface PlanItemCardProps {
  item: PlanItem
  isSelected: boolean
  onSelect: () => void
  onException: () => void
}

function formatRoomLabel(roomValue: string | null | undefined): string {
  const raw = String(roomValue || "").trim()
  if (!raw) return "신규"
  const tokens = raw.split("-").filter(Boolean)
  const last = tokens[tokens.length - 1] || raw
  if (/^\d+$/.test(last)) return last
  return raw
}

function PlanItemCard({ item, isSelected, onSelect, onException }: PlanItemCardProps) {
  const colors = infectionColors[item.patient.infection] || infectionColors.MDRO
  const infectionLabel = item.patient.infectionLabel || item.patient.infection

  return (
    <div
      onClick={onSelect}
      className={cn(
        "rounded-lg border p-3 cursor-pointer transition-all",
        isSelected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50",
        item.conflict && "border-destructive/50"
      )}
    >
      <div className="flex items-start gap-2">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", colors.bg)}>
          <User className={cn("h-4 w-4", colors.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm">{item.patient.name}</span>
            <Badge className={cn("text-[10px] px-1.5", colors.badge)}>{infectionLabel}</Badge>
          </div>

          {/* Transfer Direction */}
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <span>{formatRoomLabel(item.fromRoom)}</span>
            <ArrowRight className="h-3 w-3" />
            <span className={cn("font-medium", item.toWard === "5F" ? "text-destructive" : "text-foreground")}>
              {formatRoomLabel(item.toRoom)}
            </span>
          </div>

          {/* Conflict */}
          {item.conflict && (
            <div className="mt-1 text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {item.conflict}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
          >
            <Edit3 className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onException()
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  )
}
