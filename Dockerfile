FROM node:20

# Install minimal dependencies for Chromium (bundled with Puppeteer)
# These are the essential libraries needed for headless browser operation
# Using retry logic in case of transient network issues
RUN apt-get update || (sleep 5 && apt-get update) || (sleep 10 && apt-get update) \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source files
COPY . .

# Build the application
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Expose port
EXPOSE 3001

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV PUPPETEER_HEADLESS=true
# Ensure Puppeteer downloads its bundled Chromium (don't skip download)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
# IMPORTANT: Do NOT set PUPPETEER_EXECUTABLE_PATH here or in Railway
# Puppeteer will use its bundled Chromium by default (recommended for Railway)
# If PUPPETEER_EXECUTABLE_PATH is set in Railway's environment variables but
# the path doesn't exist, the code will automatically unset it and use bundled Chromium
# To use system Chrome, install it first in the Dockerfile and set the path:
# RUN apt-get install -y chromium && ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Start the application
CMD ["npm", "start"]

