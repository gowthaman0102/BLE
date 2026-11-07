/**
 * Centralized, validated environment configuration for the Smart Attendance Server.
 * Enforces production security invariants and fail-fast startup validation without leaking secrets.
 */

export interface ServerConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  isTest: boolean;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  collegeEmailDomain: string;
  attendanceStartEarlyMinutes: number;
  authRateLimitMax: number;
  authRateLimitWindowSeconds: number;
  enableDemoSignup: boolean;
  faceMatchingProvider: 'NOT_CONFIGURED' | 'OPENCV_SFACE';
  faceMatchThreshold: number;
  faceMinConfidence: number;
  pythonExecutable: string;
}

const INSECURE_JWT_DEFAULTS = new Set([
  'development_only_secret_must_be_changed_in_prod_32chars!',
  '<replace-with-a-long-random-secret>',
  'your-super-secret-jwt-key-here-must-be-32-chars',
  '12345678901234567890123456789012',
]);

/**
 * Validates and normalizes raw environment variables.
 * Throws human-readable errors with variable names, strictly redacting secret values.
 */
export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): ServerConfig {
  const errors: string[] = [];

  // 1. NODE_ENV
  const rawNodeEnv = (rawEnv.NODE_ENV || 'development').trim().toLowerCase();
  if (!['development', 'production', 'test'].includes(rawNodeEnv)) {
    errors.push(`Invalid NODE_ENV: "${rawNodeEnv}". Allowed values: development, production, test.`);
  }
  const nodeEnv = (rawNodeEnv as 'development' | 'production' | 'test') || 'development';
  const isProduction = nodeEnv === 'production';
  const isTest = nodeEnv === 'test';

  // 2. PORT
  const rawPort = rawEnv.PORT || '3000';
  const port = parseInt(rawPort, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: must be an integer between 1 and 65535.`);
  }

  // 3. DATABASE_URL
  const rawDbUrl = rawEnv.DATABASE_URL?.trim();
  if (!rawDbUrl) {
    errors.push('DATABASE_URL is required.');
  } else {
    try {
      const parsedUrl = new URL(rawDbUrl);
      if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
        errors.push('DATABASE_URL must start with postgres:// or postgresql:// protocol.');
      }
      if (isProduction) {
        if (!parsedUrl.username || !parsedUrl.password) {
          errors.push('DATABASE_URL must specify credentials in production.');
        }
        if (['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname) && rawEnv.ALLOW_LOCAL_DATABASE_IN_PROD !== 'true') {
          errors.push('DATABASE_URL points to loopback/localhost in production without ALLOW_LOCAL_DATABASE_IN_PROD=true.');
        }
      }
    } catch {
      errors.push('DATABASE_URL is not a valid URL.');
    }
  }

  // 4. JWT_SECRET
  const rawJwtSecret = rawEnv.JWT_SECRET?.trim();
  let jwtSecret = rawJwtSecret || '';
  if (isProduction) {
    if (!rawJwtSecret) {
      errors.push('JWT_SECRET is required in production and must contain at least 32 characters.');
    } else if (rawJwtSecret.length < 32) {
      errors.push('JWT_SECRET is too short: must contain at least 32 characters in production.');
    } else if (INSECURE_JWT_DEFAULTS.has(rawJwtSecret)) {
      errors.push('JWT_SECRET cannot use insecure default or placeholder values in production.');
    }
  } else if (!rawJwtSecret) {
    // Safe development fallback
    jwtSecret = 'development_only_secret_must_be_changed_in_prod_32chars!';
  }

  // 5. CORS_ORIGIN
  const rawCors = rawEnv.CORS_ORIGIN?.trim();
  let corsOrigins: string[] = [];

  if (isProduction) {
    if (!rawCors) {
      errors.push('CORS_ORIGIN is required in production (must be a comma-separated list of approved origins).');
    } else {
      const candidates = rawCors.split(',').map((s) => s.trim()).filter(Boolean);
      if (candidates.length === 0) {
        errors.push('CORS_ORIGIN must contain at least one valid origin in production.');
      }
      for (const origin of candidates) {
        if (origin === '*') {
          errors.push('Wildcard "*" CORS origin is forbidden in production when credentials are enabled.');
          continue;
        }
        try {
          const originUrl = new URL(origin);
          if (!['http:', 'https:'].includes(originUrl.protocol)) {
            errors.push(`Invalid CORS origin protocol for "${origin}": must use http:// or https://.`);
          }
          if (originUrl.pathname !== '' && originUrl.pathname !== '/') {
            errors.push(`Invalid CORS origin "${origin}": origin must not include a path component.`);
          }
          corsOrigins.push(originUrl.origin);
        } catch {
          errors.push(`Invalid CORS origin format: "${origin}".`);
        }
      }
    }
  } else {
    // Development origins
    const defaultDevOrigins = [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:8081',
      'http://127.0.0.1:8081',
      'http://localhost:8082',
      'http://127.0.0.1:8082',
    ];
    if (rawCors) {
      const candidates = rawCors.split(',').map((s) => s.trim()).filter(Boolean);
      for (const candidate of candidates) {
        if (candidate === '*') {
          // In dev, if wildcard was specified, we do not add wildcard directly with credentials
          continue;
        }
        try {
          corsOrigins.push(new URL(candidate).origin);
        } catch {
          // ignore malformed dev origin
        }
      }
      // Merge unique
      for (const devOrigin of defaultDevOrigins) {
        if (!corsOrigins.includes(devOrigin)) {
          corsOrigins.push(devOrigin);
        }
      }
    } else {
      corsOrigins = defaultDevOrigins;
    }
  }

  // 6. COLLEGE_EMAIL_DOMAIN
  const collegeEmailDomain = (rawEnv.COLLEGE_EMAIL_DOMAIN || 'sonatech.ac.in').trim().toLowerCase();

  // 7. ATTENDANCE_START_EARLY_MINUTES
  const attendanceStartEarlyMinutes = Number(rawEnv.ATTENDANCE_START_EARLY_MINUTES || 20);
  if (isNaN(attendanceStartEarlyMinutes) || attendanceStartEarlyMinutes < 0) {
    errors.push('ATTENDANCE_START_EARLY_MINUTES must be a non-negative number.');
  }

  // 8. Rate Limiting Configurations
  const rawRateLimitMax = rawEnv.AUTH_RATE_LIMIT_MAX || '10';
  const authRateLimitMax = parseInt(rawRateLimitMax, 10);
  if (isNaN(authRateLimitMax) || authRateLimitMax < 1) {
    errors.push('AUTH_RATE_LIMIT_MAX must be a positive integer.');
  }

  const rawRateLimitWindow = rawEnv.AUTH_RATE_LIMIT_WINDOW_SECONDS || '60';
  const authRateLimitWindowSeconds = parseInt(rawRateLimitWindow, 10);
  if (isNaN(authRateLimitWindowSeconds) || authRateLimitWindowSeconds < 1) {
    errors.push('AUTH_RATE_LIMIT_WINDOW_SECONDS must be a positive integer.');
  }

  // 9. Demo Signup Flag
  const enableDemoSignup = !isProduction && rawEnv.ENABLE_DEMO_SIGNUP === 'true';

  // 10. Face Verification Engine Settings (Milestone F5)
  const rawProvider = (rawEnv.FACE_MATCHING_PROVIDER || 'NOT_CONFIGURED').trim().toUpperCase();
  if (!['NOT_CONFIGURED', 'OPENCV_SFACE'].includes(rawProvider)) {
    errors.push(`Invalid FACE_MATCHING_PROVIDER: "${rawProvider}". Allowed: NOT_CONFIGURED, OPENCV_SFACE.`);
  }
  const faceMatchingProvider = (rawProvider as 'NOT_CONFIGURED' | 'OPENCV_SFACE') || 'NOT_CONFIGURED';

  const rawThreshold = rawEnv.FACE_MATCH_THRESHOLD || '0.40';
  const faceMatchThreshold = parseFloat(rawThreshold);
  if (isNaN(faceMatchThreshold) || faceMatchThreshold < 0.0 || faceMatchThreshold > 1.0) {
    errors.push('FACE_MATCH_THRESHOLD must be a number between 0.0 and 1.0.');
  }

  const rawConfidence = rawEnv.FACE_MIN_CONFIDENCE || '0.60';
  const faceMinConfidence = parseFloat(rawConfidence);
  if (isNaN(faceMinConfidence) || faceMinConfidence < 0.0 || faceMinConfidence > 1.0) {
    errors.push('FACE_MIN_CONFIDENCE must be a number between 0.0 and 1.0.');
  }

  const pythonExecutable = (rawEnv.PYTHON_PATH || 'python').trim();

  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    nodeEnv,
    isProduction,
    isTest,
    port,
    databaseUrl: rawDbUrl!,
    jwtSecret,
    corsOrigins,
    collegeEmailDomain,
    attendanceStartEarlyMinutes,
    authRateLimitMax,
    authRateLimitWindowSeconds,
    enableDemoSignup,
    faceMatchingProvider,
    faceMatchThreshold,
    faceMinConfidence,
    pythonExecutable,
  };
}

let cachedConfig: ServerConfig | null = null;

/**
 * Returns the singleton validated server configuration.
 * Validates process.env on initial call.
 */
export function getConfig(): ServerConfig {
  if (!cachedConfig) {
    cachedConfig = validateEnv(process.env);
  }
  return cachedConfig;
}

/**
 * Clears the configuration cache (primarily for tests).
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}
