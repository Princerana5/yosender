# 8xtelSMPP vendor worker — upstream SMPP connectors + reconnect
# Build: docker build -f services/vendor-worker/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/vendor-worker/package.json ./services/vendor-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/vendor-worker --include-workspace-root=false
COPY packages/core ./packages/core
COPY services/vendor-worker ./services/vendor-worker
RUN npm run build --workspace=@8xtel/core && npm run build --workspace=@8xtel/vendor-worker

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/vendor-worker/package.json ./services/vendor-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/vendor-worker --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/services/vendor-worker/dist ./dist
CMD ["node", "dist/index.js"]
