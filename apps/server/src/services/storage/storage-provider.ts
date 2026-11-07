import { Readable } from 'stream';

export interface StoragePutOptions {
  studentId: string;
  version: number;
  buffer: Buffer;
  mimeType: string;
}

export interface StoragePutResult {
  key: string;
  sha256: string;
  size: number;
}

export interface StorageGetResult {
  stream: Readable;
  buffer: Buffer;
  size: number;
  mimeType: string;
}

export interface ReferencePhotoStorageProvider {
  /**
   * Persists a student reference photo to secure storage.
   * Generates a unique opaque storage key.
   */
  savePhoto(options: StoragePutOptions): Promise<StoragePutResult>;

  /**
   * Retrieves a student reference photo by its storage key.
   * Returns null if the file does not exist.
   */
  getPhoto(key: string, mimeType?: string): Promise<StorageGetResult | null>;

  /**
   * Safely deletes a photo by its storage key.
   * Returns true if deleted, false if file did not exist.
   */
  deletePhoto(key: string): Promise<boolean>;

  /**
   * Checks if a file exists for the given storage key.
   */
  exists(key: string): Promise<boolean>;
}
