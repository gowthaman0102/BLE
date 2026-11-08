import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { Student } from '@smart-attendance/shared';

const TOKEN_KEY = 'smart_attendance_student_token';
const USER_KEY = 'smart_attendance_student_user';

// In-memory fallback if all storage mechanisms fail
const memoryStorage: Record<string, string> = {};

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Restricted environment (e.g. private browsing)
  }
  return null;
}

async function isNativeSecureStorage(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

export const authStorage = {
  /**
   * Retrieves the persisted JWT authentication token.
   * Uses Android EncryptedSharedPreferences on native devices.
   */
  async getToken(): Promise<string | null> {
    try {
      if (await isNativeSecureStorage()) {
        return await SecureStore.getItemAsync(TOKEN_KEY);
      }
      const ls = getLocalStorage();
      if (ls) return ls.getItem(TOKEN_KEY);
      return memoryStorage[TOKEN_KEY] || null;
    } catch {
      return memoryStorage[TOKEN_KEY] || null;
    }
  },

  /**
   * Persists the signed JWT authentication token securely.
   */
  async setToken(token: string): Promise<void> {
    try {
      if (await isNativeSecureStorage()) {
        await SecureStore.setItemAsync(TOKEN_KEY, token);
      } else {
        const ls = getLocalStorage();
        if (ls) ls.setItem(TOKEN_KEY, token);
      }
      memoryStorage[TOKEN_KEY] = token;
    } catch {
      memoryStorage[TOKEN_KEY] = token;
    }
  },

  /**
   * Retrieves the persisted Student profile object.
   */
  async getUser(): Promise<Student | null> {
    try {
      let raw: string | null = null;
      if (await isNativeSecureStorage()) {
        raw = await SecureStore.getItemAsync(USER_KEY);
      } else {
        const ls = getLocalStorage();
        raw = ls ? ls.getItem(USER_KEY) : memoryStorage[USER_KEY];
      }
      if (!raw) return null;
      return JSON.parse(raw) as Student;
    } catch {
      return null;
    }
  },

  /**
   * Persists the Student profile object.
   */
  async setUser(user: Student): Promise<void> {
    try {
      const raw = JSON.stringify(user);
      if (await isNativeSecureStorage()) {
        await SecureStore.setItemAsync(USER_KEY, raw);
      } else {
        const ls = getLocalStorage();
        if (ls) ls.setItem(USER_KEY, raw);
      }
      memoryStorage[USER_KEY] = raw;
    } catch {
      memoryStorage[USER_KEY] = JSON.stringify(user);
    }
  },

  /**
   * Clears both the token and the student profile on logout.
   */
  async clear(): Promise<void> {
    try {
      if (await isNativeSecureStorage()) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_KEY);
      }
      const ls = getLocalStorage();
      if (ls) {
        ls.removeItem(TOKEN_KEY);
        ls.removeItem(USER_KEY);
      }
      delete memoryStorage[TOKEN_KEY];
      delete memoryStorage[USER_KEY];
    } catch {
      delete memoryStorage[TOKEN_KEY];
      delete memoryStorage[USER_KEY];
    }
  },
};
