const VALID_SHIFTS = new Set(["Day", "Evening", "Night"]);
const DEFAULT_DEMO_MAX_STEP = 16;
const DEFAULT_DEMO_BASE_DATE = "2026-02-09";

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed > 0 ? parsed : null;
}

module.exports = function demoClock(req, res, next) {
  const maxStep = parsePositiveInt(process.env.DEMO_MAX_STEP) || DEFAULT_DEMO_MAX_STEP;
  const baseDate = process.env.DEMO_BASE_DATE || DEFAULT_DEMO_BASE_DATE;

  const step = parsePositiveInt(req.query.demoStep);
  const shift = String(req.query.demoShift || "").trim();

  req.demoStep = null;
  req.demoShift = null;
  req.demoMaxStep = maxStep;
  req.demoBaseDate = baseDate;
  req.demoEnabled = false;

  if (step && step <= maxStep) {
    req.demoStep = step;
    req.demoEnabled = true;

    if (VALID_SHIFTS.has(shift)) {
      req.demoShift = shift;
    }
  }

  next();
};
