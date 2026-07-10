FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies from monorepo root
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev

# Build the worker
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:worker

# Production runner
FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/package.json ./package.json

EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/worker/dist/server.js"]
