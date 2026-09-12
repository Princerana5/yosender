# 8xtelSMPP admin panel — React SPA served by nginx.
# Build: docker build --build-arg VITE_API_URL=/api -f frontend/Dockerfile .
# VITE_API_URL=/api = same-origin via nginx /api proxy (no CORS, prod default).
# For direct-API setups pass the full URL instead, e.g.
#   --build-arg VITE_API_URL=https://api.example.com
FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
