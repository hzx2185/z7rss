FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=80 \
    DB_PATH=/app/data/rss.db \
    APP_SECRET_FILE=/app/data/app-secret

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

RUN mkdir -p /app/data

EXPOSE 80

CMD ["node", "src/server.js"]
