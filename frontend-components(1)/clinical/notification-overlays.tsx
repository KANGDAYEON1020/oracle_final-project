"use client"

import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, X, ExternalLink, ChevronRight } from "lucide-react"
import { useNotifications } from "@/lib/notification-context"
import { getSeverityConfig } from "@/lib/notification-engine"
import { cn } from "@/lib/utils"

// ─── S3 Critical Toast (top-right, stacked) ───
// Shows one toast at a time for the highest-priority unacknowledged S3
export function CriticalToastOverlay() {
  const [mounted, setMounted] = useState(false)
  const { toastQueue, acknowledge, dismissToast, onNavigateToPatient } = useNotifications()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Show only the first (highest priority) toast
  const toast = toastQueue[0]
  if (!mounted || !toast) return null

  const config = getSeverityConfig("S3")
  const ward = toast.ward && toast.ward !== "-" ? toast.ward : ""
  const room = toast.roomNumber && toast.roomNumber !== "-" ? `${toast.roomNumber}호` : ""
  const location = [ward, room].filter(Boolean).join(" ")

  return (
    <div className="fixed top-16 right-4 z-50 animate-in slide-in-from-right-5 fade-in duration-300">
      <div
        className={cn(
          "w-[360px] rounded-lg border-2 shadow-lg overflow-hidden",
          config.borderClass,
          "bg-card",
        )}
      >
        {/* Red top bar */}
        <div className="h-1 bg-[#ef4444]" />

        <div className="p-3">
          {/* Header: severity label + close */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className="flex items-center justify-center h-5 w-5 rounded-full bg-[#ef4444]">
                <AlertTriangle className="h-3 w-3 text-white" />
              </div>
              <span className="text-[10px] font-bold text-[#ef4444] uppercase tracking-wider">
                {config.label}
              </span>
              {toastQueue.length > 1 && (
                <span className="text-[10px] text-muted-foreground">
                  +{toastQueue.length - 1} more
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Title */}
          <p className="text-sm font-semibold text-foreground">{toast.title}</p>

          {/* Patient info */}
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {toast.patientName} | {location || "위치 정보 없음"}
          </p>

          {/* Evidence */}
          <p className="text-[11px] text-muted-foreground/80 mt-1 leading-relaxed">
            {toast.evidence}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                acknowledge(toast.id)
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#ef4444] text-white text-[11px] font-medium hover:bg-[#dc2626] transition-colors"
            >
              <Check className="h-3 w-3" />
              확인 (Ack)
            </button>
            <button
              type="button"
              onClick={() => {
                onNavigateToPatient?.(toast.patientId)
                acknowledge(toast.id)
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-transparent text-[11px] font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              환자 이동
            </button>
          </div>

          {/* Alarm fatigue prevention hint (informational, no emphasis) */}
          <p className="text-[10px] text-muted-foreground/50 mt-2 leading-relaxed">
            동일 유형의 Critical 알림은 60분 내 반복 울림되지 않습니다.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Header Ticker (below header, full-width) ───
// Scrolling/rotating strip for unacknowledged S3 alerts
export function HeaderTicker() {
  const [mounted, setMounted] = useState(false)
  const { tickerNotifications, setIsPanelOpen } = useNotifications()
  const tickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // No ticker if no unacknowledged S3
  if (!mounted || tickerNotifications.length === 0) return null

  return (
    <div className="flex h-8 items-center border-b border-[#ef4444]/20 bg-[#ef4444]/5 px-4 gap-3 overflow-hidden">
      {/* Left: CRITICAL badge */}
      <div className="flex items-center gap-1.5 shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-[#ef4444]" />
        <span className="text-[10px] font-bold text-[#ef4444] uppercase tracking-wider">
          CRITICAL
        </span>
        <span className="text-[10px] font-bold text-[#ef4444] bg-[#ef4444]/15 rounded-full px-1.5">
          {tickerNotifications.length}
        </span>
      </div>

      {/* Scrolling ticker content */}
      <div className="flex-1 overflow-hidden relative" ref={tickerRef}>
        <div className="flex items-center gap-6 animate-ticker">
          {tickerNotifications.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setIsPanelOpen(true)}
              className="flex items-center gap-2 shrink-0 text-[11px] hover:underline"
            >
              <span className="font-semibold text-foreground">{n.patientName}</span>
              <span className="text-muted-foreground">{n.title}</span>
              <span className="text-muted-foreground/60">|</span>
              <span className="text-muted-foreground/80 truncate max-w-[200px]">
                {n.evidence}
              </span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
          {/* Duplicate for seamless loop */}
          {tickerNotifications.length > 0 &&
            tickerNotifications.map((n) => (
              <button
                key={`dup-${n.id}`}
                type="button"
                onClick={() => setIsPanelOpen(true)}
                className="flex items-center gap-2 shrink-0 text-[11px] hover:underline"
              >
                <span className="font-semibold text-foreground">{n.patientName}</span>
                <span className="text-muted-foreground">{n.title}</span>
                <span className="text-muted-foreground/60">|</span>
                <span className="text-muted-foreground/80 truncate max-w-[200px]">
                  {n.evidence}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
        </div>
      </div>

      {/* Right: View all */}
      <button
        type="button"
        onClick={() => setIsPanelOpen(true)}
        className="text-[10px] font-medium text-[#ef4444] hover:underline shrink-0"
      >
        전체 보기
      </button>
    </div>
  )
}
