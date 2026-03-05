// Isolation Rules Engine based on isolation.yaml
// Implements tier-based allocation with pathogen-specific rules

export type IsolationTier = "S" | "A" | "B" | null
export type IsolationType = "STANDARD" | "CONTACT" | "DROPLET" | "AIRBORNE"

export interface IsolationRequirement {
    tier: IsolationTier
    isolationType: IsolationType
    cohortAllowed: boolean
    cohortKey: string | null
    preferAIIR?: boolean
    preferDedicatedToilet?: boolean
}

// Tier 정의 (1인실 우선순위)
export const TIER_CONFIG = {
    S: {
        name: "Single-room Strong",
        description: "즉시 1인실 우선 (음압/전용화장실)",
        priority: 3,
        fallbackOrder: ["single", "cohort_same_key_same_sex", "escalation"]
    },
    A: {
        name: "Single-room Preferred",
        description: "1인실 우선 권고, 부족시 코호트",
        priority: 2,
        fallbackOrder: ["single", "cohort_same_key_same_sex", "multibed_with_precautions"]
    },
    B: {
        name: "Contact/Droplet Standard",
        description: "기본 격리수칙, 다인실 가능",
        priority: 1,
        fallbackOrder: ["multibed_with_precautions", "cohort_same_key_same_sex", "single"]
    }
} as const

// 격리 타입별 PPE
export const ISOLATION_TYPE_CONFIG = {
    STANDARD: {
        ppe: ["hand_hygiene"]
    },
    CONTACT: {
        ppe: ["gown", "gloves", "hand_hygiene"]
    },
    DROPLET: {
        ppe: ["surgical_mask", "hand_hygiene"]
    },
    AIRBORNE: {
        ppe: ["n95_or_papr", "hand_hygiene"],
        roomRequirements: ["AIIR_negative_pressure_preferred"]
    }
} as const

// 병원체 규칙 (isolation.yaml의 pathogen_rules 구현)
interface PathogenRule {
    id: string
    match: string[]
    isolationType: IsolationType
    tier: IsolationTier
    cohortAllowed: boolean
    organismGroup: string
    resistanceGroup?: string
    symptomGroup?: string
    preferAIIR?: boolean
    preferDedicatedToilet?: boolean
}

export const PATHOGEN_RULES: PathogenRule[] = [
    // --- Airborne (Tier S) ---
    {
        id: "TB_SUSPECT_OR_CONFIRMED",
        match: ["tb_suspected", "tb_confirmed", "mycobacterium_tuberculosis"],
        isolationType: "AIRBORNE",
        tier: "S",
        cohortAllowed: false,
        organismGroup: "TB",
        preferAIIR: true
    },
    {
        id: "MEASLES",
        match: ["measles_suspected", "measles_confirmed"],
        isolationType: "AIRBORNE",
        tier: "S",
        cohortAllowed: false,
        organismGroup: "MEASLES",
        preferAIIR: true
    },
    {
        id: "VARICELLA_OR_DISSEMINATED_ZOSTER",
        match: ["varicella", "disseminated_zoster", "zoster_disseminated"],
        isolationType: "AIRBORNE",
        tier: "S",
        cohortAllowed: false,
        organismGroup: "VARICELLA_ZOSTER",
        symptomGroup: "disseminated",
        preferAIIR: true
    },

    // --- Enteric / 환경오염 (Tier S/A) ---
    {
        id: "CDI_SYMPTOMATIC",
        match: ["c_difficile_positive", "c_diff", "cdi"],
        isolationType: "CONTACT",
        tier: "S",
        cohortAllowed: true,
        organismGroup: "C_DIFF",
        symptomGroup: "diarrhea",
        preferDedicatedToilet: true
    },
    {
        id: "VIRAL_GASTROENTERITIS",
        match: ["norovirus", "viral_gastroenteritis", "rotavirus"],
        isolationType: "CONTACT",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "VIRAL_GI",
        symptomGroup: "vomit_or_diarrhea",
        preferDedicatedToilet: true
    },
    {
        id: "SCABIES",
        match: ["scabies_suspected", "scabies_confirmed", "scabies"],
        isolationType: "CONTACT",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "SCABIES"
    },

    // --- MDRO ---
    {
        id: "CRE_CPE",
        match: ["cre", "cpe", "carbapenemase_producer"],
        isolationType: "CONTACT",
        tier: "S",
        cohortAllowed: true,
        organismGroup: "ENTEROBACTERALES",
        resistanceGroup: "CARBAPENEM_RESIST"
    },
    {
        id: "VRE",
        match: ["vre"],
        isolationType: "CONTACT",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "ENTEROCOCCUS",
        resistanceGroup: "VANCOMYCIN_RESIST"
    },
    {
        id: "MRSA",
        match: ["mrsa"],
        isolationType: "CONTACT",
        tier: "B",  // 기본 Tier B (유병률 높음, 코호트 가능) - 임상 트리거로 A 상향
        cohortAllowed: true,
        organismGroup: "STAPH_AUREUS",
        resistanceGroup: "METHICILLIN_RESIST"
    },
    {
        id: "CRAB",
        match: ["crab", "acinetobacter_mdr"],
        isolationType: "CONTACT",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "ACINETOBACTER",
        resistanceGroup: "CARBAPENEM_RESIST_OR_MDR"
    },
    {
        id: "CRPA",
        match: ["crpa", "pseudomonas_mdr"],
        isolationType: "CONTACT",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "PSEUDOMONAS",
        resistanceGroup: "CARBAPENEM_RESIST_OR_MDR"
    },

    // --- Respiratory viruses (Droplet) ---
    {
        id: "INFLUENZA",
        match: ["influenza_a", "influenza_b", "influenza_positive", "influenza"],
        isolationType: "DROPLET",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "INFLUENZA",
        symptomGroup: "respiratory"
    },
    {
        id: "COVID19",
        match: ["sars_cov_2_positive", "covid19", "covid"],
        isolationType: "DROPLET",
        tier: "A",
        cohortAllowed: true,
        organismGroup: "SARS_COV_2",
        symptomGroup: "respiratory"
    }
]

// 임상 트리거 (증상 기반 tier 상향)
interface ClinicalTrigger {
    id: string
    matchFlags: string[]
    upgradeTier?: IsolationTier
    setIsolationType?: IsolationType
    disallowCohort?: boolean
    description?: string  // 트리거 설명
}

export const CLINICAL_TRIGGERS: ClinicalTrigger[] = [
    {
        id: "MRSA_RESPIRATORY_UPGRADE",
        matchFlags: ["uncontrolled_secretions", "severe_cough", "mrsa_pneumonia"],
        upgradeTier: "A",
        description: "MRSA 폐렴/객담 - 비말 전파 위험으로 1인실 권고"
    },
    {
        id: "MRSA_WOUND_UPGRADE",
        matchFlags: ["draining_wound_uncontained", "open_wound_mrsa"],
        upgradeTier: "A",
        description: "MRSA 개방성 상처 - 접촉 전파 위험 극대화로 1인실 권고"
    },
    {
        id: "UNCONTROLLED_SECRETIONS_UPGRADE",
        matchFlags: ["uncontrolled_secretions", "draining_wound_uncontained"],
        upgradeTier: "A",
        description: "분비물 통제 불가 - Tier B → A 상향"
    },
    {
        id: "HEAVY_GI_SYMPTOMS_UPGRADE",
        matchFlags: ["diarrhea_profuse", "vomiting_profuse"],
        upgradeTier: "A",
        setIsolationType: "CONTACT",
        disallowCohort: true,
        description: "심한 설사/구토 - 전파 위험 높음"
    }
]

/**
 * 환자의 병원체/임상 플래그로부터 격리 요구사항 결정
 */
export function determineIsolationRequirement(
    pathogenFlags: string[] = [],
    clinicalFlags: string[] = []
): IsolationRequirement {
    // 1. 병원체 규칙 매칭
    let matchedRule: PathogenRule | null = null

    for (const rule of PATHOGEN_RULES) {
        if (rule.match.some(flag => pathogenFlags.includes(flag))) {
            matchedRule = rule
            break
        }
    }

    if (!matchedRule) {
        // 매칭 없으면 STANDARD
        return {
            tier: null,
            isolationType: "STANDARD",
            cohortAllowed: false,
            cohortKey: null
        }
    }

    // 2. 임상 트리거로 tier 상향 체크
    let finalTier = matchedRule.tier
    let finalIsolationType = matchedRule.isolationType
    let cohortAllowed = matchedRule.cohortAllowed

    for (const trigger of CLINICAL_TRIGGERS) {
        if (trigger.matchFlags.some(flag => clinicalFlags.includes(flag))) {
            if (trigger.upgradeTier && shouldUpgradeTier(finalTier, trigger.upgradeTier)) {
                finalTier = trigger.upgradeTier
            }
            if (trigger.setIsolationType) {
                finalIsolationType = trigger.setIsolationType
            }
            if (trigger.disallowCohort) {
                cohortAllowed = false
            }
        }
    }

    // 3. Cohort Key 생성
    const cohortKey = cohortAllowed ? buildCohortKey(
        finalIsolationType,
        matchedRule.organismGroup,
        matchedRule.resistanceGroup,
        matchedRule.symptomGroup
    ) : null

    return {
        tier: finalTier,
        isolationType: finalIsolationType,
        cohortAllowed,
        cohortKey,
        preferAIIR: matchedRule.preferAIIR,
        preferDedicatedToilet: matchedRule.preferDedicatedToilet
    }
}

/**
 * Tier 상향 여부 판단
 */
function shouldUpgradeTier(currentTier: IsolationTier, targetTier: IsolationTier): boolean {
    if (!currentTier) return true
    if (!targetTier) return false

    const priorities: Record<string, number> = { S: 3, A: 2, B: 1 }
    return priorities[targetTier] > priorities[currentTier]
}

/**
 * Cohort Key 생성 (완전 일치 필요)
 * Format: {isolation_type}|{organism_group}|{resistance_group_or_none}|{symptom_group_or_none}
 */
export function buildCohortKey(
    isolationType: IsolationType,
    organismGroup: string,
    resistanceGroup?: string,
    symptomGroup?: string
): string {
    return `${isolationType}|${organismGroup}|${resistanceGroup || "none"}|${symptomGroup || "none"}`
}

/**
 * Tier 우선순위 가져오기
 */
export function getTierPriority(tier: IsolationTier): number {
    if (!tier) return 0
    return TIER_CONFIG[tier].priority
}

/**
 * 방 품질 점수 계산
 */
export function getRoomQualityScore(
    room: { hasAIIR?: boolean; hasDedicatedToilet?: boolean },
    requirement: IsolationRequirement
): number {
    let score = 0

    if (requirement.preferAIIR && room.hasAIIR) {
        score += 20
    }

    if (requirement.preferDedicatedToilet && room.hasDedicatedToilet) {
        score += 10
    }

    return score
}
