/**
 * Escenario 28: acciones del agente que no son comandos de la tienda (track.addVstLayer, mix.eq) con el
 * proveedor mock. Antes fallaban con «Comando no registrado» (la ruta de confirmación las ejecutaba como
 * comando) y cada mix.eq apilaba otro EQ en la pista.
 */
import { expect, test } from '@playwright/test'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'

const SCRIPT = path.join(__dirname, 'fixtures', 'agent-mock-instrumento-mezcla.json')
const app = setupJasWave({ label: 'agente-instrumento', bridge: true, env: { JASWAVE_AI_MOCK: SCRIPT } })

test('el agente carga el instrumento y ecualiza sin duplicar plugins', async () => {
  test.setTimeout(240_000)
  const { page, bridge } = app()
  await newProject(bridge!, 'E2E Instrumento y mezcla', page)
  await bridge!.run('track.create', { nombre: 'Piano', tipo: 'midi', id: 'piano-diag' })
  const chat = page.locator('aside[data-coproducer-chat]')
  await expect(chat.getByText('Online', { exact: true })).toBeVisible({ timeout: 30_000 })
  // Lo que toca la IA se ilumina un momento (mixer y cabecera de pista): se registra qué brilló.
  await page.evaluate(() => {
    const w = window as unknown as { __brillos: string[] }
    w.__brillos = []
    new MutationObserver(() => {
      for (const el of Array.from(document.querySelectorAll('[data-ia-resaltado="si"]'))) {
        const donde = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?'
        if (!w.__brillos.includes(donde)) w.__brillos.push(donde)
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ia-resaltado'] })
  })
  const input = chat.locator('textarea')
  await input.click()
  await input.fill('añade una capa de piano y ecualiza')
  await input.press('Enter')
  await expect(chat.getByText('Listo.').first()).toBeVisible({ timeout: 120_000 })
  const brillos = await page.evaluate(() => (window as unknown as { __brillos: string[] }).__brillos)
  console.log(`[e2e] brilló: ${brillos.join(', ')}`)
  expect(brillos.some((d) => /piano-diag/.test(d)), `la pista tocada por la IA debe iluminarse (brilló: ${brillos.join(', ')})`).toBe(true)
  const plugins = async () =>
    (((await bridge!.state()).tracks ?? []).find((t: { id: string }) => t.id === 'piano-diag')?.plugins ?? []).map((p: { nombre: string }) => p.nombre)
  await expect.poll(plugins, { timeout: 30_000 }).toContain('JasWave Grand Piano')
  const lista = await plugins()
  expect(lista.filter((n: string) => n === 'JasWave EQ Parametric Pro')).toHaveLength(1)
  const sonido = await bridge!.run('analysis.trackSound', {})
  expect(JSON.stringify(sonido)).not.toMatch(/sin_instrumento/)
})
