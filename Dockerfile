FROM node:22-bookworm-slim

WORKDIR /app

ARG APP_VERSION=""
ARG BUILD_COMMIT=""
ARG BUILD_TIME=""

ENV NODE_ENV=production \
    PORT=80 \
    DB_PATH=/app/data/rss.db \
    APP_SECRET_FILE=/app/data/app-secret \
    APP_VERSION=${APP_VERSION} \
    BUILD_COMMIT=${BUILD_COMMIT} \
    BUILD_TIME=${BUILD_TIME} \
    DOCKER_IMAGE=hzx2185/z7rss \
    DOCKER_IMAGE_TAG=latest

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY public ./public
COPY src ./src

RUN mkdir -p /app/data

EXPOSE 80

CMD ["node", "src/server.js"]
