# syntax=docker/dockerfile:1
# Build context is the monorepo ROOT (see docker-compose.yml).

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- Prune the workspace down to `api` + its dependencies ---
FROM base AS pruner
RUN npm install -g turbo@2.9.18
COPY . .
RUN turbo prune api --docker

# --- Install deps (layer-cached on manifests) and build ---
FROM base AS builder
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# Yarn berry config + release binary (turbo prune does not emit these).
COPY .yarnrc.yml ./
COPY .yarn ./.yarn
# Pruned manifests first so `yarn install` caches across source changes.
COPY --from=pruner /app/out/json/ ./
RUN yarn install --inline-builds
# Full pruned source, then build (turbo ^build runs @repo/db prisma generate).
COPY --from=pruner /app/out/full/ ./
# Placeholder so prisma.config.ts can resolve DATABASE_URL at generate time.
# `prisma generate` does not connect; the real URL is injected at runtime.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"
RUN yarn turbo build --filter=api

# --- Runtime ---
FROM base AS runner
# OpenSSL is required by Prisma's migration engine (`migrate deploy` on boot).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
# Apply pending migrations, then start the API.
CMD ["sh", "-c", "yarn workspace @repo/db migrate:deploy && node apps/api/dist/main.js"]
