"use client"

import { useCallback, useRef, useState } from "react"
import { Bed, Users, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import type { Room, WardId, Patient, InfectionType, PlanItem } from "@/lib/bed-allocation/types"
import { infectionColors, wardInfo } from "@/lib/bed-allocation/types"

interface BedboardTabProps {
  rooms: Room[]
  planItems?: PlanItem[] // 가배치 항목들
  selectedPatient?: Patient | null
  highlightedBeds?: string[] // 후보 베드 하이라이트
  mobileBottomInset?: "none" | "sheet"
  onBedClick?: (room: Room, bedId: string) => void
  isReadOnly?: boolean
  onMovePatient?: (patientId: string, fromRoomId: string, fromBedId: string, toRoomId: string, toBedId: string) => void
  onRemovePatient?: (roomId: string, bedId: string) => void
  hasPendingChanges?: boolean
  onConfirmChanges?: () => void
  onCancelChanges?: () => void
}

type DragState = { patient: Patient; sourceRoomId: string; sourceBedId: string }

export function BedboardTab({
  rooms,
  planItems = [],
  selectedPatient,
  highlightedBeds = [],
  mobileBottomInset = "none",
  onBedClick,
  isReadOnly = false,
  onMovePatient,
  onRemovePatient,
  hasPendingChanges = false,
  onConfirmChanges,
  onCancelChanges,
}: BedboardTabProps) {
  const [activeWard, setActiveWard] = useState<WardId>("2F")
  const [draggingPatient, setDraggingPatient] = useState<DragState | null>(null)
  const draggingPatientRef = useRef<DragState | null>(null)
  const [showMobilePatientSheet, setShowMobilePatientSheet] = useState(false)

  const handleDragStart = useCallback((patient: Patient, roomId: string, bedId: string) => {
    const next = { patient, sourceRoomId: roomId, sourceBedId: bedId }
    draggingPatientRef.current = next
    setDraggingPatient(next)
  }, [])

  const handleDragEnd = useCallback(() => {
    draggingPatientRef.current = null
    setDraggingPatient(null)
  }, [])

  const wardRooms = rooms.filter((r) => r.wardId === activeWard)
  const selectedPatientColors = selectedPatient
    ? infectionColors[selectedPatient.infection as InfectionType] || infectionColors.MDRO
    : infectionColors.MDRO
  const selectedPatientInfectionLabel = selectedPatient?.infectionLabel || selectedPatient?.infection || "MDRO"

  // 병실 타입별 분리
  const fourBedRooms = wardRooms.filter((r) => r.capacity === 4)
  const twoBedRooms = wardRooms.filter((r) => r.capacity === 2)
  const singleRooms = wardRooms.filter((r) => r.capacity === 1)

  // 통계
  const totalBeds = wardRooms.reduce((sum, r) => sum + r.capacity, 0)
  const occupiedBeds = wardRooms.reduce((sum, r) => sum + r.beds.filter((b) => b.patient).length, 0)
  const ghostBeds = planItems.filter((item) => item.toWard === activeWard).length

  return (
    <div className="flex flex-col h-full">
      {/* Ward Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-3 md:p-4">
        {(["2F", "3F", "5F"] as WardId[]).map((ward) => {
          const wardRoomCount = rooms.filter((r) => r.wardId === ward)
          const wardOccupied = wardRoomCount.reduce((sum, r) => sum + r.beds.filter((b) => b.patient).length, 0)
          const wardTotal = wardRoomCount.reduce((sum, r) => sum + r.capacity, 0)

          return (
            <Button
              key={ward}
              variant={activeWard === ward ? "default" : "outline"}
              onClick={() => setActiveWard(ward)}
              className={cn(
                "h-auto min-w-[96px] flex-1 flex-col py-2.5 text-xs md:py-3 md:text-sm",
                activeWard !== ward && "bg-transparent"
              )}
            >
              <span className="font-bold">{wardInfo[ward].label}</span>
              <span className="text-xs opacity-80">
                {wardOccupied}/{wardTotal}
              </span>
            </Button>
          )
        })}
      </div>

      {/* Stats */}
      <div className="bg-muted/30 px-3 py-2.5 md:px-4 md:py-3">
        <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
          <span className="text-xs text-muted-foreground md:text-sm">{wardInfo[activeWard].description}</span>
          <div className="flex items-center gap-3 text-xs md:gap-4 md:text-sm">
            <span className="text-muted-foreground">
              <span className="font-bold text-foreground">{occupiedBeds}</span>/{totalBeds} 사용중
            </span>
            {ghostBeds > 0 && <span className="font-medium text-primary">+{ghostBeds} 가배치</span>}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground md:hidden">
          환자를 길게 눌러 이동할 병상을 선택하세요.
        </p>
      </div>

      {/* Room Grid */}
      <div
        className={cn(
          "flex-1 overflow-auto p-3 md:p-4 space-y-5 md:space-y-6",
          mobileBottomInset === "sheet" ? "pb-28 md:pb-6" : "pb-4 md:pb-4"
        )}
      >
        {/* 4-Bed Rooms */}
        {fourBedRooms.length > 0 && (
          <section>
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-medium text-muted-foreground md:mb-3">
              <Bed className="h-4 w-4" />
              4인실
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {fourBedRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  planItems={planItems}
                  selectedPatient={selectedPatient}
                  highlightedBeds={highlightedBeds}
                  onBedClick={onBedClick}
                  isReadOnly={isReadOnly}
                  draggingPatient={draggingPatient}
                  draggingPatientRef={draggingPatientRef}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDrop={onMovePatient}
                  onRemovePatient={onRemovePatient}
                />
              ))}
            </div>
          </section>
        )}

        {/* 2-Bed Rooms */}
        {twoBedRooms.length > 0 && (
          <section>
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-medium text-muted-foreground md:mb-3">
              <Bed className="h-4 w-4" />
              2인실
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {twoBedRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  planItems={planItems}
                  selectedPatient={selectedPatient}
                  highlightedBeds={highlightedBeds}
                  onBedClick={onBedClick}
                  isReadOnly={isReadOnly}
                  draggingPatient={draggingPatient}
                  draggingPatientRef={draggingPatientRef}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDrop={onMovePatient}
                  onRemovePatient={onRemovePatient}
                />
              ))}
            </div>
          </section>
        )}

        {/* Single Rooms */}
        {singleRooms.length > 0 && (
          <section>
            <h3 className="mb-2.5 flex items-center gap-2 text-sm font-medium text-muted-foreground md:mb-3">
              <Bed className="h-4 w-4" />
              1인실
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {singleRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  planItems={planItems}
                  selectedPatient={selectedPatient}
                  highlightedBeds={highlightedBeds}
                  onBedClick={onBedClick}
                  isReadOnly={isReadOnly}
                  draggingPatient={draggingPatient}
                  draggingPatientRef={draggingPatientRef}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDrop={onMovePatient}
                  onRemovePatient={onRemovePatient}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Confirmation Button (appears when there are pending changes) */}
      {hasPendingChanges && onConfirmChanges && (
        <div
          className="border-t border-border bg-card p-3 md:p-4"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-2.5 md:gap-3">
            <Button
              onClick={onConfirmChanges}
              className="flex-1 gap-2"
              size="lg"
            >
              확정 요청
            </Button>
            {onCancelChanges && (
              <Button
                onClick={onCancelChanges}
                variant="outline"
                size="lg"
              >
                취소
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Mobile: Show selected patient button */}
      {selectedPatient && (
        <div className="md:hidden border-t border-border bg-card p-3">
          <Button
            onClick={() => setShowMobilePatientSheet(true)}
            className="h-10 w-full justify-start gap-2"
            variant="outline"
          >
            <User className="h-4 w-4" />
            선택 환자: {selectedPatient.name}
          </Button>
        </div>
      )}

      {/* Desktop Legend */}
      <div className="hidden border-t border-border bg-card p-4 md:block">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            감염유형:
          </span>
          {Object.entries(infectionColors).map(([type, colors]) => (
            <TooltipProvider key={type}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 cursor-help">
                    <span className={cn("w-2.5 h-2.5 rounded-full", colors.badge.split(" ")[0])} />
                    {type}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {type === "Pneumonia" && "폐렴 - 비말 격리 필요"}
                    {type === "MRSA" && "MRSA - 접촉 격리 필요"}
                    {type === "VRE" && "VRE - 접촉 격리 필요"}
                    {type === "CRE" && "CRE - 엄격한 격리 필요"}
                    {type === "C.diff" && "C.diff - 접촉 격리 필요"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
          <span className="border-l border-border pl-3 text-muted-foreground">|</span>
          <span className="text-muted-foreground">성별:</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500/50" />
            남
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-pink-500/50" />
            여
          </span>
          <span className="border-l border-border pl-3 text-muted-foreground">|</span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-primary bg-primary/20" />
            가배치
          </span>
        </div>
      </div>

      {/* Mobile Legend */}
      <details className="border-t border-border bg-card px-3 py-2 text-xs md:hidden">
        <summary className="cursor-pointer text-muted-foreground">범례 보기</summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground">감염유형:</span>
          {Object.entries(infectionColors).map(([type, colors]) => (
            <span key={type} className="inline-flex items-center gap-1">
              <span className={cn("h-2.5 w-2.5 rounded-full", colors.badge.split(" ")[0])} />
              {type}
            </span>
          ))}
          <span className="text-muted-foreground">성별:</span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-500/50" />남
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-pink-500/50" />여
          </span>
        </div>
      </details>

      {/* Mobile Bottom Sheet for Selected Patient */}
      <BottomSheet
        open={showMobilePatientSheet}
        onOpenChange={setShowMobilePatientSheet}
        title="선택된 환자"
      >
        {selectedPatient && (
          <div className="p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center",
                selectedPatientColors.bg
              )}>
                <User className={cn(
                  "h-6 w-6",
                  selectedPatientColors.text
                )} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{selectedPatient.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {selectedPatient.age}세 / {selectedPatient.gender === "M" ? "남" : "여"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">감염유형:</span>
                <Badge className={selectedPatientColors.badge}>
                  {selectedPatientInfectionLabel}
                </Badge>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                병상을 선택하여 환자를 배정하세요
              </p>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

interface RoomCardProps {
  room: Room
  planItems: PlanItem[]
  selectedPatient?: Patient | null
  highlightedBeds: string[]
  onBedClick?: (room: Room, bedId: string) => void
  isReadOnly: boolean
  draggingPatient: DragState | null
  draggingPatientRef: React.MutableRefObject<DragState | null>
  onDragStart: (patient: Patient, roomId: string, bedId: string) => void
  onDragEnd: () => void
  onDrop?: (patientId: string, fromRoomId: string, fromBedId: string, toRoomId: string, toBedId: string) => void
  onRemovePatient?: (roomId: string, bedId: string) => void
}

interface DragPayload {
  patientId: string
  infection: InfectionType
  gender: "M" | "F"
  sourceRoomId: string
  sourceBedId: string
}

function RoomCard({ room, planItems, selectedPatient, highlightedBeds, onBedClick, isReadOnly, draggingPatient, draggingPatientRef, onDragStart, onDragEnd, onDrop, onRemovePatient }: RoomCardProps) {
  const occupiedCount = room.beds.filter((b) => b.patient).length
  const colors = room.cohortType ? infectionColors[room.cohortType] : null

  // 이 방의 가배치 환자들
  const ghostItems = planItems.filter((item) => item.toRoom === room.roomNo)

  // 선택된 환자를 이 방에 배치 가능한지
  const canAccept =
    selectedPatient && !isReadOnly && (room.cohortType === null || room.cohortType === selectedPatient.infection)

  return (
    <div
      className={cn(
        "rounded-xl border-2 bg-card p-2.5 transition-all md:p-3",
        colors ? colors.border : "border-border",
        room.needsCleaning && "border-warning/50 bg-warning/5",
        canAccept && "ring-2 ring-primary/50"
      )}
    >
      {/* Room Header */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
          <span className="shrink-0 text-sm font-bold text-foreground">{room.roomNo}</span>
          {/* 성별 표시 (1인실 제외) */}
          {room.capacity > 1 && room.genderType && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                room.genderType === "M" ? "bg-blue-500/20 text-blue-400" : "bg-pink-500/20 text-pink-400"
              )}
            >
              {room.genderType === "M" ? "남" : "여"}
            </span>
          )}
          {room.cohortType && (
            <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px]", colors?.badge)}>
              {room.cohortLabel || room.cohortType}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground md:text-xs">
          <Users className="h-3 w-3" />
          <span>
            {occupiedCount}/{room.capacity}
          </span>
        </div>
      </div>

      {/* Room Status */}
      {room.needsCleaning && <div className="mb-2 text-[11px] text-warning md:text-xs">청소 필요</div>}

      {/* Beds Grid */}
      <div
        className={cn("grid gap-1.5", room.capacity === 4 && "grid-cols-2", room.capacity === 2 && "grid-cols-2", room.capacity === 1 && "grid-cols-1")}
      >
        {room.beds.map((bed) => {
          const ghostPatient = ghostItems.find((item) => item.toBed === bed.id)?.patient
          const isHighlighted = highlightedBeds.includes(bed.id)
          const bedColors = bed.patient?.infection ? infectionColors[bed.patient.infection] : null

          // Bedboard manual move: allow any empty target bed except the same source bed.
          const canDrop =
            !isReadOnly &&
            !!draggingPatient &&
            !bed.patient &&
            draggingPatient.sourceBedId !== bed.id

          const parseDragPayload = (e: React.DragEvent<HTMLDivElement>): DragPayload | null => {
            // Prefer explicit payload from dataTransfer to avoid state timing issues.
            try {
              const raw = e.dataTransfer.getData("application/x-bed-drag")
              if (raw) {
                return JSON.parse(raw) as DragPayload
              }
            } catch {
              // no-op
            }

            const activeDrag = draggingPatientRef.current ?? draggingPatient
            if (activeDrag) {
              return {
                patientId: activeDrag.patient.id,
                infection: activeDrag.patient.infection,
                gender: activeDrag.patient.gender,
                sourceRoomId: activeDrag.sourceRoomId,
                sourceBedId: activeDrag.sourceBedId,
              }
            }

            return null
          }

          const isDraggingThis = draggingPatient?.sourceBedId === bed.id

          return (
            <div
              key={bed.id}
              draggable={false}
              onDragStart={(e) => {
                if (bed.patient && !isReadOnly) {
                  const payload: DragPayload = {
                    patientId: bed.patient.id,
                    infection: bed.patient.infection,
                    gender: bed.patient.gender,
                    sourceRoomId: room.id,
                    sourceBedId: bed.id,
                  }
                  e.dataTransfer.effectAllowed = "move"
                  e.dataTransfer.setData("text/plain", bed.patient.id)
                  e.dataTransfer.setData("application/x-bed-drag", JSON.stringify(payload))
                  onDragStart(bed.patient, room.id, bed.id)
                }
              }}
              onPointerDown={(e) => {
                if (isReadOnly || !onDrop || !bed.patient) return
                if (e.button !== 0) return
                if ((e.target as HTMLElement).closest("button")) return
                onDragStart(bed.patient, room.id, bed.id)
              }}
              onDragEnd={() => {
                if (!isReadOnly) {
                  onDragEnd()
                }
              }}
              onDragOver={(e) => {
                // Allow drop target evaluation regardless of React state timing.
                if (!isReadOnly && !bed.patient) {
                  e.preventDefault()
                  const activeDrag = draggingPatientRef.current ?? draggingPatient
                  const canDropNow =
                    !!activeDrag &&
                    activeDrag.sourceBedId !== bed.id
                  e.dataTransfer.dropEffect = canDropNow ? "move" : "none"
                }
              }}
              onDrop={(e) => {
                e.preventDefault()

                const payload = parseDragPayload(e)
                if (!payload || !onDrop || isReadOnly || !!bed.patient) {
                  onDragEnd()
                  return
                }

                const notSameBed = payload.sourceBedId !== bed.id

                if (notSameBed) {
                  onDrop(
                    payload.patientId,
                    payload.sourceRoomId,
                    payload.sourceBedId,
                    room.id,
                    bed.id
                  )
                }
                onDragEnd()
              }}
              onPointerUp={(e) => {
                if (isReadOnly || !onDrop) return
                if ((e.target as HTMLElement).closest("button")) return
                const activeDrag = draggingPatientRef.current ?? draggingPatient
                if (!activeDrag) return
                const canDropNow = !bed.patient && activeDrag.sourceBedId !== bed.id
                if (canDropNow) {
                  onDrop(
                    activeDrag.patient.id,
                    activeDrag.sourceRoomId,
                    activeDrag.sourceBedId,
                    room.id,
                    bed.id
                  )
                }
                onDragEnd()
              }}
              onClick={(e) => {
                if (isReadOnly) return

                // Click-to-move fallback for environments where native DnD is unreliable.
                if (onDrop) {
                  const activeDrag = draggingPatientRef.current ?? draggingPatient
                  if (bed.patient) {
                    if (activeDrag?.sourceBedId === bed.id) {
                      onDragEnd()
                    } else {
                      onDragStart(bed.patient, room.id, bed.id)
                    }
                    return
                  }

                  if (activeDrag && !bed.patient && activeDrag.sourceBedId !== bed.id) {
                    onDrop(
                      activeDrag.patient.id,
                      activeDrag.sourceRoomId,
                      activeDrag.sourceBedId,
                      room.id,
                      bed.id
                    )
                    onDragEnd()
                    return
                  }
                }

                // Bed click for assignment flows (e.g. plan review).
                if (!draggingPatient && !bed.patient && onBedClick) {
                  onBedClick(room, bed.id)
                }
              }}
              className={cn(
                "relative flex min-h-[56px] select-none items-center justify-center rounded-lg border p-2 transition-all md:min-h-[48px]",
                bed.patient
                  ? cn(
                    "border-solid cursor-grab active:cursor-grabbing",
                    bedColors?.border,
                    bedColors?.bg,
                    isDraggingThis && "opacity-50"
                  )
                  : cn(
                    "border-dashed border-border bg-muted/30",
                    isHighlighted && "border-primary bg-primary/10",
                    canDrop && "border-success bg-success/10 hover:bg-success/20",
                    draggingPatient && !canDrop && "border-destructive/30 bg-destructive/5"
                  ),
                ghostPatient && "border-dashed border-primary bg-primary/10"
              )}
            >
              {bed.patient ? (
                <div className="text-center">
                  <div className="truncate text-xs font-medium text-foreground">{bed.patient.name}</div>
                  {!isReadOnly && onRemovePatient && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemovePatient(room.id, bed.id)
                      }}
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground transition-transform hover:scale-110"
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : ghostPatient ? (
                <div className="text-center">
                  <div className="truncate text-xs font-medium text-primary">{ghostPatient.name}</div>
                  <div className="text-[10px] text-primary/70">가배치</div>
                </div>
              ) : (
                <Bed className={cn("h-4 w-4", isHighlighted ? "text-primary/50" : canDrop ? "text-success/50" : "text-muted-foreground/30")} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
