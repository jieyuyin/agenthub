FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/agent-runtime/package.json packages/agent-runtime/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/prompts/package.json packages/prompts/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=agenthub-pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm config set fetch-timeout 600000 && \
    pnpm config set fetch-retries 5 && \
    pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY apps/api apps/api
COPY apps/web apps/web
COPY packages packages
ARG NEXT_PUBLIC_API_URL=http://localhost:3003/api
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:3003
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV DATABASE_URL=file:/tmp/agenthub-build.db
RUN pnpm --filter @agenthub/api exec prisma generate --schema prisma/schema.prisma
RUN pnpm --filter @agenthub/api... build
RUN pnpm --filter @agenthub/web... build

FROM base AS api
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3003
CMD ["sh", "-lc", "pnpm --filter @agenthub/api exec prisma db push --schema prisma/schema.prisma --skip-generate && pnpm --filter @agenthub/api exec tsx src/server.ts"]

FROM base AS web
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@agenthub/web", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
