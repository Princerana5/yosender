# 8xtelSMPP billing worker — wallet debit, vendor cost, profit ledger
# Build: docker build -f services/billing-worker/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/billing-worker/package.json ./services/billing-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/billing-worker --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY services/billing-worker ./services/billing-worker
RUN npm run build --workspace=@8xtel/core && npm run build --workspace=@8xtel/billing-worker

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/billing-worker/package.json ./services/billing-worker/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/billing-worker --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/services/billing-worker/dist ./dist
CMD ["node", "dist/index.js"]
