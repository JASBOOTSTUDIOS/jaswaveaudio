/**
 * Escenario 7: turno completo del agente por la UI con el proveedor mock (A1 + A2).
 * JASWAVE_AI_MOCK=<guion> → el gateway responde de forma determinista (tool call nativa).
 * Pedido en el chat → el agente ejecuta la herramienta → el chat muestra el progreso y una respuesta
 * legible (sin nombres internos) → BPM cambiado y run completado en userData/agent-runs.
 * También: el menú «/» con explicaciones para usuarios y los comandos locales (/programar).
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

test('turno completo: pedido → el agente ejecuta → respuesta legible y run persistido', async () => {
  const { page, bridge, userData } = app()
  const chat = page.locator('aside[data-coproducer-chat]')
  const input = chat.locator('textarea')
  await input.click()
  await input.fill('pon el tempo a 97 bpm')
  await input.press('Enter')

  await expect.poll(async () => (await bridge!.state()).bpm, { timeout: 90_000 }).toBe(97)
  await expect(chat.locator('[data-agente-progreso="listo"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(chat.getByText(/quedó en 97 BPM/)).toBeVisible()
  const texto = await chat.innerText()
  expect(texto).not.toMatch(/project\.setBpm|<<<|>>>/)

  const done = await waitFor(
    'run completado',
    async () => runFiles(userData).find((r) => r.programId === 'jaswave-agente' && r.status === 'completed'),
    60_000,
  )
  expect(done.budget.modelCalls).toBeGreaterThanOrEqual(2)
  expect(app().consoleErrors.filter((e) => /agent|engine|ai-chat/i.test(e))).toEqual([])
})

test('menú «/»: comandos con explicación sencilla y /programar responde sin tecnicismos', async () => {
  const { page } = app()
  const chat = page.locator('aside[data-coproducer-chat]')
  const input = chat.locator('textarea')
  await input.click()
  await input.fill('/')
  const menu = chat.locator('#jw-mention-list')
  await expect(menu).toBeVisible()
  await expect(menu.getByText('¿Qué quieres hacer?')).toBeVisible()
  await expect(menu.getByText('preparo un plan paso a paso sin tocar tu proyecto')).toBeVisible()
  expect(await menu.innerText()).not.toMatch(/\.md|Music Build|mapa MIDI/)
  await input.press('Escape')

  await input.fill('/programar lista')
  await input.press('Enter')
  await expect(chat.getByText('No hay tareas programadas.', { exact: false })).toBeVisible({ timeout: 15_000 })
  expect(await chat.innerText()).not.toMatch(/<id>|`/)
})
