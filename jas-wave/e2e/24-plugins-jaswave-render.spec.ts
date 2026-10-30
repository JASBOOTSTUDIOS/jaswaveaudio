/**
 * Todos los plugins JasWave desplegados, en el motor nativo real: cada instrumento en su pista MIDI y cada FX
 * sobre una pista con un seno. Un render offline con stems comprueba que cada uno carga en el host, que los
 * instrumentos suenan, que los FX dejan pasar señal sin NaN y que una pista con dos instrumentos en capa
 * (Grand Piano + Shimmer Pad) suena como la suma de ambos.
 * Requiere los VST3 desplegados (plugins/deploy_vst3.ps1) y el plugin host compilado.
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { findTrack, newProject, tracks } from './fixtures/project'

const app = setupJasWave({ label: 'plugins-render', bridge: true })

const ENV_UNAVAILABLE = /plugin host|host no disponible|sin dispositivo|no audio device|device|ASIO|WASAPI|pipe|ENOENT.*plugin-host|AudioEngineBusy/i
const CARPETA_VST3 = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Common', 'VST3', 'JasWave')
const RAIZ_PLUGINS = path.resolve(__dirname, '..', '..', 'plugins')

// Graves, caja, charles y acordes: cubre el mapa de batería y el registro de bajo, guitarra y teclados.
const NOTAS = [36, 38, 42, 48, 60, 64, 67, 72].map((pitch, i) => ({ pitch, inicio: i * 0.5, duracion: 1, velocidad: 105 }))

type Plugin = { archivo: string; ruta: string; id: string; nombre: string; instrumento: boolean }

/** Bundles desplegados con su nombre y tipo según el manifiesto (el Sampler no tiene manifiesto: instrumento). */
function pluginsDesplegados(): Plugin[] {
  if (!fs.existsSync(CARPETA_VST3)) return []
  const manifiestos = fs
    .readdirSync(RAIZ_PLUGINS)
    .filter((d) => d.startsWith('com.jaswave.plugin.'))
    .map((d) => path.join(RAIZ_PLUGINS, d, 'jaswave-plugin.json'))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8')) as { id: string; name: string; category?: string; entrypoints?: { dspDesktop?: string } })
  return fs
    .readdirSync(CARPETA_VST3)
    .filter((f) => f.toLowerCase().endsWith('.vst3'))
    .map((archivo) => {
      const m = manifiestos.find((x) => path.basename(x.entrypoints?.dspDesktop ?? '').toLowerCase() === archivo.toLowerCase())
      const base = archivo.replace(/\.vst3$/i, '').replace(/^JasWave/, '')
      return {
        archivo,
        ruta: path.join(CARPETA_VST3, archivo),
        id: m?.id ?? `com.jaswave.plugin.${base.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
        nombre: m?.name ?? `JasWave ${base}`,
        instrumento: m ? m.category === 'instrument' : true,
      }
    })
}

/**
 * Productos que concede la licencia de esta máquina (%APPDATA%\JasWave\license\license.jwl), o null si no hay.
 * Sin licencia un instrumento suena en silencio y un FX deja pasar el audio sin procesar: eso no es un fallo
 * del plugin, pero tampoco prueba que funcione.
 */
function productosLicenciados(): Set<string> | null {
  const f = path.join(process.env.APPDATA ?? '', 'JasWave', 'license', 'license.jwl')
  try {
    // Formato «jwl1.<carga base64url>.<firma>».
    const carga = fs.readFileSync(f, 'utf8').trim().split('.')[1] ?? ''
    const claims = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as { productos?: Record<string, unknown>; exp?: number }
    if (claims.exp && claims.exp * 1000 < Date.now()) return new Set()
    return new Set(Object.keys(claims.productos ?? {}))
  } catch {
    return null
  }
}

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

/** Pico, RMS y muestras no finitas de un WAV PCM 16/24 bits o float 32. */
function analizarWav(file: string): { pico: number; rms: number; noFinitas: number } {
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
      const paso = bits / 8
      let pico = 0
      let suma = 0
      let n = 0
      let noFinitas = 0
      for (let i = off + 8; i + paso <= end; i += paso) {
        const v = fmt === 3 ? buf.readFloatLE(i) : bits === 24 ? buf.readIntLE(i, 3) / 8388608 : buf.readInt16LE(i) / 32768
        if (!Number.isFinite(v)) {
          noFinitas++
          continue
        }
        pico = Math.max(pico, Math.abs(v))
        suma += v * v
        n++
      }
      return { pico, rms: n ? Math.sqrt(suma / n) : 0, noFinitas }
    }
    off += 8 + len + (len % 2)
  }
  return { pico: 0, rms: 0, noFinitas: 0 }
}

test('cada plugin JasWave carga en el host y suena en un render; las capas se suman', async () => {
  test.setTimeout(600_000)
  const plugins = pluginsDesplegados()
  test.skip(plugins.length === 0, `sin plugins desplegados en ${CARPETA_VST3}`)
  const { bridge, page, workDir } = app()
  const host = await page.evaluate(async () => {
    try {
      return await (window as any).electron.pluginHostEnsure()
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  test.skip(!host?.ok, `Plugin host no disponible: ${JSON.stringify(host).slice(0, 300)}`)

  await newProject(bridge!, 'E2E Plugins JasWave', page)
  await bridge!.run('project.setBpm', { bpm: 120 })
  const seno = path.join(workDir, 'media', 'seno.wav')
  fs.mkdirSync(path.dirname(seno), { recursive: true })
  writeSineWav(seno, 4)

  const pistaMidi = async (nombre: string) => {
    await bridge!.run('track.create', { nombre, tipo: 'midi' })
    const t = await findTrack(bridge!, nombre)
    expect(t, nombre).toBeTruthy()
    await bridge!.run('midi.clip.create', { pistaId: t!.id, nombre, inicio: 0, duracion: 4, notas: NOTAS, audition: false })
    return t!.id
  }
  const pistaSeno = async (nombre: string) => {
    const imp = await bridge!.run('audio.import', { filePath: seno, nombre, startSec: 0 }, 120_000)
    const id = String(imp.data?.trackId ?? '')
    expect(id, `audio.import ${nombre}`).not.toBe('')
    await bridge!.run('track.update', { trackId: id, datos: { nombre } })
    await expect.poll(async () => (await tracks(bridge!)).find((t) => t.id === id)?.clips.length ?? 0).toBeGreaterThan(0)
    return id
  }
  const insertar = async (trackId: string, p: Plugin, tipo = 'plugin.insert') => {
    const plugin = {
      id: `e2e-${p.archivo.replace(/\W/g, '')}-${Math.random().toString(36).slice(2, 6)}`,
      nombre: p.nombre,
      fabricante: 'JasWave',
      tipo: p.instrumento ? 'instrumento' : 'efecto',
      categoria: p.instrumento ? 'instrumento' : 'efecto',
      descripcion: p.ruta,
      bypass: false,
      parametros: [],
      estado: 'pendiente',
      version: '1.0.0',
      wet: 1,
      latencia: 0,
      autor: 'JasWave',
      licencia: 'VST3',
    }
    const res = await bridge!.actions([{ type: tipo, payload: { trackId, plugin, path: p.ruta } }], 120_000)
    const r = res.results?.[0]
    return { ok: Boolean(r?.success && r?.data?.hostLoaded), msg: String(r?.message ?? JSON.stringify(res)) }
  }

  // Una pista por plugin; se registra el resultado de carga de cada uno.
  const casos: Array<{ p: Plugin; trackId: string; nombre: string; carga: { ok: boolean; msg: string } }> = []
  for (const p of plugins) {
    const nombre = `${p.instrumento ? 'INS' : 'FX'} ${p.archivo.replace(/\.vst3$/i, '')}`
    const trackId = p.instrumento ? await pistaMidi(nombre) : await pistaSeno(nombre)
    casos.push({ p, trackId, nombre, carga: await insertar(trackId, p) })
  }
  await pistaSeno('REF seco')

  // Capas: Grand Piano y Shimmer Pad por separado y juntos en la misma pista.
  const piano = plugins.find((p) => /GrandPiano/i.test(p.archivo))
  const pad = plugins.find((p) => /ShimmerPad/i.test(p.archivo))
  let capa = false
  if (piano && pad) {
    const doble = await pistaMidi('CAPA piano+pad')
    const a = await insertar(doble, piano)
    const b = await insertar(doble, pad, 'track.addVstLayer')
    expect(a.ok && b.ok, `capas: ${a.msg} · ${b.msg}`).toBe(true)
    capa = true
  }
  // Los instrumentos con muestras (Sampler, bancos de Ambient Atmos) las cargan en segundo plano tras el load,
  // como al abrir un proyecto: se les da el margen que tendría un usuario antes de exportar.
  await page.waitForTimeout(Number(process.env.JW_E2E_ESPERA_MUESTRAS_MS ?? 10_000))

  const cargaFallida = casos.filter((c) => !c.carga.ok)
  test.info().annotations.push({
    type: 'carga',
    description: casos.map((c) => `${c.p.archivo}: ${c.carga.ok ? 'ok' : c.carga.msg}`).join('\n'),
  })

  // Render con un stem por pista (los stems se nombran con la pista).
  const outDir = path.join(workDir, 'renders')
  fs.mkdirSync(outDir, { recursive: true })
  const outputPath = path.join(outDir, 'plugins.wav')
  const todas = (await tracks(bridge!)).map((t) => t.id)
  const res = await bridge!.actions(
    [{ type: 'render.start', payload: { format: 'wav', startSec: 0, endSec: 5, outputPath, normalize: false, stems: true, stemTrackIds: todas } }],
    600_000,
  )
  const r = res.results?.[0]
  if (!r?.success) {
    const msg = String(r?.message ?? JSON.stringify(res))
    test.skip(ENV_UNAVAILABLE.test(msg), `Render no disponible: ${msg.slice(0, 300)}`)
    throw new Error(`render.start falló: ${msg}`)
  }
  const mezcla = String(r.data?.outputPath ?? outputPath)
  await expect.poll(() => fs.existsSync(mezcla), { timeout: 120_000 }).toBe(true)
  const stemsDir = mezcla.replace(/\.wav$/i, '-stems')
  const archivos = fs.readdirSync(stemsDir)
  const stem = (nombre: string) => {
    const f = archivos.find((x) => x.includes(nombre))
    return f ? analizarWav(path.join(stemsDir, f)) : null
  }

  const ref = stem('REF seco')
  expect(ref?.pico ?? 0, 'referencia seca').toBeGreaterThan(0.05)
  const licencia = productosLicenciados()
  const sinLicencia = casos.filter((c) => licencia && !licencia.has(c.p.id))
  const informe: string[] = sinLicencia.map((c) => `${c.p.archivo}: SIN LICENCIA en esta máquina (${c.p.id}) · no se puede comprobar su sonido`)
  const fallos: string[] = cargaFallida.map((c) => `${c.p.archivo}: no cargó (${c.carga.msg})`)
  for (const c of casos) {
    if (!c.carga.ok || sinLicencia.includes(c)) continue
    const a = stem(c.nombre)
    if (!a) {
      fallos.push(`${c.p.archivo}: sin stem`)
      continue
    }
    const db = (x: number) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf')
    informe.push(`${c.p.archivo}: pico ${db(a.pico)} dBFS · rms ${db(a.rms)} dBFS${c.p.instrumento ? '' : ` · vs seco ${db(a.rms / (ref!.rms || 1))} dB`}`)
    if (a.noFinitas) fallos.push(`${c.p.archivo}: ${a.noFinitas} muestras NaN/Inf`)
    else if (a.pico > 4) fallos.push(`${c.p.archivo}: pico desbocado ${a.pico.toFixed(2)}`)
    else if (a.pico < 0.003) fallos.push(`${c.p.archivo}: silencio (pico ${a.pico.toExponential(2)})`)
  }

  if (capa) {
    const s = (archivo: RegExp) => stem(casos.find((c) => archivo.test(c.p.archivo))!.nombre)
    const pianoSolo = s(/GrandPiano/i)
    const padSolo = s(/ShimmerPad/i)
    const doble = stem('CAPA piano+pad')
    if (pianoSolo && padSolo && doble) {
      // Instrumentos sin correlación: las potencias se suman. Con una sola capa sonando, la razón sería ≈ la de esa capa.
      const esperado = Math.sqrt(pianoSolo.rms ** 2 + padSolo.rms ** 2)
      const razon = doble.rms / esperado
      informe.push(`CAPA piano+pad: rms ${doble.rms.toFixed(4)} · esperado ${esperado.toFixed(4)} · razón ${razon.toFixed(2)}`)
      if (!(razon > 0.75 && razon < 1.33)) fallos.push(`capa piano+pad: razón ${razon.toFixed(2)} (fuera de 0,75…1,33)`)
      if (doble.rms < Math.max(pianoSolo.rms, padSolo.rms) * 1.02) fallos.push('capa piano+pad: no supera a la capa más fuerte sola')
    } else fallos.push('capa piano+pad: faltan stems')
  }

  test.info().annotations.push({ type: 'niveles', description: informe.join('\n') })
  console.log(`\n[plugins-render]\n${informe.join('\n')}\n${fallos.length ? `FALLOS:\n${fallos.join('\n')}` : 'sin fallos'}`)
  expect(fallos, fallos.join('\n')).toEqual([])
})
