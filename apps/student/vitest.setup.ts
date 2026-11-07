// Polyfill global Expo runtime variables in Node.js test environment
(globalThis as any).__DEV__ = true;
(globalThis as any).expo = (globalThis as any).expo || {
  EventEmitter: class MockEventEmitter {
    addListener() { return { remove: () => {} }; }
    removeListener() {}
    emit() {}
  },
  modules: {},
};
