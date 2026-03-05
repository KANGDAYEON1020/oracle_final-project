const express = require("express");
const db = require("../db");
const { buildDemoFilter, patientVisibleClause } = require("../helpers/demo-filter");
const {
  computeEffectiveDemoSlot,
  fetchDiagnosisSnapshots,
  isSlotOnOrAfter,
  resolveInfectionPresentation,
} = require("../services/diagnosis_snapshot");

const router = express.Router();

// ============================================================
// 헬퍼: Oracle row → FE TransferCase 변환
// ============================================================
function formatTransferCase(row, diagnosisSnapshot = null) {
  const resolvedInfection = resolveInfectionPresentation({
    diagnosis: diagnosisSnapshot?.effectiveDiagnosis || null,
    fallbackInfectionType: row.INFECTION_TYPE,
    fallbackInfectionCode: row.INFECTION_CODE,
  });

  return {
    id: row.CASE_ID,
    patient: {
      id: row.PATIENT_ID,
      name: row.NAME,
      age: row.AGE,
      gender: row.GENDER,
      infection: resolvedInfection.infection,
      infectionLabel: resolvedInfection.infectionLabel,
      pathogenFlags: row.PATHOGEN_FLAGS ? row.PATHOGEN_FLAGS.split(",") : [],
      clinicalFlags: row.CLINICAL_FLAGS ? row.CLINICAL_FLAGS.split(",") : [],
    },
    status: row.STATUS,
    fromWard: row.RESOLVED_FROM_WARD_ID || null,
    fromRoom: row.RESOLVED_FROM_ROOM_ID || null,
    toWard: row.TO_WARD_ID || null,
    toRoom: row.TO_ROOM_ID || null,
    toBed: row.TO_BED_ID || null,
    reason: row.REASON,
    priority: row.PRIORITY || "normal",
    exceptionReason: row.EXCEPTION_REASON || null,
    createdAt: row.CREATED_AT ? row.CREATED_AT.toISOString() : null,
  };
}

// 공통 JOIN 쿼리
const CASE_SELECT = `
  WITH latest_admission AS (
    SELECT *
    FROM (
      SELECT
        a.*,
        ROW_NUMBER() OVER (
          PARTITION BY a.patient_id
          ORDER BY NVL(a.admit_date, DATE '1900-01-01') DESC, a.admission_id DESC
        ) AS rn
      FROM admissions a
    )
    WHERE rn = 1
  )
  SELECT
    tc.case_id, tc.patient_id, tc.status,
    tc.from_ward_id, tc.from_room_id,
    tc.to_ward_id, tc.to_room_id, tc.to_bed_id,
    tc.reason, tc.priority, tc.exception_reason,
    tc.infection_type, tc.pathogen_flags, tc.clinical_flags,
    tc.created_at,
    la.admission_id,
    la.d_min,
    la.demo_d_offset,
    la.d_length,
    ps.current_bed_id,
    b.room_id AS current_room_id,
    r.ward_id AS current_ward_id,
    COALESCE(tc.from_ward_id, r.ward_id) AS resolved_from_ward_id,
    COALESCE(tc.from_room_id, b.room_id) AS resolved_from_room_id,
    p.name, p.age, p.gender, p.infection_code
  FROM transfer_cases tc
  JOIN patients p ON tc.patient_id = p.patient_id
  LEFT JOIN latest_admission la
    ON la.patient_id = tc.patient_id
  LEFT JOIN patient_status ps
    ON ps.admission_id = la.admission_id
  LEFT JOIN beds b
    ON b.bed_id = ps.current_bed_id
  LEFT JOIN rooms r
    ON r.room_id = b.room_id`;

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

async function runTransferCaseQuery({ where, binds, demoStep, demoShift }) {
  const sql = `${CASE_SELECT}${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY tc.created_at DESC`;
  const result = await db.execute(sql, binds);
  const rows = result.rows || [];

  const admissionIds = rows
    .map((row) => Number(row.ADMISSION_ID))
    .filter((id) => Number.isFinite(id));
  const diagnosisMap = await fetchDiagnosisSnapshots(db.execute.bind(db), admissionIds, {
    demoStep,
    demoShift,
  });

  return rows
    .filter((row) =>
      shouldIncludeCaseByDiagnosisSlot(
        row,
        diagnosisMap.get(Number(row.ADMISSION_ID)) || null,
        demoStep,
        demoShift,
      ))
    .map((row) => formatTransferCase(row, diagnosisMap.get(Number(row.ADMISSION_ID)) || null));
}

// GET /api/transfer-cases — 전체 이동 케이스 목록
router.get("/", async (req, res) => {
  try {
    const status = req.query.status;
    const where = [];
    const binds = {};

    if (status) {
      where.push(`tc.status = :status`);
      binds.status = status;
    }

    const visibility = patientVisibleClause(req.demoStep ?? null, "la");
    if (visibility.sql) {
      where.push(visibility.sql.replace(/^ AND\s*/i, ""));
      Object.assign(binds, visibility.binds);

      const trajFilter = buildDemoFilter(req.demoStep ?? null, req.demoShift ?? null, {
        tableAlias: "te",
        admissionsAlias: "la",
        dColumn: "d_number",
        shiftColumn: "shift",
        hasShift: true,
      });
      where.push(
        `EXISTS (
          SELECT 1
          FROM trajectory_events te
          WHERE te.admission_id = la.admission_id
          ${trajFilter.sql}
        )`
      );
      Object.assign(binds, trajFilter.binds);
    }

    const data = await runTransferCaseQuery({
      where,
      binds,
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/transfer-cases/:id — 개별 이동 케이스 조회
router.get("/:id", async (req, res) => {
  try {
    const visibility = patientVisibleClause(req.demoStep ?? null, "la");
    const where = ["tc.case_id = :id"];
    const binds = { id: req.params.id };

    if (visibility.sql) {
      where.push(visibility.sql.replace(/^ AND\s*/i, ""));
      Object.assign(binds, visibility.binds);
      const trajFilter = buildDemoFilter(req.demoStep ?? null, req.demoShift ?? null, {
        tableAlias: "te",
        admissionsAlias: "la",
        dColumn: "d_number",
        shiftColumn: "shift",
        hasShift: true,
      });
      where.push(
        `EXISTS (
          SELECT 1
          FROM trajectory_events te
          WHERE te.admission_id = la.admission_id
          ${trajFilter.sql}
        )`
      );
      Object.assign(binds, trajFilter.binds);
    }

    const data = await runTransferCaseQuery({
      where,
      binds,
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
    });
    if (data.length === 0) {
      return res.status(404).json({ error: "Transfer case not found" });
    }

    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transfer-cases — 이동 케이스 생성
router.post("/", async (req, res) => {
  const {
    id, patient_id, status, reason, priority,
    fromWard, fromRoom, toWard, toRoom, toBed,
    exceptionReason, infectionType, pathogenFlags, clinicalFlags,
  } = req.body;

  if (!id || !patient_id || !status || !reason || !priority) {
    return res.status(400).json({
      error: "Missing required fields: id, patient_id, status, reason, priority",
    });
  }

  try {
    // 환자 존재 확인
    const check = await db.execute(
      "SELECT patient_id FROM patients WHERE patient_id = :1",
      [patient_id]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: "Patient not found" });
    }

    await db.execute(
      `INSERT INTO transfer_cases (
        case_id, patient_id, status,
        from_ward_id, from_room_id, to_ward_id, to_room_id, to_bed_id,
        reason, priority, exception_reason,
        infection_type, pathogen_flags, clinical_flags
      ) VALUES (
        :1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13, :14
      )`,
      [
        id, patient_id, status,
        fromWard || null, fromRoom || null,
        toWard || null, toRoom || null, toBed || null,
        reason, priority, exceptionReason || null,
        infectionType || null,
        pathogenFlags ? pathogenFlags.join(",") : null,
        clinicalFlags ? clinicalFlags.join(",") : null,
      ]
    );

    res.status(201).json({ id, patient_id, status, reason, priority });
  } catch (err) {
    if (err.message.includes("ORA-00001")) {
      return res.status(400).json({ error: "Transfer case ID already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/transfer-cases/:id — 이동 케이스 수정
router.put("/:id", async (req, res) => {
  try {
    const fields = {
      status: "status",
      fromWard: "from_ward_id",
      fromRoom: "from_room_id",
      toWard: "to_ward_id",
      toRoom: "to_room_id",
      toBed: "to_bed_id",
      reason: "reason",
      priority: "priority",
      exceptionReason: "exception_reason",
    };

    const sets = [];
    const params = [];
    let idx = 1;

    for (const [jsKey, dbCol] of Object.entries(fields)) {
      if (req.body[jsKey] !== undefined) {
        sets.push(`${dbCol} = :${idx++}`);
        params.push(req.body[jsKey]);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(req.params.id);
    const result = await db.execute(
      `UPDATE transfer_cases SET ${sets.join(", ")} WHERE case_id = :${idx}`,
      params
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Transfer case not found" });
    }

    res.json({ message: "Transfer case updated", caseId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transfer-cases/:id — 이동 케이스 삭제
router.delete("/:id", async (req, res) => {
  try {
    const result = await db.execute(
      "DELETE FROM transfer_cases WHERE case_id = :1",
      [req.params.id]
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Transfer case not found" });
    }

    res.json({ message: "Transfer case deleted", caseId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
