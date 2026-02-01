FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN npx tsc -p server/tsconfig.json

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
