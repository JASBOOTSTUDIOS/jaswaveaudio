/**
 * El divisor del panel inferior no deja el Mixer por debajo de su alto mínimo (M/S + fader fijo): al arrastrarlo
 * hasta abajo, el panel se detiene y el mixer no necesita scroll vertical.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'mixer-alto-minimo', bridge: true })

test('el panel del mixer no baja de su mínimo ni hace scroll', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Mixer Alto')
  await createMidiTrackWithClip(bridge!, 'E2E Alto')

  const visor = page.locator('[data-tool-viewport="mixer"]')
  await expect(visor).toBeVisible({ timeout: 30_000 })

  // Divisor entre Arrange y la zona inferior (grupo vertical).
  const divisor = page.locator('[data-panel-group-direction="vertical"] > [data-panel-resize-handle-id]').first()
  const caja = await divisor.boundingBox()
  expect(caja).toBeTruthy()
  const ventana = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  await page.mouse.move(caja!.x + caja!.width / 2, caja!.y + caja!.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(caja!.x + caja!.width / 2, caja!.y + ((ventana.height - caja!.y) * i) / 20)
  }
  await page.mouse.up()

  await expect
    .poll(async () => visor.evaluate((el) => el.clientHeight), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(319)
  const scroll = await visor.evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(scroll, 'el mixer no debe tener scroll vertical en su alto mínimo').toBeLessThanOrEqual(1)
})
