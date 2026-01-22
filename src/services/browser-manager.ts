import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "puppeteer";

// Use stealth plugin to avoid detection with enhanced configuration
// @ts-ignore - puppeteer-extra types don't properly expose the use method
puppeteer.use(
  StealthPlugin({
    // Enable all stealth features
    enabledEvasions: new Set([
      "chrome.app",
      "chrome.csi",
      "chrome.loadTimes",
      "chrome.runtime",
      "iframe.contentWindow",
      "media.codecs",
      "navigator.hardwareConcurrency",
      "navigator.languages",
      "navigator.permissions",
      "navigator.plugins",
      "navigator.vendor",
      "navigator.webdriver",
      "user-agent-override",
      "webgl.vendor",
      "window.outerdimensions",
    ]),
  })
);

/**
 * Browser Manager - Maintains a persistent browser instance
 * Reusing the same browser helps avoid captchas by maintaining session/cookies
 */
class BrowserManager {
  private browser: Browser | null = null;
  private isLaunching = false;
  private launchPromise: Promise<Browser> | null = null;
  private headless: boolean | "new";

  constructor() {
    // Determine headless mode - default to visible in development
    this.headless =
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_HEADLESS !== "false"
        : process.env.PUPPETEER_HEADLESS === "true";

    // Ensure PUPPETEER_EXECUTABLE_PATH is not set (we use bundled Chromium)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      console.warn(
        `⚠️  PUPPETEER_EXECUTABLE_PATH is set but will be ignored. Using bundled Chromium.`
      );
    }
  }

  /**
   * Get or create the browser instance
   * @param headlessOverride - Optional override for headless mode
   */
  async getBrowser(headlessOverride?: boolean | "new"): Promise<Browser> {
    // If headless override is provided, check if we need to restart browser
    if (headlessOverride !== undefined) {
      // Normalize both values for comparison (treat "new" and true as equivalent for headless)
      const overrideIsHeadless = headlessOverride === "new" || headlessOverride === true;
      const currentIsHeadless = this.headless === "new" || this.headless === true;
      
      // If browser exists but headless mode doesn't match, restart it
      if (this.browser && this.browser.isConnected() && overrideIsHeadless !== currentIsHeadless) {
        console.log(`🔄 Restarting browser to change headless mode (${currentIsHeadless ? "headless" : "visible"} -> ${overrideIsHeadless ? "headless" : "visible"})`);
        await this.closeBrowser();
        this.headless = headlessOverride;
      } else if (!this.browser) {
        // Browser doesn't exist yet, use the override
        this.headless = headlessOverride;
      }
    }
    
    // If browser exists and is connected, return it
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    // If browser is launching, wait for it
    if (this.isLaunching && this.launchPromise) {
      return this.launchPromise;
    }

    // Launch new browser
    this.isLaunching = true;
    this.launchPromise = this.launchBrowser();

    try {
      this.browser = await this.launchPromise;
      return this.browser;
    } finally {
      this.isLaunching = false;
      this.launchPromise = null;
    }
  }

  /**
   * Launch a new browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    console.log("🚀 Launching persistent browser instance...");
    const headlessMode = this.headless === "new" ? "new headless" : this.headless ? "headless" : "visible";
    if (!this.headless) {
      console.log(`👁️  Browser mode: ${headlessMode} (you can see it!)`);
    } else {
      console.log(`👁️  Browser mode: ${headlessMode}`);
    }

    console.log(`📍 Using Puppeteer's bundled Chromium (recommended for Railway)`);

    // Launch browser with Railway-optimized configuration
    // DO NOT set executablePath - let Puppeteer use its bundled Chromium
    // Railway will have the bundled Chromium available after npm install
    let browser: Browser;
    
    // Ensure PUPPETEER_EXECUTABLE_PATH is not set (Railway might set it incorrectly)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      console.warn(
        `⚠️  PUPPETEER_EXECUTABLE_PATH is set to ${process.env.PUPPETEER_EXECUTABLE_PATH}, but we'll use bundled Chromium instead`
      );
      delete process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    try {
      // Use Railway-optimized launch config (from guide)
      // This ensures Puppeteer uses its bundled Chromium, not system Chrome
      const launchOptions: any = {
        headless: this.headless ? "new" : false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
          "--single-process",
        ],
      };
      
      // @ts-ignore - puppeteer-extra extends puppeteer but types aren't perfect
      browser = await puppeteer.launch(launchOptions);
    } catch (launchError: any) {
      // If launch fails, provide helpful error message
      if (
        launchError?.message?.includes("executablePath") ||
        launchError?.message?.includes("Browser was not found") ||
        launchError?.message?.includes("Tried to find the browser") ||
        launchError?.message?.includes("/usr/bin/google-chrome")
      ) {
        console.error(
          `❌ Browser launch failed: ${launchError.message}`
        );
        console.error(
          `💡 Make sure PUPPETEER_EXECUTABLE_PATH is NOT set in Railway environment variables`
        );
        console.error(
          `💡 Puppeteer will use its bundled Chromium automatically`
        );
        throw new Error(
          `Browser executable not found. Please remove PUPPETEER_EXECUTABLE_PATH from Railway environment variables to use bundled Chromium. Original error: ${launchError.message}`
        );
      } else {
        throw launchError;
      }
    }

    // Handle browser disconnection (crash, etc.)
    browser.on("disconnected", () => {
      console.warn("⚠️  Browser disconnected, will recreate on next request");
      this.browser = null;
    });

    console.log("✅ Browser instance created and ready");
    return browser;
  }

  /**
   * Close the browser instance
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log("🔒 Browser closed");
      } catch (error) {
        console.error("Error closing browser:", error);
      } finally {
        this.browser = null;
      }
    }
  }

  /**
   * Restart the browser (useful if it becomes unusable)
   */
  async restartBrowser(): Promise<Browser> {
    console.log("🔄 Restarting browser...");
    await this.closeBrowser();
    return this.getBrowser();
  }

  /**
   * Check if browser is available
   */
  isBrowserAvailable(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }
}

// Singleton instance
let browserManagerInstance: BrowserManager | null = null;

/**
 * Get the singleton browser manager instance
 */
export function getBrowserManager(): BrowserManager {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager();
  }
  return browserManagerInstance;
}

/**
 * Cleanup browser on process exit
 */
export async function cleanupBrowser(): Promise<void> {
  if (browserManagerInstance) {
    await browserManagerInstance.closeBrowser();
  }
}

// Register cleanup handlers
process.on("SIGTERM", async () => {
  await cleanupBrowser();
});

process.on("SIGINT", async () => {
  await cleanupBrowser();
});
