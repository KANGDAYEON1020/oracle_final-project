"use client"

import { useState } from "react"
import { Sparkles, RefreshCw, Copy, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface AISummaryProps {
  summary: string
  patientName: string
}

export function AISummary({ summary, patientName }: AISummaryProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => setIsRefreshing(false), 1500)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-2 bg-gradient-to-r from-primary/10 to-transparent border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm text-card-foreground">AI 상태 요약</CardTitle>
              <p className="text-[10px] text-muted-foreground">LLM 기반 환자 상태 분석</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-primary" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn(
                "h-3.5 w-3.5 text-muted-foreground",
                isRefreshing && "animate-spin"
              )} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        <p className={cn(
          "text-sm leading-relaxed text-foreground/90",
          isRefreshing && "animate-pulse opacity-50"
        )}>
          {summary}
        </p>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            실시간 분석
          </span>
          <span>|</span>
          <span>마지막 업데이트: 방금 전</span>
        </div>
      </CardContent>
    </Card>
  )
}
