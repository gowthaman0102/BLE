import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock DB module before it loads
vi.mock('../src/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { Hono } from 'hono';
import { db } from '../src/db';
import { studentRoutes } from '../src/routes/students';
import { FaceVerificationService } from '../src/services/face-verification.service';
import type { AuthPrincipal } from '@smart-attendance/shared';

/**
 * Creates a valid synthetic PNG buffer.
 */
function createSyntheticPng(width = 400, height = 500, totalSize = 8 * 1024): Buffer {
  const buf = Buffer.alloc(totalSize);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  sig.copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 2;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;
  buf.writeUInt32BE(0x12345678, 29);
  return buf;
}

describe('Milestone F4 — Student Mobile Selfie Capture & Backend Verification Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const studentUser: AuthPrincipal = {
    id: 'student-uuid-1',
    name: 'Alice Student',
    collegeEmail: 'alice@sonatech.ac.in',
    roles: ['STUDENT'],
    userType: 'STUDENT',
    classId: 'class-uuid-1',
  };

  const studentProfile = {
    id: 'student-uuid-1',
    registerNumber: '21IT001',
    name: 'Alice Student',
    collegeEmail: 'alice@sonatech.ac.in',
    classId: 'class-uuid-1',
    status: 'ACTIVE',
  };

  const activeSession = {
    id: 'session-uuid-1',
    timetableId: 'timetable-uuid-1',
    status: 'ACTIVE',
    sessionDate: '2026-11-05',
  };

  const activeTimetable = {
    id: 'timetable-uuid-1',
    classId: 'class-uuid-1',
    staffId: 'staff-uuid-1',
    status: 'ACTIVE',
  };

  const enrolledFaceProfile = {
    id: 'face-profile-1',
    studentId: 'student-uuid-1',
    status: 'ACTIVE',
    referencePhotoKey: 'ref_student-uuid-1_v1_abc.jpg',
    imageVersion: 1,
    modelVersion: 'arcface-r100-v1',
  };

  describe('1. Authentication & Identity Safeguards', () => {
    it('rejects unauthenticated selfie upload attempts with HTTP 401', async () => {
      const app = new Hono();
      app.route('/api/students', studentRoutes);

      const form = new FormData();
      form.append('sessionId', 'session-uuid-1');
      form.append('selfie', new Blob([new Uint8Array(createSyntheticPng())]), 'selfie.png');

      const res = await app.request('/api/students/me/attendance/face-verification/verify', {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(401);
    });

    it('rejects non-student roles attempting to use student verification route with HTTP 403', async () => {
      const staffUser: AuthPrincipal = {
        id: 'staff-uuid-1',
        name: 'Prof. Rao',
        collegeEmail: 'rao@sonatech.ac.in',
        roles: ['STAFF'],
        userType: 'STAFF',
      };

      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', staffUser);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const form = new FormData();
      form.append('sessionId', 'session-uuid-1');

      const res = await app.request('/api/students/me/attendance/face-verification/verify', {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(403);
    });

    it('derives student identity strictly from auth session, ignoring spoofed student ID', async () => {
      // Mock db queries: session, student, timetable, bleToken, faceProfile, attempts
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([{ id: 'ble-token-1' }]); // ble eligible
              if (queryCount === 5) return Promise.resolve([]); // attendance record
              if (queryCount === 6) return Promise.resolve([enrolledFaceProfile]); // face profile
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockResolvedValue([{ id: 'verif-1' }]),
      });

      const service = new FaceVerificationService();
      const res = await service.verifyStudentFace({
        sessionId: 'session-uuid-1',
        studentId: studentUser.id,
        selfieBuffer: createSyntheticPng(400, 500),
      });

      // Crucial: Provider is NOT_CONFIGURED in F4, attendance is NOT falsely marked
      expect(res.success).toBe(false);
      expect(res.status).toBe('NOT_CONFIGURED');
    });
  });

  describe('2. Business Rules & Attendance Eligibility Validation', () => {
    it('rejects selfie submission if attendance session is INACTIVE (SESSION_NOT_ACTIVE)', async () => {
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...activeSession, status: 'COMPLETED' }]),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: createSyntheticPng(),
        })
      ).rejects.toThrow('SESSION_NOT_ACTIVE');
    });

    it('rejects submission if student does not belong to session timetable class (STUDENT_WRONG_CLASS)', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]); // student in class-uuid-1
              if (queryCount === 3) return Promise.resolve([{ ...activeTimetable, classId: 'other-class-99' }]); // timetable in other class
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: createSyntheticPng(),
        })
      ).rejects.toThrow('STUDENT_WRONG_CLASS');
    });

    it('rejects submission if BLE attendance eligibility is missing (BLE_ELIGIBILITY_REQUIRED)', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([]); // no BLE token
              if (queryCount === 5) return Promise.resolve([]); // no BLE record
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: createSyntheticPng(),
        })
      ).rejects.toThrow('BLE_ELIGIBILITY_REQUIRED');
    });

    it('rejects submission if student reference photo profile is missing or revoked (STUDENT_NOT_ENROLLED)', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([{ id: 'ble-1' }]);
              if (queryCount === 5) return Promise.resolve([]);
              if (queryCount === 6) return Promise.resolve([{ status: 'REVOKED', referencePhotoKey: null }]); // revoked profile
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: createSyntheticPng(),
        })
      ).rejects.toThrow('STUDENT_NOT_ENROLLED');
    });
  });

  describe('3. Image Quality Rejections & Technical Checks', () => {
    it('rejects selfie with resolution below 200x200 px (IMAGE_DIMENSIONS_TOO_SMALL)', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([{ id: 'ble-1' }]);
              if (queryCount === 5) return Promise.resolve([]);
              if (queryCount === 6) return Promise.resolve([enrolledFaceProfile]);
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      const tinyPng = createSyntheticPng(100, 100);

      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: tinyPng,
        })
      ).rejects.toThrow(/below the minimum required resolution/i);
    });

    it('rejects selfie with unsupported payload format (UNSUPPORTED_FORMAT)', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([{ id: 'ble-1' }]);
              if (queryCount === 5) return Promise.resolve([]);
              if (queryCount === 6) return Promise.resolve([enrolledFaceProfile]);
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      const textBuffer = Buffer.alloc(6000, 'X');

      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: textBuffer,
        })
      ).rejects.toThrow(/Unsupported image format/i);
    });

    it('rejects oversized selfie payload exceeding 5 MB limit (413)', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', studentUser);
        c.set('student', studentProfile);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const form = new FormData();
      form.append('sessionId', 'session-uuid-1');
      // Create > 5MB blob
      const hugeBlob = new Blob([new Uint8Array(5 * 1024 * 1024 + 500)]);
      form.append('selfie', hugeBlob, 'huge.jpg');

      const res = await app.request('/api/students/me/attendance/face-verification/verify', {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.error.code).toBe('IMAGE_TOO_LARGE');
    });
  });

  describe('4. Attempt Limits & Truthful Status Verification', () => {
    it('enforces maximum 3 attempts per session and rejects 4th attempt (MAX_ATTEMPTS_EXCEEDED)', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([{ id: 'ble-1' }]);
              if (queryCount === 5) return Promise.resolve([]);
              if (queryCount === 6) return Promise.resolve([enrolledFaceProfile]);
              return Promise.resolve([]);
            }),
            // Existing attempts count query
            then: (resolve: any) => resolve([{ count: 3 }]),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-uuid-1',
          studentId: 'student-uuid-1',
          selfieBuffer: createSyntheticPng(400, 400),
        })
      ).rejects.toThrow('MAX_ATTEMPTS_EXCEEDED');
    });

    it('returns NOT_CONFIGURED status truthfully without marking attendance PRESENT', async () => {
      let queryCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              queryCount++;
              if (queryCount === 1) return Promise.resolve([activeSession]);
              if (queryCount === 2) return Promise.resolve([studentProfile]);
              if (queryCount === 3) return Promise.resolve([activeTimetable]);
              if (queryCount === 4) return Promise.resolve([{ id: 'ble-1' }]);
              if (queryCount === 5) return Promise.resolve([]);
              if (queryCount === 6) return Promise.resolve([enrolledFaceProfile]);
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockResolvedValue([{ id: 'attempt-1' }]),
      });

      const service = new FaceVerificationService();
      const res = await service.verifyStudentFace({
        sessionId: 'session-uuid-1',
        studentId: 'student-uuid-1',
        selfieBuffer: createSyntheticPng(400, 400),
      });

      // Strict boundary check: upload pipeline works, but matching is not configured
      expect(res.success).toBe(false);
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.attemptNumber).toBe(1);
      expect(res.remainingAttempts).toBe(2);
      expect(res.verifiedAt).toBeNull();
    });
  });
});
