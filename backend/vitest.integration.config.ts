import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integracion/**/*.int.test.ts'],
    environment: 'node',
    // Las pruebas comparten la misma base de datos: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
