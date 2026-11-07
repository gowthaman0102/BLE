import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import type {
  ReferencePhotoStorageProvider,
  StoragePutOptions,
  StoragePutResult,
  StorageGetResult,
} from './storage-provider';

export class LocalReferencePhotoStorage implements ReferencePhotoStorageProvider {
  private readonly baseDir: string;

  constructor(customBaseDir?: string) {
    this.baseDir = path.resolve(
      customBaseDir ||
      process.env.REFERENCE_PHOTO_STORAGE_DIR ||
      path.join(process.cwd(), 'data', 'reference-photos')
    );
    this.ensureDirectoryExists();
  }

  /**
   * Returns the resolved base storage directory.
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Resolves and strictly validates a storage key to prevent directory traversal.
   */
  private resolveSafePath(key: string): string {
    if (!key || typeof key !== 'string') {
      throw new Error('STORAGE_KEY_INVALID: Key must be a non-empty string.');
    }

    // Reject suspicious characters, directory traversal tokens, and path separators
    if (
      key.includes('..') ||
      key.includes('/') ||
      key.includes('\\') ||
      key.includes('\0') ||
      !/^[a-zA-Z0-9_.-]+$/.test(key)
    ) {
      throw new Error('STORAGE_KEY_SECURITY_VIOLATION: Invalid storage key characters.');
    }

    const resolved = path.resolve(this.baseDir, key);
    const expectedPrefix = this.baseDir.endsWith(path.sep) ? this.baseDir : `${this.baseDir}${path.sep}`;

    if (!resolved.startsWith(expectedPrefix)) {
      throw new Error('STORAGE_PATH_TRAVERSAL_DETECTED: Target path escapes storage root.');
    }

    return resolved;
  }

  /**
   * Maps MIME types to safe, canonical file extensions.
   */
  private getExtensionForMime(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
      case 'image/jpg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/webp':
        return 'webp';
      default:
        throw new Error(`UNSUPPORTED_MIME_TYPE: ${mimeType}`);
    }
  }

  async savePhoto(options: StoragePutOptions): Promise<StoragePutResult> {
    const { studentId, version, buffer, mimeType } = options;

    if (!studentId || !buffer || buffer.length === 0) {
      throw new Error('STORAGE_INVALID_INPUT: studentId and non-empty buffer are required.');
    }

    this.ensureDirectoryExists();

    const ext = this.getExtensionForMime(mimeType);
    const sanitizedStudentId = studentId.replace(/[^a-zA-Z0-9_-]/g, '');
    const randomEntropy = crypto.randomBytes(16).toString('hex');
    const key = `ref_${sanitizedStudentId}_v${Math.max(1, version)}_${randomEntropy}.${ext}`;

    const filePath = this.resolveSafePath(key);

    // Compute SHA-256 checksum
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    // Write file with restricted permissions (0o600: read/write by owner only)
    await fs.promises.writeFile(filePath, buffer, { mode: 0o600 });

    return {
      key,
      sha256,
      size: buffer.length,
    };
  }

  async getPhoto(key: string, mimeType?: string): Promise<StorageGetResult | null> {
    const filePath = this.resolveSafePath(key);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stat = await fs.promises.stat(filePath);
    const buffer = await fs.promises.readFile(filePath);
    const stream = Readable.from(buffer);

    let resolvedMime = mimeType;
    if (!resolvedMime) {
      if (key.endsWith('.png')) resolvedMime = 'image/png';
      else if (key.endsWith('.webp')) resolvedMime = 'image/webp';
      else resolvedMime = 'image/jpeg';
    }

    return {
      stream,
      buffer,
      size: stat.size,
      mimeType: resolvedMime,
    };
  }

  async deletePhoto(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    return fs.existsSync(filePath);
  }
}
