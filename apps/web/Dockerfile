# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
# rewrites (/api -> API) are fixed at build time, so the API address is a build argument
ARG API_INTERNAL_URL=http://api:4000
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=$API_INTERNAL_URL
RUN pnpm install --frozen-lockfile && pnpm --filter @shopino/web build

FROM node:22-alpine AS runtime
WORKDIR /app
ARG API_INTERNAL_URL=http://api:4000
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 API_INTERNAL_URL=$API_INTERNAL_URL
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
