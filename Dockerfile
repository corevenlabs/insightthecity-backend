FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Copiar manifiestos primero aprovecha la caché de capas de Docker.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run inyecta PORT (8080 por defecto).
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
