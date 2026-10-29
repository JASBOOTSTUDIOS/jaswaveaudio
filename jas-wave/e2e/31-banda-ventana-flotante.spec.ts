/**
 * La banda virtual en una ventana flotante (satélite): la producción corre en la ventana principal y el
 * panel flotante, que es otro renderer, la refleja por el canal entre ventanas. Antes se veía vacío.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'
import { crearPasos } from './fixtures/pasos'

const app = setupJasWave({ label: 'banda-flotante', bridge: true })
const paso = crearPasos(() => app().page, '31-banda-flotante')
const CANAL = 'jaswave-banda-v1'

/** Espera a que aparezca la ventana satélite (?undock=…). */
async function esperarSatelite(browser: { contexts: () => { pages: () => Page[] }[] }, toolId: string): Promise<Page> {
  const principal = app().page
  const limite = Date.now() + 60_000
  while (Date.now() < limite) {
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        if (p !== principal && new URL(p.url()).searchParams.get('undock') === toolId) return p
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('No apareció la ventana satélite')
}

const ESTADO = {
  activo: true,
  faseActual: 'grabacion_musicos',
  promptUsuario: 'E2E banda flotante',
  agenteActivoId: 'bat',
  eventos: [
    { id: 'e1', timestamp: 1, fase: 'planificacion', agenteId: 'plan', agenteNombre: 'Planificador E2E', rol: 'planificador', mensaje: 'Hoja de ruta lista' },
    { id: 'e2', timestamp: 2, fase: 'grabacion_musicos', agenteId: 'bat', agenteNombre: 'Baterista E2E', rol: 'musico', color: '#f59e0b', mensaje: 'Grabando la intro con escobillas' },
  ],
  qaReporte: { musicosAprobados: 0, musicosTotal: 3, mezclaAprobada: false, masterAprobado: false, rondas: 0, detalles: [] },
}

test('la banda se ve en una ventana flotante y «Detener» llega a la ventana principal', async () => {
  const { browser, bridge, page } = app()
  await newProject(bridge!, 'E2E Banda flotante')

  // La ventana principal hace de productora: publica el estado y responde a quien lo pida (como hace el
  // orquestador real), y anota si alguien pide detener.
  await page.evaluate(
    ({ canal, estado }) => {
      const ch = new BroadcastChannel(canal)
      const w = window as unknown as { __e2eBandaDetener?: number; __e2eBandaCanal?: BroadcastChannel }
      w.__e2eBandaDetener = 0
      w.__e2eBandaCanal = ch
      ch.onmessage = (ev: MessageEvent) => {
        const m = ev.data as { tipo?: string }
        if (m?.tipo === 'pedir') ch.postMessage({ tipo: 'estado', state: estado })
        if (m?.tipo === 'detener') w.__e2eBandaDetener = (w.__e2eBandaDetener ?? 0) + 1
      }
      ch.postMessage({ tipo: 'estado', state: estado })
    },
    { canal: CANAL, estado: ESTADO },
  )

  // Ventana flotante con la banda (mismo camino que «Abrir en otra ventana»).
  await page.evaluate(() => (window as unknown as { electron: { openToolWindow: (id: string, t: string, e: object) => Promise<unknown> } }).electron.openToolWindow('banda-virtual', 'Banda virtual', {}))
  const satelite = await esperarSatelite(browser, 'banda-virtual')
  await satelite.waitForLoadState('domcontentloaded')

  // El panel del módulo se monta en la ventana flotante y refleja la producción (no está vacío ni dice
  // que el módulo no está disponible).
  const panel = satelite.getByTestId('banda-panel')
  await expect(panel).toBeVisible({ timeout: 60_000 })
  const vivo = panel.getByTestId('banda-live')
  await expect(vivo).toBeVisible({ timeout: 30_000 })
  await expect(vivo).toContainText('Paso 3: los músicos graban')
  await expect(vivo).toContainText('Baterista E2E')
  await expect(vivo).toContainText('Grabando la intro con escobillas')
  await expect(satelite.getByTestId('herramienta-no-disponible')).toHaveCount(0)
  await satelite.screenshot({ path: `${process.env.JASWAVE_E2E_CAPTURAS ?? 'test-results'}/31-banda-flotante-satelite.png` }).catch(() => {})
  await paso('banda reflejada en la ventana flotante')

  // Un cambio nuevo en la principal llega a la flotante.
  await page.evaluate(
    ({ estado }) => {
      const w = window as unknown as { __e2eBandaCanal?: BroadcastChannel }
      w.__e2eBandaCanal?.postMessage({ tipo: 'estado', state: { ...estado, faseActual: 'mezcla', eventos: [...estado.eventos, { id: 'e3', timestamp: 3, fase: 'mezcla', agenteId: 'mix', agenteNombre: 'Mezcla E2E', rol: 'mezcla', mensaje: 'Ajustando la mezcla' }] } })
    },
    { estado: ESTADO },
  )
  await expect(vivo).toContainText('Paso 7: mezclando', { timeout: 10_000 })
  await expect(vivo).toContainText('Mezcla E2E')

  // «Detener» desde la flotante se lo pide a la ventana principal.
  await vivo.getByRole('button', { name: 'Detener' }).click()
  await expect.poll(() => page.evaluate(() => (window as unknown as { __e2eBandaDetener?: number }).__e2eBandaDetener ?? 0), { timeout: 10_000 }).toBeGreaterThan(0)
  await paso('detener desde la flotante llega a la principal')
  await satelite.close().catch(() => {})
})
