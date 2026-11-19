FROM node:24.22.3-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
USER root
# The console only serves static files. Remove unused modules tied to the base nginx version
# so Alpine can supply the patched nginx package before a refreshed base image is available.
RUN apk del --no-cache curl nginx-module-geoip nginx-module-image-filter nginx-module-njs nginx-module-xslt \
 && apk upgrade --no-cache \
 && apk add --no-cache --upgrade 'nginx>=1.30.7-r0'
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health
