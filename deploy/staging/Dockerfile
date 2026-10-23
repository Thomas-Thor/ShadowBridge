FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Optional enterprise build CA is mounted only for this step, never copied into
# an image. Default builds use the system trust store without any TLS bypass.
RUN --mount=type=secret,id=build-ca,required=false \
    if [ -f /run/secrets/build-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build-ca; fi; \
    npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
ARG SHADOWBRIDGE_RELEASE_SHA=""
LABEL org.opencontainers.image.revision=$SHADOWBRIDGE_RELEASE_SHA
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
ARG SHADOWBRIDGE_RELEASE_SHA=""
LABEL org.opencontainers.image.revision=$SHADOWBRIDGE_RELEASE_SHA
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node supabase/migrations/*.sql ./supabase/migrations/
COPY --chown=node:node scripts/staging-migrate.mjs ./scripts/staging-migrate.mjs
COPY --chown=node:node scripts/bootstrap-admin.mjs ./scripts/bootstrap-admin.mjs
USER node
CMD ["node", "scripts/staging-migrate.mjs"]
