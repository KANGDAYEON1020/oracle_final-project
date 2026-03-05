"use client"

import { useMemo } from "react"
import {
  Activity,
  FlaskConical,
  FileImage,
  Bug,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { VitalSign, LabResult, ImagingResult, CultureResult } from "@/lib/types"

interface ClinicalDataTabsProps {
  vitals: VitalSign[]
  labResults: LabResult[]
  imagingResults: ImagingResult[]
  cultureResults: CultureResult[]
}

export function ClinicalDataTabs({
  vitals,
  labResults,
  imagingResults,
  cultureResults,
}: ClinicalDataTabsProps) {
  const latestVitals = vitals[vitals.length - 1]

  const labByCategory = useMemo(() => {
    return labResults.reduce(
      (acc, lab) => {
        if (!acc[lab.category]) acc[lab.category] = []
        acc[lab.category].push(lab)
        return acc
      },
      {} as Record<string, LabResult[]>
    )
  }, [labResults])

  const getStatusColor = (status: string) => {
    switch (status) {
      case "high":
        return "text-destructive"
      case "low":
        return "text-warning"
      case "critical":
        return "text-destructive font-semibold"
      default:
        return "text-foreground"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "high":
      case "critical":
        return <TrendingUp className="h-3 w-3 text-destructive" />
      case "low":
        return <TrendingDown className="h-3 w-3 text-warning" />
      default:
        return <Minus className="h-3 w-3 text-muted-foreground" />
    }
  }

  return (
    <Tabs defaultValue="vitals" className="w-full">
      <TabsList className="w-full grid grid-cols-4 bg-muted/50">
        <TabsTrigger value="vitals" className="text-xs gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          VITAL
        </TabsTrigger>
        <TabsTrigger value="lab" className="text-xs gap-1.5">
          <FlaskConical className="h-3.5 w-3.5" />
          LAB
        </TabsTrigger>
        <TabsTrigger value="imaging" className="text-xs gap-1.5">
          <FileImage className="h-3.5 w-3.5" />
          영상
        </TabsTrigger>
        <TabsTrigger value="culture" className="text-xs gap-1.5">
          <Bug className="h-3.5 w-3.5" />
          배양
        </TabsTrigger>
      </TabsList>

      {/* Vitals Tab */}
      <TabsContent value="vitals" className="mt-3">
        <div className="grid grid-cols-3 gap-3">
          <VitalItem
            label="체온"
            value={latestVitals?.temperature.toFixed(1) ?? "-"}
            unit="°C"
            normal="36.1-37.2"
            status={
              latestVitals?.temperature > 37.5
                ? "high"
                : latestVitals?.temperature < 36
                ? "low"
                : "normal"
            }
          />
          <VitalItem
            label="혈압"
            value={`${latestVitals?.bloodPressureSystolic ?? "-"}/${latestVitals?.bloodPressureDiastolic ?? "-"}`}
            unit="mmHg"
            normal="90-140/60-90"
            status={
              (latestVitals?.bloodPressureSystolic ?? 120) < 90
                ? "critical"
                : (latestVitals?.bloodPressureSystolic ?? 120) > 140
                ? "high"
                : "normal"
            }
          />
          <VitalItem
            label="심박수"
            value={latestVitals?.heartRate ?? "-"}
            unit="bpm"
            normal="60-100"
            status={
              (latestVitals?.heartRate ?? 80) > 100
                ? "high"
                : (latestVitals?.heartRate ?? 80) < 60
                ? "low"
                : "normal"
            }
          />
          <VitalItem
            label="SpO2"
            value={latestVitals?.oxygenSaturation ?? "-"}
            unit="%"
            normal="≥95"
            status={(latestVitals?.oxygenSaturation ?? 98) < 95 ? "critical" : "normal"}
          />
          <VitalItem
            label="호흡수"
            value={latestVitals?.respiratoryRate ?? "-"}
            unit="/분"
            normal="12-20"
            status={
              (latestVitals?.respiratoryRate ?? 16) > 20
                ? "high"
                : (latestVitals?.respiratoryRate ?? 16) < 12
                ? "low"
                : "normal"
            }
          />
          <VitalItem
            label="측정시간"
            value={
              latestVitals
                ? new Date(latestVitals.timestamp).toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "-"
            }
            unit=""
            normal=""
            status="normal"
            isTime
          />
        </div>
      </TabsContent>

      {/* Lab Tab */}
      <TabsContent value="lab" className="mt-3">
        <div className="space-y-4 max-h-[280px] overflow-y-auto pr-1">
          {Object.entries(labByCategory).map(([category, labs]) => (
            <div key={category}>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">{category}</h4>
              <div className="space-y-1.5">
                {labs.map((lab) => (
                  <div
                    key={lab.id}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-lg bg-muted/30",
                      lab.status === "critical" && "bg-destructive/10 border border-destructive/20"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(lab.status)}
                      <span className="text-sm text-foreground">{lab.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn("text-sm font-medium", getStatusColor(lab.status))}>
                        {lab.value}
                        <span className="text-xs text-muted-foreground ml-1">{lab.unit}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground w-20 text-right">
                        ({lab.normalRange})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      {/* Imaging Tab */}
      <TabsContent value="imaging" className="mt-3">
        <div className="space-y-3">
          {imagingResults.map((img) => (
            <Card key={img.id} className="bg-muted/30 border-border">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileImage className="h-4 w-4 text-primary" />
                    {img.type}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        img.status === "abnormal"
                          ? "border-destructive/50 text-destructive"
                          : "border-primary/50 text-primary"
                      )}
                    >
                      {img.status === "abnormal" ? "이상 소견" : "정상"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{img.date}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">소견</p>
                  <p className="text-xs text-foreground leading-relaxed">{img.findings}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">판독</p>
                  <p className={cn(
                    "text-xs font-medium",
                    img.status === "abnormal" ? "text-destructive" : "text-primary"
                  )}>
                    {img.impression}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </TabsContent>

      {/* Culture Tab */}
      <TabsContent value="culture" className="mt-3">
        <div className="space-y-3">
          {cultureResults.map((culture) => (
            <Card key={culture.id} className="bg-muted/30 border-border">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Bug className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium text-foreground">{culture.specimen}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{culture.date}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      culture.result === "positive"
                        ? "border-destructive/50 text-destructive"
                        : culture.result === "pending"
                        ? "border-warning/50 text-warning"
                        : "border-primary/50 text-primary"
                    )}
                  >
                    {culture.result === "positive"
                      ? "양성"
                      : culture.result === "pending"
                      ? "대기중"
                      : "음성"}
                  </Badge>
                </div>
                <div className="mt-2">
                  <p className="text-xs text-foreground">{culture.organism}</p>
                  {culture.sensitivity && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {culture.sensitivity.map((s) => (
                        <Badge key={s} variant="secondary" className="text-[10px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </TabsContent>
    </Tabs>
  )
}

function VitalItem({
  label,
  value,
  unit,
  normal,
  status,
  isTime = false,
}: {
  label: string
  value: string | number
  unit: string
  normal: string
  status: "normal" | "high" | "low" | "critical"
  isTime?: boolean
}) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg bg-muted/30",
        status === "critical" && "bg-destructive/10 border border-destructive/30",
        status === "high" && "bg-destructive/5 border border-destructive/20",
        status === "low" && "bg-warning/5 border border-warning/20"
      )}
    >
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={cn(
            "text-lg font-semibold",
            status === "normal" && "text-foreground",
            status === "high" && "text-destructive",
            status === "low" && "text-warning",
            status === "critical" && "text-destructive"
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {!isTime && normal && (
        <p className="text-[10px] text-muted-foreground mt-1">정상: {normal}</p>
      )}
    </div>
  )
}
