import { describe, expect, it, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  OpenCvChallengeLivenessProvider,
  NotConfiguredLivenessProvider,
} from '../src/services/liveness-provider';

describe('Milestone F6 — Biometric Anti-Spoofing & Liveness Engine (OpenCV YuNet + SFace)', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const baseSelfiePath = path.join(fixturesDir, 'face_subject_a_selfie.jpg');
  const turnLeftPath = path.join(fixturesDir, 'face_subject_a_turn_left.jpg');
  const turnRightPath = path.join(fixturesDir, 'face_subject_a_turn_right.jpg');
  const blinkPath = path.join(fixturesDir, 'face_subject_a_blink.jpg');
  const refPath = path.join(fixturesDir, 'face_subject_a_ref.jpg');
  const subjectBSelfiePath = path.join(fixturesDir, 'face_subject_b_selfie.jpg');
  const noFacePath = path.join(fixturesDir, 'face_no_face.jpg');
  const multiFacePath = path.join(fixturesDir, 'face_multi_face.jpg');

  let provider: OpenCvChallengeLivenessProvider;

  beforeAll(() => {
    provider = new OpenCvChallengeLivenessProvider({
      defaultThreshold: 0.40,
      minConfidence: 0.60,
    });
  });

  describe('1. Genuine Live Human Challenge Verification', () => {
    it('verifies live subject performing TURN_HEAD_LEFT challenge with reference photo match', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath);
      const actionBuf = fs.readFileSync(turnLeftPath);
      const refBuf = fs.readFileSync(refPath);

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: baseBuf,
        actionBuffer: actionBuf,
        referencePhotoBuffer: refBuf,
        threshold: 0.40,
      });

      expect(result.success).toBe(true);
      expect(result.livenessResult).toBe('LIVE');
      expect(result.similarity).toBeGreaterThanOrEqual(0.40);
      expect(result.continuitySimilarity).toBeGreaterThanOrEqual(0.70);
      expect(result.livenessScore).toBeGreaterThanOrEqual(0.80);
      expect(result.actionDetails?.verified).toBe(true);
      expect(result.actionDetails?.expected).toBe('TURN_HEAD_LEFT');
      expect(result.actionDetails?.deltaYaw).toBeGreaterThanOrEqual(0.06);
    });

    it('verifies live subject performing TURN_HEAD_RIGHT challenge', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath);
      const actionBuf = fs.readFileSync(turnRightPath);
      const refBuf = fs.readFileSync(refPath);

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_RIGHT',
        baseBuffer: baseBuf,
        actionBuffer: actionBuf,
        referencePhotoBuffer: refBuf,
        threshold: 0.40,
      });

      expect(result.success).toBe(true);
      expect(result.livenessResult).toBe('LIVE');
      expect(result.actionDetails?.verified).toBe(true);
      expect(result.actionDetails?.expected).toBe('TURN_HEAD_RIGHT');
      expect(result.actionDetails?.deltaYaw).toBeLessThanOrEqual(-0.06);
    });

    it('verifies live subject performing BLINK challenge', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath);
      const actionBuf = fs.readFileSync(blinkPath);
      const refBuf = fs.readFileSync(refPath);

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'BLINK',
        baseBuffer: baseBuf,
        actionBuffer: actionBuf,
        referencePhotoBuffer: refBuf,
        threshold: 0.40,
      });

      expect(result.success).toBe(true);
      expect(result.livenessResult).toBe('LIVE');
      expect(result.actionDetails?.verified).toBe(true);
      expect(result.actionDetails?.expected).toBe('BLINK');
      expect(result.actionDetails?.eyeMse).toBeGreaterThanOrEqual(15.0);
    });
  });

  describe('2. Anti-Spoofing Attack Rejection (Presentation Attack Detection)', () => {
    it('detects and rejects printed photo / still replay attack (identical frames)', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath);
      const refBuf = fs.readFileSync(refPath);

      // Attacker submits the identical still photo for both frames
      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: baseBuf,
        actionBuffer: baseBuf, // Same image
        referencePhotoBuffer: refBuf,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.failureReason).toBe('STATIC_IMAGE_DETECTED');
      expect(result.message).toContain('Static photo detected');
    });

    it('detects and rejects challenge mismatch (wrong head turn direction)', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath);
      const turnRightBuf = fs.readFileSync(turnRightPath);
      const refBuf = fs.readFileSync(refPath);

      // Server challenged TURN_HEAD_LEFT, but user turned head right
      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: baseBuf,
        actionBuffer: turnRightBuf,
        referencePhotoBuffer: refBuf,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.failureReason).toBe('CHALLENGE_MISMATCH');
      expect(result.actionDetails?.verified).toBe(false);
      expect(result.message).toContain('TURN_HEAD_LEFT');
    });

    it('detects and rejects accomplice / identity swap attack between frames', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath); // Subject A
      const actionBuf = fs.readFileSync(subjectBSelfiePath); // Subject B (different person)
      const refBuf = fs.readFileSync(refPath);

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: baseBuf,
        actionBuffer: actionBuf,
        referencePhotoBuffer: refBuf,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.failureReason).toBe('IDENTITY_CONTINUITY_FAILED');
      expect(result.continuitySimilarity).toBeLessThan(0.70);
      expect(result.message).toContain('Identity continuity failed');
    });

    it('rejects verification when face does not match college reference photo', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath); // Subject A
      const actionBuf = fs.readFileSync(turnLeftPath); // Subject A turning left (genuine liveness)
      const refBBuf = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_ref.jpg')); // But reference photo is Subject B!

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: baseBuf,
        actionBuffer: actionBuf,
        referencePhotoBuffer: refBBuf,
        threshold: 0.40,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('LIVE'); // Liveness itself passed
      expect(result.failureReason).toBe('FACE_MISMATCH'); // But biometric match failed
      expect(result.similarity).toBeLessThan(0.40);
    });

    it('rejects when no face is detected in base frame', async () => {
      const noFaceBuf = fs.readFileSync(noFacePath);
      const actionBuf = fs.readFileSync(turnLeftPath);

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: noFaceBuf,
        actionBuffer: actionBuf,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.failureReason).toBe('NO_FACE_DETECTED');
    });

    it('rejects when multiple faces are detected in challenge response', async () => {
      const baseBuf = fs.readFileSync(baseSelfiePath);
      const multiFaceBuf = fs.readFileSync(multiFacePath);

      const result = await provider.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
        baseBuffer: baseBuf,
        actionBuffer: multiFaceBuf,
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('SPOOF');
      expect(result.failureReason).toBe('MULTIPLE_FACES_DETECTED');
    });
  });

  describe('3. Fallback & Safety Guarantees', () => {
    it('NotConfiguredLivenessProvider safely returns unconfigured without fabricating success', async () => {
      const notConfigured = new NotConfiguredLivenessProvider();
      const result = await notConfigured.verifyLiveness({
        studentId: 'student-1',
        challengeType: 'TURN_HEAD_LEFT',
      });

      expect(result.success).toBe(false);
      expect(result.livenessResult).toBe('INCONCLUSIVE');
      expect(result.failureReason).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });
});
