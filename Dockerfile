# syntax=docker/dockerfile:1
FROM node:20-slim AS base

ENV NODE_ENV=production \
    LOG_DIR=/var/log/mcp \
    PROMPTS_DIR=/data/prompts

# 시스템 deps (optional)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# 런타임 디렉토리 준비
RUN mkdir -p /data/prompts /var/log/mcp && chown -R node:node /data /var/log/mcp

USER node

# 헬스체크용 더미 스크립트(서버는 stdio MCP 서버이므로 생략 가능)
# HEALTHCHECK NONE

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
