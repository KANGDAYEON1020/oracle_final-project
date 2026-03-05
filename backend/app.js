require("dotenv").config({ path: "../.env" });
const express = require("express");
const cors = require("cors");
const db = require("./db");
const demoClock = require("./middleware/demo-clock");

const app = express();
const PORT = process.env.EXPRESS_PORT || 5002;

// 미들웨어
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use("/api", demoClock);

// 헬스체크
app.get("/health", async (req, res) => {
  try {
    const result = await db.execute("SELECT 1 FROM DUAL");
    res.json({ status: "healthy", db: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// 라우트
const patientRoutes = require("./routes/patient");
const roomRoutes = require("./routes/room");
const transferRoutes = require("./routes/transfer");
const transferChecklistRoutes = require("./routes/transfer-checklist");
const draftRoutes = require("./routes/draft");
const plansRouter = require("./routes/plans");
const alertsRouter = require("./routes/alerts");
const guidelineRouter = require("./routes/guideline");
const explainRouter = require("./routes/explain");
const checklistRouter = require("./routes/checklist");

app.use("/api/patients", patientRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/transfer-cases", transferRoutes);
app.use("/api/transfer-checklist", transferChecklistRoutes);
app.use("/api/draft", draftRoutes);
app.use("/api/plans", plansRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/guideline-search", guidelineRouter);
app.use("/api/nlp/mdro/checklists", checklistRouter);
app.use("/api", explainRouter);

// 루트
app.get("/", (req, res) => {
  res.json({
    message: "INFECT-GUARD Express API",
    version: "1.0.0",
    endpoints: [
      "/api/patients",
      "/api/rooms",
      "/api/transfer-cases",
      "/api/transfer-checklist/snapshots",
      "/api/draft",
      "/api/nlp/mdro/checklists/logs",
      "/api/nlp/mdro/checklists/gap-metrics",
      "/api/patients/:patientId/explain",
      "/api/guideline-search",
      "/health",
    ],
  });
});

// 서버 시작
async function start() {
  try {
    await db.initialize();
    app.listen(PORT, () => {
      console.log(`Express server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start:", err);
    process.exit(1);
  }
}

start();
