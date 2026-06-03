FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --production=false
COPY index.ts ./
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist/index.js ./index.js
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Non-root user for security
RUN addgroup -g 1001 -S loom && adduser -S loom -u 1001 -G loom
USER loom

EXPOSE 8090
ENV PORT=8090 NODE_ENV=production
CMD ["node", "index.js"]
