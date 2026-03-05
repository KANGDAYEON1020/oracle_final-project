"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, FileText, StickyNote, Stethoscope, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useDemoClock } from "@/lib/demo-clock-context"
import {
  fetchLatestTransferChecklistSnapshot,
  saveTransferChecklistSnapshot,
  submitTransferChecklist,
  type TransferChecklistSnapshotState,
} from "@/lib/transfer-checklist-service"
import type { Patient } from "@/lib/types"
import { cn } from "@/lib/utils"

type SectionId = "A" | "B" | "C" | "D" | "E"
type ConditionId = "pneumonia" | "sepsis" | "uti" | "mdro" | "gi"
type ReviewState = "not_reviewed" | "in_progress" | "reviewed"
type NoteCategory = "Reason" | "Risk" | "Requests" | "Consent"

interface ManualChecklistItem {
  id: string
  prompt: string
  helper: string
  evidenceOptions: string[]
}

interface ManualChecklistSection {
  id: SectionId
  title: string
  description: string
  items: ManualChecklistItem[]
}

interface ConditionChecklistDefinition {
  id: ConditionId
  label: string
  description: string
  items: ManualChecklistItem[]
}

interface ItemDraft {
  reviewed: boolean
  note: string
  references: string[]
  noteOpen: boolean
  evidenceOpen: boolean
}

interface QuickNote {
  id: string
  text: string
  category: NoteCategory | null
  createdAt: number
  updatedAt: number
}

interface PatientDraft {
  items: Record<string, ItemDraft>
  quickNotes: QuickNote[]
}

interface TransferChecklistProps {
  patients: Patient[]
  initialPatientId?: string
  onBack?: () => void
}

const SECTION_DEFINITIONS: ManualChecklistSection[] = [
  {
    id: "A",
    title: "질병별 체크리스트",
    description: "환자 진단 기반 질병별 항목을 수동으로 검토합니다.",
    items: [],
  },
  {
    id: "B",
    title: "환자 안정성",
    description: "이송 전 환자 상태를 수동으로 검토합니다.",
    items: [
      {
        id: "Q_A1",
        prompt: "ABCs/의식: 이송 중 악화 고위험?",
        helper: "현재 의식·호흡·순환 상태와 악화 가능성을 메모하세요.",
        evidenceOptions: ["최신 SpO2", "GCS", "호흡기록"],
      },
      {
        id: "Q_A2",
        prompt: "고도 치료 필요? (HFNC/NIV/IMV/승압제)",
        helper: "현재 필요한 치료 단계와 전원 중 유지 계획을 기록하세요.",
        evidenceOptions: ["산소요법", "MAP", "투약 현황"],
      },
      {
        id: "Q_A3",
        prompt: "중증도 지표(NEWS2 등) 높음?",
        helper: "중증도 추세와 재평가 간격을 수동 판단으로 남기세요.",
        evidenceOptions: ["NEWS2", "활력징후 추세", "간호 기록"],
      },
    ],
  },
  {
    id: "C",
    title: "우리 병원 역량",
    description: "전원 전 현재 기관에서 가능한 대응 범위를 점검합니다.",
    items: [
      {
        id: "Q_B1",
        prompt: "필수 검사·시술 24/7 가능?",
        helper: "검사/시술 가능 시간과 대체 경로를 메모하세요.",
        evidenceOptions: ["CT 가능 여부", "IR 가능 여부", "검사 소요시간"],
      },
      {
        id: "Q_B2",
        prompt: "ICU/준ICU/격리 + 핵심 인력 확보?",
        helper: "병상/인력 가용성과 커버리지 계획을 정리하세요.",
        evidenceOptions: ["ICU 병상", "준ICU 병상", "당직 인력"],
      },
    ],
  },
  {
    id: "D",
    title: "전원 필요성/수용확인",
    description: "수용 병원 및 인계 준비 상태를 확인합니다.",
    items: [
      {
        id: "Q_C1",
        prompt: "상급치료/권역센터가 표준인 상황?",
        helper: "전원 필요 근거와 현재 병원에서의 한계를 기록하세요.",
        evidenceOptions: ["진료 요약", "중증도 근거", "치료 계획"],
      },
      {
        id: "Q_C2",
        prompt: "수용병원 컨택/담당과/병상 확인 완료?",
        helper: "수용 확인 시간, 담당자, 병상 정보를 메모하세요.",
        evidenceOptions: ["콜 로그", "수용 확인 메모", "병상 요청 기록"],
      },
    ],
  },
  {
    id: "E",
    title: "이송 준비",
    description: "이송 실행 준비와 서류/동의 상태를 확인합니다.",
    items: [
      {
        id: "Q_D1",
        prompt: "이송 전 안정화·장비·약제 준비 완료?",
        helper: "이송 중 필요한 장비/약제/모니터링 준비를 기록하세요.",
        evidenceOptions: ["이송 체크리스트", "약제 준비", "장비 점검"],
      },
      {
        id: "Q_D2",
        prompt: "동승 인력/PPE 계획 완료?",
        helper: "동승 인력과 감염보호 계획을 메모하세요.",
        evidenceOptions: ["동승 인력", "PPE 계획", "이송 동선"],
      },
      {
        id: "Q_D3",
        prompt: "동의/서류/의무기록 송부 준비?",
        helper: "동의서, 의뢰서, 의무기록 전달 상태를 정리하세요.",
        evidenceOptions: ["동의서", "의뢰서", "의무기록 송부"],
      },
    ],
  },
]

const CONDITION_DEFINITIONS: ConditionChecklistDefinition[] = [
  {
    id: "pneumonia",
    label: "폐렴",
    description: "호흡 악화 및 환기 단계업 위험을 점검합니다.",
    items: [
      {
        id: "Q_P1",
        prompt: "6h 내 산소요구↑/호흡 악화 지속?",
        helper: "SpO2, 산소량, 호흡수 추세를 함께 확인해 메모하세요.",
        evidenceOptions: ["SpO2 추세", "산소요법", "호흡수"],
      },
      {
        id: "Q_P2",
        prompt: "환기 단계업(HFNC/NIV/IMV) 가능성 높음?",
        helper: "현재 산소 전략으로 유지 가능한지 임상 판단을 남기세요.",
        evidenceOptions: ["HFNC 필요 여부", "ABG", "호흡곤란 징후"],
      },
      {
        id: "Q_P3",
        prompt: "고위험(고령/다엽성/의식/저혈압)에서 현재 기관 유지 가능?",
        helper: "고위험 인자와 현 병원 유지 가능성을 수동 판단으로 기록하세요.",
        evidenceOptions: ["연령/기저질환", "영상 소견", "혈압 추세"],
      },
    ],
  },
  {
    id: "sepsis",
    label: "패혈증",
    description: "쇼크 신호와 번들 수행 가능 여부를 점검합니다.",
    items: [
      {
        id: "Q_S1",
        prompt: "저혈압/젖산/의식 변화 등 쇼크 신호?",
        helper: "혈압, 젖산, 의식 상태를 종합해 위험도를 기록하세요.",
        evidenceOptions: ["SBP/MAP", "Lactate", "의식수준"],
      },
      {
        id: "Q_S2",
        prompt: "패혈증 번들 즉시 수행 가능?",
        helper: "배양, 항생제, 수액 등 즉시 수행 가능한 범위를 남기세요.",
        evidenceOptions: ["배양 채취", "항생제 투여", "수액 소생"],
      },
      {
        id: "Q_S3",
        prompt: "원인 감염원 컨트롤 지연 예상?",
        helper: "소스 컨트롤 지연 요인과 대안 계획을 메모하세요.",
        evidenceOptions: ["시술 가능성", "외과/IR 협진", "지연 사유"],
      },
    ],
  },
  {
    id: "uti",
    label: "요로감염",
    description: "폐쇄·농신증 및 쇼크 진행 위험을 점검합니다.",
    items: [
      {
        id: "Q_U1",
        prompt: "6h 내 혈압/의식/호흡 악화 → 패혈증 진행 의심?",
        helper: "단시간 악화 신호가 있는지 추세 중심으로 기록하세요.",
        evidenceOptions: ["혈압 추세", "의식 변화", "호흡수"],
      },
      {
        id: "Q_U2",
        prompt: "폐쇄/농신증 의심 → 즉시 감압 라인 필요?",
        helper: "폐쇄 의심 근거와 감압 가능 시점을 메모하세요.",
        evidenceOptions: ["신우확장 소견", "요량", "비뇨기 협진"],
      },
      {
        id: "Q_U3",
        prompt: "쇼크 진행 시 승압제/ICU 단계업 가능?",
        helper: "현재 기관에서 단계업 가능한 자원 여부를 남기세요.",
        evidenceOptions: ["승압제 가용", "ICU 병상", "모니터링 인력"],
      },
    ],
  },
  {
    id: "mdro",
    label: "MDRO",
    description: "격리·감염관리 역량과 중증 대응 가능성을 점검합니다.",
    items: [
      {
        id: "Q_M1",
        prompt: "격리/코호트 즉시 적용 가능?",
        helper: "격리실/코호트 적용 가능 여부와 시점을 기록하세요.",
        evidenceOptions: ["격리병실", "코호트 가능", "격리 시작 시각"],
      },
      {
        id: "Q_M2",
        prompt: "감수성 해석/항생제 선택 컨설트 라인 충분?",
        helper: "감염내과/약제팀 협진 라인과 대응 속도를 메모하세요.",
        evidenceOptions: ["AST 결과", "감염내과 협진", "항생제 변경 계획"],
      },
      {
        id: "Q_M3",
        prompt: "중증 악화 시 ICU 단계업 가능?",
        helper: "악화 시 ICU 이행 동선과 수용 가능성을 기록하세요.",
        evidenceOptions: ["ICU 병상", "전담 인력", "이송 동선"],
      },
    ],
  },
  {
    id: "gi",
    label: "GI 감염",
    description: "탈수·전해질 이상 및 집단발생 대응을 점검합니다.",
    items: [
      {
        id: "Q_G1",
        prompt: "탈수/저혈압/의식저하 또는 전해질 이상 위험?",
        helper: "탈수/쇼크 위험 신호를 중심으로 수동 판단을 기록하세요.",
        evidenceOptions: ["혈압", "전해질", "의식수준"],
      },
      {
        id: "Q_G2",
        prompt: "지속 구토/경구불가로 정주 수액·관찰 필요?",
        helper: "경구 불가 여부와 수액/관찰 계획을 메모하세요.",
        evidenceOptions: ["구토/설사 횟수", "I/O", "정주 수액 계획"],
      },
      {
        id: "Q_G3",
        prompt: "집단발생 가능 + 동선/격리 대응 가능?",
        helper: "동선 분리와 접촉자 관리 가능 여부를 기록하세요.",
        evidenceOptions: ["접촉자 현황", "격리 동선", "환경소독 계획"],
      },
    ],
  },
]

const CONDITION_KEYWORDS: Record<ConditionId, string[]> = {
  pneumonia: ["폐렴", "pneumonia", "cap"],
  sepsis: ["패혈증", "sepsis", "septic"],
  uti: ["요로", "uti", "urinary"],
  mdro: ["mdro", "cre", "mrsa", "vre", "다제내성"],
  gi: ["gi감염", "장염", "gastroenteritis", "c. difficile", "cdiff", "clostridium", "설사", "구토"],
}

const NOTE_CATEGORY_OPTIONS: NoteCategory[] = ["Reason", "Risk", "Requests", "Consent"]
const CONDITION_IDS: ConditionId[] = ["pneumonia", "sepsis", "uti", "mdro", "gi"]
const NOTE_CATEGORY_SET = new Set<NoteCategory>(NOTE_CATEGORY_OPTIONS)

function normalizeConditionId(value: unknown): ConditionId | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return CONDITION_IDS.includes(normalized as ConditionId) ? (normalized as ConditionId) : null
}

function normalizeNoteCategory(value: unknown): NoteCategory | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return NOTE_CATEGORY_SET.has(normalized as NoteCategory) ? (normalized as NoteCategory) : null
}

function inferConditionsFromPatient(patient: Patient | null): ConditionId[] {
  if (!patient) return []

  const collectMatchedConditions = (text: string): ConditionId[] => {
    const haystack = text.toLowerCase()
    return (Object.entries(CONDITION_KEYWORDS) as Array<[ConditionId, string[]]>)
      .filter(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)))
      .map(([condition]) => condition)
  }

  const fromPrimary = collectMatchedConditions(patient.primaryDisease ?? "")
  if (fromPrimary.length > 0) return Array.from(new Set(fromPrimary))

  const fromDiagnosis = collectMatchedConditions(patient.diagnosis ?? "")
  return Array.from(new Set(fromDiagnosis))
}

function getDefaultConditions(patient: Patient | null): ConditionId[] {
  return inferConditionsFromPatient(patient)
}

function createEmptyItemDraft(): ItemDraft {
  return {
    reviewed: false,
    note: "",
    references: [],
    noteOpen: false,
    evidenceOpen: false,
  }
}

function createEmptyPatientDraft(): PatientDraft {
  return {
    items: {},
    quickNotes: [],
  }
}

function toSnapshotState(
  patientDraft: PatientDraft,
  activeConditionIds: ConditionId[],
): TransferChecklistSnapshotState {
  const items: TransferChecklistSnapshotState["items"] = {}
  for (const [itemId, itemDraft] of Object.entries(patientDraft.items)) {
    const note = itemDraft.note.trim()
    const references = Array.from(
      new Set(
        itemDraft.references
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    )
    if (!itemDraft.reviewed && !note && references.length === 0) continue
    items[itemId] = {
      reviewed: itemDraft.reviewed,
      note,
      references,
    }
  }

  const quick_notes = patientDraft.quickNotes
    .map((note) => ({
      id: note.id,
      text: note.text.trim(),
      category: note.category,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    }))
    .filter((note) => note.text.length > 0)

  return {
    active_condition_ids: activeConditionIds,
    items,
    quick_notes,
  }
}

function fromSnapshotState(
  rawState: TransferChecklistSnapshotState | null | undefined,
  fallbackConditions: ConditionId[],
): { draft: PatientDraft; activeConditionIds: ConditionId[] } {
  const state = rawState ?? {
    active_condition_ids: [],
    items: {},
    quick_notes: [],
  }

  const activeConditionIds = Array.from(
    new Set(
      (state.active_condition_ids ?? [])
        .map((value) => normalizeConditionId(value))
        .filter((value): value is ConditionId => value != null),
    ),
  )
  const resolvedConditionIds = activeConditionIds.length > 0 ? activeConditionIds : fallbackConditions

  const items: Record<string, ItemDraft> = {}
  const rawItems = state.items ?? {}
  for (const [itemId, rawItem] of Object.entries(rawItems)) {
    const reviewed = Boolean(rawItem?.reviewed)
    const note = typeof rawItem?.note === "string" ? rawItem.note : ""
    const references = Array.isArray(rawItem?.references)
      ? Array.from(new Set(rawItem.references.map((value) => String(value ?? "").trim()).filter(Boolean)))
      : []

    if (!reviewed && !note.trim() && references.length === 0) continue
    items[itemId] = {
      reviewed,
      note,
      references,
      noteOpen: false,
      evidenceOpen: false,
    }
  }

  const quickNotes: QuickNote[] = Array.isArray(state.quick_notes)
    ? state.quick_notes
      .map((note) => {
        const text = String(note?.text ?? "").trim()
        if (!text) return null
        const category = normalizeNoteCategory(note?.category)
        const createdAt = Number(note?.created_at)
        const updatedAt = Number(note?.updated_at)
        return {
          id: String(note?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
          text,
          category,
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
        }
      })
      .filter((note): note is QuickNote => note != null)
    : []

  return {
    draft: { items, quickNotes },
    activeConditionIds: resolvedConditionIds,
  }
}

function getReviewState(item: ItemDraft): ReviewState {
  if (item.reviewed) return "reviewed"
  if (item.note.trim().length > 0 || item.references.length > 0) return "in_progress"
  return "not_reviewed"
}

const REVIEW_STATE_STYLE: Record<ReviewState, string> = {
  not_reviewed: "border-border bg-background text-muted-foreground",
  in_progress: "border-border bg-muted text-muted-foreground",
  reviewed: "border-primary/35 bg-primary/10 text-primary",
}

const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  not_reviewed: "미검토",
  in_progress: "검토중",
  reviewed: "검토완료",
}

function formatNoteTime(timestamp: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function formatAdmissionForDisplay(patient: Patient): string {
  const dateStr = patient.admittedAtDemo ?? patient.simAdmitDate ?? patient.admissionDate
  if (!dateStr) return "-"
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })
}

function ChecklistRow({
  item,
  draft,
  onToggleReviewed,
  onToggleReference,
  onToggleNote,
  onToggleEvidenceOpen,
  onNoteChange,
}: {
  item: ManualChecklistItem
  draft: ItemDraft
  onToggleReviewed: (checked: boolean) => void
  onToggleReference: (reference: string) => void
  onToggleNote: () => void
  onToggleEvidenceOpen: () => void
  onNoteChange: (value: string) => void
}) {
  const state = getReviewState(draft)

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        draft.reviewed ? "border-primary/45 bg-primary/5" : "border-border bg-card"
      )}
    >
      <button
        type="button"
        onClick={() => onToggleReviewed(!draft.reviewed)}
        aria-pressed={draft.reviewed}
        className="w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-foreground">{item.prompt}</p>
          <Badge variant="outline" className={cn("shrink-0 text-[11px]", REVIEW_STATE_STYLE[state])}>
            {REVIEW_STATE_LABEL[state]}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{item.helper}</p>
      </button>

      <div className="mt-2 flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onToggleNote}>
          {draft.noteOpen || draft.note.trim().length > 0 ? "Edit note" : "Add note"}
        </Button>
        {draft.references.length > 0 && (
          <span className="text-[11px] text-muted-foreground">{draft.references.length}개 근거 첨부</span>
        )}
      </div>

      {draft.noteOpen && (
        <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-muted/20 p-2.5">
          <Textarea
            value={draft.note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="해당 항목에 대한 판단 메모를 입력하세요."
            className="min-h-[62px] text-sm"
          />
          <div className="space-y-2">
            <button
              type="button"
              onClick={onToggleEvidenceOpen}
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Attach evidence
            </button>
            {draft.evidenceOpen && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-background p-2">
                {item.evidenceOptions.map((ref) => {
                  const selected = draft.references.includes(ref)
                  return (
                    <button
                      key={ref}
                      type="button"
                      onClick={() => onToggleReference(ref)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        selected
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {ref}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function TransferChecklist({ patients, initialPatientId, onBack }: TransferChecklistProps) {
  const router = useRouter()
  const { demoStep, demoShift } = useDemoClock()
  const [selectedPatientId, setSelectedPatientId] = useState(() => {
    if (initialPatientId && patients.some((patient) => patient.id === initialPatientId)) {
      return initialPatientId
    }
    return patients[0]?.id ?? ""
  })
  const [activeSection, setActiveSection] = useState<SectionId>("A")
  const [draftByPatient, setDraftByPatient] = useState<Record<string, PatientDraft>>({})
  const [activeConditionsByPatient, setActiveConditionsByPatient] = useState<Record<string, ConditionId[]>>({})
  const [quickNoteInput, setQuickNoteInput] = useState("")
  const [quickNoteCategory, setQuickNoteCategory] = useState<NoteCategory | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState("")
  const [editingNoteCategory, setEditingNoteCategory] = useState<NoteCategory | null>(null)
  const [isLoadingSnapshot, setIsLoadingSnapshot] = useState(false)
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittedByContext, setSubmittedByContext] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (initialPatientId && patients.some((patient) => patient.id === initialPatientId)) {
      setSelectedPatientId(initialPatientId)
    }
  }, [initialPatientId, patients])

  useEffect(() => {
    setQuickNoteInput("")
    setQuickNoteCategory(null)
    setEditingNoteId(null)
    setEditingNoteText("")
    setEditingNoteCategory(null)
  }, [selectedPatientId])

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? null,
    [patients, selectedPatientId]
  )
  const checklistContextKey = useMemo(() => {
    if (!selectedPatientId) return ""
    return `${selectedPatientId}::${demoStep ?? "none"}::${demoShift ?? "none"}`
  }, [demoShift, demoStep, selectedPatientId])
  const defaultConditionIds = useMemo(
    () => getDefaultConditions(selectedPatient),
    [selectedPatient],
  )

  useEffect(() => {
    if (!selectedPatientId || !selectedPatient) return
    let cancelled = false
    setIsLoadingSnapshot(true)

    fetchLatestTransferChecklistSnapshot(selectedPatientId, { demoStep, demoShift })
      .then((snapshot) => {
        if (cancelled) return
        if (!snapshot?.state) {
          setDraftByPatient((prev) => ({
            ...prev,
            [selectedPatientId]: createEmptyPatientDraft(),
          }))
          setActiveConditionsByPatient((prev) => ({
            ...prev,
            [selectedPatientId]: defaultConditionIds,
          }))
          setSubmittedByContext((prev) => ({
            ...prev,
            [checklistContextKey]: false,
          }))
          return
        }

        const restored = fromSnapshotState(snapshot.state, defaultConditionIds)
        setDraftByPatient((prev) => ({
          ...prev,
          [selectedPatientId]: restored.draft,
        }))
        setActiveConditionsByPatient((prev) => ({
          ...prev,
          [selectedPatientId]: restored.activeConditionIds,
        }))
        setSubmittedByContext((prev) => ({
          ...prev,
          [checklistContextKey]: snapshot.action === "submit",
        }))
      })
      .catch((error) => {
        if (cancelled) return
        console.warn("[transfer-checklist] snapshot load failed:", error)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSnapshot(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [checklistContextKey, defaultConditionIds, demoShift, demoStep, selectedPatient, selectedPatientId])

  useEffect(() => {
    if (!selectedPatientId || !selectedPatient) return
    setActiveConditionsByPatient((prev) => {
      if (prev[selectedPatientId]) return prev
      return {
        ...prev,
        [selectedPatientId]: defaultConditionIds,
      }
    })
  }, [defaultConditionIds, selectedPatient, selectedPatientId])

  const activeConditionIds = useMemo(() => {
    if (!selectedPatientId) return []
    return activeConditionsByPatient[selectedPatientId] ?? []
  }, [activeConditionsByPatient, selectedPatientId])

  const activeConditionDefinitions = useMemo(() => {
    return activeConditionIds
      .map((conditionId) => CONDITION_DEFINITIONS.find((condition) => condition.id === conditionId))
      .filter((condition): condition is ConditionChecklistDefinition => Boolean(condition))
  }, [activeConditionIds])

  const conditionItems = useMemo(
    () => activeConditionDefinitions.flatMap((condition) => condition.items),
    [activeConditionDefinitions]
  )

  const allItems = useMemo(
    () =>
      SECTION_DEFINITIONS.flatMap((section) =>
        section.id === "A" ? [...section.items, ...conditionItems] : section.items
      ),
    [conditionItems]
  )

  const patientDraft = useMemo(() => {
    if (!selectedPatientId) return createEmptyPatientDraft()
    return draftByPatient[selectedPatientId] ?? createEmptyPatientDraft()
  }, [draftByPatient, selectedPatientId])

  const updateItemDraft = useCallback(
    (itemId: string, updater: (draft: ItemDraft) => ItemDraft) => {
      if (!selectedPatientId) return
      if (checklistContextKey) {
        setSubmittedByContext((prev) => ({
          ...prev,
          [checklistContextKey]: false,
        }))
      }

      setDraftByPatient((prev) => {
        const currentPatientDraft = prev[selectedPatientId] ?? createEmptyPatientDraft()
        const currentItemDraft = currentPatientDraft.items[itemId] ?? createEmptyItemDraft()

        return {
          ...prev,
          [selectedPatientId]: {
            ...currentPatientDraft,
            items: {
              ...currentPatientDraft.items,
              [itemId]: updater(currentItemDraft),
            },
          },
        }
      })
    },
    [checklistContextKey, selectedPatientId]
  )

  const updatePatientDraft = useCallback(
    (updater: (draft: PatientDraft) => PatientDraft) => {
      if (!selectedPatientId) return
      if (checklistContextKey) {
        setSubmittedByContext((prev) => ({
          ...prev,
          [checklistContextKey]: false,
        }))
      }
      setDraftByPatient((prev) => {
        const currentPatientDraft = prev[selectedPatientId] ?? createEmptyPatientDraft()
        return {
          ...prev,
          [selectedPatientId]: updater(currentPatientDraft),
        }
      })
    },
    [checklistContextKey, selectedPatientId]
  )

  const toggleCondition = useCallback(
    (conditionId: ConditionId) => {
      if (!selectedPatientId) return
      if (checklistContextKey) {
        setSubmittedByContext((prev) => ({
          ...prev,
          [checklistContextKey]: false,
        }))
      }
      setActiveConditionsByPatient((prev) => {
        const current = prev[selectedPatientId] ?? getDefaultConditions(selectedPatient)
        if (current.includes(conditionId) && current.length === 1) {
          toast.message("질병별 체크리스트는 최소 1개 이상 선택되어야 합니다.")
          return prev
        }
        const next = current.includes(conditionId)
          ? current.filter((value) => value !== conditionId)
          : [...current, conditionId]

        return {
          ...prev,
          [selectedPatientId]: next,
        }
      })
    },
    [checklistContextKey, selectedPatient, selectedPatientId]
  )

  const addQuickNote = useCallback(() => {
    const text = quickNoteInput.trim()
    if (!text) return

    updatePatientDraft((draft) => ({
      ...draft,
      quickNotes: [
        ...draft.quickNotes,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text,
          category: quickNoteCategory,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }))

    setQuickNoteInput("")
    setQuickNoteCategory(null)
  }, [quickNoteCategory, quickNoteInput, updatePatientDraft])

  const startQuickNoteEdit = useCallback((note: QuickNote) => {
    setEditingNoteId(note.id)
    setEditingNoteText(note.text)
    setEditingNoteCategory(note.category)
  }, [])

  const saveQuickNoteEdit = useCallback(() => {
    if (!editingNoteId) return
    const text = editingNoteText.trim()
    if (!text) return

    updatePatientDraft((draft) => ({
      ...draft,
      quickNotes: draft.quickNotes.map((note) =>
        note.id === editingNoteId
          ? {
              ...note,
              text,
              category: editingNoteCategory,
              updatedAt: Date.now(),
            }
          : note
      ),
    }))

    setEditingNoteId(null)
    setEditingNoteText("")
    setEditingNoteCategory(null)
  }, [editingNoteCategory, editingNoteId, editingNoteText, updatePatientDraft])

  const deleteQuickNote = useCallback(
    (noteId: string) => {
      updatePatientDraft((draft) => ({
        ...draft,
        quickNotes: draft.quickNotes.filter((note) => note.id !== noteId),
      }))
      if (editingNoteId === noteId) {
        setEditingNoteId(null)
        setEditingNoteText("")
        setEditingNoteCategory(null)
      }
    },
    [editingNoteId, updatePatientDraft]
  )

  const sectionStats = useMemo(() => {
    return new Map(
      SECTION_DEFINITIONS.map((section) => {
        const sectionItems = section.id === "A" ? [...section.items, ...conditionItems] : section.items
        const reviewed = sectionItems.reduce((count, item) => {
          const draft = patientDraft.items[item.id] ?? createEmptyItemDraft()
          return count + (getReviewState(draft) === "reviewed" ? 1 : 0)
        }, 0)

        return [section.id, { reviewed, total: sectionItems.length }]
      })
    )
  }, [conditionItems, patientDraft.items])

  const conditionStats = useMemo(() => {
    return activeConditionDefinitions.reduce(
      (acc, condition) => {
        const reviewed = condition.items.reduce((count, item) => {
          const draft = patientDraft.items[item.id] ?? createEmptyItemDraft()
          return count + (getReviewState(draft) === "reviewed" ? 1 : 0)
        }, 0)
        return {
          reviewed: acc.reviewed + reviewed,
          total: acc.total + condition.items.length,
        }
      },
      { reviewed: 0, total: 0 }
    )
  }, [activeConditionDefinitions, patientDraft.items])

  const reviewedCount = useMemo(() => {
    return allItems.reduce((count, item) => {
      const draft = patientDraft.items[item.id] ?? createEmptyItemDraft()
      return count + (getReviewState(draft) === "reviewed" ? 1 : 0)
    }, 0)
  }, [allItems, patientDraft.items])

  const inProgressCount = useMemo(() => {
    return allItems.reduce((count, item) => {
      const draft = patientDraft.items[item.id] ?? createEmptyItemDraft()
      return count + (getReviewState(draft) === "in_progress" ? 1 : 0)
    }, 0)
  }, [allItems, patientDraft.items])

  const totalCount = allItems.length
  const progressPercent = totalCount === 0 ? 0 : Math.round((reviewedCount / totalCount) * 100)

  const overallState: ReviewState =
    reviewedCount === totalCount && totalCount > 0
      ? "reviewed"
      : reviewedCount > 0 || inProgressCount > 0
        ? "in_progress"
        : "not_reviewed"
  const isSubmitted = checklistContextKey ? submittedByContext[checklistContextKey] === true : false
  const canSubmit = totalCount > 0 && reviewedCount === totalCount

  const activeSectionDefinition =
    SECTION_DEFINITIONS.find((section) => section.id === activeSection) ?? SECTION_DEFINITIONS[0]
  const activeSectionItems =
    activeSectionDefinition.id === "A"
      ? [...activeSectionDefinition.items, ...conditionItems]
      : activeSectionDefinition.items

  const handleSaveDraft = useCallback(async () => {
    if (!selectedPatientId || !selectedPatient) {
      toast.error("환자를 먼저 선택하세요.")
      return
    }

    try {
      setIsSavingSnapshot(true)
      const state = toSnapshotState(patientDraft, activeConditionIds)
      await saveTransferChecklistSnapshot({
        patient_id: selectedPatientId,
        patient_name: selectedPatient.name,
        state,
        summary: {
          reviewedCount,
          inProgressCount,
          totalCount,
          progressPercent,
          overallState,
        },
        demoStep,
        demoShift,
      })
      toast.success("임시저장 완료")
    } catch (error) {
      const message = error instanceof Error ? error.message : "임시저장에 실패했습니다."
      toast.error(message)
    } finally {
      setIsSavingSnapshot(false)
    }
  }, [
    activeConditionIds,
    demoShift,
    demoStep,
    inProgressCount,
    overallState,
    patientDraft,
    progressPercent,
    reviewedCount,
    selectedPatient,
    selectedPatientId,
    totalCount,
  ])

  const handleSubmitChecklist = useCallback(async () => {
    if (!selectedPatientId || !selectedPatient) {
      toast.error("환자를 먼저 선택하세요.")
      return
    }

    try {
      setIsSubmitting(true)
      const state = toSnapshotState(patientDraft, activeConditionIds)
      const result = await submitTransferChecklist({
        patient_id: selectedPatientId,
        patient_name: selectedPatient.name,
        state,
        summary: {
          reviewedCount,
          inProgressCount,
          totalCount,
          progressPercent,
          overallState,
        },
        demoStep,
        demoShift,
      })
      if (result.validation.warnings.length > 0) {
        toast.success(`제출 완료 (주의 ${result.validation.warnings.length}건)`)
      } else {
        toast.success("제출 완료")
      }
      if (checklistContextKey) {
        setSubmittedByContext((prev) => ({
          ...prev,
          [checklistContextKey]: true,
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "제출에 실패했습니다."
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    activeConditionIds,
    demoShift,
    demoStep,
    inProgressCount,
    overallState,
    patientDraft,
    progressPercent,
    reviewedCount,
    selectedPatient,
    selectedPatientId,
    checklistContextKey,
    totalCount,
  ])

  const handleGenerateDraft = useCallback(() => {
    const params = new URLSearchParams({
      view: "autodraft",
      docType: "referral",
    })
    if (selectedPatientId) {
      params.set("patientId", selectedPatientId)
    }
    router.push(`/?${params.toString()}`)
  }, [router, selectedPatientId])

  const renderChecklistRow = (item: ManualChecklistItem) => {
    const draft = patientDraft.items[item.id] ?? createEmptyItemDraft()

    return (
      <ChecklistRow
        key={item.id}
        item={item}
        draft={draft}
        onToggleReviewed={(checked) =>
          updateItemDraft(item.id, (prev) => ({
            ...prev,
            reviewed: checked,
          }))
        }
        onToggleReference={(reference) =>
          updateItemDraft(item.id, (prev) => {
            const exists = prev.references.includes(reference)
            return {
              ...prev,
              references: exists
                ? prev.references.filter((value) => value !== reference)
                : [...prev.references, reference],
            }
          })
        }
        onToggleNote={() =>
          updateItemDraft(item.id, (prev) => ({
            ...prev,
            noteOpen: !prev.noteOpen,
            evidenceOpen: prev.noteOpen ? false : prev.evidenceOpen,
          }))
        }
        onToggleEvidenceOpen={() =>
          updateItemDraft(item.id, (prev) => ({
            ...prev,
            evidenceOpen: !prev.evidenceOpen,
            noteOpen: true,
          }))
        }
        onNoteChange={(value) =>
          updateItemDraft(item.id, (prev) => ({
            ...prev,
            note: value,
            noteOpen: true,
          }))
        }
      />
    )
  }

  if (!selectedPatient) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">선택된 환자가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="sticky top-0 z-30 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-none backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {onBack && (
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onBack}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}

              <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                <SelectTrigger className="h-8 w-full min-w-0 text-xs sm:w-[260px]">
                  <SelectValue placeholder="환자 선택" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id} className="text-xs">
                      {(patient.roomNumber ? `${patient.roomNumber}호` : "호실 미지정")} / {patient.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Badge
                variant="outline"
                className={cn(
                  "text-[11px]",
                  isSubmitted
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : REVIEW_STATE_STYLE[overallState],
                )}
              >
                {isSubmitted ? "제출완료" : REVIEW_STATE_LABEL[overallState]}
              </Badge>
              <Badge variant="outline" className="text-[11px] text-muted-foreground">
                {reviewedCount}/{totalCount} 검토완료
              </Badge>
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedPatient.name}</span>
              <span>{selectedPatient.ward} / {selectedPatient.roomNumber}호</span>
              <span>진단: {selectedPatient.diagnosis ?? "-"}</span>
              <span>입원: {formatAdmissionForDisplay(selectedPatient)}</span>
            </div>

            <div className="max-w-md space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>검토 진행률</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-1.5" />
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto">
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveDraft}
                disabled={isSavingSnapshot || isLoadingSnapshot || isSubmitting}
              >
                {isSavingSnapshot ? "저장 중..." : "임시저장"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSubmitChecklist}
                disabled={!canSubmit || isLoadingSnapshot || isSavingSnapshot || isSubmitting}
                className={cn(
                  canSubmit
                    ? "bg-white text-foreground hover:bg-muted"
                    : "bg-muted/40 text-muted-foreground",
                )}
              >
                {isSubmitting ? "제출 중..." : "제출"}
              </Button>
              <Button type="button" className="gap-1.5" onClick={handleGenerateDraft}>
                <FileText className="h-4 w-4" />
                의뢰서 초안 생성
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground sm:text-right">
              {isLoadingSnapshot
                ? "저장된 체크리스트를 불러오는 중..."
                : "Notes will be used to draft the referral letter."}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">섹션</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {SECTION_DEFINITIONS.map((section) => {
                const stats = sectionStats.get(section.id)
                const isActive = section.id === activeSection

                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "w-full rounded-lg border px-3 text-left transition-colors",
                      isActive
                        ? "border-primary/50 bg-primary/5 py-2.5 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
                        : "border-border bg-background py-1.5 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {section.id}. {section.title}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {stats?.reviewed ?? 0}/{stats?.total ?? 0}
                      </span>
                    </div>
                    {isActive && <p className="mt-1 text-[11px] text-muted-foreground">{section.description}</p>}
                  </button>
                )
              })}
            </CardContent>
          </Card>
        </aside>

        <section className="min-w-0 space-y-3">
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {activeSectionDefinition.id}. {activeSectionDefinition.title}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{activeSectionDefinition.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeSectionDefinition.id === "A" ? (
                <>
                  <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-1.5 text-sm">
                        <Stethoscope className="h-4 w-4" />
                        질병별 체크리스트
                      </CardTitle>
                      <Badge variant="outline" className="text-[11px] text-muted-foreground">
                        {conditionStats.reviewed}/{conditionStats.total} 검토완료
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      환자 진단에 맞는 질병을 선택하면 질병별 항목을 수동으로 검토할 수 있습니다.
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {CONDITION_DEFINITIONS.map((condition) => {
                        const selected = activeConditionIds.includes(condition.id)
                        return (
                          <button
                            key={condition.id}
                            type="button"
                            onClick={() => toggleCondition(condition.id)}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                              selected
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-muted"
                            )}
                          >
                            {condition.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {activeSectionDefinition.items.map(renderChecklistRow)}

                  {activeConditionDefinitions.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                      질병을 선택하면 질병별 체크리스트가 표시됩니다.
                    </div>
                  ) : (
                    activeConditionDefinitions.map((condition) => {
                      const reviewed = condition.items.reduce((count, item) => {
                        const draft = patientDraft.items[item.id] ?? createEmptyItemDraft()
                        return count + (getReviewState(draft) === "reviewed" ? 1 : 0)
                      }, 0)

                      return (
                        <div
                          key={condition.id}
                          className="space-y-2.5 rounded-lg border border-border bg-background/40 p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-foreground">{condition.label}</p>
                            <span className="text-[11px] text-muted-foreground">
                              {reviewed}/{condition.items.length}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">{condition.description}</p>
                          <div className="space-y-2">{condition.items.map(renderChecklistRow)}</div>
                        </div>
                      )
                    })
                  )}
                </>
              ) : activeSectionItems.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  표시할 체크리스트 항목이 없습니다.
                </div>
              ) : (
                activeSectionItems.map(renderChecklistRow)
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <StickyNote className="h-4 w-4" />
                Quick Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={quickNoteInput}
                    onChange={(event) => setQuickNoteInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        addQuickNote()
                      }
                    }}
                    placeholder="Quick note..."
                    className="h-8 text-sm"
                  />
                  <Button type="button" size="sm" className="h-8 px-3" onClick={addQuickNote}>
                    Add
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQuickNoteCategory(null)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                      quickNoteCategory === null
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    No tag
                  </button>
                  {NOTE_CATEGORY_OPTIONS.map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setQuickNoteCategory(category)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                        quickNoteCategory === category
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {patientDraft.quickNotes.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                    아직 메모가 없습니다. 상단에 한 줄 메모를 바로 추가하세요.
                  </div>
                ) : (
                  patientDraft.quickNotes.map((note) => {
                    const isEditing = editingNoteId === note.id
                    return (
                      <div key={note.id} className="rounded-md border border-border bg-background p-2.5">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Input
                              value={editingNoteText}
                              onChange={(event) => setEditingNoteText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault()
                                  saveQuickNoteEdit()
                                }
                                if (event.key === "Escape") {
                                  setEditingNoteId(null)
                                  setEditingNoteText("")
                                  setEditingNoteCategory(null)
                                }
                              }}
                              className="h-8 text-sm"
                            />
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditingNoteCategory(null)}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                                  editingNoteCategory === null
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted"
                                )}
                              >
                                No tag
                              </button>
                              {NOTE_CATEGORY_OPTIONS.map((category) => (
                                <button
                                  key={category}
                                  type="button"
                                  onClick={() => setEditingNoteCategory(category)}
                                  className={cn(
                                    "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                                    editingNoteCategory === category
                                      ? "border-primary/40 bg-primary/10 text-primary"
                                      : "border-border text-muted-foreground hover:bg-muted"
                                  )}
                                >
                                  {category}
                                </button>
                              ))}
                            </div>
                            <div className="flex justify-end gap-1.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setEditingNoteId(null)
                                  setEditingNoteText("")
                                  setEditingNoteCategory(null)
                                }}
                              >
                                취소
                              </Button>
                              <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={saveQuickNoteEdit}>
                                저장
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => startQuickNoteEdit(note)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="text-sm text-foreground">{note.text}</p>
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteQuickNote(note.id)}
                                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                aria-label="노트 삭제"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-1 flex items-center gap-1.5">
                              {note.category && (
                                <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                                  {note.category}
                                </Badge>
                              )}
                              <span className="text-[11px] text-muted-foreground">{formatNoteTime(note.updatedAt)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              <Button type="button" className="w-full gap-1.5" onClick={handleGenerateDraft}>
                <FileText className="h-4 w-4" />
                의뢰서 초안 생성
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
