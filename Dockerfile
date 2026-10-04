# NanoCLI Studio Dockerfile
# Multi-stage build for production deployment

# Stage 1: Build the Next.js application
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ clang llvm musl-dev git

# Copy package files
COPY package*.json ./

# Install dependencies (dev deps are needed for the build and for scriptc at runtime)
RUN npm ci

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production image
FROM node:22-alpine AS runner

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache python3 make g++ clang llvm musl-dev

# Copy built files from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/clang-wrapper.sh ./
COPY --from=builder /app/node_modules ./node_modules

# Create temp directory for compilation output
RUN mkdir -p temp

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_BASE_URL=http://localhost:3000
ENV SCRIPTC_LINKER=./clang-wrapper.sh

# Expose port
EXPOSE 3000

# Make clang-wrapper executable
RUN chmod +x clang-wrapper.sh

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

# Start the server
CMD ["node", "server.js"]
