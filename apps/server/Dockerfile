# syntax=docker/dockerfile:1.4
# ==============================================================================
# Production Dockerfile for Smart Attendance Hono Backend Server
# Multi-stage build for minimal image size, non-root execution, and security.
# Build context: monorepo root (.)
# Command: docker build -t smart-attendance-server -f apps/server/Dockerfile .
# ==============================================================================

# --- Stage 1: Base Runtime ---
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Install curl for healthcheck and python/opencv runtime for face matching engine (Milestone F5/F6)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    python3 \
    python3-numpy \
    python3-opencv \
    && rm -rf /var/lib/apt/lists/*

# --- Stage 2: Dependencies & Build ---
FROM base AS builder
ENV NODE_ENV=development

# Copy package manifests from monorepo root
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/

# Install dependencies deterministically via lockfile
RUN npm ci --workspace=@smart-attendance/shared --workspace=server

# Copy shared package source and compile TypeScript declarations
COPY packages/shared/ ./packages/shared/
RUN npm run build --workspace=@smart-attendance/shared

# Copy server application source code and migrations
COPY apps/server/ ./apps/server/

# Prune development dependencies for minimal production footprint
RUN npm prune --omit=dev --workspace=@smart-attendance/shared --workspace=server

# --- Stage 3: Production Runtime ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy root package manifests and production dependencies
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/server ./apps/server

# Run as non-root user for principle of least privilege
USER node

EXPOSE 3000

# Automated container healthcheck using Node.js built-in fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the Hono server via npm workspace
CMD ["npm", "start", "--workspace=server"]
