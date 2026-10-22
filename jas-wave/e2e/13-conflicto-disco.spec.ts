/**
 * Escenario 13 (U7): conflicto por cambio del proyecto en disco.
 *
 * Si el `.jaswave` cambia fuera de JasWave, al guardar aparece el diálogo
 * Sobrescribir / Guardar como / Cancelar. Nunca se pisa el archivo sin preguntar.
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'u7-conflicto', bridge: true })

const TRACK = 'Pista En Conflicto'

test('el archivo cambiado en disco pide decision antes de sobrescribir', async () => {
  const { bridge, page, workDir } = app()

  const projDir = path.join(workDir, 'proyectos')
  fs.mkdirSync(projDir, { recursive: true })
  const ruta = path.join(projDir, 'conflicto.jaswave')

  await newProject(bridge!, 'Proyecto En Conflicto')
  await createMidiTrackWithClip(bridge!, TRACK)
  await bridge!.run('project.update', { datos: { ruta } })
  await bridge!.run('project.save', {})
  await expect.poll(() => fs.existsSync(ruta), { message: 'existe el .jaswave' }).toBe(true)

  // Otro programa cambia el archivo por fuera (mtime claramente distinto).
  fs.writeFileSync(ruta, JSON.stringify({ version: 999, tracks: [] }), 'utf8')
  const pasado = new Date(Date.now() - 60_000)
  fs.utimesSync(ruta, pasado, pasado)

  // Guardar: debe aparecer el diálogo de conflicto (la llamada queda en espera).
  const guardado = bridge!.actions([{ type: 'project.save' }])
  const dialogo = page.getByTestId('save-conflict-dialog')
  await expect(dialogo).toBeVisible({ timeout: 30_000 })

  // Cancelar: el archivo externo se respeta.
  await page.getByTestId('save-conflict-cancel').click()
  const r1 = await guardado
  expect(r1.results?.[0]?.success, 'el guardado se cancela').toBe(false)
  expect(fs.readFileSync(ruta, 'utf8')).toContain('"version":999')

  // Sobrescribir: ahora sí se escribe el proyecto de JasWave.
  const guardado2 = bridge!.actions([{ type: 'project.save' }])
  await expect(dialogo).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('save-conflict-overwrite').click()
  const r2 = await guardado2
  expect(r2.results?.[0]?.success, 'el guardado sobrescribe').toBe(true)
  expect(fs.readFileSync(ruta, 'utf8')).toContain(TRACK)
})
