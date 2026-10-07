FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node src ./src
COPY --chown=node:node schema.sql ./schema.sql
USER node
EXPOSE 8080
CMD ["npm", "run", "start:prod"]
