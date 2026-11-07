import crypto from 'crypto';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ImageValidationResult {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSize: number;
  width: number;
  height: number;
  sha256: string;
  faceDetectionAvailable: false;
  faceDetectionMessage: string;
}

export class ImageValidationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImageValidationError';
    this.code = code;
  }
}

export class ImageValidationService {
  public static readonly MIN_FILE_SIZE = 5 * 1024; // 5 KB
  public static readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  public static readonly MIN_DIMENSION = 200; // 200px
  public static readonly MAX_DIMENSION = 4096; // 4096px

  /**
   * Performs full validation on the uploaded reference photo buffer.
   * Inspects magic bytes, file size, dimensions, and computes SHA-256 hash.
   */
  public static validate(buffer: Buffer): ImageValidationResult {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new ImageValidationError('INVALID_IMAGE_PAYLOAD', 'Image payload must be a non-empty buffer.');
    }

    const fileSize = buffer.length;

    // 1. File size checks
    if (fileSize < this.MIN_FILE_SIZE) {
      throw new ImageValidationError(
        'IMAGE_TOO_SMALL',
        `Reference photo is too small (${(fileSize / 1024).toFixed(1)} KB). Minimum allowed size is 5 KB.`
      );
    }

    if (fileSize > this.MAX_FILE_SIZE) {
      throw new ImageValidationError(
        'IMAGE_TOO_LARGE',
        `Reference photo exceeds 5 MB limit (${(fileSize / (1024 * 1024)).toFixed(2)} MB).`
      );
    }

    // 2. Magic byte inspection
    const mimeType = this.detectMimeType(buffer);

    // 3. Extract dimensions
    const dimensions = this.extractDimensions(buffer, mimeType);

    // 4. Dimension bounds check
    if (dimensions.width < this.MIN_DIMENSION || dimensions.height < this.MIN_DIMENSION) {
      throw new ImageValidationError(
        'IMAGE_DIMENSIONS_TOO_SMALL',
        `Reference photo dimensions (${dimensions.width}x${dimensions.height}) are below the minimum required resolution of ${this.MIN_DIMENSION}x${this.MIN_DIMENSION} pixels.`
      );
    }

    if (dimensions.width > this.MAX_DIMENSION || dimensions.height > this.MAX_DIMENSION) {
      throw new ImageValidationError(
        'IMAGE_DIMENSIONS_TOO_LARGE',
        `Reference photo dimensions (${dimensions.width}x${dimensions.height}) exceed the maximum allowable resolution of ${this.MAX_DIMENSION}x${this.MAX_DIMENSION} pixels.`
      );
    }

    // 5. SHA-256 fingerprint
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      mimeType,
      fileSize,
      width: dimensions.width,
      height: dimensions.height,
      sha256,
      faceDetectionAvailable: false,
      faceDetectionMessage: 'Face detection is deferred to F5 and is currently unavailable.',
    };
  }

  /**
   * Detects MIME type by inspecting leading magic bytes.
   */
  public static detectMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (buffer.length < 12) {
      throw new ImageValidationError('CORRUPTED_IMAGE', 'Image data is corrupted or truncated.');
    }

    // JPEG: 0xFF, 0xD8, 0xFF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    // WebP: RIFF ... WEBP
    if (
      buffer[0] === 0x52 && // 'R'
      buffer[1] === 0x49 && // 'I'
      buffer[2] === 0x46 && // 'F'
      buffer[3] === 0x46 && // 'F'
      buffer[8] === 0x57 && // 'W'
      buffer[9] === 0x45 && // 'E'
      buffer[10] === 0x42 && // 'B'
      buffer[11] === 0x50 // 'P'
    ) {
      return 'image/webp';
    }

    throw new ImageValidationError(
      'UNSUPPORTED_FORMAT',
      'Unsupported image format. Approved formats are JPEG, PNG, and WebP.'
    );
  }

  /**
   * Parses image width and height directly from binary headers without external dependencies.
   */
  public static extractDimensions(
    buffer: Buffer,
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  ): ImageDimensions {
    try {
      if (mimeType === 'image/png') {
        return this.parsePngDimensions(buffer);
      } else if (mimeType === 'image/webp') {
        return this.parseWebpDimensions(buffer);
      } else {
        return this.parseJpegDimensions(buffer);
      }
    } catch (err: any) {
      if (err instanceof ImageValidationError) throw err;
      throw new ImageValidationError('CORRUPTED_IMAGE', `Could not parse image dimensions: ${err.message}`);
    }
  }

  private static parsePngDimensions(buffer: Buffer): ImageDimensions {
    if (buffer.length < 24) {
      throw new ImageValidationError('CORRUPTED_IMAGE', 'Truncated PNG file header.');
    }
    // PNG IHDR chunk data begins at byte 16
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    if (width <= 0 || height <= 0) {
      throw new ImageValidationError('CORRUPTED_IMAGE', 'Invalid PNG dimensions.');
    }

    return { width, height };
  }

  private static parseJpegDimensions(buffer: Buffer): ImageDimensions {
    let offset = 2; // skip SOI (0xFF, 0xD8)

    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        // Skip fill bytes or corrupted segment
        offset++;
        continue;
      }

      const marker = buffer[offset + 1];

      // End of Image or start of scan without SOF
      if (marker === 0xd9 || marker === 0xda) {
        break;
      }

      // Standalone markers without length
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }

      if (offset + 4 > buffer.length) {
        break;
      }

      const segmentLength = buffer.readUInt16BE(offset + 2);

      // Start of Frame markers containing image dimensions
      // SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2), SOF3 (0xC3),
      // SOF5 (0xC5), SOF6 (0xC6), SOF7 (0xC7),
      // SOF9 (0xC9), SOF10 (0xCA), SOF11 (0xCB),
      // SOF13 (0xCD), SOF14 (0xCE), SOF15 (0xCF)
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);

      if (isSof) {
        if (offset + 9 > buffer.length) {
          throw new ImageValidationError('CORRUPTED_IMAGE', 'Truncated JPEG SOF segment.');
        }

        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);

        if (width <= 0 || height <= 0) {
          throw new ImageValidationError('CORRUPTED_IMAGE', 'Invalid JPEG dimensions in SOF.');
        }

        return { width, height };
      }

      offset += 2 + segmentLength;
    }

    throw new ImageValidationError('CORRUPTED_IMAGE', 'No valid JPEG Start of Frame (SOF) marker found.');
  }

  private static parseWebpDimensions(buffer: Buffer): ImageDimensions {
    if (buffer.length < 30) {
      throw new ImageValidationError('CORRUPTED_IMAGE', 'Truncated WebP file.');
    }

    const chunkHeader = buffer.toString('ascii', 12, 16);

    // 1. Lossy WebP (VP8 )
    if (chunkHeader === 'VP8 ') {
      // Keyframe check at byte 23
      const keyframe = (buffer[23] & 1) === 0;
      if (!keyframe) {
        throw new ImageValidationError('CORRUPTED_IMAGE', 'WebP is not an intra keyframe.');
      }
      // Start code check: 0x9D 0x01 0x2A
      if (buffer[26] !== 0x9d || buffer[27] !== 0x01 || buffer[28] !== 0x2a) {
        throw new ImageValidationError('CORRUPTED_IMAGE', 'Invalid WebP VP8 start code.');
      }
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    }

    // 2. Lossless WebP (VP8L)
    if (chunkHeader === 'VP8L') {
      if (buffer[20] !== 0x2f) {
        throw new ImageValidationError('CORRUPTED_IMAGE', 'Invalid WebP VP8L signature.');
      }
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (b0 | ((b1 & 0x3f) << 8));
      const height = 1 + (((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)));
      return { width, height };
    }

    // 3. Extended WebP (VP8X)
    if (chunkHeader === 'VP8X') {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }

    throw new ImageValidationError('CORRUPTED_IMAGE', `Unknown WebP chunk format: ${chunkHeader}`);
  }
}
