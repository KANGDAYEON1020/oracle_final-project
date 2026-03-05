// =============================================================
// Transfer Checklist Decision Engine Types
// Based on system prompt JSON schema
// =============================================================

/** 각 문항의 자동 판정 상태 */
export type ChecklistStatus = "PASS" | "CAUTION" | "FAIL" | "UNKNOWN"

/** 문항 유형: HARD_STOP은 FAIL 시 즉시 전원 강력 고려 */
export type QuestionType = "HARD_STOP" | "SOFT"

/** 전원 권고 레벨 */
export type TransferRecommendation = "STRONGLY_CONSIDER" | "CONSIDER" | "MONITOR"

/** 판정 신뢰도 */
export type Confidence = "HIGH" | "MEDIUM" | "LOW"

/** 추정 질환 */
export type SuspectedCondition = "pneumonia" | "uti" | "mdro" | "sepsis" | "gi"

// ─── Evidence ────────────────────────────────────────────────
export interface EvidenceItem {
    source: "vitals" | "labs" | "therapies" | "notes_summary" | "manual"
    time?: string
    key?: string
    value?: string | number
    text?: string
}

// ─── Question ────────────────────────────────────────────────
export interface ChecklistQuestion {
    id: string
    label: string
    type: QuestionType
    status: ChecklistStatus
    evidence: EvidenceItem[]
    explain: string
    action_hint?: string
}

// ─── Group (A ~ D) ──────────────────────────────────────────
export interface ChecklistGroup {
    group_id: string
    group_name: string
    questions: ChecklistQuestion[]
}

// ─── Condition-specific ─────────────────────────────────────
export interface ConditionChecklist {
    condition: SuspectedCondition
    enabled: boolean
    questions: ChecklistQuestion[]
    tip?: string
}

// ─── Soft Score ──────────────────────────────────────────────
export interface SoftScoreBreakdown {
    id: string
    points: number
    why: string
}

export interface SoftScore {
    total: number
    threshold_consider: number
    threshold_strong: number
    breakdown: SoftScoreBreakdown[]
}

// ─── Summary ─────────────────────────────────────────────────
export interface TransferSummary {
    transfer_recommendation: TransferRecommendation
    reason_top3: string[]
    hard_stops_triggered: string[]
    soft_score: SoftScore
    confidence: Confidence
    needed_data: string[]
}

// ─── Meta ────────────────────────────────────────────────────
export interface TransferMeta {
    patient_id: string
    generated_at: string
    assessed_window_hours: number
    suspected_conditions_used: SuspectedCondition[]
}

// ─── Full Result ─────────────────────────────────────────────
export interface TransferChecklistResult {
    meta: TransferMeta
    summary: TransferSummary
    checklist: ChecklistGroup[]
    condition_specific: ConditionChecklist[]
}
