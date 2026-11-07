import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: true,
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      'react-native': 'react-native-web',
    },
  },
});
