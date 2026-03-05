import type { Notification, NotificationType, Plan, PlanItem, TransferCase, Room, WardId } from './types'
import { type DemoQueryParams, appendDemoParams, buildPathWithQuery, readDemoQueryFromStorage } from '@/lib/demo-query'

function normalizeApiBase(base?: string): string {
    const resolved = (base && base.trim()) || "/api"
    return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved
}

const API_BASE_URL = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL)
const ALERTS_PROXY_BASE = "/api"

function resolveDemoQuery(demo?: DemoQueryParams): DemoQueryParams {
    const stored = readDemoQueryFromStorage()
    return {
        demoStep: demo?.demoStep ?? stored.demoStep,
        demoShift: demo?.demoShift ?? stored.demoShift,
    }
}

// ============================================================
// API 호출 함수들
// ============================================================
export async function fetchPatients() {
    const params = new URLSearchParams()
    appendDemoParams(params, readDemoQueryFromStorage())
    const url = buildPathWithQuery(`${API_BASE_URL}/patients`, params)
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to fetch patients')
    return response.json()
}

export async function fetchTransferCases(status?: string, demo?: DemoQueryParams): Promise<TransferCase[]> {
    const params = new URLSearchParams()
    if (status) params.set("status", status)
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/transfer-cases`, params)
    const response = await fetch(url)
    if (!response.ok) {
        const detail = await response.text().catch(() => "")
        throw new Error(`Failed to fetch transfer cases: ${response.status}${detail ? ` ${detail}` : ""}`)
    }
    const data = await response.json()
    return data.map(transformTransferCase)
}

export async function fetchRooms(wardId?: string, demo?: DemoQueryParams): Promise<Room[]> {
    const params = new URLSearchParams()
    if (wardId) params.set("ward_id", wardId)
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/rooms`, params)
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to fetch rooms')
    const data = await response.json()
    return data.map(transformRoom)
}

export async function fetchPlans(
    statuses?: Array<"DRAFT" | "READY_TO_COMMIT" | "COMMITTED" | "CANCELLED">,
    demo?: DemoQueryParams,
): Promise<Plan[]> {
    const params = new URLSearchParams()
    if (statuses && statuses.length > 0) {
        params.set("status", statuses.join(","))
    }
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/plans`, params)
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to fetch plans')
    const data = await response.json()
    return Array.isArray(data) ? data.map(transformPlan) : []
}

export async function generatePlan(
    caseIds: string[],
    scope: WardId[] = ["2F", "3F", "5F"],
    demo?: DemoQueryParams,
): Promise<Plan> {
    const params = new URLSearchParams()
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/plans/generate`, params)
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseIds, scope }),
    })
    if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Failed to generate plan: ${response.status} ${text}`)
    }
    return transformPlan(await response.json())
}

export async function commitPlan(planId: string, items?: PlanItem[], demo?: DemoQueryParams) {
    const params = new URLSearchParams()
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/plans/commit`, params)
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, items }),
    })
    if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Failed to commit plan: ${response.status} ${text}`)
    }
    return response.json()
}

export async function rollbackPlan(planId: string, demo?: DemoQueryParams) {
    const params = new URLSearchParams()
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/plans/${encodeURIComponent(planId)}/rollback`, params)
    const response = await fetch(url, { method: 'POST' })
    if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Failed to rollback plan: ${response.status} ${text}`)
    }
    return response.json()
}

export async function escalatePlan(
    planId: string,
    items: Array<{ caseId: string }>,
    reasonCode: string,
    reasonText: string,
    demo?: DemoQueryParams,
) {
    const params = new URLSearchParams()
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/plans/${encodeURIComponent(planId)}/escalate`, params)
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, reasonCode, reasonText }),
    })
    if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Failed to escalate plan: ${response.status} ${text}`)
    }
    return response.json()
}

export async function fetchAlerts(
    statuses: Array<"ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED"> = ["ACTIVE"],
    limit = 200,
    demo?: DemoQueryParams,
): Promise<Notification[]> {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 200
    const params = new URLSearchParams()
    params.set("status", statuses.join(","))
    params.set("limit", String(normalizedLimit))
    appendDemoParams(params, resolveDemoQuery(demo))
    const bases = Array.from(new Set([ALERTS_PROXY_BASE, API_BASE_URL]))
    let lastError: unknown = null
    for (const base of bases) {
        const url = buildPathWithQuery(`${base}/alerts`, params)
        try {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`Failed to fetch alerts: ${response.status}`)
            const payload = await response.json()
            const items = Array.isArray(payload?.data) ? payload.data : []
            return items.map(transformAlert)
        } catch (error) {
            lastError = error
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Failed to fetch alerts')
}

export async function createTransferCase(transferCase: any) {
    const response = await fetch(`${API_BASE_URL}/transfer-cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transferCase)
    })
    if (!response.ok) throw new Error('Failed to create transfer case')
    return response.json()
}

export async function updateRoom(roomId: string, data: any) {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    if (!response.ok) throw new Error('Failed to update room')
    return response.json()
}

export async function updateBed(roomId: string, bedId: string, data: any) {
    const response = await fetch(`${API_BASE_URL}/rooms/${roomId}/beds/${bedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    if (!response.ok) throw new Error('Failed to update bed')
    return response.json()
}

export async function commitRoomChanges(operations: any[], demo?: DemoQueryParams) {
    const params = new URLSearchParams()
    appendDemoParams(params, resolveDemoQuery(demo))
    const url = buildPathWithQuery(`${API_BASE_URL}/rooms/commit-changes`, params)
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations }),
    })
    if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(`Failed to commit room changes: ${response.status} ${text}`)
    }
    return response.json()
}

// ============================================================
// 데이터 변환 함수들 (Express API → FE 타입)
// ============================================================
function transformTransferCase(apiCase: any): TransferCase {
    return {
        id: apiCase.id,
        patient: apiCase.patient,
        status: apiCase.status,
        fromWard: apiCase.fromWard,
        fromRoom: apiCase.fromRoom,
        toWard: apiCase.toWard,
        toRoom: apiCase.toRoom,
        toBed: apiCase.toBed,
        reason: apiCase.reason,
        priority: apiCase.priority,
        exceptionReason: apiCase.exceptionReason,
        createdAt: new Date(apiCase.createdAt)
    }
}

function transformRoom(apiRoom: any): Room {
    return {
        id: apiRoom.id,
        roomNo: apiRoom.roomNo,
        wardId: apiRoom.wardId,
        capacity: apiRoom.capacity,
        cohortType: apiRoom.cohortType,
        cohortLabel: apiRoom.cohortLabel ?? apiRoom.cohortType ?? null,
        cohortKey: apiRoom.cohortKey ?? null,
        genderType: apiRoom.genderType,
        needsCleaning: apiRoom.needsCleaning,
        isIsolation: apiRoom.isIsolation,
        hasAIIR: apiRoom.hasAIIR,
        hasDedicatedToilet: apiRoom.hasDedicatedToilet,
        isolationType: apiRoom.isolationType,
        tier: apiRoom.tier,
        beds: (apiRoom.beds || []).map((bed: any) => ({
            id: bed.id,
            patient: bed.patient,
            isGhost: bed.isGhost || false,
            ghostPatient: bed.ghostPatient || null,
        }))
    }
}

function transformAlert(apiAlert: any): Notification {
    const type = String(apiAlert?.type || "").toLowerCase() as NotificationType
    const createdAt = apiAlert?.createdAt ? new Date(apiAlert.createdAt) : new Date()

    return {
        id: apiAlert?.legacyId || `notif-${apiAlert?.alertId ?? Date.now()}`,
        type,
        message: apiAlert?.message || "",
        createdAt,
        read: apiAlert?.status !== "ACTIVE",
        severity: apiAlert?.severity,
        severityNormalized: apiAlert?.severityNormalized,
        isCritical: Boolean(apiAlert?.isCritical),
        patientId: apiAlert?.patientId ?? null,
        admissionId: apiAlert?.admissionId ?? null,
        status: apiAlert?.status,
    }
}

function transformPlan(apiPlan: any): Plan {
    return {
        id: apiPlan?.id || `PLAN-${String(apiPlan?.planId ?? "").padStart(3, "0")}`,
        status: normalizePlanStatus(apiPlan?.status),
        createdAt: apiPlan?.createdAt ? new Date(apiPlan.createdAt) : new Date(),
        createdBy: apiPlan?.createdBy || "자동배치",
        scope: Array.isArray(apiPlan?.scope) ? apiPlan.scope : [],
        items: Array.isArray(apiPlan?.items) ? apiPlan.items.map(transformPlanItem) : [],
    }
}

function transformPlanItem(apiItem: any): PlanItem {
    return {
        caseId: String(apiItem?.caseId || ""),
        patient: apiItem?.patient,
        fromWard: apiItem?.fromWard ?? null,
        fromRoom: apiItem?.fromRoom ?? null,
        toWard: apiItem?.toWard ?? "2F",
        toRoom: apiItem?.toRoom ?? "미정",
        toBed: apiItem?.toBed ?? "",
        conflict: apiItem?.conflict || undefined,
        tier: apiItem?.tier ?? null,
        strategy: apiItem?.strategy ?? null,
        admissionId: apiItem?.admissionId ?? null,
        fromBedId: apiItem?.fromBedId ?? null,
        toRoomId: apiItem?.toRoomId ?? null,
    } as PlanItem
}

function normalizePlanStatus(rawStatus: any): Plan["status"] {
    const status = String(rawStatus || "").toUpperCase()
    if (status === "COMMITTED" || status === "CONFIRMED") return "COMMITTED"
    if (status === "CANCELLED") return "CANCELLED"
    if (status === "READY_TO_COMMIT") return "READY_TO_COMMIT"
    return "DRAFT"
}
