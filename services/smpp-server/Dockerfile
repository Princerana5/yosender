# 8xtelSMPP SMPP server — downstream client binds (:2775)
# Build: docker build -f services/smpp-server/Dockerfile .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/smpp-server/package.json ./services/smpp-server/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/smpp-server --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY services/smpp-server ./services/smpp-server
RUN npm run build --workspace=@8xtel/core && npm run build --workspace=@8xtel/smpp-server

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY services/smpp-server/package.json ./services/smpp-server/
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/smpp-server --include-workspace-root=false --omit=dev \
 && npm cache clean --force
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/services/smpp-server/dist ./dist
EXPOSE 2775
CMD ["node", "dist/index.js"]
