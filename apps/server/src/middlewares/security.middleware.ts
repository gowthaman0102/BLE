import type { MiddlewareHandler } from 'hono';
import { getConfig } from '../config/env';

/**
 * Security headers middleware enforcing protective HTTP response headers.
 * Applies standard web application hardening while preserving API client compatibility.
 */
export const securityHeadersMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    await next();

    // Standard API hardening headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none';");
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    // Strict-Transport-Security (HSTS)
    // Only apply when the request is served over HTTPS (or through an SSL-terminating reverse proxy)
    const config = getConfig();
    const isHttps = c.req.url.startsWith('https://') || c.req.header('x-forwarded-proto') === 'https';
    if (config.isProduction && isHttps) {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  };
};

/**
 * Production-hardened CORS middleware.
 * In production: strictly enforces explicit allowlist matching without wildcard credentials.
 * In development: allows standard local development ports and loopback addresses.
 */
export const hardenedCorsMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const config = getConfig();
    const origin = c.req.header('origin');

    let isAllowed = false;
    if (origin) {
      if (config.isProduction) {
        isAllowed = config.corsOrigins.includes(origin);
      } else {
        // Development / Test: allow configured origins or local loopback/ports
        const isLocalhost =
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin.startsWith('https://localhost:');
        isAllowed = isLocalhost || config.corsOrigins.includes(origin);
      }
    }

    if (isAllowed && origin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      c.header('Access-Control-Max-Age', '86400');
      c.header('Vary', 'Origin');
    }

    // Handle preflight OPTIONS request
    if (c.req.method === 'OPTIONS') {
      if (origin && !isAllowed) {
        return c.text('CORS origin rejected', 403);
      }
      return c.body(null, 204);
    }

    await next();
  };
};
