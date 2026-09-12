# 8xtelSMPP API — REST + admin backend + Swagger
# Build: docker build -f services/api/Dockerfile .
# Needs repo root as context (imports packages/core).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/api/package.json ./services/api/
# Install with workspaces so @8xtel/core resolves; dev deps needed for tsc.
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/api --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY services/api ./services/api
RUN npm run build --workspace=@8xtel/core && npm run build --workspace=@8xtel/api

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/api/package.json ./services/api/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/api --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/services/api/dist ./dist
# Runtime assets resolved relative to dist/
COPY services/api/src/openapi.yaml ./dist/
COPY services/api/src/db/migrations ./dist/db/migrations
EXPOSE 8080
CMD ["node", "dist/index.js"]
