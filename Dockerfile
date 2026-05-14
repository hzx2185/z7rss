FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY public ./public
COPY src ./src

RUN mkdir -p /app/data

EXPOSE 39018

CMD ["node", "src/server.js"]
