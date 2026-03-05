const express = require("express");
const db = require("../db");
const { commitRoomChanges } = require("../services/bed_allocation_service");
const { buildDemoFilter, patientVisibleClause } = require("../helpers/demo-filter");
const {
  fetchDiagnosisSnapshots,
  resolveInfectionPresentation,
} = require("../services/diagnosis_snapshot");

const router = express.Router();

function toErrorResponse(res, error) {
  const statusCode = Number(error?.statusCode || 500);
  const payload = { error: error?.message || "Internal Server Error" };
  if (error?.details) payload.details = error.details;
  return res.status(statusCode).json(payload);
}

// ============================================================
// 헬퍼: flat rows → nested room 객체 변환
// ============================================================
function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildRoomFromRows(rows, { visiblePatientIds = null, diagnosisMap = new Map() } = {}) {
  if (rows.length === 0) return null;
  const first = rows[0];
  const room = {
    id: first.ROOM_ID,
    roomNo: first.ROOM_NUMBER,
    wardId: first.WARD_ID,
    capacity: first.CAPACITY,
    cohortType: first.COHORT_TYPE || null,
    genderType: first.GENDER_TYPE || null,
    needsCleaning: first.NEEDS_CLEANING === 1,
    isIsolation: first.IS_ISOLATION === 1,
    hasAIIR: first.HAS_AIIR === 1,
    hasDedicatedToilet: first.HAS_DEDICATED_TOILET === 1,
    isolationType: first.ISOLATION_TYPE || null,
    tier: first.TIER || null,
    cohortLabel: null,
    beds: [],
  };
  let derivedCohortType = null;
  let derivedCohortLabel = null;

  for (const row of rows) {
    if (row.BED_ID) {
      const patientId = row.PATIENT_ID ? String(row.PATIENT_ID) : null;
      const isVisiblePatient =
        patientId && (!visiblePatientIds || visiblePatientIds.has(patientId));
      const admissionId = toFiniteNumber(row.ADMISSION_ID);
      const diagnosisSnapshot =
        admissionId != null ? diagnosisMap.get(admissionId) || null : null;
      const resolvedInfection = resolveInfectionPresentation({
        diagnosis: diagnosisSnapshot?.effectiveDiagnosis || null,
        fallbackInfectionCode: row.P_INFECTION_CODE,
      });

      if (isVisiblePatient && !derivedCohortType) {
        derivedCohortType = resolvedInfection.infection || null;
        derivedCohortLabel = resolvedInfection.infectionLabel || resolvedInfection.infection || null;
      }

      room.beds.push({
        id: row.BED_ID,
        patient: isVisiblePatient
          ? {
              id: patientId,
              name: row.P_NAME,
              age: row.P_AGE,
              gender: row.P_GENDER,
              infection: resolvedInfection.infection,
              infectionLabel: resolvedInfection.infectionLabel,
            }
          : null,
        isGhost: row.IS_GHOST === 1,
        ghostPatient: null,
      });
    }
  }
  if (derivedCohortType) {
    room.cohortType = derivedCohortType;
    room.cohortLabel = derivedCohortLabel || derivedCohortType;
  } else if (room.cohortType) {
    room.cohortLabel = room.cohortType;
  }
  return room;
}

async function fetchVisiblePatientIds(demoStep, demoShift) {
  const visibility = patientVisibleClause(demoStep ?? null, "a");
  if (!visibility.sql) return null;

  const trajFilter = buildDemoFilter(demoStep ?? null, demoShift ?? null, {
    tableAlias: "te",
    admissionsAlias: "a",
    dColumn: "d_number",
    shiftColumn: "shift",
    hasShift: true,
  });

  const result = await db.execute(
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

// 공통 JOIN 쿼리
const ROOM_SELECT = `
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
    r.room_id, r.ward_id, r.room_number, r.room_type, r.capacity,
    r.is_isolation, r.has_aiir, r.has_dedicated_toilet,
    r.isolation_type, r.tier, r.cohort_type, r.gender_type,
    r.needs_cleaning,
    b.bed_id, b.bed_number, b.patient_id, b.is_ghost,
    p.name AS p_name, p.age AS p_age, p.gender AS p_gender,
    p.infection_code AS p_infection_code,
    la.admission_id
  FROM rooms r
  LEFT JOIN beds b ON r.room_id = b.room_id
  LEFT JOIN patients p ON b.patient_id = p.patient_id
  LEFT JOIN latest_admission la
    ON la.patient_id = p.patient_id
   AND la.rn = 1`;

// GET /api/rooms — 전체 병실 목록 (beds + patient 포함)
router.get("/", async (req, res) => {
  try {
    const wardId = req.query.ward_id;
    let sql = ROOM_SELECT;
    const where = [];
    const binds = {};

    if (wardId) {
      where.push(`r.ward_id = :wardId`);
      binds.wardId = wardId;
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += ` ORDER BY r.room_id, b.bed_number`;

    const result = await db.execute(sql, binds);
    const visiblePatientIds = await fetchVisiblePatientIds(req.demoStep ?? null, req.demoShift ?? null);
    const admissionIds = [...new Set(
      (result.rows || [])
        .map((row) => toFiniteNumber(row.ADMISSION_ID))
        .filter((id) => id != null)
    )];
    const diagnosisMap = await fetchDiagnosisSnapshots(db.execute.bind(db), admissionIds, {
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
    });

    // flat rows → room 그룹핑
    const roomMap = new Map();
    for (const row of result.rows) {
      if (!roomMap.has(row.ROOM_ID)) {
        roomMap.set(row.ROOM_ID, []);
      }
      roomMap.get(row.ROOM_ID).push(row);
    }

    const rooms = [];
    for (const rows of roomMap.values()) {
      rooms.push(buildRoomFromRows(rows, { visiblePatientIds, diagnosisMap }));
    }

    res.json(rooms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rooms/commit-changes
router.post("/commit-changes", async (req, res) => {
  try {
    const result = await db.withTransaction((conn) =>
      commitRoomChanges(conn, {
        operations: req.body?.operations,
      })
    );
    res.json({ message: "Room changes committed", ...result });
  } catch (err) {
    return toErrorResponse(res, err);
  }
});

// GET /api/rooms/:id — 개별 병실 조회
router.get("/:id", async (req, res) => {
  try {
    const binds = { roomId: req.params.id };
    const result = await db.execute(
      ROOM_SELECT + ` WHERE r.room_id = :roomId ORDER BY b.bed_number`,
      binds
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    const visiblePatientIds = await fetchVisiblePatientIds(req.demoStep ?? null, req.demoShift ?? null);
    const admissionIds = [...new Set(
      (result.rows || [])
        .map((row) => toFiniteNumber(row.ADMISSION_ID))
        .filter((id) => id != null)
    )];
    const diagnosisMap = await fetchDiagnosisSnapshots(db.execute.bind(db), admissionIds, {
      demoStep: req.demoStep ?? null,
      demoShift: req.demoShift ?? null,
    });
    res.json(buildRoomFromRows(result.rows, { visiblePatientIds, diagnosisMap }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rooms — 병실 생성
router.post("/", async (req, res) => {
  const {
    id, roomNo, wardId, capacity,
    cohortType, needsCleaning, isIsolation,
    hasAIIR, hasDedicatedToilet, isolationType, tier,
  } = req.body;

  if (!id || !roomNo || !wardId || !capacity) {
    return res.status(400).json({ error: "Missing required fields: id, roomNo, wardId, capacity" });
  }

  try {
    await db.execute(
      `INSERT INTO rooms (
        room_id, ward_id, room_number, capacity,
        cohort_type, needs_cleaning, is_isolation,
        has_aiir, has_dedicated_toilet, isolation_type, tier
      ) VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11)`,
      [
        id, wardId, roomNo, capacity,
        cohortType || null, needsCleaning ? 1 : 0, isIsolation ? 1 : 0,
        hasAIIR ? 1 : 0, hasDedicatedToilet ? 1 : 0,
        isolationType || null, tier || null,
      ]
    );

    // beds 자동 생성
    const beds = req.body.beds || [];
    for (const bed of beds) {
      await db.execute(
        "INSERT INTO beds (bed_id, room_id, bed_number) VALUES (:1, :2, :3)",
        [bed.id, id, bed.id.split("-").pop()]
      );
    }

    res.status(201).json({ id, roomNo, wardId, capacity });
  } catch (err) {
    if (err.message.includes("ORA-00001")) {
      return res.status(400).json({ error: "Room ID already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rooms/:id — 병실 정보 수정
router.put("/:id", async (req, res) => {
  try {
    const fields = {
      cohortType: "cohort_type",
      genderType: "gender_type",
      needsCleaning: "needs_cleaning",
      isolationType: "isolation_type",
      tier: "tier",
    };

    const sets = [];
    const params = [];
    let idx = 1;

    for (const [jsKey, dbCol] of Object.entries(fields)) {
      if (req.body[jsKey] !== undefined) {
        const val = jsKey === "needsCleaning" ? (req.body[jsKey] ? 1 : 0) : req.body[jsKey];
        sets.push(`${dbCol} = :${idx++}`);
        params.push(val);
      }
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(req.params.id);
    const result = await db.execute(
      `UPDATE rooms SET ${sets.join(", ")} WHERE room_id = :${idx}`,
      params
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    res.json({ message: "Room updated", roomId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/rooms/:id/beds/:bedId — 베드 수정 (환자 배정/해제)
router.put("/:id/beds/:bedId", async (req, res) => {
  try {
    await db.withTransaction(async (conn) => {
      const bedRes = await conn.execute(
        `
          SELECT bed_id, room_id, patient_id
          FROM beds
          WHERE bed_id = :bedId
            AND room_id = :roomId
          FOR UPDATE
        `,
        { bedId: req.params.bedId, roomId: req.params.id }
      );

      if (bedRes.rows.length === 0) {
        throw Object.assign(new Error("Bed not found"), { statusCode: 404 });
      }

      const bed = bedRes.rows[0];
      const nextPatientId = req.body.patient_id;
      const hasPatientMutation = req.body.patient_id !== undefined;

      if (hasPatientMutation) {
        let op = null;
        if (nextPatientId == null || String(nextPatientId).trim() === "") {
          op = { type: "remove", bedId: req.params.bedId };
        } else if (!bed.PATIENT_ID) {
          op = { type: "assign", patientId: String(nextPatientId), toBedId: req.params.bedId };
        } else if (String(bed.PATIENT_ID) !== String(nextPatientId)) {
          throw Object.assign(
            new Error("Bed is already occupied by another patient"),
            { statusCode: 409 }
          );
        }

        if (op) {
          await commitRoomChanges(conn, { operations: [op] });
        }
      }

      if (req.body.isGhost !== undefined) {
        await conn.execute(
          `
            UPDATE beds
            SET is_ghost = :isGhost
            WHERE bed_id = :bedId
              AND room_id = :roomId
          `,
          {
            isGhost: req.body.isGhost ? 1 : 0,
            bedId: req.params.bedId,
            roomId: req.params.id,
          }
        );
      }
    });

    res.json({ message: "Bed updated", bedId: req.params.bedId, roomId: req.params.id });
  } catch (err) {
    return toErrorResponse(res, err);
  }
});

// DELETE /api/rooms/:id — 병실 삭제
router.delete("/:id", async (req, res) => {
  try {
    await db.execute("DELETE FROM beds WHERE room_id = :1", [req.params.id]);
    const result = await db.execute("DELETE FROM rooms WHERE room_id = :1", [req.params.id]);

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: "Room not found" });
    }

    res.json({ message: "Room deleted", roomId: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
