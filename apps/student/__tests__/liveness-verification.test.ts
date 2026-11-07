import { describe, expect, it, beforeEach, vi } from 'vitest';
import { attendanceService } from '../services/api/attendanceService';
import { apiClient } from '../services/api/client';
import { validateCapturedSelfie } from '../utils/imageQuality';

describe('Milestone F6 — Student Mobile Anti-Spoofing & Liveness Verification', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Active Challenge Request Integration', () => {
    it('requests an unpredictable active challenge for the session', async () => {
      const mockChallengeResponse = {
        success: true,
        data: {
          challengeId: 'c123e456-e89b-12d3-a456-426614174000',
          challengeType: 'TURN_HEAD_LEFT' as const,
          promptInstruction: 'Slowly turn your head to your LEFT and capture the second frame.',
          expiresAt: new Date(Date.now() + 90000).toISOString(),
          ttlSeconds: 90,
          sessionId: 'session-uuid-1',
        },
      };

      vi.spyOn(apiClient, 'post').mockResolvedValueOnce(mockChallengeResponse);

      const challenge = await attendanceService.requestLivenessChallenge('session-uuid-1');

      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/students/me/attendance/face-verification/liveness/challenge',
        { sessionId: 'session-uuid-1' }
      );
      expect(challenge.challengeId).toBe('c123e456-e89b-12d3-a456-426614174000');
      expect(challenge.challengeType).toBe('TURN_HEAD_LEFT');
      expect(challenge.promptInstruction).toContain('LEFT');
      expect(challenge.ttlSeconds).toBe(90);
    });

    it('propagates error when challenge request fails due to inactive session', async () => {
      vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('SESSION_NOT_ACTIVE'));

      await expect(
        attendanceService.requestLivenessChallenge('inactive-session-id')
      ).rejects.toThrow('SESSION_NOT_ACTIVE');
    });
  });

  describe('2. Dual-Frame Liveness Verification Submission', () => {
    it('submits base and action frames via multipart request with challenge ID', async () => {
      const mockVerifyResponse = {
        success: true,
        data: {
          success: true,
          status: 'VERIFIED' as const,
          livenessResult: 'LIVE' as const,
          livenessScore: 0.96,
          similarity: 0.88,
          message: 'Liveness and biometric identity verified successfully. Attendance marked PRESENT.',
          attemptNumber: 1,
          remainingAttempts: 2,
          verifiedAt: '2026-11-05T18:00:00Z',
        },
      };

      let submittedFormData: any = null;
      vi.spyOn(apiClient, 'postForm').mockImplementationOnce(async (url, formData) => {
        submittedFormData = formData;
        return mockVerifyResponse;
      });

      const result = await attendanceService.verifyLiveness({
        sessionId: 'session-uuid-1',
        challengeId: 'challenge-uuid-1',
        basePhoto: {
          uri: 'file:///cache/base.jpg',
          name: 'base.jpg',
          type: 'image/jpeg',
        },
        actionPhoto: {
          uri: 'file:///cache/action_turn_left.jpg',
          name: 'action_turn_left.jpg',
          type: 'image/jpeg',
        },
      });

      expect(apiClient.postForm).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.status).toBe('VERIFIED');
      expect(result.livenessResult).toBe('LIVE');
      expect(result.livenessScore).toBe(0.96);
      expect(result.verifiedAt).toBe('2026-11-05T18:00:00Z');
    });

    it('handles static photo detection failure gracefully', async () => {
      vi.spyOn(apiClient, 'postForm').mockResolvedValueOnce({
        success: false,
        data: {
          success: false,
          status: 'FAILED',
          livenessResult: 'SPOOF',
          failureReason: 'LIVENESS_FAILED',
          livenessFailureReason: 'STATIC_IMAGE_DETECTED',
          message: 'Static photo detected: no physical motion detected between capture frames.',
          attemptNumber: 1,
          remainingAttempts: 2,
          verifiedAt: null,
        },
      });

      const result = await attendanceService.verifyLiveness({
        sessionId: 'session-uuid-1',
        challengeId: 'challenge-uuid-1',
        basePhoto: { uri: 'file:///cache/photo.jpg' },
        actionPhoto: { uri: 'file:///cache/photo.jpg' },
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.livenessFailureReason).toBe('STATIC_IMAGE_DETECTED');
      expect(result.message).toContain('Static photo detected');
    });

    it('handles challenge mismatch (e.g. wrong direction) failure gracefully', async () => {
      vi.spyOn(apiClient, 'postForm').mockResolvedValueOnce({
        success: false,
        data: {
          success: false,
          status: 'FAILED',
          livenessResult: 'SPOOF',
          failureReason: 'LIVENESS_FAILED',
          livenessFailureReason: 'CHALLENGE_MISMATCH',
          message: "Challenge action 'TURN_HEAD_LEFT' was not performed correctly.",
          attemptNumber: 2,
          remainingAttempts: 1,
          verifiedAt: null,
        },
      });

      const result = await attendanceService.verifyLiveness({
        sessionId: 'session-uuid-1',
        challengeId: 'challenge-uuid-1',
        basePhoto: { uri: 'file:///cache/base.jpg' },
        actionPhoto: { uri: 'file:///cache/wrong_turn.jpg' },
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.livenessFailureReason).toBe('CHALLENGE_MISMATCH');
      expect(result.remainingAttempts).toBe(1);
    });

    it('handles network failure during verification upload gracefully', async () => {
      vi.spyOn(apiClient, 'postForm').mockRejectedValueOnce(new Error('Network request failed'));

      const result = await attendanceService.verifyLiveness({
        sessionId: 'session-uuid-1',
        challengeId: 'challenge-uuid-1',
        basePhoto: { uri: 'file:///cache/base.jpg' },
        actionPhoto: { uri: 'file:///cache/action.jpg' },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.message).toContain('Network request failed');
    });
  });

  describe('3. Multi-Frame Client Quality Enforcement', () => {
    it('validates compliant base frame and action frame dimensions', () => {
      const baseCheck = validateCapturedSelfie({
        uri: 'file:///cache/frame0.jpg',
        width: 1080,
        height: 1440,
        fileSize: 200 * 1024,
      });

      const actionCheck = validateCapturedSelfie({
        uri: 'file:///cache/frame1.jpg',
        width: 1080,
        height: 1440,
        fileSize: 195 * 1024,
      });

      expect(baseCheck.isValid).toBe(true);
      expect(actionCheck.isValid).toBe(true);
    });

    it('rejects action frame if below minimum resolution', () => {
      const actionCheck = validateCapturedSelfie({
        uri: 'file:///cache/frame1_tiny.jpg',
        width: 120,
        height: 120,
        fileSize: 10 * 1024,
      });

      expect(actionCheck.isValid).toBe(false);
      expect(actionCheck.errorCode).toBe('DIMENSIONS_TOO_SMALL');
    });
  });
});
