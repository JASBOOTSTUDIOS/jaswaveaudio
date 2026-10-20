/**
 * Escenario 8 (U1 · Cambios sin guardar): cerrar la ventana o crear otro proyecto
 * con cambios siempre pregunta; Cancelar mantiene la app y No guardar la cierra.
 */
import { expect, test } from '@playwright/test'
import { waitFor } from './fixtures/app'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'close-guard', bridge: true })

const dialog = () => app().page.getByTestId('unsaved-changes-dialog')
const closeButton = () => app().page.locator('div.h-11 button[aria-label="Cerrar"]').first()

test('cerrar con cambios abre el diálogo y Cancelar mantiene la app abierta', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Cierre')
  await createMidiTrackWithClip(bridge!, 'E2E Pista Cierre')

  await closeButton().click()
  await expect(dialog()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('unsaved-cancel').click()
  await expect(dialog()).toBeHidden({ timeout: 10_000 })

  // Sigue viva, sin cerrar ni perder el proyecto.
  expect(await page.evaluate(() => typeof (window as { electron?: unknown }).electron)).toBe('object')
  const st = await bridge!.state()
  expect(st.nombre).toBe('E2E Cierre')
  expect(st.tracks).toHaveLength(1)
})

test('crear un proyecto nuevo desde la IA con cambios pide confirmación', async () => {
  const { bridge, page } = app()
  const pending = bridge!.actions([{ type: 'project.new', payload: { nombre: 'E2E Nuevo' } }], 60_000)

  await expect(dialog()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('unsaved-cancel').click()
  await expect(dialog()).toBeHidden({ timeout: 10_000 })

  const res = await pending
  expect(res.results[0]?.success).toBe(false)
  expect((await bridge!.state()).nombre).toBe('E2E Cierre')
})

test('No guardar cierra la aplicación', async () => {
  const { page } = app()
  await closeButton().click()
  await expect(dialog()).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('unsaved-discard').click()
  await waitFor('la app termina', async () => app().proc.exitCode !== null, 40_000, 250)
})
