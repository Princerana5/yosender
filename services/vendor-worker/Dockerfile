FROM node:20-alpine
WORKDIR /app
COPY packages/core ./packages/core
COPY services/vendor-worker ./
RUN npm install --prefix packages/core --omit=dev 2>/dev/null; npm install --omit=dev
RUN npx tsc -p packages/core/tsconfig.json 2>/dev/null; npx tsc -p tsconfig.json
CMD ["node", "dist/index.js"]
