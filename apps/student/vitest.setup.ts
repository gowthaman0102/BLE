import { vi } from 'vitest';

// Polyfill global Expo runtime variables in Node.js test environment
(globalThis as any).__DEV__ = true;
process.env.EXPO_OS = 'android';

vi.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    isAvailableAsync: vi.fn().mockResolvedValue(true),
    getItemAsync: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
    setItemAsync: vi.fn((key: string, val: string) => {
      store.set(key, val);
      return Promise.resolve();
    }),
    deleteItemAsync: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

(globalThis as any).expo = (globalThis as any).expo || {
  EventEmitter: class MockEventEmitter {
    addListener() { return { remove: () => {} }; }
    removeListener() {}
    emit() {}
  },
  modules: {
    ExpoSecureStore: {
      getValueWithKeyAsync: vi.fn().mockResolvedValue(null),
      setValueWithKeyAsync: vi.fn().mockResolvedValue(true),
      deleteValueWithKeyAsync: vi.fn().mockResolvedValue(true),
    },
  },
};
