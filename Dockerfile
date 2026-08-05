FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY archive/packages/storage-indexeddb/package.json archive/packages/storage-indexeddb/package.json
COPY packages/storage-mysql/package.json packages/storage-mysql/package.json
COPY packages/storage-secrets/package.json packages/storage-secrets/package.json
COPY packages/storage-sqlite/package.json packages/storage-sqlite/package.json
RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
COPY migrations ./migrations
RUN pnpm --filter @knowledge-base/client build:h5

FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends -y default-mysql-client nginx tini \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/nginx/sites-enabled/default

COPY --from=builder /app /app
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/mysql/scripts/reconcile-users.sh /app/docker/reconcile-users.sh
COPY docker/app-entrypoint.sh /app/docker/app-entrypoint.sh
RUN mkdir -p /var/lib/knowledge-base/secrets \
  && chmod 0700 /var/lib/knowledge-base/secrets \
  && rm -rf /app/node_modules/.pnpm/@tarojs+cli@*/node_modules/@tarojs/cli/src/__tests__ \
  && find /app -type f -name '.env' -delete \
  && chmod 0555 /app/docker/app-entrypoint.sh /app/docker/reconcile-users.sh

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(response => process.exit(response.status === 200 ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/app-entrypoint.sh"]
