# 8xtelSMPP RCS worker — isolated RCS routing, provider, webhook, and billing queues
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/rcs-worker/package.json ./services/rcs-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/rcs-worker --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY services/rcs-worker ./services/rcs-worker
RUN npm run build --workspace=@8xtel/core && npm run build --workspace=@8xtel/rcs-worker

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/rcs-worker/package.json ./services/rcs-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/rcs-worker --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/services/rcs-worker/dist ./dist
CMD ["node", "dist/index.js"]
