import 'dotenv/config';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function sanitizeDbUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.username ? '***' : ''}${u.password ? ':***@' : ''}${u.host}${u.pathname}`;
  } catch {
    return '***';
  }
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

async function syncMigrationState() {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error('DATABASE_URL is required to baseline migration state.');
  }

  const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Journal file not found at: ${journalPath}`);
  }

  const journalData = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  const committedEntries = journalData.entries || [];

  console.log(`[Baseline] Connecting to: ${sanitizeDbUrl(rawUrl)}`);
  const sql = postgres(rawUrl, { max: 1 });

  try {
    // 1. Verify that core tables actually exist before baselining
    const checkCore = await sql`
      SELECT count(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('departments', 'academic_years', 'classes', 'students', 'staff', 'timetables');
    `;

    const tableCount = parseInt(checkCore[0]?.count || '0', 10);
    if (tableCount < 6) {
      console.log(`[Baseline Notice] Core schema tables are not fully present (${tableCount}/6 detected).`);
      console.log('[Baseline Notice] Run "npm run db:migrate" on a clean database instead.');
      return;
    }

    // 2. Ensure __drizzle_migrations table exists
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      );
    `);

    // 3. For each committed migration, compute hash and ensure it exists in __drizzle_migrations
    let synchronized = 0;
    for (const entry of committedEntries) {
      const sqlFilePath = path.resolve(process.cwd(), `drizzle/${entry.tag}.sql`);
      if (!fs.existsSync(sqlFilePath)) {
        throw new Error(`Migration SQL file not found: ${sqlFilePath}`);
      }

      const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
      const hash = crypto.createHash('sha256').update(sqlContent).digest('hex');

      const existing = await sql`
        SELECT id FROM "__drizzle_migrations" WHERE hash = ${hash} LIMIT 1;
      `;

      if (existing.length === 0) {
        await sql`
          INSERT INTO "__drizzle_migrations" (hash, created_at)
          VALUES (${hash}, ${entry.when});
        `;
        synchronized++;
      }
    }

    console.log(`[Baseline Complete] Successfully baselined/synchronized ${synchronized} migration records.`);
    console.log(`[Baseline Complete] All ${committedEntries.length} committed migrations are now tracked in __drizzle_migrations.`);
  } catch (error: any) {
    const safeError = error?.message || 'Database error';
    console.error(`[Baseline Error] Failed to sync migration state: ${safeError.replace(rawUrl, '***')}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

syncMigrationState().catch((err: any) => {
  console.error('[Baseline Fatal Error]', err.message || 'Fatal error');
  process.exit(1);
});
