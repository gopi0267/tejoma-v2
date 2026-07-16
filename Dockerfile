# Tejoma Node app - builds the React SPA (Vite) and the Express server (esbuild) in one stage,
# then copies only the runtime artifacts into a slim final image.

# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production-only node_modules for the final image (esbuild bundled server.ts with
# --packages=external, so node_modules must still be present at runtime).
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S tejoma && adduser -S tejoma -G tejoma

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Resume uploads land here transiently (deleted after parsing) - needs to exist and be writable.
RUN mkdir -p uploads && chown -R tejoma:tejoma /app

USER tejoma
EXPOSE 3006

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3006/api/health || exit 1

CMD ["node", "dist/server.cjs"]
