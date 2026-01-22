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
  private readonly executablePath: string | undefined;

  constructor() {
    // Determine headless mode - default to visible in development
    this.headless =
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_HEADLESS !== "false"
        : process.env.PUPPETEER_HEADLESS === "true";

    // Check for custom executable path
    this.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
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

    // Check if executable path exists (if provided)
    let executablePath = this.executablePath;
    if (executablePath) {
      try {
        const fs = await import("fs/promises");
        await fs.access(executablePath);
        console.log(`📍 Using Chrome at: ${executablePath}`);
      } catch {
        console.warn(
          `⚠️  Chrome not found at ${executablePath}, using Puppeteer's bundled Chromium`
        );
        // Explicitly unset the environment variable so Puppeteer doesn't try to use it
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
        executablePath = undefined;
      }
    } else {
      console.log(`📍 Using Puppeteer's bundled Chromium`);
    }

    // Launch browser with retry logic
    let browser: Browser;
    try {
      // Build launch options - only include executablePath if it's valid
      const launchOptions: any = {
        headless: this.headless ? "new" : false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
          "--window-size=1920,1080",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-web-security", // Helps bypass some restrictions
          "--disable-features=VizDisplayCompositor",
        ],
      };
      
      // Only add executablePath if it's valid and exists
      if (executablePath) {
        launchOptions.executablePath = executablePath;
      }
      
      // @ts-ignore - puppeteer-extra extends puppeteer but types aren't perfect
      browser = await puppeteer.launch(launchOptions);
    } catch (launchError: any) {
      // If launch fails due to executablePath, retry without it
      if (
        launchError?.message?.includes("executablePath") ||
        launchError?.message?.includes("Browser was not found") ||
        launchError?.message?.includes("Tried to find the browser")
      ) {
        console.warn(
          `⚠️  Browser launch failed with custom path, retrying with bundled Chromium...`
        );
        // Explicitly unset the env var to prevent Puppeteer from reading it
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
        // @ts-ignore - puppeteer-extra extends puppeteer but types aren't perfect
        browser = await puppeteer.launch({
          headless: this.headless ? "new" : false,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--window-size=1920,1080",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-web-security",
            "--disable-features=VizDisplayCompositor",
          ],
        });
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
