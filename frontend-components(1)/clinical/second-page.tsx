"use client"

import React, { useState, useEffect } from "react"
import {
  Sparkles,
  Heart,
  Droplets,
  Thermometer,
  Activity,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react"
import {
  MDROBedAssignmentPanel,
  SeverityAssessmentPanel,
  FusedAlertList,
  ClusterAlertPanel
} from "@/components/clinical/nlp-components"
import { computeMDROBedAssignment, roomsToIsolationBeds } from "@/lib/bed-assignment-utils"
import { fetchRooms } from "@/lib/api"
import type { IsolationBed, Patient } from "@/lib/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { TransferChecklist } from "@/components/clinical/transfer-checklist"

interface SecondPageProps {
  patient: Patient | null
  patients: Patient[]
  onTransfer: (patientId: string) => void
  onBack: () => void
}

export function SecondPage({ patient, patients, onTransfer, onBack }: SecondPageProps) {
  // Fetch isolation beds from API for MDRO bed assignment
  const [isolationBeds, setIsolationBeds] = useState<IsolationBed[]>([])
  useEffect(() => {
    fetchRooms()
      .then((rooms) => setIsolationBeds(roomsToIsolationBeds(rooms)))
      .catch(() => setIsolationBeds([]))
  }, [])

  if (!patient) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <p className="text-muted-foreground">환자 정보가 없습니다.</p>
      </div>
    )
  }

  const latestVitals = patient.vitals[patient.vitals.length - 1]
  const mapValue = Math.round(((latestVitals?.bloodPressureSystolic ?? 0) + 2 * (latestVitals?.bloodPressureDiastolic ?? 0)) / 3)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-5">
            {/* Back button */}
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              환자 목록으로
            </Button>

            {/* AI-based Patient Status Summary */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 bg-gradient-to-r from-primary/10 to-transparent border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
                    <Sparkles className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-sm text-card-foreground">환자 상태 AI 기반 요약</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="p-3 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm text-foreground leading-relaxed">
                    {patient.aiSummary || `${patient.name} 환자, ${patient.diagnosis} 진단. 현재 활력징후 ${patient.status === "critical" ? "불안정" : patient.status === "warning" ? "주의 필요" : "안정적"}. 패혈증 ${(patient.qsofa ?? 0) >= 2 ? "의심" : "낮음"}, 호흡부전 ${latestVitals?.oxygenSaturation < 92 ? "진행" : "안정"}, MDRO 가능성 ${patient.diagnosis.includes("MDRO") || patient.diagnosis.includes("CRE") ? "있음" : "낮음"}.`}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Key Vitals: SpO2 / MAP / Lactate / NEWS / CRP */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Heart className="h-4 w-4 text-[#ef4444]" />
                  주요 수치
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <VitalCard
                    label="SpO2"
                    value={`${latestVitals?.oxygenSaturation ?? 0}%`}
                    status={(latestVitals?.oxygenSaturation ?? 100) < 92 ? "critical" : (latestVitals?.oxygenSaturation ?? 100) < 95 ? "warning" : "normal"}
                    icon={<Droplets className="h-4 w-4" />}
                  />
                  <VitalCard
                    label="MAP"
                    value={`${mapValue} mmHg`}
                    status={mapValue < 65 ? "critical" : mapValue < 70 ? "warning" : "normal"}
                    icon={<Activity className="h-4 w-4" />}
                  />
                  <VitalCard
                    label="젖산"
                    value={`${patient.lactate ?? "N/A"} mmol/L`}
                    status={(patient.lactate ?? 0) > 4 ? "critical" : (patient.lactate ?? 0) > 2 ? "warning" : "normal"}
                    icon={<Droplets className="h-4 w-4" />}
                  />
                  <VitalCard
                    label="NEWS"
                    value={patient.riskScore > 70 ? "7 (High)" : patient.riskScore > 50 ? "4 (Med)" : "2 (Low)"}
                    status={patient.riskScore > 70 ? "critical" : patient.riskScore > 50 ? "warning" : "normal"}
                    icon={<AlertTriangle className="h-4 w-4" />}
                  />
                  <VitalCard
                    label="CRP"
                    value={`${patient.labResults.find(l => l.name === "CRP")?.value ?? "N/A"} mg/dL`}
                    status={parseFloat(patient.labResults.find(l => l.name === "CRP")?.value ?? "0") > 10 ? "critical" : parseFloat(patient.labResults.find(l => l.name === "CRP")?.value ?? "0") > 3 ? "warning" : "normal"}
                    icon={<Thermometer className="h-4 w-4" />}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Transfer Checklist — new automated engine */}
            <TransferChecklist
              patients={patients}
              initialPatientId={patient.id}
            />

            {/* MDRO Bed Assignment - PRD Section 3.2 */}
            {patient.mdroStatus?.isolationRequired && !patient.mdroStatus?.isolationImplemented && (
              <MDROBedAssignmentPanel
                assignment={computeMDROBedAssignment(
                  patient.id,
                  patient.name,
                  patient.mdroStatus.isolationType || "contact",
                  patient.mdroStatus.mdroType,
                  patient.gender,
                  isolationBeds
                )}
                onAssignBed={(bedId) => {
                  console.log("[v0] Assigning bed:", bedId, "to patient:", patient.id)
                }}
              />
            )}

            {/* Cluster Alert - PRD Section 3.2 */}
            {patient.clusterSuspected && patient.clusterId && (
              <ClusterAlertPanel
                cluster={{
                  id: patient.clusterId,
                  ward: patient.ward || "",
                  detectedAt: "",
                  type: "suspected",
                  patientCount: 0,
                  patients: [],
                  commonFactors: [],
                  riskLevel: "medium",
                  status: "active",
                }}
              />
            )}

            {/* Severity Assessment Panel - PRD Section 3.5 */}
            {patient.severityAssessment && (
              <SeverityAssessmentPanel assessment={patient.severityAssessment} />
            )}

            {/* Fused Alerts - PRD Section 5.2.3 */}
            {patient.fusedAlerts && patient.fusedAlerts.length > 0 && (
              <FusedAlertList alerts={patient.fusedAlerts} />
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  )
}

function VitalCard({
  label,
  value,
  status,
  icon,
}: {
  label: string
  value: string
  status: "normal" | "warning" | "critical"
  icon: React.ReactNode
}) {
  return (
    <div className={cn(
      "p-3 rounded-lg text-center border",
      status === "normal" && "bg-[#10b981]/10 border-[#10b981]/30",
      status === "warning" && "bg-[#f59e0b]/10 border-[#f59e0b]/30",
      status === "critical" && "bg-[#ef4444]/10 border-[#ef4444]/30"
    )}>
      <div className={cn(
        "flex items-center justify-center gap-1 mb-1",
        status === "normal" && "text-[#10b981]",
        status === "warning" && "text-[#f59e0b]",
        status === "critical" && "text-[#ef4444]"
      )}>
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <p className={cn(
        "text-sm font-bold",
        status === "normal" && "text-[#10b981]",
        status === "warning" && "text-[#f59e0b]",
        status === "critical" && "text-[#ef4444]"
      )}>
        {value}
      </p>
    </div>
  )
}
