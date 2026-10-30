/**
 * K3 — Zonas MIDI y modo Directo: las zonas creadas por comando aparecen en el panel «Zonas MIDI» (split de dos
 * pistas), se editan desde el panel con undo, PANIC no rompe nada y el candado Directo bloquea Delete/Ctrl+Z y
 * muestra el aviso.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'zonas-midi', bridge: true })

type ZonaE2E = { id: string; pistaId: string; lo: number; hi: number; transposicion: number }
type EstadoE2E = { project: { directo?: { zonas: ZonaE2E[]; bloqueo?: boolean; seguridad?: { activa: boolean } } } }

const zonasDe = async () => ((await app().bridge!.state()) as unknown as EstadoE2E).project.directo?.zonas ?? []

test('un split de dos pistas se ve y se edita en el panel «Zonas MIDI»', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Zonas MIDI')
  const bajo = await createMidiTrackWithClip(bridge!, 'E2E Bajo')
  const piano = await createMidiTrackWithClip(bridge!, 'E2E Piano')

  await bridge!.run('midi.zones.add', { pistaId: bajo.trackId, lo: 21, hi: 59, transposicion: -12 })
  await bridge!.run('midi.zones.add', { pistaId: piano.trackId, lo: 60, hi: 108 })
  expect(await zonasDe()).toHaveLength(2)

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: 'midi-zones' } })))
  const panel = page.getByTestId('zonas-panel')
  await expect(panel).toBeVisible({ timeout: 30_000 })
  const items = panel.getByTestId('zona-item')
  await expect(items).toHaveCount(2)
  await expect(items.first().getByTestId('zona-lo')).toHaveValue('21')
  await expect(items.first().getByTestId('zona-hi')).toHaveValue('59')
  await expect(items.nth(1).getByTestId('zona-lo')).toHaveValue('60')

  // Editar el límite agudo del bajo desde el panel pasa por el comando (con undo).
  await items.first().getByTestId('zona-hi').fill('64')
  await expect.poll(async () => (await zonasDe())[0]?.hi).toBe(64)
  await bridge!.run('history.undo', {})
  await expect.poll(async () => (await zonasDe())[0]?.hi).toBe(59)

  // midi.zones.set sustituye todas las zonas de una pista.
  await bridge!.run('midi.zones.set', { pistaId: piano.trackId, zonas: [{ pistaId: piano.trackId, lo: 48, hi: 96, transposicion: 12 }] })
  await expect(items).toHaveCount(2)
  await expect(items.nth(1).getByTestId('zona-lo')).toHaveValue('48')

  await items.nth(1).getByTestId('zona-quitar').click()
  await expect(items).toHaveCount(1)
})

test('PANIC y el candado Directo funcionan desde el transporte', async () => {
  const { bridge, page } = app()
  const errores: string[] = []
  page.on('pageerror', (e) => errores.push(e.message))

  const panic = page.getByTestId('boton-panic')
  await expect(panic).toBeVisible({ timeout: 30_000 })
  await panic.click()
  await panic.click()

  const directo = page.getByTestId('modo-directo')
  await expect(directo).toHaveAttribute('aria-pressed', 'false')
  await directo.click()
  await expect(directo).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('banner-directo')).toBeVisible()
  await expect.poll(async () => ((await bridge!.state()) as unknown as EstadoE2E).project.directo?.bloqueo).toBe(true)

  // Con el candado puesto, Ctrl+Z no deshace: la zona que queda sigue ahí y el aviso aparece.
  const antes = (await zonasDe()).length
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('banner-directo')).toContainText('bloqueado')
  expect((await zonasDe()).length).toBe(antes)

  await directo.click()
  await expect(directo).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('banner-directo')).toHaveCount(0)

  // Seguridad del máster por comando: el transporte lo indica.
  await bridge!.run('directo.setSafety', { activa: true, techoDb: -0.5 })
  await expect(page.getByTestId('directo-seguridad')).toBeVisible()
  await bridge!.run('directo.setSafety', { activa: false })
  await expect(page.getByTestId('directo-seguridad')).toHaveCount(0)

  expect(errores).toEqual([])
})
