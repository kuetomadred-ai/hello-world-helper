FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=optional
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "src/start.ts"]
