# syntax=docker/dockerfile:1
# Build context is the monorepo ROOT (see docker-compose.yml).

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- Prune the workspace down to `jobs` + its dependencies ---
FROM base AS pruner
RUN npm install -g turbo@2.9.18
COPY . .
RUN turbo prune jobs --docker

# --- Install deps (layer-cached on manifests) and build ---
FROM base AS builder
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY .yarnrc.yml ./
COPY .yarn ./.yarn
COPY --from=pruner /app/out/json/ ./
RUN yarn install --inline-builds
COPY --from=pruner /app/out/full/ ./
# Placeholder so prisma.config.ts can resolve DATABASE_URL at generate time.
# `prisma generate` does not connect; the real URL is injected at runtime.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
RUN yarn turbo build --filter=jobs

# --- Runtime (long-running scheduler + health endpoint) ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3002
CMD ["node", "apps/jobs/dist/main.js"]
