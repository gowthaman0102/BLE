/**
 * Face Matching Provider Abstraction
 * 
 * Provides an extensible interface for face verification matching engines.
 * Implementations include:
 * - NotConfiguredFaceMatchingProvider (safe default for early development/foundation)
 * - OpenCvSFaceFaceMatchingProvider (production-grade YuNet + SFace ONNX engine)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface FaceMatchInput {
  studentId: string;
  referencePhotoKey?: string | null;
  referencePhotoBuffer?: Buffer;
  referenceEmbedding?: number[];
  selfieBase64?: string;
  selfieBuffer?: Buffer;
  threshold?: number;
  clientMetadata?: Record<string, any>;
}

export interface FaceMatchResult {
  success: boolean;
  confidenceScore?: number;
  distance?: number;
  livenessScore?: number;
  failureReason?: string;
  faceCount?: number;
  message: string;
  biometricMethod?: string;
  executionTimeMs?: number;
}

export interface EmbeddingExtractResult {
  success: boolean;
  embedding?: number[];
  confidence?: number;
  faceCount?: number;
  failureReason?: string;
  message?: string;
}

export interface FaceMatchingProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  extractEmbedding?(imageBuffer: Buffer): Promise<EmbeddingExtractResult>;
  verifyFace(input: FaceMatchInput): Promise<FaceMatchResult>;
}

/**
 * Default safe provider when no biometric engine is configured.
 * Strictly avoids returning fake success.
 */
export class NotConfiguredFaceMatchingProvider implements FaceMatchingProvider {
  readonly name = 'NOT_CONFIGURED';

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async verifyFace(_input: FaceMatchInput): Promise<FaceMatchResult> {
    return {
      success: false,
      failureReason: 'PROVIDER_NOT_CONFIGURED',
      message: 'Face verification engine is not configured. Biometric matching is deferred to F3-F5.',
    };
  }
}

export interface OpenCvProviderOptions {
  pythonPath?: string;
  modelsDir?: string;
  engineScriptPath?: string;
  defaultThreshold?: number;
  minConfidence?: number;
  timeoutMs?: number;
}

/**
 * Concrete Face Matching Provider powered by OpenCV YuNet (detection) and SFace (128-d recognition).
 * Executes genuine deep learning biometric inference via the native engine runner.
 */
export class OpenCvSFaceFaceMatchingProvider implements FaceMatchingProvider {
  readonly name = 'OPENCV_SFACE';

  private pythonPath: string;
  private modelsDir: string;
  private engineScriptPath: string;
  private defaultThreshold: number;
  private minConfidence: number;
  private timeoutMs: number;
  private availabilityCache: { isAvailable: boolean; checkedAt: number } | null = null;

  constructor(options: OpenCvProviderOptions = {}) {
    this.pythonPath = options.pythonPath || process.env.PYTHON_PATH || 'python';
    this.modelsDir = options.modelsDir || path.resolve(__dirname, '../../../models');
    this.engineScriptPath = options.engineScriptPath || path.resolve(__dirname, 'face-engine/infer.py');
    this.defaultThreshold = options.defaultThreshold ?? 0.40;
    this.minConfidence = options.minConfidence ?? 0.60;
    this.timeoutMs = options.timeoutMs ?? 7000;
  }

  /**
   * Probes model files and tests engine initialization via ping.
   */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.availabilityCache && now - this.availabilityCache.checkedAt < 30000) {
      return this.availabilityCache.isAvailable;
    }

    try {
      if (!fs.existsSync(this.engineScriptPath)) {
        this.availabilityCache = { isAvailable: false, checkedAt: now };
        return false;
      }

      const res = await this.runProcess(['ping'], {});
      const available = res.success === true && res.status === 'READY';
      this.availabilityCache = { isAvailable: available, checkedAt: now };
      return available;
    } catch {
      this.availabilityCache = { isAvailable: false, checkedAt: now };
      return false;
    }
  }

  /**
   * Extracts a 128-dimensional L2-normalized biometric embedding from an enrolled image.
   * Enforces single-face policy (rejects 0 or multiple faces).
   */
  async extractEmbedding(imageBuffer: Buffer): Promise<EmbeddingExtractResult> {
    try {
      const payload = {
        base64: imageBuffer.toString('base64'),
      };

      const res = await this.runProcess(['extract'], payload);
      if (!res.success) {
        return {
          success: false,
          failureReason: res.errorCode || 'EXTRACTION_FAILED',
          message: res.message || 'Failed to extract face embedding.',
        };
      }

      return {
        success: true,
        embedding: res.embedding,
        confidence: res.confidence,
        faceCount: res.faceCount,
        message: 'Face embedding extracted successfully.',
      };
    } catch (error: any) {
      return {
        success: false,
        failureReason: error?.code || 'EXTRACTION_ERROR',
        message: error?.message || 'Error executing face embedding extraction.',
      };
    }
  }

  /**
   * Compares the student's live selfie against the enrolled reference photo (or cached embedding).
   */
  async verifyFace(input: FaceMatchInput): Promise<FaceMatchResult> {
    try {
      const payload: Record<string, any> = {
        threshold: input.threshold ?? this.defaultThreshold,
      };

      // 1. Reference: either cached 128-d embedding or raw image buffer
      if (input.referenceEmbedding && Array.isArray(input.referenceEmbedding) && input.referenceEmbedding.length === 128) {
        payload.refEmbedding = input.referenceEmbedding;
      } else if (input.referencePhotoBuffer) {
        payload.refBase64 = input.referencePhotoBuffer.toString('base64');
      } else {
        return {
          success: false,
          failureReason: 'REFERENCE_PHOTO_MISSING',
          message: 'No reference photo buffer or reference embedding provided for comparison.',
        };
      }

      // 2. Selfie: raw image buffer or base64
      if (input.selfieBuffer) {
        payload.selfieBase64 = input.selfieBuffer.toString('base64');
      } else if (input.selfieBase64) {
        payload.selfieBase64 = input.selfieBase64;
      } else {
        return {
          success: false,
          failureReason: 'SELFIE_MISSING',
          message: 'No selfie image buffer or payload provided.',
        };
      }

      const res = await this.runProcess(['verify'], payload);

      if (!res.success) {
        return {
          success: false,
          failureReason: res.errorCode || 'INFERENCE_FAILED',
          faceCount: res.selfieFaceCount ?? res.refFaceCount,
          message: res.message || 'Face verification failed during inference.',
        };
      }

      const isMatch = Boolean(res.matched);
      const similarity = typeof res.similarity === 'number' ? res.similarity : undefined;
      const distance = typeof res.distance === 'number' ? res.distance : undefined;

      return {
        success: isMatch,
        confidenceScore: similarity,
        distance,
        failureReason: isMatch ? undefined : 'FACE_MISMATCH',
        faceCount: res.selfieFaceCount ?? 1,
        biometricMethod: res.method || 'OPENCV_SFACE_COSINE',
        executionTimeMs: res.inferenceTimeMs,
        message: res.message || (isMatch ? 'Face verified successfully.' : 'Face mismatch.'),
      };
    } catch (error: any) {
      const reason = error?.code === 'ETIMEDOUT' ? 'INFERENCE_TIMEOUT' : (error?.code || 'PROVIDER_UNAVAILABLE');
      return {
        success: false,
        failureReason: reason,
        message: error?.message || 'Face verification engine encountered an unexpected error.',
      };
    }
  }

  /**
   * Spawns Python runner process, streams payload via stdin, and parses structured JSON output.
   */
  private runProcess(subcommand: string[], payload: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      const args = [
        this.engineScriptPath,
        ...subcommand,
        '--models-dir', this.modelsDir,
        '--min-confidence', String(this.minConfidence),
        '--threshold', String(this.defaultThreshold),
      ];

      const child = spawn(this.pythonPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdoutData = '';
      let stderrData = '';
      let isTimedOut = false;

      const timer = setTimeout(() => {
        isTimedOut = true;
        child.kill();
        const err: any = new Error(`Face engine timed out after ${this.timeoutMs}ms`);
        err.code = 'ETIMEDOUT';
        reject(err);
      }, this.timeoutMs);

      child.stdin.on('error', (_err) => {
        // Handled silently: process closed stdin early
      });

      child.stdout.on('data', (chunk) => {
        stdoutData += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString();
      });

      child.on('error', (err: any) => {
        clearTimeout(timer);
        if (!isTimedOut) {
          err.code = err.code || 'PROVIDER_UNAVAILABLE';
          reject(err);
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (isTimedOut) return;

        if (code !== 0 && !stdoutData.trim()) {
          const err: any = new Error(stderrData.trim() || `Face engine process exited with code ${code}`);
          err.code = 'INFERENCE_FAILED';
          return reject(err);
        }

        try {
          const parsed = JSON.parse(stdoutData.trim());
          resolve(parsed);
        } catch (parseErr) {
          const err: any = new Error(`Malformed JSON output from face engine: ${stdoutData.slice(0, 100)}`);
          err.code = 'INVALID_ENGINE_RESPONSE';
          reject(err);
        }
      });

      try {
        child.stdin.write(JSON.stringify(payload));
        child.stdin.end();
      } catch (writeErr) {
        clearTimeout(timer);
        reject(writeErr);
      }
    });
  }
}
