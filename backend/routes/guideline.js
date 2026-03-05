const express = require("express");

const router = express.Router();

function normalizeBase(base) {
  const resolved = (base && base.trim()) || `http://localhost:${process.env.RAG_API_PORT || "8001"}`;
  return resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
}

const RAG_API_BASE = normalizeBase(process.env.RAG_API_BASE);
const RAG_API_TIMEOUT_MS = Number(process.env.RAG_API_TIMEOUT_MS || 45000);

router.get("/health", async (_req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(RAG_API_TIMEOUT_MS, 5000));

  try {
    const upstream = await fetch(`${RAG_API_BASE}/health`, { signal: controller.signal });
    const body = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(body);
  } catch (err) {
    if (err && err.name === "AbortError") {
      return res.status(504).json({
        status: "error",
        code: "RAG_TIMEOUT",
        message: "RAG health check timed out.",
      });
    }
    return res.status(502).json({
      status: "error",
      code: "RAG_UPSTREAM_UNAVAILABLE",
      message: "RAG service is unavailable.",
    });
  } finally {
    clearTimeout(timeout);
  }
});

router.post("/query", async (req, res) => {
  const query = (req.body?.query || "").trim();
  if (!query) {
    return res.status(400).json({
      status: "error",
      code: "INVALID_QUERY",
      message: "query is required",
    });
  }

  const payload = {
    query,
    topk: req.body?.topk,
    alpha: req.body?.alpha,
    must_contain: req.body?.must_contain,
    rerank: req.body?.rerank,
    no_expand: req.body?.no_expand,
    llm_model: req.body?.llm_model,
    embed_model: req.body?.embed_model,
    backend: req.body?.backend,
  };

  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAG_API_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${RAG_API_BASE}/rag/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await upstream.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { status: "error", code: "INVALID_UPSTREAM_RESPONSE", message: text || "No response body" };
    }

    return res.status(upstream.status).json(body);
  } catch (err) {
    if (err && err.name === "AbortError") {
      return res.status(504).json({
        status: "error",
        code: "RAG_TIMEOUT",
        message: `RAG request timed out after ${RAG_API_TIMEOUT_MS}ms`,
      });
    }

    return res.status(502).json({
      status: "error",
      code: "RAG_UPSTREAM_UNAVAILABLE",
      message: "Failed to connect to RAG service",
    });
  } finally {
    clearTimeout(timeout);
  }
});

module.exports = router;
