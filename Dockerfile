# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app
RUN npm install -g pnpm

# Copy config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/cli/package.json packages/cli/
COPY packages/types/package.json packages/types/
COPY packages/adapters/gemini/package.json packages/adapters/gemini/
COPY packages/adapters/claude/package.json packages/adapters/claude/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm run build

# Stage 2: Runtime
FROM node:20-slim
WORKDIR /app
RUN npm install -g pnpm

# Copy built artifacts and prod deps
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/ui/dist ./packages/ui/dist

# Copy configuration dirs
COPY agents ./agents
COPY skills ./skills
COPY prompts ./prompts
COPY context ./context
COPY hooks ./hooks
COPY .mcp.json ./

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose
EXPOSE 3000

# Start Core
CMD ["node", "packages/core/dist/index.js"]
