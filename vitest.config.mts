import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@root': resolve(__dirname),
      '@src': resolve(__dirname, 'src'),
      '@assets': resolve(__dirname, 'src/assets'),
      '@extension/storage': resolve(__dirname, 'src/storage'),
      '@extension/i18n': resolve(__dirname, 'src/i18n'),
      '@extension/ui': resolve(__dirname, 'src/ui'),
      '@extension/shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
