FROM oven/bun:1.4.3
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
USER bun
CMD ["bun", "src/start.ts"]
