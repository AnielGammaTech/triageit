FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/followit/package.json ./apps/followit/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:followit

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /app/data/followit/uploads && \
    chown -R nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/apps/followit/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/followit/.next/static ./apps/followit/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/followit/public ./apps/followit/public

USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV FOLLOWIT_DATA_DIR=/app/data/followit
CMD ["node", "apps/followit/server.js"]
