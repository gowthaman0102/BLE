import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  validateCapturedSelfie,
  SELFIE_LIMITS,
} from '../utils/imageQuality';
import { attendanceService } from '../services/api/attendanceService';
import { apiClient } from '../services/api/client';

describe('Milestone F4 — Student Mobile Selfie Capture & Quality Checks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // 1. Technical Image Quality Checks
  // ============================================================================
  describe('1. Technical Image Quality Checks (Client-Side)', () => {
    it('accepts a valid selfie with compliant format, dimensions, and size', () => {
      const result = validateCapturedSelfie({
        uri: 'file:///data/user/0/host.exp.exponent/cache/selfie.jpg',
        width: 800,
        height: 1000,
        fileSize: 150 * 1024, // 150 KB
        mimeType: 'image/jpeg',
      });

      expect(result.isValid).toBe(true);
      expect(result.errorCode).toBeUndefined();
    });

    it('rejects capture if URI is missing or empty', () => {
      const result = validateCapturedSelfie({
        uri: '',
        width: 800,
        height: 1000,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('MISSING_IMAGE_URI');
    });

    it('rejects unsupported image extensions (e.g. .gif, .pdf, .bmp, .txt)', () => {
      const result = validateCapturedSelfie({
        uri: 'file:///cache/animated-selfie.gif',
        width: 800,
        height: 800,
        fileSize: 50 * 1024,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('UNSUPPORTED_FORMAT');
    });

    it('rejects image files smaller than minimum threshold (< 5 KB)', () => {
      const result = validateCapturedSelfie({
        uri: 'file:///cache/tiny-stub.jpg',
        width: 800,
        height: 800,
        fileSize: 2 * 1024, // 2 KB
        mimeType: 'image/jpeg',
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('IMAGE_TOO_SMALL');
      expect(result.errorMessage).toContain('Minimum required is 5 KB');
    });

    it('rejects image files exceeding maximum size (> 5 MB)', () => {
      const result = validateCapturedSelfie({
        uri: 'file:///cache/huge-photo.jpg',
        width: 3000,
        height: 4000,
        fileSize: 6 * 1024 * 1024, // 6 MB
        mimeType: 'image/jpeg',
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('IMAGE_TOO_LARGE');
      expect(result.errorMessage).toContain('exceeds the 5 MB maximum limit');
    });

    it('rejects image dimensions below minimum required resolution (< 200x200 px)', () => {
      const result = validateCapturedSelfie({
        uri: 'file:///cache/low-res.jpg',
        width: 150,
        height: 150,
        fileSize: 20 * 1024,
        mimeType: 'image/jpeg',
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('DIMENSIONS_TOO_SMALL');
      expect(result.errorMessage).toContain('below the minimum required 200x200 px');
    });

    it('rejects image dimensions exceeding maximum allowed resolution (> 4096 px)', () => {
      const result = validateCapturedSelfie({
        uri: 'file:///cache/ultra-res.jpg',
        width: 5000,
        height: 5000,
        fileSize: 2 * 1024 * 1024,
        mimeType: 'image/jpeg',
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('DIMENSIONS_TOO_LARGE');
    });
  });

  // ============================================================================
  // 2. Selfie Upload Service Contract
  // ============================================================================
  describe('2. Selfie Upload & Service Integration', () => {
    it('submits selfie via multipart form-data to the authoritative endpoint', async () => {
      const postFormSpy = vi.spyOn(apiClient, 'postForm').mockResolvedValue({
        success: false,
        data: {
          success: false,
          status: 'NOT_CONFIGURED',
          message: 'Face verification engine is not configured. Biometric matching deferred to F5.',
          attemptNumber: 1,
          remainingAttempts: 2,
          verifiedAt: null,
        },
      });

      const res = await attendanceService.verifyFace('session-uuid-101', {
        uri: 'file:///cache/valid-selfie.jpg',
        name: 'selfie.jpg',
        type: 'image/jpeg',
      });

      expect(postFormSpy).toHaveBeenCalledTimes(1);
      const [endpoint, formData] = postFormSpy.mock.calls[0];

      expect(endpoint).toBe('/api/students/me/attendance/face-verification/verify');
      expect(formData).toBeInstanceOf(FormData);

      expect(res.success).toBe(false);
      expect(res.status).toBe('NOT_CONFIGURED');
      expect(res.remainingAttempts).toBe(2);
    });

    it('gracefully handles network failures during selfie upload', async () => {
      vi.spyOn(apiClient, 'postForm').mockRejectedValue(new Error('Network request failed'));

      const res = await attendanceService.verifyFace('session-uuid-101', {
        uri: 'file:///cache/valid-selfie.jpg',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('FAILED');
      expect(res.message).toContain('Network request failed');
    });
  });

  // ============================================================================
  // 3. Privacy & Biometric Boundary Assertions
  // ============================================================================
  describe('3. Privacy & Biometric Boundary Assertions', () => {
    it('guarantees limits are strictly configured', () => {
      expect(SELFIE_LIMITS.MIN_FILE_SIZE_BYTES).toBe(5120);
      expect(SELFIE_LIMITS.MAX_FILE_SIZE_BYTES).toBe(5242880);
      expect(SELFIE_LIMITS.MIN_DIMENSION_PX).toBe(200);
      expect(SELFIE_LIMITS.MAX_DIMENSION_PX).toBe(4096);
    });

    it('ensures no mock face recognition passes attendance in F4', async () => {
      vi.spyOn(apiClient, 'postForm').mockResolvedValue({
        success: false,
        data: {
          success: false,
          status: 'NOT_CONFIGURED',
          message: 'Face verification engine is not configured.',
          attemptNumber: 1,
          remainingAttempts: 2,
          verifiedAt: null,
        },
      });

      const res = await attendanceService.verifyFace('session-1', {
        uri: 'file:///selfie.jpg',
      });

      // Crucial Milestone F4 requirement: must NOT claim success
      expect(res.success).toBe(false);
      expect(res.status).not.toBe('VERIFIED');
    });
  });
});
