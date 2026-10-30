/**
 * Carpeta-bus en el motor nativo: la salida de una pista hija pasa por el fader de su carpeta antes del
 * master, y silenciar la carpeta calla a sus hijas. Se comprueba con un render offline (mezcla + stems).
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { findTrack, newProject, tracks } from './fixtures/project'

const app = setupJasWave({ label: 'carpeta-bus', bridge: true })

const ENV_UNAVAILABLE = /plugin host|host no disponible|sin dispositivo|no audio device|device|ASIO|WASAPI|pipe|ENOENT.*plugin-host|timeout|AudioEngineBusy/i

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

/** Pico absoluto (0..1) de un WAV PCM 16/24 bits o float 32. */
function wavPeak(file: string): number {
  const buf = fs.readFileSync(file)
  let off = 12
  let fmt = 1
  let bits = 16
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const len = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = buf.readUInt16LE(off + 8)
      bits = buf.readUInt16LE(off + 22)
      if (fmt === 0xfffe) fmt = buf.readUInt16LE(off + 32)
    } else if (id === 'data') {
      const end = Math.min(buf.length, off + 8 + len)
      let pico = 0
      const paso = bits / 8
      for (let i = off + 8; i + paso <= end; i += paso) {
        const v =
          fmt === 3 ? Math.abs(buf.readFloatLE(i)) : bits === 24 ? Math.abs(buf.readIntLE(i, 3)) / 8388608 : Math.abs(buf.readInt16LE(i)) / 32768
        if (v > pico) pico = v
      }
      return pico
    }
    off += 8 + len + (len % 2)
  }
  return 0
}

test('la hija suena a través del fader de su carpeta y el mute de la carpeta la calla', async () => {
  test.setTimeout(300_000)
  const { bridge, page, workDir } = app()
  const host = await page.evaluate(async () => {
    try {
      return await (window as any).electron.pluginHostEnsure()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  test.skip(!host?.ok, `Plugin host no disponible: ${JSON.stringify(host).slice(0, 300)}`)

  await newProject(bridge!, 'E2E Carpeta', page)
  await bridge!.run('project.setBpm', { bpm: 120 })
  const srcDir = path.join(workDir, 'media')
  fs.mkdirSync(srcDir, { recursive: true })
  const source = path.join(srcDir, 'seno.wav')
  writeSineWav(source, 4)
  const imported = await bridge!.run('audio.import', { filePath: source, nombre: 'Seno', startSec: 0 }, 120_000)
  const hijaId = String(imported.data?.trackId ?? '')
  expect(hijaId).not.toBe('')
  await expect.poll(async () => (await tracks(bridge!)).find((t) => t.id === hijaId)?.clips.length ?? 0).toBeGreaterThan(0)

  await bridge!.run('track.create', { nombre: 'Grupo', tipo: 'carpeta' })
  const carpeta = await findTrack(bridge!, 'Grupo')
  expect(carpeta).toBeTruthy()
  const set = await bridge!.actions([{ type: 'track.setParent', payload: { trackId: hijaId, padreId: carpeta!.id } }])
  expect(set.results?.[0]?.success, JSON.stringify(set)).toBe(true)
  await bridge!.run('track.update', { trackId: carpeta!.id, datos: { volumen: 0.25 } })
  // La carpeta aparece con sangría en el Arrange.
  await expect(page.getByTestId(`arrange-track-header-${hijaId}`)).toHaveAttribute('data-nivel', '1')

  const outDir = path.join(workDir, 'renders')
  fs.mkdirSync(outDir, { recursive: true })
  const render = async (nombre: string, stems: boolean) => {
    const outputPath = path.join(outDir, `${nombre}.wav`)
    const res = await bridge!.actions(
      [
        {
          type: 'render.start',
          payload: {
            format: 'wav',
            startSec: 0,
            endSec: 3,
            outputPath,
            normalize: false,
            ...(stems ? { stems: true, stemTrackIds: [hijaId, carpeta!.id] } : {}),
          },
        },
      ],
      300_000,
    )
    const r = res.results?.[0]
    if (!r?.success) {
      const msg = String(r?.message ?? JSON.stringify(res))
      test.skip(ENV_UNAVAILABLE.test(msg), `Render no disponible: ${msg.slice(0, 300)}`)
      throw new Error(`render.start falló: ${msg}`)
    }
    const written = String(r.data?.outputPath ?? outputPath)
    await expect.poll(() => fs.existsSync(written), { timeout: 60_000 }).toBe(true)
    return written
  }

  const mezcla = await render('mezcla', true)
  const stemsDir = mezcla.replace(/\.wav$/i, '-stems')
  const archivos = fs.readdirSync(stemsDir)
  const nombreHija = (await tracks(bridge!)).find((t) => t.id === hijaId)!.nombre
  const stemDe = (nombre: string) => {
    const f = archivos.find((x) => x.includes(nombre))
    expect(f, `stem de «${nombre}» en ${archivos.join(', ')}`).toBeTruthy()
    return path.join(stemsDir, f!)
  }
  const picoHija = wavPeak(stemDe(nombreHija))
  const picoCarpeta = wavPeak(stemDe('Grupo'))
  const picoMezcla = wavPeak(mezcla)
  test.info().annotations.push({ type: 'info', description: `hija ${picoHija} · carpeta ${picoCarpeta} · mezcla ${picoMezcla}` })
  expect(picoHija).toBeGreaterThan(0.05)
  // La carpeta recibe a la hija y le aplica su fader: 0,25 × ley de paneo del centro (√2) ≈ 0,354.
  expect(picoCarpeta / picoHija).toBeGreaterThan(0.33)
  expect(picoCarpeta / picoHija).toBeLessThan(0.38)
  // La mezcla es la salida de la carpeta (por la cadena del master, hasta ×1,35): si la hija llegara
  // además directa al master, la mezcla sería ≈ (1 + 0,354) / 0,354 ≈ 3,8 veces la carpeta.
  expect(picoMezcla / picoCarpeta).toBeGreaterThan(0.9)
  expect(picoMezcla / picoCarpeta).toBeLessThan(1.45)

  await bridge!.run('track.toggleMute', { trackId: carpeta!.id })
  const muda = await render('muda', false)
  expect(wavPeak(muda)).toBeLessThan(0.001)
})
