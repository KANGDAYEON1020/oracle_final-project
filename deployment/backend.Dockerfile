FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python-is-python3 \
    libaio1 \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/pyenv \
  && /opt/pyenv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/pyenv/bin/pip install --no-cache-dir oracledb python-dotenv

WORKDIR /app/backend
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

RUN mkdir -p /app/data/scripts /opt/oracle/instantclient_23_3

ENV NODE_ENV=production
ENV LD_LIBRARY_PATH=/opt/oracle/instantclient_23_3
ENV PATH=/opt/pyenv/bin:$PATH

EXPOSE 5002
CMD ["node", "app.js"]
