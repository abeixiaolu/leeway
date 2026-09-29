FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate && pnpm build && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["sh", "-c", "pnpm db:migrate && pnpm exec next start -H 0.0.0.0 -p 3000"]
