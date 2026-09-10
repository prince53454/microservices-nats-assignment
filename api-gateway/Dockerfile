FROM node:20-alpine

# Build context is the repository root (see docker-compose.yml).
WORKDIR /app

COPY api-gateway/package.json ./
COPY shared ./shared
RUN npm install --omit=dev

COPY api-gateway/src ./src

EXPOSE 3000
CMD ["node", "src/server.js"]
