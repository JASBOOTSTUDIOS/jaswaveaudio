/**
 * Escenario 27: el chat del asistente con el MODELO REAL del backend (no el simulado), por la UI.
 *  - Inicia sesión con el usuario de pruebas en «Ventanas → Cuenta» (instancia aislada, sin tocar la del usuario).
 *  - /configurar con la etiqueta de modo: la IA crea y borra una habilidad en la carpeta de configuración.
 *  - Fuera del modo, «créame un prompt…» crea el archivo.
 *  - /banda: el equipo de agentes produce un tema corto y deja pistas con clips.
 *
 * Gasta créditos de IA: solo corre si se definen JASWAVE_E2E_EMAIL y JASWAVE_E2E_PASSWORD (usuario de pruebas
 * del backend local). Las respuestas reales se imprimen con el prefijo [ia] para revisar el comportamiento.
 */
import { expect, test, type Locator } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { newProject, tracks } from './fixtures/project'
import { buscarArchivos, crearPasos } from './fixtures/pasos'

const EMAIL = process.env.JASWAVE_E2E_EMAIL ?? ''
const PASSWORD = process.env.JASWAVE_E2E_PASSWORD ?? ''
test.skip(!EMAIL || !PASSWORD, 'IA real: define JASWAVE_E2E_EMAIL y JASWAVE_E2E_PASSWORD')

const app = setupJasWave({ label: 'ia-real', bridge: true })
const paso = crearPasos(() => app().page, '27-ia-real')

const carpeta = () => path.join(app().userData, 'asistente')
const docs = (sub: string) => buscarArchivos(path.join(carpeta(), sub), (n) => n.endsWith('.md'))
const papelera = () => buscarArchivos(path.join(carpeta(), '.papelera'), () => true)

/** Texto técnico que nunca debe ver el usuario. */
const FUGAS = /<<<|PROHIBIDO|\bconfig_(listar|leer|escribir|eliminar|restaurar)\b|"tool_calls"|```json|\[DIRECTIVA/

function chat() {
  return app().page.locator('aside[data-coproducer-chat]')
}

let vistos = 0
/** Imprime los mensajes nuevos del chat (lo que el modelo real contestó). */
async function mostrarNuevos(): Promise<string[]> {
  const textos = await chat().locator('[data-chat-selectable]').allInnerTexts()
  const nuevos = textos.slice(vistos)
  vistos = textos.length
  for (const t of nuevos) console.log(`[ia] ${t.replace(/\s+/g, ' ').trim().slice(0, 600)}`)
  return nuevos
}

/** Espera a que el asistente termine el turno (sin botón «Detener» y la caja habilitada). */
async function esperarTurno(timeout = 240_000): Promise<void> {
  const input = chat().locator('textarea').first()
  await app().page.waitForTimeout(1_500)
  await expect(chat().getByRole('button', { name: 'Detener agente' })).toHaveCount(0, { timeout })
  await expect(input).toBeEnabled({ timeout: 10_000 })
}

/** Si el modelo hizo una pregunta con opciones, elige la recomendada (o la primera) y la envía. */
async function responderPreguntas(max = 3): Promise<void> {
  for (let i = 0; i < max; i++) {
    const enviarResp = chat().getByRole('button', { name: 'Enviar respuestas' }).last()
    if (!(await enviarResp.isVisible().catch(() => false))) return
    const recomendada = chat().getByRole('button', { name: /recomendad/i }).last()
    if (await recomendada.isVisible().catch(() => false)) await recomendada.click()
    else await chat().getByRole('button', { name: 'Que decida el asistente' }).last().click()
    if (await enviarResp.isVisible().catch(() => false)) await enviarResp.click().catch(() => undefined)
    await paso(`respondida pregunta ${i + 1}`)
    await esperarTurno()
    await mostrarNuevos()
  }
}

async function enviar(texto: string): Promise<void> {
  const input = chat().locator('textarea').first()
  await input.click()
  await input.fill(texto)
  if (await chat().locator('#jw-mention-list').isVisible().catch(() => false)) await input.press('Escape')
  await input.press('Enter')
  await expect(input).toHaveValue('', { timeout: 10_000 })
}

/** Rellena un campo controlado por React sin que el valor aparezca en los registros de Playwright. */
async function escribirSecreto(campo: Locator, valor: string): Promise<void> {
  await campo.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, valor)
}

test.beforeEach(() => test.setTimeout(600_000))

test('iniciar sesión con el usuario de pruebas y usar «JasWave IA»', async () => {
  const { page, bridge } = app()
  await newProject(bridge!, 'E2E IA real', page)
  await page.getByTitle('Ventanas y paneles').click()
  await page.getByRole('button', { name: /^Cuenta/ }).first().click()
  const form = page.getByRole('form', { name: 'Iniciar sesión en JasWave' })
  await expect(form).toBeVisible({ timeout: 20_000 })
  await escribirSecreto(form.locator('input[type="email"]'), EMAIL)
  await escribirSecreto(form.locator('input[autocomplete="current-password"]'), PASSWORD)
  await paso('formulario de inicio de sesion')
  await form.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('button', { name: /Salir/ }).first()).toBeVisible({ timeout: 30_000 })
  await paso('sesion iniciada')

  await expect(chat()).toBeVisible({ timeout: 30_000 })
  await expect(chat().locator('select').first()).toContainText('JasWave IA', { timeout: 30_000 })
  await expect(chat().getByText('Online', { exact: true })).toBeVisible({ timeout: 30_000 })
  await paso('chat con el modelo real')
})

test('/configurar real: la IA crea y borra una habilidad', async () => {
  const input = chat().locator('textarea').first()
  await input.click()
  await input.fill('/conf')
  await chat().locator('#jw-mention-list').getByText('/configurar', { exact: true }).click()
  await expect(chat().locator('form [data-testid="chip-comando"]')).toHaveText('Configurar')
  await input.fill('Quiero enseñarte cómo toco la batería en temas lentos.')
  await paso('etiqueta configurar con pedido')
  await input.press('Enter')
  await esperarTurno()
  await mostrarNuevos()
  await paso('primera respuesta real')
  await responderPreguntas()

  await enviar(
    'Crea una habilidad llamada «Batería lenta»: úsala cuando pida batería para un tema lento. Bombo en 1 y 3, cross-stick en los versos y platos solo en el coro. Guárdala ya, sin más preguntas.',
  )
  await esperarTurno()
  await mostrarNuevos()
  await responderPreguntas()
  await paso('habilidad pedida')
  await expect.poll(() => docs('habilidades').length, { timeout: 30_000 }).toBeGreaterThan(0)
  const archivo = docs('habilidades').find((p) => /bombo/i.test(fs.readFileSync(p, 'utf8')))
  expect(archivo, 'la habilidad debe guardar lo pedido').toBeTruthy()
  console.log(`[ia] archivo creado: ${path.basename(archivo!)}\n${fs.readFileSync(archivo!, 'utf8')}`)

  await enviar('Ahora borra la habilidad «Batería lenta».')
  await esperarTurno()
  await mostrarNuevos()
  await responderPreguntas()
  await paso('habilidad borrada')
  await expect.poll(() => fs.existsSync(archivo!), { timeout: 30_000 }).toBe(false)
  expect(papelera().length).toBeGreaterThan(0)

  await enviar('/configurar salir')
  await esperarTurno()
  await mostrarNuevos()
  await paso('salir de configurar')
  expect(await chat().innerText()).not.toMatch(FUGAS)
})

test('fuera del modo, «créame un prompt» con el modelo real', async () => {
  await enviar('Créame un prompt llamado «Intro épica» para empezar un tema: 8 compases de pad cálido y piano arpegiado con crescendo.')
  await esperarTurno()
  await mostrarNuevos()
  await responderPreguntas()
  await paso('prompt pedido')
  await expect.poll(() => docs('prompts').length, { timeout: 30_000 }).toBeGreaterThan(0)
  for (const p of docs('prompts')) console.log(`[ia] prompt: ${path.basename(p)}\n${fs.readFileSync(p, 'utf8')}`)
  expect(await chat().innerText()).not.toMatch(FUGAS)
})

test('/banda con el modelo real: produce un tema corto con pistas y clips', async () => {
  const { bridge } = app()
  const antes = Date.now()
  await enviar('/banda Tema de adoración muy corto en Re mayor a 72 BPM, solo piano y bajo, 8 compases.')
  await expect(chat().locator('[data-testid="chip-comando"][data-comando="banda"]').first()).toBeVisible()
  await paso('banda pedida')
  // En el chat la banda es una sola línea; el detalle sale al pasar el ratón (no ocupa sitio).
  const enChat = chat().locator('[data-testid="banda-linea"]')
  await expect(enChat).toBeVisible({ timeout: 60_000 })
  await enChat.hover()
  await paso('banda: detalle al pasar el ratón')
  await esperarTurno(900_000)
  await mostrarNuevos()
  await paso('banda terminada')
  console.log(`[ia] /banda tardó ${Math.round((Date.now() - antes) / 1000)} s`)
  for (const l of app().consoleErrors.filter((e) => e.startsWith('[banda]'))) console.log(`[ia] ${l}`)
  // En su propio panel, igual que en el chat; y de vuelta al chat.
  await chat().getByRole('button', { name: 'Abrir la banda en un panel aparte' }).click({ timeout: 15_000 })
  const panel = app().page.locator('[data-testid="banda-panel"]')
  await expect(panel.locator('[data-testid="banda-live"]')).toBeVisible({ timeout: 15_000 })
  await expect(enChat).toHaveCount(0)
  await paso('banda en panel aparte')
  await panel.getByRole('button', { name: 'Mostrar la banda en el chat' }).click({ timeout: 15_000 })
  await expect(enChat).toBeVisible({ timeout: 15_000 })
  await paso('banda de vuelta en el chat')
  const sonido = await bridge!.run('analysis.trackSound', {})
  console.log(`[ia] revisión de sonido: ${JSON.stringify((sonido as { data?: unknown }).data ?? sonido).slice(0, 1500)}`)
  const pistas = await tracks(bridge!)
  for (const t of pistas) console.log(`[ia] pista «${t.nombre}» (${t.tipo}) · ${t.clips.length} clip(s)`)
  expect(pistas.filter((t) => t.clips.length > 0).length).toBeGreaterThan(0)
  expect(await chat().innerText()).not.toMatch(FUGAS)
})
