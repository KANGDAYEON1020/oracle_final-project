"use client"

import { useRouter } from "next/navigation"
import {
  Calendar,
  User,
  MapPin,
  ClipboardCheck,
  ActivitySquare,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { VitalsChart } from "@/components/clinical/vitals-chart"
import { AISummary } from "@/components/clinical/ai-summary"
import { PSICalculator } from "@/components/clinical/psi-calculator"
import { ClinicalDataTabs } from "@/components/clinical/clinical-data-tabs"
import {
  DocumentComparisonPanel,
  NLPTimeline,
  NLPTagBadge
} from "@/components/clinical/nlp-components"
import type { Patient } from "@/lib/types"

interface PatientDetailProps {
  patient: Patient | null
  onChecklistUpdate: (patientId: string, checklistId: string, checked: boolean) => void
  onTransfer: (patientId: string) => void
}

export function PatientDetail({ patient }: PatientDetailProps) {
  const router = useRouter()

  if (!patient) {
    return (
      <main className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <User className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-2">환자를 선택하세요</p>
        </div>
      </main>
    )
  }

  if (patient.status === "transferred") {
    return (
      <main className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <ClipboardCheck className="mx-auto h-12 w-12 opacity-50" />
          <p className="mt-2 text-lg font-medium">{patient.name} 환자</p>
          <p className="mt-1">전원이 완료되었습니다</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-6 space-y-6">
          {/* Patient Info Header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">{patient.name}</h2>
              <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {patient.age}세 · {patient.gender === "M" ? "남" : "여"}
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {patient.roomNumber}호
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  입원: {patient.admissionDate}
                </span>
              </div>
              <p className="mt-1 text-sm text-foreground">{patient.diagnosis}</p>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "text-xs",
                patient.status === "stable" && "border-emerald-500/50 text-emerald-400 bg-emerald-500/10",
                patient.status === "warning" && "border-amber-500/50 text-amber-400 bg-amber-500/10",
                patient.status === "critical" && "border-red-500/50 text-red-400 bg-red-500/10"
              )}
            >
              {patient.status === "stable" ? "안정" : patient.status === "warning" ? "주의" : "위험"}
            </Badge>
          </div>

          {/* AI Summary */}
          <AISummary summary={patient.aiSummary} patientName={patient.name} />

          {/* NLP Alert Tags */}
          {patient.nlpAlertTags && patient.nlpAlertTags.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {patient.nlpAlertTags.map((tag, i) => (
                <NLPTagBadge key={i} tag={tag} />
              ))}
            </div>
          )}

          {/* Document Comparison */}
          {patient.documentComparison && (
            <DocumentComparisonPanel comparison={patient.documentComparison} />
          )}

          {/* Clinical Data Tabs */}
          <ClinicalDataTabs
            vitals={patient.vitals}
            labResults={patient.labResults}
            imagingResults={patient.imagingResults}
            cultureResults={patient.cultureResults}
          />

          {/* NLP Timeline */}
          {patient.timeline && patient.timeline.length > 0 && (
            <NLPTimeline events={patient.timeline} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Vitals Chart */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-card-foreground">활력징후</CardTitle>
              </CardHeader>
              <CardContent>
                <VitalsChart vitals={patient.vitals} />
              </CardContent>
            </Card>

            {/* PSI Calculator */}
            <PSICalculator psiData={patient.psiData} />
          </div>

          {/* Patient Explain — 임상 변화 분석 화면 */}
          <Card className="bg-card border-border">
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                    <ActivitySquare className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">임상 변화 분석</p>
                    <p className="text-xs text-muted-foreground">NLP 기반 72h 이벤트 · 근거 문서 뷰어</p>
                  </div>
                </div>
                <Button
                  onClick={() => router.push(`/patients/${patient.id}`)}
                  variant="outline"
                  className="border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                >
                  <ActivitySquare className="mr-2 h-4 w-4" />
                  변화 분석 열기
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Transfer Checklist — Navigate to dedicated page */}
          <Card className="bg-card border-border">
            <CardContent className="py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">전원 체크리스트</p>
                    <p className="text-xs text-muted-foreground">환자 전원 전 안정성 · 자원 평가</p>
                  </div>
                </div>
                <Button
                  onClick={() => router.push(`/transfer-checklist?patientId=${patient.id}`)}
                  className="bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white"
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  전원 체크리스트 열기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </main>
  )
}
