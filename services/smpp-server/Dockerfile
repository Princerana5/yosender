FROM node:20-alpine
WORKDIR /app
COPY packages/core ./packages/core
COPY services/smpp-server ./
RUN npm install --prefix packages/core --omit=dev 2>/dev/null; npm install --omit=dev
RUN npm run build --prefix packages/core 2>/dev/null; npx tsc -p tsconfig.json
EXPOSE 2775
CMD ["node", "dist/index.js"]
