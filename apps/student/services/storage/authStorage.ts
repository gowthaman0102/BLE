import { Student } from '@smart-attendance/shared';

const TOKEN_KEY = 'smart_attendance_student_token';
const USER_KEY = 'smart_attendance_student_user';

// In-memory fallback if localStorage is unavailable
const memoryStorage: Record<string, string> = {};

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // In restricted web views or private browsing where localStorage is denied
  }
  return null;
}

export const authStorage = {
  /**
   * Retrieves the persisted JWT authentication token.
   */
  async getToken(): Promise<string | null> {
    try {
      const storage = getLocalStorage();
      if (storage) {
        return storage.getItem(TOKEN_KEY);
      }
      return memoryStorage[TOKEN_KEY] || null;
    } catch (e) {
      console.warn('Failed to read auth token from storage:', e);
      return memoryStorage[TOKEN_KEY] || null;
    }
  },

  /**
   * Persists the signed JWT authentication token.
   */
  async setToken(token: string): Promise<void> {
    try {
      const storage = getLocalStorage();
      if (storage) {
        storage.setItem(TOKEN_KEY, token);
      }
      memoryStorage[TOKEN_KEY] = token;
    } catch (e) {
      console.warn('Failed to save auth token to storage:', e);
      memoryStorage[TOKEN_KEY] = token;
    }
  },

  /**
   * Retrieves the persisted Student profile object.
   */
  async getUser(): Promise<Student | null> {
    try {
      const storage = getLocalStorage();
      const raw = storage ? storage.getItem(USER_KEY) : memoryStorage[USER_KEY];
      if (!raw) return null;
      return JSON.parse(raw) as Student;
    } catch (e) {
      console.warn('Failed to read student profile from storage:', e);
      return null;
    }
  },

  /**
   * Persists the Student profile object as JSON.
   */
  async setUser(user: Student): Promise<void> {
    try {
      const raw = JSON.stringify(user);
      const storage = getLocalStorage();
      if (storage) {
        storage.setItem(USER_KEY, raw);
      }
      memoryStorage[USER_KEY] = raw;
    } catch (e) {
      console.warn('Failed to save student profile to storage:', e);
      memoryStorage[USER_KEY] = JSON.stringify(user);
    }
  },

  /**
   * Clears both the token and the student profile on logout.
   */
  async clear(): Promise<void> {
    try {
      const storage = getLocalStorage();
      if (storage) {
        storage.removeItem(TOKEN_KEY);
        storage.removeItem(USER_KEY);
      }
      delete memoryStorage[TOKEN_KEY];
      delete memoryStorage[USER_KEY];
    } catch (e) {
      console.warn('Failed to clear auth storage:', e);
      delete memoryStorage[TOKEN_KEY];
      delete memoryStorage[USER_KEY];
    }
  },
};
