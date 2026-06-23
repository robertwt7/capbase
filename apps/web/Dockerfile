# syntax=docker/dockerfile:1
# Build context is the monorepo ROOT (see docker-compose.yml).

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# --- Prune the workspace down to `web` + its dependencies ---
FROM base AS pruner
RUN npm install -g turbo@2.9.18
COPY . .
RUN turbo prune web --docker

# --- Install deps (layer-cached on manifests) and build ---
FROM base AS builder
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY .yarnrc.yml ./
COPY .yarn ./.yarn
COPY --from=pruner /app/out/json/ ./
RUN yarn install --inline-builds
COPY --from=pruner /app/out/full/ ./
RUN yarn turbo build --filter=web

# --- Runtime (Next standalone server) ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
# Standalone output is self-contained; copy server, static assets, and public.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
