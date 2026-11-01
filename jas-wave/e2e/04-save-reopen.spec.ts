/**
 * Escenario 4: guardar y reabrir.
 * El diálogo nativo no se automatiza: la ruta se fija con project.update { ruta } (el bridge
 * autenticado concede su carpeta para la sesión) y se guarda con project.save.
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, findTrack, newProject, tracks } from './fixtures/project'

const app = setupJasWave({ label: 'save', bridge: true })

const TRACK = 'E2E Guardada'

test('guarda .jaswave, crea .bak al resguardar y project.load restaura la pista', async () => {
  const { bridge, workDir } = app()
  const projDir = path.join(workDir, 'proyectos')
  fs.mkdirSync(projDir, { recursive: true })
  const ruta = path.join(projDir, 'e2e-guardado.jaswave')

  await newProject(bridge!, 'E2E Guardado')
  await bridge!.run('project.setBpm', { bpm: 123 })
  const { trackId, clipId } = await createMidiTrackWithClip(bridge!, TRACK)

  await bridge!.run('project.update', { datos: { ruta } })
  await bridge!.run('project.save', {})
  await expect.poll(() => fs.existsSync(ruta), { message: 'existe el .jaswave' }).toBe(true)
  const saved = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  expect(JSON.stringify(saved)).toContain(TRACK)

  // Segundo guardado → copia de seguridad del anterior.
  await bridge!.run('project.setBpm', { bpm: 124 })
  await bridge!.run('project.save', {})
  await expect
    .poll(() => fs.existsSync(`${ruta}.bak`), { message: `archivos: ${fs.readdirSync(projDir).join(', ')}` })
    .toBe(true)
  // El .bak conserva la versión anterior (BPM 123); el principal la nueva.
  expect(JSON.stringify(JSON.parse(fs.readFileSync(`${ruta}.bak`, 'utf8')))).toContain(TRACK)

  // Proyecto vacío y luego cargar desde disco.
  await newProject(bridge!, 'E2E Vacío')
  expect(await findTrack(bridge!, TRACK)).toBeUndefined()

  await bridge!.run('project.load', { ruta })
  await expect.poll(async () => (await findTrack(bridge!, TRACK))?.id, { timeout: 30_000 }).toBe(trackId)
  const t = await findTrack(bridge!, TRACK)
  expect(t!.clips[0]!.id).toBe(clipId)
  expect(t!.clips[0]!.notas).toBe(4)
  expect((await bridge!.state()).bpm).toBe(124)
  expect((await tracks(bridge!)).length).toBeGreaterThanOrEqual(1)
  await expect(app().page.getByText(TRACK, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
})
