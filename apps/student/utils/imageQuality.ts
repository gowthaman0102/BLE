import { Image } from 'react-native';

export const SELFIE_LIMITS = {
  MIN_FILE_SIZE_BYTES: 5 * 1024, // 5 KB
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  MIN_DIMENSION_PX: 200, // 200 px
  MAX_DIMENSION_PX: 4096, // 4096 px
  ALLOWED_EXTENSIONS: ['jpg', 'jpeg', 'png', 'webp'],
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
};

export interface SelfieValidationInput {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
}

export interface SelfieValidationResult {
  isValid: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Validates a captured selfie against client-side technical limits before submission.
 * Note: Actual facial biometric verification and liveness detection are strictly authoritative on the server.
 */
export function validateCapturedSelfie(input: SelfieValidationInput): SelfieValidationResult {
  const { uri, width, height, fileSize, mimeType } = input;

  if (!uri || typeof uri !== 'string' || uri.trim().length === 0) {
    return {
      isValid: false,
      errorCode: 'MISSING_IMAGE_URI',
      errorMessage: 'Captured image reference is missing or empty.',
    };
  }

  // 1. Extension / MIME verification
  const normalizedMime = mimeType?.toLowerCase();
  const cleanUri = uri.split('?')[0].toLowerCase();
  const ext = cleanUri.split('.').pop() || '';

  const isMimeValid = normalizedMime ? SELFIE_LIMITS.ALLOWED_MIME_TYPES.includes(normalizedMime) : false;
  const isExtValid = SELFIE_LIMITS.ALLOWED_EXTENSIONS.includes(ext);

  if (!isMimeValid && !isExtValid && !uri.startsWith('data:image/')) {
    return {
      isValid: false,
      errorCode: 'UNSUPPORTED_FORMAT',
      errorMessage: 'Unsupported image format. Selfie must be JPEG, PNG, or WebP.',
    };
  }

  // 2. File size checks (if known)
  if (typeof fileSize === 'number' && fileSize > 0) {
    if (fileSize < SELFIE_LIMITS.MIN_FILE_SIZE_BYTES) {
      return {
        isValid: false,
        errorCode: 'IMAGE_TOO_SMALL',
        errorMessage: `Selfie file size (${(fileSize / 1024).toFixed(1)} KB) is too small. Minimum required is 5 KB.`,
      };
    }
    if (fileSize > SELFIE_LIMITS.MAX_FILE_SIZE_BYTES) {
      return {
        isValid: false,
        errorCode: 'IMAGE_TOO_LARGE',
        errorMessage: `Selfie file size exceeds the 5 MB maximum limit.`,
      };
    }
  }

  // 3. Dimension checks (if known)
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    if (width < SELFIE_LIMITS.MIN_DIMENSION_PX || height < SELFIE_LIMITS.MIN_DIMENSION_PX) {
      return {
        isValid: false,
        errorCode: 'DIMENSIONS_TOO_SMALL',
        errorMessage: `Selfie resolution (${width}x${height}) is below the minimum required 200x200 px.`,
      };
    }
    if (width > SELFIE_LIMITS.MAX_DIMENSION_PX || height > SELFIE_LIMITS.MAX_DIMENSION_PX) {
      return {
        isValid: false,
        errorCode: 'DIMENSIONS_TOO_LARGE',
        errorMessage: `Selfie resolution exceeds the maximum allowed 4096x4096 px.`,
      };
    }
  }

  return { isValid: true };
}

/**
 * Resolves image dimensions asynchronously using React Native Image.getSize.
 */
export function resolveImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error)
    );
  });
}
