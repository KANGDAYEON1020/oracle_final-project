
import { Patient } from "./types"

/**
 * Calculates CURB-65 Score for Pneumonia Severity
 * @param patient Patient object
 * @returns Score (0-5)
 * 
 * Logic:
 * C: Confusion (Altered Mental Status) -> +1
 * U: Urea (BUN > 19 mg/dL) -> +1
 * R: Respiratory Rate >= 30 /min -> +1
 * B: Blood Pressure (SBP < 90 or DBP <= 60) -> +1
 * 65: Age >= 65 -> +1
 */
// ... existing imports

export interface CURB65Breakdown {
    score: number;
    details: {
        c: boolean; // Confusion
        u: boolean; // Urea > 19
        r: boolean; // RR >= 30
        b: boolean; // BP < 90/60
        age65: boolean; // Age >= 65
    };
    values: {
        bun: number;
        rr: number;
        sbp: number;
        dbp: number;
    };
}

export interface QSOFABreakdown {
    score: number;
    details: {
        q: boolean; // r(espiratory) rate >= 22
        s: boolean; // s(ystolic) BP <= 100
        a: boolean; // a(ltered) mental status
    };
    values: {
        rr: number;
        sbp: number;
    };
}

// ... existing calculateCURB65 function ...

export function calculateCURB65Detail(patient: Patient): CURB65Breakdown {
    if (!patient) return { score: 0, details: { c: false, u: false, r: false, b: false, age65: false }, values: { bun: 0, rr: 0, sbp: 0, dbp: 0 } };

    let score = 0;
    const latestVitals = patient.vitals && patient.vitals.length > 0
        ? patient.vitals[patient.vitals.length - 1]
        : null;

    const bunResult = patient.labResults.find(r => r.name === "BUN");
    const bunValue = bunResult ? parseFloat(bunResult.value) : 0;

    const c = patient.psiData.alteredMentalStatus;
    const u = bunValue > 19;
    const r = (latestVitals?.respiratoryRate ?? 0) >= 30;
    const b = (latestVitals?.bloodPressureSystolic ?? 120) < 90 || (latestVitals?.bloodPressureDiastolic ?? 80) <= 60;
    const age65 = patient.age >= 65;

    if (c) score++;
    if (u) score++;
    if (r) score++;
    if (b) score++;
    if (age65) score++;

    return {
        score,
        details: { c, u, r, b, age65 },
        values: {
            bun: bunValue,
            rr: latestVitals?.respiratoryRate ?? 0,
            sbp: latestVitals?.bloodPressureSystolic ?? 0,
            dbp: latestVitals?.bloodPressureDiastolic ?? 0
        }
    };
}

// ... existing calculateQSOFA function ...

export function calculateQSOFADetail(patient: Patient): QSOFABreakdown {
    if (!patient) return { score: 0, details: { q: false, s: false, a: false }, values: { rr: 0, sbp: 0 } };

    let score = 0;
    const latestVitals = patient.vitals && patient.vitals.length > 0
        ? patient.vitals[patient.vitals.length - 1]
        : null;

    const rr = (latestVitals?.respiratoryRate ?? 0) >= 22;
    const s = (latestVitals?.bloodPressureSystolic ?? 120) <= 100;
    const a = patient.psiData.alteredMentalStatus;

    if (rr) score++;
    if (s) score++;
    if (a) score++;

    return {
        score,
        details: { q: rr, s, a }, // q maps to respiratory rate in this context for naming consistency with qSOFA
        values: {
            rr: latestVitals?.respiratoryRate ?? 0,
            sbp: latestVitals?.bloodPressureSystolic ?? 0
        }
    };
}
