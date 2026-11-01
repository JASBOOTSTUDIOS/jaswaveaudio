/**
 * Escenario 3: flujo de proyecto vía bridge + UI.
 * project.new → BPM → pista MIDI con clip y notas → la pista aparece en la UI →
 * Ctrl+Z / Ctrl+Y deshacen y rehacen manteniendo ids estables.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, findTrack, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'project', bridge: true })

const TRACK = 'E2E Bajo MIDI'
let ids: { trackId: string; clipId: string }

test('el bridge expone el catálogo de acciones necesario', async () => {
  const r = await app().bridge!.request('GET', '/actions')
  expect(r.status).toBe(200)
  const list = (Array.isArray(r.json) ? r.json : (r.json?.actions ?? [])) as Array<{ type: string }>
  const types = new Set(list.map((a) => a.type))
  for (const t of ['project.new', 'project.setBpm', 'track.create', 'midi.clip.create', 'project.save', 'project.load', 'render.start']) {
    expect(types.has(t), `acción ${t} en GET /actions`).toBe(true)
  }
})

test('nuevo proyecto, BPM y pista MIDI con clip de notas', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Proyecto')
  await bridge!.run('project.setBpm', { bpm: 97 })
  ids = await createMidiTrackWithClip(bridge!, TRACK)

  const st = await bridge!.state()
  expect(st.bpm).toBe(97)
  const t = st.tracks.find((x: any) => x.id === ids.trackId)
  expect(t).toMatchObject({ nombre: TRACK, tipo: 'midi' })
  expect(t.clips).toHaveLength(1)
  expect(t.clips[0].notas).toBe(4)

  await expect(page.getByText(TRACK, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
})

test('Ctrl+Z / Ctrl+Y deshacen y rehacen con ids estables', async () => {
  const { bridge, page } = app()
  // Foco en el documento (fuera de inputs) para que el dispatcher de atajos reciba la tecla.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.locator('body').focus()

  const pressUntil = async (key: string, cond: () => Promise<boolean>, max = 4) => {
    for (let i = 0; i < max; i++) {
      if (await cond()) return
      await page.keyboard.press(key)
      await page.waitForTimeout(400)
    }
    await expect.poll(cond, { timeout: 10_000, message: `${key} no alcanzó el estado esperado` }).toBe(true)
  }

  // Deshacer: primero desaparece el clip, después la pista.
  await pressUntil('Control+z', async () => !(await findTrack(bridge!, TRACK)))
  await expect(page.getByText(TRACK, { exact: true })).toHaveCount(0, { timeout: 15_000 })
  // El BPM (comando anterior) no debe deshacerse junto con la pista.
  expect((await bridge!.state()).bpm).toBe(97)

  // Rehacer: vuelve la pista y su clip con los mismos ids.
  await pressUntil('Control+y', async () => {
    const t = await findTrack(bridge!, TRACK)
    return !!t && t.clips.length === 1
  })
  const t = await findTrack(bridge!, TRACK)
  expect(t!.id).toBe(ids.trackId)
  expect(t!.clips[0]!.id).toBe(ids.clipId)
  expect(t!.clips[0]!.notas).toBe(4)
  await expect(page.getByText(TRACK, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
})
