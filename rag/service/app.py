#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os

from flask import Flask, jsonify, request

try:
    from rag.service.pipeline import (
        DEFAULT_EMBED_MODEL,
        DEFAULT_LLM_MODEL,
        RagPipeline,
        RagQueryOptions,
    )
except ImportError:
    from pipeline import DEFAULT_EMBED_MODEL, DEFAULT_LLM_MODEL, RagPipeline, RagQueryOptions

app = Flask(__name__)
pipeline = RagPipeline()


def _to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


@app.get("/health")
def health_check():
    return jsonify({"status": "ok", "service": "rag", "message": "ready"}), 200


@app.post("/rag/query")
def rag_query():
    payload = request.get_json(silent=True) or {}
    query = str(payload.get("query") or payload.get("q") or "").strip()
    if not query:
        return (
            jsonify(
                {
                    "status": "error",
                    "code": "INVALID_QUERY",
                    "message": "query는 필수입니다.",
                }
            ),
            400,
        )

    try:
        options = RagQueryOptions(
            topk=max(1, int(payload.get("topk", 15))),
            alpha=float(payload.get("alpha", 0.5)),
            must_contain=payload.get("must_contain"),
            rerank=_to_bool(payload.get("rerank"), False),
            no_expand=_to_bool(payload.get("no_expand"), False),
            llm_model=str(payload.get("llm_model") or DEFAULT_LLM_MODEL),
            embed_model=str(payload.get("embed_model") or DEFAULT_EMBED_MODEL),
            backend=str(payload.get("backend") or "supabase"),
            disease_yaml=payload.get("disease_yaml"),
        )

        result = pipeline.run_query(query, options)
        return jsonify({"status": "ok", "data": result}), 200
    except ValueError as exc:
        return jsonify({"status": "error", "code": "BAD_REQUEST", "message": str(exc)}), 400
    except Exception as exc:
        return (
            jsonify(
                {
                    "status": "error",
                    "code": "RAG_INTERNAL_ERROR",
                    "message": str(exc),
                }
            ),
            500,
        )


if __name__ == "__main__":
    host = os.getenv("RAG_API_HOST", "0.0.0.0")
    port = int(os.getenv("RAG_API_PORT", "8001"))
    app.run(host=host, port=port)
