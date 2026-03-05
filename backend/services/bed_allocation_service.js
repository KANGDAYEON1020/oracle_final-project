const oracledb = require("oracledb");
const { buildDemoFilter, getShiftOrder, patientVisibleClause } = require("../helpers/demo-filter");
const {
  computeEffectiveDemoSlot,
  fetchDiagnosisSnapshots,
  isSlotOnOrAfter,
  resolveInfectionPresentation,
} = require("./diagnosis_snapshot");

const INFECTION_MAP = {
  P01: "Pneumonia",
  P04: "Pneumonia",
  P05: "Pneumonia",
  U01: "UTI",
  G01: "Waterborne",
  G02: "Waterborne",
  M01: "MDRO",
  M03: "MDRO",
  T01: "Tick-borne",
  T02: "Tick-borne",
  T03: "Tick-borne",
};

const FE_TO_DB_PLAN_STATUS = {
  DRAFT: "DRAFT",
  READY_TO_COMMIT: "DRAFT",
  COMMITTED: "CONFIRMED",
  CANCELLED: "CANCELLED",
};

const DB_TO_FE_PLAN_STATUS = {
  DRAFT: "DRAFT",
  CONFIRMED: "COMMITTED",
  CANCELLED: "CANCELLED",
};

const TIER_CONFIG = {
  S: {
    priority: 3,
    fallbackOrder: ["single", "cohort_same_key_same_sex", "escalation"],
  },
  A: {
    priority: 2,
    fallbackOrder: ["single", "cohort_same_key_same_sex", "multibed_with_precautions"],
  },
  B: {
    priority: 1,
    fallbackOrder: ["single", "multibed_with_precautions", "cohort_same_key_same_sex"],
  },
};

const PATHOGEN_RULES = [
  {
    id: "TB_SUSPECT_OR_CONFIRMED",
    match: ["tb_suspected", "tb_confirmed", "mycobacterium_tuberculosis"],
    isolationType: "AIRBORNE",
    tier: "S",
    cohortAllowed: false,
    organismGroup: "TB",
    preferAIIR: true,
  },
  {
    id: "MEASLES",
    match: ["measles_suspected", "measles_confirmed"],
    isolationType: "AIRBORNE",
    tier: "S",
    cohortAllowed: false,
    organismGroup: "MEASLES",
    preferAIIR: true,
  },
  {
    id: "VARICELLA_OR_DISSEMINATED_ZOSTER",
    match: ["varicella", "disseminated_zoster", "zoster_disseminated"],
    isolationType: "AIRBORNE",
    tier: "S",
    cohortAllowed: false,
    organismGroup: "VARICELLA_ZOSTER",
    symptomGroup: "disseminated",
    preferAIIR: true,
  },
  {
    id: "CDI_SYMPTOMATIC",
    match: ["c_difficile_positive", "c_diff", "cdi"],
    isolationType: "CONTACT",
    tier: "S",
    cohortAllowed: true,
    organismGroup: "C_DIFF",
    symptomGroup: "diarrhea",
    preferDedicatedToilet: true,
  },
  {
    id: "VIRAL_GASTROENTERITIS",
    match: ["norovirus", "viral_gastroenteritis", "rotavirus"],
    isolationType: "CONTACT",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "VIRAL_GI",
    symptomGroup: "vomit_or_diarrhea",
    preferDedicatedToilet: true,
  },
  {
    id: "SCABIES",
    match: ["scabies_suspected", "scabies_confirmed", "scabies"],
    isolationType: "CONTACT",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "SCABIES",
  },
  {
    id: "CRE_CPE",
    match: ["cre", "cpe", "carbapenemase_producer"],
    isolationType: "CONTACT",
    tier: "S",
    cohortAllowed: true,
    organismGroup: "ENTEROBACTERALES",
    resistanceGroup: "CARBAPENEM_RESIST",
  },
  {
    id: "VRE",
    match: ["vre"],
    isolationType: "CONTACT",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "ENTEROCOCCUS",
    resistanceGroup: "VANCOMYCIN_RESIST",
  },
  {
    id: "MRSA",
    match: ["mrsa"],
    isolationType: "CONTACT",
    tier: "B",
    cohortAllowed: true,
    organismGroup: "STAPH_AUREUS",
    resistanceGroup: "METHICILLIN_RESIST",
  },
  {
    id: "CRAB",
    match: ["crab", "acinetobacter_mdr"],
    isolationType: "CONTACT",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "ACINETOBACTER",
    resistanceGroup: "CARBAPENEM_RESIST_OR_MDR",
  },
  {
    id: "CRPA",
    match: ["crpa", "pseudomonas_mdr"],
    isolationType: "CONTACT",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "PSEUDOMONAS",
    resistanceGroup: "CARBAPENEM_RESIST_OR_MDR",
  },
  {
    id: "INFLUENZA",
    match: ["influenza_a", "influenza_b", "influenza_positive", "influenza"],
    isolationType: "DROPLET",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "INFLUENZA",
    symptomGroup: "respiratory",
  },
  {
    id: "COVID19",
    match: ["sars_cov_2_positive", "covid19", "covid"],
    isolationType: "DROPLET",
    tier: "A",
    cohortAllowed: true,
    organismGroup: "SARS_COV_2",
    symptomGroup: "respiratory",
  },
];

const CLINICAL_TRIGGERS = [
  {
    id: "MRSA_RESPIRATORY_UPGRADE",
    matchFlags: ["uncontrolled_secretions", "severe_cough", "mrsa_pneumonia"],
    upgradeTier: "A",
  },
  {
    id: "MRSA_WOUND_UPGRADE",
    matchFlags: ["draining_wound_uncontained", "open_wound_mrsa"],
    upgradeTier: "A",
  },
  {
    id: "UNCONTROLLED_SECRETIONS_UPGRADE",
    matchFlags: ["uncontrolled_secretions", "draining_wound_uncontained"],
    upgradeTier: "A",
  },
  {
    id: "HEAVY_GI_SYMPTOMS_UPGRADE",
    matchFlags: ["diarrhea_profuse", "vomiting_profuse"],
    upgradeTier: "A",
    setIsolationType: "CONTACT",
    disallowCohort: true,
  },
];

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeFlagList(list) {
  return (Array.isArray(list) ? list : [])
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function buildInClause(values, prefix) {
  const binds = {};
  const placeholders = values.map((value, i) => {
    const key = `${prefix}${i}`;
    binds[key] = value;
    return `:${key}`;
  });
  return { placeholders: placeholders.join(", "), binds };
}

function formatPlanId(planId) {
  return `PLAN-${String(planId).padStart(3, "0")}`;
}

function parsePlanId(raw) {
  const text = String(raw || "").trim();
  const normalized = text.toUpperCase().startsWith("PLAN-")
    ? text.slice(5)
    : text;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizePlanStatusForDb(status) {
  const upper = String(status || "").trim().toUpperCase();
  return FE_TO_DB_PLAN_STATUS[upper] || null;
}

function normalizePlanStatusForFe(dbStatus) {
  const upper = String(dbStatus || "").trim().toUpperCase();
  return DB_TO_FE_PLAN_STATUS[upper] || "DRAFT";
}

function getTierPriority(tier) {
  if (!tier || !TIER_CONFIG[tier]) return 0;
  return TIER_CONFIG[tier].priority;
}

function shouldUpgradeTier(currentTier, targetTier) {
  if (!currentTier) return true;
  if (!targetTier) return false;
  return getTierPriority(targetTier) > getTierPriority(currentTier);
}

function buildCohortKey(isolationType, organismGroup, resistanceGroup, symptomGroup) {
  return `${isolationType}|${organismGroup}|${resistanceGroup || "none"}|${symptomGroup || "none"}`;
}

function determineIsolationRequirement(pathogenFlags = [], clinicalFlags = []) {
  const normalizedPathogenFlags = normalizeFlagList(pathogenFlags);
  const normalizedClinicalFlags = normalizeFlagList(clinicalFlags);

  let matchedRule = null;
  for (const rule of PATHOGEN_RULES) {
    if (rule.match.some((flag) => normalizedPathogenFlags.includes(flag))) {
      matchedRule = rule;
      break;
    }
  }

  if (!matchedRule) {
    return {
      tier: null,
      isolationType: "STANDARD",
      cohortAllowed: false,
      cohortKey: null,
      preferAIIR: false,
      preferDedicatedToilet: false,
    };
  }

  let finalTier = matchedRule.tier;
  let finalIsolationType = matchedRule.isolationType;
  let cohortAllowed = matchedRule.cohortAllowed;

  for (const trigger of CLINICAL_TRIGGERS) {
    if (trigger.matchFlags.some((flag) => normalizedClinicalFlags.includes(flag))) {
      if (trigger.upgradeTier && shouldUpgradeTier(finalTier, trigger.upgradeTier)) {
        finalTier = trigger.upgradeTier;
      }
      if (trigger.setIsolationType) {
        finalIsolationType = trigger.setIsolationType;
      }
      if (trigger.disallowCohort) {
        cohortAllowed = false;
      }
    }
  }

  const cohortKey = cohortAllowed
    ? buildCohortKey(
      finalIsolationType,
      matchedRule.organismGroup,
      matchedRule.resistanceGroup,
      matchedRule.symptomGroup
    )
    : null;

  return {
    tier: finalTier,
    isolationType: finalIsolationType,
    cohortAllowed,
    cohortKey,
    preferAIIR: Boolean(matchedRule.preferAIIR),
    preferDedicatedToilet: Boolean(matchedRule.preferDedicatedToilet),
  };
}

function getRoomQualityScore(room, requirement) {
  let score = 0;
  if (room.wardId === "5F") score += 30;
  if (requirement.preferAIIR && room.hasAIIR) score += 20;
  if (requirement.preferDedicatedToilet && room.hasDedicatedToilet) score += 10;
  return score;
}

function parseCsvFlags(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function enrichPathogenFlagsWithDiagnosisLabel(flags = [], infectionLabel = null) {
  const normalized = normalizeFlagList(flags);
  const set = new Set(normalized);
  const label = String(infectionLabel || "").trim().toUpperCase();

  if (label === "MRSA") set.add("mrsa");
  if (label === "CRE") set.add("cre");
  if (label === "VRE") set.add("vre");
  if (label === "CRAB") set.add("crab");
  if (label === "CRPA") set.add("crpa");

  return [...set];
}

function shouldPreferIsolationWard(transferCase, isolationReq) {
  if (isolationReq?.tier) return true;
  if (String(transferCase?.reason || "").trim() === "격리") return true;
  if (String(transferCase?.patient?.infection || "").trim().toUpperCase() === "MDRO") return true;

  const label = String(transferCase?.patient?.infectionLabel || "").trim().toUpperCase();
  if (["MRSA", "CRE", "VRE", "CRAB", "CRPA", "MDRO"].includes(label)) return true;

  return false;
}

function mapInfectionCodeToType(code) {
  return INFECTION_MAP[String(code || "").toUpperCase()] || "MDRO";
}

function shouldIncludeCaseByDiagnosisSlot(row, diagnosisSnapshot, demoStep, demoShift) {
  if (!diagnosisSnapshot?.firstMdroConfirmedSlot) return true;
  const currentSlot = computeEffectiveDemoSlot({
    demoStep,
    demoShift,
    dMin: row.D_MIN,
    demoOffset: row.DEMO_D_OFFSET,
  });
  if (!currentSlot) return true;
  return isSlotOnOrAfter(currentSlot, diagnosisSnapshot.firstMdroConfirmedSlot);
}

function deriveRoomCurrentGender(room, tempRoomGenderMap) {
  const temp = tempRoomGenderMap.get(room.id);
  if (temp) return temp;

  const genders = new Set(
    room.beds
      .filter((b) => b.patient)
      .map((b) => String(b.patient.gender || "").toUpperCase())
      .filter(Boolean)
  );

  if (genders.size === 0) return null;
  if (genders.size > 1) return "MIXED";
  return [...genders][0];
}

function deriveRoomCohortKey(room, tempRoomCohortMap) {
  const temp = tempRoomCohortMap.get(room.id);
  if (temp) return temp;
  if (room.cohortType) return `INFECTION_TYPE|${room.cohortType}`;
  return null;
}

function isGenderCompatible(room, patient, tempRoomGenderMap) {
  if (Number(room.capacity) === 1) return true;
  const currentGender = deriveRoomCurrentGender(room, tempRoomGenderMap);
  if (!currentGender) return true;
  if (currentGender === "MIXED") return false;
  return currentGender === String(patient.gender || "").toUpperCase();
}

function isCohortCompatible(room, patientCohortKey, tempRoomCohortMap) {
  if (!patientCohortKey) return false;
  const roomKey = deriveRoomCohortKey(room, tempRoomCohortMap);
  if (!roomKey) return true;
  return roomKey === patientCohortKey;
}

function getFirstAssignableBed(room, assignedBedIds) {
  return (
    room.beds.find(
      (bed) =>
        !bed.patient &&
        !assignedBedIds.has(bed.id) &&
        Number(bed.isGhost || 0) !== 1
    ) || null
  );
}

function parseItemMeta(reasonText) {
  const source = String(reasonText || "");
  const read = (key) => {
    const match = source.match(new RegExp(`${key}:([^;]+)`));
    return match ? match[1] : null;
  };
  return {
    caseId: read("case"),
    tier: read("tier"),
    strategy: read("strategy"),
  };
}

function buildItemReason({ caseId, tier, strategy }) {
  return `case:${caseId};tier:${tier || "NA"};strategy:${strategy || "NA"}`;
}

function computeDemoPlanDatetime({ demoStep, demoShift, demoBaseDate }) {
  const step = toFiniteNumber(demoStep);
  if (!step) return new Date();

  const baseDate = String(demoBaseDate || "2026-02-09").trim();
  const base = new Date(`${baseDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return new Date();

  base.setUTCDate(base.getUTCDate() + (step - 1));
  const shiftOrder = getShiftOrder(demoShift);

  if (shiftOrder === 1) {
    base.setUTCHours(13, 59, 59, 999);
  } else if (shiftOrder === 2) {
    base.setUTCHours(21, 59, 59, 999);
  } else if (shiftOrder === 3) {
    base.setUTCDate(base.getUTCDate() + 1);
    base.setUTCHours(5, 59, 59, 999);
  } else {
    base.setUTCHours(23, 59, 59, 999);
  }

  return base;
}

async function fetchVisiblePatientIds(conn, context = {}) {
  const demoStep = toFiniteNumber(context?.demoStep);
  if (!demoStep) return null;

  const visibility = patientVisibleClause(demoStep, "a");
  const trajFilter = buildDemoFilter(demoStep, context?.demoShift ?? null, {
    tableAlias: "te",
    admissionsAlias: "a",
    dColumn: "d_number",
    shiftColumn: "shift",
    hasShift: true,
  });

  const result = await conn.execute(
    `
      SELECT DISTINCT a.patient_id
      FROM admissions a
      WHERE 1 = 1
        ${visibility.sql}
        AND EXISTS (
          SELECT 1
          FROM trajectory_events te
          WHERE te.admission_id = a.admission_id
            ${trajFilter.sql}
        )
    `,
    { ...visibility.binds, ...trajFilter.binds }
  );

  return new Set((result.rows || []).map((row) => String(row.PATIENT_ID)));
}

async function fetchPlanningRooms(conn, scope = [], context = {}) {
  let whereSql = "";
  let binds = {};

  if (Array.isArray(scope) && scope.length > 0) {
    const normalizedScope = scope.map((v) => String(v).trim()).filter(Boolean);
    if (normalizedScope.length > 0) {
      const clause = buildInClause(normalizedScope, "w");
      whereSql = ` WHERE r.ward_id IN (${clause.placeholders})`;
      binds = clause.binds;
    }
  }

  const sql = `
    SELECT
      r.room_id,
      r.ward_id,
      r.room_number,
      r.capacity,
      r.needs_cleaning,
      r.is_isolation,
      r.has_aiir,
      r.has_dedicated_toilet,
      r.isolation_type,
      r.tier,
      r.cohort_type,
      r.gender_type,
      b.bed_id,
      b.patient_id,
      b.is_ghost,
      p.gender AS patient_gender,
      p.infection_code AS infection_code
    FROM rooms r
    LEFT JOIN beds b ON b.room_id = r.room_id
    LEFT JOIN patients p ON p.patient_id = b.patient_id
    ${whereSql}
    ORDER BY r.room_id, b.bed_number
  `;

  const result = await conn.execute(sql, binds);
  const roomMap = new Map();
  for (const row of result.rows || []) {
    const roomId = row.ROOM_ID;
    if (!roomMap.has(roomId)) {
      roomMap.set(roomId, {
        id: roomId,
        roomNo: row.ROOM_NUMBER,
        wardId: row.WARD_ID,
        capacity: Number(row.CAPACITY || 1),
        needsCleaning: Number(row.NEEDS_CLEANING || 0) === 1,
        isIsolation: Number(row.IS_ISOLATION || 0) === 1,
        hasAIIR: Number(row.HAS_AIIR || 0) === 1,
        hasDedicatedToilet: Number(row.HAS_DEDICATED_TOILET || 0) === 1,
        isolationType: row.ISOLATION_TYPE || null,
        tier: row.TIER || null,
        cohortType: row.COHORT_TYPE || null,
        genderType: row.GENDER_TYPE || null,
        beds: [],
      });
    }

    const room = roomMap.get(roomId);
    if (row.BED_ID) {
      const patientId = row.PATIENT_ID ? String(row.PATIENT_ID) : null;
      room.beds.push({
        id: row.BED_ID,
        isGhost: Number(row.IS_GHOST || 0),
        // Planning availability must follow real bed occupancy snapshot.
        // If we hide non-visible occupants here, draft can allocate occupied beds
        // and later fail at commit with 409 conflicts.
        patient: patientId
          ? {
            id: patientId,
            gender: row.PATIENT_GENDER,
            infection: mapInfectionCodeToType(row.INFECTION_CODE),
          }
          : null,
      });
    }
  }

  return [...roomMap.values()];
}

async function fetchPlanningCases(conn, caseIds, context = {}) {
  const normalized = (Array.isArray(caseIds) ? caseIds : [])
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (normalized.length === 0) return [];

  const inClause = buildInClause(normalized, "c");
  const sql = `
    WITH latest_admission AS (
      SELECT
        a.*,
        ROW_NUMBER() OVER (
          PARTITION BY a.patient_id
          ORDER BY
            CASE WHEN LOWER(NVL(a.status, 'active')) = 'active' THEN 0 ELSE 1 END,
            NVL(a.admit_date, DATE '1900-01-01') DESC,
            a.admission_id DESC
        ) AS rn
      FROM admissions a
    )
    SELECT
      tc.case_id,
      tc.patient_id,
      tc.status,
      tc.from_ward_id,
      tc.from_room_id,
      tc.to_ward_id,
      tc.to_room_id,
      tc.to_bed_id,
      tc.reason,
      tc.priority,
      tc.infection_type,
      tc.pathogen_flags,
      tc.clinical_flags,
      p.name,
      p.age,
      p.gender,
      p.infection_code,
      la.admission_id,
      la.d_min,
      la.demo_d_offset,
      ps.current_bed_id,
      b.room_id AS current_room_id,
      r.ward_id AS current_ward_id,
      COALESCE(tc.from_ward_id, r.ward_id) AS resolved_from_ward_id,
      COALESCE(tc.from_room_id, b.room_id) AS resolved_from_room_id
    FROM transfer_cases tc
    JOIN patients p ON p.patient_id = tc.patient_id
    LEFT JOIN latest_admission la
      ON la.patient_id = tc.patient_id
     AND la.rn = 1
    LEFT JOIN patient_status ps
      ON ps.admission_id = la.admission_id
    LEFT JOIN beds b
      ON b.bed_id = ps.current_bed_id
    LEFT JOIN rooms r
      ON r.room_id = b.room_id
    WHERE tc.case_id IN (${inClause.placeholders})
    ORDER BY tc.created_at ASC, tc.case_id ASC
  `;

  const result = await conn.execute(sql, inClause.binds);
  const visiblePatientIds = await fetchVisiblePatientIds(conn, context);
  const filteredRows = (result.rows || [])
    .filter((row) => {
      if (!visiblePatientIds) return true;
      return visiblePatientIds.has(String(row.PATIENT_ID));
    });

  const admissionIds = filteredRows
    .map((row) => Number(row.ADMISSION_ID))
    .filter((value) => Number.isFinite(value));
  const diagnosisMap = await fetchDiagnosisSnapshots(conn.execute.bind(conn), admissionIds, {
    demoStep: context.demoStep ?? null,
    demoShift: context.demoShift ?? null,
  });

  return filteredRows
    .filter((row) =>
      shouldIncludeCaseByDiagnosisSlot(
        row,
        diagnosisMap.get(Number(row.ADMISSION_ID)) || null,
        context.demoStep ?? null,
        context.demoShift ?? null,
      ))
    .map((row) => {
      const diagnosisSnapshot = diagnosisMap.get(Number(row.ADMISSION_ID)) || null;
      const resolvedInfection = resolveInfectionPresentation({
        diagnosis: diagnosisSnapshot?.effectiveDiagnosis || null,
        fallbackInfectionType: row.INFECTION_TYPE,
        fallbackInfectionCode: row.INFECTION_CODE,
      });
      const resolvedPathogenFlags = enrichPathogenFlagsWithDiagnosisLabel(
        parseCsvFlags(row.PATHOGEN_FLAGS),
        resolvedInfection.infectionLabel,
      );
      return {
        id: row.CASE_ID,
        status: row.STATUS,
        patient: {
          id: row.PATIENT_ID,
          name: row.NAME,
          age: row.AGE,
          gender: row.GENDER,
          infection: resolvedInfection.infection,
          infectionLabel: resolvedInfection.infectionLabel,
          pathogenFlags: resolvedPathogenFlags,
          clinicalFlags: parseCsvFlags(row.CLINICAL_FLAGS),
        },
        fromWard: row.RESOLVED_FROM_WARD_ID || null,
        fromRoom: row.RESOLVED_FROM_ROOM_ID || null,
        toWard: row.TO_WARD_ID || null,
        toRoom: row.TO_ROOM_ID || null,
        toBed: row.TO_BED_ID || null,
        reason: row.REASON || "격리",
        priority: row.PRIORITY || "normal",
        admissionId: row.ADMISSION_ID ? Number(row.ADMISSION_ID) : null,
        fromBedId: row.CURRENT_BED_ID || null,
      };
    });
}

function generateAssignments(cases, rooms) {
  const planItems = [];
  const assignedBedIds = new Set();
  const tempRoomCohortMap = new Map();
  const tempRoomGenderMap = new Map();

  const casesWithRequirement = cases.map((transferCase) => ({
    transferCase,
    isolationReq: determineIsolationRequirement(
      transferCase.patient.pathogenFlags,
      transferCase.patient.clinicalFlags
    ),
  }));

  casesWithRequirement.sort((a, b) => {
    const priorityA = getTierPriority(a.isolationReq.tier);
    const priorityB = getTierPriority(b.isolationReq.tier);
    return priorityB - priorityA;
  });

  for (const { transferCase, isolationReq } of casesWithRequirement) {
    const patient = transferCase.patient;
    const patientCohortKey =
      isolationReq.cohortKey || `INFECTION_TYPE|${patient.infection}`;
    const tier = isolationReq.tier || "B";
    const fallbackOrder = TIER_CONFIG[tier].fallbackOrder;

    const pickRoomCandidates = (candidateRooms, strategy) => {
      if (strategy === "single") {
        return candidateRooms
          .filter((room) => Number(room.capacity) === 1 && !room.needsCleaning)
          .sort((a, b) => getRoomQualityScore(b, isolationReq) - getRoomQualityScore(a, isolationReq));
      }

      if (strategy === "cohort_same_key_same_sex") {
        if (!isolationReq.cohortAllowed || !isolationReq.cohortKey) return [];
        return candidateRooms.filter(
          (room) =>
            Number(room.capacity) > 1 &&
            !room.needsCleaning &&
            isCohortCompatible(room, patientCohortKey, tempRoomCohortMap) &&
            isGenderCompatible(room, patient, tempRoomGenderMap)
        );
      }

      if (strategy === "multibed_with_precautions") {
        return candidateRooms.filter(
          (room) =>
            Number(room.capacity) > 1 &&
            !room.needsCleaning &&
            isCohortCompatible(room, patientCohortKey, tempRoomCohortMap) &&
            isGenderCompatible(room, patient, tempRoomGenderMap)
        );
      }

      return [];
    };

    let availableRooms = rooms;
    let triedIsolationWardOnly = false;
    if (shouldPreferIsolationWard(transferCase, isolationReq)) {
      const isolationWardRooms = rooms.filter((room) => room.wardId === "5F");
      const hasAssignableBed = isolationWardRooms.some(
        (room) => !room.needsCleaning && !!getFirstAssignableBed(room, assignedBedIds)
      );
      if (hasAssignableBed) {
        availableRooms = isolationWardRooms;
        triedIsolationWardOnly = true;
      }
    }

    let assigned = null;
    const tryAssignWithRooms = (candidateRooms) => {
      for (const strategy of fallbackOrder) {
        if (strategy === "escalation") continue;
        const strategyRooms = pickRoomCandidates(candidateRooms, strategy);
        for (const room of strategyRooms) {
          const bed = getFirstAssignableBed(room, assignedBedIds);
          if (!bed) continue;
          assigned = {
            caseId: transferCase.id,
            admissionId: transferCase.admissionId,
            patient,
            fromWard: transferCase.fromWard,
            fromRoom: transferCase.fromRoom,
            fromBedId: transferCase.fromBedId || null,
            toWard: room.wardId,
            toRoom: room.roomNo,
            toRoomId: room.id,
            toBed: bed.id,
            conflict: null,
            tier: isolationReq.tier || null,
            isolationType: isolationReq.isolationType,
            cohortKey: patientCohortKey,
            strategy,
          };
          assignedBedIds.add(bed.id);
          tempRoomCohortMap.set(room.id, patientCohortKey);
          if (Number(room.capacity) > 1) {
            tempRoomGenderMap.set(room.id, String(patient.gender || "").toUpperCase());
          }
          return true;
        }
      }
      return false;
    };

    if (!tryAssignWithRooms(availableRooms) && triedIsolationWardOnly) {
      tryAssignWithRooms(rooms);
    }

    if (assigned) {
      planItems.push(assigned);
      continue;
    }

    let conflictReason = "적합한 빈 베드 없음";
    if (isolationReq.tier === "S") {
      conflictReason = `엄격한 격리 필요 (${isolationReq.isolationType}) - 1인실 만실`;
    } else if (isolationReq.tier === "A") {
      conflictReason = `격리 필요 (${isolationReq.isolationType}) - 1인실 권장`;
    } else {
      const hasGenderConflict = rooms.some((room) => {
        if (Number(room.capacity) <= 1) return false;
        const roomKey = deriveRoomCohortKey(room, tempRoomCohortMap);
        const currentGender = deriveRoomCurrentGender(room, tempRoomGenderMap);
        return (
          roomKey === patientCohortKey &&
          currentGender &&
          currentGender !== "MIXED" &&
          currentGender !== String(patient.gender || "").toUpperCase() &&
          room.beds.some((bed) => !bed.patient)
        );
      });
      if (hasGenderConflict) {
        conflictReason = `성별 불일치 (${patient.gender === "M" ? "남성" : "여성"} 환자)`;
      }
    }

    planItems.push({
      caseId: transferCase.id,
      admissionId: transferCase.admissionId,
      patient,
      fromWard: transferCase.fromWard,
      fromRoom: transferCase.fromRoom,
      fromBedId: transferCase.fromBedId || null,
      toWard: transferCase.toWard || "2F",
      toRoom: "미정",
      toRoomId: null,
      toBed: "",
      conflict: conflictReason,
      tier: isolationReq.tier || null,
      isolationType: isolationReq.isolationType,
      cohortKey: patientCohortKey,
      strategy: null,
    });
  }

  return planItems;
}

async function upsertPatientStatus(conn, { admissionId, patientId, bedId }) {
  if (!admissionId || !patientId) return;

  let wardId = null;
  if (bedId) {
    const wardRes = await conn.execute(
      `
        SELECT r.ward_id
        FROM beds b
        JOIN rooms r ON r.room_id = b.room_id
        WHERE b.bed_id = :bedId
      `,
      { bedId }
    );
    wardId = wardRes.rows[0]?.WARD_ID || null;
  }

  await conn.execute(
    `
      MERGE INTO patient_status ps
      USING (
        SELECT
          :admissionId AS admission_id,
          :patientId AS patient_id,
          :bedId AS current_bed_id,
          :wardId AS ward_id
        FROM dual
      ) src
      ON (ps.admission_id = src.admission_id)
      WHEN MATCHED THEN UPDATE SET
        ps.patient_id = src.patient_id,
        ps.current_bed_id = src.current_bed_id,
        ps.ward_id = src.ward_id,
        ps.last_updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN INSERT (
        admission_id,
        patient_id,
        current_bed_id,
        ward_id,
        last_updated_at
      ) VALUES (
        src.admission_id,
        src.patient_id,
        src.current_bed_id,
        src.ward_id,
        SYSTIMESTAMP
      )
    `,
    { admissionId, patientId, bedId, wardId }
  );
}

async function recomputeRoomMetadata(conn, roomIds) {
  const normalized = [...new Set((Array.isArray(roomIds) ? roomIds : []).filter(Boolean))];
  for (const roomId of normalized) {
    const roomRes = await conn.execute(
      `SELECT capacity FROM rooms WHERE room_id = :roomId`,
      { roomId }
    );
    if (!roomRes.rows.length) continue;

    const capacity = Number(roomRes.rows[0].CAPACITY || 1);
    const occRes = await conn.execute(
      `
        SELECT p.gender, p.infection_code
        FROM beds b
        JOIN patients p ON p.patient_id = b.patient_id
        WHERE b.room_id = :roomId
      `,
      { roomId }
    );

    let genderType = null;
    let cohortType = null;

    if (occRes.rows.length > 0) {
      const genders = new Set(
        occRes.rows
          .map((row) => String(row.GENDER || "").toUpperCase())
          .filter(Boolean)
      );

      if (capacity > 1 && genders.size === 1) {
        genderType = [...genders][0];
      }

      const firstInfectionCode = occRes.rows[0]?.INFECTION_CODE;
      cohortType = mapInfectionCodeToType(firstInfectionCode);
    }

    await conn.execute(
      `
        UPDATE rooms
        SET cohort_type = :cohortType,
            gender_type = :genderType
        WHERE room_id = :roomId
      `,
      { roomId, cohortType, genderType }
    );
  }
}

async function resolveLatestAdmission(conn, patientId, cache) {
  if (!patientId) return null;
  if (cache.has(patientId)) return cache.get(patientId);

  const result = await conn.execute(
    `
      SELECT admission_id
      FROM (
        SELECT
          a.admission_id,
          ROW_NUMBER() OVER (
            ORDER BY
              CASE WHEN LOWER(NVL(a.status, 'active')) = 'active' THEN 0 ELSE 1 END,
              NVL(a.admit_date, DATE '1900-01-01') DESC,
              a.admission_id DESC
          ) AS rn
        FROM admissions a
        WHERE a.patient_id = :patientId
      )
      WHERE rn = 1
    `,
    { patientId }
  );

  const admissionId = result.rows[0]?.ADMISSION_ID
    ? Number(result.rows[0].ADMISSION_ID)
    : null;
  cache.set(patientId, admissionId);
  return admissionId;
}

async function listPlans(conn, { statuses = [], demoStep = null, demoShift = null } = {}) {
  const whereParts = [];
  const binds = {};

  if (Array.isArray(statuses) && statuses.length > 0) {
    const normalized = statuses
      .map((status) => normalizePlanStatusForDb(status))
      .filter(Boolean);
    if (normalized.length > 0) {
      const inClause = buildInClause(normalized, "s");
      whereParts.push(`bp.status IN (${inClause.placeholders})`);
      Object.assign(binds, inClause.binds);
    }
  }

  const visibility = patientVisibleClause(demoStep, "a");
  if (visibility.sql) {
    const trajFilter = buildDemoFilter(demoStep, demoShift, {
      tableAlias: "te",
      admissionsAlias: "a",
      dColumn: "d_number",
      shiftColumn: "shift",
      hasShift: true,
    });
    whereParts.push(
      `EXISTS (
        SELECT 1
        FROM bed_assignment_items bai
        JOIN admissions a ON a.admission_id = bai.admission_id
        WHERE bai.plan_id = bp.plan_id
          ${visibility.sql}
          AND EXISTS (
            SELECT 1
            FROM trajectory_events te
            WHERE te.admission_id = a.admission_id
            ${trajFilter.sql}
          )
      )`
    );
    Object.assign(binds, visibility.binds);
    Object.assign(binds, trajFilter.binds);
  }

  const whereSql = whereParts.length > 0 ? ` WHERE ${whereParts.join(" AND ")}` : "";

  const plansRes = await conn.execute(
    `
      SELECT
        bp.plan_id,
        bp.plan_datetime,
        bp.created_by,
        bp.created_by_type,
        bp.floor_scope,
        bp.patient_count,
        bp.status,
        bp.confirmed_at,
        bp.cancelled_at,
        bp.created_at
      FROM bed_assignment_plans bp
      ${whereSql}
      ORDER BY bp.created_at DESC, bp.plan_id DESC
    `,
    binds
  );

  const rows = plansRes.rows || [];
  const planIds = rows.map((row) => Number(row.PLAN_ID));
  const itemMap = await getPlanItemsByPlanIds(conn, planIds);

  return rows.map((row) => {
    const planId = Number(row.PLAN_ID);
    return {
      id: formatPlanId(planId),
      planId,
      status: normalizePlanStatusForFe(row.STATUS),
      createdAt: row.CREATED_AT,
      planDatetime: row.PLAN_DATETIME,
      createdBy: row.CREATED_BY || "자동배치",
      createdByType: row.CREATED_BY_TYPE || "manual",
      scope: row.FLOOR_SCOPE ? String(row.FLOOR_SCOPE).split(",").map((v) => v.trim()).filter(Boolean) : [],
      patientCount: Number(row.PATIENT_COUNT || 0),
      confirmedAt: row.CONFIRMED_AT || null,
      cancelledAt: row.CANCELLED_AT || null,
      items: itemMap.get(planId) || [],
    };
  });
}

async function getPlanItemsByPlanIds(conn, planIds) {
  const normalizedIds = [...new Set((planIds || []).map((v) => Number(v)).filter((v) => Number.isFinite(v)))];
  if (normalizedIds.length === 0) return new Map();

  const inClause = buildInClause(normalizedIds, "p");
  const result = await conn.execute(
    `
      SELECT
        bai.item_id,
        bai.plan_id,
        bai.admission_id,
        bai.from_bed_id,
        bai.to_bed_id,
        bai.reason,
        bai.infection_tag,
        bai.created_at,
        a.patient_id,
        p.name AS patient_name,
        p.age AS patient_age,
        p.gender AS patient_gender,
        p.infection_code,
        fr.ward_id AS from_ward_id,
        fr.room_number AS from_room_no,
        tr.ward_id AS to_ward_id,
        tr.room_number AS to_room_no
      FROM bed_assignment_items bai
      JOIN admissions a ON a.admission_id = bai.admission_id
      JOIN patients p ON p.patient_id = a.patient_id
      LEFT JOIN beds fb ON fb.bed_id = bai.from_bed_id
      LEFT JOIN rooms fr ON fr.room_id = fb.room_id
      LEFT JOIN beds tb ON tb.bed_id = bai.to_bed_id
      LEFT JOIN rooms tr ON tr.room_id = tb.room_id
      WHERE bai.plan_id IN (${inClause.placeholders})
      ORDER BY bai.item_id ASC
    `,
    inClause.binds
  );

  const map = new Map();
  for (const row of result.rows || []) {
    const planId = Number(row.PLAN_ID);
    if (!map.has(planId)) map.set(planId, []);

    const meta = parseItemMeta(row.REASON);
    map.get(planId).push({
      itemId: Number(row.ITEM_ID),
      caseId: meta.caseId || `CASE-${row.ITEM_ID}`,
      patient: {
        id: row.PATIENT_ID,
        name: row.PATIENT_NAME,
        age: row.PATIENT_AGE,
        gender: row.PATIENT_GENDER,
        infection: mapInfectionCodeToType(row.INFECTION_CODE),
        infectionLabel: row.INFECTION_TAG || mapInfectionCodeToType(row.INFECTION_CODE),
      },
      fromWard: row.FROM_WARD_ID || null,
      fromRoom: row.FROM_ROOM_NO || null,
      toWard: row.TO_WARD_ID || null,
      toRoom: row.TO_ROOM_NO || null,
      toBed: row.TO_BED_ID,
      conflict: null,
      tier: meta.tier || null,
      strategy: meta.strategy || null,
      infectionTag: row.INFECTION_TAG || null,
      admissionId: Number(row.ADMISSION_ID),
      fromBedId: row.FROM_BED_ID || null,
    });
  }

  return map;
}

async function generatePlanDraft(conn, payload, context = {}) {
  const caseIds = Array.isArray(payload?.caseIds) ? payload.caseIds : [];
  const scope = Array.isArray(payload?.scope) && payload.scope.length > 0
    ? payload.scope
    : ["2F", "3F", "5F"];
  const createdBy = String(payload?.createdBy || "자동배치");
  const createdByType = String(payload?.createdByType || "manual");

  if (caseIds.length === 0) {
    throw Object.assign(new Error("caseIds is required"), { statusCode: 400 });
  }

  const cases = await fetchPlanningCases(conn, caseIds, {
    demoStep: context.demoStep ?? null,
    demoShift: context.demoShift ?? null,
  });
  if (cases.length === 0) {
    throw Object.assign(new Error("No transfer cases found"), { statusCode: 404 });
  }

  const rooms = await fetchPlanningRooms(conn, scope, {
    demoStep: context.demoStep ?? null,
    demoShift: context.demoShift ?? null,
  });
  const generatedItems = generateAssignments(cases, rooms).map((item) => {
    if (!item.conflict && item.toBed && !item.admissionId) {
      return {
        ...item,
        conflict: "입원정보(admission_id) 없음 - 수동 조정 필요",
      };
    }
    return item;
  });

  const assignableItems = generatedItems.filter(
    (item) => !item.conflict && item.toBed && item.admissionId
  );
  const conflictItems = generatedItems.filter((item) => item.conflict || !item.toBed);

  const planDatetime = computeDemoPlanDatetime({
    demoStep: context.demoStep,
    demoShift: context.demoShift,
    demoBaseDate: context.demoBaseDate,
  });

  const insertResult = await conn.execute(
    `
      INSERT INTO bed_assignment_plans (
        plan_datetime,
        created_by,
        created_by_type,
        floor_scope,
        patient_count,
        status,
        algorithm_version
      ) VALUES (
        :planDatetime,
        :createdBy,
        :createdByType,
        :floorScope,
        :patientCount,
        'DRAFT',
        :algorithmVersion
      )
      RETURNING plan_id INTO :planId
    `,
    {
      planDatetime,
      createdBy,
      createdByType,
      floorScope: scope.join(","),
      patientCount: caseIds.length,
      algorithmVersion: "bed-allocation-v1",
      planId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    }
  );

  const rawPlanId = insertResult?.outBinds?.planId;
  const planId = Number(Array.isArray(rawPlanId) ? rawPlanId[0] : rawPlanId);
  if (!Number.isFinite(planId)) {
    throw Object.assign(new Error("Failed to create plan id"), { statusCode: 500 });
  }

  if (assignableItems.length > 0) {
    for (const item of assignableItems) {
      if (!item.admissionId) continue;
      await conn.execute(
        `
          INSERT INTO bed_assignment_items (
            plan_id,
            admission_id,
            from_bed_id,
            to_bed_id,
            reason,
            infection_tag
          ) VALUES (
            :planId,
            :admissionId,
            :fromBedId,
            :toBedId,
            :reason,
            :infectionTag
          )
        `,
        {
          planId,
          admissionId: item.admissionId,
          fromBedId: item.fromBedId || null,
          toBedId: item.toBed,
          reason: buildItemReason({
            caseId: item.caseId,
            tier: item.tier || "NA",
            strategy: item.strategy || "NA",
          }),
          infectionTag: item.patient?.infectionLabel || item.patient?.infection || null,
        }
      );
    }
  }

  const assignedByCaseId = new Map(assignableItems.map((item) => [item.caseId, item]));
  for (const caseId of caseIds) {
    const assigned = assignedByCaseId.get(caseId);
    if (assigned) {
      await conn.execute(
        `
          UPDATE transfer_cases
          SET status = 'PLANNED',
              plan_id = :planId,
              to_ward_id = :toWard,
              to_room_id = :toRoomId,
              to_bed_id = :toBedId,
              exception_reason = NULL,
              updated_at = SYSTIMESTAMP
          WHERE case_id = :caseId
        `,
        {
          planId,
          toWard: assigned.toWard,
          toRoomId: assigned.toRoomId,
          toBedId: assigned.toBed,
          caseId,
        }
      );
    } else {
      await conn.execute(
        `
          UPDATE transfer_cases
          SET status = 'WAITING',
              plan_id = NULL,
              to_ward_id = NULL,
              to_room_id = NULL,
              to_bed_id = NULL,
              updated_at = SYSTIMESTAMP
          WHERE case_id = :caseId
        `,
        { caseId }
      );
    }
  }

  return {
    id: formatPlanId(planId),
    planId,
    status: "DRAFT",
    createdAt: new Date(),
    planDatetime,
    createdBy,
    createdByType,
    scope,
    patientCount: caseIds.length,
    items: generatedItems.map((item) => ({
      caseId: item.caseId,
      patient: item.patient,
      fromWard: item.fromWard,
      fromRoom: item.fromRoom,
      toWard: item.toWard,
      toRoom: item.toRoom,
      toBed: item.toBed,
      conflict: item.conflict || undefined,
      tier: item.tier,
      strategy: item.strategy,
      admissionId: item.admissionId,
      fromBedId: item.fromBedId,
    })),
    meta: {
      assignedCount: assignableItems.length,
      conflictCount: conflictItems.length,
    },
  };
}

async function replacePlanItems(conn, planId, items) {
  const incomingItems = Array.isArray(items) ? items : [];

  await conn.execute(
    `DELETE FROM bed_assignment_items WHERE plan_id = :planId`,
    { planId }
  );

  await conn.execute(
    `
      UPDATE transfer_cases
      SET status = 'WAITING',
          plan_id = NULL,
          to_ward_id = NULL,
          to_room_id = NULL,
          to_bed_id = NULL,
          updated_at = SYSTIMESTAMP
      WHERE plan_id = :planId
    `,
    { planId }
  );

  const assignableItems = incomingItems.filter((item) => !item?.conflict && item?.toBed);
  for (const item of assignableItems) {
    const admissionId = item.admissionId
      ? Number(item.admissionId)
      : null;
    if (!admissionId) continue;

    const targetBedRes = await conn.execute(
      `
        SELECT b.room_id, r.ward_id
        FROM beds b
        JOIN rooms r ON r.room_id = b.room_id
        WHERE b.bed_id = :toBedId
      `,
      { toBedId: item.toBed }
    );
    const toRoomId = targetBedRes.rows[0]?.ROOM_ID || null;
    const toWardId = targetBedRes.rows[0]?.WARD_ID || null;

    await conn.execute(
      `
        INSERT INTO bed_assignment_items (
          plan_id,
          admission_id,
          from_bed_id,
          to_bed_id,
          reason,
          infection_tag
        ) VALUES (
          :planId,
          :admissionId,
          :fromBedId,
          :toBedId,
          :reason,
          :infectionTag
        )
      `,
      {
        planId,
        admissionId,
        fromBedId: item.fromBedId || null,
        toBedId: item.toBed,
        reason: buildItemReason({
          caseId: item.caseId,
          tier: item.tier || "NA",
          strategy: item.strategy || "NA",
        }),
        infectionTag: item.patient?.infectionLabel || item.patient?.infection || null,
      }
    );

    await conn.execute(
      `
        UPDATE transfer_cases
        SET status = 'PLANNED',
            plan_id = :planId,
            to_ward_id = :toWard,
            to_room_id = :toRoomId,
            to_bed_id = :toBedId,
            exception_reason = NULL,
            updated_at = SYSTIMESTAMP
        WHERE case_id = :caseId
      `,
      {
        planId,
        toWard: toWardId,
        toRoomId,
        toBedId: item.toBed,
        caseId: item.caseId,
      }
    );
  }

  return assignableItems.length;
}

async function commitPlan(conn, payload) {
  const planId = parsePlanId(payload?.planId);
  if (!planId) {
    throw Object.assign(new Error("Invalid planId"), { statusCode: 400 });
  }

  const planRes = await conn.execute(
    `SELECT plan_id, status FROM bed_assignment_plans WHERE plan_id = :planId FOR UPDATE`,
    { planId }
  );
  if (!planRes.rows.length) {
    throw Object.assign(new Error("Plan not found"), { statusCode: 404 });
  }

  const planStatus = String(planRes.rows[0].STATUS || "").toUpperCase();
  if (planStatus === "CANCELLED") {
    throw Object.assign(new Error("Cancelled plan cannot be committed"), { statusCode: 409 });
  }
  if (planStatus === "CONFIRMED") {
    return { planId: formatPlanId(planId), committed: 0, alreadyCommitted: true };
  }

  if (Array.isArray(payload?.items) && payload.items.length > 0) {
    await replacePlanItems(conn, planId, payload.items);
  }

  const itemRes = await conn.execute(
    `
      SELECT
        bai.item_id,
        bai.plan_id,
        bai.admission_id,
        bai.from_bed_id,
        bai.to_bed_id,
        bai.reason,
        a.patient_id,
        tb.room_id AS to_room_id
      FROM bed_assignment_items bai
      JOIN admissions a ON a.admission_id = bai.admission_id
      JOIN beds tb ON tb.bed_id = bai.to_bed_id
      WHERE bai.plan_id = :planId
      ORDER BY bai.item_id
    `,
    { planId }
  );

  const items = itemRes.rows || [];
  if (items.length === 0) {
    throw Object.assign(new Error("No assignable items in plan"), { statusCode: 409 });
  }

  const bedIdsToLock = new Set();
  for (const item of items) {
    bedIdsToLock.add(item.TO_BED_ID);
    if (item.FROM_BED_ID) bedIdsToLock.add(item.FROM_BED_ID);
  }

  const lockClause = buildInClause([...bedIdsToLock], "b");
  await conn.execute(
    `SELECT bed_id FROM beds WHERE bed_id IN (${lockClause.placeholders}) FOR UPDATE`,
    lockClause.binds
  );

  const bedStateRes = await conn.execute(
    `SELECT bed_id, patient_id, room_id, is_ghost FROM beds WHERE bed_id IN (${lockClause.placeholders})`,
    lockClause.binds
  );
  const bedStateMap = new Map((bedStateRes.rows || []).map((row) => [row.BED_ID, row]));

  const tierALockTargets = [];
  const touchedRoomIds = new Set();

  for (const item of items) {
    const patientId = item.PATIENT_ID;
    const toBed = bedStateMap.get(item.TO_BED_ID);
    if (!toBed) {
      throw Object.assign(new Error(`Target bed not found: ${item.TO_BED_ID}`), { statusCode: 409 });
    }
    if (toBed.PATIENT_ID && toBed.PATIENT_ID !== patientId) {
      throw Object.assign(
        new Error(`Target bed already occupied: ${item.TO_BED_ID} (occupiedBy=${toBed.PATIENT_ID})`),
        { statusCode: 409 }
      );
    }
  }

  for (const item of items) {
    const patientId = item.PATIENT_ID;
    const fromBedId = item.FROM_BED_ID;
    const toBedId = item.TO_BED_ID;
    const toRoomId = item.TO_ROOM_ID;

    if (fromBedId && fromBedId !== toBedId) {
      await conn.execute(
        `
          UPDATE beds
          SET patient_id = NULL,
              is_ghost = 0
          WHERE bed_id = :fromBedId
            AND patient_id = :patientId
        `,
        { fromBedId, patientId }
      );
      const fromRoomRes = await conn.execute(
        `SELECT room_id FROM beds WHERE bed_id = :fromBedId`,
        { fromBedId }
      );
      if (fromRoomRes.rows[0]?.ROOM_ID) {
        touchedRoomIds.add(fromRoomRes.rows[0].ROOM_ID);
      }
    }

    await conn.execute(
      `
        UPDATE beds
        SET patient_id = :patientId,
            is_ghost = 0
        WHERE bed_id = :toBedId
      `,
      { patientId, toBedId }
    );
    touchedRoomIds.add(toRoomId);

    await upsertPatientStatus(conn, {
      admissionId: Number(item.ADMISSION_ID),
      patientId,
      bedId: toBedId,
    });

    const meta = parseItemMeta(item.REASON);
    if (meta.tier === "A" && meta.strategy === "multibed_with_precautions" && toRoomId) {
      tierALockTargets.push({ roomId: toRoomId, keepBedId: toBedId });
    }
  }

  for (const target of tierALockTargets) {
    await conn.execute(
      `
        UPDATE beds
        SET is_ghost = 1
        WHERE room_id = :roomId
          AND bed_id <> :keepBedId
          AND patient_id IS NULL
      `,
      target
    );
  }

  await recomputeRoomMetadata(conn, [...touchedRoomIds]);

  const transferRes = await conn.execute(
    `
      UPDATE transfer_cases
      SET status = 'COMMITTED',
          updated_at = SYSTIMESTAMP
      WHERE plan_id = :planId
        AND status = 'PLANNED'
    `,
    { planId }
  );

  await conn.execute(
    `
      UPDATE bed_assignment_plans
      SET status = 'CONFIRMED',
          confirmed_at = SYSTIMESTAMP,
          cancelled_at = NULL
      WHERE plan_id = :planId
    `,
    { planId }
  );

  return {
    planId: formatPlanId(planId),
    committed: Number(transferRes.rowsAffected || 0),
    alreadyCommitted: false,
  };
}

async function rollbackPlan(conn, payload) {
  const planId = parsePlanId(payload?.planId || payload?.rawPlanId || payload?.id);
  if (!planId) {
    throw Object.assign(new Error("Invalid planId"), { statusCode: 400 });
  }

  const planRes = await conn.execute(
    `SELECT plan_id, status FROM bed_assignment_plans WHERE plan_id = :planId FOR UPDATE`,
    { planId }
  );
  if (!planRes.rows.length) {
    throw Object.assign(new Error("Plan not found"), { statusCode: 404 });
  }

  const status = String(planRes.rows[0].STATUS || "").toUpperCase();
  if (status !== "CONFIRMED") {
    throw Object.assign(new Error("Only committed plans can be rolled back"), { statusCode: 409 });
  }

  const itemRes = await conn.execute(
    `
      SELECT
        bai.item_id,
        bai.admission_id,
        bai.from_bed_id,
        bai.to_bed_id,
        a.patient_id,
        fb.room_id AS from_room_id,
        tb.room_id AS to_room_id
      FROM bed_assignment_items bai
      JOIN admissions a ON a.admission_id = bai.admission_id
      LEFT JOIN beds fb ON fb.bed_id = bai.from_bed_id
      LEFT JOIN beds tb ON tb.bed_id = bai.to_bed_id
      WHERE bai.plan_id = :planId
      ORDER BY bai.item_id
    `,
    { planId }
  );
  const items = itemRes.rows || [];

  const conflicts = [];
  for (const item of items) {
    if (item.FROM_BED_ID && item.FROM_BED_ID !== item.TO_BED_ID) {
      const fromBedRes = await conn.execute(
        `SELECT patient_id FROM beds WHERE bed_id = :bedId`,
        { bedId: item.FROM_BED_ID }
      );
      const occupiedBy = fromBedRes.rows[0]?.PATIENT_ID || null;
      if (occupiedBy && occupiedBy !== item.PATIENT_ID) {
        conflicts.push({
          fromBedId: item.FROM_BED_ID,
          occupiedBy,
          patientId: item.PATIENT_ID,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    const error = new Error("Rollback conflict: original beds already occupied");
    error.statusCode = 409;
    error.details = conflicts;
    throw error;
  }

  const touchedRoomIds = new Set();
  for (const item of items) {
    const patientId = item.PATIENT_ID;
    const toBedId = item.TO_BED_ID;
    const fromBedId = item.FROM_BED_ID;

    await conn.execute(
      `
        UPDATE beds
        SET patient_id = NULL,
            is_ghost = 0
        WHERE bed_id = :toBedId
          AND patient_id = :patientId
      `,
      { toBedId, patientId }
    );
    if (item.TO_ROOM_ID) touchedRoomIds.add(item.TO_ROOM_ID);

    if (fromBedId && fromBedId !== toBedId) {
      await conn.execute(
        `
          UPDATE beds
          SET patient_id = :patientId,
              is_ghost = 0
          WHERE bed_id = :fromBedId
        `,
        { fromBedId, patientId }
      );
      if (item.FROM_ROOM_ID) touchedRoomIds.add(item.FROM_ROOM_ID);
    }

    await upsertPatientStatus(conn, {
      admissionId: Number(item.ADMISSION_ID),
      patientId,
      bedId: fromBedId && fromBedId !== toBedId ? fromBedId : null,
    });
  }

  for (const roomId of touchedRoomIds) {
    await conn.execute(
      `
        UPDATE beds
        SET is_ghost = 0
        WHERE room_id = :roomId
          AND patient_id IS NULL
      `,
      { roomId }
    );
  }

  await recomputeRoomMetadata(conn, [...touchedRoomIds]);

  await conn.execute(
    `
      UPDATE transfer_cases
      SET status = 'WAITING',
          plan_id = NULL,
          to_ward_id = NULL,
          to_room_id = NULL,
          to_bed_id = NULL,
          updated_at = SYSTIMESTAMP
      WHERE plan_id = :planId
        AND status IN ('COMMITTED', 'PLANNED', 'NEEDS_EXCEPTION')
    `,
    { planId }
  );

  await conn.execute(
    `
      UPDATE bed_assignment_plans
      SET status = 'CANCELLED',
          cancelled_at = SYSTIMESTAMP
      WHERE plan_id = :planId
    `,
    { planId }
  );

  return { planId: formatPlanId(planId), rolledBack: items.length };
}

async function escalatePlan(conn, payload) {
  const planId = parsePlanId(payload?.planId || payload?.rawPlanId || payload?.id);
  if (!planId) {
    throw Object.assign(new Error("Invalid planId"), { statusCode: 400 });
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const caseIds = [...new Set(items.map((item) => String(item?.caseId || "").trim()).filter(Boolean))];
  if (caseIds.length === 0) {
    throw Object.assign(new Error("items(caseId) is required"), { statusCode: 400 });
  }

  const reasonCode = String(payload?.reasonCode || "MANUAL_EXCEPTION");
  const reasonText = String(payload?.reasonText || "").trim();
  const reason = reasonText ? `[${reasonCode}] ${reasonText}` : `[${reasonCode}] 수동 예외 처리`;

  const inClause = buildInClause(caseIds, "c");
  const result = await conn.execute(
    `
      UPDATE transfer_cases
      SET status = 'NEEDS_EXCEPTION',
          exception_reason = :reason,
          plan_id = NULL,
          updated_at = SYSTIMESTAMP
      WHERE case_id IN (${inClause.placeholders})
    `,
    { reason, ...inClause.binds }
  );

  return {
    planId: formatPlanId(planId),
    escalated: Number(result.rowsAffected || 0),
    reason,
  };
}

async function commitRoomChanges(conn, payload) {
  const operations = Array.isArray(payload?.operations) ? payload.operations : [];
  if (operations.length === 0) {
    throw Object.assign(new Error("operations is required"), { statusCode: 400 });
  }

  const admissionCache = new Map();
  const touchedRoomIds = new Set();
  let applied = 0;

  const getBed = async (bedId) => {
    const result = await conn.execute(
      `
        SELECT bed_id, room_id, patient_id, is_ghost
        FROM beds
        WHERE bed_id = :bedId
      `,
      { bedId }
    );
    return result.rows[0] || null;
  };

  for (const op of operations) {
    const type = String(op?.type || "").trim().toLowerCase();
    if (!type) continue;

    if (type === "move") {
      const patientId = String(op?.patientId || "").trim();
      const fromBedId = String(op?.fromBedId || "").trim();
      const toBedId = String(op?.toBedId || "").trim();
      if (!patientId || !fromBedId || !toBedId) {
        throw Object.assign(new Error("move requires patientId/fromBedId/toBedId"), { statusCode: 400 });
      }

      const fromBed = await getBed(fromBedId);
      const toBed = await getBed(toBedId);
      if (!fromBed || !toBed) {
        throw Object.assign(new Error("Bed not found in move operation"), { statusCode: 404 });
      }
      if (fromBed.PATIENT_ID !== patientId) {
        throw Object.assign(new Error(`Source bed mismatch: ${fromBedId}`), { statusCode: 409 });
      }
      if (toBed.PATIENT_ID && toBed.PATIENT_ID !== patientId) {
        throw Object.assign(new Error(`Target bed occupied: ${toBedId}`), { statusCode: 409 });
      }

      await conn.execute(
        `UPDATE beds SET patient_id = NULL, is_ghost = 0 WHERE bed_id = :fromBedId`,
        { fromBedId }
      );
      await conn.execute(
        `UPDATE beds SET patient_id = :patientId, is_ghost = 0 WHERE bed_id = :toBedId`,
        { patientId, toBedId }
      );

      const admissionId = await resolveLatestAdmission(conn, patientId, admissionCache);
      await upsertPatientStatus(conn, { admissionId, patientId, bedId: toBedId });

      touchedRoomIds.add(fromBed.ROOM_ID);
      touchedRoomIds.add(toBed.ROOM_ID);
      applied += 1;
      continue;
    }

    if (type === "remove") {
      const bedId = String(op?.bedId || "").trim();
      if (!bedId) {
        throw Object.assign(new Error("remove requires bedId"), { statusCode: 400 });
      }

      const bed = await getBed(bedId);
      if (!bed) {
        throw Object.assign(new Error(`Bed not found: ${bedId}`), { statusCode: 404 });
      }
      if (!bed.PATIENT_ID) {
        touchedRoomIds.add(bed.ROOM_ID);
        continue;
      }

      const patientId = bed.PATIENT_ID;
      await conn.execute(
        `UPDATE beds SET patient_id = NULL, is_ghost = 0 WHERE bed_id = :bedId`,
        { bedId }
      );

      const admissionId = await resolveLatestAdmission(conn, patientId, admissionCache);
      await upsertPatientStatus(conn, { admissionId, patientId, bedId: null });

      touchedRoomIds.add(bed.ROOM_ID);
      applied += 1;
      continue;
    }

    if (type === "assign") {
      const patientId = String(op?.patientId || "").trim();
      const toBedId = String(op?.toBedId || "").trim();
      if (!patientId || !toBedId) {
        throw Object.assign(new Error("assign requires patientId/toBedId"), { statusCode: 400 });
      }

      const toBed = await getBed(toBedId);
      if (!toBed) {
        throw Object.assign(new Error(`Bed not found: ${toBedId}`), { statusCode: 404 });
      }
      if (toBed.PATIENT_ID && toBed.PATIENT_ID !== patientId) {
        throw Object.assign(new Error(`Target bed occupied: ${toBedId}`), { statusCode: 409 });
      }

      await conn.execute(
        `UPDATE beds SET patient_id = :patientId, is_ghost = 0 WHERE bed_id = :toBedId`,
        { patientId, toBedId }
      );

      const admissionId = await resolveLatestAdmission(conn, patientId, admissionCache);
      await upsertPatientStatus(conn, { admissionId, patientId, bedId: toBedId });

      touchedRoomIds.add(toBed.ROOM_ID);
      applied += 1;
      continue;
    }

    throw Object.assign(new Error(`Unsupported operation type: ${type}`), { statusCode: 400 });
  }

  await recomputeRoomMetadata(conn, [...touchedRoomIds]);

  return { applied, touchedRooms: touchedRoomIds.size };
}

module.exports = {
  parsePlanId,
  formatPlanId,
  listPlans,
  generatePlanDraft,
  commitPlan,
  rollbackPlan,
  escalatePlan,
  commitRoomChanges,
  normalizePlanStatusForDb,
};
