/**
 * Redis Cache Utility
 * 
 * Provides a graceful caching layer that falls back to in-memory
 * caching if Redis is not available. This ensures the app never
 * breaks due to Redis connectivity issues.
 */

let redisClient = null;
let useRedis = false;

// In-memory fallback cache
const memoryCache = new Map();
const memoryCacheTTL = new Map(); // key -> expiry timestamp

function cleanExpiredMemoryCache() {
  const now = Date.now();
  for (const [key, expiry] of memoryCacheTTL.entries()) {
    if (now > expiry) {
      memoryCache.delete(key);
      memoryCacheTTL.delete(key);
    }
  }
}

// Clean expired entries every 60 seconds
setInterval(cleanExpiredMemoryCache, 60000);

/**
 * Initialize Redis connection.
 * If REDIS_URL is not set or connection fails, falls back to in-memory cache.
 */
async function initRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[Cache] No REDIS_URL found — using in-memory cache");
    return;
  }

  try {
    const Redis = require("ioredis");
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        if (times > 3) {
          console.log("[Cache] Redis retry limit reached — falling back to memory cache");
          useRedis = false;
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
      connectTimeout: 5000,
    });

    redisClient.on("connect", () => {
      console.log("[Cache] Redis connected");
      useRedis = true;
    });

    redisClient.on("error", (err) => {
      console.error("[Cache] Redis error:", err.message);
      useRedis = false;
    });

    redisClient.on("close", () => {
      useRedis = false;
    });

    await redisClient.connect();
    useRedis = true;
  } catch (err) {
    console.log("[Cache] Redis connection failed — using in-memory cache:", err.message);
    useRedis = false;
  }
}

/**
 * Get a cached value by key.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
async function cacheGet(key) {
  try {
    if (useRedis && redisClient) {
      const data = await redisClient.get(key);
      return data ? JSON.parse(data) : null;
    }
    // Fallback to memory cache
    const now = Date.now();
    const expiry = memoryCacheTTL.get(key);
    if (expiry && now > expiry) {
      memoryCache.delete(key);
      memoryCacheTTL.delete(key);
      return null;
    }
    return memoryCache.get(key) || null;
  } catch (err) {
    console.error("[Cache] GET error:", err.message);
    return null;
  }
}

/**
 * Set a cached value with TTL (in seconds).
 * @param {string} key
 * @param {any} value - Will be JSON-serialized
 * @param {number} ttlSeconds - Time to live in seconds (default: 30)
 */
async function cacheSet(key, value, ttlSeconds = 30) {
  try {
    if (useRedis && redisClient) {
      await redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return;
    }
    // Fallback to memory cache
    memoryCache.set(key, value);
    memoryCacheTTL.set(key, Date.now() + ttlSeconds * 1000);
  } catch (err) {
    console.error("[Cache] SET error:", err.message);
  }
}

/**
 * Delete a specific cache key (or pattern with wildcard).
 * @param {string} pattern - Exact key or pattern with * for wildcard
 */
async function cacheDel(pattern) {
  try {
    if (useRedis && redisClient) {
      if (pattern.includes("*")) {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } else {
        await redisClient.del(pattern);
      }
      return;
    }
    // Fallback: delete from memory cache
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      for (const key of memoryCache.keys()) {
        if (regex.test(key)) {
          memoryCache.delete(key);
          memoryCacheTTL.delete(key);
        }
      }
    } else {
      memoryCache.delete(pattern);
      memoryCacheTTL.delete(pattern);
    }
  } catch (err) {
    console.error("[Cache] DEL error:", err.message);
  }
}

/**
 * Cache-aside helper: get from cache or fetch and cache.
 * @param {string} key
 * @param {Function} fetchFn - Async function that returns the data
 * @param {number} ttlSeconds
 * @returns {Promise<any>}
 */
async function cacheWrap(key, fetchFn, ttlSeconds = 30) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;
  
  const data = await fetchFn();
  await cacheSet(key, data, ttlSeconds);
  return data;
}

module.exports = {
  initRedis,
  cacheGet,
  cacheSet,
  cacheDel,
  cacheWrap,
};
