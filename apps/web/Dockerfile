FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies from monorepo root
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/followit/package.json ./apps/followit/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev

# Build the app
FROM base AS builder
ENV NEXT_PUBLIC_SUPABASE_URL=https://ijhzkinomuzamyynvaal.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqaHpraW5vbXV6YW15eW52YWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3Nzg5NzUsImV4cCI6MjA4OTM1NDk3NX0.jOihrZosjzghfTuURkX0hxVzPOKeuBJlkgRD9QUaWGE
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:web

# Production runner
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# standalone output
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# public folder — create it (no static assets yet)
RUN mkdir -p ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]
