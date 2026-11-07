import { AuthPrincipal } from '@smart-attendance/shared';

const TOKEN_KEY = 'smart_attendance_professor_token';
const USER_KEY = 'smart_attendance_professor_user';

const memoryStorage: Record<string, string> = {};

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Restricted environment
  }
  return null;
}

export const authStorage = {
  async getToken(): Promise<string | null> {
    try {
      const storage = getLocalStorage();
      if (storage) {
        return storage.getItem(TOKEN_KEY);
      }
      return memoryStorage[TOKEN_KEY] || null;
    } catch (e) {
      console.warn('Failed to read professor auth token:', e);
      return memoryStorage[TOKEN_KEY] || null;
    }
  },

  async setToken(token: string): Promise<void> {
    try {
      const storage = getLocalStorage();
      if (storage) {
        storage.setItem(TOKEN_KEY, token);
      }
      memoryStorage[TOKEN_KEY] = token;
    } catch (e) {
      console.warn('Failed to save professor auth token:', e);
      memoryStorage[TOKEN_KEY] = token;
    }
  },

  async getUser(): Promise<AuthPrincipal | null> {
    try {
      const storage = getLocalStorage();
      const raw = storage ? storage.getItem(USER_KEY) : memoryStorage[USER_KEY];
      if (!raw) return null;
      return JSON.parse(raw) as AuthPrincipal;
    } catch (e) {
      console.warn('Failed to parse professor profile:', e);
      return null;
    }
  },

  async setUser(user: AuthPrincipal): Promise<void> {
    try {
      const serialized = JSON.stringify(user);
      const storage = getLocalStorage();
      if (storage) {
        storage.setItem(USER_KEY, serialized);
      }
      memoryStorage[USER_KEY] = serialized;
    } catch (e) {
      console.warn('Failed to persist professor profile:', e);
    }
  },

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
      console.warn('Failed to clear professor storage:', e);
    }
  },
};
