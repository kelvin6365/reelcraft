# ReelCraft — multi-target build (docs/tech/07-deployment.md)
#   docker build --target app -t reelcraft-app .
#   docker build --target worker -t reelcraft-worker .

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- app (Next standalone) ----------
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/standards ./standards
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# migrations run once at boot, then serve
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]

# ---------- worker (tsx runtime + ffmpeg) ----------
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini ffmpeg
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ENTRYPOINT ["/sbin/tini", "--"]
# worker + watchdog in one container, two processes
CMD ["sh", "-c", "npx tsx src/lib/workers/watchdog.ts & exec npx tsx src/lib/workers/index.ts"]
