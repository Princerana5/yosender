# 8xtelSMPP routing worker — route engine (submit queue → vendor queue)
# Build: docker build -f services/routing-worker/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/routing-worker/package.json ./services/routing-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/routing-worker --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY services/routing-worker ./services/routing-worker
RUN npm run build --workspace=@8xtel/core && npm run build --workspace=@8xtel/routing-worker

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/routing-worker/package.json ./services/routing-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/routing-worker --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/services/routing-worker/dist ./dist
CMD ["node", "dist/index.js"]
