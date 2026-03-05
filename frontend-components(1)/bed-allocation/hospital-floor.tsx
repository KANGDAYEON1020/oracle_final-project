"use client"

import { useState } from "react"
import { Users, Bed } from "lucide-react"
import { cn } from "@/lib/utils"

export type InfectionType = "Pneumonia" | "UTI" | "Waterborne" | "Tick-borne" | "MDRO" | null

export interface Patient {
  id: string
  name: string
  age: number
  gender: "M" | "F"
  infection: InfectionType
}

export interface BedSlot {
  id: string
  patient: Patient | null
}

export interface Room {
  id: string
  roomNo: string
  capacity: 1 | 2 | 4
  beds: BedSlot[]
  cohortType: InfectionType
}

const infectionColors: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  Pneumonia: { 
    bg: "bg-blue-500/20", 
    border: "border-blue-500", 
    text: "text-blue-400",
    badge: "bg-blue-500 text-white"
  },
  UTI: { 
    bg: "bg-amber-500/20", 
    border: "border-amber-500", 
    text: "text-amber-400",
    badge: "bg-amber-500 text-black"
  },
  Waterborne: { 
    bg: "bg-cyan-500/20", 
    border: "border-cyan-500", 
    text: "text-cyan-400",
    badge: "bg-cyan-500 text-black"
  },
  "Tick-borne": { 
    bg: "bg-rose-500/20", 
    border: "border-rose-500", 
    text: "text-rose-400",
    badge: "bg-rose-500 text-white"
  },
  MDRO: { 
    bg: "bg-purple-500/20", 
    border: "border-purple-500", 
    text: "text-purple-400",
    badge: "bg-purple-500 text-white"
  },
}

interface PatientChipProps {
  patient: Patient
  onDragStart: (patient: Patient) => void
  isDragging: boolean
}

function PatientChip({ patient, onDragStart, isDragging }: PatientChipProps) {
  const colors = patient.infection ? infectionColors[patient.infection] : null
  
  return (
    <div
      draggable
      onDragStart={() => onDragStart(patient)}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-all",
        "border-2 bg-card hover:scale-105",
        colors ? colors.border : "border-border",
        isDragging && "opacity-50 scale-95"
      )}
    >
      <div className={cn(
        "w-2 h-2 rounded-full",
        colors ? colors.badge.split(" ")[0] : "bg-muted-foreground"
      )} />
      <span className="text-sm font-medium text-foreground">{patient.name}</span>
      <span className="text-xs text-muted-foreground">
        {patient.age}{patient.gender === "M" ? "세/남" : "세/여"}
      </span>
    </div>
  )
}

interface BedSlotComponentProps {
  bed: BedSlot
  roomCohort: InfectionType
  onDrop: (bedId: string) => void
  onRemovePatient: (bedId: string) => void
  canDrop: boolean
  isOver: boolean
}

function BedSlotComponent({ 
  bed, 
  roomCohort, 
  onDrop, 
  onRemovePatient, 
  canDrop, 
  isOver 
}: BedSlotComponentProps) {
  const colors = bed.patient?.infection ? infectionColors[bed.patient.infection] : null
  
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        e.currentTarget.dataset.over = "true"
      }}
      onDragLeave={(e) => {
        e.currentTarget.dataset.over = "false"
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.currentTarget.dataset.over = "false"
        onDrop(bed.id)
      }}
      className={cn(
        "relative flex items-center justify-center p-2 rounded-lg border-2 border-dashed transition-all min-h-[60px]",
        bed.patient 
          ? cn("border-solid", colors?.border || "border-border", colors?.bg || "bg-muted/50")
          : cn(
              "border-border bg-muted/30",
              canDrop && "border-success/50 bg-success/10",
              isOver && canDrop && "border-success bg-success/20 scale-105"
            )
      )}
    >
      {bed.patient ? (
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm font-medium text-foreground">{bed.patient.name}</span>
          <span className={cn("text-xs px-2 py-0.5 rounded-full", colors?.badge)}>
            {bed.patient.infection}
          </span>
          <button
            onClick={() => onRemovePatient(bed.id)}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-danger text-danger-foreground text-xs flex items-center justify-center hover:scale-110 transition-transform"
          >
            x
          </button>
        </div>
      ) : (
        <Bed className={cn(
          "h-5 w-5",
          canDrop ? "text-success/50" : "text-muted-foreground/30"
        )} />
      )}
    </div>
  )
}

interface RoomCardProps {
  room: Room
  draggingPatient: Patient | null
  onDropPatient: (roomId: string, bedId: string) => void
  onRemovePatient: (roomId: string, bedId: string) => void
}

function RoomCard({ room, draggingPatient, onDropPatient, onRemovePatient }: RoomCardProps) {
  const [isOver, setIsOver] = useState(false)
  const occupiedCount = room.beds.filter(b => b.patient).length
  const colors = room.cohortType ? infectionColors[room.cohortType] : null
  
  // 같은 감염 타입이거나 빈 방이면 드롭 가능
  const canDrop = draggingPatient && (
    room.cohortType === null || 
    room.cohortType === draggingPatient.infection
  )
  
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={() => setIsOver(false)}
      className={cn(
        "flex flex-col rounded-xl border-2 p-4 transition-all bg-card",
        colors ? colors.border : "border-border",
        isOver && canDrop && "ring-2 ring-success ring-offset-2 ring-offset-background"
      )}
    >
      {/* Room Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground">{room.roomNo}</span>
          {room.cohortType && (
            <span className={cn("text-xs px-2 py-1 rounded-full", colors?.badge)}>
              {room.cohortType}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{occupiedCount}/{room.capacity}</span>
        </div>
      </div>
      
      {/* Beds Grid */}
      <div className={cn(
        "grid gap-2",
        room.capacity === 4 && "grid-cols-2",
        room.capacity === 2 && "grid-cols-2",
        room.capacity === 1 && "grid-cols-1"
      )}>
        {room.beds.map((bed) => (
          <BedSlotComponent
            key={bed.id}
            bed={bed}
            roomCohort={room.cohortType}
            onDrop={(bedId) => onDropPatient(room.id, bedId)}
            onRemovePatient={(bedId) => onRemovePatient(room.id, bedId)}
            canDrop={!!canDrop && !bed.patient}
            isOver={isOver}
          />
        ))}
      </div>
    </div>
  )
}

interface HospitalFloorProps {
  rooms: Room[]
  waitingPatients: Patient[]
  onAssignPatient: (patientId: string, roomId: string, bedId: string) => void
  onRemovePatient: (roomId: string, bedId: string) => void
}

export function HospitalFloor({ 
  rooms, 
  waitingPatients, 
  onAssignPatient, 
  onRemovePatient 
}: HospitalFloorProps) {
  const [draggingPatient, setDraggingPatient] = useState<Patient | null>(null)
  
  const fourBedRooms = rooms.filter(r => r.capacity === 4)
  const twoBedRooms = rooms.filter(r => r.capacity === 2)
  const singleRooms = rooms.filter(r => r.capacity === 1)
  
  const handleDrop = (roomId: string, bedId: string) => {
    if (draggingPatient) {
      onAssignPatient(draggingPatient.id, roomId, bedId)
      setDraggingPatient(null)
    }
  }
  
  // 감염 타입별로 대기 환자 그룹화
  const patientsByInfection = waitingPatients.reduce((acc, patient) => {
    const key = patient.infection || "Unknown"
    if (!acc[key]) acc[key] = []
    acc[key].push(patient)
    return acc
  }, {} as Record<string, Patient[]>)
  
  return (
    <div className="space-y-6">
      {/* Waiting Patients */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-4">
          배정 대기 환자 ({waitingPatients.length}명)
        </h3>
        <div className="space-y-4">
          {Object.entries(patientsByInfection).map(([infection, patients]) => {
            const colors = infectionColors[infection]
            return (
              <div key={infection} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("text-xs px-2 py-1 rounded-full", colors?.badge || "bg-muted text-muted-foreground")}>
                    {infection}
                  </span>
                  <span className="text-xs text-muted-foreground">{patients.length}명</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {patients.map((patient) => (
                    <PatientChip
                      key={patient.id}
                      patient={patient}
                      onDragStart={setDraggingPatient}
                      isDragging={draggingPatient?.id === patient.id}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      
      {/* Room Sections */}
      <div className="space-y-6">
        {/* 4-Bed Rooms */}
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Bed className="h-4 w-4" />
            4인실
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {fourBedRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                draggingPatient={draggingPatient}
                onDropPatient={handleDrop}
                onRemovePatient={onRemovePatient}
              />
            ))}
          </div>
        </section>
        
        {/* 2-Bed Rooms */}
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Bed className="h-4 w-4" />
            2인실
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {twoBedRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                draggingPatient={draggingPatient}
                onDropPatient={handleDrop}
                onRemovePatient={onRemovePatient}
              />
            ))}
          </div>
        </section>
        
        {/* Single Rooms */}
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Bed className="h-4 w-4" />
            1인실
          </h3>
          <div className="grid grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {singleRooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                draggingPatient={draggingPatient}
                onDropPatient={handleDrop}
                onRemovePatient={onRemovePatient}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
