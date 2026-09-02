# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no compilers, no dev dependencies and
# no source. Each stage's cache is keyed on the lockfile, so a source change does
# not reinstall node_modules.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/gateway apps/gateway
COPY apps/dashboard apps/dashboard
RUN npm run build -w gateway && npm run build -w dashboard

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/
# --omit=dev: the runtime image should not contain vitest, tsx or typescript.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/apps/gateway/dist apps/gateway/dist
COPY --from=build /app/apps/dashboard/dist apps/dashboard/dist
# Migrations are .sql files, not compiled output, so they are copied separately.
COPY apps/gateway/src/db/migrations apps/gateway/dist/db/migrations

ENV STATIC_ROOT=/app/apps/dashboard/dist
EXPOSE 3000

# Run unprivileged. A container process that does not need root should not have it.
USER node

# Readiness, not liveness: this is what the platform polls before routing traffic.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/gateway/dist/server.js"]
