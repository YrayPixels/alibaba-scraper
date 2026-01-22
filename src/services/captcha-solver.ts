/**
 * Captcha Solving Service
 * Supports 2Captcha and similar services for automatic captcha solving
 */

interface CaptchaSolverConfig {
  apiKey: string;
  service: "2captcha" | "anticaptcha" | "capsolver";
  timeout?: number;
  pollingInterval?: number;
}

interface SolveResult {
  success: boolean;
  token?: string;
  error?: string;
}

export class CaptchaSolver {
  private config: Required<CaptchaSolverConfig>;
  private baseUrls = {
    "2captcha": "https://2captcha.com",
    "anticaptcha": "https://api.anti-captcha.com",
    "capsolver": "https://api.capsolver.com",
  };

  constructor(config: CaptchaSolverConfig) {
    this.config = {
      apiKey: config.apiKey,
      service: config.service,
      timeout: config.timeout || 120000, // 2 minutes default
      pollingInterval: config.pollingInterval || 5000, // 5 seconds
    };

    if (!this.config.apiKey) {
      throw new Error("Captcha solver API key is required");
    }
  }

  /**
   * Solve a slider captcha (like Alibaba's "slide to verify")
   * This is a simplified version - for production, you'd need to handle the specific captcha type
   */
  async solveSliderCaptcha(pageUrl: string, siteKey?: string): Promise<SolveResult> {
    if (this.config.service === "2captcha") {
      return this.solveWith2Captcha(pageUrl, siteKey, "hcaptcha"); // Alibaba uses hCaptcha-like slider
    }
    
    throw new Error(`Captcha solving for ${this.config.service} is not yet implemented`);
  }

  /**
   * Solve reCAPTCHA v2
   */
  async solveRecaptchaV2(pageUrl: string, siteKey: string): Promise<SolveResult> {
    if (this.config.service === "2captcha") {
      return this.solveWith2Captcha(pageUrl, siteKey, "recaptchav2");
    }
    
    throw new Error(`Captcha solving for ${this.config.service} is not yet implemented`);
  }

  /**
   * Solve hCaptcha
   */
  async solveHCaptcha(pageUrl: string, siteKey: string): Promise<SolveResult> {
    if (this.config.service === "2captcha") {
      return this.solveWith2Captcha(pageUrl, siteKey, "hcaptcha");
    }
    
    throw new Error(`Captcha solving for ${this.config.service} is not yet implemented`);
  }

  /**
   * Generic 2Captcha solving method
   */
  private async solveWith2Captcha(
    pageUrl: string,
    siteKey: string | undefined,
    captchaType: "recaptchav2" | "hcaptcha" | "turnstile"
  ): Promise<SolveResult> {
    const baseUrl = this.baseUrls["2captcha"];

    try {
      // Step 1: Submit captcha for solving
      const submitUrl = `${baseUrl}/in.php`;
      const submitParams = new URLSearchParams({
        key: this.config.apiKey,
        method: captchaType,
        pageurl: pageUrl,
        json: "1",
      });

      if (siteKey) {
        submitParams.append("sitekey", siteKey);
      }

      console.log(`📤 Submitting captcha to 2Captcha...`);
      const submitResponse = await fetch(`${submitUrl}?${submitParams.toString()}`);
      const submitData = await submitResponse.json();

      if (submitData.status !== 1) {
        return {
          success: false,
          error: submitData.request || "Failed to submit captcha",
        };
      }

      const taskId = submitData.request;
      console.log(`✅ Captcha submitted, task ID: ${taskId}`);
      console.log(`⏳ Waiting for solution (this may take 10-120 seconds)...`);

      // Step 2: Poll for solution
      const solutionUrl = `${baseUrl}/res.php`;
      const startTime = Date.now();

      while (Date.now() - startTime < this.config.timeout) {
        await new Promise((resolve) => setTimeout(resolve, this.config.pollingInterval));

        const pollParams = new URLSearchParams({
          key: this.config.apiKey,
          action: "get",
          id: taskId,
          json: "1",
        });

        const pollResponse = await fetch(`${solutionUrl}?${pollParams.toString()}`);
        const pollData = await pollResponse.json();

        if (pollData.status === 1) {
          console.log(`✅ Captcha solved! Token received`);
          return {
            success: true,
            token: pollData.request,
          };
        } else if (pollData.request === "CAPCHA_NOT_READY") {
          // Still processing, continue polling
          process.stdout.write(".");
          continue;
        } else {
          return {
            success: false,
            error: pollData.request || "Failed to get solution",
          };
        }
      }

      return {
        success: false,
        error: "Timeout waiting for captcha solution",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<number> {
    if (this.config.service === "2captcha") {
      const baseUrl = this.baseUrls["2captcha"];
      const response = await fetch(
        `${baseUrl}/res.php?key=${this.config.apiKey}&action=getbalance&json=1`
      );
      const data = await response.json();
      return parseFloat(data.request || "0");
    }
    
    throw new Error(`Balance check for ${this.config.service} is not yet implemented`);
  }
}

/**
 * Create captcha solver instance from environment variables
 */
export function createCaptchaSolver(): CaptchaSolver | null {
  const apiKey = process.env.CAPTCHA_SOLVER_API_KEY;
  const service = (process.env.CAPTCHA_SOLVER_SERVICE || "2captcha") as "2captcha" | "anticaptcha" | "capsolver";

  if (!apiKey) {
    console.warn("⚠️  CAPTCHA_SOLVER_API_KEY not set - captcha solving disabled");
    return null;
  }

  return new CaptchaSolver({
    apiKey,
    service,
    timeout: parseInt(process.env.CAPTCHA_SOLVER_TIMEOUT || "120000"),
    pollingInterval: parseInt(process.env.CAPTCHA_SOLVER_POLLING_INTERVAL || "5000"),
  });
}
