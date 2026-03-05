/**
 * PatientExplainPayload v1 fetch 유틸리티
 * 아키텍처 문서 § 3.5 FE fetch 뼈대 기준
 *
 * - 항상 Next.js API Route(/api/patients/...)를 사용
 *   (route 내부에서 Explain BE proxy를 수행)
 * - 네트워크 오류 시 지수 백오프 3회 재시도 (§ 7)
 */
import type {
  PatientExplainPayload,
  ExplainEvent,
  RangeType,
} from "@/lib/explain-types"
import { type DemoQueryParams, appendDemoParams } from "@/lib/demo-query"

// ── 지수 백오프 재시도 헬퍼 ──────────────────────────
async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: Error = new Error("unknown")
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options)
      // 5xx 는 재시도 대상
      if (res.status >= 500) {
        lastError = new Error(`server error ${res.status}`)
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
        continue
      }
      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw lastError
}

// ── 메인 payload fetch (§ 3.1) ──────────────────────
export async function fetchExplainPayload(
  patientId: string,
  range: RangeType = "72h",
  showContext = true,
  demo?: DemoQueryParams,
): Promise<PatientExplainPayload> {
  const params = new URLSearchParams({ range })
  if (showContext) params.set("show_context", "true")
  appendDemoParams(params, demo)
  const url = `/api/patients/${patientId}/explain?${params}`
  const res = await fetchWithRetry(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ExplainApiError(
      body?.code ?? "UNKNOWN",
      body?.message ?? `HTTP ${res.status}`,
      res.status,
    )
  }
  const json = await res.json().catch(() => null)
  if (!json || json.status !== "ok" || !json.data) {
    throw new ExplainApiError(
      json?.code ?? "INVALID_RESPONSE",
      json?.message ?? "응답 형식이 올바르지 않습니다.",
      res.status,
    )
  }
  return json.data as PatientExplainPayload
}

// ── 이벤트 페이지네이션 (§ 3.2) ─────────────────────
export async function fetchExplainEvents(
  patientId: string,
  opts: {
    range?: RangeType
    axis?: string
    severity?: string
    issueOnly?: boolean
    cursor?: string
    limit?: number
    demoStep?: number | null
    demoShift?: string | null
  } = {},
): Promise<{ events: ExplainEvent[]; next_cursor: string | null; has_more: boolean }> {
  const params = new URLSearchParams({ range: opts.range ?? "72h" })
  if (opts.axis)     params.set("axis", opts.axis)
  if (opts.severity) params.set("severity", opts.severity)
  if (opts.issueOnly !== undefined) params.set("issue_only", String(opts.issueOnly))
  if (opts.cursor)   params.set("cursor", opts.cursor)
  if (opts.limit)    params.set("limit", String(opts.limit))
  appendDemoParams(params, { demoStep: opts.demoStep, demoShift: opts.demoShift })

  const url = `/api/patients/${patientId}/explain/events?${params}`
  const res = await fetchWithRetry(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ExplainApiError(body?.code ?? "UNKNOWN", body?.message ?? `HTTP ${res.status}`, res.status)
  }
  const json = await res.json().catch(() => null)
  if (!json || json.status !== "ok" || !json.data) {
    throw new ExplainApiError(
      json?.code ?? "INVALID_RESPONSE",
      json?.message ?? "응답 형식이 올바르지 않습니다.",
      res.status,
    )
  }
  return json.data
}

// ── 단일 이벤트 상세 (§ 3.3) ─────────────────────────
export async function fetchEventDetail(
  patientId: string,
  eventId: string,
  demo?: DemoQueryParams,
): Promise<ExplainEvent> {
  const params = new URLSearchParams()
  appendDemoParams(params, demo)
  const query = params.toString()
  const url = `/api/patients/${patientId}/explain/event/${eventId}${query ? `?${query}` : ""}`
  const res = await fetchWithRetry(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ExplainApiError(body?.code ?? "UNKNOWN", body?.message ?? `HTTP ${res.status}`, res.status)
  }
  const json = await res.json().catch(() => null)
  if (!json || json.status !== "ok" || !json.data) {
    throw new ExplainApiError(
      json?.code ?? "INVALID_RESPONSE",
      json?.message ?? "응답 형식이 올바르지 않습니다.",
      res.status,
    )
  }
  return json.data as ExplainEvent
}

// ── 에러 클래스 ───────────────────────────────────────
export class ExplainApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = "ExplainApiError"
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
  get isNoNlpData(): boolean {
    return this.code === "NO_NLP_DATA"
  }
}
