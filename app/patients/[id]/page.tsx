import { PatientDetailClient } from "./patient-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PatientDetailPage({ params }: Props) {
  const { id } = await params

  return <PatientDetailClient patientId={id} />
}

function resolveServerApiBase(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.API_BASE_URL,
    process.env.INTERNAL_API_BASE_URL,
  ]

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim()
    if (!value) continue
    if (!/^https?:\/\//i.test(value)) continue
    return value.endsWith("/") ? value.slice(0, -1) : value
  }
  return null
}

async function fetchPatientNameForMetadata(patientId: string): Promise<string | null> {
  const apiBase = resolveServerApiBase()
  if (!apiBase) return null

  try {
    const response = await fetch(`${apiBase}/patients/${encodeURIComponent(patientId)}`, {
      cache: "no-store",
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { name?: unknown }
    return typeof payload?.name === "string" ? payload.name : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params
  const patientName = await fetchPatientNameForMetadata(id)
  return {
    title: patientName ? `환자 ${patientName} | LOOK` : `환자 ${id} | LOOK`,
  }
}
