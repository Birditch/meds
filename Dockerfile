# Next.js standalone image. Built on the deploy host from a pinned commit (deploy/deploy.sh).

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.18.0 && npm cache clean --force
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The simulation is the product: refuse to build an image whose tests fail.
RUN pnpm test && pnpm build && chmod -R a+rX public .next/standalone .next/static

FROM node:24-alpine AS runner
WORKDIR /app
ARG COMMIT=unknown
LABEL org.opencontainers.image.source="https://github.com/Birditch/meds" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MEDS_COMMIT=${COMMIT}
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "server.js"]
