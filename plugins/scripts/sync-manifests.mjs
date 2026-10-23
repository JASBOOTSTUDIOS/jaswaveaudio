// Regenera los jaswave-plugin.json (esquema V5, plugins/CONTRATO-V5.md) a partir de la tabla REAL de
// parámetros de cada plugin (volcada por <Plugin>_snapshot --dump-params) + metadatos de este script.
//   node plugins/scripts/sync-manifests.mjs [--build plugins/build] [--config Release] [--check]
// --check: no escribe; falla si algún manifiesto no coincide con el código.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const build = path.resolve(opt('build', path.join(root, 'build')))
const config = opt('config', 'Release')
const check = args.includes('--check')

const fuid = (a, b, c, d) => {
  const h = (x) => x.toString(16).toUpperCase().padStart(8, '0')
  const s = h(a) + h(b) + h(c) + h(d)
  return `{${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}}`
}
const band = (n) => [`b${n}.tipo`, `b${n}.freq`, `b${n}.ganancia`, `b${n}.q`, `b${n}.activa`]
const bandNames = (n) => [`Banda ${n} Tipo`, `Banda ${n} Frecuencia`, `Banda ${n} Ganancia`, `Banda ${n} Q`, `Banda ${n} Activa`]
const eqIds = {}
eqIds[0] = ['bypass', 'Bypass']
for (let b = 1; b <= 8; b++) band(b).forEach((id, k) => (eqIds[1 + (b - 1) * 5 + k] = [id, bandNames(b)[k]]))
eqIds[41] = ['salida', 'Ganancia de salida']
eqIds[42] = ['pendiente', 'Pendiente HPF/LPF']
eqIds[43] = ['analizador', 'Analizador de espectro']

const PLUGINS = [
  {
    dir: 'com.jaswave.plugin.param-eq', target: 'JasWaveParamEq', name: 'JasWave EQ Parametric Pro', category: 'audio-effect',
    description: 'Ecualizador paramétrico de 8 bandas de tipo seleccionable (HPF, shelving, peak, notch, LPF), fase mínima y latencia 0.',
    classId: fuid(0x4A617357, 0x46584551, 0x50726F63, 0x56335431), sub: 'Fx|EQ', roles: ['mezcla', 'mastering', 'qa'],
    summary: 'Ecualizador paramétrico de 8 bandas para corrección y color (RBJ, 12–48 dB/oct en los cortes).',
    intents: ['cortar-graves', 'realzar-presencia', 'eliminar-resonancia', 'suavizar-agudos', 'dar-cuerpo'],
    ids: eqIds,
  },
  {
    dir: 'com.jaswave.plugin.bus-compressor', target: 'JasWaveBusCompressor', name: 'JasWave Bus Compressor', category: 'audio-effect',
    description: 'Compresor VCA feed-forward de bus con rodilla suave, detector Peak/RMS enlazado, filtro de sidechain y mezcla paralela.',
    classId: fuid(0x4A617357, 0x434F4D50, 0x50726F63, 0x56335431), sub: 'Fx|Dynamics', roles: ['productor', 'mezcla', 'mastering'],
    summary: 'Compresor de bus para cohesionar mezclas y controlar dinámica (umbral, ratio, rodilla, ataque, release).',
    intents: ['pegar-mezcla', 'controlar-picos', 'compresion-paralela', 'controlar-dinamica'],
    ids: { 0: ['bypass', 'Bypass'], 1: ['comp.umbral', 'Umbral'], 2: ['comp.ratio', 'Ratio'], 3: ['comp.ataque', 'Ataque'], 4: ['comp.release', 'Release'], 5: ['comp.rodilla', 'Rodilla'], 6: ['comp.makeup', 'Ganancia de compensación'], 7: ['comp.mezcla', 'Mezcla paralela'], 8: ['comp.sc-hpf', 'Filtro paso alto del sidechain (0 = off)'], 9: ['comp.detector', 'Detector'], 40: ['comp.gr', 'Reducción de ganancia (medidor)'] },
  },
  {
    dir: 'com.jaswave.plugin.truepeak-limiter', target: 'JasWaveTruePeakLimiter', name: 'JasWave True-Peak Limiter Pro', category: 'audio-effect',
    description: 'Limitador brickwall true-peak (detección 8x, verificación BS.1770-4) con lookahead ajustable, dither TPDF y sonoridad EBU R128.',
    classId: fuid(0x4A617357, 0x4C494D49, 0x50726F63, 0x56335431), sub: 'Fx|Dynamics|Mastering', roles: ['mastering', 'qa'],
    summary: 'Limitador de mastering que garantiza el techo true-peak y mide la sonoridad integrada.',
    intents: ['subir-sonoridad', 'proteger-techo', 'preparar-streaming', 'medir-lufs'],
    ids: { 0: ['bypass', 'Bypass'], 1: ['lim.techo', 'Techo true-peak'], 2: ['lim.ganancia', 'Ganancia de entrada'], 3: ['lim.release', 'Release'], 4: ['lim.lookahead', 'Lookahead'], 5: ['lim.dither', 'Dither'], 40: ['lim.gr', 'Reducción de ganancia (medidor)'] },
  },
  {
    dir: 'com.jaswave.plugin.smart-deesser', target: 'JasWaveSmartDeEsser', name: 'JasWave Smart De-Esser', category: 'audio-effect',
    description: 'De-esser de banda dividida (cruce Linkwitz-Riley 4º orden) o banda completa, con sidechain filtrado HP/BP, detección absoluta o relativa y escucha.',
    classId: fuid(0x4A617357, 0x44455352, 0x50726F63, 0x56335431), sub: 'Fx|Dynamics', roles: ['productor', 'mezcla', 'qa'],
    summary: 'Controla sibilancias y resonancias agudas de voces sin oscurecer el resto de la señal.',
    intents: ['quitar-sibilancia', 'suavizar-eses', 'domar-agudos-voz'],
    ids: { 0: ['bypass', 'Bypass'], 1: ['deesser.freq', 'Frecuencia'], 2: ['deesser.umbral', 'Umbral'], 3: ['deesser.rango', 'Rango máximo'], 4: ['deesser.modo', 'Modo'], 5: ['deesser.escucha', 'Escuchar sidechain'], 6: ['deesser.deteccion', 'Detección'], 7: ['deesser.filtro-sc', 'Filtro del sidechain'], 8: ['deesser.release', 'Release'], 40: ['deesser.gr', 'Reducción (medidor)'] },
  },
  {
    dir: 'com.jaswave.plugin.utility-tool', target: 'JasWaveUtility', name: 'JasWave Utility & Phase Tool', category: 'audio-effect',
    description: 'Utilidad de canal: ganancia ±24 dB, fase L/R, intercambio L/R, filtro DC, ancho estéreo M/S, mono por debajo de una frecuencia, mono y balance.',
    classId: fuid(0x4A617357, 0x5554494C, 0x50726F63, 0x56335431), sub: 'Fx|Tools', roles: ['director', 'productor', 'mezcla', 'mastering', 'qa'],
    summary: 'Ajustes de canal: ganancia, fase, imagen estéreo y mono-graves.',
    intents: ['ajustar-ganancia', 'corregir-fase', 'ensanchar-estereo', 'mono-graves', 'quitar-dc'],
    ids: { 0: ['bypass', 'Bypass'], 1: ['util.ganancia', 'Ganancia'], 2: ['util.ancho', 'Ancho estéreo'], 3: ['util.mono-bajo', 'Mono por debajo de (0 = off)'], 4: ['util.fase-l', 'Invertir fase L'], 5: ['util.fase-r', 'Invertir fase R'], 6: ['util.balance', 'Balance'], 7: ['util.dc', 'Filtro DC'], 8: ['util.swap', 'Intercambiar L/R'], 9: ['util.mono', 'Mono'] },
  },
  {
    dir: 'com.jaswave.plugin.piano-synth', target: 'JasWavePiano', name: 'JasWave Piano Synth', category: 'instrument',
    description: 'Piano de síntesis modal (sin muestras): parciales inarmónicos, cuerdas al unísono, martillo, pedal de sustain y polifonía de hasta 64 voces.',
    classId: fuid(0xB3A7C9E1, 0x4D2F4A8B, 0x9E6C1F3D, 0x5A7B8C0D), sub: 'Instrument|Piano', roles: ['productor'],
    summary: 'Piano acústico sintetizado con respuesta dinámica a la velocidad MIDI.',
    intents: ['piano-brillante', 'piano-suave', 'acompanamiento', 'balada'],
    ids: { 0: ['piano.velocidad', 'Sensibilidad a la velocidad'], 1: ['piano.brillo', 'Brillo'], 2: ['piano.decay', 'Duración de la cuerda'], 3: ['piano.release', 'Release de apagadores'], 4: ['piano.estereo', 'Ancho estéreo'], 5: ['bypass', 'Bypass'], 6: ['piano.volumen', 'Volumen'], 7: ['piano.afinacion', 'Afinación LA4'], 8: ['piano.dureza', 'Dureza del martillo'], 9: ['piano.sustain', 'Pedal de sustain (CC64)'] },
  },
  {
    dir: 'com.jaswave.plugin.roles-vst', target: 'JasWaveRoles', name: 'JasWave Roles', category: 'instrument',
    description: 'Instrumento por rol musical (batería, bajo, guitarra, piano, teclas, pad, cuerdas, coro, lead, metales, synth, percusión) con filtro y efectos.',
    classId: fuid(0x4A617357, 0x526F6C65, 0x50726F63, 0x56335431), sub: 'Instrument|Synth', roles: ['director', 'productor'],
    summary: 'Genera la parte de cada rol de un arreglo con un único instrumento ligero.',
    intents: ['bateria-basica', 'linea-de-bajo', 'pad-ambiente', 'cuerdas', 'boceto-arreglo'],
    ids: { 0: ['roles.rol', 'Rol'], 1: ['roles.ataque', 'Ataque'], 2: ['roles.release', 'Release'], 3: ['roles.corte', 'Corte del filtro'], 4: ['roles.resonancia', 'Resonancia'], 5: ['roles.nivel', 'Nivel'], 6: ['roles.voces', 'Voces'], 7: ['roles.drive', 'Drive'], 8: ['roles.gate', 'Gate'], 9: ['roles.chorus', 'Chorus'], 10: ['roles.delay', 'Delay'], 11: ['roles.reverb', 'Reverb'], 12: ['roles.eq-graves', 'EQ graves'], 13: ['roles.eq-agudos', 'EQ agudos'] },
  },
]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-params-'))
let mismatches = 0
for (const p of PLUGINS) {
  const exe = path.join(build, 'tools', config, `${p.target}_snapshot.exe`)
  if (!fs.existsSync(exe)) { console.error(`falta ${exe}: compila los plugins`); process.exit(2) }
  const dumpFile = path.join(tmp, `${p.target}.json`)
  execFileSync(exe, ['--dump-params', dumpFile])
  const dump = JSON.parse(fs.readFileSync(dumpFile, 'utf8'))
  const features = dump.features.map((f) => ({ key: f.key, description: f.label }))
  const parameters = dump.parameters.map((q) => {
    const meta = p.ids[q.vstParamId]
    if (!meta) throw new Error(`${p.dir}: falta id legible para vstParamId ${q.vstParamId}`)
    const toggle = q.map === 'stepped' && q.steps === 1 && q.labels.length === 2 && /^(Off|Active)$/.test(q.labels[0])
    const out = {
      id: meta[0], vstParamId: q.vstParamId, name: meta[1], min: q.min, max: q.max, default: q.default,
      unit: q.units, scale: q.map === 'stepped' ? (toggle ? 'toggle' : 'enum') : q.map, feature: q.feature,
    }
    if (q.map === 'stepped' && !toggle) out.values = q.labels
    if (q.readOnly) out.readOnly = true
    if (q.bypass) out.bypass = true
    return out
  })
  const bundle = `${p.target}.vst3`
  const manifest = {
    id: p.dir, name: p.name, version: '1.0.0', category: p.category, vendor: 'JasWave Audio', description: p.description,
    targetPlatforms: ['win-x64'],
    entrypoints: { dspDesktop: `bin/${bundle}` },
    vst3: { classId: p.classId, subCategories: p.sub },
    permissions: { realtimeAudio: true, fileSystem: 'none', network: false, commands: ['plugin.setParameter'] },
    rolesAllowed: p.roles,
    license: { productId: p.dir, features },
    ai: { summary: p.summary, intents: p.intents, parameters },
    download: { url: `https://github.com/JASBOOTSTUDIOS/jaswaveaudio/releases/download/plugins-v1.0.0/${p.dir}-1.0.0.zip`, sha256: '', sizeBytes: 0 },
    checksum: 'SHA256:',
  }
  const file = path.join(root, p.dir, 'jaswave-plugin.json')
  const text = JSON.stringify(manifest, null, 2) + '\n'
  if (check) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : ''
    if (cur !== text) { console.error(`DESINCRONIZADO: ${file}`); mismatches++ }
  } else {
    fs.writeFileSync(file, text)
    console.log(`${p.dir}: ${parameters.length} parámetros, ${features.length} features`)
  }
}
fs.rmSync(tmp, { recursive: true, force: true })
if (check) { console.log(mismatches ? `${mismatches} manifiesto(s) desincronizados` : 'manifiestos sincronizados con el código'); process.exit(mismatches ? 1 : 0) }
