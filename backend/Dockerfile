# Mongoose 9 / MongoDB driver 7 require Node.js >= 20.19
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /usr/src/app

# Install production dependencies only (reproducible, from the lockfile)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Run as the unprivileged "node" user that ships with the image
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
