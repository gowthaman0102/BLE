import 'dotenv/config';
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeDbUrl } from '../src/db/sanitize';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface DrizzleMigrationRecord {
  id: number;
  hash: string;
  created_at: string;
}

async function checkMigrationStatus() {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new Error('DATABASE_URL environment variable is required to check migrations.');
  }

  // Load journal file
  const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Drizzle journal file not found at: ${journalPath}`);
  }

  const journalData = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  const committedMigrations = journalData.entries || [];

  console.log(`[Migration Check] Connecting to database: ${sanitizeDbUrl(rawUrl)}`);
  const sql = postgres(rawUrl, { max: 1 });

  try {
    // Check if __drizzle_migrations table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = '__drizzle_migrations'
      ) as exists;
    `;

    const tableExists = Boolean(tableCheck[0]?.exists);
    if (!tableExists) {
      console.log('\n[Status] Migration table __drizzle_migrations does not exist. (0 migrations applied)');
      console.log(`[Status] All ${committedMigrations.length} migrations are PENDING.`);
      process.exitCode = 1;
      return;
    }

    const appliedRecords = await sql<DrizzleMigrationRecord[]>`
      SELECT id, hash, created_at 
      FROM __drizzle_migrations 
      ORDER BY id ASC;
    `;

    console.log(`\nFound ${committedMigrations.length} committed migrations and ${appliedRecords.length} applied database records.\n`);

    const appliedHashes = new Set(appliedRecords.map((r) => r.hash));
    const pendingList: string[] = [];

    for (const entry of committedMigrations) {
      const isApplied = appliedRecords.some((r, i) => i === entry.idx || r.hash.includes(entry.tag));
      const statusIcon = isApplied ? '✅ APPLIED' : '⏳ PENDING';
      console.log(`  ${entry.idx.toString().padStart(2, '0')}. [${statusIcon}] ${entry.tag}`);
      if (!isApplied) {
        pendingList.push(entry.tag);
      }
    }

    console.log('\n------------------------------------------------------------');
    if (pendingList.length === 0) {
      console.log('✅ DATABASE SCHEMA IS FULLY UP TO DATE.');
    } else {
      console.log(`⚠️  PENDING MIGRATIONS DETECTED (${pendingList.length} unapplied):`);
      for (const p of pendingList) console.log(`   - ${p}`);
      console.log('Run "npm run db:migrate" to apply pending migrations.');
      process.exitCode = 1;
    }
    console.log('------------------------------------------------------------\n');
  } catch (error: any) {
    const safeError = error?.message || 'Database connection error';
    console.error(`[Migration Check Error] Failed to inspect migration state: ${safeError.replace(rawUrl, '***')}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

checkMigrationStatus().catch((err: any) => {
  console.error('[Migration Check Fatal Error]', err.message || 'Fatal inspection error.');
  process.exit(1);
});
