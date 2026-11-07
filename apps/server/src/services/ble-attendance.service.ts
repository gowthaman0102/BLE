import { BleTokenService } from './ble-token.service';
import { AttendanceRecordRepository } from '../repositories/attendance-record.repository';
import { AttendanceSessionRepository } from '../repositories/attendanceSession.repository';
import { StudentRepository } from '../repositories/student.repository';
import { TimetableRepository } from '../repositories/timetable.repository';
import { db } from '../db';
import { attendanceFaceVerifications } from '../db/schema/face-verification';
import { attendanceFallbackRequests } from '../db/schema/attendance-records';
import { eq } from 'drizzle-orm';
import type { RosterFaceStatus } from '@smart-attendance/shared';

export class BleAttendanceService {
  private tokenService = new BleTokenService();
  private recordRepo = new AttendanceRecordRepository();
  private sessionRepo = new AttendanceSessionRepository();
  private studentRepo = new StudentRepository();
  private timetableRepo = new TimetableRepository();

  async processDetections(sessionId: string, detections: { token: string, rssi: number, detectedAt: string }[]) {
    // 1. Validate session
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    
    // 2. Confirm session is ACTIVE
    if (session.status !== 'ACTIVE') throw new Error("SESSION_NOT_ACTIVE");

    // 6. Resolve session class from timetable
    const timetable = await this.timetableRepo.findById(session.timetableId);
    if (!timetable) throw new Error("TIMETABLE_NOT_FOUND");

    const classId = timetable.classId;

    let processed = 0;
    let accepted = 0;
    let rejected = 0;
    let duplicates = 0;

    for (const detection of detections) {
      processed++;
      try {
        // 3. Validate BLE token
        const tokenRecord = await this.tokenService.validateToken(detection.token, sessionId);
        
        // 4. Resolve student
        const student = await this.studentRepo.getStudentById(tokenRecord.studentId);
        if (!student) throw new Error("STUDENT_NOT_FOUND");

        // 5. Confirm student is ACTIVE
        if (student.status !== 'ACTIVE') throw new Error("STUDENT_INACTIVE");

        // 7. Confirm student belongs to session class
        if (student.classId !== classId) {
          throw new Error("STUDENT_WRONG_CLASS");
        }

        // 8. Check whether attendance already exists
        const existingRecord = await this.recordRepo.findBySessionAndStudent(sessionId, student.id);
        
        const detectionTime = detection.detectedAt || new Date().toISOString();

        if (existingRecord) {
          // 10. Update detection timestamps/count
          await this.recordRepo.update(existingRecord.id, {
            lastDetectedAt: detectionTime,
            detectionCount: existingRecord.detectionCount + 1
          });
          duplicates++;
        } else {
          // 9. Create attendance record
          await this.recordRepo.create({
            attendanceSessionId: sessionId,
            studentId: student.id,
            status: 'PRESENT',
            source: 'BLE',
            firstDetectedAt: detectionTime,
            lastDetectedAt: detectionTime,
            detectionCount: 1,
            markedAt: detectionTime,
          });
          accepted++;
        }
      } catch (error: any) {
        // 11. Ignore invalid detections safely
        console.error('[BLE Detection Debug]', error?.message || error);
        rejected++;
      }
    }

    return { processed, accepted, rejected, duplicates };
  }

  async startBleSession(sessionId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.status !== 'ACTIVE') throw new Error("SESSION_NOT_ACTIVE");

    const timetable = await this.timetableRepo.findById(session.timetableId);
    if (!timetable) throw new Error("TIMETABLE_NOT_FOUND");

    // Generate tokens for eligible students
    const tokens = await this.tokenService.generateTokensForSession(sessionId, timetable.classId);
    
    // In a real app, these tokens would be securely transmitted to student devices (e.g. via push notification, or they fetch it).
    // For MVP, we'll return them to the caller just to mock the scanner payload later.
    return { success: true, message: 'BLE Session started', tokens };
  }

  async stopBleSession(sessionId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    
    await this.tokenService.expireTokensForSession(sessionId);
    
    return { success: true, message: 'BLE Session stopped' };
  }

  async getLiveAttendance(sessionId: string) {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    
    const timetable = await this.timetableRepo.findById(session.timetableId);
    if (!timetable) throw new Error("TIMETABLE_NOT_FOUND");

    const students = await this.studentRepo.getStudentsByClass(timetable.classId);
    const activeStudents = students.filter((s: any) => s.status === 'ACTIVE');
    
    const records = await this.recordRepo.findAllBySession(sessionId);
    const recordMap = new Map(records.map(r => [r.studentId, r]));

    const faceVerifications = await db
      .select()
      .from(attendanceFaceVerifications)
      .where(eq(attendanceFaceVerifications.attendanceSessionId, sessionId));
    const faceMap = new Map(faceVerifications.map(f => [f.studentId, f]));

    const fallbackRequests = await db
      .select()
      .from(attendanceFallbackRequests)
      .where(eq(attendanceFallbackRequests.attendanceSessionId, sessionId));
    const fallbackMap = new Map(fallbackRequests.map(f => [f.studentId, f]));

    const roster = activeStudents.map((student: any) => {
      const record = recordMap.get(student.id);
      const faceVerif = faceMap.get(student.id);
      const fallbackReq = fallbackMap.get(student.id);

      let faceVerificationStatus: RosterFaceStatus = 'NOT_REQUIRED';
      if (record?.source === 'MANUAL') {
        faceVerificationStatus = 'MANUAL_CORRECTION';
      } else if (fallbackReq && fallbackReq.status === 'PENDING') {
        faceVerificationStatus = 'FALLBACK_PENDING';
      } else if (faceVerif?.status === 'VERIFIED') {
        faceVerificationStatus = 'VERIFIED';
      } else if (faceVerif?.status && String(faceVerif.status).startsWith('FAILED')) {
        faceVerificationStatus = 'FAILED';
      } else if (record) {
        faceVerificationStatus = 'PENDING';
      } else {
        faceVerificationStatus = 'NOT_REQUIRED';
      }

      return {
        recordId: record?.id || null,
        studentId: student.id,
        registerNumber: student.registerNumber,
        name: student.name,
        status: record ? record.status : 'NOT DETECTED',
        source: record?.source,
        faceVerificationStatus,
        fallbackRequest: fallbackReq ? {
          id: fallbackReq.id,
          reasonCategory: fallbackReq.reasonCategory as any,
          explanation: fallbackReq.explanation,
          status: fallbackReq.status as any,
          createdAt: new Date(fallbackReq.createdAt).toISOString(),
        } : null,
        firstDetectedAt: record?.firstDetectedAt,
        lastDetectedAt: record?.lastDetectedAt,
        detectionCount: record?.detectionCount || 0
      };
    });

    const totalStudents = activeStudents.length;
    const detectedStudents = records.filter(r => r.status === 'PRESENT').length;
    const notDetectedStudents = totalStudents - detectedStudents;
    const percentage = totalStudents > 0 ? Math.round((detectedStudents / totalStudents) * 100) : 0;

    return {
      sessionId,
      totalStudents,
      detectedStudents,
      notDetectedStudents,
      percentage,
      students: roster
    };
  }
}
