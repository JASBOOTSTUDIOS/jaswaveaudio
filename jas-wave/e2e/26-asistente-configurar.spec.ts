/**
 * Escenario 26 (G8): por la UI, como un usuario.
 *  - /configurar: la IA pregunta con una opción recomendada, crea una habilidad en la carpeta de
 *    configuración, la elimina (papelera) y la recupera; «/configurar salir» vuelve a la música.
 *  - Un mensaje normal también crea un prompt («créame un prompt…»).
 *  - Ajustes → IA: lo creado aparece; crear, editar a mano en disco + recargar, y eliminar desde el panel.
 *  - Nota de voz: subir un audio en el chat → «Clip Audio» → pista «Nota de voz» con su WAV en disco.
 */
import { expect, test, type Locator } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { newProject, tracks } from './fixtures/project'
import { buscarArchivos, crearPasos, escribirWavTono } from './fixtures/pasos'

const SCRIPT = path.join(__dirname, 'fixtures', 'agent-mock-configurar.json')
const app = setupJasWave({ label: 'configurar', bridge: true, env: { JASWAVE_AI_MOCK: SCRIPT } })
const paso = crearPasos(() => app().page, '26-configurar')

const carpeta = () => path.join(app().userData, 'asistente')
const archivo = (rel: string) => path.join(carpeta(), ...rel.split('/'))
const papelera = () => buscarArchivos(path.join(carpeta(), '.papelera'), () => true).map((p) => path.basename(p))

function chat() {
  return app().page.locator('aside[data-coproducer-chat]')
}

async function enviar(texto: string) {
  const input = chat().locator('textarea').first()
  await input.click()
  await input.fill(texto)
  // Con «/comando» el menú de sugerencias sigue abierto y Enter elegiría una opción: se cierra antes.
  if (await chat().locator('#jw-mention-list').isVisible().catch(() => false)) await input.press('Escape')
  await input.press('Enter')
  await expect(input).toHaveValue('', { timeout: 10_000 })
}

test.beforeEach(() => test.setTimeout(240_000))

/** Espera la respuesta número `n` del asistente terminada (tarjeta de progreso en «listo»). */
async function esperarRespuesta(texto: RegExp | string): Promise<Locator> {
  const loc = chat().getByText(texto).last()
  await expect(loc).toBeVisible({ timeout: 60_000 })
  return loc
}

test('preparar: proyecto nuevo y asistente en línea', async () => {
  const { page, bridge } = app()
  await newProject(bridge!, 'E2E Configurar', page)
  await expect(chat()).toBeVisible({ timeout: 30_000 })
  await expect(chat().getByText('Online', { exact: true })).toBeVisible({ timeout: 30_000 })
  await paso('asistente en línea')
})

test('/configurar: el menú «/» lo explica y la IA pregunta con una opción recomendada', async () => {
  const input = chat().locator('textarea').first()
  await input.click()
  await input.fill('/conf')
  const menu = chat().locator('#jw-mention-list')
  await expect(menu.getByText('te ayudo a crear, editar o quitar tus habilidades, prompts, planes y reglas')).toBeVisible()
  await paso('menu barra con configurar')

  // Elegir el modo en el menú lo convierte en una etiqueta (icono + nombre) delante de la caja
  await menu.getByText('/configurar', { exact: true }).click()
  const chipCaja = chat().locator('form [data-testid="chip-comando"]')
  await expect(chipCaja).toHaveAttribute('data-comando', 'configurar')
  await expect(chipCaja).toHaveText('Configurar')
  await expect(input).toHaveValue('')
  await expect(input).toHaveAttribute('placeholder', /crear, cambiar o quitar/)
  await paso('etiqueta configurar en la caja')

  // La × la quita; escribir «/plan » a mano también crea una etiqueta y Retroceso al inicio la quita
  await chat().getByRole('button', { name: 'Quitar modo Configurar' }).click()
  await expect(chipCaja).toHaveCount(0)
  await input.pressSequentially('/plan ')
  await expect(chipCaja).toHaveAttribute('data-comando', 'plan')
  await expect(input).toHaveValue('')
  await paso('etiqueta plan escrita a mano')
  await input.press('Backspace')
  await expect(chipCaja).toHaveCount(0)

  await input.fill('/configurar ')
  await expect(chipCaja).toHaveAttribute('data-comando', 'configurar')
  await input.press('Enter')
  await expect(input).toHaveValue('', { timeout: 10_000 })
  await expect(chipCaja).toHaveCount(0)
  // En el mensaje enviado se ve la etiqueta, no el texto «/configurar»
  const burbuja = chat().locator('[data-chat-selectable]').filter({ has: app().page.getByTestId('chip-comando') }).first()
  await expect(burbuja).toBeVisible()
  expect(await burbuja.innerText()).not.toContain('/configurar')
  await expect(chat().getByText('Aún no tienes nada guardado. ¿Qué quieres crear primero?').last()).toBeVisible({ timeout: 60_000 })
  await paso('la ia pregunta que crear')
  await chat().getByRole('button', { name: 'Una habilidad (recomendado)' }).last().click()
  await chat().getByRole('button', { name: 'Enviar respuestas' }).last().click()
  await esperarRespuesta('Perfecto. Cuéntame cuándo debo usarla')
  await paso('elegida la opcion recomendada')
})

test('/configurar: crea, elimina y recupera una habilidad como archivo', async () => {
  await enviar('Para temas lentos: bombo en 1 y 3, cross-stick en los versos y platos solo en el coro.')
  await esperarRespuesta(/guardé tu habilidad «Batería lenta»/)
  await expect(chat().getByText(/Sigues en el modo configurar/).last()).toBeVisible()
  await paso('habilidad creada')
  const md = fs.readFileSync(archivo('habilidades/bateria-lenta.md'), 'utf8')
  expect(md).toMatch(/^# Batería lenta\n> cuando pida batería para un tema lento\n\nBombo en 1 y 3/)

  await enviar('borra la habilidad Batería lenta')
  await esperarRespuesta(/la quité/)
  await paso('habilidad eliminada')
  expect(fs.existsSync(archivo('habilidades/bateria-lenta.md'))).toBe(false)
  expect(papelera().some((n) => n.endsWith('habilidades--bateria-lenta.md'))).toBe(true)

  await enviar('recupera la habilidad Batería lenta')
  await esperarRespuesta(/Ya está de vuelta/)
  await paso('habilidad recuperada')
  expect(fs.existsSync(archivo('habilidades/bateria-lenta.md'))).toBe(true)

  await enviar('/configurar salir')
  await esperarRespuesta('Listo, salimos de la configuración. Seguimos con la música.')
  await paso('salir del modo configurar')
  expect(await chat().innerText()).not.toMatch(/config_|\.md|habilidades\/|<<<|`|PROHIBIDO/)
})

test('fuera del modo, un mensaje normal crea un prompt', async () => {
  await enviar('créame un prompt para intros épicas')
  await esperarRespuesta('Guardé tu prompt «Intro épica».')
  await paso('prompt creado desde el chat')
  expect(fs.readFileSync(archivo('prompts/intro-epica.md'), 'utf8')).toMatch(/^# Intro épica\n> empezar un tema/)
})

test('Ajustes → IA: ver, crear, editar a mano y eliminar', async () => {
  const { page } = app()
  await page.getByRole('menubar', { name: 'Menú principal' }).getByRole('menuitem', { name: 'Acciones', exact: true }).click()
  await page.getByRole('menuitem', { name: /Ajustes del proyecto…/ }).click()
  await page.getByRole('button', { name: 'IA', exact: true }).first().click()
  const panel = page.getByTestId('ajustes-ia')
  const seccion = panel.locator('section, div').filter({ hasText: 'Personaliza tu asistente' }).first()
  await seccion.scrollIntoViewIfNeeded()
  await expect(panel.getByText('Batería lenta', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText('Intro épica', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: /Abrir carpeta/ })).toBeVisible()
  await paso('panel con habilidad y prompt')

  // Crear un plan a mano
  await panel.getByRole('button', { name: /Nuevo plan/ }).click()
  await panel.getByPlaceholder('Nombre (p. ej. Mezcla de adoración)').fill('Mezcla rápida')
  await panel.getByPlaceholder('Para qué sirve (p. ej. dejar lista la mezcla para publicar)').fill('antes de exportar')
  await panel.getByPlaceholder(/Los pasos, uno por línea/).fill('- [ ] Equilibrar volúmenes\n- [ ] Limitador en el máster')
  await paso('plan escrito a mano')
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(panel.getByText('Guardado.', { exact: true })).toBeVisible()
  await expect.poll(() => fs.existsSync(archivo('planes/mezcla-rapida.md'))).toBe(true)
  expect(fs.readFileSync(archivo('planes/mezcla-rapida.md'), 'utf8')).toMatch(/^# Mezcla rápida\n> antes de exportar\n\n- \[ \] Equilibrar/)
  await paso('plan guardado')

  // Editar el archivo fuera de la app y recargar
  fs.writeFileSync(archivo('prompts/intro-epica.md'), '# Intro cinematográfica\n> abrir un tema\n\nPad, cuerdas y timbal.\n')
  await panel.getByRole('button', { name: 'Volver a leer la carpeta' }).click()
  await expect(panel.getByText('Intro cinematográfica', { exact: true })).toBeVisible()
  await paso('editado a mano y recargado')

  // Eliminar desde el panel
  await panel.getByRole('button', { name: 'Eliminar Mezcla rápida' }).click()
  await expect(panel.getByText('Mezcla rápida', { exact: true })).toHaveCount(0)
  await expect.poll(() => fs.existsSync(archivo('planes/mezcla-rapida.md'))).toBe(false)
  expect(papelera().some((n) => n.endsWith('planes--mezcla-rapida.md'))).toBe(true)
  await paso('plan eliminado desde el panel')
  await page.keyboard.press('Escape')
})

test('nota de voz: subir audio y «Clip Audio» crea la pista con su archivo', async () => {
  const { page, bridge, workDir, userData } = app()
  const wav = path.join(workDir, 'nota-e2e.wav')
  escribirWavTono(wav, 1.5)
  await chat().locator('input[type="file"][accept*="audio"]').setInputFiles(wav)
  await expect(chat().getByText(/Nota de voz lista/)).toBeVisible({ timeout: 30_000 })
  await paso('audio adjuntado al chat')
  await chat().getByRole('button', { name: /Clip Audio/ }).click()
  await expect(chat().getByText(/Audio añadido/)).toBeVisible({ timeout: 30_000 })
  await paso('audio insertado como clip')

  const pista = await expect
    .poll(async () => (await tracks(bridge!)).find((t) => t.nombre === 'Nota de voz' && t.clips.length === 1)?.nombre, { timeout: 20_000 })
    .toBe('Nota de voz')
  void pista
  const t = (await tracks(bridge!)).find((x) => x.nombre === 'Nota de voz')!
  expect(t.tipo).toBe('audio')
  expect(t.clips[0]!.duracion).toBeGreaterThan(0)
  const wavs = [...buscarArchivos(userData, (n) => /^grabacion-.*\.wav$/.test(n)), ...buscarArchivos(workDir, (n) => /^grabacion-.*\.wav$/.test(n))]
  expect(wavs.length).toBe(1)
  expect(fs.readFileSync(wavs[0]!).subarray(0, 4).toString()).toBe('RIFF')
  expect(fs.statSync(wavs[0]!).size).toBeGreaterThan(100_000)
  await page.waitForTimeout(500)
  await paso('pista nota de voz en el arreglo')
  expect(app().consoleErrors.filter((e) => /asistente|config|audio-sample|pageerror/i.test(e))).toEqual([])
})
