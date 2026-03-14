FROM node:20-slim

# Install ffmpeg (needed for audio transcoding)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install all dependencies (need devDeps for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Copy static files that tsc doesn't handle
RUN cp -r src/dashboard/public dist/dashboard/public

# Remove dev dependencies to slim down
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist/index.js"]
