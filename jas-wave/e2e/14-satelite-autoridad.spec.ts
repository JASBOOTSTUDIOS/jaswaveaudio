/**
 * Escenario 14 (U7): los satélites no tienen autoridad sobre el proyecto.
 *
 * El satélite (ventana undock) reenvía al primario lo que el usuario pide:
 * comandos, deshacer/rehacer, guardar y abrir. El archivo `.jaswave` lo
 * guarda siempre el primario (que tiene el estado completo, con waveforms).
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'

const app = setupJasWave({ label: 'u7-satelite', bridge: true })

const WAVEFORM = [0.5, -0.25, 0.75, -0.5, 0.125, 0.25]

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

/** Estado del satélite (lo que el primario le ha enviado). */
function estadoEnSatelite(satelite: Page): Promise<any> {
  return satelite.evaluate(() => (globalThis as any).__jaswaveSateliteEstado ?? null)
}

test('el satelite no manda: sus comandos los ejecuta la ventana principal', async () => {
  const { bridge, browser, page, workDir } = app()

  const projDir = path.join(workDir, 'proyectos')
  fs.mkdirSync(projDir, { recursive: true })
  const ruta = path.join(projDir, 'satelite.jaswave')

  // Proyecto con un clip de audio CON waveform (el estado "slim" del satélite lo pierde).
  await newProject(bridge!, 'Proyecto Con Satelite')
  await bridge!.run('project.update', { datos: { ruta } })
  await bridge!.run('track.create', { nombre: 'Audio Satelite', tipo: 'audio' })
  const pista = await (async () => {
    for (let i = 0; i < 40; i++) {
      const estado: any = await bridge!.state()
      const t = (estado.tracks ?? []).find((x: any) => x.nombre === 'Audio Satelite')
      if (t) return t
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('La pista no se creó')
  })()
  await bridge!.run('clip.create', {
    pistaId: pista.id,
    nombre: 'Clip Con Onda',
    inicio: 0,
    duracion: 4,
    waveform: WAVEFORM,
  })
  await bridge!.run('project.save', {})
  await expect.poll(() => fs.existsSync(ruta), { message: 'existe el .jaswave' }).toBe(true)
  expect(fs.readFileSync(ruta, 'utf8')).toContain('"waveform"')

  // Ventana satélite: la abre la propia app (mismo camino que el botón "desacoplar").
  await page.evaluate(() => (window as any).electron.openToolWindow('docs', 'Documentos', {}))
  const satelite = await esperarSatelite(browser, 'docs')
  await satelite.waitForLoadState('domcontentloaded')

  // El satélite pide el estado al primario y lo recibe.
  await expect
    .poll(async () => estadoEnSatelite(satelite), { timeout: 30_000, message: 'el satélite recibe el estado' })
    .not.toBeNull()

  // Un comando lanzado en el satélite lo ejecuta la ventana principal.
  await satelite.evaluate(() =>
    (globalThis as any).__jaswaveSateliteEjecutar('track.create', { nombre: 'Creada En Satelite', tipo: 'midi' }),
  )
  await expect
    .poll(
      async () => {
        const estado: any = await bridge!.state()
        return (estado.tracks ?? []).some((t: any) => t.nombre === 'Creada En Satelite')
      },
      { timeout: 30_000, message: 'la ventana principal ejecuta el comando del satélite' },
    )
    .toBe(true)

  // Y el satélite recibe de vuelta el estado nuevo.
  await expect
    .poll(
      async () => {
        const estado = await estadoEnSatelite(satelite)
        return (estado?.project?.tracks ?? []).some((t: any) => t.nombre === 'Creada En Satelite')
      },
      { timeout: 30_000, message: 'el satélite recibe el estado nuevo' },
    )
    .toBe(true)

  // Ctrl+S en el satélite → lo guarda el primario (no el satélite).
  await satelite.bringToFront()
  await satelite.keyboard.press('Control+s')

  await expect
    .poll(() => fs.readFileSync(ruta, 'utf8'), { timeout: 30_000, message: 'el proyecto se guarda' })
    .toContain('Creada En Satelite')

  // El archivo guardado por el primario conserva los datos que el satélite no tiene.
  const guardado = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  const clips = (guardado.project?.tracks ?? []).flatMap((t: any) => t.clips ?? [])
  expect(clips.length).toBeGreaterThan(0)
  expect(JSON.stringify(clips)).toContain('Clip Con Onda')
  expect(fs.readFileSync(ruta, 'utf8')).toContain('"waveform"')
})
