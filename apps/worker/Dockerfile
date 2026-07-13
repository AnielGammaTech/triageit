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

# Remove compilers, test runners, and other development-only packages from the
# production image after the build has completed.
FROM deps AS prod-deps
RUN npm prune --omit=dev

# Production runner
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 worker

COPY --from=prod-deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder --chown=worker:nodejs /app/packages/shared ./packages/shared
COPY --from=builder --chown=worker:nodejs /app/package.json ./package.json

USER worker
EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/worker/dist/server.js"]
