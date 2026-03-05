"use client"

import { useState } from "react"
import { Search, AlertTriangle, AlertCircle, CheckCircle2, ArrowRightCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { Patient } from "@/lib/types"

interface PatientListProps {
  patients: Patient[]
  selectedPatient: Patient | null
  onPatientSelect: (patient: Patient) => void
}

const statusConfig = {
  stable: {
    icon: CheckCircle2,
    color: "text-success",
    bgColor: "bg-success/10",
    label: "안정",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-warning",
    bgColor: "bg-warning/10",
    label: "주의",
  },
  critical: {
    icon: AlertCircle,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    label: "위험",
  },
  transferred: {
    icon: ArrowRightCircle,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    label: "전원완료",
  },
}

export function PatientList({ patients, selectedPatient, onPatientSelect }: PatientListProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredPatients = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.roomNumber.includes(searchQuery) ||
      p.diagnosis.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const sortedPatients = [...filteredPatients].sort((a, b) => {
    const statusOrder = { critical: 0, warning: 1, stable: 2, transferred: 3 }
    return statusOrder[a.status] - statusOrder[b.status]
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="환자 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-input"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border px-4 pb-2">
        <span className="text-sm font-medium text-foreground">환자 목록</span>
        <span className="text-xs text-muted-foreground">{sortedPatients.length}명</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {sortedPatients.map((patient) => {
            const status = statusConfig[patient.status]
            const StatusIcon = status.icon
            const isSelected = selectedPatient?.id === patient.id

            return (
              <button
                key={patient.id}
                type="button"
                onClick={() => onPatientSelect(patient)}
                className={cn(
                  "mb-1 w-full rounded-lg p-3 text-left transition-colors",
                  isSelected
                    ? "bg-sidebar-accent border border-primary/30"
                    : "hover:bg-sidebar-accent/50"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sidebar-foreground">{patient.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {patient.age}세 / {patient.gender === "M" ? "남" : "여"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{patient.roomNumber}호</div>
                    <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {patient.diagnosis}
                    </div>
                  </div>
                  <div className={cn("flex flex-col items-end gap-1")}>
                    <div className={cn("rounded-full p-1", status.bgColor)}>
                      <StatusIcon className={cn("h-4 w-4", status.color)} />
                    </div>
                    <span className={cn("text-[10px]", status.color)}>{status.label}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Risk Score</span>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full transition-all", {
                          "bg-success": patient.riskScore < 50,
                          "bg-warning": patient.riskScore >= 50 && patient.riskScore < 75,
                          "bg-destructive": patient.riskScore >= 75,
                        })}
                        style={{ width: `${patient.riskScore}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium text-foreground">
                      {patient.riskScore}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
