# Career Intelligence Service - Tier 0 (Batch 30). Mirrors matching-reasoning-service/Dockerfile exactly.

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

EXPOSE 4016

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4016/live || exit 1

CMD ["node", "dist/server.cjs"]
