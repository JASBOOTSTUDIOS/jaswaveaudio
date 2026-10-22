/**
 * Escenario 11 (U6): reproducción, grabación y bounce sin perder tomas ni corromper el render.
 *
 * - el bounce bloquea la app: Espacio y Ctrl+Z no alteran el resultado
 * - cambiar de proyecto con el transporte en marcha lo detiene
 * - si hay entrada de audio: la toma de una pista borrada acaba en "Toma recuperada"
 */
import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { tracks } from './fixtures/project'
import { sleep } from './fixtures/app'
import type { BridgeClient } from './fixtures/app'

const app = setupJasWave({ label: 'u6', bridge: true })

/** Mensajes que indican falta de entorno (no un bug de U6). */
const ENV_UNAVAILABLE =
  /plugin host|host no disponible|sin dispositivo|no audio device|device|ASIO|WASAPI|pipe|ENOENT.*plugin-host|timeout/i

/** WAV PCM 16 bit estéreo con un seno de 440 Hz. */
function writeSineWav(file: string, seconds: number, sampleRate = 48000) {
  const frames = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5 * 32767)
    data.writeInt16LE(v, i * 4)
    data.writeInt16LE(v, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 4, 28)
  h.writeUInt16LE(4, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([h, data]))
}

function wavBytes(file: string): number {
  const buf = fs.readFileSync(file)
  return buf.length
}

/**
 * Crea un proyecto nuevo descartando los cambios sin guardar: si hay cambios, la
 * acción se queda esperando en el diálogo de confirmación hasta que se responde.
 */
async function newProjectDiscarding(page: Page, bridge: BridgeClient, nombre: string) {
  const pending = bridge.actions([{ type: 'project.new', payload: { nombre } }])
  const discard = page.getByTestId('unsaved-discard')
  const ganador = await Promise.race([
    pending.then(() => 'accion' as const),
    discard
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => 'dialogo' as const)
      .catch(() => 'accion' as const),
  ])
  if (ganador === 'dialogo') await discard.click()
  const res = await pending
  const r = res.results?.[0]
  if (!r?.success) throw new Error(`project.new falló: ${r?.message ?? JSON.stringify(res)}`)
  await expect.poll(async () => (await bridge.state()).nombre, { timeout: 30_000 }).toBe(nombre)
}

test('el bounce bloquea la app: Espacio y Ctrl+Z no alteran el resultado', async () => {
  const { bridge, page, workDir } = app()

  const host = await page.evaluate(async () => {
    try {
      return await (window as any).electron.pluginHostEnsure()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  test.skip(!host?.ok, `Plugin host no disponible en este entorno: ${JSON.stringify(host).slice(0, 300)}`)

  await newProjectDiscarding(page!, bridge!, 'E2E U6 Bounce')
  await bridge!.run('project.setBpm', { bpm: 120 })

  const srcDir = path.join(workDir, 'media')
  fs.mkdirSync(srcDir, { recursive: true })
  const source = path.join(srcDir, 'u6-sine.wav')
  writeSineWav(source, 6)
  const imported = await bridge!.run('audio.import', { filePath: source, nombre: 'U6 Seno', startSec: 0 }, 120_000)
  const trackId = String(imported.data?.trackId ?? '')
  expect(trackId, 'audio.import devuelve trackId').not.toBe('')

  const outDir = path.join(workDir, 'renders')
  fs.mkdirSync(outDir, { recursive: true })
  const outputPath = path.join(outDir, 'u6-export.wav')

  // El render tarda: se lanza sin esperar para poder pulsar teclas mientras corre.
  const renderPromise = bridge!.actions(
    [{ type: 'render.start', payload: { format: 'wav', startSec: 0, endSec: 20, outputPath, normalize: false } }],
    300_000,
  )

  // Con el render en curso el transporte está deshabilitado (renderLock).
  const play = page.getByRole('button', { name: /Reproducir|Pausar/ })
  await expect(play).toBeDisabled({ timeout: 60_000 })

  await page.keyboard.press('Space')
  await page.keyboard.press('Control+z')
  await sleep(500)

  // Espacio no arrancó la reproducción y Ctrl+Z no deshizo la importación.
  const during = await bridge!.state()
  expect(during.playing, 'el transporte no se mueve durante el bounce').toBe(false)
  const duringTracks = (during.tracks ?? []) as Array<{ id: string }>
  expect(duringTracks.some((t) => t.id === trackId), 'la pista importada sigue viva').toBe(true)

  const res = await renderPromise
  const r = res.results?.[0]
  if (!r?.success) {
    const msg = String(r?.message ?? JSON.stringify(res))
    test.skip(ENV_UNAVAILABLE.test(msg), `Render no disponible en este entorno: ${msg.slice(0, 300)}`)
    throw new Error(`render.start falló: ${msg}`)
  }

  await expect.poll(() => fs.existsSync(outputPath), { timeout: 60_000 }).toBe(true)
  // WAV válido: cabecera RIFF/WAVE y tamaño coherente con los datos.
  const head = fs.readFileSync(outputPath).subarray(0, 12)
  expect(head.subarray(0, 4).toString('ascii'), 'cabecera RIFF').toBe('RIFF')
  expect(head.subarray(8, 12).toString('ascii'), 'cabecera WAVE').toBe('WAVE')
  const bytes = wavBytes(outputPath)
  expect(bytes, 'el WAV tiene contenido').toBeGreaterThan(200_000)
  const declared = fs.readFileSync(outputPath).readUInt32LE(4)
  expect(Math.abs(declared + 8 - bytes), 'el tamaño RIFF coincide con el archivo').toBeLessThanOrEqual(8)

  // Al terminar, el bloqueo se levanta y el proyecto sigue intacto.
  await expect(play).toBeEnabled({ timeout: 30_000 })
  const after = await bridge!.state()
  expect(after.playing).toBe(false)
  expect((after.tracks ?? []).some((t: { id: string }) => t.id === trackId)).toBe(true)
})

test('cambiar de proyecto con el transporte en marcha lo detiene', async () => {
  const { bridge, page } = app()

  await newProjectDiscarding(page!, bridge!, 'E2E U6 Transporte')
  await bridge!.run('project.setBpm', { bpm: 120 })

  // Reproducción (no necesita dispositivo de audio para el estado del transporte).
  await bridge!.run('transport.toggle', {})
  await expect.poll(async () => (await bridge!.state()).playing, { timeout: 15_000 }).toBe(true)

  // Nuevo proyecto: el transporte se detiene antes de cambiar.
  await newProjectDiscarding(page!, bridge!, 'E2E U6 Otro')

  const st = await bridge!.state()
  expect(st.playing, 'el transporte queda parado tras cambiar de proyecto').toBe(false)
  expect(st.nombre).toBe('E2E U6 Otro')
})

test('la toma de una pista borrada durante la grabación acaba en "Toma recuperada"', async () => {
  const { bridge, page } = app()

  await newProjectDiscarding(page!, bridge!, 'E2E U6 Grabacion')

  const creada = await bridge!.run('track.create', { nombre: 'Entrada', tipo: 'audio' })
  const trackId = String(creada.data?.trackId ?? '')
  expect(trackId, 'track.create devuelve trackId').not.toBe('')

  await bridge!.run('track.toggleArm', { trackId })

  // Calibración: sin entrada de audio real no se puede grabar nada.
  await bridge!.run('transport.toggleRecord', {})
  await sleep(2500)
  await bridge!.run('transport.toggleRecord', {})
  const conToma = await (async () => {
    for (let i = 0; i < 25; i++) {
      const t = (await tracks(bridge!)).find((x) => x.id === trackId)
      if (t && t.clips.length > 0) return true
      await sleep(400)
    }
    return false
  })()
  test.skip(!conToma, 'Este entorno no tiene entrada de audio utilizable para grabar')

  // Segunda toma: la pista sigue armada, ahora se borra mientras se graba.
  await bridge!.run('transport.toggleRecord', {})
  await sleep(2500)

  // Con la pista armada y grabando no se puede borrar…
  const borrado = await bridge!.actions([{ type: 'track.delete', payload: { trackId } }])
  expect(borrado.results?.[0]?.success, 'borrar una pista armada y grabando se rechaza').toBe(false)

  // …pero si se desarma, se borra y la toma se guarda en "Toma recuperada".
  await bridge!.run('track.toggleArm', { trackId })
  await bridge!.run('track.delete', { trackId })
  await bridge!.run('transport.toggleRecord', {})

  await expect
    .poll(async () => (await tracks(bridge!)).map((t) => t.nombre), { timeout: 30_000 })
    .toContain('Toma recuperada')
})
