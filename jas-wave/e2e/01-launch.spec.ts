/**
 * Escenario 1: la app arranca (empaquetada por defecto), el renderer pinta la UI
 * y el endurecimiento básico del renderer está activo.
 */
import { expect, test } from '@playwright/test'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'

const app = setupJasWave({ label: 'launch' })

/** Ruido de consola conocido y benigno (no es un fallo de la app). */
const BENIGN_CONSOLE = [
  /Electron Security Warning/i,
  /DevTools/i,
  /Autofill\./i,
]

test('arranca con título JasWave y la UI renderizada', async () => {
  const { page } = app()
  await expect(page).toHaveTitle(/JasWave/)
  // Recarga con el listener de consola ya enganchado para capturar errores desde el arranque.
  app().consoleErrors.length = 0
  await page.reload({ waitUntil: 'load' })
  await expect(page).toHaveTitle(/JasWave/)
  await expect
    .poll(() => page.locator('#root *').count(), { timeout: 60_000, message: 'el root debe renderizar la UI' })
    .toBeGreaterThan(200)
  // Margen para efectos de arranque (plugin host, autosave, MIDI…)
  await page.waitForTimeout(3000)
  const errors = app().consoleErrors.filter((e) => !BENIGN_CONSOLE.some((re) => re.test(e)))
  expect(errors, `errores de consola:\n${errors.join('\n')}`).toEqual([])
})

test('CSP, sin Node en el renderer y API window.electron expuesta', async () => {
  const { page } = app()
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp, 'meta CSP presente').toBeTruthy()
  expect(csp).toContain("default-src")

  const env = await page.evaluate(() => ({
    require: typeof (window as any).require,
    process: typeof (window as any).process,
    module: typeof (window as any).module,
    electron: typeof (window as any).electron,
    api: Object.keys((window as any).electron ?? {}),
    frozen: (() => {
      try {
        ;(window as any).electron.fileRead = () => 'pwned'
        return (window as any).electron.fileRead.toString().includes('pwned') === false
      } catch {
        return true
      }
    })(),
  }))
  expect(env.require).toBe('undefined')
  expect(env.process).toBe('undefined')
  expect(env.module).toBe('undefined')
  expect(env.electron).toBe('object')
  expect(env.api).toEqual(expect.arrayContaining(['fileRead', 'fileSave', 'pluginHostSend', 'shellOpenExternal', 'logError']))
  // contextBridge congela el objeto expuesto
  expect(env.frozen).toBe(true)
})

test('userData aislado en la carpeta temporal del test', async () => {
  const a = app()
  expect(path.resolve(a.userData).toLowerCase()).toBe(path.resolve(a.tmpRoot, 'userData').toLowerCase())
  if (a.target === 'packaged') {
    const packaged = await a.page.evaluate(() => (window as any).electron.getAppVersion())
    expect(packaged).toMatch(/^\d+\.\d+\.\d+/)
  }
})
