# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @shopino/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @shopino/api...
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/db/drizzle packages/db/drizzle
USER node
EXPOSE 4000
# run `node apps/api/dist/migrate.js` once per deploy before starting new instances
CMD ["node", "apps/api/dist/server.js"]
