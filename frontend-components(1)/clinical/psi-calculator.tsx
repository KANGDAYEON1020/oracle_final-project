"use client"

import { useMemo } from "react"
import { Calculator, AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { calculatePSI, psiFactors } from "@/lib/psi-calculator"
import type { PSIData } from "@/lib/types"

interface PSICalculatorProps {
  psiData: PSIData
}

export function PSICalculator({ psiData }: PSICalculatorProps) {
  const result = useMemo(() => calculatePSI(psiData), [psiData])

  const getRiskClassColor = (riskClass: string) => {
    switch (riskClass) {
      case "I":
      case "II":
        return "text-primary bg-primary/10 border-primary/30"
      case "III":
        return "text-warning bg-warning/10 border-warning/30"
      case "IV":
      case "V":
        return "text-destructive bg-destructive/10 border-destructive/30"
      default:
        return "text-muted-foreground bg-muted border-border"
    }
  }

  const getRiskIcon = (riskClass: string) => {
    switch (riskClass) {
      case "I":
      case "II":
        return <CheckCircle2 className="h-5 w-5 text-primary" />
      case "III":
        return <AlertCircle className="h-5 w-5 text-warning" />
      case "IV":
      case "V":
        return <AlertTriangle className="h-5 w-5 text-destructive" />
      default:
        return null
    }
  }

  const activeFactors = useMemo(() => {
    return psiFactors.filter((factor) => {
      const key = factor.key as keyof PSIData
      if (key === "age") return true
      if (key === "sex") return psiData.sex === "F"
      return psiData[key] === true
    })
  }, [psiData])

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm text-card-foreground">PSI/PORT Score</CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px]">
            폐렴 중증도 지수
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Score Display */}
        <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/50 p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold text-foreground">{result.score}</span>
              <span className="text-sm text-muted-foreground">점</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">예상 사망률: {result.mortality}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge className={cn("px-3 py-1 text-sm font-semibold", getRiskClassColor(result.riskClass))}>
              Class {result.riskClass}
            </Badge>
            <div className="flex items-center gap-1.5">
              {getRiskIcon(result.riskClass)}
              <span className="text-xs text-muted-foreground">{result.disposition}</span>
            </div>
          </div>
        </div>

        {/* Risk Bar */}
        <div className="mb-4">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>저위험</span>
            <span>고위험</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden flex">
            <div className="h-full bg-primary w-1/5" />
            <div className="h-full bg-primary/70 w-1/5" />
            <div className="h-full bg-warning w-1/5" />
            <div className="h-full bg-destructive/70 w-1/5" />
            <div className="h-full bg-destructive w-1/5" />
          </div>
          <div className="relative h-4 mt-1">
            <div
              className="absolute -translate-x-1/2 transition-all"
              style={{ left: `${Math.min((result.score / 180) * 100, 100)}%` }}
            >
              <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-b-[6px] border-transparent border-b-foreground" />
            </div>
          </div>
        </div>

        {/* Recommendation */}
        <div className={cn(
          "p-3 rounded-lg border text-sm",
          result.riskClass === "I" || result.riskClass === "II"
            ? "bg-primary/5 border-primary/20 text-foreground"
            : result.riskClass === "III"
            ? "bg-warning/5 border-warning/20 text-foreground"
            : "bg-destructive/5 border-destructive/20 text-foreground"
        )}>
          {result.recommendation}
        </div>

        {/* Active Factors */}
        <div className="mt-4">
          <p className="text-xs text-muted-foreground mb-2">적용된 위험 요소</p>
          <div className="flex flex-wrap gap-1.5">
            {activeFactors.map((factor) => (
              <Badge
                key={factor.key}
                variant="outline"
                className="text-[10px] bg-muted/30"
              >
                {factor.label}
                <span className="ml-1 text-muted-foreground">{factor.points}</span>
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
