/**
 * Escenario 6: seguridad ante fallos del renderer.
 * Un error no capturado y un rechazo de promesa no tumban la app y quedan en
 * <userData>/logs/jaswave.log (vía window 'error'/'unhandledrejection' → IPC log-error).
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'

const app = setupJasWave({ label: 'crash', bridge: true })

const readLog = (userData: string) => {
  const file = path.join(userData, 'logs', 'jaswave.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

test('error no capturado y rechazo de promesa → log persistente, app viva', async () => {
  const { page, userData, bridge, proc } = app()
  const marker = `E2E_CRASH_${Date.now()}`
  const alertsBefore = await page.locator('[role="alert"]').count()

  await page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(`${m}_window`)
    }, 0)
    void Promise.reject(new Error(`${m}_rejection`))
  }, marker)

  await expect.poll(() => readLog(userData), { timeout: 15_000, message: 'error en jaswave.log' }).toContain(`${marker}_window`)
  expect(readLog(userData)).toContain(`${marker}_rejection`)
  expect(readLog(userData)).toMatch(/\[error\] \[renderer:window\.onerror\]/)

  // La app sigue viva y operativa.
  expect(proc.exitCode).toBeNull()
  await expect(page.locator('#root *').first()).toBeAttached()
  const st = await bridge!.state()
  expect(st.ok).toBe(true)
  // Ningún error boundary nuevo (pantalla de error) por un error fuera de React.
  expect(await page.locator('[role="alert"]').count()).toBe(alertsBefore)
  await expect(page.getByText('JasWave encontró un error inesperado')).toHaveCount(0)
})

test('crash del proceso renderer queda registrado y la app sigue en pie', async () => {
  const { page, userData, browser, proc } = app()
  // forceCrash del renderer vía CDP: el main debe registrar render-process-gone.
  const cdp = await page.context().newCDPSession(page)
  // Page.crash no responde (el renderer muere): no esperar la respuesta.
  void cdp.send('Page.crash').catch(() => undefined)
  await expect
    .poll(() => readLog(userData), { timeout: 20_000, message: 'render-process-gone en el log' })
    .toMatch(/render-process-gone/)
  // El proceso main no muere con el renderer.
  expect(proc.exitCode).toBeNull()
  expect(browser.isConnected()).toBe(true)
})
