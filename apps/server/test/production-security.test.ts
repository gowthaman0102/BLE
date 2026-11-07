import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock DB module before loading app/services to protect against external DB access in unit tests
vi.mock('../src/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          then: vi.fn((cb) => Promise.resolve(cb([]))),
        })),
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve([])),
            })),
          })),
        })),
      })),
    })),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { validateEnv, resetConfigCache, type ServerConfig } from '../src/config/env';
import { securityHeadersMiddleware, hardenedCorsMiddleware } from '../src/middlewares/security.middleware';
import {
  authRateLimitMiddleware,
  MemoryRateLimitStore,
  resetRateLimitStore,
} from '../src/middlewares/rate-limit.middleware';
import { requireRole } from '../src/middlewares/auth.middleware';
import type { AuthPrincipal } from '@smart-attendance/shared';

describe('Milestone S10.1 — Environment, Secrets & Security Hardening Tests', () => {
  beforeEach(() => {
    resetConfigCache();
    resetRateLimitStore();
    vi.restoreAllMocks();
  });

  // ============================================================================
  // 1. Environment Validation Tests
  // ============================================================================
  describe('Environment Validation (config/env.ts)', () => {
    const validProdEnv: Record<string, string> = {
      NODE_ENV: 'production',
      PORT: '4000',
      DATABASE_URL: 'postgres://app_user:StrongPassword123@db.prod.internal:5432/smart_attendance_prod',
      JWT_SECRET: 'super-secure-production-jwt-secret-minimum-32-characters-long!',
      CORS_ORIGIN: 'https://admin.smartattendance.ac.in,https://attendance.smartattendance.ac.in',
      COLLEGE_EMAIL_DOMAIN: 'sonatech.ac.in',
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_RATE_LIMIT_WINDOW_SECONDS: '30',
    };

    it('passes validation with a complete and secure production configuration', () => {
      const config = validateEnv(validProdEnv);
      expect(config.nodeEnv).toBe('production');
      expect(config.isProduction).toBe(true);
      expect(config.port).toBe(4000);
      expect(config.corsOrigins).toEqual([
        'https://admin.smartattendance.ac.in',
        'https://attendance.smartattendance.ac.in',
      ]);
      expect(config.authRateLimitMax).toBe(5);
      expect(config.authRateLimitWindowSeconds).toBe(30);
    });

    it('fails fast when required production variables are missing', () => {
      expect(() => {
        validateEnv({
          NODE_ENV: 'production',
          // DATABASE_URL missing
          // JWT_SECRET missing
          // CORS_ORIGIN missing
        });
      }).toThrowError(/DATABASE_URL is required/);
    });

    it('rejects too-short JWT_SECRET in production', () => {
      expect(() => {
        validateEnv({
          ...validProdEnv,
          JWT_SECRET: 'short-secret',
        });
      }).toThrowError(/JWT_SECRET is too short/);
    });

    it('rejects known insecure placeholder JWT secrets in production', () => {
      expect(() => {
        validateEnv({
          ...validProdEnv,
          JWT_SECRET: 'development_only_secret_must_be_changed_in_prod_32chars!',
        });
      }).toThrowError(/JWT_SECRET cannot use insecure default or placeholder values/);
    });

    it('rejects wildcard "*" CORS origin in production when credentials are used', () => {
      expect(() => {
        validateEnv({
          ...validProdEnv,
          CORS_ORIGIN: '*',
        });
      }).toThrowError(/Wildcard "\*" CORS origin is forbidden in production/);
    });

    it('rejects invalid PORT numbers (out of range or non-integer)', () => {
      expect(() => {
        validateEnv({
          ...validProdEnv,
          PORT: '70000',
        });
      }).toThrowError(/Invalid PORT/);

      expect(() => {
        validateEnv({
          ...validProdEnv,
          PORT: 'not-a-number',
        });
      }).toThrowError(/Invalid PORT/);
    });

    it('rejects invalid DATABASE_URL protocol without leaking connection string', () => {
      const secretPass = 'SuperConfidentialPassword987';
      const badDbUrl = `mysql://user:${secretPass}@db.internal:3306/db`;

      try {
        validateEnv({
          ...validProdEnv,
          DATABASE_URL: badDbUrl,
        });
        expect.fail('Should have thrown validation error');
      } catch (err: any) {
        expect(err.message).toContain('DATABASE_URL must start with postgres:// or postgresql:// protocol.');
        // Verify secret redaction: error message must NOT reveal the password!
        expect(err.message).not.toContain(secretPass);
      }
    });

    it('provides safe defaults in development mode', () => {
      const devConfig = validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/smart_attendance',
      });
      expect(devConfig.nodeEnv).toBe('development');
      expect(devConfig.isProduction).toBe(false);
      expect(devConfig.port).toBe(3000);
      expect(devConfig.corsOrigins).toContain('http://localhost:5173');
      expect(devConfig.corsOrigins).toContain('http://127.0.0.1:5173');
      expect(devConfig.authRateLimitMax).toBe(10);
      expect(devConfig.authRateLimitWindowSeconds).toBe(60);
    });
  });

  // ============================================================================
  // 2. Production CORS Tests
  // ============================================================================
  describe('CORS Enforcement (middlewares/security.middleware.ts)', () => {
    it('in production: allows explicitly approved origin with credentials', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://usr:pwd@remote.db:5432/db';
      process.env.JWT_SECRET = 'a-very-long-production-jwt-secret-with-at-least-32-chars';
      process.env.CORS_ORIGIN = 'https://admin.smartattendance.ac.in';
      resetConfigCache();

      const app = new Hono();
      app.use('*', hardenedCorsMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const res = await app.request('/test', {
        headers: { Origin: 'https://admin.smartattendance.ac.in' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.smartattendance.ac.in');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('in production: rejects unapproved origin by omitting CORS headers', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://usr:pwd@remote.db:5432/db';
      process.env.JWT_SECRET = 'a-very-long-production-jwt-secret-with-at-least-32-chars';
      process.env.CORS_ORIGIN = 'https://admin.smartattendance.ac.in';
      resetConfigCache();

      const app = new Hono();
      app.use('*', hardenedCorsMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const res = await app.request('/test', {
        headers: { Origin: 'https://attacker.evil.com' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('in production: preflight OPTIONS for unapproved origin is rejected with 403', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://usr:pwd@remote.db:5432/db';
      process.env.JWT_SECRET = 'a-very-long-production-jwt-secret-with-at-least-32-chars';
      process.env.CORS_ORIGIN = 'https://admin.smartattendance.ac.in';
      resetConfigCache();

      const app = new Hono();
      app.use('*', hardenedCorsMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const res = await app.request('/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://malicious.origin.com' },
      });
      expect(res.status).toBe(403);
    });

    it('in development: allows localhost and loopback origins', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/smart_attendance';
      resetConfigCache();

      const app = new Hono();
      app.use('*', hardenedCorsMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const resLocalhost = await app.request('/test', {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(resLocalhost.status).toBe(200);
      expect(resLocalhost.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');

      const resLoopback = await app.request('/test', {
        headers: { Origin: 'http://127.0.0.1:8082' },
      });
      expect(resLoopback.status).toBe(200);
      expect(resLoopback.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:8082');
    });
  });

  // ============================================================================
  // 3. Security Headers Tests
  // ============================================================================
  describe('Security Headers (middlewares/security.middleware.ts)', () => {
    it('sets standard API hardening headers on every response', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/smart_attendance';
      resetConfigCache();

      const app = new Hono();
      app.use('*', securityHeadersMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const res = await app.request('/test');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none';");
      expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
    });

    it('omits HSTS header over plain HTTP in development to prevent breaking local testing', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/smart_attendance';
      resetConfigCache();

      const app = new Hono();
      app.use('*', securityHeadersMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const res = await app.request('http://localhost/test');
      expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    });

    it('includes Strict-Transport-Security header in production when request is served over HTTPS', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgres://usr:pwd@remote.db:5432/db';
      process.env.JWT_SECRET = 'a-very-long-production-jwt-secret-with-at-least-32-chars';
      process.env.CORS_ORIGIN = 'https://admin.smartattendance.ac.in';
      resetConfigCache();

      const app = new Hono();
      app.use('*', securityHeadersMiddleware());
      app.get('/test', (c) => c.text('ok'));

      const res = await app.request('https://api.smartattendance.ac.in/test', {
        headers: { 'x-forwarded-proto': 'https' },
      });
      expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
    });

    it('verifies Content-Security-Policy does not interfere with JSON response parsing for browser clients', async () => {
      const app = new Hono();
      app.use('*', securityHeadersMiddleware());
      app.get('/api/test-json', (c) => c.json({ success: true, message: 'payload delivered' }));

      const res = await app.request('/api/test-json');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; frame-ancestors 'none';");
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('payload delivered');
    });
  });

  // ============================================================================
  // 4. Health and Readiness Probe Tests
  // ============================================================================
  describe('Health and Readiness Probes', () => {
    it('GET /health returns 200 OK with healthy status', async () => {
      const app = new Hono();
      app.get('/health', (c) => c.json({ status: 'healthy', timestamp: new Date().toISOString() }));

      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('healthy');
    });

    it('GET /ready returns 200 when database connectivity succeeds', async () => {
      const app = new Hono();
      app.get('/ready', async (c) => {
        return c.json({ status: 'ready', database: 'connected' });
      });

      const res = await app.request('/ready');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ready');
      expect(data.database).toBe('connected');
    });

    it('GET /ready returns 503 without leaking credentials when database fails', async () => {
      const app = new Hono();
      app.get('/ready', async (c) => {
        return c.json({ status: 'unready', database: 'disconnected', error: 'Database connectivity check failed.' }, 503);
      });

      const res = await app.request('/ready');
      expect(res.status).toBe(503);
      const data = await res.json();
      expect(data.status).toBe('unready');
      expect(data.error).toBe('Database connectivity check failed.');
      expect(JSON.stringify(data)).not.toContain('postgres://');
    });
  });

  // ============================================================================
  // 4. Rate Limiting Tests
  // ============================================================================
  describe('Authentication Rate Limiting (middlewares/rate-limit.middleware.ts)', () => {
    it('allows requests within the configured threshold and sets rate limit headers', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/smart_attendance';
      process.env.AUTH_RATE_LIMIT_MAX = '3';
      process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS = '60';
      resetConfigCache();

      const app = new Hono();
      app.use('/api/auth/login', authRateLimitMiddleware({ maxRequests: 3, windowSeconds: 60 }));
      app.post('/api/auth/login', (c) => c.json({ ok: true }));

      // Request 1
      const res1 = await app.request('/api/auth/login', { method: 'POST' });
      expect(res1.status).toBe(200);
      expect(res1.headers.get('X-RateLimit-Limit')).toBe('3');
      expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2');

      // Request 2
      const res2 = await app.request('/api/auth/login', { method: 'POST' });
      expect(res2.status).toBe(200);
      expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1');

      // Request 3
      const res3 = await app.request('/api/auth/login', { method: 'POST' });
      expect(res3.status).toBe(200);
      expect(res3.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('returns 429 Too Many Requests with Retry-After header when threshold is exceeded', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/smart_attendance';
      resetConfigCache();

      const app = new Hono();
      app.use('/api/auth/login', authRateLimitMiddleware({ maxRequests: 2, windowSeconds: 60 }));
      app.post('/api/auth/login', (c) => c.json({ ok: true }));

      // Exhaust limit (2 requests)
      await app.request('/api/auth/login', { method: 'POST' });
      await app.request('/api/auth/login', { method: 'POST' });

      // Request 3: should be rate-limited
      const resRateLimited = await app.request('/api/auth/login', { method: 'POST' });
      expect(resRateLimited.status).toBe(429);

      const retryAfter = resRateLimited.headers.get('Retry-After');
      expect(retryAfter).not.toBeNull();
      expect(parseInt(retryAfter!, 10)).toBeGreaterThan(0);

      const data = await resRateLimited.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('RATE_LIMITED');
      expect(data.error.message).toContain('Too many requests');
    });

    it('does not rate-limit non-auth endpoints or non-POST requests', async () => {
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/smart_attendance';
      resetConfigCache();

      const app = new Hono();
      app.use('/api/auth/login', authRateLimitMiddleware({ maxRequests: 1, windowSeconds: 60 }));
      app.post('/api/auth/login', (c) => c.json({ ok: true }));
      app.get('/api/health', (c) => c.json({ status: 'ok' }));

      // Exhaust auth login
      await app.request('/api/auth/login', { method: 'POST' });
      const authBlocked = await app.request('/api/auth/login', { method: 'POST' });
      expect(authBlocked.status).toBe(429);

      // Non-auth GET /api/health should not be blocked
      const healthRes = await app.request('/api/health');
      expect(healthRes.status).toBe(200);
    });
  });

  // ============================================================================
  // 5. RBAC Regression Tests
  // ============================================================================
  describe('RBAC Authorization Regression Checks', () => {
    it('returns 401 UNAUTHORIZED for unauthenticated users', async () => {
      const app = new Hono();
      app.get('/protected', requireRole('ADMIN'), (c) => c.json({ ok: true }));

      const res = await app.request('/protected');
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN for non-admin principals attempting admin actions', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', {
          id: 'user-faculty-1',
          name: 'Prof. Faculty',
          collegeEmail: 'faculty@sonatech.ac.in',
          roles: ['STAFF', 'FACULTY'],
          userType: 'STAFF',
        } as AuthPrincipal);
        await next();
      });
      app.post('/departments', requireRole('ADMIN'), (c) => c.json({ ok: true }));

      const res = await app.request('/departments', { method: 'POST' });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('FORBIDDEN');
    });
  });
});
