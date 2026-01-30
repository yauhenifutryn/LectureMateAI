FROM node:20-slim as builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
RUN npm ci
COPY api ./api
COPY worker ./worker
RUN npx tsc -p worker/tsconfig.json

FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/worker/dist ./worker/dist
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "worker/dist/worker/index.js"]
