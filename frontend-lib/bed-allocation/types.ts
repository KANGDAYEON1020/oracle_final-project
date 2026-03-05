// 감염 유형
export type InfectionType = "Pneumonia" | "UTI" | "Waterborne" | "Tick-borne" | "MDRO"

// 환자 이동 케이스 상태
export type CaseStatus = "WAITING" | "PLANNED" | "COMMITTED" | "NEEDS_EXCEPTION"

// 배치안 상태
export type PlanStatus = "DRAFT" | "READY_TO_COMMIT" | "COMMITTED" | "CANCELLED"

// 병동
export type WardId = "2F" | "3F" | "5F"

// 환자 정보
export interface Patient {
  id: string
  name: string
  age: number
  gender: "M" | "F"
  infection: InfectionType
  infectionLabel?: string
  pathogenFlags?: string[]  // 병원체 플래그 (e.g., ["mrsa", "diarrhea_symptomatic"])
  clinicalFlags?: string[]  // 임상 플래그 (e.g., ["uncontrolled_secretions"])
}

// 이동 케이스 (환자 이동 요청)
export interface TransferCase {
  id: string
  patient: Patient
  status: CaseStatus
  fromWard: WardId | null
  fromRoom: string | null
  toWard: WardId | null
  toRoom: string | null
  toBed: string | null
  reason: string // 격리, 격리해제, 수술후 등
  priority: "urgent" | "normal"
  createdAt: Date
  exceptionReason?: string
}

// 베드 슬롯
export interface BedSlot {
  id: string
  patient: Patient | null
  isGhost?: boolean // 가배치 표시용
  ghostPatient?: Patient | null
}

// 병실
export interface Room {
  id: string
  roomNo: string
  wardId: WardId
  capacity: 1 | 2 | 4
  beds: BedSlot[]
  cohortType: InfectionType | null
  cohortLabel?: string | null
  genderType: "M" | "F" | null // 현재 병실의 성별 (첫 환자 입실 시 결정)
  needsCleaning: boolean
  cleanedAt?: Date
  notes?: string
  isIsolation?: boolean
  isolationEndDate?: Date
  // Isolation rules fields
  cohortKey?: string | null  // e.g., "CONTACT|STAPH_AUREUS|METHICILLIN_RESIST|none"
  isolationType?: "STANDARD" | "CONTACT" | "DROPLET" | "AIRBORNE" | null
  tier?: "S" | "A" | "B" | null
  hasAIIR?: boolean  // 음압실 여부
  hasDedicatedToilet?: boolean  // 전용 화장실 여부
}

// 배치안
export interface Plan {
  id: string
  status: PlanStatus
  createdAt: Date
  createdBy: string
  scope: WardId[]
  items: PlanItem[]
}

// 배치안 항목
export interface PlanItem {
  caseId: string
  patient: Patient
  fromWard: WardId | null
  fromRoom: string | null
  toWard: WardId
  toRoom: string
  toBed: string
  conflict?: string // 충돌 이유
  tier?: "S" | "A" | "B" | null
  strategy?: "single" | "cohort_same_key_same_sex" | "multibed_with_precautions" | null
  admissionId?: number | null
  fromBedId?: string | null
  toRoomId?: string | null
}

// 알림
export type NotificationType =
  | "plan_created"
  | "confirmation_needed"
  | "exception_needed"
  | "committed"
  | "isolation"
  | "deterioration"
  | "pending_result"
  | "care_gap"
  | "cluster"

export interface Notification {
  id: string
  type: NotificationType
  message: string
  createdAt: Date
  read: boolean
  severity?: "ACTION" | "CRITICAL"
  severityNormalized?: "ACTION" | "CRITICAL"
  isCritical?: boolean
  patientId?: string | null
  admissionId?: number | null
  status?: "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED"
}

// 감염 타입별 색상
export const infectionColors: Record<InfectionType, { bg: string; border: string; text: string; badge: string }> = {
  Pneumonia: {
    bg: "bg-blue-500/20",
    border: "border-blue-500",
    text: "text-blue-400",
    badge: "bg-blue-500 text-white"
  },
  UTI: {
    bg: "bg-amber-500/20",
    border: "border-amber-500",
    text: "text-amber-400",
    badge: "bg-amber-500 text-black"
  },
  Waterborne: {
    bg: "bg-cyan-500/20",
    border: "border-cyan-500",
    text: "text-cyan-400",
    badge: "bg-cyan-500 text-black"
  },
  "Tick-borne": {
    bg: "bg-rose-500/20",
    border: "border-rose-500",
    text: "text-rose-400",
    badge: "bg-rose-500 text-white"
  },
  MDRO: {
    bg: "bg-purple-500/20",
    border: "border-purple-500",
    text: "text-purple-400",
    badge: "bg-purple-500 text-white"
  },
}

// 병동별 아이콘/라벨
export const wardInfo: Record<WardId, { label: string; description: string }> = {
  "2F": { label: "2층", description: "일반 병동" },
  "3F": { label: "3층", description: "수술 후 병동" },
  "5F": { label: "5층", description: "격리 병동" },
}
