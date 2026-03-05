import type { DocType, RangeOption, Draft, Section, EvidenceItem, TrajectoryAxis, Patient } from "./auto-draft-types";
import {
    type DemoQueryParams,
    appendDemoParams,
    buildPathWithQuery,
    readDemoQueryFromStorage,
} from "./demo-query";

function normalizeApiBase(base?: string): string {
    const resolved = (base && base.trim()) || "/api";
    const withoutTrailingSlash = resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
    if (!withoutTrailingSlash || withoutTrailingSlash === "/") return "/api";
    if (/\/api$/i.test(withoutTrailingSlash)) return withoutTrailingSlash;
    if (withoutTrailingSlash.startsWith("/") || /^https?:\/\//i.test(withoutTrailingSlash)) {
        return `${withoutTrailingSlash}/api`;
    }
    return withoutTrailingSlash;
}

const API_BASE = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL);

async function readErrorMessage(res: Response): Promise<string> {
    const fallback = `HTTP ${res.status}`;
    try {
        const text = await res.text();
        if (!text) return fallback;
        try {
            const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
            if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
            if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
            return text.slice(0, 300);
        } catch {
            return text.slice(0, 300);
        }
    } catch {
        return fallback;
    }
}

/**
 * Generate a draft by calling the backend NLG API.
 * Falls back to mock data if the API is unavailable.
 *
 * LLM은 판단 엔진이 아니라 '문서 작성기'입니다.
 * 판단 근거는 이벤트/수치/출처로 고정돼 있습니다.
 */
export async function generateDraftFromAPI(
    docType: DocType,
    patientId: string,
    range: RangeOption,
    demoInput?: DemoQueryParams,
): Promise<Draft> {
    try {
        const demo = demoInput ?? readDemoQueryFromStorage();
        const params = new URLSearchParams();
        appendDemoParams(params, demo);
        const url = buildPathWithQuery(`${API_BASE}/draft/generate`, params);

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                patient_id: patientId,
                doc_type: docType,
                range,
                demoStep: demo.demoStep,
                demoShift: demo.demoShift,
            }),
        });

        if (!res.ok) {
            const detail = await readErrorMessage(res);
            throw new Error(`API error: ${res.status} - ${detail}`);
        }

        const data = await res.json();

        // Transform backend response to match frontend Draft type
        const sections: Section[] = (data.sections || []).map((s: Record<string, unknown>) => ({
            id: s.id as string,
            title: s.title as string,
            fields: ((s.fields as Record<string, unknown>[]) || []).map((f: Record<string, unknown>) => ({
                key: f.key as string,
                label: f.label as string,
                value: (f.value as string) || "",
                type: (f.type as string) || "text",
                required: f.required as boolean | undefined,
            })),
            narrative: (s.narrative as string) || "",
            originalNarrative: (s.originalNarrative as string) || "",
            originalFields: ((s.originalFields as Record<string, unknown>[]) || []).map((f: Record<string, unknown>) => ({
                key: f.key as string,
                label: f.label as string,
                value: (f.value as string) || "",
                type: (f.type as string) || "text",
                required: f.required as boolean | undefined,
            })),
        }));

        const evidence: EvidenceItem[] = (data.evidence || []).map((e: Record<string, unknown>) => ({
            id: e.id as string,
            timestamp: e.timestamp as string,
            docName: e.docName as string,
            quote: e.quote as string,
            sourceType: (e.sourceType as string) || "nursing",
            confidence: (e.confidence as number) || 0.8,
            relatedSectionId: e.relatedSectionId as string | undefined,
        }));

        const normalizedSections: Section[] =
            docType === "admission"
                ? sections
                    .filter((s) => s.id !== "allergies")
                    .map((s) => ({
                        ...s,
                        fields: s.fields.filter(
                            (f) => f.key !== "allergies" && !/알레르기/.test(f.label)
                        ),
                    }))
                : sections;

        return {
            docType,
            patientId,
            range,
            sections: normalizedSections,
            evidence,
            validationIssues: [],
        };
    } catch (error) {
        console.error("[draft-api-service] API unavailable:", error);
        throw error;
    }
}

export async function fetchDraftPatients(demoInput?: DemoQueryParams): Promise<Patient[]> {
    try {
        const demo = demoInput ?? readDemoQueryFromStorage();
        const params = new URLSearchParams();
        appendDemoParams(params, demo);
        const url = buildPathWithQuery(`${API_BASE}/draft/patients`, params);
        const res = await fetch(url);
        if (!res.ok) {
            const detail = await readErrorMessage(res);
            throw new Error(`API error: ${res.status} - ${detail}`);
        }
        const data = await res.json();
        return data?.patients ?? data ?? [];
    } catch (error) {
        console.warn("[draft-api-service] fetchDraftPatients failed:", error);
        return [];
    }
}

/**
 * Save a draft to Oracle DB via Express API.
 * Called after generate/validate/export to persist state.
 */
export async function saveDraftToDb(draft: Draft, patientName?: string): Promise<string | null> {
    try {
        const payload: Record<string, unknown> = {
            docType: draft.docType,
            patientId: draft.patientId,
            patientName: patientName ?? `Patient ${draft.patientId}`,
            status: "draft",
            sections: draft.sections,
            evidence: draft.evidence,
            validationIssues: draft.validationIssues || [],
        };
        if (draft.draftId) {
            payload.id = draft.draftId;
        }
        const res = await fetch(`${API_BASE}/draft/saved`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const detail = await readErrorMessage(res);
            throw new Error(`save error: ${res.status} - ${detail}`);
        }
        const saved = await res.json();
        return saved.id ?? null;
    } catch (error) {
        console.warn("[draft-api-service] saveDraftToDb failed:", error);
        return null;
    }
}

// ─── Saved Draft APIs ────────────────────────────────────────

export interface SavedDraftSummary {
    id: string;
    docType: string;
    patientId: string;
    patientName: string;
    status: "draft" | "validated" | "exported";
    createdAt: string;
    updatedAt: string;
}

export async function fetchSavedDrafts(): Promise<SavedDraftSummary[]> {
    try {
        const res = await fetch(`${API_BASE}/draft/saved`);
        if (!res.ok) {
            const detail = await readErrorMessage(res);
            throw new Error(`API error: ${res.status} - ${detail}`);
        }
        const data = await res.json();
        return data.drafts || [];
    } catch (error) {
        console.warn("[draft-api-service] fetchSavedDrafts failed:", error);
        return [];
    }
}

export async function fetchSavedDraft(draftId: string): Promise<Draft | null> {
    try {
        const res = await fetch(`${API_BASE}/draft/saved/${draftId}`);
        if (!res.ok) {
            const detail = await readErrorMessage(res);
            throw new Error(`API error: ${res.status} - ${detail}`);
        }
        const data = await res.json();
        return {
            draftId: data.id,
            docType: data.docType,
            patientId: data.patientId,
            range: "7d",
            sections: data.sections || [],
            evidence: data.evidence || [],
            validationIssues: data.validationIssues || [],
        };
    } catch (error) {
        console.warn("[draft-api-service] fetchSavedDraft failed:", error);
        return null;
    }
}

export async function updateDraftStatus(
    draftId: string,
    status: "draft" | "validated" | "exported",
    extra?: { validationIssues?: unknown[]; sections?: unknown[] }
): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/draft/saved/${draftId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status, ...extra }),
        });
        return res.ok;
    } catch (error) {
        console.warn("[draft-api-service] updateDraftStatus failed:", error);
        return false;
    }
}

// ─── Trajectory API ──────────────────────────────────────────

export async function fetchPatientTrajectory(patientId: string): Promise<TrajectoryAxis[]> {
    try {
        const params = new URLSearchParams();
        appendDemoParams(params, readDemoQueryFromStorage());
        const url = buildPathWithQuery(`${API_BASE}/patients/${patientId}/trajectory`, params);
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return data.trajectory ?? [];
    } catch (error) {
        console.warn("[draft-api-service] fetchPatientTrajectory failed:", error);
        return [];
    }
}
