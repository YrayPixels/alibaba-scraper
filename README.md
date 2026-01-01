# Amazon Scraper Service

Express.js microservice for scraping Alibaba product pages. This service is designed to be deployed separately from the main application to avoid deployment issues with Puppeteer and browser dependencies.

## Features

- Scrapes Alibaba product pages using both browser (Puppeteer) and fetch methods
- Automatic fallback from browser scraping to fetch-based scraping
- Retry logic with configurable attempts
- **Redis caching** to avoid redundant scraping requests (optional)
- CORS enabled for cross-origin requests
- Health check endpoint

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Production

```bash
npm start
```

## Environment Variables

Copy `.env.example` to `.env` and configure the variables:

```bash
cp .env.example .env
```

Then edit `.env` with your settings. See `.env.example` for all available options with detailed comments.

```
PORT=3001
NODE_ENV=production
PUPPETEER_HEADLESS=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
USE_BROWSER_SCRAPING=true

# Redis Cache Configuration (optional)
# Option 1: Use Redis URL (recommended for cloud providers)
REDIS_URL=redis://localhost:6379
# or for Redis with password: redis://:password@host:port

# Option 2: Use individual connection parameters
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password_here

# Cache TTL in seconds (default: 21600 = 6 hours)
# 6 hours prevents stale data while still providing good performance
# Adjust based on your needs - shorter TTL = fresher data, longer TTL = better performance
CACHE_TTL_SECONDS=21600
```

**Note:** If Redis is not configured, the service will continue to work without caching. Caching is completely optional but highly recommended for production to reduce scraping load.

## API Endpoints

### Health Check

```
GET /health
```

Returns service status.

### Scrape Product

```
POST /scrape
Content-Type: application/json

{
  "url": "https://www.alibaba.com/product-detail/...",
  "useBrowser": true,      // Optional, defaults to true
  "retries": 2,            // Optional, defaults to 2
  "forceRefresh": false    // Optional, if true, bypasses cache and re-scrapes
}
```

Response:
```json
{
  "success": true,
  "cached": false,  // true if served from cache, false if freshly scraped
  "product": {
    "title": "...",
    "price": { "min": 10, "max": 20, "currency": "USD" },
    "images": [...],
    "mainImage": "...",
    "supplier": {...},
    "specifications": {...},
    ...
  }
}
```

**Caching Behavior:**
- If Redis is configured and a cached result exists, it will be returned immediately (much faster)
- Cache keys are based on normalized URLs (tracking parameters are removed)
- Default cache TTL is 6 hours (configurable via `CACHE_TTL_SECONDS`) - prevents stale product data
- Use `forceRefresh: true` to bypass cache and force a fresh scrape
- If Redis is unavailable, the service gracefully falls back to scraping without caching
- **Stale Data Prevention:** The 6-hour default ensures prices, stock, and product details stay relatively fresh

## Deployment

This service can be deployed to Railway, Heroku, or any Node.js hosting platform. Make sure to:

1. Install Chrome/Chromium in the deployment environment
2. Set `PUPPETEER_EXECUTABLE_PATH` to the Chrome executable path
3. Set `PUPPETEER_HEADLESS=true` for production
4. Configure the main application to call this service via the service URL
5. **Set up Redis** (recommended for production):
   - Railway: Add a Redis service and use the `REDIS_URL` environment variable
   - Heroku: Add Redis addon and use the provided `REDIS_URL`
   - Self-hosted: Install Redis and configure `REDIS_HOST` and `REDIS_PORT`
   - The service will work without Redis, but caching significantly improves performance

