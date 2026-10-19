/**
 * Registro común de hooks por spec: una instancia de JasWave por archivo (beforeAll),
 * captura de pantalla + salida del main + log de la app al fallar un test, y cierre limpio.
 */
import { test, type TestInfo } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { launchJasWave, type JasWaveApp, type LaunchOptions } from './app'

export function setupJasWave(opts: LaunchOptions = {}): () => JasWaveApp {
  let app: JasWaveApp | null = null

  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    app = await launchJasWave(opts)
  })

  test.afterEach(async ({}, testInfo) => {
    if (!app || testInfo.status === testInfo.expectedStatus) return
    await attachDiagnostics(app, testInfo)
  })

  test.afterAll(async () => {
    test.setTimeout(60_000)
    await app?.close()
    app = null
  })

  return () => {
    if (!app) throw new Error('JasWave no arrancó (ver beforeAll)')
    return app
  }
}

export async function attachDiagnostics(app: JasWaveApp, testInfo: TestInfo): Promise<void> {
  try {
    const png = await app.page.screenshot({ timeout: 10_000 })
    await testInfo.attach('screenshot', { body: png, contentType: 'image/png' })
  } catch {
    /* página caída */
  }
  await testInfo.attach('main-output.txt', { body: app.mainOutput().slice(-50_000), contentType: 'text/plain' })
  if (app.consoleErrors.length) {
    await testInfo.attach('console-errors.txt', { body: app.consoleErrors.join('\n'), contentType: 'text/plain' })
  }
  const log = path.join(app.userData, 'logs', 'jaswave.log')
  if (fs.existsSync(log)) {
    await testInfo.attach('jaswave.log', { body: fs.readFileSync(log, 'utf8').slice(-50_000), contentType: 'text/plain' })
  }
}
