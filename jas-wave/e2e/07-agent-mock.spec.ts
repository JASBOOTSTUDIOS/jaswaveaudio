/**
 * Escenario 7: turno completo del agente por la UI con el proveedor mock (A1 + A2).
 * JASWAVE_AI_MOCK=<guion> → el gateway responde de forma determinista (tool call nativa).
 * Pedido en el chat → tarjeta Aplicar (run en espera persistido en userData/agent-runs) →
 * «Todas» → el motor aplica, reanuda el loop y completa → BPM cambiado en el proyecto.
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'
import { waitFor } from './fixtures/app'

const SCRIPT = path.join(__dirname, 'fixtures', 'agent-mock-tempo.json')
const app = setupJasWave({ label: 'agent-mock', bridge: true, env: { JASWAVE_AI_MOCK: SCRIPT } })

function runFiles(userData: string): Array<Record<string, any>> {
  const dir = path.join(userData, 'agent-runs')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')))
}

test('el proveedor mock está online en el panel', async () => {
  const { page, bridge } = app()
  await newProject(bridge!, 'E2E Agente Mock')
  await bridge!.run('project.setBpm', { bpm: 120 })
  const chat = page.locator('aside[data-coproducer-chat]')
  await expect(chat).toBeVisible({ timeout: 30_000 })
  await expect(chat.getByText('Online', { exact: true })).toBeVisible({ timeout: 30_000 })
})

test('turno completo: pedido → tarjeta Aplicar → aplicar → completado y run persistido', async () => {
  const { page, bridge, userData } = app()
  const chat = page.locator('aside[data-coproducer-chat]')
  const input = chat.locator('textarea')
  await input.click()
  await input.fill('pon el tempo a 97 bpm')
  await input.press('Enter')

  // La tool call nativa del mock queda como propuesta (create/auto piden Aplicar antes de mutar).
  const applyAll = chat.locator('[data-apply-remaining]').first()
  await expect(applyAll).toBeVisible({ timeout: 90_000 })
  expect((await bridge!.state()).bpm).toBe(120)

  const waiting = await waitFor(
    'run en espera persistido',
    async () => runFiles(userData).find((r) => r.status === 'waiting-user' && r.pending?.kind === 'apply'),
    30_000,
  )
  expect(waiting.programId).toBe('coproductor-legacy')
  expect(waiting.log.some((l: any) => l.kind === 'chat')).toBe(true)

  await applyAll.click()
  await expect.poll(async () => (await bridge!.state()).bpm, { timeout: 60_000 }).toBe(97)

  const done = await waitFor(
    'run completado',
    async () => runFiles(userData).find((r) => r.id === waiting.id && r.status === 'completed'),
    60_000,
  )
  expect(done.budget.modelCalls).toBeGreaterThanOrEqual(2)
  // Nada de chats sin system prompt ni errores de consola por el turno.
  expect(app().consoleErrors.filter((e) => /agent|engine|ai-chat/i.test(e))).toEqual([])
})
