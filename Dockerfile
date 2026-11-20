FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY server ./server
RUN npm run build:online

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/online-dist ./online-dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/arena.ts /app/src/simulation.ts /app/src/online-protocol.ts /app/src/online-regions.ts ./src/
USER node
EXPOSE 8080
CMD ["node", "server/index.ts"]

