FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json index.html robots.txt sitemap.xml ./
COPY --chown=node:node server/*.mjs ./server/
COPY --chown=node:node assets/*.js assets/*.css assets/*.svg assets/*.png ./assets/
COPY --chown=node:node assets/fonts/ ./assets/fonts/
COPY --chown=node:node apply/ ./apply/
COPY --chown=node:node member-sign-in/index.html ./member-sign-in/index.html
COPY --chown=node:node legal/index.html ./legal/index.html
COPY --chown=node:node cartel/index.html ./cartel/index.html
COPY --chown=node:node portal/ ./portal/
USER node
EXPOSE 8088
CMD ["node", "server/app.mjs"]

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS migrator
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node supabase/migrations/*.sql ./supabase/migrations/
COPY --chown=node:node scripts/staging-migrate.mjs ./scripts/staging-migrate.mjs
USER node
CMD ["node", "scripts/staging-migrate.mjs"]
