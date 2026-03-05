FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
  "flask>=3.0" \
  "python-dotenv>=1.0" \
  "PyYAML>=6.0" \
  "requests>=2.31" \
  "openai>=1.10" \
  "sentence-transformers>=2.2.2" \
  "supabase==2.0.3" \
  "chromadb>=0.4" \
  "rank-bm25==0.2.2"

COPY . /app/rag
RUN mkdir -p /app/.cache/huggingface

EXPOSE 8001
CMD ["python", "-m", "rag.service.app"]
