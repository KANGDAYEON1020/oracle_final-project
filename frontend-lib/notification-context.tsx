"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react"
import type { Patient } from "@/lib/types"
import {
  type AlertStatus,
  type AlertApiItem,
  type Notification,
  type AlarmSeverity,
  buildNotificationsFromDbAlerts,
} from "@/lib/notification-engine"
import { useDemoClock } from "@/lib/demo-clock-context"
import { type DemoQueryParams, appendDemoParams, buildPathWithQuery } from "@/lib/demo-query"

interface NotificationContextValue {
  notifications: Notification[]
  // Counts
  totalCount: number
  s3Count: number
  s2Count: number
  s1Count: number
  unacknowledgedS3: Notification[]
  // Actions
  acknowledge: (notifId: string) => void
  snooze: (notifId: string, minutes: number) => void
  dismissS1: (notifId: string) => void
  // Active tab filter
  activeTab: AlarmSeverity | "all"
  setActiveTab: (tab: AlarmSeverity | "all") => void
  // Bell panel open state
  isPanelOpen: boolean
  setIsPanelOpen: (open: boolean) => void
  // S3 Toast queue
  toastQueue: Notification[]
  dismissToast: (notifId: string) => void
  // Ticker
  tickerNotifications: Notification[]
  // Navigate to patient
  onNavigateToPatient?: (patientId: string) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const ALERTS_REFRESH_MS = 30000
const DEFAULT_LIMIT = 200
const DEFAULT_STATUSES: AlertStatus[] = ["ACTIVE", "ACKNOWLEDGED"]
const ALERTS_PROXY_BASE = "/api"

function normalizeApiBase(base?: string): string {
  const resolved = (base && base.trim()) || "/api"
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved
}

const API_BASE_URL = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL)

function buildAlertsBases(): string[] {
  return Array.from(new Set([ALERTS_PROXY_BASE, API_BASE_URL]))
}

function parseAlertId(notifId: string, notifications: Notification[]): number | null {
  const direct = notifications.find((notification) => notification.id === notifId)
  if (direct?.alertId && Number.isInteger(direct.alertId)) return direct.alertId

  const match = /^notif-(\d+)$/.exec(notifId)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isInteger(parsed) ? parsed : null
}

async function fetchAlerts(
  statuses: AlertStatus[] = DEFAULT_STATUSES,
  limit = DEFAULT_LIMIT,
  demo?: DemoQueryParams,
): Promise<AlertApiItem[]> {
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : DEFAULT_LIMIT
  const params = new URLSearchParams()
  params.set("status", statuses.join(","))
  params.set("limit", String(normalizedLimit))
  appendDemoParams(params, demo)

  let lastError: unknown = null
  for (const base of buildAlertsBases()) {
    const url = buildPathWithQuery(`${base}/alerts`, params)
    try {
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) {
        throw new Error(`Failed to fetch alerts: ${response.status}`)
      }
      const payload = (await response.json()) as { data?: AlertApiItem[] }
      return Array.isArray(payload?.data) ? payload.data : []
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch alerts")
}

async function mutateAlert(
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, unknown> | null,
  demo?: DemoQueryParams,
): Promise<void> {
  const params = new URLSearchParams()
  appendDemoParams(params, demo)

  let lastError: unknown = null
  for (const base of buildAlertsBases()) {
    const url = buildPathWithQuery(`${base}${path}`, params)
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        throw new Error(`Failed to ${method} ${path}: ${response.status} ${errorText}`)
      }
      return
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to ${method} ${path}`)
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx)
    throw new Error("useNotifications must be used within NotificationProvider")
  return ctx
}

interface NotificationProviderProps {
  children: ReactNode
  patients: Patient[]
  onNavigateToPatient?: (patientId: string) => void
}

export function NotificationProvider({
  children,
  patients,
  onNavigateToPatient,
}: NotificationProviderProps) {
  const { demoStep, demoShift } = useDemoClock()
  const [dbAlerts, setDbAlerts] = useState<AlertApiItem[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<AlarmSeverity | "all">("all")
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [toastDismissed, setToastDismissed] = useState<Set<string>>(new Set())

  const refreshAlerts = useCallback(async () => {
    const alerts = await fetchAlerts(DEFAULT_STATUSES, DEFAULT_LIMIT, {
      demoStep,
      demoShift,
    })
    setDbAlerts(alerts)
  }, [demoShift, demoStep])

  // Alerts source: DB /api/alerts (ACTIVE + ACKNOWLEDGED)
  useEffect(() => {
    let cancelled = false

    const loadAlerts = async () => {
      try {
        const alerts = await fetchAlerts(DEFAULT_STATUSES, DEFAULT_LIMIT, {
          demoStep,
          demoShift,
        })
        if (!cancelled) setDbAlerts(alerts)
      } catch (error) {
        console.error("Failed to load alerts for notification context:", error)
      }
    }

    void loadAlerts()
    const intervalId = window.setInterval(() => {
      void loadAlerts()
    }, ALERTS_REFRESH_MS)

    const handleRefreshEvent = () => {
      void loadAlerts()
    }
    window.addEventListener("alerts:refresh", handleRefreshEvent)

    const handleLocalResetEvent = () => {
      setDismissed(new Set())
      setToastDismissed(new Set())
      void loadAlerts()
    }
    window.addEventListener("alerts:local-reset", handleLocalResetEvent)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener("alerts:refresh", handleRefreshEvent)
      window.removeEventListener("alerts:local-reset", handleLocalResetEvent)
    }
  }, [demoShift, demoStep])

  const visiblePatientIds = useMemo(
    () => new Set(patients.map((patient) => String(patient.id))),
    [patients],
  )

  const scopedDbAlerts = useMemo(() => {
    if (visiblePatientIds.size === 0) return dbAlerts
    return dbAlerts.filter((alert) => {
      if (alert.patientId == null || String(alert.patientId).trim() === "") return true
      return visiblePatientIds.has(String(alert.patientId))
    })
  }, [dbAlerts, visiblePatientIds])

  const rawNotifications = useMemo(
    () => buildNotificationsFromDbAlerts(scopedDbAlerts, patients),
    [patients, scopedDbAlerts],
  )

  const notifications = useMemo(
    () => rawNotifications.filter((notification) => !dismissed.has(notification.id)),
    [rawNotifications, dismissed],
  )

  // Counts
  const s3Count = useMemo(
    () => notifications.filter((n) => n.severity === "S3" && !n.acknowledged).length,
    [notifications],
  )
  const s2Count = useMemo(
    () => notifications.filter((n) => n.severity === "S2").length,
    [notifications],
  )
  const s1Count = useMemo(
    () => notifications.filter((n) => n.severity === "S1").length,
    [notifications],
  )
  const totalCount = notifications.length

  const unacknowledgedS3 = useMemo(
    () => notifications.filter((n) => n.severity === "S3" && !n.acknowledged),
    [notifications],
  )

  // S3 toast queue: unacknowledged S3 that haven't been toast-dismissed
  const toastQueue = useMemo(() => {
    return unacknowledgedS3.filter((n) => {
      if (toastDismissed.has(n.id)) return false
      if (n.isSnoozed) return false
      return true
    })
  }, [unacknowledgedS3, toastDismissed])

  // Ticker: unacknowledged S3 notifications for header ticker
  const tickerNotifications = useMemo(() => {
    return unacknowledgedS3.filter((n) => !n.isSnoozed)
  }, [unacknowledgedS3])

  // Actions
  const acknowledge = useCallback(
    (notifId: string) => {
      const alertId = parseAlertId(notifId, notifications)
      if (alertId == null) {
        console.warn(`acknowledge skipped: invalid notification id ${notifId}`)
        return
      }

      void (async () => {
        try {
          await mutateAlert(
            `/alerts/${alertId}/ack`,
            "PATCH",
            null,
            { demoStep, demoShift },
          )
          setToastDismissed((prev) => new Set([...prev, notifId]))
          await refreshAlerts()
        } catch (error) {
          console.error("Failed to acknowledge alert:", error)
        }
      })()
    },
    [demoShift, demoStep, notifications, refreshAlerts],
  )

  const snooze = useCallback(
    (notifId: string, minutes: number) => {
      const alertId = parseAlertId(notifId, notifications)
      if (alertId == null) {
        console.warn(`snooze skipped: invalid notification id ${notifId}`)
        return
      }

      void (async () => {
        try {
          await mutateAlert(
            `/alerts/${alertId}/snooze`,
            "PATCH",
            { minutes },
            { demoStep, demoShift },
          )
          setToastDismissed((prev) => new Set([...prev, notifId]))
          await refreshAlerts()
        } catch (error) {
          console.error("Failed to snooze alert:", error)
        }
      })()
    },
    [demoShift, demoStep, notifications, refreshAlerts],
  )

  const dismissS1 = useCallback((notifId: string) => {
    setDismissed((prev) => new Set([...prev, notifId]))
  }, [])

  const dismissToast = useCallback((notifId: string) => {
    setToastDismissed((prev) => new Set([...prev, notifId]))
  }, [])

  // Play sound once for new S3 alerts
  useEffect(() => {
    if (toastQueue.length > 0) {
      // Browser audio notification (single beep)
      try {
        const audioCtx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        const oscillator = audioCtx.createOscillator()
        const gainNode = audioCtx.createGain()
        oscillator.connect(gainNode)
        gainNode.connect(audioCtx.destination)
        oscillator.frequency.value = 880
        oscillator.type = "sine"
        gainNode.gain.value = 0.1
        oscillator.start()
        oscillator.stop(audioCtx.currentTime + 0.15)
      } catch {
        // Audio not available
      }
    }
  }, [toastQueue.length])

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      totalCount,
      s3Count,
      s2Count,
      s1Count,
      unacknowledgedS3,
      acknowledge,
      snooze,
      dismissS1,
      activeTab,
      setActiveTab,
      isPanelOpen,
      setIsPanelOpen,
      toastQueue,
      dismissToast,
      tickerNotifications,
      onNavigateToPatient,
    }),
    [
      notifications,
      totalCount,
      s3Count,
      s2Count,
      s1Count,
      unacknowledgedS3,
      acknowledge,
      snooze,
      dismissS1,
      activeTab,
      setActiveTab,
      isPanelOpen,
      setIsPanelOpen,
      toastQueue,
      dismissToast,
      tickerNotifications,
      onNavigateToPatient,
    ],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
