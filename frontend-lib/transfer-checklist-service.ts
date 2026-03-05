import {
  type DemoQueryParams,
  appendDemoParams,
  buildPathWithQuery,
  readDemoQueryFromStorage,
} from "./demo-query"

function normalizeApiBase(base?: string): string {
  const resolved = (base && base.trim()) || "/api"
  const withoutTrailingSlash = resolved.endsWith("/") ? resolved.slice(0, -1) : resolved
  if (!withoutTrailingSlash || withoutTrailingSlash === "/") return "/api"
  if (/\/api$/i.test(withoutTrailingSlash)) return withoutTrailingSlash
  if (withoutTrailingSlash.startsWith("/") || /^https?:\/\//i.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}/api`
  }
  return withoutTrailingSlash
}

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL)

async function readErrorMessage(res: Response): Promise<string> {
  const fallback = `HTTP ${res.status}`
  try {
    const text = await res.text()
    if (!text) return fallback
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
      if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error
      if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message
      return text.slice(0, 300)
    } catch {
      return text.slice(0, 300)
    }
  } catch {
    return fallback
  }
}

export interface TransferChecklistSnapshotItem {
  reviewed: boolean
  note: string
  references: string[]
}

export interface TransferChecklistSnapshotQuickNote {
  id: string
  text: string
  category: string | null
  created_at: number
  updated_at: number
}

export interface TransferChecklistSnapshotState {
  active_condition_ids: string[]
  items: Record<string, TransferChecklistSnapshotItem>
  quick_notes: TransferChecklistSnapshotQuickNote[]
}

export interface TransferChecklistSnapshot {
  id: string
  patient_id: string
  patient_name?: string
  created_at: string
  timestamp?: string
  demo_step: number | null
  demo_shift: string | null
  action?: string
  summary?: Record<string, unknown>
  state: TransferChecklistSnapshotState
}

export interface SaveTransferChecklistSnapshotInput extends DemoQueryParams {
  patient_id: string
  patient_name?: string
  summary?: Record<string, unknown>
  state: TransferChecklistSnapshotState
}

export interface TransferChecklistValidationIssue {
  code: string
  message: string
  field?: string
  section_id?: string
  condition_id?: string
  item_ids?: string[]
  in_progress_count?: number
}

export interface TransferChecklistValidationResponse {
  patient_id: string
  demo_step: number | null
  demo_shift: string | null
  valid: boolean
  errors: TransferChecklistValidationIssue[]
  warnings: TransferChecklistValidationIssue[]
  summary: Record<string, unknown>
  state: TransferChecklistSnapshotState
}

export interface SubmitTransferChecklistResult {
  snapshot: TransferChecklistSnapshot
  validation: {
    valid: boolean
    errors: TransferChecklistValidationIssue[]
    warnings: TransferChecklistValidationIssue[]
  }
}

function sanitizeSnapshotState(
  state: TransferChecklistSnapshotState | Record<string, unknown> | undefined | null,
): TransferChecklistSnapshotState {
  const source = state && typeof state === "object" ? state : {}
  const activeConditionIdsRaw = (source as { active_condition_ids?: unknown }).active_condition_ids
  const itemsRaw = (source as { items?: unknown }).items
  const quickNotesRaw = (source as { quick_notes?: unknown }).quick_notes

  const active_condition_ids = Array.isArray(activeConditionIdsRaw)
    ? activeConditionIdsRaw.map((value) => String(value ?? "").trim()).filter(Boolean)
    : []

  const items: Record<string, TransferChecklistSnapshotItem> = {}
  if (itemsRaw && typeof itemsRaw === "object" && !Array.isArray(itemsRaw)) {
    for (const [itemId, rawItem] of Object.entries(itemsRaw as Record<string, unknown>)) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue
      const candidate = rawItem as {
        reviewed?: unknown
        note?: unknown
        references?: unknown
      }
      const reviewed = Boolean(candidate.reviewed)
      const note = typeof candidate.note === "string" ? candidate.note : ""
      const references = Array.isArray(candidate.references)
        ? candidate.references.map((value) => String(value ?? "").trim()).filter(Boolean)
        : []
      if (!reviewed && !note.trim() && references.length === 0) continue
      items[itemId] = { reviewed, note, references }
    }
  }

  const quick_notes: TransferChecklistSnapshotQuickNote[] = []
  if (Array.isArray(quickNotesRaw)) {
    for (const rawNote of quickNotesRaw) {
      if (!rawNote || typeof rawNote !== "object" || Array.isArray(rawNote)) continue
      const note = rawNote as {
        id?: unknown
        text?: unknown
        category?: unknown
        created_at?: unknown
        updated_at?: unknown
      }
      const text = typeof note.text === "string" ? note.text.trim() : ""
      if (!text) continue
      const idCandidate = typeof note.id === "string" ? note.id.trim() : ""
      const createdAt = Number(note.created_at)
      const updatedAt = Number(note.updated_at)
      quick_notes.push({
        id: idCandidate || `note-${Math.random().toString(36).slice(2, 9)}`,
        text,
        category: note.category == null ? null : String(note.category),
        created_at: Number.isFinite(createdAt) ? createdAt : Date.now(),
        updated_at: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      })
    }
  }

  return { active_condition_ids, items, quick_notes }
}

function sanitizeSnapshot(raw: unknown): TransferChecklistSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const id = String(row.id ?? "").trim()
  const patient_id = String(row.patient_id ?? "").trim()
  if (!id || !patient_id) return null

  return {
    id,
    patient_id,
    patient_name: typeof row.patient_name === "string" ? row.patient_name : undefined,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    timestamp: typeof row.timestamp === "string" ? row.timestamp : undefined,
    demo_step:
      row.demo_step == null ? null : Number.isFinite(Number(row.demo_step)) ? Number(row.demo_step) : null,
    demo_shift: row.demo_shift == null ? null : String(row.demo_shift),
    action: typeof row.action === "string" ? row.action : undefined,
    summary:
      row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
        ? (row.summary as Record<string, unknown>)
        : undefined,
    state: sanitizeSnapshotState(
      row.state as TransferChecklistSnapshotState | Record<string, unknown> | undefined,
    ),
  }
}

function sanitizeValidationIssue(raw: unknown): TransferChecklistValidationIssue | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const issue = raw as Record<string, unknown>
  const code = typeof issue.code === "string" ? issue.code.trim() : ""
  const message = typeof issue.message === "string" ? issue.message.trim() : ""
  if (!code || !message) return null
  return {
    code,
    message,
    field: typeof issue.field === "string" ? issue.field : undefined,
    section_id: typeof issue.section_id === "string" ? issue.section_id : undefined,
    condition_id: typeof issue.condition_id === "string" ? issue.condition_id : undefined,
    item_ids: Array.isArray(issue.item_ids) ? issue.item_ids.map((value) => String(value)) : undefined,
    in_progress_count:
      Number.isFinite(Number(issue.in_progress_count)) ? Number(issue.in_progress_count) : undefined,
  }
}

function sanitizeValidationResponse(raw: unknown): TransferChecklistValidationResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const patient_id = String(row.patient_id ?? "").trim()
  if (!patient_id) return null

  return {
    patient_id,
    demo_step:
      row.demo_step == null ? null : Number.isFinite(Number(row.demo_step)) ? Number(row.demo_step) : null,
    demo_shift: row.demo_shift == null ? null : String(row.demo_shift),
    valid: Boolean(row.valid),
    errors: Array.isArray(row.errors)
      ? row.errors
        .map((issue) => sanitizeValidationIssue(issue))
        .filter((issue): issue is TransferChecklistValidationIssue => issue != null)
      : [],
    warnings: Array.isArray(row.warnings)
      ? row.warnings
        .map((issue) => sanitizeValidationIssue(issue))
        .filter((issue): issue is TransferChecklistValidationIssue => issue != null)
      : [],
    summary:
      row.summary && typeof row.summary === "object" && !Array.isArray(row.summary)
        ? (row.summary as Record<string, unknown>)
        : {},
    state: sanitizeSnapshotState(
      row.state as TransferChecklistSnapshotState | Record<string, unknown> | undefined,
    ),
  }
}

export async function fetchLatestTransferChecklistSnapshot(
  patientId: string,
  demoInput?: DemoQueryParams,
): Promise<TransferChecklistSnapshot | null> {
  const patient_id = patientId.trim()
  if (!patient_id) return null

  const demo = demoInput ?? readDemoQueryFromStorage()
  const params = new URLSearchParams()
  params.set("patient_id", patient_id)
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/transfer-checklist/snapshots/latest`, params)

  const res = await fetch(url, { method: "GET", cache: "no-store" })
  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`API error: ${res.status} - ${detail}`)
  }

  const payload = (await res.json()) as { snapshot?: unknown }
  return sanitizeSnapshot(payload.snapshot)
}

export async function saveTransferChecklistSnapshot(
  input: SaveTransferChecklistSnapshotInput,
): Promise<TransferChecklistSnapshot> {
  const demo = {
    demoStep: input.demoStep ?? readDemoQueryFromStorage().demoStep,
    demoShift: input.demoShift ?? readDemoQueryFromStorage().demoShift,
  }

  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/transfer-checklist/snapshots`, params)

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient_id: input.patient_id,
      patient_name: input.patient_name,
      summary: input.summary ?? {},
      state: sanitizeSnapshotState(input.state),
      demoStep: demo.demoStep,
      demoShift: demo.demoShift,
    }),
  })

  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`API error: ${res.status} - ${detail}`)
  }

  const payload = (await res.json()) as { snapshot?: unknown }
  const snapshot = sanitizeSnapshot(payload.snapshot)
  if (!snapshot) {
    throw new Error("API error: snapshot payload is missing")
  }
  return snapshot
}

export async function validateTransferChecklist(
  input: SaveTransferChecklistSnapshotInput,
): Promise<TransferChecklistValidationResponse> {
  const demo = {
    demoStep: input.demoStep ?? readDemoQueryFromStorage().demoStep,
    demoShift: input.demoShift ?? readDemoQueryFromStorage().demoShift,
  }

  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/transfer-checklist/validate`, params)

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient_id: input.patient_id,
      patient_name: input.patient_name,
      summary: input.summary ?? {},
      state: sanitizeSnapshotState(input.state),
      demoStep: demo.demoStep,
      demoShift: demo.demoShift,
    }),
  })

  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`API error: ${res.status} - ${detail}`)
  }

  const payload = (await res.json()) as unknown
  const validation = sanitizeValidationResponse(payload)
  if (!validation) {
    throw new Error("API error: validation payload is missing")
  }
  return validation
}

export async function submitTransferChecklist(
  input: SaveTransferChecklistSnapshotInput,
): Promise<SubmitTransferChecklistResult> {
  const demo = {
    demoStep: input.demoStep ?? readDemoQueryFromStorage().demoStep,
    demoShift: input.demoShift ?? readDemoQueryFromStorage().demoShift,
  }

  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/transfer-checklist/submit`, params)

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient_id: input.patient_id,
      patient_name: input.patient_name,
      summary: input.summary ?? {},
      state: sanitizeSnapshotState(input.state),
      demoStep: demo.demoStep,
      demoShift: demo.demoShift,
    }),
  })

  const payload = (await res.json()) as { snapshot?: unknown; validation?: unknown } | unknown
  if (!res.ok) {
    if (res.status === 422) {
      const validation = sanitizeValidationResponse(payload)
      if (validation) {
        const reason = validation.errors[0]?.message || "서버 검증을 통과하지 못했습니다."
        throw new Error(reason)
      }
    }
    const detail =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { error?: unknown; message?: unknown }).error
          || (payload as { error?: unknown; message?: unknown }).message
        : null
    throw new Error(`API error: ${res.status} - ${typeof detail === "string" ? detail : `HTTP ${res.status}`}`)
  }

  const safePayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as { snapshot?: unknown; validation?: unknown })
      : {}
  const snapshot = sanitizeSnapshot(safePayload.snapshot)
  if (!snapshot) {
    throw new Error("API error: submit payload is missing snapshot")
  }

  const validationRaw =
    safePayload.validation && typeof safePayload.validation === "object" && !Array.isArray(safePayload.validation)
      ? safePayload.validation as { valid?: unknown; errors?: unknown; warnings?: unknown }
      : { valid: true, errors: [], warnings: [] }

  return {
    snapshot,
    validation: {
      valid: Boolean(validationRaw.valid),
      errors: Array.isArray(validationRaw.errors)
        ? validationRaw.errors
          .map((issue) => sanitizeValidationIssue(issue))
          .filter((issue): issue is TransferChecklistValidationIssue => issue != null)
        : [],
      warnings: Array.isArray(validationRaw.warnings)
        ? validationRaw.warnings
          .map((issue) => sanitizeValidationIssue(issue))
          .filter((issue): issue is TransferChecklistValidationIssue => issue != null)
        : [],
    },
  }
}
