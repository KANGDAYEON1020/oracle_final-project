export type DocType =
    | "referral"
    | "return"
    | "summary"
    | "discharge"
    | "admission"
    | "certificate";

export const DOC_TYPE_LABELS: Record<DocType, { ko: string; en: string }> = {
    referral: { ko: "진료 의뢰서", en: "Medical Referral Letter" },
    return: { ko: "진료회송서", en: "Return Letter" },
    summary: { ko: "진료기록요약지", en: "Clinical Summary" },
    discharge: { ko: "퇴원요약지", en: "Discharge Summary" },
    admission: { ko: "입원초진기록지", en: "Admission Initial Assessment" },
    certificate: { ko: "진단서 초안", en: "Certificate Draft" },
};

export type RangeOption = "72h" | "7d" | "all" | "custom";

export const RANGE_LABELS: Record<RangeOption, string> = {
    "72h": "최근 72시간",
    "7d": "최근 7일",
    all: "입원 전체",
    custom: "사용자 지정",
};

export interface Patient {
    id: string;
    name: string;
    sex: "M" | "F";
    age: number;
    ward: string;
    admissionDate: string;
    mrn: string;
}

export interface FieldDef {
    key: string;
    label: string;
    value: string;
    type: "text" | "textarea" | "date" | "code";
    required?: boolean;
}

export interface Section {
    id: string;
    title: string;
    fields: FieldDef[];
    narrative?: string;
    edited?: boolean;
    originalNarrative?: string;
    originalFields?: FieldDef[];
    included?: boolean;
}

export interface EvidenceItem {
    id: string;
    timestamp: string;
    docName: string;
    quote: string;
    sourceType: "nursing" | "doctor" | "lab" | "imaging" | "micro";
    confidence: number;
    relatedSectionId?: string;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface Issue {
    id: string;
    severity: IssueSeverity;
    message: string;
    sectionId: string;
    fieldKey?: string;
}

export interface Draft {
    draftId?: string;
    docType: DocType;
    patientId: string;
    range: RangeOption;
    sections: Section[];
    evidence: EvidenceItem[];
    validationIssues: Issue[];
}

export interface TrajectoryAxis {
    axis: string;
    label: string;
    trend: "improving" | "stable" | "worsening";
    supportingFacts: string[];
    evidenceIds: string[];
}

export interface RecentDraft {
    id: string;
    docType: DocType;
    patientName: string;
    patientId: string;
    updatedAt: string;
    status: "draft" | "validated" | "exported";
}
