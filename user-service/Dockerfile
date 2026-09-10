FROM node:20-alpine

# Build context is the repository root (see docker-compose.yml), so we can
# copy the shared package alongside this service without publishing it to npm.
WORKDIR /app

COPY user-service/package.json ./
COPY shared ./shared
RUN npm install --omit=dev

COPY user-service/src ./src

EXPOSE 4001
CMD ["node", "src/server.js"]
