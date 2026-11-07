import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  OpenCvSFaceFaceMatchingProvider,
  NotConfiguredFaceMatchingProvider,
} from '../src/services/face-matching-provider';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Milestone F5 — Face Matching Provider Tests', () => {
  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const modelsDir = path.resolve(__dirname, '../models');

  let subjectARef: Buffer;
  let subjectASelfie: Buffer;
  let subjectBRef: Buffer;
  let subjectBSelfie: Buffer;
  let noFaceImg: Buffer;
  let multiFaceImg: Buffer;
  let corruptedImg: Buffer;

  beforeAll(() => {
    subjectARef = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_ref.jpg'));
    subjectASelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_a_selfie.jpg'));
    subjectBRef = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_ref.jpg'));
    subjectBSelfie = fs.readFileSync(path.join(fixturesDir, 'face_subject_b_selfie.jpg'));
    noFaceImg = fs.readFileSync(path.join(fixturesDir, 'face_no_face.jpg'));
    multiFaceImg = fs.readFileSync(path.join(fixturesDir, 'face_multi_face.jpg'));
    corruptedImg = fs.readFileSync(path.join(fixturesDir, 'face_corrupted.jpg'));
  });

  describe('NotConfiguredFaceMatchingProvider (Safe Default)', () => {
    it('reports availability as false', async () => {
      const provider = new NotConfiguredFaceMatchingProvider();
      expect(await provider.isAvailable()).toBe(false);
    });

    it('returns truthful NOT_CONFIGURED without fabricating a match', async () => {
      const provider = new NotConfiguredFaceMatchingProvider();
      const res = await provider.verifyFace({
        studentId: 'test-student-id',
        selfieBuffer: subjectASelfie,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('PROVIDER_NOT_CONFIGURED');
    });
  });

  describe('OpenCvSFaceFaceMatchingProvider (Genuine Biometric Inference)', () => {
    const provider = new OpenCvSFaceFaceMatchingProvider({
      modelsDir,
      defaultThreshold: 0.40,
      minConfidence: 0.60,
    });

    it('successfully confirms models and engine availability', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('extracts a valid 128-dimensional L2-normalized embedding from a reference photo', async () => {
      const res = await provider.extractEmbedding!(subjectARef);
      expect(res.success).toBe(true);
      expect(res.embedding).toBeDefined();
      expect(res.embedding?.length).toBe(128);
      expect(res.faceCount).toBe(1);

      // Verify L2 norm is ~1.0
      const norm = Math.sqrt(res.embedding!.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeGreaterThan(0.99);
      expect(norm).toBeLessThan(1.01);
    });

    it('verifies a genuine matching pair with high cosine similarity (Subject A ref vs selfie)', async () => {
      const res = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: subjectASelfie,
        threshold: 0.40,
      });

      expect(res.success).toBe(true);
      expect(res.confidenceScore).toBeGreaterThan(0.80);
      expect(res.distance).toBeDefined();
      expect(res.distance!).toBeLessThan(0.50);
      expect(res.biometricMethod).toBe('OPENCV_SFACE_COSINE');
      expect(res.executionTimeMs).toBeGreaterThan(0);
    });

    it('verifies match using a cached 128-d reference embedding (skipping reference decoding)', async () => {
      const ext = await provider.extractEmbedding!(subjectARef);
      expect(ext.success).toBe(true);

      const res = await provider.verifyFace({
        studentId: 'student-a',
        referenceEmbedding: ext.embedding,
        selfieBuffer: subjectASelfie,
        threshold: 0.40,
      });

      expect(res.success).toBe(true);
      expect(res.confidenceScore).toBeGreaterThan(0.80);
    });

    it('rejects an impostor mismatch with low cosine similarity (Subject A ref vs Subject B selfie)', async () => {
      const res = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: subjectBSelfie,
        threshold: 0.40,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('FACE_MISMATCH');
      expect(res.confidenceScore).toBeLessThan(0.30);
    });

    it('rejects selfie containing no detectable human face (NO_FACE_DETECTED)', async () => {
      const res = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: noFaceImg,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('NO_FACE_DETECTED');
      expect(res.faceCount).toBe(0);
    });

    it('rejects selfie containing multiple faces (MULTIPLE_FACES_DETECTED)', async () => {
      const res = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: multiFaceImg,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('MULTIPLE_FACES_DETECTED');
      expect(res.faceCount).toBe(2);
    });

    it('rejects corrupted image payloads gracefully without crashing', async () => {
      const res = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: corruptedImg,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('SELFIE_INVALID_IMAGE');
    });

    it('enforces configurable threshold boundaries strictly', async () => {
      // With strict threshold = 0.999 (should reject even genuine match if below 0.999)
      const strictRes = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: subjectASelfie,
        threshold: 0.999,
      });
      expect(strictRes.success).toBe(false);
      expect(strictRes.failureReason).toBe('FACE_MISMATCH');

      // With relaxed threshold = 0.05 (should accept genuine match)
      const relaxedRes = await provider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: subjectASelfie,
        threshold: 0.05,
      });
      expect(relaxedRes.success).toBe(true);
    });

    it('handles process timeout safely and returns INFERENCE_TIMEOUT', async () => {
      const timeoutProvider = new OpenCvSFaceFaceMatchingProvider({
        modelsDir,
        timeoutMs: 1, // 1 millisecond hard timeout
      });

      const res = await timeoutProvider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: subjectASelfie,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('INFERENCE_TIMEOUT');
    });

    it('fails safely when models directory is invalid (PROVIDER_UNAVAILABLE)', async () => {
      const invalidProvider = new OpenCvSFaceFaceMatchingProvider({
        modelsDir: path.resolve(__dirname, 'non_existent_models_dir'),
      });

      expect(await invalidProvider.isAvailable()).toBe(false);

      const res = await invalidProvider.verifyFace({
        studentId: 'student-a',
        referencePhotoBuffer: subjectARef,
        selfieBuffer: subjectASelfie,
      });

      expect(res.success).toBe(false);
      expect(res.failureReason).toBe('MODEL_INIT_FAILED');
    });
  });
});
