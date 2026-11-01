/**
 * Playwright E2E sobre la app empaquetada (release/win-unpacked/JasWave.exe) o el build
 * de desarrollo (JASWAVE_E2E_TARGET=dev). Ver e2e/README.md.
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.spec\.ts$/,
  // Cada spec arranca su propia instancia de Electron: en serie para no competir por audio/CPU.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  outputDir: '../test-results/e2e',
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    // Capturas/trazas las gestiona el fixture (la página llega por CDP, no por un launch de Playwright).
    actionTimeout: 20_000,
  },
})
