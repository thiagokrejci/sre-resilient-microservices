FROM node:20-slim as builder
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production

FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN groupadd -r sreuser && useradd -r -g sreuser sreuser
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN chown -R sreuser:sreuser /app
USER sreuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
