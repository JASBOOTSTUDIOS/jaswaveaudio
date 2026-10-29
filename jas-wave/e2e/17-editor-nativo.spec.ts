/**
 * Escenario 17 (V4): en escritorio el editor de un VST JasWave es SIEMPRE el editor cyber nativo,
 * dentro del panel «Editor de plugin». El plugin-host lo abre como popup sin padre (sin bloqueos entre
 * procesos) y main lo mantiene alineado con el panel: se comprueba desde Win32 (posición en píxeles
 * físicos, view centrado 16:9, oculto al minimizar, de vuelta al restaurar y modo ventana).
 * Requiere los VST compilados (npm run native:plugins) y el host con modo embebido (npm run native:build).
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { waitFor } from './fixtures/app'
import { findTrack, newProject } from './fixtures/project'
import { capturarVentana, capturarVentanaEntera, estilosVentana, mostrarVentana, ventanasNativas, type VentanaNativa } from './fixtures/ventanas-win'

const app = setupJasWave({ label: 'editor-nativo', bridge: true })
const CLASE_EMBED = 'JasWaveVstEmbedHost'
const CLASE_EDITOR = 'JasWaveCyberEditor'

function ventanaDaw(pid: number): VentanaNativa | undefined {
  return ventanasNativas(['Chrome_WidgetWin_1'])
    .filter((v) => v.pid === pid && v.visible && v.rect.w > 400)
    .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0]
}
const editores = () => ventanasNativas([CLASE_EMBED])

test('el EQ JasWave se muestra con su editor nativo alineado al panel', async ({}, testInfo) => {
  test.skip(process.platform !== 'win32', 'editor nativo embebido: solo Windows')
  test.setTimeout(240_000)
  const { page, bridge, proc } = app()
  expect(bridge, 'agent bridge').toBeTruthy()

  const rutaDsp = await page.evaluate(async () => {
    const paquetes = (await (window as any).electron.pluginsListar?.()) as Array<{ manifiesto: { id?: string } | null; rutaDsp?: string }>
    return paquetes.find((p) => p.manifiesto?.id === 'com.jaswave.plugin.param-eq')?.rutaDsp ?? null
  })
  test.skip(!rutaDsp, 'param-eq sin binario compilado')

  await newProject(bridge!, 'E2E Editor nativo')
  await bridge!.run('track.create', { nombre: 'EQ nativo', tipo: 'audio' })
  const pista = await waitFor('pista', () => findTrack(bridge!, 'EQ nativo'), 20_000)
  const plugin = {
    id: 'eq-e2e',
    nombre: 'JasWave EQ Parametric Pro',
    fabricante: 'JasWave',
    tipo: 'efecto',
    categoria: 'efecto',
    descripcion: rutaDsp,
    bypass: false,
    parametros: [],
    estado: 'cargado',
    version: '1.0.0',
    wet: 1,
    latencia: 0,
    autor: 'JasWave',
    licencia: 'JasWave',
  }
  const ins = await bridge!.actions([{ type: 'plugin.insert', payload: { trackId: pista.id, plugin } }])
  expect(ins.results?.[0]?.success, JSON.stringify(ins)).toBe(true)

  // Abre el panel como lo hace la UI (foco del editor + herramienta del workspace)
  await page.evaluate(
    ({ trackId, plugin }) => {
      const ch = new BroadcastChannel('jaswave-plugin-editor-focus-v1')
      ch.postMessage({ type: 'focus', focus: { trackId, pluginId: plugin.id, pluginName: plugin.nombre, openedAt: Date.now() } })
      ch.close()
      window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'plugin-editor', zone: 'center' } }))
    },
    { trackId: pista.id, plugin },
  )
  const host = page.locator('[data-vst-embed-host]').first()
  await expect(host).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('UI nativa embebida · misma instancia que el audio')).toBeVisible({ timeout: 90_000 })

  const pid = proc.pid!
  const comprobarAlineado = async () => {
    const panel = await host.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio }
    })
    return waitFor(
      'editor nativo alineado con el panel',
      async () => {
        const daw = ventanaDaw(pid)
        const ed = editores().find((v) => v.visible)
        if (!daw || !ed) return null
        const esperado = { x: daw.cliente.x + panel.x * panel.dpr, y: daw.cliente.y + panel.y * panel.dpr, w: panel.w * panel.dpr, h: panel.h * panel.dpr }
        const ok =
          Math.abs(ed.rect.x - esperado.x) <= 3 && Math.abs(ed.rect.y - esperado.y) <= 3 && Math.abs(ed.rect.w - esperado.w) <= 4 && Math.abs(ed.rect.h - esperado.h) <= 4
        return ok ? { daw, ed, esperado } : null
      },
      30_000,
      500,
    )
  }

  const { daw, ed } = await comprobarAlineado()
  // El editor cyber de JasWave (no un panel web) está dentro, centrado y en 16:9 (1100×620)
  const cyber = ed.hijos.find((h) => h.clase === CLASE_EDITOR)
  expect(cyber, JSON.stringify(ed.hijos)).toBeTruthy()
  expect(Math.abs(cyber!.rect.w / cyber!.rect.h - 1100 / 620)).toBeLessThan(0.02)
  const margenX = cyber!.rect.x - ed.rect.x, margenDer = ed.rect.x + ed.rect.w - (cyber!.rect.x + cyber!.rect.w)
  const margenY = cyber!.rect.y - ed.rect.y, margenAbajo = ed.rect.y + ed.rect.h - (cyber!.rect.y + cyber!.rect.h)
  expect(Math.abs(margenX - margenDer)).toBeLessThanOrEqual(2)
  expect(Math.abs(margenY - margenAbajo)).toBeLessThanOrEqual(2)
  expect(Math.min(margenX, margenY)).toBe(0) // ocupa todo el ancho o todo el alto del panel

  const captura = path.join(testInfo.outputDir, 'editor-nativo-embebido.png')
  fs.mkdirSync(testInfo.outputDir, { recursive: true })
  capturarVentana(ed.hwnd, captura) // solo la ventana del editor, nunca la pantalla
  await testInfo.attach('editor-nativo-embebido', { path: captura, contentType: 'image/png' })

  // Minimizar el DAW oculta el editor; restaurarlo lo devuelve a su sitio
  mostrarVentana(daw.hwnd, 6)
  await waitFor('editor oculto al minimizar', async () => editores().every((v) => !v.visible), 15_000, 500)
  mostrarVentana(daw.hwnd, 9)
  await comprobarAlineado()

  // Modo ventana (flotante, con marco) y vuelta al panel
  await page.getByRole('button', { name: 'En ventana' }).click()
  await expect(page.getByText('UI nativa en ventana · misma instancia que el audio')).toBeVisible({ timeout: 60_000 })
  // La ventana flotante es una ventana normal de Windows: título, minimizar, maximizar/restaurar y cerrar
  const flotante = await waitFor('editor flotante', async () => editores().find((v) => v.visible) ?? null, 15_000, 500)
  const { estilo, estiloEx } = estilosVentana(flotante.hwnd)
  const WS_CAPTION = 0xc00000, WS_SYSMENU = 0x80000, WS_MINIMIZEBOX = 0x20000, WS_MAXIMIZEBOX = 0x10000, WS_EX_TOOLWINDOW = 0x80
  expect((estilo & WS_CAPTION) === WS_CAPTION, 'barra de título').toBe(true)
  for (const [bit, nombre] of [[WS_SYSMENU, 'cerrar'], [WS_MINIMIZEBOX, 'minimizar'], [WS_MAXIMIZEBOX, 'maximizar']] as const) {
    expect(estilo & bit, nombre).toBeTruthy()
  }
  expect(estiloEx & WS_EX_TOOLWINDOW, 'sin WS_EX_TOOLWINDOW').toBe(0)
  expect(flotante.rect.y, 'barra de título dentro de la pantalla').toBeGreaterThanOrEqual(0)
  const capturaFlotante = path.join(testInfo.outputDir, 'editor-nativo-flotante.png')
  capturarVentanaEntera(flotante.hwnd, capturaFlotante)
  await testInfo.attach('editor-nativo-flotante', { path: capturaFlotante, contentType: 'image/png' })
  // Maximizar y restaurar (el editor no se deforma: queda centrado si no es redimensionable)
  mostrarVentana(flotante.hwnd, 3)
  await waitFor('flotante maximizado', async () => (editores().find((v) => v.hwnd === flotante.hwnd)?.rect.w ?? 0) > flotante.rect.w, 10_000, 300)
  const capturaMax = path.join(testInfo.outputDir, 'editor-nativo-flotante-maximizado.png')
  capturarVentanaEntera(flotante.hwnd, capturaMax)
  await testInfo.attach('editor-nativo-flotante-maximizado', { path: capturaMax, contentType: 'image/png' })
  mostrarVentana(flotante.hwnd, 9)
  await page.getByRole('button', { name: 'En el panel' }).click()
  await expect(page.getByText('UI nativa embebida · misma instancia que el audio')).toBeVisible({ timeout: 60_000 })
  await comprobarAlineado()

  // Cerrar la UI destruye la ventana del host
  await page.getByRole('button', { name: 'Cerrar UI' }).click()
  await waitFor('editor cerrado', async () => editores().length === 0, 15_000, 500)
})
