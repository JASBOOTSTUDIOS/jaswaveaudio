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
// --only <nombre corto|target>: solo ese plugin (p. ej. compilado por separado en plugins/build_<slug>)
const only = opt('only', '')

const fuid = (a, b, c, d) => {
  const h = (x) => x.toString(16).toUpperCase().padStart(8, '0')
  const s = h(a) + h(b) + h(c) + h(d)
  return `{${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}}`
}
const band = (n) => [`b${n}.tipo`, `b${n}.freq`, `b${n}.ganancia`, `b${n}.q`, `b${n}.activa`]
const bandNames = (n) => [`Banda ${n} Tipo`, `Banda ${n} Frecuencia`, `Banda ${n} Ganancia`, `Banda ${n} Q`, `Banda ${n} Activa`]
// EQ dinámico: pool de 24 slots con IDs estables (param_eq_dsp.h: bandParam / extParam).
//   bandas 1..8  -> 1 + (b-1)*5 + campo            (IDs heredados, compatibles con JasWaveFx)
//   bandas 9..24 -> 400 + (b-9)*5 + campo
//   extra por banda (usada, pendiente propia, modo, solo) -> 100 + (b-1)*8 + campo
const EQ_BANDS = 24
const eqIds = {}
eqIds[0] = ['bypass', 'Bypass']
for (let b = 1; b <= EQ_BANDS; b++) {
  const base = b <= 8 ? 1 + (b - 1) * 5 : 400 + (b - 9) * 5
  band(b).forEach((id, k) => (eqIds[base + k] = [id, bandNames(b)[k]]))
  const ext = 100 + (b - 1) * 8
  eqIds[ext] = [`b${b}.usada`, `Banda ${b} Usada (alta/baja de la banda)`]
  eqIds[ext + 1] = [`b${b}.pendiente`, `Banda ${b} Pendiente propia (Global/12/24/36/48 dB/oct)`]
  eqIds[ext + 2] = [`b${b}.modo`, `Banda ${b} Modo (Stereo/Mid/Side/Left/Right)`]
  eqIds[ext + 3] = [`b${b}.solo`, `Banda ${b} Solo (escucha de la región de la banda)`]
}
eqIds[41] = ['salida', 'Ganancia de salida']
eqIds[42] = ['pendiente', 'Pendiente HPF/LPF']
eqIds[43] = ['analizador', 'Analizador de espectro']

const PLUGINS = [
  {
    dir: 'com.jaswave.plugin.param-eq', target: 'JasWaveParamEq', name: 'JasWave EQ Parametric Pro', category: 'audio-effect',
    description: 'Ecualizador paramétrico dinámico de hasta 24 bandas de tipo seleccionable (HPF, shelving, peak, notch, LPF, band-pass) con modos estéreo/mid/side/L/R, pendiente y solo por banda, medición de la señal por banda, fase mínima y latencia 0.',
    classId: fuid(0x4A617357, 0x46584551, 0x50726F63, 0x56335431), sub: 'Fx|EQ', roles: ['mezcla', 'mastering', 'qa'],
    summary: 'Ecualizador paramétrico de hasta 24 bandas dinámicas (activar/desactivar slots) para corrección y color (RBJ, 12–48 dB/oct en los cortes).',
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
    dir: 'com.jaswave.plugin.pedal-fix', target: 'JasWavePedalFix', name: 'JasWave Pedal Fix', category: 'audio-effect',
    description: 'Efecto MIDI (entrada y salida de eventos, audio de paso): unifica el pedal de sustain/sostenuto/suave que los teclados con voz dual/split (Yamaha PSR-E373 y familia) mandan por varios canales a la vez, corrige la polaridad, fuerza el sustain reteniendo los note-off para instrumentos que ignoran CC64, fija el canal de salida, transpone y escala la velocidad.',
    classId: fuid(0x4A617357, 0x5045444C, 0x50726F63, 0x56335431), sub: 'Fx|Tools', roles: ['director', 'productor', 'qa'],
    summary: 'Arregla el pedal de sustain de teclados que lo mandan por varios canales y hace que cualquier instrumento sostenga aunque ignore CC64.',
    intents: ['arreglar-sustain', 'unificar-pedal', 'invertir-pedal', 'fijar-canal-midi', 'transponer-midi'],
    ids: {
      0: ['bypass', 'Bypass'], 1: ['pedal.umbral', 'Umbral del pedal (valor desde el que cuenta como pisado)'], 2: ['pedal.transponer', 'Transposición'],
      3: ['pedal.velocidad', 'Escala de velocidad'], 4: ['pedal.fuente', 'Pedal que gobierna el sustain'], 5: ['pedal.canal', 'Canal de salida'],
      6: ['pedal.polaridad', 'Polaridad del pedal'], 7: ['pedal.forzar', 'Forzar sustain (retener note-off con el pedal pisado)'],
      8: ['pedal.unificar', 'Unificar canales (máximo entre los 16 canales)'], 9: ['pedal.redisparo', 'Redisparar notas retenidas'],
    },
  },
  {
    dir: 'com.jaswave.plugin.audio-doctor', target: 'JasWaveAudioDoctor', name: 'JasWave Audio Doctor', category: 'audio-effect',
    description: 'Restauración de audio universal: noise gate/expander con sidechain, denoise espectral (perfil aprendido o continuo), de-hum 50/60 Hz con seguimiento y armónicos, de-click, de-clip, de-reverb, aislador de voz, recuperación de aire, Auto-Fix por diagnóstico, escucha del delta (lo eliminado) y modo Live Mic de latencia mínima.',
    classId: fuid(0x4A617357, 0x41444F43, 0x50726F63, 0x56335431), sub: 'Fx|Restoration', roles: ['productor', 'mezcla', 'mastering', 'qa'],
    summary: 'Limpia grabaciones: quita ruido de fondo, zumbido de red, clics, recortes y reverberación, aísla la voz y, con Auto-Fix, decide los ajustes a partir de un diagnóstico del audio.',
    intents: ['limpiar-ruido', 'quitar-zumbido', 'quitar-clics', 'reparar-recorte', 'quitar-reverb', 'aislar-voz', 'reparar-audio-automatico', 'escuchar-lo-eliminado', 'silenciar-entre-frases'],
    ids: {
      0: ['bypass', 'Bypass'], 1: ['doctor.entrada', 'Ganancia de entrada'], 2: ['doctor.salida', 'Ganancia de salida'], 3: ['doctor.live', 'Modo Live Mic (latencia < 2 ms, calidad espectral reducida)'],
      4: ['doctor.delta', 'Delta: escuchar solo lo eliminado'], 5: ['doctor.autofix', 'Auto-Fix: analiza ~3 s de audio y aplica los ajustes recomendados (se apaga solo)'],
      10: ['gate.activo', 'Gate/Expander activo'], 11: ['gate.umbral', 'Gate umbral'], 12: ['gate.ratio', 'Gate ratio (1 = off, 20 = gate duro)'], 13: ['gate.ataque', 'Gate ataque'],
      14: ['gate.release', 'Gate release'], 15: ['gate.hold', 'Gate hold'], 16: ['gate.histeresis', 'Gate histéresis'], 17: ['gate.sc-hpf', 'Gate filtro paso alto del sidechain'],
      20: ['denoise.activo', 'Denoise activo'], 21: ['denoise.reduccion', 'Denoise reducción máxima'], 22: ['denoise.aprender', 'Denoise aprender perfil de ruido (activar con solo ruido)'],
      23: ['denoise.modo', 'Denoise modo del perfil (Auto/Aprendido/Continuo)'], 24: ['denoise.suavizado', 'Denoise suavizado (más = menos ruido musical)'],
      30: ['hum.activo', 'De-Hum activo'], 31: ['hum.frecuencia', 'De-Hum frecuencia de red (Auto/50/60)'], 32: ['hum.armonicos', 'De-Hum armónicos'], 33: ['hum.q', 'De-Hum Q'], 34: ['hum.profundidad', 'De-Hum profundidad'],
      50: ['declick.activo', 'De-Click activo'], 51: ['declick.sensibilidad', 'De-Click sensibilidad'], 52: ['declick.ancho', 'De-Click ancho máximo'],
      60: ['declip.activo', 'De-Clip activo'], 61: ['declip.umbral', 'De-Clip umbral de recorte'], 62: ['declip.fuerza', 'De-Clip fuerza'],
      70: ['dereverb.activo', 'De-Reverb activo'], 71: ['dereverb.cantidad', 'De-Reverb cantidad'], 72: ['dereverb.cola', 'De-Reverb cola estimada'],
      80: ['voz.activo', 'Aislador de voz activo'], 81: ['voz.grave', 'Aislador de voz frecuencia grave'], 82: ['voz.agudo', 'Aislador de voz frecuencia aguda'], 83: ['voz.profundidad', 'Aislador de voz profundidad'],
      90: ['escudo.activo', 'Escudo de transitorios activo'], 91: ['escudo.cantidad', 'Escudo de transitorios cantidad'],
      95: ['aire.activo', 'Recuperación de aire activa'], 96: ['aire.frecuencia', 'Aire frecuencia'], 97: ['aire.ganancia', 'Aire ganancia'],
      120: ['diag.ruido', 'Diagnóstico: ruido de fondo (medidor)'], 121: ['diag.hum', 'Diagnóstico: hum detectado (medidor)'], 122: ['diag.hum-nivel', 'Diagnóstico: nivel del hum (medidor)'],
      123: ['diag.clics', 'Diagnóstico: clics por segundo (medidor)'], 124: ['diag.recorte', 'Diagnóstico: % de muestras recortadas (medidor)'], 125: ['diag.reverberancia', 'Diagnóstico: reverberancia (medidor)'],
      126: ['diag.reduccion', 'Reducción aplicada (medidor)'],
    },
  },
  {
    dir: 'com.jaswave.plugin.stomplab', target: 'JasWaveStompLab', name: 'JasWave StompLab', category: 'audio-effect',
    description: 'Pedalera universal para guitarra, bajo, teclados y voz: gate, compresor, overdrive de 5 modelos (Clean Boost, Overdrive, Distortion, Fuzz, Metal), preamp de válvulas con 3 canales y pila de tonos, cabina con IR de fase mínima (5 modelos + DI), chorus estéreo, delay (stereo, ping-pong, cinta) y shimmer (reverb con octava). Etapas no lineales sobremuestreadas x2, latencia fija de 15 muestras.',
    classId: fuid(0x4A617357, 0x53544D50, 0x50726F63, 0x56335431), sub: 'Fx|Distortion', roles: ['productor', 'mezcla', 'qa'],
    summary: 'Cadena de pedales para dar carácter a guitarras, bajos y teclados: distorsión, amplificador, cabina y efectos de espacio (chorus, delay, shimmer) controlables por la IA.',
    intents: ['guitarra-limpia', 'guitarra-crunch', 'guitarra-distorsion', 'sonido-ambiental-worship', 'efecto-shimmer', 'eco-delay', 'chorus-estereo', 'comprimir-guitarra', 'simular-amplificador', 'quitar-ruido-de-pedal'],
    ids: {
      0: ['bypass', 'Bypass'], 1: ['stomp.entrada', 'Ganancia de entrada'], 2: ['stomp.salida', 'Ganancia de salida'], 3: ['stomp.mezcla', 'Mezcla seco/procesado global'],
      10: ['gate.activo', 'Gate activo'], 11: ['gate.umbral', 'Gate umbral'], 12: ['gate.release', 'Gate release'], 13: ['gate.rango', 'Gate rango de atenuación'],
      20: ['comp.activo', 'Compresor activo'], 21: ['comp.umbral', 'Compresor umbral'], 22: ['comp.ratio', 'Compresor ratio'], 23: ['comp.ataque', 'Compresor ataque'],
      24: ['comp.release', 'Compresor release'], 25: ['comp.makeup', 'Compresor ganancia de compensación'], 26: ['comp.blend', 'Compresor mezcla paralela'], 27: ['comp.rodilla', 'Compresor rodilla'],
      30: ['drive.activo', 'Drive activo'], 31: ['drive.modelo', 'Drive modelo (Clean Boost/Overdrive/Distortion/Fuzz/Metal)'], 32: ['drive.cantidad', 'Drive cantidad de ganancia'],
      33: ['drive.tono', 'Drive tono (corte de agudos)'], 34: ['drive.nivel', 'Drive nivel de salida'],
      40: ['amp.activo', 'Preamp de válvulas activo'], 41: ['amp.canal', 'Preamp canal (Clean/Crunch/Lead)'], 42: ['amp.ganancia', 'Preamp ganancia'], 43: ['amp.graves', 'Preamp graves'],
      44: ['amp.medios', 'Preamp medios'], 45: ['amp.agudos', 'Preamp agudos'], 46: ['amp.presencia', 'Preamp presencia'], 47: ['amp.master', 'Preamp volumen master'],
      48: ['amp.sag', 'Preamp sag (compresión de la fuente)'], 49: ['amp.brillo', 'Preamp bright'],
      50: ['cabina.activa', 'Cabina IR activa'], 51: ['cabina.modelo', 'Cabina modelo (1x12 Open/2x12 Combo/4x12 Closed/Vintage Bright/British 2x12/DI)'], 52: ['cabina.corte-graves', 'Cabina corte de graves'],
      53: ['cabina.corte-agudos', 'Cabina corte de agudos'], 54: ['cabina.mezcla', 'Cabina mezcla (IR frente a señal directa)'],
      60: ['chorus.activo', 'Chorus activo'], 61: ['chorus.velocidad', 'Chorus velocidad'], 62: ['chorus.profundidad', 'Chorus profundidad'], 63: ['chorus.mezcla', 'Chorus mezcla'],
      70: ['delay.activo', 'Delay activo'], 71: ['delay.tiempo', 'Delay tiempo'], 72: ['delay.realimentacion', 'Delay realimentación'], 73: ['delay.tono', 'Delay tono de los ecos'],
      74: ['delay.mezcla', 'Delay mezcla'], 75: ['delay.modo', 'Delay modo (Stereo/Ping-Pong/Tape)'],
      80: ['shimmer.activo', 'Shimmer activo'], 81: ['shimmer.mezcla', 'Shimmer mezcla'], 82: ['shimmer.cola', 'Shimmer duración de la cola (T60)'], 83: ['shimmer.octava', 'Shimmer cantidad de octava arriba'],
      84: ['shimmer.amortiguacion', 'Shimmer amortiguación de agudos'],
      120: ['gate.gr', 'Reducción del gate (medidor)'], 121: ['comp.gr', 'Reducción del compresor (medidor)'],
    },
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
  {
    dir: 'com.jaswave.plugin.vocal-tune', target: 'JasWaveVocalTune', name: 'JasWave Vocal Tune', category: 'audio-effect',
    description: 'Afinador automático de voz: detección de tono YIN, corrección a escala/tónica con PSOLA que conserva los formantes, preservación de vibrato, humanización y latencia de 2,5 ms en modo de baja latencia.',
    classId: fuid(0x4A617357, 0x56545545, 0x50726F63, 0x56335431), sub: 'Fx|Pitch Shift', roles: ['productor', 'mezcla', 'qa'],
    summary: 'Corrige la afinación de voces monofónicas hacia la escala elegida de forma natural, sin efecto robótico salvo con Retune Speed a 0.',
    intents: ['afinar-voz', 'corregir-desafinacion', 'efecto-robotico', 'cambiar-formantes'],
    ids: {
      0: ['bypass', 'Bypass'], 1: ['vt.retune', 'Velocidad de corrección (Retune Speed)'], 2: ['vt.humanize', 'Humanización de notas sostenidas'],
      3: ['vt.vibrato', 'Preservar vibrato'], 4: ['vt.formantes', 'Desplazamiento de formantes'], 5: ['vt.garganta', 'Longitud de garganta'],
      6: ['vt.tracking', 'Sensibilidad de detección'], 7: ['vt.escala', 'Escala'], 8: ['vt.tonica', 'Tónica'], 9: ['vt.mezcla', 'Mezcla'],
      10: ['vt.baja-latencia', 'Modo de baja latencia'], 40: ['vt.tono-detectado', 'Tono detectado (medidor)'], 41: ['vt.correccion', 'Corrección aplicada en cents (medidor)'],
    },
  },
  {
    dir: 'com.jaswave.plugin.vocal-choir', target: 'JasWaveVocalChoir', name: 'JasWave Vocal Choir', category: 'audio-effect',
    description: 'Coro controlado por MIDI de hasta 4 voces: cada nota toca una voz PSOLA que conserva los formantes de la fuente (la entrada de audio o una vocal formántica interna A/E/I/O/U), con spread estéreo, vibrato, humanización, desafinación por voz y portamento al robar voces. Latencia fija de 10 ms.',
    classId: fuid(0x4A617357, 0x56434852, 0x50726F63, 0x56335431), sub: 'Fx|Pitch Shift', roles: ['director', 'productor', 'qa'],
    summary: 'Convierte una voz (o una vocal interna) en un coro armónico tocable por MIDI de hasta 4 voces, sin voz de ardilla porque los formantes no se mueven con el tono.',
    intents: ['coro-armonico', 'armonizar-voz', 'coros-worship', 'voz-sintetica', 'cantar-letra'],
    ids: {
      0: ['bypass', 'Bypass'], 1: ['vc.voces', 'Número de voces (1–4)'], 2: ['vc.spread', 'Spread estéreo'], 3: ['vc.formantes', 'Desplazamiento de formantes'],
      4: ['vc.garganta', 'Longitud de garganta'], 5: ['vc.fuente', 'Fuente (Entrada de audio / Vocal interna)'], 6: ['vc.vocal', 'Vocal de la fuente interna'],
      7: ['vc.tesitura', 'Tesitura de la fuente interna'], 8: ['vc.ataque', 'Ataque'], 9: ['vc.release', 'Release'], 10: ['vc.vibrato-prof', 'Profundidad del vibrato'],
      11: ['vc.vibrato-vel', 'Velocidad del vibrato'], 12: ['vc.humanizar', 'Humanización (deriva de tono)'], 13: ['vc.desafinacion', 'Desafinación entre voces'],
      14: ['vc.glide', 'Portamento al robar voz'], 15: ['vc.nivel', 'Nivel de salida'], 16: ['vc.original', 'Voz original (mezcla seca)'],
      40: ['vc.tono-fuente', 'Tono de la fuente (medidor)'], 41: ['vc.voces-activas', 'Voces activas (medidor)'],
    },
  },
]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-params-'))
let mismatches = 0
const seleccion = only ? PLUGINS.filter((p) => p.dir.endsWith(only) || p.target === only) : PLUGINS
if (!seleccion.length) { console.error(`--only ${only}: ningún plugin con ese nombre`); process.exit(2) }
for (const p of seleccion) {
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
    // control esencial: visible en el modo Básico del editor (el modo Avanzado muestra todos)
    if (q.basico) out.basico = true
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
    download: { url: `https://github.com/JASBOOTSTUDIOS/jaswaveaudio/releases/download/plugins-v1.0.0/${p.dir}-1.0.0.jwx`, sha256: '', sizeBytes: 0 },
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
