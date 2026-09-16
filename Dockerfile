# Multi-stage build for all three services.
#
# One Dockerfile with named targets rather than three files: the workspace
# packages (`@car/shared`, `@car/catalog`, `@car/ranking`) are shared by every
# service, so a single dependency layer is installed once and reused. Compose
# selects the target per service.
#
# The servers run TypeScript directly through `tsx`, so they need no build step;
# only the web app compiles, and it compiles to static files.

# ----------------------------------------------------------------- deps
FROM node:22-alpine AS deps
WORKDIR /app

# Copy only the manifests first, so a source-only change doesn't reinstall.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/catalog/package.json ./packages/catalog/
COPY packages/ranking/package.json ./packages/ranking/
COPY packages/question-engine/package.json ./packages/question-engine/
COPY apps/mcp-marketplace/package.json ./apps/mcp-marketplace/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

# ----------------------------------------------------------------- source
FROM deps AS source
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# ----------------------------------------------------------------- mcp
FROM source AS mcp-marketplace
ENV NODE_ENV=production
ENV MCP_PORT=8081
EXPOSE 8081
# The catalogue is generated from a fixed seed, so a failing verify means the
# data contract broke — fail the container rather than serve wrong listings.
RUN npm run verify -w @car/catalog
CMD ["npm", "run", "start", "-w", "@car/mcp-marketplace"]

# ----------------------------------------------------------------- api
FROM source AS api
ENV NODE_ENV=production
ENV API_PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start", "-w", "@car/api"]

# ----------------------------------------------------------------- web build
FROM source AS web-build
WORKDIR /app
RUN npm run build -w @car/web

# ----------------------------------------------------------------- web
FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
