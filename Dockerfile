# ─── Stage 1: build the web app ───────────────────────────────────────────────
FROM node:20-alpine AS web-builder
WORKDIR /app

# Install web deps
COPY apps/web/package*.json apps/web/
RUN npm --prefix apps/web ci

# Copy web source and build
COPY apps/web/ apps/web/
RUN npm --prefix apps/web run build
# Output: apps/web/dist/

# ─── Stage 2: build the server ────────────────────────────────────────────────
FROM node:20-alpine AS server-builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ src/
RUN npm run build
# Output: dist/

# ─── Stage 3: production image ────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled server
COPY --from=server-builder /app/dist ./dist

# Built web app (served as static files)
COPY --from=web-builder /app/apps/web/dist ./public

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/server.js"]
