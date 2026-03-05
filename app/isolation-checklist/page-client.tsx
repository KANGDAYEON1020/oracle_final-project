"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowRightLeft, Check, ChevronsUpDown, CircleHelp, Clock3, History, ShieldAlert } from "lucide-react"
import { toast } from "sonner"

import { AppSidebar, type SidebarPage } from "@/components/dashboard/app-sidebar"
import { BottomNav } from "@/components/dashboard/bottom-nav"
import { V1Header } from "@/components/dashboard/v1-header"
import { HeaderTicker } from "@/components/clinical/notification-overlays"
import { NotificationProvider } from "@/lib/notification-context"
import { useDemoClock } from "@/lib/demo-clock-context"
import { SettingsProvider, useSettings } from "@/lib/settings-context"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  CHECKLIST_TYPE_OPTIONS,
  CHECKLIST_TYPE_LABELS,
  ChecklistItemDef,
  ChecklistMode,
  ChecklistState,
  ChecklistType,
  computeChecklistProgress,
  flattenChecklistItems,
  formatGapDuration,
  formatPrecaution,
  getChecklistDefinition,
  isItemVisibleToNurse,
  isItemRecommendedInMode,
  isItemRequiredInMode,
} from "@/lib/checklist-engine"
import { usePatients } from "@/lib/hooks/use-patients"
import {
  type GapMetricsResponse,
  ChecklistLogEventInput,
  ChecklistLogSummary,
  createChecklistLogEvent,
  listGapMetrics,
  listChecklistLogs,
} from "@/lib/mdro-checklist-service"
import type { Patient } from "@/lib/types"
import { cn } from "@/lib/utils"

type LogCategory = "all" | "isolation" | "admin" | "alternative"
type SectionKey = "A" | "B" | "C"

interface AppliedStatusState {
  applied: boolean
  gapStartedAt: string | null
}

const LEVEL_GUIDE: Record<"L0" | "L1" | "L2", string> = {
  L0: "기본/항상 수행 항목입니다. 의심·확진 모두에서 주로 분모에 포함됩니다.",
  L1: "조건부 항목입니다. 의심 단계에서는 추천 중심, 확진 단계에서는 필수화될 수 있습니다.",
  L2: "운영 옵션 항목입니다. 자원·병상·보고 상황에 따라 선택하며 필요 시 필수화될 수 있습니다.",
}

const INFECTION_CATEGORY_GUIDE: Array<{ type: ChecklistType; diseases: string }> = [
  { type: "MDRO", diseases: "CRE, MRSA, VRE 등 다제내성균 관련 격리 관리" },
  { type: "GI_WATERBORNE", diseases: "수인성·식품매개 장관감염(설사/구토 중심) 관리" },
  { type: "RESP_ISOLATION", diseases: "호흡기 격리 필요 질환군(수막구균, 성홍열, RSV 등) 관리" },
]

const SECTION_ORDER: SectionKey[] = ["A", "B", "C"]
const GAP_THRESHOLD_HOURS = 4
const SECTION_STEPPER_LABEL: Record<SectionKey, string> = {
  A: "A 격리/주의",
  B: "B 검사/이송",
  C: "C 환경/물품/손위생",
}

function parseSectionKey(value: string | null): SectionKey | null {
  if (!value) return null
  const normalized = value.toUpperCase()
  if (normalized === "A" || normalized === "B" || normalized === "C") {
    return normalized
  }
  return null
}

function isRiskGroupItem(item: ChecklistItemDef): boolean {
  return item.id === "GI_A0_RISK_GROUP_CHECK"
}

function isAlternativeItem(item: ChecklistItemDef): boolean {
  return item.id === "GI_A2_ALT_MEASURES" || item.id.includes("_ALT_") || item.id.includes("alternative")
}

function formatKst(iso?: string) {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Seoul",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function formatSourceLine(definition: {
  source_label?: string
  source?: {
    publisher: string
    title: string
    issued_at?: string
  }
}) {
  if (definition.source_label) return definition.source_label
  if (!definition.source) return null
  return `출처: ${definition.source.publisher} 『${definition.source.title}』${definition.source.issued_at ? `(${definition.source.issued_at})` : ""}`
}

function getPatientMdroBadge(patient: Patient) {
  const mdro = patient.mdroStatus
  if (!mdro) return null

  if (mdro.isMDRO) {
    return (
      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        확진 {mdro.mdroType ? `· ${mdro.mdroType}` : ""}
      </Badge>
    )
  }

  if (mdro.isolationRequired) {
    return (
      <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        의심
      </Badge>
    )
  }

  return null
}

function inferInfectionType(patient: Patient | null): ChecklistType {
  if (!patient) return "MDRO"
  if (patient.infection_type) return patient.infection_type
  if (patient.mdroStatus?.isMDRO || patient.mdroStatus?.isolationRequired) return "MDRO"

  const hay = `${patient.primaryDisease ?? ""} ${patient.diagnosis ?? ""}`.toLowerCase()
  if (
    hay.includes("gi") ||
    hay.includes("장관") ||
    hay.includes("설사") ||
    hay.includes("수인성") ||
    hay.includes("식품매개")
  ) {
    return "GI_WATERBORNE"
  }
  if (
    hay.includes("폐렴") ||
    hay.includes("호흡기") ||
    hay.includes("인플루엔자") ||
    hay.includes("rsv") ||
    hay.includes("아데노") ||
    hay.includes("성홍열") ||
    hay.includes("수막")
  ) {
    return "RESP_ISOLATION"
  }
  return "MDRO"
}

function summarizeLog(log: ChecklistLogSummary): string {
  switch (log.action) {
    case "check":
      return `${log.changed_item_label ?? "항목"} 체크`
    case "uncheck":
      return `${log.changed_item_label ?? "항목"} 해제`
    case "select_alternative":
      return `${log.changed_item_label ?? "대체조치"} 선택`
    case "unselect_alternative":
      return `${log.changed_item_label ?? "대체조치"} 해제`
    case "select_risk_group":
      return `${log.changed_item_label ?? "전파위험군"} 선택`
    case "unselect_risk_group":
      return `${log.changed_item_label ?? "전파위험군"} 해제`
    case "select_option":
      return `${log.changed_item_label ?? "옵션"} 선택`
    case "unselect_option":
      return `${log.changed_item_label ?? "옵션"} 해제`
    case "clear_all":
      return "전체 해지 실행"
    case "apply_isolation":
      return "격리 적용 처리"
    case "unapply_isolation":
      return "격리 미적용 전환"
    case "update_note":
      return "운영 메모 업데이트"
    case "set_applied_status":
      return `격리 적용 상태 변경 (${log.reason ?? "자동"})`
    case "apply_recommended_markers":
      return "추천 항목 표시 적용"
    default:
      return log.changed_item_label ?? log.action
  }
}

function IsolationChecklistContent({ allPatients }: { allPatients: Patient[] }) {
  const { showTicker } = useSettings()
  const { demoStep, demoShift } = useDemoClock()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const mainScrollRef = useRef<HTMLDivElement | null>(null)
  const logsCardRef = useRef<HTMLDivElement | null>(null)
  const [search, setSearch] = useState("")
  const [openCombobox, setOpenCombobox] = useState(false)

  // 동일 patient.id가 중복될 때 key 충돌 및 선택 상태 꼬임 방지
  const uniquePatients = useMemo(() => {
    const seen = new Set<string>()
    const deduped: Patient[] = []
    for (const patient of allPatients) {
      if (seen.has(patient.id)) continue
      seen.add(patient.id)
      deduped.push(patient)
    }
    return deduped
  }, [allPatients])

  // 기본 환자: URL query에 patientId가 있으면 우선, 없으면 MDRO 환자 우선, 그 다음 첫 번째 환자
  const queryPatientId = searchParams.get("patientId") ?? ""
  const defaultPatientId = useMemo(() => {
    if (queryPatientId && uniquePatients.some((p) => p.id === queryPatientId)) {
      return queryPatientId
    }
    return uniquePatients.find((p) => p.mdroStatus?.isMDRO)?.id ?? uniquePatients[0]?.id ?? ""
  }, [uniquePatients, queryPatientId])
  const [selectedPatientId, setSelectedPatientId] = useState("")
  useEffect(() => {
    if (!selectedPatientId && defaultPatientId) {
      setSelectedPatientId(defaultPatientId)
    }
  }, [defaultPatientId, selectedPatientId])

  const [infectionTypeByPatient, setInfectionTypeByPatient] = useState<
    Record<string, ChecklistType>
  >({})

  const selectedPatient = useMemo(
    () => uniquePatients.find((p: Patient) => p.id === selectedPatientId) ?? null,
    [uniquePatients, selectedPatientId]
  )

  const checklistType: ChecklistType =
    infectionTypeByPatient[selectedPatientId] ?? inferInfectionType(selectedPatient)

  const derivedMode: ChecklistMode = useMemo(() => {
    if (checklistType === "MDRO") {
      return selectedPatient?.mdroStatus?.isMDRO === true ? "confirmed" : "suspected"
    }
    return "suspected"
  }, [checklistType, selectedPatient])

  const [mode, setMode] = useState<ChecklistMode>(derivedMode)
  useEffect(() => {
    setMode(derivedMode)
  }, [derivedMode, selectedPatientId, checklistType])

  const definition = useMemo(() => getChecklistDefinition(checklistType, mode), [checklistType, mode])
  const visibleDefinition = useMemo(() => {
    const filteredSections = definition.sections
      .map((section) => {
        if (section.id === "D") {
          return null
        }
        if (checklistType === "GI_WATERBORNE" && mode === "suspected" && section.id === "B") {
          return null
        }
        const levels = section.levels
          .map((level) => ({
            ...level,
            items: level.items.filter((item) => isItemVisibleToNurse(item)),
          }))
          .filter((level) => level.items.length > 0)
        if (levels.length === 0) return null
        return {
          ...section,
          levels,
        }
      })
      .filter((section): section is NonNullable<typeof section> => section !== null)
    return {
      ...definition,
      sections: filteredSections,
    }
  }, [checklistType, definition, mode])

  const items = useMemo(() => flattenChecklistItems(visibleDefinition), [visibleDefinition])

  const stateKey = useMemo(
    () => `${selectedPatientId}:${checklistType}:${mode}`,
    [selectedPatientId, checklistType, mode]
  )
  const [itemStateByKey, setItemStateByKey] = useState<Record<string, ChecklistState>>({})
  const currentState = itemStateByKey[stateKey] ?? {}

  const recommendedVisible = false

  const progress = useMemo(
    () => computeChecklistProgress(visibleDefinition, currentState),
    [currentState, visibleDefinition]
  )
  const sectionProgressMap = useMemo(() => {
    return new Map(progress.sections.map((sectionProgress) => [sectionProgress.section_id, sectionProgress]))
  }, [progress.sections])
  const availableSections = useMemo(
    () => new Set(visibleDefinition.sections.map((section) => section.id as SectionKey)),
    [visibleDefinition.sections]
  )
  const [activeSection, setActiveSection] = useState<SectionKey>(() => {
    return parseSectionKey(searchParams.get("section")) ?? "A"
  })

  const orderedVisibleSections = useMemo(
    () => SECTION_ORDER.filter((key) => availableSections.has(key)),
    [availableSections]
  )
  const activeSectionData = useMemo(() => {
    if (availableSections.has(activeSection)) {
      return visibleDefinition.sections.find((section) => section.id === activeSection) ?? null
    }
    const fallback = orderedVisibleSections[0]
    if (!fallback) return null
    return visibleDefinition.sections.find((section) => section.id === fallback) ?? null
  }, [activeSection, availableSections, orderedVisibleSections, visibleDefinition.sections])
  const activeSectionKey = (activeSectionData?.id as SectionKey | undefined) ?? orderedVisibleSections[0] ?? "A"

  useEffect(() => {
    const querySection = parseSectionKey(searchParams.get("section"))
    if (!querySection) return
    if (!availableSections.has(querySection)) return
    setActiveSection((current) => (current === querySection ? current : querySection))
  }, [availableSections, searchParams])

  useEffect(() => {
    if (availableSections.has(activeSection)) return
    const fallback = orderedVisibleSections[0] ?? "A"
    if (fallback !== activeSection) setActiveSection(fallback)
  }, [activeSection, availableSections, orderedVisibleSections])

  useEffect(() => {
    const currentQuery = parseSectionKey(searchParams.get("section"))
    if (currentQuery === activeSectionKey) return
    const nextQuery = new URLSearchParams(searchParams.toString())
    nextQuery.set("section", activeSectionKey)
    const nextHref = nextQuery.toString() ? `${pathname}?${nextQuery.toString()}` : pathname
    router.replace(nextHref, { scroll: false })
  }, [activeSectionKey, pathname, router, searchParams])

  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: "auto" })
  }, [activeSectionKey])

  const [appliedByPatient, setAppliedByPatient] = useState<Record<string, AppliedStatusState>>({})
  useEffect(() => {
    if (!selectedPatient) return
    setAppliedByPatient((prev) => {
      if (prev[selectedPatient.id]) return prev
      const initiallyApplied = Boolean(selectedPatient.mdroStatus?.isolationImplemented)
      return {
        ...prev,
        [selectedPatient.id]: {
          applied: initiallyApplied,
          gapStartedAt: initiallyApplied
            ? null
            : selectedPatient.lastUpdatedTimestamp ?? new Date().toISOString(),
        },
      }
    })
  }, [selectedPatient])

  const appliedState = appliedByPatient[selectedPatientId] ?? {
    applied: false,
    gapStartedAt: new Date().toISOString(),
  }

  const [tickNow, setTickNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setTickNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const [logs, setLogs] = useState<ChecklistLogSummary[]>([])
  const [logSource, setLogSource] = useState<"backend" | "local">("backend")
  const [gapMetrics, setGapMetrics] = useState<GapMetricsResponse | null>(null)
  const [logCategory, setLogCategory] = useState<LogCategory>("all")
  const [isLogsOpen, setIsLogsOpen] = useState(false)

  const refreshLogs = useCallback(async () => {
    if (!selectedPatientId) return
    const result = await listChecklistLogs({
      patientId: selectedPatientId,
      checklistType,
      infectionType: checklistType,
      limit: 200,
      demoStep,
      demoShift,
    })
    setLogs(result.data.logs)
    setLogSource(result.source)
  }, [checklistType, demoShift, demoStep, selectedPatientId])

  useEffect(() => {
    void refreshLogs()
  }, [refreshLogs])

  const refreshGapMetrics = useCallback(async () => {
    if (!selectedPatientId) return
    try {
      const metrics = await listGapMetrics({
        patientId: selectedPatientId,
        checklistType,
        infectionType: checklistType,
        thresholdHours: GAP_THRESHOLD_HOURS,
        includeCases: false,
        demoStep,
        demoShift,
      })
      setGapMetrics(metrics)
    } catch {
      setGapMetrics(null)
    }
  }, [checklistType, demoShift, demoStep, selectedPatientId])

  useEffect(() => {
    void refreshGapMetrics()
  }, [refreshGapMetrics])

  const filteredLogs = useMemo(() => {
    if (logCategory === "all") return logs
    return logs.filter((log) => log.tags.includes(logCategory))
  }, [logCategory, logs])

  const [pendingEvents, setPendingEvents] = useState<ChecklistLogEventInput[]>([])
  const [failedEvents, setFailedEvents] = useState<ChecklistLogEventInput[] | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)

  const enqueueEvent = useCallback(
    (event: ChecklistLogEventInput, replaceKey?: string) => {
      setFailedEvents(null)
      setPendingEvents((prev) => {
        if (!replaceKey) return [...prev, event]
        const filtered = prev.filter(
          (queued) => `${queued.action}:${queued.changed_item_id ?? ""}` !== replaceKey
        )
        return [...filtered, event]
      })
    },
    []
  )

  const patients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return uniquePatients
    return uniquePatients.filter((p: Patient) => {
      const hay = `${p.name} ${p.id} ${p.ward || ""} ${p.roomNumber || ""} ${p.diagnosis || ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [search, uniquePatients])

  const buildBaseEvent = useCallback(
    (
      overrides: Omit<
        ChecklistLogEventInput,
        "patient_id" | "checklist_type" | "infection_type" | "mode" | "actor_role"
      >
    ) => {
      if (!selectedPatient) return null
      const subtype =
        checklistType === "MDRO"
          ? selectedPatient.mdroStatus?.mdroType
          : checklistType === "GI_WATERBORNE"
            ? `GI-${mode}`
            : checklistType === "RESP_ISOLATION"
              ? `RESP-${mode}`
              : undefined
      return {
        patient_id: selectedPatient.id,
        patient_name: selectedPatient.name,
        checklist_type: checklistType,
        infection_type: checklistType,
        mode,
        subtype,
        actor_role: "간호사" as const,
        actor_name: selectedPatient.attendingNurse ?? "Ward Nurse",
        ...overrides,
      } satisfies ChecklistLogEventInput
    },
    [checklistType, mode, selectedPatient]
  )

  const handleSaveChanges = useCallback(async () => {
    if (!selectedPatient) return
    if (pendingEvents.length === 0) {
      toast.message("저장할 변경사항이 없습니다.")
      return
    }

    const batch = [...pendingEvents]
    setIsSaving(true)
    try {
      for (const event of batch) {
        await createChecklistLogEvent({
          ...event,
          patient_name: event.patient_name ?? selectedPatient.name,
          actor_name: event.actor_name ?? selectedPatient.attendingNurse ?? "Ward Nurse",
          timestamp: event.timestamp ?? new Date().toISOString(),
          demoStep,
          demoShift,
        })
      }

      setPendingEvents((prev) => prev.filter((queued) => !batch.includes(queued)))
      setFailedEvents(null)
      setLastSavedAt(new Date().toISOString())
      await Promise.all([refreshLogs(), refreshGapMetrics()])

      toast.success(`${batch.length}건 저장했습니다.`)
    } catch {
      setFailedEvents(batch)
      toast.error("저장 실패: 네트워크 또는 서버 상태를 확인하세요.")
    } finally {
      setIsSaving(false)
    }
  }, [demoShift, demoStep, pendingEvents, refreshGapMetrics, refreshLogs, selectedPatient])

  const updateStateValue = useCallback(
    (itemId: string, value: ChecklistState[string]) => {
      setItemStateByKey((prev) => ({
        ...prev,
        [stateKey]: {
          ...(prev[stateKey] ?? {}),
          [itemId]: value,
        },
      }))
    },
    [stateKey]
  )

  const handleCheckboxChange = useCallback(
    (item: ChecklistItemDef, nextChecked: boolean) => {
      updateStateValue(item.id, nextChecked)
      const event = buildBaseEvent({
        changed_item_id: item.id,
        changed_item_label: item.label,
        action: nextChecked ? "check" : "uncheck",
        tags: item.tags,
      })
      if (event) enqueueEvent(event)
    },
    [buildBaseEvent, enqueueEvent, updateStateValue]
  )

  const handleMultiSelectToggle = useCallback(
    (item: ChecklistItemDef, optionId: string, optionLabel: string) => {
      const current = Array.isArray(currentState[item.id]) ? (currentState[item.id] as string[]) : []
      const selected = current.includes(optionId)
      const next = selected ? current.filter((value) => value !== optionId) : [...current, optionId]
      updateStateValue(item.id, next)

      const riskGroup = isRiskGroupItem(item)
      const alternative = isAlternativeItem(item)
      const action = riskGroup
        ? selected
          ? "unselect_risk_group"
          : "select_risk_group"
        : alternative
          ? selected
            ? "unselect_alternative"
            : "select_alternative"
          : selected
            ? "unselect_option"
            : "select_option"
      const tags = alternative ? ["alternative"] : item.tags ?? ["isolation"]

      const event = buildBaseEvent({
        changed_item_id: `${item.id}:${optionId}`,
        changed_item_label: `${item.label} - ${optionLabel}`,
        action,
        tags,
        details: {
          option_id: optionId,
          option_label: optionLabel,
        },
      })
      if (event) enqueueEvent(event)
    },
    [buildBaseEvent, currentState, enqueueEvent, updateStateValue]
  )

  const handleNoteChange = useCallback(
    (item: ChecklistItemDef, nextValue: string) => {
      updateStateValue(item.id, nextValue)
      const event = buildBaseEvent({
        changed_item_id: item.id,
        changed_item_label: item.label,
        action: "update_note",
        tags: item.tags,
        details: { text_length: nextValue.length },
      })
      if (event) enqueueEvent(event, `update_note:${item.id}`)
    },
    [buildBaseEvent, enqueueEvent, updateStateValue]
  )

  const [unapplyDialogOpen, setUnapplyDialogOpen] = useState(false)
  const [unapplyReason, setUnapplyReason] = useState("")

  const handleApplyIsolation = useCallback(() => {
    if (!selectedPatient) return
    const previous = appliedByPatient[selectedPatient.id] ?? {
      applied: false,
      gapStartedAt: new Date().toISOString(),
    }
    if (previous.applied) return

    setAppliedByPatient((prev) => ({
      ...prev,
      [selectedPatient.id]: {
        applied: true,
        gapStartedAt: null,
      },
    }))

    const event = buildBaseEvent({
      action: "apply_isolation",
      changed_item_id: "applied_status",
      changed_item_label: "격리 적용 상태",
      reason: "격리 적용됨",
      tags: ["isolation"],
      details: {
        previous_applied: previous.applied,
        next_applied: true,
        gap_started_at: null,
      },
    })
    if (event) enqueueEvent(event, "apply_isolation:applied_status")
  }, [appliedByPatient, buildBaseEvent, enqueueEvent, selectedPatient])

  const handleUnapplyConfirm = useCallback(() => {
    if (!selectedPatient) return
    const reason = unapplyReason.trim()
    if (!reason) return

    const previous = appliedByPatient[selectedPatient.id] ?? {
      applied: false,
      gapStartedAt: new Date().toISOString(),
    }
    const nextGapStart = new Date().toISOString()

    setAppliedByPatient((prev) => ({
      ...prev,
      [selectedPatient.id]: {
        applied: false,
        gapStartedAt: nextGapStart,
      },
    }))

    const event = buildBaseEvent({
      action: "unapply_isolation",
      changed_item_id: "applied_status",
      changed_item_label: "격리 적용 상태",
      reason,
      tags: ["isolation"],
      details: {
        previous_applied: previous.applied,
        next_applied: false,
        gap_started_at: nextGapStart,
      },
    })
    if (event) enqueueEvent(event, "unapply_isolation:applied_status")
    setUnapplyDialogOpen(false)
    setUnapplyReason("")
  }, [appliedByPatient, buildBaseEvent, enqueueEvent, selectedPatient, unapplyReason])

  const gapDisplay = useMemo(() => {
    if (appliedState.applied) return "0h 00m"
    if (!appliedState.gapStartedAt) return "-"
    return formatGapDuration(appliedState.gapStartedAt, tickNow)
  }, [appliedState.applied, appliedState.gapStartedAt, tickNow])

  const currentGapHours = useMemo(() => {
    if (appliedState.applied || !appliedState.gapStartedAt) return 0
    const startedAtMs = new Date(appliedState.gapStartedAt).getTime()
    if (Number.isNaN(startedAtMs)) return 0
    return Math.max(0, (tickNow - startedAtMs) / 3600000)
  }, [appliedState.applied, appliedState.gapStartedAt, tickNow])

  const activeGapThresholdHours = gapMetrics?.threshold_hours ?? GAP_THRESHOLD_HOURS
  const isCurrentGapOverThreshold = !appliedState.applied && currentGapHours >= activeGapThresholdHours

  const alternativeCount = useMemo(() => {
    return items
      .filter((item) => item.item_type === "multi_select" && isAlternativeItem(item))
      .reduce((acc, item) => {
        const values = Array.isArray(currentState[item.id]) ? (currentState[item.id] as string[]) : []
        return acc + values.length
      }, 0)
  }, [currentState, items])

  const activeSectionIndex = orderedVisibleSections.indexOf(activeSectionKey)
  const prevSectionKey = activeSectionIndex > 0 ? orderedVisibleSections[activeSectionIndex - 1] : null
  const nextSectionKey =
    activeSectionIndex >= 0 && activeSectionIndex < orderedVisibleSections.length - 1
      ? orderedVisibleSections[activeSectionIndex + 1]
      : null

  const moveToSection = useCallback(
    (section: SectionKey) => {
      if (!availableSections.has(section)) return
      setActiveSection(section)
    },
    [availableSections]
  )

  const handleLogReviewClick = useCallback(() => {
    if (pendingEvents.length > 0) {
      toast.error("저장되지 않은 변경사항이 있습니다. 먼저 [저장]을 눌러주세요.")
      return
    }

    if (progress.total > 0 && progress.checked < progress.total) {
      const firstIncompleteSection = progress.sections.find((section) => section.checked < section.total)
      if (firstIncompleteSection?.section_id) {
        moveToSection(firstIncompleteSection.section_id as SectionKey)
      }
      toast.error("필수 항목을 모두 체크한 뒤 로그를 확인할 수 있습니다.")
      return
    }

    setIsLogsOpen(true)
  }, [pendingEvents.length, progress, moveToSection])

  const handleStepperKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      if (orderedVisibleSections.length === 0) return
      event.preventDefault()
      const currentIndex = orderedVisibleSections.indexOf(activeSectionKey)
      if (currentIndex < 0) return
      const delta = event.key === "ArrowRight" ? 1 : -1
      const nextIndex =
        (currentIndex + delta + orderedVisibleSections.length) % orderedVisibleSections.length
      setActiveSection(orderedVisibleSections[nextIndex])
    },
    [activeSectionKey, orderedVisibleSections]
  )

  const renderChecklistItem = (item: ChecklistItemDef) => {
    const isRequired = isItemRequiredInMode(item, mode)
    const isRecommended = isItemRecommendedInMode(item, mode)
    const showRecommended = recommendedVisible && !isRequired && isRecommended

    if (item.item_type === "checkbox") {
      const checked = currentState[item.id] === true
      return (
        <label
          key={item.id}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
            checked ? "border-primary/40 bg-primary/5" : "border-border hover:bg-accent/30"
          )}
        >
          <Checkbox checked={checked} onCheckedChange={(v) => handleCheckboxChange(item, Boolean(v))} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{item.label}</span>
              {isRequired && (
                <Badge
                  variant="outline"
                  className="border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-600 dark:text-rose-400"
                >
                  필수
                </Badge>
              )}
              {showRecommended && (
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-600 dark:text-amber-400"
                >
                  추천
                </Badge>
              )}
            </div>
            {item.description && <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>}
          </div>
        </label>
      )
    }

    if (item.item_type === "multi_select") {
      const selectedValues = Array.isArray(currentState[item.id]) ? (currentState[item.id] as string[]) : []
      return (
        <div key={item.id} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{item.label}</span>
            {showRecommended && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-600 dark:text-amber-400"
              >
                추천
              </Badge>
            )}
          </div>
          {item.description && <div className="mb-2 text-xs text-muted-foreground">{item.description}</div>}
          <div className="flex flex-col gap-2">
            {(item.options ?? []).map((option) => {
              const optionId = option.value ?? option.id ?? ""
              const selected = selectedValues.includes(optionId)
              return (
                <button
                  key={optionId}
                  type="button"
                  onClick={() => handleMultiSelectToggle(item, optionId, option.label)}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-accent/30"
                  )}
                >
                  <span>{option.label}</span>
                  <span className="text-xs">{selected ? "선택됨" : "선택"}</span>
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    if (item.item_type === "single_select") {
      const selectedValue = typeof currentState[item.id] === "string" ? (currentState[item.id] as string) : ""
      return (
        <div key={item.id} className="rounded-lg border border-border p-3">
          <div className="mb-2 text-sm font-medium">{item.label}</div>
          <div className="flex flex-wrap gap-2">
            {(item.options ?? []).map((option) => {
              const optionId = option.value ?? option.id ?? ""
              const selected = selectedValue === optionId
              return (
                <button
                  key={optionId}
                  type="button"
                  onClick={() => {
                    updateStateValue(item.id, selected ? "" : optionId)
                    const event = buildBaseEvent({
                      changed_item_id: `${item.id}:${optionId}`,
                      changed_item_label: `${item.label} - ${option.label}`,
                      action: selected ? "unselect_option" : "select_option",
                      tags: item.tags ?? ["isolation"],
                    })
                    if (event) enqueueEvent(event)
                  }}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-foreground hover:bg-accent/30"
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    if (item.item_type === "info") {
      const content = item.description ?? item.label
      if (item.ui?.default_collapsed) {
        return (
          <details key={item.id} className="rounded-lg border border-dashed border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">참고 정보</summary>
            <div className="mt-2 text-xs text-muted-foreground">{content}</div>
          </details>
        )
      }
      return (
        <div key={item.id} className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          {content}
        </div>
      )
    }

    const noteValue = typeof currentState[item.id] === "string" ? (currentState[item.id] as string) : ""
    return (
      <div key={item.id} className="rounded-lg border border-border p-3">
        <div className="mb-2 text-sm font-medium">{item.label}</div>
        <Textarea
          value={noteValue}
          onChange={(e) => handleNoteChange(item, e.target.value)}
          placeholder={item.placeholder ?? "메모를 입력하세요"}
          className="min-h-[100px]"
        />
      </div>
    )
  }

  const mdroBadge =
    checklistType === "MDRO" && selectedPatient ? getPatientMdroBadge(selectedPatient) : null
  const suspectedHeaderStrip = useMemo(() => {
    if (mode !== "suspected") return null
    if (checklistType === "GI_WATERBORNE") {
      return "의심 단계: Level 1/2는 추천(강제 체크 없음) · B 섹션은 확진에서 활성화됩니다."
    }
    return "의심 단계: Level 1/2는 추천 항목이며 강제 체크는 없습니다."
  }, [checklistType, mode])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <V1Header
        title="격리 체크리스트"
        subtitle="격리 필요 환자 체크리스트 (MDRO · 수인성 장염 · 호흡기, 수동 저장)"
        subtitlePlacement="right"
      />
      {showTicker && <HeaderTicker />}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background pb-16 xl:pb-0">
        <div className="mx-auto flex h-full w-full max-w-7xl flex-col">
          <section className="flex min-h-0 flex-col bg-background">
            {/* Top Bar - Sticky */}
            <div className="flex-none border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 md:gap-3">
                    <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={openCombobox}
                          className="h-9 w-full justify-between text-sm font-semibold sm:w-[300px]"
                        >
                          {selectedPatient ? (
                            <div className="flex items-center gap-2 truncate">
                              <span>{selectedPatient.name}</span>
                              <span className="text-muted-foreground font-normal">
                                ({selectedPatient.id})
                              </span>
                            </div>
                          ) : (
                            "환자 선택..."
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[300px] max-w-[calc(100vw-2rem)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="환자 검색..." />
                          <CommandList>
                            <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                            <CommandGroup heading={`환자 목록 (${patients.length}명)`}>
                              {patients.map((patient) => (
                                <CommandItem
                                  key={patient.id}
                                  value={`${patient.name} ${patient.id}`}
                                  onSelect={() => {
                                    setSelectedPatientId(patient.id)
                                    setOpenCombobox(false)
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedPatientId === patient.id
                                        ? "opacity-100"
                                        : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col">
                                    <span className="font-medium">{patient.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {patient.ward} · {patient.roomNumber}
                                    </span>
                                  </div>
                                  {checklistType === "MDRO" && patient.mdroStatus?.isMDRO && (
                                    <Badge variant="outline" className="ml-auto text-[10px]">
                                      {patient.mdroStatus.mdroType}
                                    </Badge>
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {selectedPatient && mdroBadge}
                  </div>

                  {selectedPatient && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 pl-1 text-xs text-muted-foreground">
                      <span>
                        {selectedPatient.ward} {selectedPatient.roomNumber}호
                      </span>
                      <span className="opacity-50">|</span>
                      <span>담당: {selectedPatient.attendingNurse ?? "-"}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Badge variant="outline" className="hidden gap-1.5 bg-background sm:inline-flex">
                    <ShieldAlert className="h-3 w-3" />
                    Local Def
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 gap-1.5 bg-background px-2 text-[11px]"
                    onClick={handleLogReviewClick}
                  >
                    <History className="h-3 w-3" />
                    로그 이력
                  </Button>
                  <Badge variant="outline" className={cn(
                    "gap-1.5 transition-colors",
                    isSaving || pendingEvents.length > 0 ? "border-amber-500/50 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400" : "bg-background"
                  )}>
                    <Clock3 className="h-3 w-3" />
                    {isSaving
                      ? "저장 중..."
                      : pendingEvents.length > 0
                        ? `저장 대기 ${pendingEvents.length}건`
                        : lastSavedAt
                          ? `최근 저장 ${formatKst(lastSavedAt)}`
                          : "저장 대기중"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Scrollable Content Area */}
            <div ref={mainScrollRef} className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
                {/* Top Controls Card */}
                <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
                  <div className="p-4 md:p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-3 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={checklistType}
                            onValueChange={(value) =>
                              setInfectionTypeByPatient((prev) => ({
                                ...prev,
                                [selectedPatientId]: value as ChecklistType,
                              }))
                            }
                          >
                            <SelectTrigger className="h-8 w-full text-xs min-[420px]:w-[180px]">
                              <SelectValue placeholder="체크리스트 타입 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {CHECKLIST_TYPE_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value} className="text-xs">
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Tabs
                            value={mode}
                            onValueChange={(value) => setMode(value as ChecklistMode)}
                            className="w-full sm:w-auto"
                          >
                            <TabsList className="h-8 w-full sm:w-auto">
                              <TabsTrigger className="h-7 flex-1 px-3 text-xs sm:flex-none" value="suspected">의심(권고)</TabsTrigger>
                              <TabsTrigger className="h-7 flex-1 px-3 text-xs sm:flex-none" value="confirmed">확진(지침)</TabsTrigger>
                            </TabsList>
                          </Tabs>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                              >
                                <CircleHelp className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[360px] p-4 text-xs">
                              <div className="space-y-3">
                                <div>
                                  <div className="mb-1 font-semibold text-foreground">Level 안내</div>
                                  <ul className="list-inside space-y-1 text-muted-foreground">
                                    <li><span className="font-medium text-foreground">L0</span>: {LEVEL_GUIDE.L0}</li>
                                    <li><span className="font-medium text-foreground">L1</span>: {LEVEL_GUIDE.L1}</li>
                                    <li><span className="font-medium text-foreground">L2</span>: {LEVEL_GUIDE.L2}</li>
                                  </ul>
                                </div>
                                <div className="border-t pt-2">
                                  <div className="mb-1 font-semibold text-foreground">감염군(카테고리)</div>
                                  <ul className="space-y-1 text-muted-foreground">
                                    {INFECTION_CATEGORY_GUIDE.map((entry) => (
                                      <li key={entry.type}>
                                        <span className="font-medium text-foreground">{CHECKLIST_TYPE_LABELS[entry.type]}</span>: {entry.diseases}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>

                        {suspectedHeaderStrip && (
                          <div className="inline-flex items-center rounded-md border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
                            <CircleHelp className="mr-1.5 h-3 w-3" />
                            {suspectedHeaderStrip}
                          </div>
                        )}
                      </div>

                      <div className="flex w-full flex-col gap-3 md:w-auto md:min-w-[200px] md:items-end">
                        <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
                          <div className="text-left md:text-right">
                            <div className="text-[10px] font-medium text-muted-foreground">격리 적용 상태</div>
                            <div className={cn("text-xs font-bold", appliedState.applied ? "text-emerald-600" : "text-rose-600")}>
                              {appliedState.applied ? "적용 중" : "미적용"}
                            </div>
                          </div>
                          {appliedState.applied ? (
                            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setUnapplyDialogOpen(true)}>
                              해제
                            </Button>
                          ) : (
                            <Button size="sm" className="h-8 text-xs" onClick={handleApplyIsolation}>
                              적용
                            </Button>
                          )}
                        </div>

                        <div className="w-full space-y-1 md:max-w-[240px]">
                          <div className="flex justify-between text-[10px] font-medium text-muted-foreground">
                            <span>진행률</span>
                            <span>{progress.checked}/{progress.total} ({progress.percent}%)</span>
                          </div>
                          <Progress value={progress.percent} className="h-1.5" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Isolation Gap Card */}
                <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">Isolation Gap</span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold",
                      appliedState.applied
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                    )}>
                      {appliedState.applied ? "closed" : "open"}
                    </span>
                  </div>
                  <div className="h-4 w-px bg-border" />
                  <div className={cn("text-sm font-bold", appliedState.applied ? "text-emerald-600" : "text-rose-600")}>
                    {gapDisplay}
                  </div>
                  <div className="h-4 w-px bg-border" />
                  <span className={cn(
                    "text-xs font-medium",
                    isCurrentGapOverThreshold ? "text-rose-600" : "text-muted-foreground",
                  )}>
                    {appliedState.applied
                      ? `임계 ${activeGapThresholdHours}h · gap 없음`
                      : isCurrentGapOverThreshold
                        ? `임계 ${activeGapThresholdHours}h 초과`
                        : `임계 ${activeGapThresholdHours}h 이내`}
                  </span>
                  <div className="hidden items-center gap-1 text-[10px] text-muted-foreground sm:flex">
                    <div className="h-4 w-px bg-border" />
                    <span>케이스 {gapMetrics?.total_cases ?? 0}</span>
                    <span>· 평균 {gapMetrics ? `${gapMetrics.avg_gap_hours}h` : "-"}</span>
                    <span>· 중앙 {gapMetrics ? `${gapMetrics.median_gap_hours}h` : "-"}</span>
                    <span>· 최대 {gapMetrics ? `${gapMetrics.max_gap_hours}h` : "-"}</span>
                    <span>· 초과 {gapMetrics ? `${gapMetrics.threshold_exceeded_count}/${gapMetrics.total_cases}` : "-"}</span>
                  </div>
                </div>

                {/* Section Navigation Tabs */}
                <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
                  <div
                    role="tablist"
                    aria-label="Checklist sections"
                    onKeyDown={handleStepperKeyDown}
                    className="flex w-full items-center rounded-lg border bg-muted/20 p-1"
                  >
                    {SECTION_ORDER.map((sectionKey) => {
                      const sectionProgress = sectionProgressMap.get(sectionKey)
                      const done = sectionProgress?.checked ?? 0
                      const total = sectionProgress?.total ?? 0
                      const isAvailable = availableSections.has(sectionKey)
                      const isActive = activeSectionKey === sectionKey
                      const hasRequiredMissing = isAvailable && total > done
                      return (
                        <button
                          key={sectionKey}
                          id={`section-tab-${sectionKey}`}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-controls={`section-panel-${sectionKey}`}
                          disabled={!isAvailable}
                          onClick={() => moveToSection(sectionKey)}
                          className={cn(
                            "relative flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all md:px-3 md:text-sm",
                            isActive
                              ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                              : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                            !isAvailable && "cursor-not-allowed opacity-50"
                          )}
                        >
                          <span className="relative z-10 flex items-center justify-center gap-1.5">
                            {SECTION_STEPPER_LABEL[sectionKey]}
                            {hasRequiredMissing && (
                              <span className="block h-1.5 w-1.5 rounded-full bg-rose-500" />
                            )}
                            <span className="ml-1 text-[10px] opacity-70">
                              {isAvailable ? `(${done}/${total})` : ""}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Active Section Content */}
                {activeSectionData ? (
                  <div
                    id={`section-panel-${activeSectionData.id}`}
                    role="tabpanel"
                    aria-labelledby={`section-tab-${activeSectionData.id}`}
                    className="space-y-6 pb-36 xl:pb-20"
                  >
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold">{activeSectionData.title}</h3>
                      {activeSectionData.description && (
                        <p className="text-sm text-muted-foreground">{activeSectionData.description}</p>
                      )}
                    </div>

                    <div className="space-y-4">
                      {activeSectionData.levels.map((level) => (
                        <div
                          key={`${activeSectionData.id}-${level.id}`}
                          className={cn(
                            "rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md"
                          )}
                        >
                          <div className="mb-4 flex items-center justify-between">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="font-mono text-[10px] font-bold">
                                  {level.id}
                                </Badge>
                                <h4 className="font-semibold">{level.title}</h4>
                              </div>
                              {level.description && (
                                <p className="text-xs text-muted-foreground pl-1">{level.description}</p>
                              )}
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full">
                                  <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[280px]">
                                {LEVEL_GUIDE[level.id]}
                              </TooltipContent>
                            </Tooltip>
                          </div>

                          <div className="space-y-3">
                            {level.items.map((item) => renderChecklistItem(item))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Bottom Actions */}
                    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] left-4 right-4 z-20 flex items-center justify-between gap-2 rounded-full border bg-background/95 p-1.5 shadow-lg backdrop-blur xl:bottom-6 xl:left-auto xl:right-8 xl:w-auto xl:justify-start xl:gap-3 xl:px-3">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 rounded-full p-0"
                        onClick={() => prevSectionKey && moveToSection(prevSectionKey)}
                        disabled={!prevSectionKey}
                      >
                        <span className="sr-only">이전</span>
                        ←
                      </Button>
                      <div className="h-4 w-px bg-border" />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 rounded-full p-0"
                        onClick={() => nextSectionKey && moveToSection(nextSectionKey)}
                        disabled={!nextSectionKey}
                      >
                        <span className="sr-only">다음</span>
                        →
                      </Button>
                      <div className="h-4 w-px bg-border" />
                      <Button
                        type="button"
                        size="sm"
                        className={cn("h-8 rounded-full px-4 text-xs font-semibold", failedEvents && failedEvents.length > 0 && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                        onClick={() => {
                          void handleSaveChanges()
                        }}
                        disabled={isSaving || pendingEvents.length === 0}
                      >
                        {isSaving ? "저장 중" : "저장"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                    표시할 섹션이 없습니다.
                  </div>
                )}

              </div>
            </div>
          </section>
        </div>
      </main>

      <Dialog open={isLogsOpen} onOpenChange={setIsLogsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              변경 이력 (Logs)
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {logSource === "backend" ? "Backend" : "Local"}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="flex gap-1">
            {(["all", "isolation", "admin", "alternative"] as LogCategory[]).map((category) => (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={logCategory === category ? "secondary" : "ghost"}
                onClick={() => setLogCategory(category)}
                className="h-7 text-xs"
              >
                {category === "all"
                  ? "전체"
                  : category === "isolation"
                    ? "격리"
                    : category === "admin"
                      ? "행정"
                      : "대체조치"}
              </Button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/10 p-2">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                저장된 로그가 없습니다.
              </div>
            ) : (
              <div className="space-y-1">
                {filteredLogs.map((log) => (
                  <div
                    key={log.id}
                    className="group flex items-start justify-between rounded-lg bg-card p-3 shadow-sm ring-1 ring-border/50"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{summarizeLog(log)}</span>
                        <Badge variant="outline" className="text-[10px] opacity-70">
                          {log.infection_type}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {log.reason && (
                          <span className="mr-2 font-medium text-foreground/80">
                            사유: {log.reason}
                          </span>
                        )}
                        <span>
                          {log.actor_role} {log.actor_name && `· ${log.actor_name}`}
                        </span>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formatKst(log.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLogsOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unapplyDialogOpen} onOpenChange={setUnapplyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>미적용 전환 확인</DialogTitle>
            <DialogDescription>
              미적용으로 전환 시 사유 입력이 필요합니다. 입력된 사유는 로그에 남습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">전환 사유 (필수)</label>
            <Textarea
              value={unapplyReason}
              onChange={(event) => setUnapplyReason(event.target.value)}
              placeholder="예) 격리 필요성 재평가, 오입력 정정"
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnapplyDialogOpen(false)}>
              취소
            </Button>
            <Button variant="destructive" disabled={!unapplyReason.trim()} onClick={handleUnapplyConfirm}>
              미적용 전환
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IsolationChecklistFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      로딩 중...
    </div>
  )
}

export default function IsolationChecklistPage() {
  const router = useRouter()
  const { patients: allPatients } = usePatients()

  const handleNavigate = useCallback(
    (page: SidebarPage) => {
      if (page === "pc") router.push("/")
      else if (page === "infection") router.push("/?view=infection")
      else if (page === "transfer") router.push("/patients")
      else if (page === "report") router.push("/bed-allocation")
      else if (page === "autodraft") router.push("/?view=autodraft")
      else if (page === "isolation") router.push("/isolation-checklist")
      else if (page === "transferChecklist") router.push("/transfer-checklist")
    },
    [router]
  )

  return (
    <SettingsProvider>
      <NotificationProvider patients={allPatients} onNavigateToPatient={() => { }}>
        <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
          <div className="hidden h-full xl:flex">
            <AppSidebar currentPage="isolation" onNavigate={handleNavigate} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-16 xl:pb-0">
            <Suspense fallback={<IsolationChecklistFallback />}>
              <IsolationChecklistContent allPatients={allPatients} />
            </Suspense>
          </div>
          <div className="fixed bottom-0 left-0 right-0 z-50 xl:hidden">
            <BottomNav currentPage="isolation" onNavigate={handleNavigate} />
          </div>
        </div>
      </NotificationProvider>
    </SettingsProvider>
  )
}
