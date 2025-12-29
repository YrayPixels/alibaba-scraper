# Amazon Scraper Service

Express.js microservice for scraping Alibaba product pages. This service is designed to be deployed separately from the main application to avoid deployment issues with Puppeteer and browser dependencies.

## Features

- Scrapes Alibaba product pages using both browser (Puppeteer) and fetch methods
- Automatic fallback from browser scraping to fetch-based scraping
- Retry logic with configurable attempts
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

Create a `.env` file with the following variables:

```
PORT=3001
NODE_ENV=production
PUPPETEER_HEADLESS=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
USE_BROWSER_SCRAPING=true
```

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
  "useBrowser": true,  // Optional, defaults to true
  "retries": 2         // Optional, defaults to 2
}
```

Response:
```json
{
  "success": true,
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

## Deployment

This service can be deployed to Railway, Heroku, or any Node.js hosting platform. Make sure to:

1. Install Chrome/Chromium in the deployment environment
2. Set `PUPPETEER_EXECUTABLE_PATH` to the Chrome executable path
3. Set `PUPPETEER_HEADLESS=true` for production
4. Configure the main application to call this service via the service URL

