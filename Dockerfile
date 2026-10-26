FROM node:22.23.4-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

ENV NODE_ENV=production
WORKDIR /app

COPY .nvmrc ./
COPY scripts/check-node-version.cjs ./scripts/check-node-version.cjs
RUN node scripts/check-node-version.cjs

# Copiar manifiestos primero aprovecha la caché de capas de Docker.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run inyecta PORT (8080 por defecto).
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
