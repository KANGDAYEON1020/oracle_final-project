const express = require("express");
const db = require("../db");
const {
  parsePlanId,
  listPlans,
  generatePlanDraft,
  commitPlan,
  rollbackPlan,
  escalatePlan,
} = require("../services/bed_allocation_service");

const router = express.Router();

function parseStatusList(rawStatus) {
  if (!rawStatus) return [];
  return String(rawStatus)
    .split(",")
    .map((status) => status.trim())
    .filter(Boolean);
}

function toErrorResponse(res, error) {
  const statusCode = Number(error?.statusCode || 500);
  const payload = { error: error?.message || "Internal Server Error" };
  if (error?.details) payload.details = error.details;
  return res.status(statusCode).json(payload);
}

// GET /api/plans
router.get("/", async (req, res) => {
  try {
    const statuses = parseStatusList(req.query.status);
    const plans = await db.withTransaction((conn) =>
      listPlans(conn, {
        statuses,
        demoStep: req.demoStep ?? null,
        demoShift: req.demoShift ?? null,
      })
    );
    res.json(plans);
  } catch (error) {
    console.error("plans 조회 실패:", error);
    return toErrorResponse(res, error);
  }
});

// POST /api/plans/generate
router.post("/generate", async (req, res) => {
  try {
    const generated = await db.withTransaction((conn) =>
      generatePlanDraft(conn, req.body, {
        demoStep: req.demoStep ?? null,
        demoShift: req.demoShift ?? null,
        demoBaseDate: req.demoBaseDate ?? null,
      })
    );

    res.status(201).json(generated);
  } catch (error) {
    console.error("plans generate 실패:", error);
    return toErrorResponse(res, error);
  }
});

// POST /api/plans/commit
router.post("/commit", async (req, res) => {
  try {
    const result = await db.withTransaction((conn) =>
      commitPlan(conn, {
        planId: req.body?.planId,
        items: req.body?.items,
      })
    );
    res.json(result);
  } catch (error) {
    console.error("plans commit 실패:", error);
    return toErrorResponse(res, error);
  }
});

// POST /api/plans/:planId/rollback
router.post("/:planId/rollback", async (req, res) => {
  try {
    const numericPlanId = parsePlanId(req.params.planId);
    if (!numericPlanId) {
      return res.status(400).json({ error: "Invalid planId" });
    }

    const result = await db.withTransaction((conn) =>
      rollbackPlan(conn, { planId: numericPlanId })
    );

    res.json(result);
  } catch (error) {
    console.error("plans rollback 실패:", error);
    return toErrorResponse(res, error);
  }
});

// POST /api/plans/:planId/escalate
router.post("/:planId/escalate", async (req, res) => {
  try {
    const numericPlanId = parsePlanId(req.params.planId);
    if (!numericPlanId) {
      return res.status(400).json({ error: "Invalid planId" });
    }

    const result = await db.withTransaction((conn) =>
      escalatePlan(conn, {
        planId: numericPlanId,
        items: req.body?.items,
        reasonCode: req.body?.reasonCode,
        reasonText: req.body?.reasonText,
      })
    );

    res.json(result);
  } catch (error) {
    console.error("plans escalate 실패:", error);
    return toErrorResponse(res, error);
  }
});

module.exports = router;
