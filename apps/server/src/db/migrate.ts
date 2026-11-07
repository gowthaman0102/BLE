import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'node:path';
import { sanitizeDbUrl } from './sanitize';

export { sanitizeDbUrl };

async function runProductionMigrations() {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error('DATABASE_URL environment variable is required to run migrations.');
  }

  // Safety guard for test environment
  if (process.env.NODE_ENV === 'test') {
    try {
      const u = new URL(rawUrl);
      const dbName = decodeURIComponent(u.pathname.slice(1));
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname) || !dbName.endsWith('_test')) {
        throw new Error('Refusing to run test migrations against a non-loopback database whose name does not end in _test.');
      }
    } catch (e: any) {
      if (e.message.includes('Refusing to run')) throw e;
      throw new Error('Invalid DATABASE_URL configuration.');
    }
  }

  console.log(`[Database Migration] Connecting to target: ${sanitizeDbUrl(rawUrl)}`);
  const sql = postgres(rawUrl, { max: 1 });
  const db = drizzle(sql);

  const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
  console.log(`[Database Migration] Applying committed migrations from: ${migrationsFolder}`);

  try {
    await migrate(db, { migrationsFolder, migrationsSchema: 'public' });
    console.log('[Database Migration] All migrations executed successfully.');
  } catch (error: any) {
    // Redact raw error to prevent leaking connection passwords
    const safeError = error?.message || 'Unknown migration execution error';
    console.error(`[Database Migration Error] Migration failed: ${safeError.replace(rawUrl, '***')}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

runProductionMigrations().catch((err: any) => {
  console.error('[Database Migration Fatal Error]', err.message || 'Fatal initialization error.');
  process.exit(1);
});
