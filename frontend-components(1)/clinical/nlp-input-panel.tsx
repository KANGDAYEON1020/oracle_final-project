"use client"

import { useState } from "react"
import { Sparkles, Send, AlertTriangle, Activity, Droplets, Heart, Thermometer } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Patient } from "@/lib/types"

interface NLPInputPanelProps {
  patient: Patient | null
}

interface AnalyzedCondition {
  label: string
  severity: "normal" | "warning" | "critical"
  icon: typeof Activity
}

export function NLPInputPanel({ patient }: NLPInputPanelProps) {
  const [inputText, setInputText] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzedConditions, setAnalyzedConditions] = useState<AnalyzedCondition[]>([])
  const [aiResponse, setAIResponse] = useState("")

  const handleAnalyze = () => {
    if (!inputText.trim()) return
    
    setIsAnalyzing(true)
    
    // Simulate AI analysis
    setTimeout(() => {
      // Extract conditions from text (simulated NLP)
      const conditions: AnalyzedCondition[] = []
      
      if (inputText.includes("산소") || inputText.includes("SpO2") || inputText.includes("호흡")) {
        conditions.push({ label: "산소포화도 저하", severity: "critical", icon: Activity })
      }
      if (inputText.includes("혈압") || inputText.includes("저혈압")) {
        conditions.push({ label: "혈압 불안정", severity: "warning", icon: Droplets })
      }
      if (inputText.includes("심박") || inputText.includes("빈맥")) {
        conditions.push({ label: "심박수 이상", severity: "warning", icon: Heart })
      }
      if (inputText.includes("열") || inputText.includes("발열")) {
        conditions.push({ label: "발열", severity: "warning", icon: Thermometer })
      }
      if (inputText.includes("의식") || inputText.includes("반응")) {
        conditions.push({ label: "의식 변화", severity: "critical", icon: AlertTriangle })
      }

      // Default conditions if nothing specific detected
      if (conditions.length === 0) {
        conditions.push({ label: "호흡 상태", severity: "warning", icon: Activity })
        conditions.push({ label: "전신 상태", severity: "warning", icon: Heart })
      }

      setAnalyzedConditions(conditions)

      // Generate AI response
      const hasCritical = conditions.some(c => c.severity === "critical")
      if (hasCritical) {
        setAIResponse(`[전원 권고] ${patient?.name || '환자'}의 현재 상태는 중증으로 판단됩니다. 입력하신 내용에서 ${conditions.map(c => c.label).join(", ")} 등의 문제가 감지되었습니다. 상급병원으로의 전원을 적극 고려하시기 바랍니다.`)
      } else {
        setAIResponse(`${patient?.name || '환자'}의 상태를 분석한 결과, ${conditions.map(c => c.label).join(", ")} 등의 소견이 관찰됩니다. 현재 상태를 지속적으로 모니터링하면서 필요시 전원 여부를 재검토하시기 바랍니다.`)
      }

      setIsAnalyzing(false)
    }, 1500)
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-sm text-card-foreground">AI 상태 입력</CardTitle>
            <p className="text-[10px] text-muted-foreground">환자 상태를 자연어로 입력하세요</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            placeholder="예: 환자 검진 시 SpO2가 90%로 저하되어 있고, 호흡이 빠르며 의식이 약간 혼미한 상태입니다..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="min-h-[100px] resize-none bg-input"
          />
          <Button 
            onClick={handleAnalyze} 
            disabled={!inputText.trim() || isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? (
              <>
                <Sparkles className="mr-2 h-4 w-4 animate-spin" />
                분석 중...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                AI 분석 요청
              </>
            )}
          </Button>
        </div>

        {/* Analyzed Conditions Visualization */}
        {analyzedConditions.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground">감지된 상태</h4>
            <div className="flex flex-wrap gap-2">
              {analyzedConditions.map((condition, index) => {
                const Icon = condition.icon
                return (
                  <Badge
                    key={index}
                    variant="outline"
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5",
                      condition.severity === "critical" && "border-destructive/50 bg-destructive/10 text-destructive",
                      condition.severity === "warning" && "border-warning/50 bg-warning/10 text-warning",
                      condition.severity === "normal" && "border-primary/50 bg-primary/10 text-primary"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {condition.label}
                  </Badge>
                )
              })}
            </div>
          </div>
        )}

        {/* AI Response */}
        {aiResponse && (
          <div className={cn(
            "rounded-lg p-4",
            aiResponse.includes("전원 권고") 
              ? "bg-destructive/10 border border-destructive/30" 
              : "bg-muted/50 border border-border"
          )}>
            <div className="flex items-start gap-2">
              {aiResponse.includes("전원 권고") && (
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              )}
              <p className={cn(
                "text-sm leading-relaxed",
                aiResponse.includes("전원 권고") ? "text-destructive" : "text-foreground"
              )}>
                {aiResponse}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
