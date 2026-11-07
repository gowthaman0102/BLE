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
import { FaceVerificationService } from '../src/services/face-verification.service';
import {
  NotConfiguredFaceMatchingProvider,
  FaceMatchingProvider,
  FaceMatchResult,
} from '../src/services/face-matching-provider';
import { AuditService } from '../src/services/audit.service';
import { studentRoutes } from '../src/routes/students';
import type { AuthPrincipal } from '@smart-attendance/shared';

describe('Milestone F2 — Face Verification Workflow Foundation Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Authentication & RBAC Access Control', () => {
    const student1Principal: AuthPrincipal = {
      id: 'student-uuid-1',
      name: 'Alice Student',
      collegeEmail: 'alice@sonatech.ac.in',
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: 'class-uuid-1',
    };

    const student2Principal: AuthPrincipal = {
      id: 'student-uuid-2',
      name: 'Bob Student',
      collegeEmail: 'bob@sonatech.ac.in',
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: 'class-uuid-1',
    };

    const staffPrincipal: AuthPrincipal = {
      id: 'staff-uuid-1',
      name: 'Regular Faculty',
      collegeEmail: 'faculty@sonatech.ac.in',
      roles: ['STAFF'],
      userType: 'STAFF',
    };

    const hodPrincipal: AuthPrincipal = {
      id: 'hod-uuid-1',
      name: 'Dr. IT HOD',
      collegeEmail: 'hod.it@sonatech.ac.in',
      roles: ['HOD'],
      userType: 'STAFF',
    };

    it('rejects cross-student face profile access with 403 Forbidden', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', student2Principal);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const res = await app.request('/api/students/student-uuid-1/face-profile');
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe('FORBIDDEN');
      expect(data.error.message).toContain('not authorized');
    });

    it('allows student to view their own face profile', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', student1Principal);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const res = await app.request('/api/students/student-uuid-1/face-profile');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.studentId).toBe('student-uuid-1');
      expect(data.data.status).toBe('NOT_ENROLLED');
    });

    it('rejects regular staff from viewing or mutating student face profiles (403)', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', staffPrincipal);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const getRes = await app.request('/api/students/student-uuid-1/face-profile');
      expect(getRes.status).toBe(403);

      const patchRes = await app.request('/api/students/student-uuid-1/face-profile/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      expect(patchRes.status).toBe(403);
    });

    it('allows HOD to inspect and update student face profile status', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() =>
              Promise.resolve([
                {
                  id: 'student-uuid-1',
                  name: 'Alice Student',
                  registerNumber: '2023IT001',
                  status: 'ACTIVE',
                },
              ])
            ),
          }),
        }),
      });

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              studentId: 'student-uuid-1',
              status: 'ACTIVE',
              enrolledAt: '2026-11-05T10:00:00.000Z',
              updatedAt: '2026-11-05T10:00:00.000Z',
            },
          ]),
        }),
      });

      (db.update as any) = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                studentId: 'student-uuid-1',
                status: 'ACTIVE',
                enrolledAt: '2026-11-05T10:00:00.000Z',
                updatedAt: '2026-11-05T10:00:00.000Z',
              },
            ]),
          }),
        }),
      });

      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', hodPrincipal);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const res = await app.request('/api/students/student-uuid-1/face-profile/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE', reason: 'Official ID verified by HOD' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('ACTIVE');
    });
  });

  describe('2. Provider Abstraction & Safe Defaults', () => {
    it('NotConfiguredFaceMatchingProvider returns isAvailable = false and safe failure response', async () => {
      const provider = new NotConfiguredFaceMatchingProvider();
      expect(await provider.isAvailable()).toBe(false);
      expect(provider.name).toBe('NOT_CONFIGURED');

      const result = await provider.verifyFace({
        studentId: 'test-student-id',
      });

      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('PROVIDER_NOT_CONFIGURED');
      expect(result.message).toContain('not configured');
    });
  });

  describe('3. Business Rules & Preconditions (FaceVerificationService)', () => {
    it('rejects verification if attendance session is not found', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'non-existent-session',
          studentId: 'student-1',
        })
      ).rejects.toThrow('SESSION_NOT_FOUND');
    });

    it('rejects verification if attendance session is not ACTIVE (e.g. COMPLETED)', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: 'session-1', status: 'COMPLETED' },
            ]),
          }),
        }),
      });

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-1',
          studentId: 'student-1',
        })
      ).rejects.toThrow('SESSION_NOT_ACTIVE');
    });

    it('rejects verification if student belongs to a different class', async () => {
      let callCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                // Session
                return Promise.resolve([{ id: 'session-1', status: 'ACTIVE', timetableId: 'tt-1' }]);
              }
              if (callCount === 2) {
                // Student
                return Promise.resolve([{ id: 'student-1', status: 'ACTIVE', classId: 'class-A' }]);
              }
              if (callCount === 3) {
                // Timetable
                return Promise.resolve([{ id: 'tt-1', classId: 'class-B' }]);
              }
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-1',
          studentId: 'student-1',
        })
      ).rejects.toThrow('STUDENT_WRONG_CLASS');
    });

    it('rejects verification if student lacks BLE attendance eligibility (no BLE beacon)', async () => {
      let callCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ id: 'session-1', status: 'ACTIVE', timetableId: 'tt-1' }]);
              if (callCount === 2) return Promise.resolve([{ id: 'student-1', status: 'ACTIVE', classId: 'class-A' }]);
              if (callCount === 3) return Promise.resolve([{ id: 'tt-1', classId: 'class-A' }]);
              // BLE token & attendance record return empty
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-1',
          studentId: 'student-1',
        })
      ).rejects.toThrow('BLE_ELIGIBILITY_REQUIRED');
    });

    it('rejects verification if student has no approved HOD-managed reference photo', async () => {
      let callCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ id: 'session-1', status: 'ACTIVE', timetableId: 'tt-1' }]);
              if (callCount === 2) return Promise.resolve([{ id: 'student-1', status: 'ACTIVE', classId: 'class-A' }]);
              if (callCount === 3) return Promise.resolve([{ id: 'tt-1', classId: 'class-A' }]);
              if (callCount === 4) return Promise.resolve([{ id: 'token-1', studentId: 'student-1' }]); // BLE present
              if (callCount === 5) return Promise.resolve([{ id: 'record-1', studentId: 'student-1' }]);
              // studentFaceProfiles return empty (not enrolled)
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-1',
          studentId: 'student-1',
        })
      ).rejects.toThrow('STUDENT_NOT_ENROLLED');
    });

    it('rejects verification if student has exceeded the 3-attempt limit', async () => {
      let callCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ id: 'session-1', status: 'ACTIVE', timetableId: 'tt-1' }]);
              if (callCount === 2) return Promise.resolve([{ id: 'student-1', status: 'ACTIVE', classId: 'class-A' }]);
              if (callCount === 3) return Promise.resolve([{ id: 'tt-1', classId: 'class-A' }]);
              if (callCount === 4) return Promise.resolve([{ id: 'token-1', studentId: 'student-1' }]);
              if (callCount === 5) return Promise.resolve([{ id: 'record-1', studentId: 'student-1' }]);
              if (callCount === 6) return Promise.resolve([{ studentId: 'student-1', status: 'ACTIVE', referencePhotoKey: 'ref_photo_1.jpg' }]);
              return Promise.resolve([]);
            }),
            // Count query returns 3
            then: vi.fn((cb) => cb([{ count: 3 }])),
          }),
        }),
      }));

      const service = new FaceVerificationService();
      await expect(
        service.verifyStudentFace({
          sessionId: 'session-1',
          studentId: 'student-1',
        })
      ).rejects.toThrow('MAX_ATTEMPTS_EXCEEDED');
    });

    it('returns NOT_CONFIGURED and DOES NOT mark attendance when matching engine is not configured', async () => {
      let callCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) return Promise.resolve([{ id: 'session-1', status: 'ACTIVE', timetableId: 'tt-1' }]);
              if (callCount === 2) return Promise.resolve([{ id: 'student-1', status: 'ACTIVE', classId: 'class-A' }]);
              if (callCount === 3) return Promise.resolve([{ id: 'tt-1', classId: 'class-A' }]);
              if (callCount === 4) return Promise.resolve([{ id: 'token-1', studentId: 'student-1' }]);
              if (callCount === 5) return Promise.resolve([{ id: 'record-1', studentId: 'student-1' }]);
              if (callCount === 6) return Promise.resolve([{ studentId: 'student-1', status: 'ACTIVE', referencePhotoKey: 'ref_photo_1.jpg' }]);
              return Promise.resolve([]);
            }),
            then: vi.fn((cb) => cb([{ count: 0 }])),
          }),
        }),
      }));

      const insertSpy = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
      (db.insert as any) = insertSpy;

      const updateSpy = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
      (db.update as any) = updateSpy;

      const service = new FaceVerificationService();
      const res = await service.verifyStudentFace({
        sessionId: 'session-1',
        studentId: 'student-1',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.attemptNumber).toBe(1);
      expect(res.remainingAttempts).toBe(2);

      // Verify attendance record update was NEVER called
      expect(updateSpy).not.toHaveBeenCalled();
      // Verify verification attempt was recorded in database
      expect(insertSpy).toHaveBeenCalled();
    });
  });

  describe('4. Audit Logging & Biometric Data Redaction', () => {
    it('redacts faceEmbedding, selfie, photo, and raw biometric keys from audit logs', async () => {
      const insertSpy = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
      (db.insert as any) = insertSpy;

      const auditService = new AuditService();
      await auditService.log({
        actorId: 'hod-1',
        actorName: 'Dr. HOD',
        actorRole: 'HOD',
        action: 'FACE_PROFILE_UPDATE',
        entityType: 'STUDENT_FACE_PROFILE',
        entityId: 'student-1',
        description: 'Enrolling face photo',
        oldValues: {
          faceEmbedding: [0.12, 0.44, 0.99],
          photo: 'binary_data_here',
        },
        newValues: {
          selfie: 'data:image/jpeg;base64,raw_bytes',
          selfieBase64: 'base64_string',
          embedding: [0.55, 0.66],
          status: 'ACTIVE',
        },
      });

      expect(insertSpy).toHaveBeenCalled();
      const insertCall = insertSpy.mock.results[0].value.values.mock.calls[0][0];

      expect(insertCall.oldValues.faceEmbedding).toBe('[REDACTED]');
      expect(insertCall.oldValues.photo).toBe('[REDACTED]');
      expect(insertCall.newValues.selfie).toBe('[REDACTED]');
      expect(insertCall.newValues.selfieBase64).toBe('[REDACTED]');
      expect(insertCall.newValues.embedding).toBe('[REDACTED]');
      expect(insertCall.newValues.status).toBe('ACTIVE');
    });
  });
});
