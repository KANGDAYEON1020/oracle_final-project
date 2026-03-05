import type {
  Patient,
  PatientDashboardSummaryResponse,
  PatientSepsisResponse,
  PatientStatusSummaryResponse,
} from "@/lib/types"
import {
  type DemoQueryParams,
  appendDemoParams,
  buildPathWithQuery,
} from "@/lib/demo-query"

function normalizeApiBase(base?: string): string {
  const resolved = (base && base.trim()) || "/api"
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved
}

// Default to same-origin `/api` so non-localhost clients (e.g. iPad on LAN)
// don't try to call their own localhost.
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
      return text.slice(0, 200)
    } catch {
      return text.slice(0, 200)
    }
  } catch {
    return fallback
  }
}

export async function fetchPatients(demo?: DemoQueryParams): Promise<Patient[]> {
  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/patients`, params)
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`Failed to fetch patients: ${detail}`)
  }
  return res.json()
}

export async function fetchPatient(id: string, demo?: DemoQueryParams): Promise<Patient> {
  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/patients/${id}`, params)
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`Failed to fetch patient: ${detail}`)
  }
  return res.json()
}

export async function fetchPatientSepsis(
  id: string,
  demo?: DemoQueryParams,
): Promise<PatientSepsisResponse> {
  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const url = buildPathWithQuery(`${API_BASE}/patients/${id}/sepsis`, params)
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`Failed to fetch patient sepsis: ${detail}`)
  }
  return res.json()
}

export async function fetchPatientStatusSummary(
  id: string,
  demo?: DemoQueryParams,
  options?: { force?: boolean },
): Promise<PatientStatusSummaryResponse> {
  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  if (options?.force) params.set("force", "1")
  const url = buildPathWithQuery(`${API_BASE}/patients/${id}/status-summary`, params)
  const res = await fetch(url)
  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`Failed to fetch patient status summary: ${detail}`)
  }
  return res.json()
}

export async function fetchPatientDashboardSummary(input?: {
  patientIds?: string[]
  demoStep?: number | null
  demoShift?: DemoQueryParams["demoShift"]
  signal?: AbortSignal
}): Promise<PatientDashboardSummaryResponse> {
  const params = new URLSearchParams()
  appendDemoParams(params, { demoStep: input?.demoStep, demoShift: input?.demoShift })
  const patientIds = (input?.patientIds ?? []).map((id) => id.trim()).filter(Boolean)
  if (patientIds.length > 0) {
    params.set("patientIds", patientIds.join(","))
  }

  const url = buildPathWithQuery(`${API_BASE}/patients/summary`, params)
  const res = await fetch(url, { signal: input?.signal })
  if (!res.ok) {
    const detail = await readErrorMessage(res)
    throw new Error(`Failed to fetch patient summary: ${detail}`)
  }
  return res.json()
}

export async function fetchRooms(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/rooms`)
  if (!res.ok) throw new Error("Failed to fetch rooms")
  return res.json()
}
