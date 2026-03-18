const axios = require("axios");
const pLimit = require("p-limit");

const ASANA_BASE_URL = "https://app.asana.com/api/1.0";

// Asana API Rate Limits
const MAX_REQUESTS_PER_MINUTE = 150;
const MAX_CONCURRENT_GETS = 50;
const MAX_CONCURRENT_WRITES = 50;

// Token bucket for rate limiting (150 requests per minute = 2.5 per second)
class TokenBucket {
  constructor(tokensPerMinute) {
    this.tokensPerMinute = tokensPerMinute;
    this.tokens = tokensPerMinute;
    this.lastRefill = Date.now();
    this.refillInterval = 60000; // 1 minute
  }

  async consume(tokens = 1) {
    this.refill();
    
    while (this.tokens < tokens) {
      const waitTime = Math.ceil((tokens - this.tokens) * (this.refillInterval / this.tokensPerMinute));
      await sleep(Math.max(waitTime, 100));
      this.refill();
    }
    
    this.tokens -= tokens;
    return true;
  }

  refill() {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = Math.floor((timePassed / this.refillInterval) * this.tokensPerMinute);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.tokens + tokensToAdd, this.tokensPerMinute);
      this.lastRefill = now;
    }
  }
}

// Global rate limiters
const requestBucket = new TokenBucket(MAX_REQUESTS_PER_MINUTE);
const getLimiter = pLimit(MAX_CONCURRENT_GETS);
const writeLimiter = pLimit(MAX_CONCURRENT_WRITES);

function createAsanaClient(token) {
  if (!token) {
    throw new Error("Asana token is required");
  }

  const client = axios.create({
    baseURL: ASANA_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 30000,
  });

  // Wrap client methods with rate limiting
  const originalGet = client.get.bind(client);
  const originalPost = client.post.bind(client);
  const originalPut = client.put.bind(client);
  const originalDelete = client.delete.bind(client);

  // Rate-limited GET (150 req/min, 50 concurrent)
  client.get = async (...args) => {
    await requestBucket.consume(1);
    return getLimiter(async () => {
      return originalGet(...args);
    });
  };

  // Rate-limited POST (150 req/min, 50 concurrent writes)
  client.post = async (...args) => {
    await requestBucket.consume(1);
    return writeLimiter(async () => {
      return originalPost(...args);
    });
  };

  // Rate-limited PUT (150 req/min, 50 concurrent writes)
  client.put = async (...args) => {
    await requestBucket.consume(1);
    return writeLimiter(async () => {
      return originalPut(...args);
    });
  };

  // Rate-limited DELETE (150 req/min, 50 concurrent writes)
  client.delete = async (...args) => {
    await requestBucket.consume(1);
    return writeLimiter(async () => {
      return originalDelete(...args);
    });
  };

  return client;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllPaginated(client, path, params, opts) {
  const pageSize = opts?.pageSize ?? 100;
  const maxDelayMs = opts?.maxDelayMs ?? 1000; // Max wait between pages

  const out = [];
  let offset = undefined;

  while (true) {
    const res = await client.get(path, {
      params: {
        ...params,
        limit: pageSize,
        offset,
      },
    });

    const data = res?.data;
    const items = Array.isArray(data?.data) ? data.data : [];
    out.push(...items);

    const nextOffset = data?.next_page?.offset;
    if (!nextOffset) break;

    offset = nextOffset;
    
    // Adaptive delay based on rate limit availability
    const delayMs = Math.min(400, maxDelayMs);
    await sleep(delayMs);
  }

  return out;
}

module.exports = { createAsanaClient, fetchAllPaginated, sleep };
