FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Run packaging for desktop app artifacts so downloads exist
RUN node desktop/package-desktop.js || true

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/storage/pirapire.db

COPY --from=builder /app /app

VOLUME ["/app/storage"]

EXPOSE 3000

CMD ["node", "server.js"]
