# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.13.0
ARG PNPM_VERSION=10.28.2
ARG GENERATE_MCP_DOCS=true
ARG INSTALL_MCP_OPTIONAL=false
ARG BUILD_REVISION=unknown
ARG IMAGE_SOURCE=unknown

FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
ARG GENERATE_MCP_DOCS
WORKDIR /app

ENV NODE_ENV=test \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core \
  REDIS_URL=redis://localhost:6379 \
  JWT_SECRET=test-jwt-secret-min-32-chars-xxxxxxxx \
  JWT_PRIVATE_KEY=test-private-key \
  JWT_PUBLIC_KEY=test-public-key \
  ALLOWED_ORIGINS=http://localhost:3000 \
  AUDIT_RETENTION_DAYS=90 \
  AUTH_SESSION_RETENTION_DAYS=30 \
  METRICS_SCRAPE_TOKEN=test-metrics-token-min-32-characters \
  SECRETS_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && pnpm build:check \
  && if [ "$GENERATE_MCP_DOCS" = "true" ]; then \
       pnpm routes:catalog && pnpm docs:generate:multilang; \
     fi

FROM node:${NODE_VERSION}-alpine AS runtime
ARG PNPM_VERSION
ARG INSTALL_MCP_OPTIONAL
WORKDIR /app

ENV NODE_ENV=production

RUN apk upgrade --no-cache

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/src/shared/locales ./src/shared/locales
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --prod --ignore-scripts \
  $( [ "$INSTALL_MCP_OPTIONAL" = "true" ] || echo "--no-optional" ) \
  && rm -rf \
    /root/.cache/node/corepack \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx \
    /usr/local/lib/node_modules/npm

USER node

FROM runtime AS worker
ARG BUILD_REVISION
ARG IMAGE_SOURCE
LABEL org.opencontainers.image.source="${IMAGE_SOURCE}"
LABEL org.opencontainers.image.revision="${BUILD_REVISION}"

CMD ["node", "dist/src/worker.js"]

FROM runtime AS api
ARG BUILD_REVISION
ARG IMAGE_SOURCE
LABEL org.opencontainers.image.source="${IMAGE_SOURCE}"
LABEL org.opencontainers.image.revision="${BUILD_REVISION}"

COPY --from=build /app/docs/routes.txt ./docs/routes.txt
COPY --from=build /app/docs/openapi ./docs/openapi

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000
CMD ["node", "dist/src/server.js"]
