import { AlibabaScraper, AlibabaProduct } from "./alibaba-scraper.js";
import { CheckoutScraper, AlibabaCheckout } from "./checkout-scraper.js";
import type { HTTPRequest, ConsoleMessage, Browser } from "puppeteer";
import { createCaptchaSolver } from "../services/captcha-solver.js";
import { getBrowserManager } from "../services/browser-manager.js";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

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
  // Default to non-headless in development, headless in production
  headless: process.env.NODE_ENV === "production"
    ? process.env.PUPPETEER_HEADLESS !== "false"
    : process.env.PUPPETEER_HEADLESS === "true",
  timeout: 45000, // 45 seconds
  waitForSelector: "h1",
  viewport: {
    width: 1920,
    height: 1080,
  },
};

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

/**
 * Scrape Alibaba product using Puppeteer (real browser)
 * This bypasses most anti-bot protection
 */
export async function scrapeWithBrowser(
  url: string,
  config: BrowserConfig = {}
): Promise<AlibabaProduct> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  // Normalize URL (add protocol if missing)
  url = normalizeUrl(url);

  console.log(`🌐 Scraping: ${url}`);
  console.log(`♻️  Using persistent browser instance (reused across requests)`);

  // Get the persistent browser instance (reused across requests)
  // Pass headless config to ensure browser is created with correct visibility
  const browserManager = getBrowserManager();
  const headlessMode = finalConfig.headless ? "new" : false;
  let browser;
  try {
    browser = await browserManager.getBrowser(headlessMode);
  } catch (error) {
    console.error("❌ Failed to get browser instance:", error);
    throw error;
  }

  let page;

  try {
    page = await browser.newPage();

    // Set proxy authentication if configured
    const proxyConfig = browserManager.getProxyConfig();
    if (proxyConfig && proxyConfig.username && proxyConfig.password) {
      await page.authenticate({
        username: proxyConfig.username,
        password: proxyConfig.password,
      });
      console.log("🔐 Proxy authentication set for this page");
    }

    // Set realistic viewport
    await page.setViewport(finalConfig.viewport!);

    // Set realistic user agent (updated to match current Chrome version)
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Enhanced fingerprinting overrides
    await page.evaluateOnNewDocument(() => {
      // Override webdriver property
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });

      // Override plugins to look more realistic
      Object.defineProperty(navigator, "plugins", {
        get: () => {
          return [
            {
              0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
              description: "Portable Document Format",
              filename: "internal-pdf-viewer",
              length: 1,
              name: "Chrome PDF Plugin"
            },
            {
              0: { type: "application/pdf", suffixes: "pdf", description: "" },
              description: "",
              filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
              length: 1,
              name: "Chrome PDF Viewer"
            },
            {
              0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable" },
              1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable" },
              description: "",
              filename: "internal-nacl-plugin",
              length: 2,
              name: "Native Client"
            }
          ];
        },
      });

      // Override languages
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === "notifications" ?
          Promise.resolve({ state: Notification.permission } as PermissionStatus) :
          originalQuery(parameters)
      );

      // Override chrome object
      (window as any).chrome = {
        runtime: {},
        loadTimes: function () { },
        csi: function () { },
        app: {}
      };
    });

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
    // We block images, fonts, and media but allow CSS (needed for page stability)
    // The scraper reads image URLs from src, data-src, data-lazy, and style attributes
    await page.setRequestInterception(true);
    page.on("request", (request: HTTPRequest) => {
      const resourceType = request.resourceType();
      const url = request.url();

      // Always allow: document (HTML), script (JS), xhr (API calls), fetch (API calls), stylesheet (CSS)
      // Block: images, fonts, media (we extract image URLs from HTML instead)
      // Note: We allow CSS to prevent page crashes from missing styles
      if (["image", "font", "media"].includes(resourceType)) {
        request.abort();
      } else {
        // Allow HTML, JavaScript, CSS, API calls, and other essential resources
        request.continue();
      }
    });

    console.log("⚡ Resource blocking enabled: Images, fonts, and media blocked (URLs extracted from HTML, CSS allowed for stability)");

    console.log("📄 Navigating to Alibaba product page...");

    // Add a small delay to simulate human behavior
    await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Listen to console messages and network errors (filter out common non-critical errors)
    page.on("console", (msg: ConsoleMessage) => {
      const type = msg.type();
      const text = msg.text();

      // Filter out common Alibaba tracking/analytics errors that don't affect content
      const ignorePatterns = [
        "__name is not defined",
        "MIME type",
        "indexedDB",
        "FedCM",
        "identity provider",
        "fourier.taobao.com",
        "px.effirst.com",
        "report?x5secdata",
        "CORS policy", // Filter CORS errors (common with proxies)
        "Access-Control-Allow-Origin", // CORS header errors
        "preflight request", // CORS preflight errors
        "g.alicdn.com", // Alibaba CDN resources (often fail through proxies)
        "Failed to load resource", // Generic resource load failures (common with proxies)
        "Residential Failed", // Proxy errors (402 status)
        "bad_endpoint", // Proxy endpoint errors
        "402", // Proxy payment/endpoint errors
        "JSHandle@error", // Generic JS errors
        "获取物流信息失败", // Chinese error messages
        "login.alibaba.com", // Login service failures
        "insights.alibaba.com", // Analytics failures
        "video.alibaba.com", // Video service failures
      ];

      const shouldIgnore = ignorePatterns.some(pattern => text.includes(pattern));

      if (!shouldIgnore) {
        if (type === "error") {
          console.error(`🌐 Browser console error: ${text}`);
        } else if (type === "warn") {
          console.warn(`🌐 Browser console warning: ${text}`);
        }
      }
    });

    page.on("pageerror", (error: unknown) => {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Filter out common non-critical errors
      if (!errorMsg.includes("__name is not defined") &&
        !errorMsg.includes("MIME type") &&
        !errorMsg.includes("indexedDB")) {
        console.error(`🌐 Page error: ${errorMsg}`);
      }
    });

    page.on("requestfailed", (request: HTTPRequest) => {
      const url = request.url();
      // Only log important failures, ignore tracking/analytics failures
      const ignorePatterns = [
        "fourier.taobao.com",
        "px.effirst.com",
        "report?x5secdata",
        ".png",
        ".jpg",
        ".gif",
        ".css",
        ".woff",
        ".woff2",
        "g.alicdn.com", // Alibaba CDN resources (often fail through proxies)
        "alicdn.com", // Alibaba CDN
        "login.alibaba.com", // Login service (not needed for scraping)
        "insights.alibaba.com", // Analytics (not needed)
        "video.alibaba.com", // Video service (not needed)
        "getEnvironment.do", // Environment checks (not needed)
        "gatewayService", // Gateway services (not needed)
      ];

      const shouldIgnore = ignorePatterns.some(pattern => url.includes(pattern));

      if (!shouldIgnore) {
        console.error(`🌐 Request failed: ${url} - ${request.failure()?.errorText}`);
      }
    });

    // Navigate to the page
    // Use "domcontentloaded" instead of "networkidle2" since many resources fail through proxy
    // This ensures we get the page content even if some resources fail to load
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded", // Wait for DOM to be ready (faster, works even if resources fail)
        timeout: finalConfig.timeout,
      });

      console.log(`✅ Navigation response status: ${response?.status()}`);
      console.log(`📍 Current URL: ${page.url()}`);
      const initialTitle = await page.title();
      console.log(`📄 Page title: ${initialTitle}`);

      if (!response || !response.ok()) {
        console.warn(`⚠️  Response not OK: ${response?.status()} ${response?.statusText()}`);
      }

      // Wait for JavaScript to execute and render content
      // Since we're using domcontentloaded (faster), we need to wait a bit for JS to run
      console.log("⏳ Waiting for JavaScript to render content...");
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3 seconds for JS execution

      // Wait for page to start loading content before checking for captcha
      // Don't check immediately - page might be empty while JavaScript loads
      console.log("⏳ Waiting for page content to load...");

      // Try to wait for any content to appear (with longer timeout for Alibaba's heavy JS)
      try {
        await page.waitForFunction(
          () => {
            const body = document.body;
            if (!body) return false;
            const text = body.innerText || "";
            // Wait for meaningful content (not just whitespace)
            return text.trim().length > 50;
          },
          { timeout: 15000 } // Increased timeout for Alibaba's heavy pages
        );
        console.log("✅ Page content started loading");
      } catch (error) {
        console.warn("⚠️  Timeout waiting for page content, continuing anyway...");
      }

      // Additional wait for JavaScript to execute and render
      console.log("⏳ Waiting for JavaScript to render content...");
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Increased wait time
    } catch (error) {
      console.error(`❌ Navigation error:`, error);
      throw error;
    }

    // Check if page actually loaded content
    const bodyText = await page.evaluate(() => document.body?.innerText || "");
    console.log(`📝 Page body text length: ${bodyText.length} characters`);

    // Check for captcha now that we've waited for content
    // Verify page is still connected
    if (page.isClosed() || !browser.isConnected()) {
      throw new Error("Page or browser disconnected before captcha check");
    }

    let captchaCheck: any;
    try {
      captchaCheck = await page.evaluate(() => {
        const bodyText = document.body?.innerText?.toLowerCase() || "";
        const html = document.documentElement.innerHTML.toLowerCase();
        return {
          hasCaptchaText: bodyText.includes("captcha") || html.includes("captcha") ||
            bodyText.includes("verify you are human") || html.includes("verify you are human") ||
            bodyText.includes("security check") || html.includes("security check") ||
            bodyText.includes("unusual traffic") || html.includes("unusual traffic"),
          hasRecaptcha: document.querySelector("iframe[src*='recaptcha']") !== null ||
            document.querySelector(".g-recaptcha") !== null ||
            document.querySelector("[id*='captcha']") !== null,
          bodyLength: bodyText.length,
        };
      });
    } catch (error: any) {
      if (error.message?.includes("detached") || error.message?.includes("closed")) {
        throw new Error("Page was closed or detached during captcha check");
      }
      throw error;
    }

    if (captchaCheck.hasCaptchaText || captchaCheck.hasRecaptcha) {
      console.error("🚫 CAPTCHA DETECTED!");
      console.error(`   Body text length: ${captchaCheck.bodyLength}`);
      console.error(`   Has captcha text: ${captchaCheck.hasCaptchaText}`);
      console.error(`   Has recaptcha element: ${captchaCheck.hasRecaptcha}`);

      // Try automatic captcha solving first (if configured)
      const captchaSolver = createCaptchaSolver();
      if (captchaSolver) {
        console.log("🤖 Attempting automatic captcha solving...");
        try {
          // Alibaba uses a custom slider captcha - try to solve it
          // Note: Standard services may not support Alibaba's custom captcha
          // You may need a specialized service or manual solving
          const solveResult = await captchaSolver.solveSliderCaptcha(url);

          if (solveResult.success && solveResult.token) {
            console.log("✅ Captcha solved automatically! Injecting token...");
            // Inject the token into the page
            await page.evaluate((token: string) => {
              // Try to find and fill captcha token field
              const tokenInput = document.querySelector('input[name="captcha-token"]') as HTMLInputElement;
              if (tokenInput) {
                tokenInput.value = token;
              }
              // Trigger any submit events
              const event = new Event('input', { bubbles: true });
              if (tokenInput) {
                tokenInput.dispatchEvent(event);
              }
            }, solveResult.token);

            // Wait for page to process
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Re-check if captcha is gone
            const recheck = await page.evaluate(() => {
              const bodyText = document.body?.innerText?.toLowerCase() || "";
              return !bodyText.includes("unusual traffic") && !bodyText.includes("verify");
            });

            if (recheck) {
              console.log("✅ Captcha solved successfully! Continuing...");
              // Continue with scraping
            } else {
              console.warn("⚠️  Captcha token injected but page still shows captcha");
              throw new Error("Automatic captcha solving did not work - page still shows captcha");
            }
          } else {
            console.warn(`⚠️  Automatic captcha solving failed: ${solveResult.error}`);
            throw new Error(`Captcha solving failed: ${solveResult.error}`);
          }
        } catch (error) {
          console.error("❌ Automatic captcha solving error:", error);
          // Fall through to manual solving or error
        }
      }

      // If automatic solving didn't work or isn't configured, try manual solving
      // If in development mode and browser is visible, wait for manual captcha solving
      if (!finalConfig.headless && process.env.NODE_ENV === "development") {
        console.log("⏸️  MANUAL CAPTCHA MODE: Browser is visible - please solve the captcha manually");
        console.log("⏸️  Waiting up to 120 seconds for you to solve the captcha...");
        console.log("⏸️  The scraper will continue automatically once the captcha is solved and page loads");

        // Wait for captcha to be solved (check if page content changes)
        const maxWaitTime = 120000; // 2 minutes
        const checkInterval = 2000; // Check every 2 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));

          // Check if captcha is gone and content has loaded
          const currentCheck = await page.evaluate(() => {
            const bodyText = document.body?.innerText?.toLowerCase() || "";
            const html = document.documentElement.innerHTML.toLowerCase();
            return {
              stillHasCaptcha: bodyText.includes("unusual traffic") ||
                bodyText.includes("verify") ||
                html.includes("unusual traffic"),
              hasContent: bodyText.length > 200, // Meaningful content loaded
            };
          });

          if (!currentCheck.stillHasCaptcha && currentCheck.hasContent) {
            console.log("✅ Captcha appears to be solved! Continuing...");
            // Wait a bit more for page to fully load
            await new Promise((resolve) => setTimeout(resolve, 3000));
            break;
          }
        }

        // Final check
        const finalCheck = await page.evaluate(() => {
          const bodyText = document.body?.innerText?.toLowerCase() || "";
          return {
            stillHasCaptcha: bodyText.includes("unusual traffic") || bodyText.includes("verify"),
            bodyLength: bodyText.length,
          };
        });

        if (finalCheck.stillHasCaptcha) {
          throw new Error(
            "Captcha was not solved within the timeout period. Please try again."
          );
        }

        console.log("✅ Continuing after captcha was solved");
      } else {
        throw new Error(
          "Page is protected by captcha or access control. Alibaba is blocking automated access. " +
          "Set NODE_ENV=development and headless=false to enable manual captcha solving."
        );
      }
    }

    if (bodyText.length < 100) {
      console.warn("⚠️  Page seems to have very little content, might be blocked or still loading");
      // Wait a bit more for dynamic content
      console.log("⏳ Waiting additional time for dynamic content...");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Re-check body length
      const newBodyText = await page.evaluate(() => document.body?.innerText || "");
      console.log(`📝 Page body text length after wait: ${newBodyText.length} characters`);

      if (newBodyText.length < 100) {
        console.warn("⚠️  Page still has very little content after waiting");
      }
    }

    // Simulate human-like behavior
    console.log("🖱️  Simulating human behavior...");
    await page.mouse.move(Math.random() * 500 + 100, Math.random() * 500 + 100);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Scroll down slowly like a human
    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await page.evaluate(() => {
      window.scrollBy(0, 300);
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("⏳ Waiting for content to load...");

    // Wait for the main content to load - try multiple selectors
    const selectors = [
      "h1",
      "[data-product-title]",
      ".product-title",
      ".product-name",
      "title",
    ];

    let foundSelector = false;
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, {
          timeout: 5000,
        });
        foundSelector = true;
        console.log(`✅ Found selector: ${selector}`);
        break;
      } catch {
        // Continue to next selector
      }
    }

    if (!foundSelector) {
      console.warn("⚠️  Could not find any expected selectors, checking page content...");
    }

    // Additional wait to ensure dynamic content loads
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Log final page state for debugging
    const finalUrl = page.url();
    const finalTitle = await page.title();
    console.log(`🔍 Final page state:`);
    console.log(`   URL: ${finalUrl}`);
    console.log(`   Title: ${finalTitle}`);

    // Final check if we hit a captcha or access denied page (more accurate detection)
    const pageContent = (await page.content()).toLowerCase();
    const pageTitle = finalTitle.toLowerCase();
    const pageUrl = finalUrl.toLowerCase();

    // Check for actual captcha indicators (case-insensitive)
    const captchaIndicators = [
      "captcha",
      "verify you are human",
      "verify that you are not a robot",
      "access denied",
      "blocked",
      "security check",
      "unusual traffic",
      "please complete the security check",
      "challenge",
    ];

    const hasCaptcha = captchaIndicators.some(
      (indicator) =>
        pageContent.includes(indicator) ||
        pageTitle.includes(indicator) ||
        pageUrl.includes(indicator)
    );

    // Also check for common captcha elements
    const captchaElements = await page.evaluate(() => {
      return (
        document.querySelector("iframe[src*='recaptcha']") !== null ||
        document.querySelector(".g-recaptcha") !== null ||
        document.querySelector("[id*='captcha']") !== null ||
        document.querySelector("[class*='captcha']") !== null ||
        document.querySelector("[id*='challenge']") !== null ||
        document.querySelector("[class*='challenge']") !== null ||
        document.querySelector("iframe[src*='challenge']") !== null
      );
    });

    if (hasCaptcha || captchaElements) {
      console.error("🚫 CAPTCHA DETECTED on final check!");
      console.error(`   Page URL: ${finalUrl}`);
      console.error(`   Page Title: ${finalTitle}`);
      console.error(`   Body text length: ${bodyText.length}`);
      console.error(`   Has captcha text: ${hasCaptcha}`);
      console.error(`   Has captcha elements: ${captchaElements}`);

      // If in development mode and browser is visible, wait for manual captcha solving
      if (!finalConfig.headless && process.env.NODE_ENV === "development") {
        console.log("⏸️  MANUAL CAPTCHA MODE: Browser is visible - please solve the captcha manually");
        console.log("⏸️  Waiting up to 120 seconds for you to solve the captcha...");

        const maxWaitTime = 120000; // 2 minutes
        const checkInterval = 2000; // Check every 2 seconds
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitTime) {
          await new Promise((resolve) => setTimeout(resolve, checkInterval));

          const currentCheck = await page.evaluate(() => {
            const bodyText = document.body?.innerText?.toLowerCase() || "";
            const html = document.documentElement.innerHTML.toLowerCase();
            return {
              stillHasCaptcha: bodyText.includes("unusual traffic") ||
                bodyText.includes("verify") ||
                html.includes("unusual traffic"),
              hasContent: bodyText.length > 200,
            };
          });

          if (!currentCheck.stillHasCaptcha && currentCheck.hasContent) {
            console.log("✅ Captcha appears to be solved! Continuing...");
            await new Promise((resolve) => setTimeout(resolve, 3000));
            break;
          }
        }

        const finalCheck = await page.evaluate(() => {
          const bodyText = document.body?.innerText?.toLowerCase() || "";
          return {
            stillHasCaptcha: bodyText.includes("unusual traffic") || bodyText.includes("verify"),
            bodyLength: bodyText.length,
          };
        });

        if (finalCheck.stillHasCaptcha) {
          throw new Error(
            "Captcha was not solved within the timeout period. Please try again."
          );
        }

        console.log("✅ Continuing after captcha was solved");
      } else {
        throw new Error(
          "Page is protected by captcha or access control. Alibaba is blocking automated access. " +
          "Set NODE_ENV=development and headless=false to enable manual captcha solving."
        );
      }
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
    // Close the page, but keep the browser instance alive for reuse
    if (page) {
      try {
        await page.close();
        console.log("📄 Page closed (browser instance kept alive for reuse)");
      } catch (error) {
        console.warn("⚠️  Error closing page:", error);
      }
    }
  }
}

/**
 * Scrape checkout page from URL with retry logic
 */
export async function scrapeCheckoutFromUrlWithBrowser(
  url: string,
  retries: number = 2
): Promise<AlibabaCheckout> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Checkout scraping attempt ${attempt} of ${retries}`);

      // Add delay between retries
      if (attempt > 1) {
        const delay = 3000 * attempt;
        console.log(`⏳ Waiting ${delay / 1000}s before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const checkout = await scrapeCheckoutWithBrowser(url);
      return checkout;
    } catch (error) {
      lastError = error as Error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `❌ Checkout scraping attempt ${attempt} failed:`,
        errorMessage
      );

      if (attempt === retries) {
        break;
      }
    }
  }

  throw new Error(
    `Failed to scrape checkout after ${retries} attempts. Last error: ${lastError?.message || "Unknown error"
    }`
  );
}

/**
 * Scrape checkout page using Puppeteer (real browser)
 * Creates a direct connection without proxy for checkout pages
 */
async function scrapeCheckoutWithBrowser(
  url: string
): Promise<AlibabaCheckout> {
  // Normalize URL (add protocol if missing)
  url = normalizeUrl(url);

  console.log(`🌐 Scraping checkout: ${url}`);
  console.log(`🌐 Loading directly without proxy (checkout pages)`);

  // Create a browser instance without proxy for checkout pages
  // Show browser only in development, hide in production
  const headlessMode = process.env.NODE_ENV === "production"
    ? process.env.PUPPETEER_HEADLESS !== "false"
    : process.env.PUPPETEER_HEADLESS === "true";

  // Create a fresh puppeteer instance with stealth plugin but without proxy
  // @ts-ignore - puppeteer-extra types don't properly expose the use method
  const checkoutPuppeteer = puppeteerExtra.use(StealthPlugin());

  let browser: Browser;
  try {
    // Launch browser without proxy configuration (direct connection)
    const args = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ];

    const headlessStatus = headlessMode ? "headless" : "visible";
    console.log(`🚀 Launching browser for checkout (no proxy, direct connection, ${headlessStatus} mode)`);
    if (!headlessMode) {
      console.log(`👁️  Browser will be visible so you can see the payment summary load`);
    }
    browser = await checkoutPuppeteer.launch({
      headless: headlessMode ? "new" : false,
      args,
    });
  } catch (error) {
    console.error("❌ Failed to launch browser instance:", error);
    throw error;
  }

  let page;

  try {
    page = await browser.newPage();

    // Don't use proxy for checkout pages - load directly
    console.log("🌐 Loading checkout page directly (no proxy)");

    // Set realistic viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Set realistic user agent
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );

    // Set extra headers - removed "Upgrade-Insecure-Requests" to avoid CORS preflight issues
    // This header causes CORS errors that block React and other critical scripts from loading
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      DNT: "1",
      Connection: "keep-alive",
      // Removed "Upgrade-Insecure-Requests" - it causes CORS preflight failures
    });

    // Allow all resources to load (images, CSS, fonts, media) for checkout pages
    // This ensures the page renders correctly and we can extract all information
    console.log("📦 Allowing all resources to load (images, CSS, fonts, media)");

    console.log("📄 Navigating to Alibaba checkout page...");

    // Navigate to the page - wait for network to be idle to ensure all resources load
    const response = await page.goto(url, {
      waitUntil: "networkidle2", // Wait for network to be idle (all resources loaded)
      timeout: 60000, // Increased timeout to allow all resources to load
    });

    console.log(`✅ Navigation response status: ${response?.status()}`);

    // Wait for JavaScript to execute and page to fully render
    console.log("⏳ Waiting for JavaScript to execute and render content...");

    // Wait for React to load (critical for the checkout page - React16 error suggests it's not loading)
    // console.log("⏳ Waiting for React to load (checking for React/ReactDOM)...");
    // try {
    //   await page.waitForFunction(
    //     () => {
    //       // Check if React is loaded (React16, React, or window.React)
    //       return typeof (window as any).React !== 'undefined' ||
    //         typeof (window as any).React16 !== 'undefined' ||
    //         typeof (window as any).ReactDOM !== 'undefined' ||
    //         // Fallback: check if app has meaningful content
    //         (document.querySelector('#app')?.innerHTML.length || 0) > 1000;
    //     },
    //     { timeout: 20000 }
    //   );
    //   console.log("✅ React/ReactDOM detected");
    // } catch (error) {
    //   console.warn("⚠️  React load check timeout, but continuing (may still work)...");
    // }

    // Additional wait for React app to mount and render components
    // console.log("⏳ Waiting for React app to mount and render components...");
    // await new Promise((resolve) => setTimeout(resolve, 5000));

    // Wait for payment summary section to load (this is critical - fees are added here via JavaScript)
    console.log("⏳ Waiting for payment summary section to load...");
    try {
      // Wait for the payment summary container to appear
      // Also wait for React to have rendered the component
      console.log("⏳ Waiting for React to render payment summary...");
      await page.waitForSelector('.checkoutV4-summary-ui-wrapper-container, [class*="payment-summary"], .payment-summary-wrapper', {
        timeout: 30000,
      });
      console.log("✅ Payment summary container found");

      // Wait for the container to have actual rendered content (not just empty React component)
      await page.waitForFunction(
        () => {
          const container = document.querySelector('.checkoutV4-summary-ui-wrapper-container, .payment-summary-wrapper');
          if (!container) return false;
          // Check if it has meaningful content (more than just empty divs)
          const text = container.textContent || '';
          return text.length > 100 && (text.includes('Order') || text.includes('Subtotal') || text.includes('Payment'));
        },
        { timeout: 15000 }
      );
      console.log("✅ Payment summary has rendered content");

      // Wait for JavaScript to update the payment summary with fees
      // We need to wait for the DOM to be updated by JavaScript, not just for elements to exist
      console.log("⏳ Waiting for JavaScript to calculate and update payment processing fees...");

      // Wait for the payment summary to be populated with actual content (not just empty)
      await page.waitForFunction(
        () => {
          const summaryContainer = document.querySelector('.checkoutV4-summary-ui-wrapper-container, .payment-summary-wrapper');
          if (!summaryContainer) return false;

          // Check if there's actual content (not just empty divs)
          const hasContent = summaryContainer.textContent && summaryContainer.textContent.trim().length > 50;
          if (!hasContent) return false;

          return true;
        },
        { timeout: 10000 }
      );
      console.log("✅ Payment summary has content");

      // Wait for the "Pay now" button to be visible (indicates page is interactive)
      console.log("⏳ Waiting for 'Pay now' button to appear...");
      await page.waitForSelector('.pay-button-ui, .checkout-v4-btn-primary, button[class*="pay"]', {
        timeout: 30000,
        visible: true,
      });
      console.log("✅ Pay now button found");

      // Now wait for the fees to actually be calculated and displayed
      // This is the critical part - we need to wait for JS to update the prices
      // The page uses React/JavaScript to dynamically calculate and display fees
      console.log("⏳ Waiting for payment processing fees to be calculated and displayed...");

      // First, get the initial subtotal (before fees)
      const initialSubtotal = await page.evaluate(() => {
        const container = document.querySelector('.checkoutV4-summary-ui-wrapper-container, .payment-summary-wrapper');
        if (!container) return null;
        const subtotalEl = container.querySelector('.summary-detail:not(.primary) .value, [data-i18n-key*="subTotal"] + .value');
        if (!subtotalEl) return null;
        const text = subtotalEl.textContent || '';
        const match = text.match(/(\d+\.?\d*)/);
        return match ? parseFloat(match[1].replace(/,/g, '')) : null;
      });

      if (initialSubtotal) {
        console.log(`📊 Initial subtotal detected: ${initialSubtotal}`);
      }

      // Wait for the final total to be different from subtotal (fees added)
      await page.waitForFunction(
        (expectedSubtotal) => {
          const summaryContainer = document.querySelector('.checkoutV4-summary-ui-wrapper-container, .payment-summary-wrapper');
          if (!summaryContainer) return false;

          const containerText = summaryContainer.textContent || '';

          // Check if "Payment processing fee" text exists (indicates fees section loaded)
          const hasProcessingFeeText = containerText.includes('Payment processing fee') ||
            containerText.includes('processing fee') ||
            containerText.includes('Transaction fee');

          if (!hasProcessingFeeText) return false;

          // Check if fee-loaded class exists (indicates fees calculated)
          const feeLoaded = summaryContainer.querySelector('.fee-loaded');

          // Check if the final total amount is visible (the one with processing fee)
          const totalElement = summaryContainer.querySelector('.summary-detail.primary .value, .summary-detail.overlap.primary .value, [id="cashier-currency-parent"] .value');

          if (!totalElement) return false;

          const totalText = totalElement.textContent || '';
          // Check if it contains a currency and amount
          const hasCurrencyAndAmount = /USD|EUR|GBP|CNY|NGN|GHS/.test(totalText) && /\d+/.test(totalText);

          if (!hasCurrencyAndAmount) return false;

          // Extract final total amount
          const totalMatch = totalText.match(/(\d+\.?\d*)/);
          if (!totalMatch) return false;

          const finalAmount = parseFloat(totalMatch[1].replace(/,/g, ''));

          // If we have expected subtotal, verify final is higher (fees added)
          if (expectedSubtotal && finalAmount <= expectedSubtotal) {
            return false; // Fees haven't been added yet
          }

          // Also check if there's a processing fee amount visible
          const feeElements = summaryContainer.querySelectorAll('.summary-detail .value');
          let hasFeeAmount = false;
          feeElements.forEach((el) => {
            const text = el.textContent || '';
            // Look for amounts with decimals (processing fees)
            if (text.match(/\d+\.\d{2}/)) {
              hasFeeAmount = true;
            }
          });

          // Return true if we have the total, processing fee text, and final is higher than subtotal
          return hasProcessingFeeText && (feeLoaded !== null || hasFeeAmount) && finalAmount > 0;
        },
        { timeout: 30000 },
        initialSubtotal
      );
      console.log("✅ Payment processing fees calculated and displayed");

      // Wait for network to be completely idle (no more API calls updating prices)
      console.log("⏳ Waiting for network to be idle (no more price updates)...");
      // Wait additional time to ensure all API calls for fees are complete
      // JavaScript may make async calls to calculate fees, so we wait for those to complete
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.log("✅ Network should be idle");

      // Additional wait to ensure all JavaScript calculations are complete
      console.log("⏳ Waiting 3 seconds for all JavaScript calculations to finalize...");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Verify the Pay now button is actually enabled (not disabled)
      const payButtonState = await page.evaluate(() => {
        const payButton = document.querySelector('.pay-button-ui, .checkout-v4-btn-primary, button[class*="pay"]') as HTMLButtonElement;
        if (!payButton) return { exists: false, enabled: false, visible: false };
        return {
          exists: true,
          enabled: !payButton.disabled,
          visible: payButton.offsetParent !== null,
          hasText: payButton.textContent && payButton.textContent.includes('Pay')
        };
      });

      if (payButtonState.exists && payButtonState.enabled) {
        console.log("✅ Pay now button is enabled and ready");
      } else {
        console.warn(`⚠️  Pay now button state:`, payButtonState);
      }

      // Final wait to let user see the page with all fees loaded
      console.log("⏳ Browser visible for 5 seconds for inspection (payment summary should be fully loaded)...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.warn("⚠️  Payment summary section wait timeout, continuing anyway...");
      console.warn("⚠️  Error:", error instanceof Error ? error.message : String(error));
      // Continue even if timeout - we'll try to extract what we can
      console.log("⏳ Waiting additional 5 seconds for JavaScript to finish...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Get the full HTML
    const html = await page.content();

    // Use checkout scraper to parse the HTML
    const checkoutScraper = new CheckoutScraper(html);
    const checkout = checkoutScraper.scrape();
    checkout.checkoutUrl = url;

    // Validate that we got basic checkout info
    if (!checkout.items || checkout.items.length === 0) {
      throw new Error(
        "Failed to extract checkout information. The page structure may have changed."
      );
    }

    console.log(`✅ Successfully scraped checkout: ${checkout.itemCount} items, ${checkout.currency} ${checkout.subtotal}`);

    return checkout;
  } catch (error) {
    console.error("❌ Browser checkout scraping error:", error);
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
        console.log("📄 Page closed");
      } catch (error) {
        console.warn("⚠️  Error closing page:", error);
      }
    }
    // Close the browser instance for checkout pages (we create a new one each time)
    if (browser) {
      try {
        await browser.close();
        console.log("🔒 Browser closed (checkout page browser)");
      } catch (error) {
        console.warn("⚠️  Error closing browser:", error);
      }
    }
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `❌ Attempt ${attempt} failed:`,
        errorMessage
      );

      // Don't retry on certain errors (like browser not found)
      if (
        errorMessage.includes("Browser was not found") ||
        errorMessage.includes("executablePath") ||
        errorMessage.includes("ENOENT")
      ) {
        // If it's a browser path issue, throw immediately with a helpful message
        throw new Error(
          `Browser executable not found. Please ensure Chrome/Chromium is installed or remove PUPPETEER_EXECUTABLE_PATH to use bundled Chromium. Original error: ${errorMessage}`
        );
      }

      if (attempt === retries) {
        break;
      }
    }
  }

  throw new Error(
    `Failed to scrape product after ${retries} attempts. Last error: ${lastError?.message || "Unknown error"
    }`
  );
}

