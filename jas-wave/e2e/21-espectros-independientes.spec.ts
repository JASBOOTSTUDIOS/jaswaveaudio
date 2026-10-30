/**
 * Los mini espectros del mixer son independientes: abrir el de una tira no cierra el de otra,
 * y cerrar uno deja los demás abiertos.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'espectros', bridge: true })

test('varias tiras muestran su espectro a la vez', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Espectros', page)
  const a = await createMidiTrackWithClip(bridge!, 'E2E Esp A')
  const b = await createMidiTrackWithClip(bridge!, 'E2E Esp B')

  const espectroDe = (trackId: string) =>
    page
      .getByTestId(`mixer-strip-${trackId}`)
      .locator('canvas[aria-label="Espectro de frecuencias"], p[title="El espectro lo calcula el plugin host"]')
  const botonDe = (trackId: string, nombre: string) =>
    page.getByTestId(`mixer-strip-${trackId}`).getByRole('button', { name: `Espectro de ${nombre}` })

  // El botón vive en la sección de extras, que solo se muestra con el panel alto: se sube el divisor.
  await expect(page.locator('[data-tool-viewport="mixer"]')).toBeVisible({ timeout: 30_000 })
  const divisor = page.locator('[data-panel-group-direction="vertical"] > [data-panel-resize-handle-id]').first()
  const caja = await divisor.boundingBox()
  expect(caja).toBeTruthy()
  await page.mouse.move(caja!.x + caja!.width / 2, caja!.y + caja!.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(caja!.x + caja!.width / 2, caja!.y - ((caja!.y - 80) * i) / 20)
  }
  await page.mouse.up()

  await expect(botonDe(a.trackId, 'E2E Esp A')).toBeVisible({ timeout: 10_000 })
  await botonDe(a.trackId, 'E2E Esp A').click()
  await botonDe(b.trackId, 'E2E Esp B').click()
  await expect(espectroDe(a.trackId)).toHaveCount(1)
  await expect(espectroDe(b.trackId)).toHaveCount(1)

  // Cerrar A no toca B.
  await botonDe(a.trackId, 'E2E Esp A').click()
  await expect(espectroDe(a.trackId)).toHaveCount(0)
  await expect(espectroDe(b.trackId)).toHaveCount(1)
})
