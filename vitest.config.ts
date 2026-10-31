import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/*/src/**/*.{test,spec}.{ts,tsx}',
      'packages/*/src/**/*.{test,spec}.{ts,tsx}',
      'supabase/**/*.{test,spec}.{ts,tsx}',
    ],
    environment: 'node',
  },
});