# apps/store/Dockerfile
# Next.js Storefront - Build multi-stage

# ---- Base / deps ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspaces --if-present

# ---- Build ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspaces --if-present

# ---- Runtime ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/apps/store ./apps/store
COPY --from=builder --chown=nextjs:nodejs /app/apps/store/public ./public

USER nextjs
EXPOSE 3000

CMD ["npm", "run", "dev"]