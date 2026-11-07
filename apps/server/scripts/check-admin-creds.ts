import { db } from '../src/db';
import { staffCredentials } from '../src/db/schema/auth';
import { staff } from '../src/db/schema/staff';
import { eq } from 'drizzle-orm';
import { LocalAuthService } from '../src/services/local-auth.service';
import bcrypt from 'bcrypt';

async function checkAdminCreds() {
  const [adminStaff] = await db.select().from(staff).where(eq(staff.collegeEmail, 'admin@sonatech.ac.in'));
  if (adminStaff) {
    const [cred] = await db.select().from(staffCredentials).where(eq(staffCredentials.staffId, adminStaff.id));
    console.log('Admin staff found:', adminStaff.name, adminStaff.id);
    console.log('Admin credentials in DB:', cred ? 'Found passwordHash' : 'None');
    
    let is123456789012 = false;
    if (cred) {
      is123456789012 = await bcrypt.compare('123456789012', cred.passwordHash);
      console.log('Is 123456789012:', is123456789012);
    }
    
    if (!is123456789012) {
      const hash = await LocalAuthService.hashPassword('123456789012');
      if (cred) {
        await db.update(staffCredentials).set({ passwordHash: hash }).where(eq(staffCredentials.id, cred.id));
      } else {
        await db.insert(staffCredentials).values({
          staffId: adminStaff.id,
          passwordHash: hash,
        });
      }
      console.log('Successfully set admin@sonatech.ac.in password to 123456789012');
    }
  } else {
    console.log('Admin staff not found');
  }
  process.exit(0);
}

checkAdminCreds().catch(console.error);
