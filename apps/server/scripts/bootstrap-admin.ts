import 'dotenv/config';
import { createInterface } from 'node:readline';
import { eq, sql } from 'drizzle-orm';
import { db, client } from '../src/db';
import { staffCredentials } from '../src/db/schema/auth';
import { roles, staff, staffRoles } from '../src/db/schema/staff';
import { LocalAuthService } from '../src/services/local-auth.service';
import { AuditService } from '../src/services/audit.service';

function ask(label: string): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => prompt.question(label, (answer) => {
    prompt.close();
    resolve(answer.trim());
  }));
}

function askHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Run this one-time setup command in an interactive terminal.');
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';

    const onData = (chunk: Buffer) => {
      const character = chunk.toString('utf8');
      if (character === '\u0003') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        reject(new Error('Setup cancelled.'));
        return;
      }
      if (character === '\r' || character === '\n') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        return;
      }
      if (character >= ' ') value += character;
    };

    process.stdin.on('data', onData);
  });
}

export function validateAdminBootstrapInputs(input: {
  name: string;
  email: string;
  staffCode: string;
  password: string;
  confirmation: string;
}) {
  const { name, email, staffCode, password, confirmation } = input;
  if (name.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^[A-Z0-9_-]{3,30}$/.test(staffCode)) {
    throw new Error('Enter a valid full name, email address, and staff code.');
  }
  if (password !== confirmation) throw new Error('Password and confirmation do not match.');
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be at least 12 characters and no more than 72 UTF-8 bytes.');
  }
}

async function main() {
  const name = await ask('HOD full name: ');
  const email = (await ask('HOD college email: ')).toLowerCase();
  const staffCode = (await ask('HOD staff code: ')).toUpperCase();
  const password = await askHidden('Password (minimum 12 characters): ');
  const confirmation = await askHidden('Confirm password: ');

  validateAdminBootstrapInputs({ name, email, staffCode, password, confirmation });

  const hashedPassword = await LocalAuthService.hashPassword(password);
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sona-hod-bootstrap'))`);
    const priorAdmin = await tx
      .select({ id: staffCredentials.staffId })
      .from(staffCredentials)
      .innerJoin(staffRoles, eq(staffRoles.staffId, staffCredentials.staffId))
      .innerJoin(roles, eq(roles.id, staffRoles.roleId))
      .where(sql`${roles.name} in ('ADMIN', 'HOD')`)
      .limit(1);
    if (priorAdmin.length > 0) throw new Error('HOD bootstrap is already complete.');

    let hodRole = (await tx.select().from(roles).where(eq(roles.name, 'HOD')))[0];
    if (!hodRole) {
      [hodRole] = await tx.insert(roles).values({ name: 'HOD', description: 'Head of Department administrator' }).returning();
    }
    const [admin] = await tx.insert(staff).values({
      staffCode,
      name,
      collegeEmail: email,
      status: 'ACTIVE',
    }).returning({ id: staff.id });
    await tx.insert(staffRoles).values({ staffId: admin.id, roleId: hodRole.id });
    await tx.insert(staffCredentials).values({ staffId: admin.id, passwordHash: hashedPassword });
    return admin;
  });

  await new AuditService().log({
    actorId: created.id,
    actorName: name,
    actorRole: 'HOD',
    action: 'BOOTSTRAP_HOD',
    entityType: 'STAFF',
    entityId: created.id,
    description: 'Initial HOD account created using the one-time bootstrap procedure.',
  });
  console.log('Initial HOD account created.');
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/bootstrap-admin.ts');
if (isDirectRun) {
  main()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'HOD setup failed.';
      console.error(message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.end();
    });
}
