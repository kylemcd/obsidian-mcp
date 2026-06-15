# syntax=docker/dockerfile:1

# --- Build stage: install all deps and compile TypeScript to dist/ ---
FROM node:24-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app
RUN corepack enable

# Install dependencies first so this layer caches across source-only changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Compile.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# --- Runtime stage: production deps + compiled output only ---
FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/kylemcd/obsidian-mcp"
LABEL org.opencontainers.image.description="Obsidian vault MCP server, designed to run behind Cloudflare Access."
LABEL org.opencontainers.image.licenses="MIT"

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    READ_ONLY=true \
    VAULT_PATH=/vault
WORKDIR /app
RUN corepack enable

# Install only production dependencies (the MCP Apps bundle is resolved from
# node_modules at runtime, so it must be present in the image).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

# Mount point for the vault; mount your local Markdown vault here (read-only
# unless you intend to allow writes).
VOLUME ["/vault"]

EXPOSE 8787
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
