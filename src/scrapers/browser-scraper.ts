import puppeteer from "puppeteer-core";
import { AlibabaScraper, AlibabaProduct } from "./alibaba-scraper";

/**
 * Configuration for browser scraping
 */
interface BrowserConfig {
  headless?: boolean;
  timeout?: number;
  waitForSelector?: string;
  viewport?: {
    width: number;
    height: number;
  };
}

const DEFAULT_CONFIG: BrowserConfig = {
  headless: process.env.PUPPETEER_HEADLESS !== "false",
  timeout: 45000, // 45 seconds
  waitForSelector: "h1",
  viewport: {
    width: 1920,
    height: 1080,
  },
};

/**
 * Scrape Alibaba product using Puppeteer (real browser)
 * This bypasses most anti-bot protection
 */
export async function scrapeWithBrowser(
  url: string,
  config: BrowserConfig = {}
): Promise<AlibabaProduct> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  console.log(`🚀 Launching browser for: ${url}`);

  // Determine Chrome path for production
  const chromePath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    (process.env.NODE_ENV === "production"
      ? "/usr/bin/google-chrome-stable" // Railway/DigitalOcean
      : "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"); // Use bundled Chromium in development

  if (chromePath) {
    console.log(`📍 Using Chrome at: ${chromePath}`);
  }

  const browser = await puppeteer.launch({
    headless: finalConfig.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
    ],
    executablePath: chromePath,
  });

  let page;

  try {
    page = await browser.newPage();

    // Set realistic viewport
    await page.setViewport(finalConfig.viewport!);

    // Set realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    // Set extra headers
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      DNT: "1",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    });

    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const resourceType = request.resourceType();
      // Block images, fonts, and some other resources to speed up
      if (["image", "font", "media"].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    console.log("📄 Navigating to page...");

    // Navigate to the page
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: finalConfig.timeout,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await page.mouse.move(200, 200);
    await page.mouse.wheel({ deltaY: 600 });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log("⏳ Waiting for content to load...");

    // Wait for the main content to load
    try {
      await page.waitForSelector(finalConfig.waitForSelector!, {
        timeout: 10000,
      });
    } catch (error) {
      console.warn("Timeout waiting for selector, continuing anyway...");
    }

    // Additional wait to ensure dynamic content loads
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if we hit a captcha or access denied page
    const pageContent = await page.content();
    if (
      pageContent.includes("captcha") ||
      pageContent.includes("Access Denied") ||
      pageContent.includes("Blocked")
    ) {
      throw new Error(
        "Page is protected by captcha or access control. Please try again later."
      );
    }

    console.log("✅ Page loaded successfully");

    // Get the full HTML
    const html = await page.content();

    // Use our existing scraper to parse the HTML
    const scraper = new AlibabaScraper(html);
    const product = scraper.scrape();
    product.productUrl = url;

    // Validate that we got basic product info
    if (!product.title || product.title === "Unknown Product") {
      throw new Error(
        "Failed to extract product information. The page structure may have changed."
      );
    }

    console.log(`✅ Successfully scraped: ${product.title}`);

    return product;
  } catch (error) {
    console.error("❌ Browser scraping error:", error);

    // Take a screenshot for debugging (optional)
    if (page && process.env.NODE_ENV === "development") {
      try {
        await page.screenshot({
          path: `./debug-screenshot-${Date.now()}.png`,
          fullPage: true,
        });
        console.log("📸 Debug screenshot saved");
      } catch (screenshotError) {
        console.warn("Could not save screenshot:", screenshotError);
      }
    }

    throw error;
  } finally {
    await browser.close();
    console.log("🔒 Browser closed");
  }
}

/**
 * Scrape from URL with retry logic
 */
export async function scrapeFromUrlWithBrowser(
  url: string,
  retries: number = 2
): Promise<AlibabaProduct> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt} of ${retries}`);

      // Add delay between retries
      if (attempt > 1) {
        const delay = 3000 * attempt; // 3s, 6s, 9s, etc.
        console.log(`⏳ Waiting ${delay / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const product = await scrapeWithBrowser(url);
      return product;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `❌ Attempt ${attempt} failed:`,
        error instanceof Error ? error.message : error
      );

      if (attempt === retries) {
        break;
      }
    }
  }

  throw new Error(
    `Failed to scrape product after ${retries} attempts. Last error: ${
      lastError?.message || "Unknown error"
    }`
  );
}

