# syntax=docker/dockerfile:1.4
# ==============================================================================
# Production Dockerfile for Smart Attendance Admin Web Dashboard (React/Vite)
# Multi-stage build compiling TypeScript/Vite into an optimized static Nginx bundle.
# Build context: monorepo root (.)
# Command: docker build -t smart-attendance-admin -f apps/admin/Dockerfile .
# ==============================================================================

# --- Stage 1: Build Static Assets ---
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Copy monorepo manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/admin/package.json ./apps/admin/

# Install dependencies deterministically
RUN npm ci --workspace=@smart-attendance/shared --workspace=admin

# Copy shared library and build
COPY packages/shared/ ./packages/shared/
RUN npm run build --workspace=@smart-attendance/shared

# Copy admin application source
COPY apps/admin/ ./apps/admin/

# Build-time environment argument for the backend API URL
# Default empty string enables relative /api proxying through the gateway reverse proxy
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

# Compile TypeScript and bundle Vite SPA
RUN npm run build --workspace=admin

# --- Stage 2: Serve with Nginx ---
FROM nginx:alpine-slim AS runner

# Remove default nginx website
RUN rm -rf /usr/share/nginx/html/*

# Copy built static assets from builder stage
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
