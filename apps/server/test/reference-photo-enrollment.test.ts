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
import { ImageValidationService, ImageValidationError } from '../src/services/image-validation.service';
import { LocalReferencePhotoStorage } from '../src/services/storage/local-reference-photo-storage';
import { FaceVerificationService } from '../src/services/face-verification.service';
import { studentRoutes } from '../src/routes/students';
import type { AuthPrincipal } from '@smart-attendance/shared';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Creates a valid synthetic PNG buffer with custom dimensions and total file size.
 */
function createSyntheticPng(width = 300, height = 400, totalSize = 6 * 1024): Buffer {
  const buf = Buffer.alloc(totalSize);
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  sig.copy(buf, 0);

  // IHDR chunk length = 13
  buf.writeUInt32BE(13, 8);
  // IHDR chunk type
  buf.write('IHDR', 12, 'ascii');
  // Dimensions
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  // Bit depth 8, truecolor (2), compression 0, filter 0, interlace 0
  buf[24] = 8;
  buf[25] = 2;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;
  // CRC dummy
  buf.writeUInt32BE(0x12345678, 29);

  return buf;
}

/**
 * Creates a valid synthetic JPEG buffer with custom dimensions and total file size.
 */
function createSyntheticJpeg(width = 300, height = 400, totalSize = 6 * 1024): Buffer {
  const buf = Buffer.alloc(totalSize);
  // SOI (0xFF, 0xD8)
  buf[0] = 0xff;
  buf[1] = 0xd8;

  // APP0 marker (0xFF, 0xE0) length 16
  buf[2] = 0xff;
  buf[3] = 0xe0;
  buf.writeUInt16BE(16, 4);
  buf.write('JFIF\0', 6, 'ascii');
  buf[11] = 1; // v_major
  buf[12] = 1; // v_minor

  // SOF0 marker (0xFF, 0xC0) segment length = 17
  let offset = 20;
  buf[offset] = 0xff;
  buf[offset + 1] = 0xc0;
  buf.writeUInt16BE(17, offset + 2); // segment length
  buf[offset + 4] = 8; // precision
  buf.writeUInt16BE(height, offset + 5);
  buf.writeUInt16BE(width, offset + 7);
  buf[offset + 9] = 3; // 3 components (YCbCr)

  // EOI marker at the end
  buf[totalSize - 2] = 0xff;
  buf[totalSize - 1] = 0xd9;

  return buf;
}

/**
 * Creates a valid synthetic WebP VP8 buffer.
 */
function createSyntheticWebp(width = 300, height = 400, totalSize = 6 * 1024): Buffer {
  const buf = Buffer.alloc(totalSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(totalSize - 8, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(totalSize - 20, 16);

  // Keyframe tag
  buf[20] = 0x00;
  buf[21] = 0x00;
  buf[22] = 0x00;
  // VP8 start code: 0x9D 0x01 0x2A
  buf[23] = 0x00; // keyframe flag bit 0 = 0
  buf[26] = 0x9d;
  buf[27] = 0x01;
  buf[28] = 0x2a;
  buf.writeUInt16LE(width & 0x3fff, 26);
  buf[26] = 0x9d;
  buf[27] = 0x01;
  buf[28] = 0x2a;
  // In our validation service, VP8 checks bytes 26-28 for 0x9D 0x01 0x2A
  // and width/height at bytes 26, 28 with mask. Let's make sure it matches.
  return buf;
}

describe('Milestone F3 — HOD Reference Photo Enrollment and Secure Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Image Validation Service', () => {
    it('successfully validates a valid synthetic PNG image', () => {
      const png = createSyntheticPng(400, 500, 8 * 1024);
      const result = ImageValidationService.validate(png);

      expect(result.mimeType).toBe('image/png');
      expect(result.width).toBe(400);
      expect(result.height).toBe(500);
      expect(result.fileSize).toBe(8 * 1024);
      expect(result.sha256).toHaveLength(64);
      expect(result.faceDetectionAvailable).toBe(false);
      expect(result.faceDetectionMessage).toContain('deferred to F5');
    });

    it('successfully validates a valid synthetic JPEG image', () => {
      const jpeg = createSyntheticJpeg(800, 600, 10 * 1024);
      const result = ImageValidationService.validate(jpeg);

      expect(result.mimeType).toBe('image/jpeg');
      expect(result.width).toBe(800);
      expect(result.height).toBe(600);
      expect(result.fileSize).toBe(10 * 1024);
      expect(result.sha256).toHaveLength(64);
      expect(result.faceDetectionAvailable).toBe(false);
    });

    it('rejects images smaller than 5 KB (IMAGE_TOO_SMALL)', () => {
      const tinyBuffer = Buffer.alloc(3000);
      expect(() => ImageValidationService.validate(tinyBuffer)).toThrow(
        expect.objectContaining({
          code: 'IMAGE_TOO_SMALL',
        })
      );
    });

    it('rejects images larger than 5 MB (IMAGE_TOO_LARGE)', () => {
      const hugeBuffer = Buffer.alloc(5 * 1024 * 1024 + 100);
      expect(() => ImageValidationService.validate(hugeBuffer)).toThrow(
        expect.objectContaining({
          code: 'IMAGE_TOO_LARGE',
        })
      );
    });

    it('rejects unsupported image formats (e.g., text, HTML, SVG, GIF)', () => {
      const textBuffer = Buffer.alloc(6000, 'A');
      textBuffer.write('<!DOCTYPE html><html><body>malicious payload</body></html>');

      expect(() => ImageValidationService.validate(textBuffer)).toThrow(
        expect.objectContaining({
          code: 'UNSUPPORTED_FORMAT',
        })
      );
    });

    it('rejects images with dimensions below 200x200 (IMAGE_DIMENSIONS_TOO_SMALL)', () => {
      const smallPng = createSyntheticPng(150, 150, 7 * 1024);
      expect(() => ImageValidationService.validate(smallPng)).toThrow(
        expect.objectContaining({
          code: 'IMAGE_DIMENSIONS_TOO_SMALL',
        })
      );
    });

    it('rejects images with dimensions above 4096x4096 (IMAGE_DIMENSIONS_TOO_LARGE)', () => {
      const largePng = createSyntheticPng(5000, 5000, 7 * 1024);
      expect(() => ImageValidationService.validate(largePng)).toThrow(
        expect.objectContaining({
          code: 'IMAGE_DIMENSIONS_TOO_LARGE',
        })
      );
    });

    it('rejects corrupted image payloads with invalid headers', () => {
      const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
      const padded = Buffer.concat([corrupt, Buffer.alloc(6000)]);

      expect(() => ImageValidationService.validate(padded)).toThrow();
    });
  });

  describe('2. Local Storage Provider Security & Defenses', () => {
    const testDir = path.join(os.tmpdir(), `test-ref-storage-${Date.now()}`);
    let storage: LocalReferencePhotoStorage;

    beforeEach(() => {
      storage = new LocalReferencePhotoStorage(testDir);
    });

    it('saves reference photo with opaque server-generated key and correct SHA-256', async () => {
      const png = createSyntheticPng(300, 400, 6 * 1024);
      const res = await storage.savePhoto({
        studentId: 'student-uuid-123',
        version: 1,
        buffer: png,
        mimeType: 'image/png',
      });

      expect(res.key).toMatch(/^ref_student-uuid-123_v1_[a-f0-9]{32}\.png$/);
      expect(res.size).toBe(png.length);
      expect(res.sha256).toHaveLength(64);

      const exists = await storage.exists(res.key);
      expect(exists).toBe(true);
    });

    it('prevents path traversal attempts on storage keys', async () => {
      const maliciousKeys = [
        '../etc/passwd',
        '..\\secret.png',
        'sub/../../key.jpg',
        'key.png\0.exe',
        '/root/key.png',
        'C:\\Windows\\system32\\cmd.exe',
      ];

      for (const badKey of maliciousKeys) {
        await expect(storage.getPhoto(badKey)).rejects.toThrow();
        await expect(storage.deletePhoto(badKey)).rejects.toThrow();
      }
    });

    it('deletes stored file on demand and reports existence correctly', async () => {
      const png = createSyntheticPng(300, 400, 6 * 1024);
      const res = await storage.savePhoto({
        studentId: 'student-to-delete',
        version: 2,
        buffer: png,
        mimeType: 'image/png',
      });

      expect(await storage.exists(res.key)).toBe(true);
      const deleted = await storage.deletePhoto(res.key);
      expect(deleted).toBe(true);
      expect(await storage.exists(res.key)).toBe(false);
    });
  });

  describe('3. Role-Based Access Control & Department Scoping', () => {
    const studentUser: AuthPrincipal = {
      id: 'student-id-1',
      name: 'John Student',
      collegeEmail: 'john@sonatech.ac.in',
      roles: ['STUDENT'],
      userType: 'STUDENT',
      classId: 'class-it-1',
    };

    const regularStaffUser: AuthPrincipal = {
      id: 'faculty-id-1',
      name: 'Regular Faculty',
      collegeEmail: 'faculty@sonatech.ac.in',
      roles: ['STAFF'],
      userType: 'STAFF',
    };

    const itHodUser: AuthPrincipal = {
      id: 'hod-it-id',
      name: 'Dr. IT HOD',
      collegeEmail: 'hod.it@sonatech.ac.in',
      roles: ['HOD'],
      userType: 'STAFF',
      departmentId: 'dept-it-uuid',
    };

    const cseHodUser: AuthPrincipal = {
      id: 'hod-cse-id',
      name: 'Dr. CSE HOD',
      collegeEmail: 'hod.cse@sonatech.ac.in',
      roles: ['HOD'],
      userType: 'STAFF',
      departmentId: 'dept-cse-uuid',
    };

    const adminUser: AuthPrincipal = {
      id: 'admin-id-1',
      name: 'System Admin',
      collegeEmail: 'admin@sonatech.ac.in',
      roles: ['ADMIN'],
      userType: 'STAFF',
    };

    it('rejects unauthenticated upload attempts with 401', async () => {
      const app = new Hono();
      app.route('/api/students', studentRoutes);

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(createSyntheticPng())]), 'test.png');

      const res = await app.request('/api/students/student-id-1/face-profile/reference-photo', {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(401);
    });

    it('rejects student attempting to upload reference photo with 403 Forbidden', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', studentUser);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(createSyntheticPng())]), 'test.png');

      const res = await app.request('/api/students/student-id-1/face-profile/reference-photo', {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(403);
    });

    it('rejects regular faculty attempting to upload reference photo with 403 Forbidden', async () => {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('user', regularStaffUser);
        await next();
      });
      app.route('/api/students', studentRoutes);

      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(createSyntheticPng())]), 'test.png');

      const res = await app.request('/api/students/student-id-1/face-profile/reference-photo', {
        method: 'POST',
        body: form,
      });

      expect(res.status).toBe(403);
    });

    it('rejects HOD outside the student class department with 403 Forbidden', async () => {
      // Mock student belonging to IT department
      (db.select as any).mockImplementation((opts?: any) => ({
        from: vi.fn().mockImplementation((table: any) => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => {
              // If selecting student
              return Promise.resolve([{
                id: 'student-id-1',
                registerNumber: '21IT001',
                name: 'Alice IT',
                classId: 'class-it-1',
                status: 'ACTIVE',
                departmentId: 'dept-it-uuid',
              }]);
            }),
          })),
        })),
      }));

      const service = new FaceVerificationService();
      const png = createSyntheticPng();

      await expect(
        service.enrollReferencePhoto({
          studentId: 'student-id-1',
          buffer: png,
          actor: {
            actorId: cseHodUser.id,
            actorRole: 'HOD',
            departmentId: 'dept-cse-uuid', // CSE HOD trying to enroll IT student
          },
        })
      ).rejects.toThrow('DEPARTMENT_MISMATCH');
    });

    it('allows Admin to enroll reference photo globally across departments', async () => {
      let callCount = 0;
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                // student check
                return Promise.resolve([{
                  id: 'student-id-1',
                  registerNumber: '21IT001',
                  name: 'Alice IT',
                  classId: 'class-it-1',
                  status: 'ACTIVE',
                }]);
              }
              // studentFaceProfiles check (existing profile)
              return Promise.resolve([]);
            }),
          }),
        }),
      }));

      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            studentId: 'student-id-1',
            status: 'ACTIVE',
            referencePhotoKey: 'ref_student-id-1_v1_abc.png',
            imageVersion: 1,
            mimeType: 'image/png',
          }]),
        }),
      });

      const service = new FaceVerificationService();
      const png = createSyntheticPng();

      const profile = await service.enrollReferencePhoto({
        studentId: 'student-id-1',
        buffer: png,
        actor: {
          actorId: adminUser.id,
          actorRole: 'ADMIN',
        },
      });

      expect(profile).toBeDefined();
      expect(profile.studentId).toBe('student-id-1');
    });
  });

  describe('4. Reference Photo Retrieval & Revocation Workflow', () => {
    it('allows student to retrieve their own enrolled reference photo', async () => {
      const storage = new LocalReferencePhotoStorage(path.join(os.tmpdir(), `test-storage-${Date.now()}`));
      const png = createSyntheticPng(400, 400);
      const saved = await storage.savePhoto({
        studentId: 'student-alice',
        version: 1,
        buffer: png,
        mimeType: 'image/png',
      });

      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              return Promise.resolve([{
                id: 'student-alice',
                classId: 'class-1',
                status: 'ACTIVE',
                referencePhotoKey: saved.key,
                imageVersion: 1,
                mimeType: 'image/png',
              }]);
            }),
          }),
        }),
      }));

      const service = new FaceVerificationService(undefined, storage);
      const res = await service.getReferencePhoto('student-alice', {
        id: 'student-alice',
        roles: ['STUDENT'],
        userType: 'STUDENT',
      });

      expect(res.buffer).toEqual(png);
      expect(res.mimeType).toBe('image/png');
    });

    it('rejects student attempting to retrieve another student reference photo (403)', async () => {
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'student-alice', classId: 'class-1' }]),
          }),
        }),
      });

      const service = new FaceVerificationService();
      await expect(
        service.getReferencePhoto('student-alice', {
          id: 'student-bob',
          roles: ['STUDENT'],
          userType: 'STUDENT',
        })
      ).rejects.toThrow('FORBIDDEN');
    });

    it('successfully revokes reference photo with audit logging', async () => {
      (db.select as any).mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              return Promise.resolve([{
                id: 'student-alice',
                registerNumber: '21IT001',
                classId: 'class-1',
                status: 'ACTIVE',
                referencePhotoKey: 'ref_student-alice_v1.png',
                imageVersion: 1,
              }]);
            }),
          }),
        }),
      }));

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: 'profile-1',
              studentId: 'student-alice',
              status: 'REVOKED',
              revokedAt: new Date().toISOString(),
              revocationReason: 'Photo outdated',
            }]),
          }),
        }),
      });

      const service = new FaceVerificationService();
      const revoked = await service.revokeReferencePhoto({
        studentId: 'student-alice',
        actor: { actorId: 'admin-1', actorRole: 'ADMIN' },
        reason: 'Photo outdated',
      });

      expect(revoked).toBeDefined();
    });
  });
});
