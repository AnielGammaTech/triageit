FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/screenit-web/package.json ./apps/screenit-web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN npm ci --include=dev

FROM base AS builder
ARG NEXT_PUBLIC_SCREENIT_SUPABASE_URL
ARG NEXT_PUBLIC_SCREENIT_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SCREENIT_SUPABASE_URL=${NEXT_PUBLIC_SCREENIT_SUPABASE_URL}
ENV NEXT_PUBLIC_SCREENIT_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SCREENIT_SUPABASE_ANON_KEY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:screenit

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 screenit
COPY --from=builder --chown=screenit:nodejs /app/apps/screenit-web/.next/standalone ./
COPY --from=builder --chown=screenit:nodejs /app/apps/screenit-web/.next/static ./apps/screenit-web/.next/static
COPY --from=builder --chown=screenit:nodejs /app/apps/screenit-web/public ./apps/screenit-web/public
USER screenit
EXPOSE 3010
ENV PORT=3010
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/screenit-web/server.js"]
