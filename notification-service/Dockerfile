FROM node:20-alpine

# Build context is the repository root (see docker-compose.yml).
WORKDIR /app

COPY notification-service/package.json ./
COPY shared ./shared
RUN npm install --omit=dev

COPY notification-service/src ./src

EXPOSE 4002
CMD ["node", "src/server.js"]
