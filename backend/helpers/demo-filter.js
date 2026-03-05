const SHIFT_ORDER = {
  Day: 1,
  Evening: 2,
  Night: 3,
};

function toDemoStep(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getShiftOrder(shift) {
  return SHIFT_ORDER[shift] || null;
}

function formatDayLabel(d) {
  if (!Number.isFinite(d)) return null;
  return d >= 0 ? `D+${d}` : `D${d}`;
}

function addDaysIso(baseDate, days) {
  if (!baseDate || !Number.isFinite(days)) return null;
  const date = new Date(`${baseDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildEffectiveMaxDExpr(admissionsAlias = "a") {
  return `NVL(${admissionsAlias}.d_min, 0) + (:demoStep - NVL(${admissionsAlias}.demo_d_offset, 0) - 1)`;
}

function patientVisibleClause(demoStep, admissionsAlias = "a") {
  const normalizedStep = toDemoStep(demoStep);
  if (!normalizedStep) return { sql: "", binds: {} };

  return {
    sql:
      ` AND :demoStep >= NVL(${admissionsAlias}.demo_d_offset, 0) + 1` +
      ` AND :demoStep <= NVL(${admissionsAlias}.demo_d_offset, 0) + NVL(${admissionsAlias}.d_length, 0)`,
    binds: { demoStep: normalizedStep },
  };
}

function buildDemoFilter(demoStep, demoShift, options = {}) {
  const normalizedStep = toDemoStep(demoStep);
  if (!normalizedStep) return { sql: "", binds: {} };

  const {
    tableAlias = "t",
    admissionsAlias = "a",
    dColumn = "d_number",
    shiftColumn = "shift",
    hasShift = false,
  } = options;

  const effectiveMaxDExpr = buildEffectiveMaxDExpr(admissionsAlias);
  let sql = ` AND ${tableAlias}.${dColumn} <= (${effectiveMaxDExpr})`;
  const binds = { demoStep: normalizedStep };

  if (hasShift) {
    const shiftOrder = getShiftOrder(demoShift);
    if (shiftOrder) {
      binds.demoShiftOrder = shiftOrder;
      sql +=
        ` AND (` +
        ` ${tableAlias}.${dColumn} < (${effectiveMaxDExpr})` +
        ` OR (` +
        `   ${tableAlias}.${dColumn} = (${effectiveMaxDExpr})` +
        `   AND CASE UPPER(NVL(${tableAlias}.${shiftColumn}, ''))` +
        `         WHEN 'DAY' THEN 1` +
        `         WHEN 'EVENING' THEN 2` +
        `         WHEN 'NIGHT' THEN 3` +
        `         ELSE 99` +
        `       END <= :demoShiftOrder` +
        ` )` +
        `)`;
    }
  }

  return { sql, binds };
}

function buildDemoMeta({
  demoStep,
  demoShift,
  demoBaseDate = "2026-02-09",
  dMin,
  demoOffset,
}) {
  const normalizedStep = toDemoStep(demoStep);
  if (!normalizedStep) return null;

  const offset = Number.isFinite(Number(demoOffset)) ? Number(demoOffset) : 0;
  const minD = Number.isFinite(Number(dMin)) ? Number(dMin) : 0;
  const demoD = minD + (normalizedStep - offset - 1);

  return {
    demoStep: normalizedStep,
    demoShift: demoShift || null,
    demoDate: addDaysIso(demoBaseDate, normalizedStep - 1),
    demoD,
    demoDayLabel: formatDayLabel(demoD),
  };
}

module.exports = {
  SHIFT_ORDER,
  getShiftOrder,
  patientVisibleClause,
  buildEffectiveMaxDExpr,
  buildDemoFilter,
  buildDemoMeta,
};
