import { Redis, type RedisOptions } from "ioredis";
import type { AlibabaProduct } from "./scrapers/alibaba-scraper.js";

// Redis client instance
let redisClient: Redis | null = null;
let cacheEnabled = false;

// Initialize Redis connection
export function initializeCache(): void {
  const redisUrl = process.env.REDIS_URL;
  const redisHost = process.env.REDIS_HOST || "localhost";
  const redisPort = Number(process.env.REDIS_PORT) || 6379;
  const redisPassword = process.env.REDIS_PASSWORD;

  // If REDIS_URL is provided, use it; otherwise use host/port
  if (redisUrl) {
    try {
      redisClient = new Redis(redisUrl, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      cacheEnabled = true;
      console.log("✅ Redis cache initialized with URL");
    } catch (error) {
      console.warn("⚠️  Failed to initialize Redis with URL:", error);
      cacheEnabled = false;
    }
  } else if (redisHost) {
    try {
      redisClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      cacheEnabled = true;
      console.log(`✅ Redis cache initialized at ${redisHost}:${redisPort}`);
    } catch (error) {
      console.warn("⚠️  Failed to initialize Redis:", error);
      cacheEnabled = false;
    }
  } else {
    console.log("ℹ️  Redis not configured, caching disabled");
    cacheEnabled = false;
  }

  // Handle Redis connection events
  if (redisClient) {
    redisClient.on("connect", () => {
      console.log("🔗 Redis connected");
    });

    redisClient.on("ready", () => {
      console.log("✅ Redis ready");
    });

    redisClient.on("error", (error: Error) => {
      console.warn("⚠️  Redis error:", error.message);
      cacheEnabled = false;
    });

    redisClient.on("close", () => {
      console.warn("⚠️  Redis connection closed");
      cacheEnabled = false;
    });

    // Attempt to connect
    redisClient.connect().catch((error: Error) => {
      console.warn(
        "⚠️  Redis connection failed, continuing without cache:",
        error.message
      );
      cacheEnabled = false;
    });
  }
}

/**
 * Normalize URL by adding protocol if missing
 */
function ensureProtocol(url: string): string {
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
 * Normalize URL to create a consistent cache key
 * Removes query parameters that don't affect the product page
 */
function normalizeUrl(url: string): string {
  try {
    // Ensure URL has a protocol before parsing
    const urlWithProtocol = ensureProtocol(url);
    const urlObj = new URL(urlWithProtocol);
    // Remove common tracking/analytics parameters
    const paramsToRemove = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
      "spm",
      "scm",
    ];

    paramsToRemove.forEach((param) => {
      urlObj.searchParams.delete(param);
    });

    // Return normalized URL
    return urlObj.toString();
  } catch {
    // If URL parsing fails, return as-is (with protocol if we added one)
    return ensureProtocol(url);
  }
}

/**
 * Generate cache key from URL
 */
function getCacheKey(url: string): string {
  const normalized = normalizeUrl(url);
  // Use a hash of the URL as the key to avoid issues with special characters
  return `scraper:product:${Buffer.from(normalized).toString("base64")}`;
}

/**
 * Get cached product data
 */
export async function getCachedProduct(
  url: string
): Promise<AlibabaProduct | null> {
  if (!cacheEnabled || !redisClient) {
    return null;
  }

  try {
    const key = getCacheKey(url);
    const cached = await redisClient.get(key);

    if (cached) {
      console.log(`💾 Cache hit for: ${url.substring(0, 80)}...`);
      return JSON.parse(cached) as AlibabaProduct;
    }

    return null;
  } catch (error) {
    console.warn("⚠️  Cache get error:", error);
    return null;
  }
}

/**
 * Store product data in cache
 * Default TTL is 6 hours to prevent serving stale product data
 * (prices, stock, and product details can change frequently)
 */
export async function setCachedProduct(
  url: string,
  product: AlibabaProduct,
  ttlSeconds: number = 6 * 60 * 60 // Default 6 hours
): Promise<void> {
  if (!cacheEnabled || !redisClient) {
    return;
  }

  try {
    const key = getCacheKey(url);
    const value = JSON.stringify(product);
    await redisClient.setex(key, ttlSeconds, value);
    console.log(
      `💾 Cached product for: ${url.substring(0, 80)}... (TTL: ${ttlSeconds}s)`
    );
  } catch (error) {
    console.warn("⚠️  Cache set error:", error);
    // Don't throw - caching failures shouldn't break the scraping flow
  }
}

/**
 * Delete cached product (useful for cache invalidation)
 */
export async function deleteCachedProduct(url: string): Promise<void> {
  if (!cacheEnabled || !redisClient) {
    return;
  }

  try {
    const key = getCacheKey(url);
    await redisClient.del(key);
    console.log(`🗑️  Deleted cache for: ${url.substring(0, 80)}...`);
  } catch (error) {
    console.warn("⚠️  Cache delete error:", error);
  }
}

/**
 * Check if cache is enabled and available
 */
export function isCacheAvailable(): boolean {
  return cacheEnabled && redisClient !== null;
}

/**
 * Close Redis connection gracefully
 */
export async function closeCache(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    cacheEnabled = false;
    console.log("🔌 Redis connection closed");
  }
}
