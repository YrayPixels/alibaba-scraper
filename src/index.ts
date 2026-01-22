import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { scrapeFromUrl } from "./scrapers/alibaba-scraper.js";
import { scrapeFromUrlWithBrowser } from "./scrapers/browser-scraper.js";
import {
  initializeCache,
  getCachedProduct,
  setCachedProduct,
  closeCache,
  isCacheAvailable,
} from "./cache.js";
import { cleanupBrowser } from "./services/browser-manager.js";

dotenv.config();

console.log("🔧 Starting application...");
console.log("🔧 NODE_ENV:", process.env.NODE_ENV || "not set");
console.log("🔧 PORT:", process.env.PORT || "not set (will use 3001)");

// Initialize Redis cache
initializeCache();

const app = express();
const PORT = process.env.PORT || 8000;

// Cache TTL in seconds (default 6 hours to prevent stale data, configurable via env)
// 6 hours balances freshness with performance - product prices/details can change
const CACHE_TTL = Number(process.env.CACHE_TTL_SECONDS) || 6 * 60 * 60;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "amazon-scraper-service",
    endpoints: {
      health: "/health",
      scrape: "/scrape (POST)",
    },
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  console.log("✅ Health check requested");
  res.status(200).json({
    status: "ok",
    service: "amazon-scraper-service",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Normalize URL by adding protocol if missing
 */
function normalizeUrl(url: string): string {
  if (!url) return url;
  
  // If URL already has protocol, return as-is
  if (url.match(/^https?:\/\//i)) {
    return url;
  }
  
  // If URL starts with //, add https:
  if (url.startsWith("//")) {
    return "https:" + url;
  }
  
  // Otherwise, add https://
  return "https://" + url;
}

// Scrape product endpoint
app.post("/scrape", async (req, res) => {
  try {
    let { url, useBrowser = true, retries = 2, forceRefresh = false } = req.body;

    // Validate URL
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Normalize URL (add protocol if missing)
    url = normalizeUrl(url);

    // Validate that it's an Alibaba URL
    if (!url.includes("alibaba.com")) {
      return res.status(400).json({
        error: "Only Alibaba URLs are currently supported",
      });
    }

    // Check cache first (unless forceRefresh is true)
    if (!forceRefresh && isCacheAvailable()) {
      const cachedProduct = await getCachedProduct(url);
      if (cachedProduct) {
        return res.json({
          success: true,
          product: cachedProduct,
          cached: true,
        });
      }
    }

    console.log(
      `🔍 Scraping product with ${useBrowser ? "browser" : "fetch"} method${forceRefresh ? " (force refresh)" : ""}`
    );

    // Scrape the product using browser (Puppeteer) or fetch
    let product;

    if (useBrowser) {
      try {
        product = await scrapeFromUrlWithBrowser(url, retries);
      } catch (browserError) {
        console.error(
          "Browser scraping failed, falling back to fetch:",
          browserError
        );
        // Fallback to regular fetch if browser fails
        product = await scrapeFromUrl(url);
      }
    } else {
      product = await scrapeFromUrl(url);
    }

    // Cache the scraped product
    if (isCacheAvailable()) {
      await setCachedProduct(url, product, CACHE_TTL);
    }

    // Return the scraped product data
    return res.json({
      success: true,
      product,
      cached: false,
    });
  } catch (error) {
    console.error("Scraping error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Provide more helpful error messages based on the error type
    let userMessage = "Failed to scrape product.";
    let suggestions: string[] = [];

    if (
      errorMessage.includes("Access denied") ||
      errorMessage.includes("blocked")
    ) {
      userMessage =
        "Unable to access Alibaba product page. Anti-bot protection detected.";
      suggestions = [
        "Try again in a few minutes",
        "Copy and paste product details manually",
        "Use a different product URL",
        "Contact support if this persists",
      ];
    } else if (
      errorMessage.includes("timeout") ||
      errorMessage.includes("network")
    ) {
      userMessage = "Network timeout. Please check your internet connection.";
      suggestions = ["Try again", "Check if the URL is accessible"];
    } else if (
      errorMessage.includes("extract") ||
      errorMessage.includes("structure")
    ) {
      userMessage = "Product page structure has changed or is not supported.";
      suggestions = [
        "Try a different product URL",
        "Enter product details manually",
      ];
    }

    return res.status(500).json({
      error: userMessage,
      details: errorMessage,
      suggestions,
      canRetry: !errorMessage.includes("structure"),
      manualEntry: true,
    });
  }
});

// Start server
const server = app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`🚀 Scraper service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Scrape endpoint: http://localhost:${PORT}/scrape`);
});

// Handle server errors
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error("❌ Server error:", error);
  }
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down gracefully...");
  await cleanupBrowser();
  await closeCache();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down gracefully...");
  await cleanupBrowser();
  await closeCache();
  process.exit(0);
});

