# ── build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
COPY knowledge ./knowledge

RUN npm run build

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Compiled output + knowledge seeds
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/knowledge ./knowledge
COPY start.sh ./

# SQLite DBs stored in /app/data (Railway Volumes can be mounted here if needed)
RUN mkdir -p /app/data

ENV VIGILANT_DB_PATH=/app/data/vigilant.db
ENV VIGILANT_KNOWLEDGE_DB_PATH=/app/data/knowledge.db
ENV NODE_ENV=production

# The start command is supplied at runtime via CMD override or VIGILANT_* env vars.
# Default: print help so the container fails loudly if misconfigured.
ENTRYPOINT ["node", "dist/bin.js"]
CMD ["--help"]
