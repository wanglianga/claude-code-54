# ---------- 阶段一：构建前端 ----------
FROM node:22-alpine AS web-builder
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------- 阶段二：构建后端 ----------
FROM node:22-alpine AS server-builder
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ---------- 阶段三：运行时（非 root） ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=server-builder /build/server/node_modules ./node_modules
COPY --from=server-builder /build/server/dist ./dist
COPY --from=server-builder /build/server/package.json ./package.json
COPY --from=web-builder /build/web/dist ./public
RUN mkdir -p /app/data/uploads && chown -R app:app /app
USER app
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "dist/index.js"]
