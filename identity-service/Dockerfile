# Identity Service - Tier 0 (Phase 11/12). Mirrors the root project's Dockerfile pattern (see
# /Dockerfile): multi-stage build, slim Alpine runtime, non-root user, HEALTHCHECK against the
# service's own liveness endpoint.

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build
RUN npm install --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S tejoma && adduser -S tejoma -G tejoma

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

RUN chown -R tejoma:tejoma /app
USER tejoma

EXPOSE 4001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4001/live || exit 1

CMD ["node", "dist/server.cjs"]
