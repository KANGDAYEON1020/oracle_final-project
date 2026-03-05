"use client"

import { useState, useMemo } from "react"
import {
  Bell,
  X,
  Check,
  Clock,
  ExternalLink,
  ShieldAlert,
  Stethoscope,
  Activity,
  FileText,
  AlertTriangle,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useNotifications } from "@/lib/notification-context"
import {
  type AlarmSeverity,
  type Notification,
  type NotificationType,
  getSeverityConfig,
} from "@/lib/notification-engine"
import { cn } from "@/lib/utils"

// Icon map for notification types
function getTypeIcon(type: NotificationType) {
  switch (type) {
    case "isolation":
    case "isolation_required":
      return ShieldAlert
    case "deterioration":
      return Activity
    case "pending_result":
      return FileText
    case "care_gap":
      return AlertTriangle
    case "cluster":
      return Users
    case "plan_created":
    case "confirmation_needed":
    case "exception_needed":
    case "committed":
      return FileText
    case "icu_escalation":
      return AlertTriangle
    case "sepsis_critical":
    case "sepsis_rising":
      return Activity
    case "mdro_suspected":
      return ShieldAlert
    case "infection_change":
      return Stethoscope
    case "action_needed":
      return Stethoscope
    case "document_log":
    case "system_notice":
    case "unknown":
      return FileText
  }
}

// Time formatting
function formatTimeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "방금"
  if (mins < 60) return `${mins}분 전`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}시간 전`
  return `${Math.floor(hrs / 24)}일 전`
}

function formatSnoozeUntil(isoStr?: string): string {
  if (!isoStr) return "Snoozed"
  const date = new Date(isoStr)
  if (Number.isNaN(date.getTime())) return "Snoozed"
  return `${date.toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  })} ${date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}까지 Snoozed`
}

const TABS: { key: AlarmSeverity | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "S3", label: "Critical" },
  { key: "S2", label: "Action" },
  { key: "S1", label: "Info" },
]

const TYPE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "전체" },
  { key: "isolation", label: "격리" },
  { key: "deterioration", label: "악화" },
  { key: "pending_result", label: "결과대기" },
  { key: "care_gap", label: "운영조치" },
  { key: "cluster", label: "클러스터" },
]

function NotificationItem({
  notification,
  onAck,
  onSnooze,
  onNavigate,
}: {
  notification: Notification
  onAck: () => void
  onSnooze: (minutes: number) => void
  onNavigate: () => void
}) {
  const config = getSeverityConfig(notification.severity)
  const TypeIcon = getTypeIcon(notification.type)
  const isSnoozed = Boolean(notification.isSnoozed)
  const ward = notification.ward && notification.ward !== "-" ? notification.ward : ""
  const room = notification.roomNumber && notification.roomNumber !== "-" ? `${notification.roomNumber}호` : ""
  const location = [ward, room].filter(Boolean).join(" ")

  return (
    <div
      className={cn(
        "px-3 py-2.5 border-b border-border last:border-b-0 transition-colors",
        notification.severity === "S3" && !notification.acknowledged && "bg-[#ef4444]/5",
        isSnoozed && "opacity-50",
      )}
    >
      {/* Row 1: Severity dot + Title + Time */}
      <div className="flex items-start gap-2">
        <div
          className={cn("mt-1 h-2 w-2 rounded-full shrink-0", config.dotClass)}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <TypeIcon className={cn("h-3.5 w-3.5 shrink-0", config.textClass)} />
              <span className="text-xs font-semibold text-foreground truncate">
                {notification.title}
              </span>
              {notification.dedupCount > 1 && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 bg-transparent border-muted-foreground/30 text-muted-foreground"
                >
                  x{notification.dedupCount}
                </Badge>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatTimeAgo(notification.createdAt)}
            </span>
          </div>

          {/* Row 2: Patient + Room */}
          <div className="flex items-center gap-1 mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">{notification.patientName}</span>
            <span>|</span>
            <span>{location || "위치 정보 없음"}</span>
          </div>

          {/* Row 3: Evidence line */}
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed line-clamp-2">
            {notification.evidence}
          </p>

          {/* Row 4: Actions */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <button
              type="button"
              onClick={onNavigate}
              className="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              환자 이동
            </button>

            {notification.severity === "S3" && !notification.acknowledged && (
              <button
                type="button"
                onClick={onAck}
                className="flex items-center gap-0.5 text-[10px] font-medium text-[#ef4444] hover:underline ml-2"
              >
                <Check className="h-3 w-3" />
                확인(Ack)
              </button>
            )}

            {notification.severity === "S3" && notification.acknowledged && !isSnoozed && (
              <button
                type="button"
                onClick={() => onSnooze(30)}
                className="flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:underline ml-2"
              >
                <Clock className="h-3 w-3" />
                30분 Snooze
              </button>
            )}

            {isSnoozed && (
              <span className="text-[10px] text-muted-foreground/50 ml-2 flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {formatSnoozeUntil(notification.snoozedUntil)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function NotificationBellPanel() {
  const {
    notifications,
    s3Count,
    s2Count,
    s1Count,
    totalCount,
    activeTab,
    setActiveTab,
    acknowledge,
    snooze,
    isPanelOpen,
    setIsPanelOpen,
    onNavigateToPatient,
  } = useNotifications()

  const [typeFilter, setTypeFilter] = useState<string>("all")

  const filteredNotifications = useMemo(() => {
    let result = notifications
    if (activeTab !== "all") {
      result = result.filter((n) => n.severity === activeTab)
    }
    if (typeFilter !== "all") {
      result = result.filter((n) => n.type === typeFilter)
    }
    return result
  }, [notifications, activeTab, typeFilter])

  const tabCounts: Record<string, number> = {
    all: totalCount,
    S3: s3Count,
    S2: s2Count,
    S1: s1Count,
  }

  const handleNavigate = (patientId: string) => {
    onNavigateToPatient?.(patientId)
    setIsPanelOpen(false)
  }

  return (
    <Popover open={isPanelOpen} onOpenChange={setIsPanelOpen}>
      <PopoverTrigger asChild aria-controls="notification-bell-content">
        <Button id="notification-bell-trigger" variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalCount > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                s3Count > 0 ? "bg-[#ef4444] animate-pulse" : "bg-[#f59e0b]",
              )}
            >
              {totalCount > 99 ? "99+" : totalCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id="notification-bell-content"
        align="end"
        className="w-[400px] p-0 shadow-lg"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-foreground" />
            <h3 className="text-sm font-semibold text-foreground">알림</h3>
          </div>
          <button
            type="button"
            onClick={() => setIsPanelOpen(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs: Critical / Action / Info */}
        <div className="flex border-b border-border">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key
            const count = tabCounts[tab.key] ?? 0
            const tabConfig =
              tab.key !== "all" ? getSeverityConfig(tab.key as AlarmSeverity) : null
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key as AlarmSeverity | "all")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium border-b-2 transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "text-[9px] font-bold rounded-full px-1.5 min-w-[16px] text-center",
                      isActive && tabConfig
                        ? `${tabConfig.bgMutedClass} ${tabConfig.textClass}`
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Type filter chips (optional) */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground mr-1">필터:</span>
          {TYPE_FILTERS.map((tf) => (
            <button
              key={tf.key}
              type="button"
              onClick={() => setTypeFilter(tf.key)}
              className={cn(
                "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                typeFilter === tf.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/50",
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Notification list */}
        <ScrollArea className="h-[360px]">
          {filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">알림이 없습니다</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                새로운 이벤트 발생 시 여기에 표시됩니다
              </p>
            </div>
          ) : (
            filteredNotifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onAck={() => acknowledge(n.id)}
                onSnooze={(mins) => snooze(n.id, mins)}
                onNavigate={() => handleNavigate(n.patientId)}
              />
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
