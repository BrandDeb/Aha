# NanoCLI Studio Dockerfile
# Multi-stage build for production deployment

# Stage 1: Build the Next.js application
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Toolchain for native modules without prebuilt binaries (e.g. bufferutil on arm64 musl)
RUN apk add --no-cache python3 make g++

# Install dependencies (dev deps are needed for the build)
RUN npm ci

# Copy source files
COPY . .

# Build the application, then drop dev-only packages from the runtime image
RUN npm run build && npm prune --omit=dev

# Stage 2: Production image
FROM node:24-alpine AS runner

WORKDIR /app

# Toolchain scriptc links with: clang/lld for native executables,
# zig for wasm32-wasi modules
RUN apk add --no-cache clang lld musl-dev zig

# Copy built files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/node_modules ./node_modules

# Create temp directory for compilation output
RUN mkdir -p temp

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Start the server
CMD ["node", "server.js"]
