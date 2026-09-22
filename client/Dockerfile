# Build context is the repo root: the client bundles files from shared/ (maps).
FROM node:22-alpine AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
COPY shared/ /app/shared/
RUN npm run build

FROM nginx:1.29-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
