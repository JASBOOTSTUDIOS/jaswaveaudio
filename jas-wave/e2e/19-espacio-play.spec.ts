/**
 * La barra espaciadora reproduce/pausa en todo el DAW, también justo después de seleccionar una pista
 * en el Arrange (cabecera de pista) o en el Mixer (tira de canal).
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'espacio-play', bridge: true })

const TRACK = 'E2E Espacio'

async function reproduciendo(): Promise<boolean> {
  return Boolean((await app().bridge!.state()).playing)
}

async function pararSiSuena(): Promise<void> {
  if (await reproduciendo()) await app().bridge!.run('transport.stop', {})
  await expect.poll(reproduciendo, { timeout: 10_000 }).toBe(false)
}

test('espacio reproduce tras seleccionar la pista en el Arrange', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Espacio Arrange', page)
  const { trackId } = await createMidiTrackWithClip(bridge!, TRACK)
  await pararSiSuena()

  const cabecera = page.getByTestId(`arrange-track-header-${trackId}`)
  await expect(cabecera).toBeVisible({ timeout: 30_000 })
  await cabecera.click()
  await page.keyboard.press('Space')
  await expect.poll(reproduciendo, { timeout: 10_000, message: 'espacio no inició la reproducción' }).toBe(true)
  await page.keyboard.press('Space')
  await expect.poll(reproduciendo, { timeout: 10_000, message: 'espacio no pausó' }).toBe(false)
})

test('espacio reproduce tras seleccionar la tira en el Mixer', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Espacio Mixer', page)
  const { trackId } = await createMidiTrackWithClip(bridge!, TRACK)
  await pararSiSuena()

  const tira = page.getByTestId(`mixer-strip-${trackId}`)
  await expect(tira).toBeVisible({ timeout: 30_000 })
  // Clic en el nombre (selecciona la pista) y después en el botón M dos veces (queda el foco en un botón).
  await tira.locator('p').first().click()
  await page.keyboard.press('Space')
  await expect.poll(reproduciendo, { timeout: 10_000, message: 'espacio no inició la reproducción' }).toBe(true)
  await page.keyboard.press('Space')
  await expect.poll(reproduciendo, { timeout: 10_000 }).toBe(false)

  const mute = tira.getByRole('button', { name: `Silenciar ${TRACK}` })
  await mute.click()
  await mute.click()
  await page.keyboard.press('Space')
  await expect.poll(reproduciendo, { timeout: 10_000, message: 'espacio con el foco en M' }).toBe(true)
  await pararSiSuena()
})
