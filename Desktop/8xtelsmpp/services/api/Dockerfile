FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/core ./packages/core
COPY services/api ./services/api
RUN npm install --workspace=@8xtel/core --workspace=@8xtel/api --include-workspace-root=false 2>/dev/null || npm install -g npm@10 && npm install --prefix packages/core && npm install --prefix services/api
RUN npm run build --prefix packages/core && npm run build --prefix services/api

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/services/api/dist ./dist
COPY --from=build /app/services/api/package.json ./
COPY services/api/src/openapi.yaml ./dist/
COPY services/api/src/db/migrations ./dist/db/migrations
RUN npm install --omit=dev --ignore-scripts express cors helmet express-rate-limit bcryptjs jsonwebtoken multer csv-parse swagger-ui-express yamljs zod pg ioredis bullmq
EXPOSE 8080
CMD ["node", "dist/index.js"]
