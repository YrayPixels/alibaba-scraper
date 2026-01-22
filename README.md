# Amazon Scraper Service

Express.js microservice for scraping Alibaba product pages. This service is designed to be deployed separately from the main application to avoid deployment issues with Puppeteer and browser dependencies.

## Features

- Scrapes Alibaba product pages using both browser (Puppeteer) and fetch methods
- **Persistent browser instance** - Reuses the same browser across requests to reduce captcha triggers
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

Create a `.env` file in the root directory with the following variables:

```env
PORT=3001
NODE_ENV=production
PUPPETEER_HEADLESS=true
# Optional: Only set if you have Chrome installed at this path
# If not set, Puppeteer will use its bundled Chromium (recommended)
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
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

# Captcha Solving Service (optional, for automatic captcha solving)
# Get API key from https://2captcha.com (or similar service)
CAPTCHA_SOLVER_API_KEY=your_2captcha_api_key_here
CAPTCHA_SOLVER_SERVICE=2captcha  # Options: 2captcha, anticaptcha, capsolver
CAPTCHA_SOLVER_TIMEOUT=120000  # Timeout in milliseconds (default: 120000 = 2 minutes)
CAPTCHA_SOLVER_POLLING_INTERVAL=5000  # Polling interval in milliseconds (default: 5000 = 5 seconds)
```

### Browser Reuse (Reduces Captcha Triggers)

**Important:** The service now uses a **persistent browser instance** that is reused across all requests. This helps significantly reduce captcha triggers because:

- **Session persistence**: Cookies and session data are maintained across requests
- **Reduced fingerprinting**: The same browser instance looks more like a real user session
- **Better trust score**: Sites are less likely to flag a persistent session as bot traffic

The browser instance:
- Is created once when the first request arrives
- Stays alive for the lifetime of the service
- Automatically restarts if it crashes or disconnects
- Is properly cleaned up on service shutdown

Each request creates a new page from the shared browser instance, then closes the page after scraping (keeping the browser alive).

### Captcha Solving

This service supports automatic captcha solving using third-party services like [2Captcha](https://2captcha.com). 

**Note:** Alibaba uses a custom slider captcha which may not be fully supported by standard captcha solving services. For production use, you may need to:

1. **Use a specialized service** that supports custom/Alibaba captchas
2. **Use residential proxies** to reduce captcha frequency
3. **Implement rate limiting** to avoid triggering captchas
4. **Use manual solving** in development (browser opens visibly for you to solve)

To enable automatic captcha solving:
1. Sign up for a captcha solving service (e.g., [2Captcha](https://2captcha.com))
2. Get your API key
3. Add `CAPTCHA_SOLVER_API_KEY` to your `.env` file
4. The service will automatically attempt to solve captchas when detected

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

This service can be deployed to Railway, Heroku, or any Node.js hosting platform.

### Railway Deployment

**Recommended Configuration (uses Puppeteer's bundled Chromium):**

1. **Do NOT set `PUPPETEER_EXECUTABLE_PATH`** - The service will automatically use Puppeteer's bundled Chromium
2. Set `PUPPETEER_HEADLESS=true` in Railway's environment variables
3. Set `NODE_ENV=production`
4. Set `PORT=3001` (or your preferred port)
5. **Set up Redis** (recommended):
   - Add a Redis service in Railway
   - Railway will automatically provide `REDIS_URL` environment variable
   - The service will automatically detect and use it

**If you need to use system Chrome instead:**
1. Install Chrome in your Dockerfile (add to Dockerfile):
   ```dockerfile
   RUN apt-get update && apt-get install -y google-chrome-stable
   ```
2. Set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable` in Railway
3. **Note:** The code will automatically fall back to bundled Chromium if Chrome is not found at the specified path

### General Deployment

For other platforms (Heroku, self-hosted, etc.):

1. **Option A (Recommended):** Use Puppeteer's bundled Chromium
   - Don't set `PUPPETEER_EXECUTABLE_PATH`
   - Puppeteer will download Chromium automatically during `npm install`

2. **Option B:** Use system Chrome/Chromium
   - Install Chrome/Chromium in your deployment environment
   - Set `PUPPETEER_EXECUTABLE_PATH` to the Chrome executable path
   - The code will automatically validate the path and fall back if needed

3. Set `PUPPETEER_HEADLESS=true` for production
4. Configure the main application to call this service via the service URL
5. **Set up Redis** (recommended for production):
   - Railway: Add a Redis service and use the `REDIS_URL` environment variable
   - Heroku: Add Redis addon and use the provided `REDIS_URL`
   - Self-hosted: Install Redis and configure `REDIS_HOST` and `REDIS_PORT`
   - The service will work without Redis, but caching significantly improves performance

