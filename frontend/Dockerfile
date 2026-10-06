# syntax=docker/dockerfile:1.7
# Static SPA served by nginx. /api is reverse-proxied to BACKEND_URL so the browser sees one
# origin (no CORS in compose or on Cloud Run). Listens on $PORT (Cloud Run convention).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine AS runtime
ENV PORT=8080 \
    BACKEND_URL=http://backend:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
