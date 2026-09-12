# syntax=docker/dockerfile:1
# Build context is the REPO ROOT: docker build -f apps/api/Dockerfile .
# Uses Turborepo's `prune` to keep the image to only what @kamby/api actually needs.

FROM node:20-alpine AS base
RUN corepack enable

# ---- Prune the workspace down to @kamby/api's dependency subgraph ----
FROM base AS pruner
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .
RUN npx turbo prune @kamby/api --docker

# ---- Install deps for the pruned subgraph, then build ----
FROM base AS builder
WORKDIR /app
# openssl: Prisma's engine-detection at generate time needs the real OpenSSL present to
# pick the right binary — without it, it silently guesses wrong (see runner stage note).
RUN apk add --no-cache libc6-compat openssl
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@kamby/api

# ---- Minimal runtime image ----
FROM base AS runner
WORKDIR /app
# openssl: node:20-alpine ships no OpenSSL package by default, so Prisma's runtime
# libssl-version detection fails and it loads an engine binary linked against
# libssl.so.1.1, which doesn't exist on modern Alpine (OpenSSL 3.x only) — crashes with
# "Error loading shared library libssl.so.1.1: No such file or directory". Installing the
# real package fixes detection at the source, rather than fighting binaryTargets guesses.
RUN apk add --no-cache openssl
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 kamby
USER kamby

COPY --from=builder --chown=kamby:nodejs /app .

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "apps/api/dist/main.js"]
