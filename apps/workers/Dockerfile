# syntax=docker/dockerfile:1
# Build context is the REPO ROOT: docker build -f apps/workers/Dockerfile .

FROM node:20-alpine AS base
RUN corepack enable

FROM base AS pruner
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY . .
RUN npx turbo prune @kamby/workers --docker

FROM base AS builder
WORKDIR /app
# openssl: Prisma's engine-detection at generate time needs the real OpenSSL present to
# pick the right binary — without it, it silently guesses wrong (see runner stage note).
RUN apk add --no-cache libc6-compat openssl
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@kamby/workers

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

CMD ["node", "apps/workers/dist/main.js"]
