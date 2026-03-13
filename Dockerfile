FROM node:20-slim

# Install ffmpeg (needed for audio processing)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npx tsc

# Copy static files that tsc doesn't handle
RUN cp -r src/dashboard/public dist/dashboard/public

# Expose the dashboard port
EXPOSE 3000

# Cloud Run sets PORT env var, but our app uses DASHBOARD_PORT
# We'll handle this in the start command
CMD ["node", "dist/index.js"]
