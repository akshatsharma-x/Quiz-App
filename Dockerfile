# QuizMUJ – single container: the Node server serves the API, Socket.io and the frontend
# on one port. Works on Render, Railway, Fly.io, Cloud Run (with session affinity) or any
# Docker host. Run exactly ONE instance: live-exam state and rate limits live in memory.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Install production dependencies from the lockfile (layer cached until package*.json change)
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

COPY backend/ backend/
COPY frontend/ frontend/

USER node
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "backend/src/server.js"]
