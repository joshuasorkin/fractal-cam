# Build the Vite app (npm ci also runs scripts/fetch-assets.mjs, which copies the
# MediaPipe WASM and downloads the tracking models into public/).
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

# Serve only the compiled dist/ folder.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
