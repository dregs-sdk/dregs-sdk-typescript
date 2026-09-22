import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The retry tests stub a protected backoff hook on the prototype; restoring between tests
    // keeps that out of the tests that want the real one.
    restoreMocks: true,
  },
});
