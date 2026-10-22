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
# The runtime image installs zig from the system packages, so drop the bundled copy (~375 MB)
RUN npm run build && npm prune --omit=dev && rm -rf node_modules/@zigc

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

# Create temp directory for compilation output, owned by the unprivileged user the server runs as
RUN mkdir -p temp && chown -R node:node temp

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
# Inside a container the server must listen on all interfaces; publish the port deliberately
ENV HOST=0.0.0.0
# Python (uv) runs users' programs, so it is off in the image until the operator turns it on
# (NANOCLI_PYTHON=1) and provides a glibc Python environment and isolation
ENV NANOCLI_PYTHON=0
# The same goes for the other runners, web dev servers, local connectors and self-update: a container
# listening on all interfaces must not run visitors' code (they are off for HOST=0.0.0.0 anyway; this is explicit)
ENV NANOCLI_RUN=0
ENV NANOCLI_DEV=0
ENV NANOCLI_CONNECTORS=0
ENV NEXT_PUBLIC_BASE_URL=http://localhost:3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Never as root: compiles run user code through the toolchain
USER node

# Start the server
CMD ["node", "server.js"]
