/**
 * Escenario 7 (U5 · Atajos y foco): un atajo actúa solo en el editor con foco y
 * nunca se ejecutan dos acciones para la misma tecla.
 */
import { expect, test } from '@playwright/test'
import { waitFor } from './fixtures/app'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'piano-focus', bridge: true })

const TRACK = 'E2E Piano Focus'
let ids: { trackId: string; clipId: string }

/** Abre el piano roll (doble clic en el clip) y deja el foco dentro del panel. */
async function openPianoRollWithFocus(): Promise<void> {
  const { page } = app()
  await page.locator(`[data-clip-id="${ids.clipId}"]`).dblclick()
  const magnet = page.locator('button[aria-label="Imán"]')
  await expect(magnet).toBeVisible({ timeout: 30_000 })
  // Un clic dentro del panel: el foco queda en su raíz (contexto del piano roll).
  await magnet.click()
}

test('Delete en el piano roll borra notas y el clip sigue en el arrange', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Atajos')
  ids = await createMidiTrackWithClip(bridge!, TRACK)

  await openPianoRollWithFocus()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')

  const track = await waitFor(
    'notas borradas sin perder el clip',
    async () => {
      const st = await bridge!.state()
      const tr = st.tracks.find((x: { id: string }) => x.id === ids.trackId)
      if (!tr) throw new Error('la pista desapareció: el dispatcher global también borró el clip')
      if ((tr.clips?.length ?? 0) === 0) throw new Error('el clip fue borrado: el atajo global se ejecutó además del local')
      return (tr.clips[0]?.notas ?? -1) === 0 ? tr : null
    },
    20_000,
    500,
  )
  expect(track.clips).toHaveLength(1)
})

test('Enter en el piano roll detiene el transporte sin volver a alternarlo', async () => {
  const { bridge, page } = app()
  await bridge!.run('transport.toggle', {})
  await waitFor(
    'transporte reproduciendo',
    async () => (await bridge!.state()).playing === true,
    20_000,
    250,
  )

  await openPianoRollWithFocus()
  await page.keyboard.press('Enter')

  await expect
    .poll(async () => (await bridge!.state()).playing, {
      timeout: 10_000,
      message: 'Enter no detuvo el transporte',
    })
    .toBe(false)
  // Si Enter ejecutara dos acciones (stop local + pause global) volvería a reproducir.
  await page.waitForTimeout(1_200)
  expect(
    (await bridge!.state()).playing,
    'Enter ejecutó más de una acción',
  ).toBe(false)
})

test('la rueda sobre BPM solo altera el valor con el control enfocado o con Alt', async () => {
  const { bridge, page } = app()
  const stat = page.locator('span:text-is("BPM")').locator('..')
  await expect(stat).toBeVisible()

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  const box = await stat.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)

  const antes = (await bridge!.state()).bpm
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(400)
  expect((await bridge!.state()).bpm, 'rueda sin foco no debe cambiar el BPM').toBe(antes)

  await page.keyboard.down('Alt')
  await page.mouse.wheel(0, -120)
  await page.keyboard.up('Alt')
  await expect
    .poll(async () => (await bridge!.state()).bpm, {
      timeout: 5_000,
      message: 'Alt+rueda debe cambiar el BPM',
    })
    .not.toBe(antes)

  const conAlt = (await bridge!.state()).bpm
  await stat.click() // el control queda enfocado
  await page.mouse.wheel(0, 120)
  await expect
    .poll(async () => (await bridge!.state()).bpm, {
      timeout: 5_000,
      message: 'rueda con el control enfocado debe cambiar el BPM',
    })
    .not.toBe(conAlt)
})
