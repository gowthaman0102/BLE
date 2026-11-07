import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import type {
  LivenessChallengeType,
  LivenessResult,
  LivenessFailureReason,
} from '@smart-attendance/shared';

export interface FaceLivenessVerificationRequest {
  studentId: string;
  challengeType: LivenessChallengeType;
  baseBuffer?: Buffer;
  baseBase64?: string;
  actionBuffer?: Buffer;
  actionBase64?: string;
  referencePhotoBuffer?: Buffer;
  referenceEmbedding?: number[];
  threshold?: number;
}

export interface FaceLivenessVerificationResult {
  success: boolean;
  livenessResult: LivenessResult;
  livenessScore?: number;
  similarity?: number;
  threshold?: number;
  continuitySimilarity?: number;
  sharpness?: number;
  actionDetails?: any;
  failureReason?: LivenessFailureReason;
  message: string;
  inferenceTimeMs?: number;
}

export interface FaceLivenessProvider {
  readonly name: string;
  verifyLiveness(request: FaceLivenessVerificationRequest): Promise<FaceLivenessVerificationResult>;
}

export class NotConfiguredLivenessProvider implements FaceLivenessProvider {
  readonly name = 'NOT_CONFIGURED';

  async verifyLiveness(request: FaceLivenessVerificationRequest): Promise<FaceLivenessVerificationResult> {
    return {
      success: false,
      livenessResult: 'INCONCLUSIVE',
      failureReason: 'PROVIDER_NOT_CONFIGURED',
      message: 'Face liveness and anti-spoofing provider is not configured on this server.',
    };
  }
}

export interface OpenCvLivenessProviderOptions {
  pythonPath?: string;
  inferScriptPath?: string;
  modelsDir?: string;
  defaultThreshold?: number;
  minConfidence?: number;
  timeoutMs?: number;
}

export class OpenCvChallengeLivenessProvider implements FaceLivenessProvider {
  readonly name = 'OPENCV_CHALLENGE_PAD';
  private pythonPath: string;
  private inferScriptPath: string;
  private modelsDir: string;
  private defaultThreshold: number;
  private minConfidence: number;
  private timeoutMs: number;

  constructor(options?: OpenCvLivenessProviderOptions) {
    this.pythonPath = options?.pythonPath || process.env.PYTHON_PATH || 'python';
    this.inferScriptPath =
      options?.inferScriptPath ||
      path.resolve(__dirname, 'face-engine', 'infer.py');
    this.modelsDir =
      options?.modelsDir ||
      path.resolve(__dirname, '..', '..', 'models');
    this.defaultThreshold = options?.defaultThreshold ?? 0.40;
    this.minConfidence = options?.minConfidence ?? 0.60;
    this.timeoutMs = options?.timeoutMs ?? 15000;
  }

  async verifyLiveness(request: FaceLivenessVerificationRequest): Promise<FaceLivenessVerificationResult> {
    const tempFilesToClean: string[] = [];

    try {
      let basePath: string | undefined;
      let baseBase64: string | undefined = request.baseBase64;
      if (request.baseBuffer) {
        basePath = path.join(os.tmpdir(), `liveness_base_${crypto.randomUUID()}.jpg`);
        await fs.promises.writeFile(basePath, request.baseBuffer);
        tempFilesToClean.push(basePath);
      }

      let actionPath: string | undefined;
      let actionBase64: string | undefined = request.actionBase64;
      if (request.actionBuffer) {
        actionPath = path.join(os.tmpdir(), `liveness_action_${crypto.randomUUID()}.jpg`);
        await fs.promises.writeFile(actionPath, request.actionBuffer);
        tempFilesToClean.push(actionPath);
      }

      let refPath: string | undefined;
      if (request.referencePhotoBuffer && !request.referenceEmbedding) {
        refPath = path.join(os.tmpdir(), `liveness_ref_${crypto.randomUUID()}.jpg`);
        await fs.promises.writeFile(refPath, request.referencePhotoBuffer);
        tempFilesToClean.push(refPath);
      }

      const payload = {
        basePath,
        baseBase64,
        actionPath,
        actionBase64,
        challengeType: request.challengeType,
        refPath,
        refEmbedding: request.referenceEmbedding,
        threshold: request.threshold ?? this.defaultThreshold,
      };

      const result = await this.invokePython(payload);
      return result;
    } catch (err: any) {
      return {
        success: false,
        livenessResult: 'INCONCLUSIVE',
        failureReason: 'POOR_QUALITY',
        message: err?.message || 'Liveness verification execution failed.',
      };
    } finally {
      for (const tempPath of tempFilesToClean) {
        try {
          if (fs.existsSync(tempPath)) {
            await fs.promises.unlink(tempPath);
          }
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  private invokePython(payload: any): Promise<FaceLivenessVerificationResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.pythonPath,
        [
          this.inferScriptPath,
          'liveness',
          '--models-dir',
          this.modelsDir,
          '--min-confidence',
          String(this.minConfidence),
          '--threshold',
          String(this.defaultThreshold),
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try {
            child.kill();
          } catch {}
          reject(new Error(`Liveness inference process timed out after ${this.timeoutMs}ms.`));
        }
      }, this.timeoutMs);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.stdin.on('error', () => {});

      child.on('close', (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);

        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`Inference engine exited with code ${code}: ${stderr.trim()}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (e: any) {
          reject(new Error(`Failed to parse inference output: ${stdout.trim() || stderr.trim()}`));
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }
}
