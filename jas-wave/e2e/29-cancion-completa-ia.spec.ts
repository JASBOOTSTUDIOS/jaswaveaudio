/**
 * Escenario 29: una canción completa producida por la IA REAL con todo lo que ofrece el DAW, por la UI.
 *  - /banda con forma completa (intro, versos, pre-coro, coros, puente, outro), siete instrumentos VST3 en su
 *    propia pista, dinámica por sección, bus de reverb con envíos, EQ/compresión/paneo y máster a −14 LUFS.
 *  - Se comprueba que cada pista suena (analysis.trackSound) y se exporta: mezcla WAV con stems por pista,
 *    MIDI del proyecto y el proyecto empaquetado (.jaswave.zip), en JASWAVE_E2E_SALIDA (o la carpeta de la prueba).
 *
 * Gasta muchos créditos de IA (150–300 llamadas): solo corre con JASWAVE_E2E_EMAIL y JASWAVE_E2E_PASSWORD.
 */
import { expect, test, type Locator } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'
import { crearPasos } from './fixtures/pasos'
import type { BridgeClient } from './fixtures/app'
import { generoDesdeEntorno } from './fixtures/generos-cancion'

const EMAIL = process.env.JASWAVE_E2E_EMAIL ?? ''
const PASSWORD = process.env.JASWAVE_E2E_PASSWORD ?? ''
test.skip(!EMAIL || !PASSWORD, 'IA real: define JASWAVE_E2E_EMAIL y JASWAVE_E2E_PASSWORD')

const app = setupJasWave({ label: 'cancion-ia', bridge: true })
const paso = crearPasos(() => app().page, '29-cancion-ia')

const GENERO = generoDesdeEntorno()
const PEDIDO = GENERO.pedido

function chat() {
  return app().page.locator('aside[data-coproducer-chat]')
}

async function escribirSecreto(campo: Locator, valor: string): Promise<void> {
  await campo.evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, valor)
}

test('canción completa con la IA real: arreglo, mezcla, máster y exportación', async () => {
  // Con ensayo, arreglista, devoluciones y un modelo gratuito lento, una producción real ronda los 40–60 min.
  test.setTimeout(5_400_000)
  const { page, bridge, workDir } = app()
  const salida = process.env.JASWAVE_E2E_SALIDA || path.join(workDir, 'cancion-ia')
  fs.mkdirSync(salida, { recursive: true })

  await newProject(bridge!, GENERO.titulo, page)
  await page.getByTitle('Ventanas y paneles').click()
  await page.getByRole('button', { name: /^Cuenta/ }).first().click()
  const form = page.getByRole('form', { name: 'Iniciar sesión en JasWave' })
  await expect(form).toBeVisible({ timeout: 20_000 })
  await escribirSecreto(form.locator('input[type="email"]'), EMAIL)
  await escribirSecreto(form.locator('input[autocomplete="current-password"]'), PASSWORD)
  await form.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.getByRole('button', { name: /Salir/ }).first()).toBeVisible({ timeout: 30_000 })
  await expect(chat().getByText('Online', { exact: true })).toBeVisible({ timeout: 30_000 })
  await paso('sesion iniciada')

  // La banda se lleva a su panel aparte para seguirla sin tapar el chat.
  const input = chat().locator('textarea').first()
  await input.click()
  await input.fill(PEDIDO)
  if (await chat().locator('#jw-mention-list').isVisible().catch(() => false)) await input.press('Escape')
  await input.press('Enter')
  const antes = Date.now()
  await expect(chat().locator('[data-testid="banda-linea"]')).toBeVisible({ timeout: 60_000 })
  await chat().getByRole('button', { name: 'Abrir la banda en un panel aparte' }).click({ timeout: 15_000 })
  await expect(page.locator('[data-testid="banda-panel"] [data-testid="banda-live"]')).toBeVisible({ timeout: 15_000 })
  await paso('banda trabajando en su panel')
  // Capturas periódicas mientras trabaja (para ver el avance).
  let vistos = 0
  for (let i = 1; i <= 110; i++) {
    const enCurso = await chat().getByRole('button', { name: 'Detener agente' }).isVisible().catch(() => false)
    if (!enCurso && i > 1) break
    await page.waitForTimeout(45_000)
    await paso(`avance ${i}`)
    // Qué hace la banda ahora (si se atasca, el rastro dice dónde). La banda está en su panel: la línea del
    // chat ya no existe, y esperar por ella consumía el tiempo del test entero.
    const linea = await page.locator('[data-testid="banda-panel"] [data-testid="banda-live"]').innerText({ timeout: 3_000 }).catch(() => '')
    console.log(`[ia] ${Math.round((Date.now() - antes) / 1000)} s · ${linea.replace(/\s+/g, ' ').slice(0, 300)}`)
    // Fallos de herramienta en vivo (si el test agota su tiempo, la línea final `[banda]` nunca llega).
    const nuevos = app().consoleErrors.slice(vistos)
    vistos += nuevos.length
    for (const l of nuevos.filter((e) => e.startsWith('[banda] ✗'))) console.log(`[ia] ${l.slice(0, 400)}`)
  }
  await expect(chat().getByRole('button', { name: 'Detener agente' })).toHaveCount(0, { timeout: 300_000 })
  await paso('cancion terminada')
  const segundos = Math.round((Date.now() - antes) / 1000)
  const respuesta = (await chat().locator('[data-chat-selectable]').allInnerTexts()).pop() ?? ''
  console.log(`[ia] /banda tardó ${segundos} s\n[ia] ${respuesta.replace(/\s+/g, ' ').slice(0, 1500)}`)
  for (const l of app().consoleErrors.filter((e) => e.startsWith('[banda]') || e.startsWith('[analisis]') || e.startsWith('[tiempos]'))) console.log(`[ia] ${l.slice(0, 7000)}`)
  // Todo tiene que encajar y estar medido: el arreglista aprueba y ninguna revisión se queda sin medir.
  expect(respuesta, 'la coherencia (tiempo, armonía y ritmo) debe quedar aprobada').toMatch(/Coherencia: aprobada/)
  expect(respuesta, 'cada revisión debe poder medirse con el motor real').not.toMatch(/No se pudo revisar/)

  // Qué quedó en el proyecto.
  type Resumen = {
    bpm?: number
    tracks: Array<{ id: string; nombre: string; tipo: string; volumen?: number; paneo?: number; plugins?: Array<{ nombre: string; bypass?: boolean }>; clips: Array<{ inicio: number; duracion: number; notas?: number }> }>
    master?: { volumen?: number; plugins?: string[] }
    routing?: { buses?: Array<{ nombre: string }>; sends?: number }
  }
  const st = (await bridge!.state()) as Resumen
  const pistas = st.tracks
  console.log(`[ia] ${st.bpm ?? '?'} BPM · ${pistas.length} pistas`)
  for (const t of pistas) {
    const notas = t.clips.reduce((n, c) => n + (c.notas ?? 0), 0)
    const fin = Math.max(0, ...t.clips.map((c) => c.inicio + c.duracion))
    console.log(`[ia] «${t.nombre}» (${t.tipo}) · ${t.clips.length} clips · ${notas} notas · hasta beat ${fin} · vol ${t.volumen ?? '-'} pan ${t.paneo ?? '-'} · ${(t.plugins ?? []).map((p) => p.nombre).join(' → ') || 'sin plugins'}`)
  }
  console.log(`[ia] máster: vol ${st.master?.volumen ?? '-'} · ${(st.master?.plugins ?? []).join(' → ') || 'sin plugins'}`)
  console.log(`[ia] enrutado: buses ${(st.routing?.buses ?? []).map((b) => b.nombre).join(', ') || 'ninguno'} · ${st.routing?.sends ?? 0} envíos`)
  const sonido = await bridge!.run('analysis.trackSound', {})
  console.log(`[ia] revisión de sonido: ${JSON.stringify((sonido as { data?: unknown }).data ?? sonido).slice(0, 2000)}`)

  const conMusica = pistas.filter((t) => t.clips.length > 0)
  expect(conMusica.length, 'pistas con música').toBeGreaterThanOrEqual(5)

  // Calidad musical medida nota por nota (plan S): nada vacío, cobertura por compás, sin copias exactas ni todo en la rejilla,
  // sin choques entre pistas. El mismo análisis sirve para cualquier proyecto: scripts/analizar-proyecto-musical.mjs.
  const musical = await analisisMusical(bridge!, pistas, st.bpm ?? GENERO.bpm, salida)
  console.log(musical.tabla)
  const vacias = pistas.filter((t) => t.tipo !== 'bus' && t.clips.reduce((n, c) => n + (c.notas ?? 0), 0) === 0).map((t) => t.nombre)
  expect(vacias, `pistas de instrumento vacías: ${vacias.join(', ')}`).toEqual([])
  for (const f of musical.fallos) console.log(`[musica] FALLO: ${f}`)
  expect(musical.fallos.filter((f) => /compases sin notas/.test(f)), 'cobertura por compás').toEqual([])
  expect(musical.fallos.filter((f) => /copia exacta/.test(f)), 'copias exactas por pista (< 50 %)').toEqual([])
  expect(musical.fallos.filter((f) => /rejilla exacta/.test(f)), 'notas en rejilla exacta (batería < 90 %, resto < 60 %)').toEqual([])
  expect(musical.fallos.filter((f) => /choques entre pistas/.test(f)), 'choques de segunda menor entre pistas (< 8 % de los tiempos)').toEqual([])

  // Exportación: mezcla con stems por pista, MIDI y proyecto empaquetado.
  await page.waitForTimeout(10_000)
  const wav = path.join(salida, `${GENERO.archivo}.wav`)
  const render = await bridge!.actions(
    [{ type: 'render.start', payload: { format: 'wav', outputPath: wav, normalize: false, stems: true, stemTrackIds: conMusica.map((t) => t.id) } }],
    900_000,
  )
  const r = render.results?.[0]
  console.log(`[ia] render: ${r?.success ? 'ok' : 'falló'} · ${String(r?.message ?? JSON.stringify(render)).slice(0, 600)}`)
  const midi = await bridge!.actions([{ type: 'export.midi', payload: { ruta: path.join(salida, `${GENERO.archivo}.mid`) } }], 120_000)
  console.log(`[ia] midi: ${String(midi.results?.[0]?.message ?? JSON.stringify(midi)).slice(0, 300)}`)
  // El .mid solo lleva las notas dentro de su clip (las que suenan): si faltan muchas, la IA las dejó fuera.
  const notasProyecto = pistas.reduce((n, t) => n + t.clips.reduce((m, c) => m + (c.notas ?? 0), 0), 0)
  const notasMidi = Number(/(\d+) notas/.exec(String(midi.results?.[0]?.message ?? ''))?.[1] ?? 0)
  console.log(`[ia] notas: ${notasMidi} exportadas de ${notasProyecto} en el proyecto`)
  const zip = await bridge!.actions([{ type: 'export.projectBundle', payload: { ruta: path.join(salida, `${GENERO.archivo}.jaswave.zip`) } }], 300_000)
  console.log(`[ia] proyecto: ${String(zip.results?.[0]?.message ?? JSON.stringify(zip)).slice(0, 300)}`)
  await paso('exportada')
  for (const f of fs.readdirSync(salida, { recursive: true }) as string[]) {
    const p = path.join(salida, f)
    if (fs.statSync(p).isFile()) console.log(`[ia] archivo: ${f} (${Math.round(fs.statSync(p).size / 1024)} KB)`)
  }
  expect(r?.success, 'el render de la canción').toBe(true)
  expect(fs.existsSync(wav)).toBe(true)

  // Que suene: mezcla y cada stem con nivel (un instrumento sin licencia o sin notas sale en silencio).
  const db = (x: number) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf')
  const mezcla = nivelWav(wav)
  console.log(`[ia] mezcla: ${mezcla.segundos.toFixed(0)} s · pico ${db(mezcla.pico)} dBFS · rms ${db(mezcla.rms)} dBFS`)
  const stemsDir = wav.replace(/\.wav$/i, '-stems')
  const mudos: string[] = []
  for (const f of fs.existsSync(stemsDir) ? fs.readdirSync(stemsDir) : []) {
    const n = nivelWav(path.join(stemsDir, f))
    console.log(`[ia] stem ${f}: pico ${db(n.pico)} dBFS · rms ${db(n.rms)} dBFS`)
    if (n.pico < 0.003) mudos.push(f)
  }
  expect(mezcla.pico, 'la canción exportada no puede estar en silencio').toBeGreaterThan(0.05)
  // Máster de verdad: sin picos al límite y cerca de −14 LUFS (lo mide el propio render).
  expect(mezcla.pico, 'el máster debe dejar los picos por debajo de −1 dBTP (sin clipping)').toBeLessThanOrEqual(0.95)
  const lufs = Number(/(-?\d+(?:\.\d+)?) LUFS/.exec(String(r?.message ?? ''))?.[1] ?? NaN)
  expect(lufs, 'volumen final del máster (LUFS)').toBeGreaterThanOrEqual(-17)
  expect(lufs, 'volumen final del máster (LUFS)').toBeLessThanOrEqual(-11)
  expect(mudos, `stems en silencio: ${mudos.join(', ')}`).toEqual([])
  expect(notasMidi, 'notas que suenan (dentro de su clip)').toBeGreaterThanOrEqual(notasProyecto * 0.9)
})

/** Forma pedida en PEDIDO (nombre, compases): el e2e la usa como marcadores de sección del análisis. */
const FORMA = GENERO.forma

type PistaResumen = { id: string; nombre: string; tipo: string; clips: Array<{ id?: string; nombre?: string; inicio: number; duracion: number; notas?: number }> }

/** Lee todas las notas del proyecto vivo (por ventanas de 8 beats: `midi.notes.get` devuelve como mucho 128 por llamada) y ejecuta el análisis. */
async function analisisMusical(bridge: BridgeClient, pistas: PistaResumen[], bpm: number, salida: string): Promise<{ tabla: string; fallos: string[] }> {
  let compas = 0
  const marcadores = FORMA.map(([nombre, n]) => {
    const m = { nombre, tiempo: compas * 4 }
    compas += n
    return m
  })
  const tracks = []
  for (const t of pistas) {
    const clips = []
    for (const c of t.clips) {
      const notas: Array<{ pitch: number; inicio: number; duracion: number; velocidad: number }> = []
      if ((c.notas ?? 0) > 0 && c.id) {
        for (let ini = 0; ini < c.duracion + 1e-9; ini += 8) {
          const r = await bridge.run('midi.notes.get', { pistaId: t.id, clipId: c.id, start: ini, end: ini + 8, limit: 128 })
          for (const n of (r.data?.notes ?? []) as Array<{ pitch: number; inicio: number; duracion: number; velocidad: number }>) {
            if (n.inicio >= ini - 1e-9 && n.inicio < ini + 8 - 1e-9) notas.push({ pitch: n.pitch, inicio: n.inicio, duracion: n.duracion, velocidad: n.velocidad })
          }
        }
      }
      clips.push({ nombre: c.nombre, inicio: c.inicio, duracion: c.duracion, notas })
    }
    tracks.push({ nombre: t.nombre, tipo: t.tipo, clips })
  }
  const json = path.join(salida, 'proyecto-musical.json')
  fs.writeFileSync(json, JSON.stringify({ nombre: `e2e 29 · ${GENERO.id}`, bpm: { valor: bpm }, timeSignature: { numerador: 4 }, marcadores, tracks }))
  const script = path.join(__dirname, '..', 'scripts', 'analizar-proyecto-musical.mjs')
  const tabla = spawnSync(process.execPath, [script, json], { encoding: 'utf8' }).stdout
  const u = GENERO.umbrales
  const umbrales = `--umbrales=${JSON.stringify({ copias: u.copiasMax / 100, rejillaBateria: u.rejillaBateria / 100, rejillaResto: u.rejillaResto / 100, choques: u.choquesMax / 100 })}`
  const salidaJson = spawnSync(process.execPath, [script, json, '--json', umbrales], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const fallos = (JSON.parse(salidaJson.stdout || '{"fallos":["el análisis no produjo salida"]}') as { fallos: string[] }).fallos
  return { tabla: tabla.split('\n').filter((l) => l.startsWith('[musica]')).join('\n'), fallos }
}

/** Pico, RMS y duración de un WAV PCM 16/24 bits o float 32 (sin dependencias). */
function nivelWav(file: string): { pico: number; rms: number; segundos: number } {
  const buf = fs.readFileSync(file)
  let off = 12
  let fmt = 1
  let bits = 16
  let canales = 2
  let frecuencia = 48000
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const len = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      fmt = buf.readUInt16LE(off + 8)
      canales = buf.readUInt16LE(off + 10)
      frecuencia = buf.readUInt32LE(off + 12)
      bits = buf.readUInt16LE(off + 22)
      if (fmt === 0xfffe) fmt = buf.readUInt16LE(off + 32)
    } else if (id === 'data') {
      const fin = Math.min(buf.length, off + 8 + len)
      const paso = bits / 8
      let pico = 0
      let suma = 0
      let n = 0
      for (let i = off + 8; i + paso <= fin; i += paso) {
        const v = fmt === 3 ? buf.readFloatLE(i) : bits === 24 ? buf.readIntLE(i, 3) / 8388608 : buf.readInt16LE(i) / 32768
        if (!Number.isFinite(v)) continue
        pico = Math.max(pico, Math.abs(v))
        suma += v * v
        n++
      }
      return { pico, rms: n ? Math.sqrt(suma / n) : 0, segundos: n / canales / frecuencia }
    }
    off += 8 + len + (len % 2)
  }
  return { pico: 0, rms: 0, segundos: 0 }
}
