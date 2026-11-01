/**
 * Escenario 25: minimizar · maximizar/restaurar · cerrar SIEMPRE visibles en la ventana principal (sin
 * marco). Los dibuja Windows (Window Controls Overlay) encima del contenido: se comprueba que el overlay
 * está activo, que la barra reserva su hueco a cualquier ancho y con diálogos o el Portal abiertos, y que
 * maximizar/restaurar funciona por IPC sobre la ventana que lo pide. Deja capturas de la ventana entera
 * (con los botones nativos) en JASWAVE_E2E_CAPTURAS o en la carpeta de resultados del test.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type TestInfo } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { sleep, waitFor } from './fixtures/app'
import { capturarVentanaEntera, moverVentana, ventanasNativas, type VentanaNativa } from './fixtures/ventanas-win'

const app = setupJasWave({ label: 'controles-ventana' })

function ventanaDaw(pid: number): VentanaNativa | undefined {
  return ventanasNativas(['Chrome_WidgetWin_1'])
    .filter((v) => v.pid === pid && v.visible && v.rect.w > 400)
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0]
}

function captura(testInfo: TestInfo, hwnd: string, nombre: string): string {
  const dir = process.env.JASWAVE_E2E_CAPTURAS || testInfo.outputPath('capturas')
  fs.mkdirSync(dir, { recursive: true })
  const archivo = path.join(dir, `${nombre}.png`)
  capturarVentanaEntera(hwnd, archivo)
  return archivo
}

/** Lo que la UI sabe de los botones: overlay visible y ancho reservado a la derecha de la barra. */
async function estadoBarra() {
  return app().page.evaluate(() => {
    const wco = (navigator as unknown as { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay
    const barra = document.querySelector('[data-testid="window-title-bar"]') as HTMLElement | null
    const reserva = document.querySelector('[data-testid="window-controls-reserva"]') as HTMLElement | null
    const area = wco?.getTitlebarAreaRect()
    return {
      overlay: Boolean(wco?.visible),
      modo: barra?.dataset.controlesVentana ?? null,
      altoBarra: barra?.getBoundingClientRect().height ?? 0,
      reserva: reserva?.getBoundingClientRect().width ?? 0,
      // los botones nativos ocupan desde el final del área de título hasta el borde derecho
      anchoBotones: area ? window.innerWidth - (area.x + area.width) : 0,
      anchoVentana: window.innerWidth,
      // nada del contenido de la barra pasa por debajo de los botones
      desborde: barra
        ? Array.from(barra.querySelectorAll('button')).some((b) => {
            const r = b.getBoundingClientRect()
            return r.width > 0 && area ? r.right > area.x + area.width + 0.5 : false
          })
        : true,
    }
  })
}

test('la ventana principal tiene minimizar, maximizar/restaurar y cerrar nativos siempre visibles', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'overlay de botones de ventana: comprobado en Windows')
  test.setTimeout(180_000)
  const { page, proc } = app()
  await expect(page.getByTestId('window-title-bar')).toBeVisible()

  const v = await waitFor('ventana del DAW', async () => ventanaDaw(proc.pid!) ?? null, 30_000)

  // Normal
  const normal = await estadoBarra()
  expect(normal.overlay, 'Window Controls Overlay activo').toBe(true)
  expect(normal.modo).toBe('nativos')
  expect(normal.altoBarra).toBe(44)
  expect(normal.anchoBotones, 'tres botones nativos').toBeGreaterThan(100)
  expect(Math.abs(normal.reserva - normal.anchoBotones)).toBeLessThanOrEqual(1)
  expect(normal.desborde).toBe(false)
  captura(testInfo, v.hwnd, '1-normal')

  // Maximizar y restaurar por IPC (la misma vía que los botones propios), con el estado correcto
  const maximizada = await page.evaluate(() => (window as any).electron.windowMaximize())
  expect(maximizada).toBe(true)
  await waitFor('maximizada', async () => (await page.evaluate(() => (window as any).electron.windowIsMaximized())) === true, 10_000)
  await sleep(400)
  captura(testInfo, v.hwnd, '2-maximizada')
  expect((await estadoBarra()).overlay).toBe(true)
  await page.evaluate(() => (window as any).electron.windowMaximize())
  await waitFor('restaurada', async () => (await page.evaluate(() => (window as any).electron.windowIsMaximized())) === false, 10_000)

  // Estrecha (1000 px, el mínimo): los botones no se recortan; el resto de la barra cede
  await sleep(600) // animación de restaurar de Windows
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  moverVentana(v.hwnd, { x: Math.max(0, v.rect.x), y: Math.max(0, v.rect.y), w: Math.round(1000 * dpr), h: Math.round(700 * dpr) })
  await waitFor(
    'ancho 1000',
    async () => {
      const w = await page.evaluate(() => window.innerWidth)
      if (w > 1020) moverVentana(v.hwnd, { x: Math.max(0, v.rect.x), y: Math.max(0, v.rect.y), w: Math.round(1000 * dpr), h: Math.round(700 * dpr) })
      return w <= 1020
    },
    10_000,
    500,
  )
  await sleep(400)
  const estrecha = await estadoBarra()
  expect(estrecha.overlay).toBe(true)
  expect(estrecha.desborde).toBe(false)
  captura(testInfo, v.hwnd, '3-estrecha-1000')

  // Con un diálogo modal de fondo opaco (nuevo proyecto, z-200): los botones siguen encima. No se crea nada.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-nuevo-proyecto')))
  await sleep(800)
  expect((await estadoBarra()).overlay).toBe(true)
  captura(testInfo, v.hwnd, '4-dialogo-abierto')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toHaveCount(0)

  // Portal (antes: sin barra ni botones en la ventana sin marco)
  const portal = page.getByTitle('Volver al Portal y Catálogo PWA')
  if (await portal.count()) {
    await portal.click()
    await expect(page.getByTestId('window-title-bar')).toBeVisible()
    const p = await estadoBarra()
    expect(p.overlay).toBe(true)
    expect(p.reserva).toBeGreaterThan(100)
    captura(testInfo, v.hwnd, '5-portal')
  }
})
