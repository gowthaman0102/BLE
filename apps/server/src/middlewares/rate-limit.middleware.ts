import type { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { getConfig } from '../config/env';

export interface RateLimitInfo {
  count: number;
  resetAtMs: number;
}

/**
 * Storage interface for rate limit counters.
 * The default implementation is in-memory (per-process).
 * NOTE: For multi-replica production deployments, replace this store with
 * a shared distributed backend (e.g. Redis / Memcached) to enforce global limits across replicas.
 */
export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitInfo>;
  reset(): void;
}

/**
 * In-memory sliding-window rate limit store.
 * Automatically evicts expired entries to prevent memory growth.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, { count: number; resetAtMs: number }>();
  private readonly maxEntries = 50_000;

  async increment(key: string, windowMs: number): Promise<RateLimitInfo> {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (this.entries.size > this.maxEntries) {
      this.cleanup(now);
    }

    if (!existing || now >= existing.resetAtMs) {
      const resetAtMs = now + windowMs;
      const entry = { count: 1, resetAtMs };
      this.entries.set(key, entry);
      return entry;
    }

    existing.count += 1;
    return existing;
  }

  reset(): void {
    this.entries.clear();
  }

  private cleanup(now: number): void {
    for (const [k, v] of this.entries.entries()) {
      if (now >= v.resetAtMs) {
        this.entries.delete(k);
      }
    }
  }
}

let defaultStore: RateLimitStore = new MemoryRateLimitStore();

/**
 * Allows swapping the rate limit store (e.g. for Redis in clustered setups or mocking in tests).
 */
export function setRateLimitStore(store: RateLimitStore): void {
  defaultStore = store;
}

export function getRateLimitStore(): RateLimitStore {
  return defaultStore;
}

export function resetRateLimitStore(): void {
  defaultStore.reset();
}

/**
 * Generates an opaque, privacy-preserving rate limiter key.
 * Strictly avoids logging or storing PII, emails, or credentials.
 */
function generateKey(ip: string, path: string): string {
  return createHash('sha256')
    .update(`${ip}::${path}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Rate limiting middleware for sensitive public authentication endpoints.
 * Returns standard 429 Too Many Requests with Retry-After headers when threshold is exceeded.
 */
export const authRateLimitMiddleware = (
  options?: {
    maxRequests?: number;
    windowSeconds?: number;
    store?: RateLimitStore;
  }
): MiddlewareHandler => {
  return async (c, next) => {
    // Only apply rate limiting to mutating requests (POST) on authentication endpoints
    if (c.req.method !== 'POST') {
      return next();
    }

    const config = getConfig();
    const max = options?.maxRequests ?? config.authRateLimitMax;
    const windowSeconds = options?.windowSeconds ?? config.authRateLimitWindowSeconds;
    const windowMs = windowSeconds * 1000;
    const store = options?.store ?? defaultStore;

    const rawIp =
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
      c.req.header('x-real-ip') ||
      '127.0.0.1';
    const path = c.req.path;
    const key = generateKey(rawIp, path);

    const info = await store.increment(key, windowMs);
    const now = Date.now();
    const remaining = Math.max(0, max - info.count);
    const retryAfter = Math.max(1, Math.ceil((info.resetAtMs - now) / 1000));
    const resetTimeSeconds = Math.ceil(info.resetAtMs / 1000);

    // Set standard rate limit headers
    c.header('X-RateLimit-Limit', String(max));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(resetTimeSeconds));

    if (info.count > max) {
      c.header('Retry-After', String(retryAfter));
      return c.json(
        {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please try again later.',
            retryAfterSeconds: retryAfter,
          },
        },
        429
      );
    }

    await next();
  };
};
