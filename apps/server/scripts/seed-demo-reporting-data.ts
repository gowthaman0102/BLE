import { db } from '../src/db';
import { staff } from '../src/db/schema/staff';
import { timetables } from '../src/db/schema/timetable';
import { classes } from '../src/db/schema/academic';
import { students } from '../src/db/schema/students';
import { attendanceSessions } from '../src/db/schema/attendance';
import { attendanceRecords, attendanceCorrections } from '../src/db/schema/attendance-records';
import { eq, and } from 'drizzle-orm';

async function seed() {
  console.log('Seeding demo data for S8 Professor Reporting...');

  const [hod] = await db.select().from(staff).where(eq(staff.collegeEmail, 'hod.it@sonatech.ac.in'));
  if (!hod) throw new Error('HOD staff not found');

  const [tt] = await db.select().from(timetables).where(eq(timetables.staffId, hod.id)).limit(1);
  if (!tt) throw new Error('Timetable entry for HOD not found');

  const classId = tt.classId;
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  console.log(`Target class: ${cls.name} (${classId})`);

  // Ensure we have active students in this class
  const existingStudents = await db.select().from(students).where(eq(students.classId, classId));
  let studentList = existingStudents;

  if (existingStudents.length < 3) {
    const demoStudents = [
      { name: 'Aarav Sharma', registerNumber: '61782324106001', collegeEmail: 'aarav.sharma@sonatech.ac.in' },
      { name: 'Divya Ramesh', registerNumber: '61782324106002', collegeEmail: 'divya.ramesh@sonatech.ac.in' },
      { name: 'Karthik Subramanian', registerNumber: '61782324106003', collegeEmail: 'karthik.subramanian@sonatech.ac.in' },
    ];

    for (const ds of demoStudents) {
      const [existing] = await db.select().from(students).where(eq(students.registerNumber, ds.registerNumber));
      if (!existing) {
        await db.insert(students).values({
          name: ds.name,
          registerNumber: ds.registerNumber,
          collegeEmail: ds.collegeEmail,
          classId,
          status: 'ACTIVE',
        });
      } else {
        await db.update(students).set({ classId, status: 'ACTIVE' }).where(eq(students.id, existing.id));
      }
    }

    studentList = await db.select().from(students).where(eq(students.classId, classId));
  }

  console.log(`Active students in ${cls.name}: ${studentList.length}`);

  // Create Completed Session 1 (2026-11-03)
  const date1 = '2026-11-03';
  let [session1] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, date1)));

  if (!session1) {
    [session1] = await db
      .insert(attendanceSessions)
      .values({
        timetableId: tt.id,
        sessionDate: date1,
        status: 'COMPLETED',
        startedByStaffId: hod.id,
        startedAt: `${date1}T09:00:00.000Z`,
        endedAt: `${date1}T09:50:00.000Z`,
      })
      .returning();
  }

  // Create Completed Session 2 (2026-11-04)
  const date2 = '2026-11-04';
  let [session2] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, date2)));

  if (!session2) {
    [session2] = await db
      .insert(attendanceSessions)
      .values({
        timetableId: tt.id,
        sessionDate: date2,
        status: 'COMPLETED',
        startedByStaffId: hod.id,
        startedAt: `${date2}T10:00:00.000Z`,
        endedAt: `${date2}T10:50:00.000Z`,
      })
      .returning();
  }

  // Create Cancelled Session (2026-11-02)
  const dateCancelled = '2026-11-02';
  let [sessionCancelled] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.timetableId, tt.id), eq(attendanceSessions.sessionDate, dateCancelled)));

  if (!sessionCancelled) {
    [sessionCancelled] = await db
      .insert(attendanceSessions)
      .values({
        timetableId: tt.id,
        sessionDate: dateCancelled,
        status: 'CANCELLED',
        cancellationReason: 'College Sports Day Holiday',
        startedByStaffId: hod.id,
      })
      .returning();
  }

  // Add attendance records for session 1
  for (let i = 0; i < studentList.length; i++) {
    const st = studentList[i];
    const status = i === 0 ? 'PRESENT' : i === 1 ? 'LATE' : 'PRESENT';
    const [existingRecord] = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.attendanceSessionId, session1.id), eq(attendanceRecords.studentId, st.id)));

    if (!existingRecord) {
      const [newRec] = await db
        .insert(attendanceRecords)
        .values({
          attendanceSessionId: session1.id,
          studentId: st.id,
          status,
          source: 'BLE',
          detectionCount: 3,
          firstDetectedAt: `${date1}T09:05:00.000Z`,
          lastDetectedAt: `${date1}T09:40:00.000Z`,
          markedAt: `${date1}T09:05:00.000Z`,
          markedBy: hod.id,
        })
        .returning();

      // For first student, also insert a persistent correction history entry
      if (i === 0) {
        const [existingCorr] = await db
          .select()
          .from(attendanceCorrections)
          .where(eq(attendanceCorrections.attendanceRecordId, newRec.id));

        if (!existingCorr) {
          await db.insert(attendanceCorrections).values({
            attendanceRecordId: newRec.id,
            previousStatus: 'ABSENT',
            newStatus: 'PRESENT',
            reason: 'Physical presence verified in lab; BLE scanner signal fluctuation',
            correctedBy: hod.id,
            createdAt: new Date(`${date1}T10:15:00.000Z`),
          });
        }
      }
    }
  }

  // Add attendance records for session 2
  for (let i = 0; i < studentList.length; i++) {
    const st = studentList[i];
    const status = i === 2 ? 'ABSENT' : 'PRESENT';
    const [existingRecord] = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.attendanceSessionId, session2.id), eq(attendanceRecords.studentId, st.id)));

    if (!existingRecord) {
      await db.insert(attendanceRecords).values({
        attendanceSessionId: session2.id,
        studentId: st.id,
        status,
        source: 'BLE',
        detectionCount: status === 'PRESENT' ? 4 : 0,
        markedAt: `${date2}T10:05:00.000Z`,
        markedBy: hod.id,
      });
    }
  }

  console.log('✅ Demo reporting data successfully seeded:');
  console.log(`- 2 Completed sessions (${date1}, ${date2})`);
  console.log(`- 1 Cancelled session (${dateCancelled}) with reason "College Sports Day Holiday"`);
  console.log(`- ${studentList.length} students enrolled`);
  console.log(`- 1 Persistent correction history audit record`);

  process.exit(0);
}

seed().catch((e) => {
  console.error('Error seeding demo reporting data:', e);
  process.exit(1);
});
