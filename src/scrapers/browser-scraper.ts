import { AlibabaScraper, AlibabaProduct } from "./alibaba-scraper.js";
import type { HTTPRequest, ConsoleMessage } from "puppeteer";
import { createCaptchaSolver } from "../services/captcha-solver.js";
import { getBrowserManager } from "../services/browser-manager.js";

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
        loadTimes: function() {},
        csi: function() {},
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
    `Failed to scrape product after ${retries} attempts. Last error: ${
      lastError?.message || "Unknown error"
    }`
  );
}

