import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { scrapeFromUrl } from "./scrapers/alibaba-scraper.js";
import { scrapeFromUrlWithBrowser } from "./scrapers/browser-scraper.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "amazon-scraper-service" });
});

// Scrape product endpoint
app.post("/scrape", async (req, res) => {
  try {
    const { url, useBrowser = true, retries = 2 } = req.body;

    // Validate URL
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Validate that it's an Alibaba URL
    if (!url.includes("alibaba.com")) {
      return res.status(400).json({
        error: "Only Alibaba URLs are currently supported",
      });
    }

    console.log(
      `🔍 Scraping product with ${useBrowser ? "browser" : "fetch"} method`
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

    // Return the scraped product data
    return res.json({
      success: true,
      product,
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
app.listen(PORT, () => {
  console.log(`🚀 Scraper service running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Scrape endpoint: http://localhost:${PORT}/scrape`);
});

