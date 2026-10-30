import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/integracion/**/*.int.test.ts'],
    environment: 'node',
    // Crea y migra la base exclusiva de pruebas (jaswave_test) antes de ejecutar.
    globalSetup: ['test/integracion/preparar-bd.ts'],
    // Las pruebas comparten la misma base de datos: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
