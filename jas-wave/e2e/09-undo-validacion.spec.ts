/**
 * Escenario 9 (U2 · Undo limpio, U3 · Validación):
 * - un arrastre de fader se deshace con UN solo Ctrl+Z;
 * - Ctrl+Z durante la reproducción deshace la última edición sin parar el transporte;
 * - BPM vacío o 0 en la barra de transporte se revierte (nunca llega al proyecto).
 */
import { expect, test } from '@playwright/test'
import { waitFor } from './fixtures/app'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, findTrack, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'undo-validacion', bridge: true })

const TRACK = 'E2E Fader Undo'

/** Foco fuera de inputs para que el dispatcher global reciba Ctrl+Z. */
async function focoEnDocumento(): Promise<void> {
  const { page } = app()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.locator('body').focus()
}

async function volumenDe(nombre: string): Promise<number> {
  const t = (await findTrack(app().bridge!, nombre)) as unknown as { volumen?: number } | undefined
  if (!t || typeof t.volumen !== 'number') throw new Error(`pista ${nombre} sin volumen`)
  return t.volumen
}

test('arrastrar el fader y Ctrl+Z restaura el volumen en un solo paso', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Undo')
  const { trackId } = await createMidiTrackWithClip(bridge!, TRACK)
  const inicial = await volumenDe(TRACK)

  const fader = page.getByTestId(`mixer-fader-${trackId}`).locator('[role="slider"]')
  await expect(fader).toBeVisible({ timeout: 30_000 })
  const box = await fader.boundingBox()
  expect(box).toBeTruthy()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  // Muchos pointermove = muchos track.update del mismo gesto.
  for (let i = 1; i <= 25; i++) await page.mouse.move(x, y + i * 3)
  await page.mouse.up()

  await expect
    .poll(() => volumenDe(TRACK), { timeout: 10_000, message: 'el arrastre no cambió el volumen' })
    .not.toBe(inicial)

  await focoEnDocumento()
  await page.keyboard.press('Control+z')
  await expect
    .poll(() => volumenDe(TRACK), { timeout: 10_000, message: 'un Ctrl+Z debe deshacer todo el arrastre' })
    .toBeCloseTo(inicial, 6)
  // Solo se deshizo el gesto: el clip (comando anterior) sigue ahí.
  const t = await findTrack(bridge!, TRACK)
  expect(t?.clips).toHaveLength(1)
})

test('Play + Ctrl+Z no detiene la reproducción', async () => {
  const { bridge, page } = app()
  await bridge!.run('project.setBpm', { bpm: 101 })
  const bpmPrevio = 120
  await bridge!.run('transport.toggle', {})
  await waitFor('transporte reproduciendo', async () => (await bridge!.state()).playing === true, 20_000, 250)

  await focoEnDocumento()
  await page.keyboard.press('Control+z')
  // Se deshace la última edición real (el BPM), no el Play.
  await expect.poll(async () => (await bridge!.state()).bpm, { timeout: 10_000 }).not.toBe(101)
  expect((await bridge!.state()).bpm).toBe(bpmPrevio)
  await page.waitForTimeout(800)
  expect((await bridge!.state()).playing, 'Ctrl+Z detuvo la reproducción').toBe(true)

  await bridge!.run('transport.stop', {})
  await waitFor('transporte detenido', async () => (await bridge!.state()).playing === false, 20_000, 250)
})

test('BPM vacío o 0 en la barra de transporte se revierte', async () => {
  const { bridge, page } = app()
  await bridge!.run('project.setBpm', { bpm: 97 })
  await expect.poll(async () => (await bridge!.state()).bpm, { timeout: 10_000 }).toBe(97)

  for (const texto of ['', '0', 'abc']) {
    await page.getByTestId('stat-bpm').dblclick()
    const input = page.getByTestId('stat-bpm-input')
    await expect(input).toBeVisible({ timeout: 10_000 })
    await input.fill(texto)
    await input.press('Enter')
    await expect(input).toBeHidden({ timeout: 10_000 })
    await page.waitForTimeout(300)
    expect((await bridge!.state()).bpm, `«${texto}» no debe cambiar el BPM`).toBe(97)
  }
  await expect(page.getByTestId('stat-bpm')).toContainText('97')

  // Un valor válido sí se confirma.
  await page.getByTestId('stat-bpm').dblclick()
  await page.getByTestId('stat-bpm-input').fill('133')
  await page.getByTestId('stat-bpm-input').press('Enter')
  await expect.poll(async () => (await bridge!.state()).bpm, { timeout: 10_000 }).toBe(133)
})
