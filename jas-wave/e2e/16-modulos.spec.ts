/**
 * Escenario 16 (M3): los módulos del DAW son paquetes independientes que se cargan en tiempo de ejecución.
 * En desarrollo salen de plugins/com.jaswave.modulo.* (compilar antes con `npm run build:modulos`) y se
 * sirven por jaswave-modulo:// solo si su paquete es válido. Se comprueba que MIDI·MD se carga, aporta su
 * herramienta, y que desactivarlo la quita sin tocar el proyecto.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'

const app = setupJasWave({ label: 'modulos' })

async function hayModulo(page: import('@playwright/test').Page): Promise<boolean> {
  const p = (await page.evaluate(() => (window as any).electron.pluginsListar?.())) as Array<{ manifiesto: { id?: string } | null }>
  return p.some((x) => x.manifiesto?.id === 'com.jaswave.modulo.midi-md')
}

test('MIDI·MD se carga desde su paquete por jaswave-modulo:// y aparece en Módulos', async () => {
  const { page, target } = app()
  test.skip(!(await hayModulo(page)), target === 'dev' ? 'compila los módulos (npm run build:modulos)' : 'módulo no instalado')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'modulos' } })))
  const panel = page.getByTestId('panel-modulos')
  await expect(panel).toContainText('MIDI · Markdown')
  await expect(panel).toContainText('Cargado', { timeout: 15_000 })
  // Sus estilos vienen del paquete por el protocolo de módulos, y el protocolo sirve su código.
  const css = await page.evaluate(() => (document.querySelector('link[data-modulo-jaswave="com.jaswave.modulo.midi-md"]') as HTMLLinkElement | null)?.href)
  expect(css).toBe('jaswave-modulo://com.jaswave.modulo.midi-md/dist/modulo.css')
  const codigo = await page.evaluate(async () => {
    const r = await fetch('jaswave-modulo://com.jaswave.modulo.midi-md/dist/modulo.js')
    return { estado: r.status, tipo: r.headers.get('content-type') }
  })
  expect(codigo).toMatchObject({ estado: 200, tipo: expect.stringContaining('javascript') })
  // Fuera de dist/ no se sirve nada.
  expect(await page.evaluate(async () => (await fetch('jaswave-modulo://com.jaswave.modulo.midi-md/jaswave-plugin.json')).status)).toBe(404)
})

test('la herramienta del módulo se abre y desactivar el módulo la quita (el proyecto sigue intacto)', async () => {
  const { page } = app()
  test.skip(!(await hayModulo(page)), 'módulo no disponible')
  const pistasAntes = await page.evaluate(() => document.querySelectorAll('[data-track-id]').length)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'midi-md' } })))
  await expect(page.getByRole('button', { name: 'MIDI · MD', exact: true }).first()).toBeVisible()

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'modulos' } })))
  const interruptor = page.getByRole('switch', { name: 'Activar MIDI · Markdown' })
  await interruptor.uncheck()
  await expect(page.getByRole('button', { name: 'MIDI · MD', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.querySelectorAll('[data-track-id]').length)).toBe(pistasAntes)
  await interruptor.check()
  await expect(page.getByTestId('panel-modulos')).toContainText('Cargado', { timeout: 15_000 })
})
