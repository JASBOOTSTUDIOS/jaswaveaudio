#!/usr/bin/env node
/**
 * Generador reproducible de la biblioteca de grooves MIDI de serie de JasWave (M).
 *
 * Todo el contenido es ORIGINAL (patrones escritos aquí, licencia CC0 1.0); no se copia ni se deriva de ninguna
 * librería comercial. La salida es determinista: misma versión del script = mismos bytes (semillas por nombre).
 *
 *   node plugins/grooves/tools/generar_grooves.mjs            # escribe plugins/grooves/estilos + catalogo.json
 *   node plugins/grooves/tools/generar_grooves.mjs --verificar # falla si lo escrito difiere de lo generado
 *
 * Formato de patrón: una cadena por voz con un carácter por paso de la rejilla. «.» = silencio; «1»–«9» =
 * velocidad (1 = fantasma, 9 = acento fuerte). La cadena puede ser de un compás (se repite) o de todos los compases.
 * Rejillas: '16' = 4/4 en semicorcheas (16 pasos), '12T' = 4/4 con tresillos (12 pasos), '68' = 6/8 en
 * semicorcheas (12 pasos, compás de 3 beats), '128' = 12/8 en corcheas (12 pasos, compás de 6 beats),
 * '34T' = 3/4 con tresillos (9 pasos).
 * Mapa GM (el de Worship Drums): bombo 35/36, caja 38, cross-stick 37, palmas 39, toms 41–50, hi-hat 42/44/46,
 * crashes 49/57, ride 51, campana de ride 53, pandereta 54, cencerro 56, etc.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..')
const SALIDA = join(RAIZ, 'estilos')
const REVISION = 1
const AUTOR = 'JasWave'
const LICENCIA = 'CC0-1.0'

const PITCH = {
  kick: 36, kick2: 35, snare: 38, xstick: 37, clap: 39, hat: 42, hatp: 44, hato: 46,
  tomL: 41, tomLm: 43, tomM: 45, tomMh: 47, tomH: 48, tomHh: 50,
  crash: 49, crash2: 57, ride: 51, bell: 53, tamb: 54, cowbell: 56, splash: 55, shaker: 70, claves: 75, agogo: 67,
}
const REJILLAS = {
  '16': { pasos: 16, compas: [4, 4], porBeat: 4 },
  '12T': { pasos: 12, compas: [4, 4], porBeat: 3 },
  '68': { pasos: 12, compas: [6, 8], porBeat: 4 },
  '128': { pasos: 12, compas: [12, 8], porBeat: 2 },
  '34T': { pasos: 9, compas: [3, 4], porBeat: 3 },
}
const beatsCompas = (r) => (r.compas[0] * 4) / r.compas[1]

// ── Utilidades deterministas ─────────────────────────────────────────────────
function semilla(texto) {
  let h = 2166136261
  for (const c of texto) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
function prng(s) {
  let x = s || 1
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 0x100000000
  }
}
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ── Fills por rejilla (un compás) ────────────────────────────────────────────
const FILLS = {
  '16': [
    { n: 'caja al cuarto', int: 3, v: { kick: '9.....5.9.5.....', snare: '....8.......6.79' } },
    { n: 'redoble de caja', int: 4, v: { kick: '9...............', snare: '....8.......5689' } },
    { n: 'toms bajando', int: 4, v: { kick: '9...............', snare: '....8.8.........', tomH: '........8.8.....', tomM: '............8.8.' } },
    { n: 'toms subiendo', int: 4, v: { kick: '9.......9.......', tomL: '....8.8.........', tomM: '........8.8.....', tomH: '............8.9.' } },
    { n: 'redoble largo', int: 5, v: { kick: '9...............', snare: '5.5.6.6.7.7.8.8.' } },
  ],
  '12T': [
    { n: 'caja en tresillos', int: 3, v: { kick: '9.....9.....', snare: '...9..6.9.9.' } },
    { n: 'toms en tresillos', int: 4, v: { kick: '9...........', snare: '...6.6......', tomH: '......7.7...', tomL: '..........89' } },
  ],
  '68': [
    { n: 'caja 6-8', int: 3, v: { kick: '9.....5.....', snare: '......6.7.89' } },
    { n: 'toms 6-8', int: 4, v: { kick: '9...........', tomH: '....6.7.....', tomM: '........7.8.', tomL: '.........8.9' } },
  ],
  '128': [
    { n: 'caja 12-8', int: 3, v: { kick: '9.....6.....', snare: '...5.5.6.789' } },
    { n: 'toms 12-8', int: 4, v: { kick: '9...........', tomH: '......6.7...', tomM: '..........8.', tomL: '...........9' } },
  ],
  '34T': [{ n: 'caja vals', int: 3, v: { kick: '9........', snare: '...6.6.79' } }],
}

// ── Catálogo de patrones base ────────────────────────────────────────────────
// e: estilo · s: subestilo · n: nombre · g: rejilla · b: bpm · i: intensidad · c: compases · t: etiquetas
// v: voces · f: fill del final (índice del fondo de la rejilla; solo si c = 4) · ghost: notas fantasma en compases pares
// crash: crash en el primer tiempo · cres: [desde, hasta] escala de velocidad (crescendo) · atras: caja retrasada (beats)
const B = []
const add = (e, s, n, g, b, i, c, t, v, extra = {}) => B.push({ e, s, n, g, b, i, c, t, v, ...extra })

// WORSHIP moderno 4/4
add('Worship', '4-4', 'Verso suave cross-stick', '16', 74, 2, 2, ['verso', 'suave', 'cross-stick'], { kick: '9.....5.7.5.....', xstick: '....6.......6...', hat: '6.3.5.3.6.3.5.3.' }, { ghost: true })
add('Worship', '4-4', 'Verso ride y campana', '16', 72, 2, 2, ['verso', 'ride', 'campana-de-ride', 'cross-stick'], { kick: '9.......7.5.....', xstick: '....6.......6...', ride: '6.4.5.4.6.4.5.4.', bell: '......5.......5.' })
add('Worship', '4-4', 'Verso hi-hat en semicorcheas', '16', 78, 3, 4, ['verso', 'hi-hat-16'], { kick: '9.....5.7.5...6.', xstick: '....7.......7...', hat: '6435643564356435' }, { ghost: true, f: 0 })
add('Worship', '4-4', 'Pre-coro en crecimiento', '16', 76, 3, 2, ['pre-coro', 'crecimiento'], { kick: '9.....6.9.6.....', snare: '....8.......8...', hat: '7.4.6.4.7.4.6...', hato: '..............7.' }, { ghost: true })
add('Worship', '4-4', 'Coro pleno', '16', 76, 4, 4, ['coro', 'pleno'], { kick: '9.....5.9.5..6..', snare: '....9.......9...', hat: '8.5.7.5.8.5.7.5.' }, { crash: true, ghost: true, f: 2 })
add('Worship', '4-4', 'Coro abierto en ride', '16', 76, 4, 4, ['coro', 'ride', 'abierto'], { kick: '9.....5.9.5.....', snare: '....9.......9...', ride: '8.6.7.6.8.6.7.6.', bell: '..............5.' }, { crash: true, f: 1 })
add('Worship', '4-4', 'Coro épico', '16', 80, 5, 4, ['coro', 'epico', 'potente'], { kick: '9.5.5.6.9.5.5.6.', snare: '....9.......9...', ride: '9.7.8.7.9.7.8.7.' }, { crash: true, f: 4 })
add('Worship', '4-4', 'Puente con crescendo', '16', 74, 3, 4, ['puente', 'crescendo', 'toms'], { kick: '9...9...9...9...', tomL: '7...7...7...7...', snare: '..4...4...4...4.' }, { cres: [0.55, 1.15], f: 3 })
add('Worship', '4-4', 'Puente marcha de caja', '16', 72, 4, 4, ['puente', 'crescendo', 'marcha'], { kick: '9.......9.......', snare: '4.4.5.5.6.6.7.7.' }, { cres: [0.6, 1.1], f: 4 })
add('Worship', '4-4', 'Puente tenso con campana', '16', 70, 2, 2, ['puente', 'campana-de-ride', 'cross-stick'], { kick: '9.......6.......', xstick: '..6...6...6...6.', bell: '7...7...7...7...' })
add('Worship', '4-4', 'Medio tiempo de oración', '16', 66, 1, 2, ['oracion', 'suave', 'medio-tiempo'], { kick: '8...............', xstick: '........5.......', hat: '4.2.4.2.4.2.4.2.' })
add('Worship', '4-4', 'Adoración con pandereta', '16', 68, 2, 2, ['adoracion', 'pandereta', 'suave'], { kick: '8.......6.......', hatp: '6...6...6...6...', tamb: '..4...4...4...4.' })
add('Worship', '4-4', 'Coro con palmas', '16', 78, 4, 2, ['coro', 'palmas', 'pop-worship'], { kick: '9.....5.9.5.....', snare: '....8.......8...', clap: '....7.......7...', hat: '8.5.7.5.8.5.7.5.' }, { crash: true })
// WORSHIP 6/8
add('Worship', '6-8', 'Verso 6-8 suave', '68', 62, 2, 2, ['verso', 'suave', 'cross-stick', '6-8'], { kick: '9.....5.5...', xstick: '......7.....', hat: '6.4.6.4.6.4.' }, { ghost: true })
add('Worship', '6-8', 'Verso 6-8 con ride', '68', 64, 2, 2, ['verso', 'ride', '6-8'], { kick: '9.....5.5...', xstick: '......6.....', ride: '7.4.4.6.4.4.' })
add('Worship', '6-8', 'Verso 6-8 campana', '68', 60, 2, 2, ['verso', 'campana-de-ride', 'cross-stick', '6-8'], { kick: '9.......5...', xstick: '......6.....', bell: '6.....5.....', hat: '4.3.4.3.4.3.' })
add('Worship', '6-8', 'Coro 6-8', '68', 66, 4, 4, ['coro', 'pleno', '6-8'], { kick: '9.....5.5.6.', snare: '......9.....', hat: '8.5.5.7.5.5.' }, { crash: true, ghost: true, f: 0 })
add('Worship', '6-8', 'Coro 6-8 ride y campana', '68', 66, 4, 4, ['coro', 'ride', 'campana-de-ride', '6-8'], { kick: '9.....5.5...', snare: '......9.....', ride: '8.5.5.7.5.5.', bell: '......6.....' }, { crash: true, f: 1 })
add('Worship', '6-8', 'Puente 6-8 crescendo', '68', 62, 3, 4, ['puente', 'crescendo', 'toms', '6-8'], { tomL: '9.5.5.7.5.5.', kick: '9.....6.....', snare: '......4.4.4.' }, { cres: [0.55, 1.15], f: 1 })
add('Worship', '6-8', 'Oración 6-8', '68', 56, 1, 2, ['oracion', 'suave', '6-8'], { kick: '8...........', xstick: '......5.....', hat: '5.3.3.4.3.3.' })
// POP
add('Pop', '', 'Pop clásico', '16', 110, 3, 2, ['pop', 'ocho-notas'], { kick: '9.....5.9.5.....', snare: '....9.......9...', hat: '7.4.6.4.7.4.6.4.' }, { ghost: true })
add('Pop', '', 'Pop con semicorcheas', '16', 104, 3, 2, ['pop', 'hi-hat-16'], { kick: '9.....6.8..6....', snare: '....9.......9...', hat: '7435643576357435' }, { ghost: true })
add('Pop', '', 'Pop bailable', '16', 118, 4, 2, ['pop', 'bailable', 'palmas'], { kick: '9...9...9...9...', clap: '....8.......8...', hat: '6...6...6...6...', hato: '..8...8...8...8.' })
add('Pop', '', 'Pop sintético', '16', 100, 3, 4, ['pop', 'synth', 'recto'], { kick: '9...9...9...9...', snare: '....9.......9...', hat: '6.6.6.6.6.6.6.6.' }, { f: 0 })
add('Pop', '', 'Pop verso ligero', '16', 96, 2, 2, ['pop', 'verso', 'cross-stick'], { kick: '9.......7.5.....', xstick: '....7.......7...', hat: '6.3.5.3.6.3.5.3.' })
// ROCK
add('Rock', '', 'Rock de corcheas', '16', 120, 4, 2, ['rock', 'ocho-notas'], { kick: '9.....6.9.6.....', snare: '....9.......9...', hat: '8.5.7.5.8.5.7.5.' }, { ghost: true, crash: true })
add('Rock', '', 'Rock duro', '16', 126, 5, 4, ['rock', 'duro', 'potente'], { kick: '9.5.5...9.6.5...', snare: '....9.......9...', hat: '9.7.8.7.9.7.8.7.' }, { crash: true, f: 4 })
add('Rock', '', 'Rock lento y pesado', '16', 72, 3, 2, ['rock', 'pesado', 'medio-tiempo'], { kick: '9.......9.5.....', snare: '........9.......', hat: '7.4.6.4.7.4.6.4.' })
add('Rock', '', 'Punk veloz', '16', 168, 5, 2, ['rock', 'punk', 'rapido'], { kick: '9.5.9.5.9.5.9.5.', snare: '....9.......9...', hat: '8.8.8.8.8.8.8.8.' })
add('Rock', '', 'Rock con ride', '16', 116, 4, 4, ['rock', 'ride'], { kick: '9.....5.9.6.....', snare: '....9.......9...', ride: '8.6.7.6.8.6.7.6.' }, { crash: true, f: 2 })
// POP-ROCK
add('Pop-Rock', '', 'Pop-rock medio', '16', 112, 3, 2, ['pop-rock', 'medio'], { kick: '9.....5.9.5.....', snare: '....9.......9...', hat: '7.5.7.5.7.5.7.5.' }, { ghost: true })
add('Pop-Rock', '', 'Pop-rock empuje', '16', 124, 4, 4, ['pop-rock', 'empuje', 'coro'], { kick: '9.5...5.9.5.5...', snare: '....9.......9...', hat: '8.6.7.6.8.6.7.6.' }, { crash: true, f: 0 })
add('Pop-Rock', '', 'Pop-rock con pandereta', '16', 108, 3, 2, ['pop-rock', 'pandereta'], { kick: '9.....5.8.5.....', snare: '....8.......8...', tamb: '3.3.3.3.3.3.3.3.', hat: '6.4.6.4.6.4.6.4.' })
// INDIE
add('Indie', '', 'Indie seco', '16', 118, 3, 2, ['indie', 'seco'], { kick: '9.....5.....6...', snare: '....7.......7...', hat: '6.5.6.5.6.5.6.5.' }, { ghost: true })
add('Indie', '', 'Indie ride flojo', '16', 104, 2, 2, ['indie', 'ride', 'suave'], { kick: '9.......6.5.....', xstick: '....6.......6...', ride: '6.4.5.4.6.4.5.4.' }, { ghost: true })
add('Indie', '', 'Indie bailable', '16', 128, 4, 4, ['indie', 'bailable', 'toms'], { kick: '9...9...9...9...', tomL: '....6.......6...', snare: '......6.......6.', hat: '..7...7...7...7.' }, { f: 3 })
// BALADA
add('Balada', '', 'Balada con rimshot', '16', 66, 2, 2, ['balada', 'cross-stick', 'lenta'], { kick: '9.......6.5.....', xstick: '....6.......6...', hat: '5.3.4.3.5.3.4.3.' }, { atras: 0.012 })
add('Balada', '', 'Balada de corcheas', '16', 70, 2, 2, ['balada', 'suave'], { kick: '9.....5.7.......', snare: '....7.......7...', hat: '5.3.4.3.5.3.4.3.' }, { atras: 0.01 })
add('Balada', '', 'Balada con ride', '16', 62, 3, 4, ['balada', 'ride', 'pasional'], { kick: '9.....5.8.5.....', snare: '....8.......8...', ride: '6.4.5.4.6.4.5.4.' }, { crash: true, f: 0 })
add('Balada', '', 'Balada en 3 tiempos', '34T', 78, 2, 2, ['balada', 'vals', '3-4'], { kick: '9........', hatp: '...6..6..', hat: '5.35.35.3' })
// SHUFFLE / BLUES
add('Shuffle-Blues', '', 'Shuffle básico', '12T', 100, 3, 2, ['shuffle', 'blues'], { kick: '9.....8.....', snare: '...9.....9..', hat: '9.69.69.69.6' }, { ghost: true })
add('Shuffle-Blues', '', 'Blues lento', '12T', 62, 2, 2, ['blues', 'lento'], { kick: '9.....7.....', snare: '...8.....8..', hat: '635635635635' }, { atras: 0.015 })
add('Shuffle-Blues', '', 'Shuffle Texas', '12T', 112, 4, 4, ['shuffle', 'texas', 'bombo-al-pulso'], { kick: '9..8..9..8..', snare: '...9.....9..', ride: '8.58.58.58.5' }, { f: 0 })
add('Shuffle-Blues', '', 'Shuffle Chicago fantasmas', '12T', 96, 3, 2, ['shuffle', 'chicago', 'fantasmas'], { kick: '9.....7.....', snare: '..2.9..2.9.2', hat: '9.69.69.69.6' })
// JAZZ
add('Jazz', 'Swing', 'Swing medio con ride', '12T', 132, 3, 2, ['jazz', 'swing', 'ride'], { ride: '9..8.69..8.6', hatp: '...7.....7..', kick: '3..3..3..3..', snare: '..........4.' }, { ghost: true })
add('Jazz', 'Swing', 'Swing rápido', '12T', 190, 3, 4, ['jazz', 'swing', 'rapido'], { ride: '9..8.69..8.6', hatp: '...7.....7..', kick: '4..3..4..3..' }, { f: 0 })
add('Jazz', 'Swing', 'Balada de escobillas', '12T', 66, 1, 2, ['jazz', 'escobillas', 'balada'], { snare: '4..4..4..4..', ride: '5..4.35..4.3', hatp: '...5.....5..' }, { atras: 0.01, durLargas: ['snare'] })
add('Jazz', 'Swing', 'Escobillas medio swing', '12T', 120, 2, 2, ['jazz', 'escobillas', 'swing'], { snare: '5.35.35.35.3', kick: '3..3..3..3..', hatp: '...6.....6..' }, { durLargas: ['snare'] })
add('Jazz', 'Vals', 'Vals de jazz', '34T', 150, 3, 2, ['jazz', 'vals', '3-4', 'ride'], { ride: '9..8.68..', hatp: '...6.....', kick: '4........' })
// FUNK
add('Funk', '', 'Funk clásico', '16', 100, 4, 2, ['funk', 'fantasmas'], { kick: '9.....5.5.9..6..', snare: '.2..9..2.2..9..2', hat: '7545754575457545' })
add('Funk', '', 'Funk sincopado', '16', 96, 4, 4, ['funk', 'sincopado'], { kick: '9..6..5...9..6..', snare: '..2.9..2.2..9.2.', hat: '7535753575357535' }, { f: 0 })
add('Funk', '', 'Funk con hi-hat abierto', '16', 106, 4, 2, ['funk', 'hi-hat-abierto'], { kick: '9..5..6.5.9...5.', snare: '.2..9..2.2..9..2', hat: '7545754575457.45', hato: '.............7..' })
add('Funk', '', 'Funk lento', '16', 84, 3, 2, ['funk', 'lento', 'ride'], { kick: '9.....5.....9.5.', snare: '..2.9..2..2.9...', ride: '7.5.7.5.7.5.7.5.' })
// SOUL
add('Soul', '', 'Soul Motown', '16', 108, 3, 2, ['soul', 'pandereta', 'motown'], { kick: '9.....5.9.......', snare: '....9.......9...', tamb: '6.6.6.6.6.6.6.6.', hat: '7.5.7.5.7.5.7.5.' })
add('Soul', '', 'Soul lento', '16', 72, 2, 2, ['soul', 'lento', 'cross-stick'], { kick: '9.....5.....7...', xstick: '....7.......7...', hat: '6.4.5.4.6.4.5.4.' }, { atras: 0.012 })
add('Soul', '', 'Soul con palmas', '16', 96, 3, 4, ['soul', 'palmas'], { kick: '9.....5.8.5.....', snare: '....8.......8...', clap: '....6.......6...', hat: '6.4.6.4.6.4.6.4.' }, { f: 0 })
// REGGAE
add('Reggae', '', 'One drop', '16', 74, 2, 2, ['reggae', 'one-drop'], { kick: '........9.......', xstick: '........8.......', hat: '6.5.6.5.6.5.6.5.' })
add('Reggae', '', 'Rockers', '16', 80, 3, 2, ['reggae', 'rockers'], { kick: '9...9...9...9...', xstick: '........8.......', hat: '6.5.6.5.6.5.6.5.' })
add('Reggae', '', 'Steppers', '16', 84, 3, 4, ['reggae', 'steppers'], { kick: '9...9...9...9...', snare: '........8.......', hat: '..6...6...6...6.', tamb: '4.4.4.4.4.4.4.4.' }, { f: 0 })
// LATIN
add('Latin', 'Bossa', 'Bossa nova', '16', 128, 2, 2, ['latin', 'bossa', 'clave'], { kick: '9.....6.9.....6.', xstick: '9..9..9...9.9...', hatp: '....6.......6...', hat: '5.5.5.5.5.5.5.5.' })
add('Latin', 'Bossa', 'Bossa con ride', '16', 120, 2, 4, ['latin', 'bossa', 'ride'], { kick: '9.....6.9.....6.', xstick: '9..9..9...9.9...', ride: '6.4.6.4.6.4.6.4.' }, { f: 0 })
add('Latin', 'Samba', 'Samba', '16', 100, 4, 2, ['latin', 'samba', 'surdo'], { kick: '6.....9.6.....9.', xstick: '9..9..9...9.9...', hat: '7.5.7.5.7.5.7.5.', tamb: '6.4.6.4.6.4.6.4.' })
add('Latin', '', 'Cascara', '16', 116, 3, 2, ['latin', 'cascara', 'campana-de-ride'], { kick: '9.....6.9.....6.', bell: '8.6.8..68.6.8.6.', hatp: '....6.......6...' })
add('Latin', '', 'Cumbia', '16', 92, 3, 2, ['latin', 'cumbia', 'pandereta'], { kick: '9.......9.......', snare: '....6..6....6...', tamb: '7.5.7.5.7.5.7.5.', hat: '5.3.5.3.5.3.5.3.' })
add('Latin', '', 'Reggaetón dembow', '16', 94, 4, 2, ['latin', 'reggaeton', 'dembow'], { kick: '9...9...9...9...', snare: '...9..9....9..9.', hat: '6.4.6.4.6.4.6.4.' })
// AFROBEAT
add('Afrobeat', '', 'Afrobeat clásico', '16', 104, 4, 4, ['afrobeat', 'cencerro', 'groove'], { kick: '9..6..5..9..6...', xstick: '....6..6..6..6..', cowbell: '8..7..8.7..8..7.', hat: '7.5.7.5.7.5.7.5.' }, { f: 0 })
add('Afrobeat', '', 'Afrobeats moderno', '16', 100, 3, 2, ['afrobeat', 'moderno', 'palmas'], { kick: '9..6..9...6.....', clap: '....7.......7...', hat: '6.4.6.4.6.4.6.4.', shaker: '5.3.5.3.5.3.5.3.' })
add('Afrobeat', '', 'Afrobeat ligero', '16', 96, 2, 2, ['afrobeat', 'ligero', 'ride'], { kick: '9..5..5..9......', xstick: '....5..5..5..5..', ride: '6.4.6.4.6.4.6.4.' })
// HIP-HOP
add('Hip-Hop', '', 'Boom bap', '16', 90, 3, 2, ['hip-hop', 'boom-bap'], { kick: '9.....6...9..6..', snare: '....9.......9...', hat: '7.5.7.5.7.5.7.5.' })
add('Hip-Hop', '', 'Trap', '16', 140, 4, 2, ['hip-hop', 'trap', 'medio-tiempo'], { kick: '9.......6.9.....', snare: '........9.......', hat: '7.7.7.7.7.7.6677' })
add('Hip-Hop', '', 'Lo-fi', '16', 80, 2, 2, ['hip-hop', 'lo-fi', 'suave'], { kick: '9.....6.....6...', snare: '....7.......7...', hat: '5.3.5.3.5.3.5.3.' }, { atras: 0.02 })
// ELECTRONICA
add('Electronica', '', 'Cuatro por cuatro', '16', 124, 4, 2, ['electronica', 'four-on-the-floor', 'house'], { kick: '9...9...9...9...', clap: '....8.......8...', hat: '6...6...6...6...', hato: '..8...8...8...8.' })
add('Electronica', '', 'Medio tiempo electrónico', '16', 140, 3, 2, ['electronica', 'half-time'], { kick: '9.......9.5.....', snare: '........9.......', hat: '7.5.7.5.7.5.7.5.' })
add('Electronica', '', 'Drum and bass', '16', 174, 4, 4, ['electronica', 'dnb', 'rapido'], { kick: '9.........6.....', snare: '....9.......9...', hat: '7.5.7.5.7.5.7.5.' }, { f: 0 })
add('Electronica', '', 'Techno', '16', 130, 4, 2, ['electronica', 'techno'], { kick: '9...9...9...9...', hat: '..7...7...7...7.', clap: '........6.......', shaker: '4.4.4.4.4.4.4.4.' })
// METAL
add('Metal', '', 'Doble bombo', '16', 170, 5, 2, ['metal', 'doble-bombo'], { kick: '8686868686868686', snare: '....9.......9...', ride: '9...9...9...9...' }, { crash: true })
add('Metal', '', 'Blast beat', '16', 190, 5, 2, ['metal', 'blast'], { kick: '9.9.9.9.9.9.9.9.', snare: '.9.9.9.9.9.9.9.9', ride: '9.9.9.9.9.9.9.9.' })
add('Metal', '', 'Galope', '16', 150, 5, 4, ['metal', 'galope'], { kick: '9.999.999.999.99', snare: '....9.......9...', hat: '8.8.8.8.8.8.8.8.' }, { crash: true, f: 4 })
add('Metal', '', 'Metal pesado lento', '16', 84, 4, 2, ['metal', 'pesado', 'medio-tiempo'], { kick: '9...9.9.....9.9.', snare: '........9.......', ride: '8.......8.......' })
// COUNTRY
add('Country', '', 'Dos tiempos', '16', 116, 3, 2, ['country', 'two-step'], { kick: '9.......9.......', snare: '....8.......8...', hat: '7.5.7.5.7.5.7.5.' })
add('Country', '', 'Tren', '16', 130, 4, 2, ['country', 'train-beat'], { snare: '9.5.6.9.5.6.9.5.', kick: '9.......9.......', hat: '5.5.5.5.5.5.5.5.' })
add('Country', '', 'Shuffle country', '12T', 108, 3, 2, ['country', 'shuffle'], { kick: '9.....8.....', snare: '...8.....8..', hat: '8.58.58.58.5' })
// GOSPEL
add('Gospel', '', 'Gospel shout', '16', 132, 5, 4, ['gospel', 'shout', 'palmas'], { kick: '9.5.5.5.9.5.5.5.', snare: '....9..6....9..6', clap: '....7.......7...', hat: '8.6.8.6.8.6.8.6.' }, { crash: true, f: 4 })
add('Gospel', '', 'Gospel shuffle', '12T', 104, 4, 2, ['gospel', 'shuffle'], { kick: '9.....8.....', snare: '..2.9..2.9.2', ride: '8.58.58.58.5' })
add('Gospel', '', 'Gospel medio tiempo', '16', 70, 3, 2, ['gospel', 'medio-tiempo', 'ride'], { kick: '9...............', snare: '........9.......', ride: '7.5.6.5.7.5.6.5.' }, { ghost: true })
// 12/8
add('12-8', '', 'Soul lento 12-8', '128', 58, 2, 2, ['12-8', 'soul', 'lento'], { kick: '9.....6.....', snare: '...8.....8..', hat: '757757757757' }, { atras: 0.015 })
add('12-8', '', 'Blues 12-8', '128', 54, 2, 2, ['12-8', 'blues', 'lento'], { kick: '9.....7.....', snare: '...9.....9..', ride: '857857857857' })
add('12-8', '', 'Worship 12-8', '128', 60, 3, 4, ['12-8', 'worship', 'coro'], { kick: '9.....6.....', snare: '...9.....9..', hat: '857757857757' }, { crash: true, f: 0 })
add('12-8', '', 'Worship 12-8 campana', '128', 56, 2, 2, ['12-8', 'worship', 'campana-de-ride', 'cross-stick'], { kick: '9.....5.....', xstick: '...7.....7..', bell: '6..5..6..5..', hat: '535535535535' })
add('12-8', '', 'Gospel 12-8', '128', 66, 4, 4, ['12-8', 'gospel', 'power'], { kick: '9..5..9.5...', snare: '...9.....9..', hat: '857857857857' }, { crash: true, f: 1 })

// ── Construcción de compases ─────────────────────────────────────────────────
function tile(cadena, pasos, bars, b) {
  if (cadena.length === pasos) return cadena
  if (cadena.length === pasos * bars) return cadena.slice(b * pasos, (b + 1) * pasos)
  throw new Error(`longitud ${cadena.length} no válida (pasos ${pasos}, compases ${bars})`)
}

const VOCES_GOLPE = ['kick', 'snare', 'xstick', 'clap', 'tomL', 'tomM', 'tomH']

function variar(voces, rej, rnd, base) {
  const out = { ...voces }
  const libre = (i) => VOCES_GOLPE.every((k) => !out[k] || out[k][i] === '.')
  const candidatos = []
  for (let i = 0; i < rej.pasos; i++) if (i % rej.porBeat !== 0 && libre(i)) candidatos.push(i)
  const poner = (voz, i, d) => {
    const s = (out[voz] ?? '.'.repeat(rej.pasos)).split('')
    s[i] = d
    out[voz] = s.join('')
  }
  if (base.ghost && candidatos.length) {
    const veces = 1 + Math.floor(rnd() * 2)
    const voz = out.snare ? 'snare' : out.xstick ? 'xstick' : null
    if (voz) for (let k = 0; k < veces && candidatos.length; k++) poner(voz, candidatos.splice(Math.floor(rnd() * candidatos.length), 1)[0], '2')
  }
  if (out.kick && candidatos.length && rnd() < 0.55) {
    const tardios = candidatos.filter((i) => i >= rej.pasos * 0.5)
    const lista = tardios.length ? tardios : candidatos
    poner('kick', lista[Math.floor(rnd() * lista.length)], '5')
  }
  return out
}

/** Devuelve un arreglo de compases (voces por compás) para el patrón base. */
function compasesDe(base) {
  const rej = REJILLAS[base.g]
  const rnd = prng(semilla(base.e + base.n))
  const bars = []
  for (let b = 0; b < base.c; b++) {
    let voces = {}
    for (const [k, v] of Object.entries(base.v)) voces[k] = tile(v, rej.pasos, base.c, b)
    if (b > 0) voces = variar(voces, rej, rnd, base)
    if (b === 0 && base.crash) voces.crash = '9' + '.'.repeat(rej.pasos - 1)
    bars.push(voces)
  }
  if (base.c === 4 && base.f != null) {
    const pool = FILLS[base.g]
    const fill = pool[base.f % pool.length]
    bars[3] = { ...fill.v }
    if (base.v.hat && !fill.v.hat) bars[3].hat = base.v.hat.length === rej.pasos ? base.v.hat.replace(/./g, (c, i) => (i < rej.pasos / 2 ? c : '.')) : undefined
    if (!bars[3].hat) delete bars[3].hat
  }
  return bars
}

function notasDe(bars, base, rej, opciones = {}) {
  const rnd = prng(semilla('n' + base.e + base.n + (opciones.sufijo ?? '')))
  const unidad = 1 / rej.porBeat
  const largoCompas = beatsCompas(rej)
  const notas = []
  const [d0, d1] = base.cres ?? [1, 1]
  const total = bars.length
  bars.forEach((voces, b) => {
    for (const [voz, cadena] of Object.entries(voces)) {
      if (!cadena) continue
      const pitch = PITCH[voz.replace('Largo', '')] ?? PITCH[voz]
      if (pitch == null) throw new Error(`voz desconocida ${voz}`)
      for (let i = 0; i < cadena.length; i++) {
        const c = cadena[i]
        if (c === '.') continue
        const nivel = Number(c)
        if (!(nivel >= 1 && nivel <= 9)) throw new Error(`carácter inválido «${c}» en ${base.n}/${voz}`)
        const pos = total === 1 ? 0 : (b * rej.pasos + i) / (total * rej.pasos)
        const escala = d0 + (d1 - d0) * pos
        let vel = (14 + nivel * 13) * escala + (rnd() - 0.5) * (nivel <= 2 ? 6 : 9)
        vel = Math.max(1, Math.min(127, Math.round(vel)))
        let inicio = b * largoCompas + i * unidad
        if (b > 0 || i > 0) inicio += (rnd() - 0.5) * 0.024
        if (voz === 'snare' || voz === 'xstick' || voz === 'clap') inicio += base.atras ?? 0
        inicio = Math.max(0, inicio)
        const larga = (base.durLargas ?? []).includes(voz)
        const dur = voz === 'crashLargo' ? 3 : larga ? unidad * 2.2 : voz === 'crash' || voz === 'crash2' ? 0.75 : voz === 'hato' ? unidad * 1.6 : voz === 'ride' || voz === 'bell' ? 0.25 : 0.1
        notas.push({ pitch, vel, inicio, dur })
      }
    }
  })
  return notas
}

// ── Escritura SMF ────────────────────────────────────────────────────────────
const PPQ = 480
function vlq(n) {
  let v = Math.max(0, Math.round(n))
  const o = [v & 0x7f]
  while ((v >>= 7) > 0) o.unshift((v & 0x7f) | 0x80)
  return o
}
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n) => [(n >>> 8) & 255, n & 255]
const txt = (s) => [...Buffer.from(s, 'utf8')]
const meta = (t, d) => [0xff, t, ...vlq(d.length), ...d]
function pista(eventos) {
  eventos.sort((a, b) => a.t - b.t || a.o - b.o)
  const cuerpo = []
  let t = 0
  for (const e of eventos) {
    cuerpo.push(...vlq(e.t - t), ...e.b)
    t = e.t
  }
  cuerpo.push(0, ...meta(0x2f, []))
  return [...txt('MTrk'), ...u32(cuerpo.length), ...cuerpo]
}
function escribirMidi({ nombre, bpm, compas, notas }) {
  const us = Math.round(60_000_000 / bpm)
  const t0 = [
    { t: 0, o: 0, b: meta(0x03, txt(nombre)) },
    { t: 0, o: 1, b: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { t: 0, o: 2, b: meta(0x58, [compas[0], Math.log2(compas[1]), 24, 8]) },
  ]
  const t1 = [
    { t: 0, o: 0, b: meta(0x03, txt('Batería')) },
    { t: 0, o: 1, b: meta(0x04, txt('Drums')) },
  ]
  for (const n of notas) {
    const on = Math.round(n.inicio * PPQ)
    const off = Math.max(on + 1, Math.round((n.inicio + n.dur) * PPQ))
    t1.push({ t: on, o: 3, b: [0x99, n.pitch, n.vel] })
    t1.push({ t: off, o: 2, b: [0x89, n.pitch, 0] })
  }
  const bloques = [pista(t0), pista(t1)]
  return Buffer.from([...txt('MThd'), ...u32(6), ...u16(1), ...u16(2), ...u16(PPQ), ...bloques.flat()])
}

// ── Intros, finales, fills y transiciones ───────────────────────────────────
const salidaPlana = []
function emitir(spec, bars, extra = {}) {
  const rej = REJILLAS[spec.g]
  const notas = notasDe(bars, spec, rej, extra)
  salidaPlana.push({ spec, rej, bars: bars.length, notas })
}

for (const base of B) emitir({ ...base, tipo: 'groove' }, compasesDe(base))

// Fills de 1 compás por rejilla/estilo (se reparten las plantillas entre estilos).
const ESTILOS_FILL = [
  ['Worship', '4-4', '16', 74, [0, 1, 2, 3]],
  ['Worship', '6-8', '68', 62, [0, 1]],
  ['Pop', '', '16', 108, [0, 1]],
  ['Rock', '', '16', 120, [1, 2, 4]],
  ['Pop-Rock', '', '16', 114, [0, 3]],
  ['Indie', '', '16', 116, [0, 3]],
  ['Balada', '', '16', 66, [0]],
  ['Shuffle-Blues', '', '12T', 100, [0, 1]],
  ['Jazz', 'Swing', '12T', 140, [0]],
  ['Funk', '', '16', 100, [0, 1]],
  ['Soul', '', '16', 96, [0]],
  ['Latin', '', '16', 110, [0]],
  ['Afrobeat', '', '16', 104, [1]],
  ['Hip-Hop', '', '16', 90, [0]],
  ['Electronica', '', '16', 128, [1]],
  ['Metal', '', '16', 170, [4, 2]],
  ['Country', '', '16', 116, [0]],
  ['Gospel', '', '16', 120, [1, 4]],
  ['12-8', '', '128', 60, [0, 1]],
]
for (const [e, s, g, bpm, idx] of ESTILOS_FILL) {
  for (const k of idx) {
    const f = FILLS[g][k % FILLS[g].length]
    const crashFin = g === '16' && f.int >= 4
    const v = { ...f.v }
    const spec = { e, s, n: `Fill ${f.n}`, g, b: bpm, i: f.int, c: 1, t: ['fill', ...f.n.split(' ').filter((x) => x.length > 3)], v, tipo: 'fill' }
    emitir(spec, [v])
    void crashFin
  }
}

// Worship: intros, finales y transiciones.
{
  const rej = REJILLAS['16']
  const hatQ = (nivel) => ({ hat: `${nivel}...${nivel}...${nivel}...${nivel}...`.slice(0, 16) })
  for (const [nombre, bpm, vel, f] of [['Intro con hi-hat', 74, 5, 0], ['Intro con toms', 76, 6, 1]]) {
    emitir({ e: 'Worship', s: '4-4', n: nombre, g: '16', b: bpm, i: 2, c: 2, t: ['intro'], tipo: 'intro' }, [{ ...hatQ(vel) }, { ...FILLS['16'][f === 0 ? 0 : 2].v }])
  }
  emitir({ e: 'Worship', s: '4-4', n: 'Intro de ride y campana', g: '16', b: 70, i: 1, c: 2, t: ['intro', 'ride', 'campana-de-ride'], tipo: 'intro' }, [
    { ride: '5...5...5...5...', bell: '..............4.' },
    { ride: '5.3.5.3.5.3.5.3.', xstick: '....5.......5...', kick: '7...............' },
  ])
  emitir({ e: 'Worship', s: '4-4', n: 'Final con crash', g: '16', b: 74, i: 3, c: 2, t: ['outro', 'final'], tipo: 'outro' }, [
    { kick: '9.....5.8.5.....', snare: '....8.......8...', hat: '7.4.6.4.7.4.6.4.' },
    { kick: '9...............', crashLargo: '9...............', snare: '9...............' },
  ])
  emitir({ e: 'Worship', s: '4-4', n: 'Final suave', g: '16', b: 68, i: 1, c: 2, t: ['outro', 'final', 'suave'], tipo: 'outro' }, [
    { kick: '8.......5.......', xstick: '........5.......', ride: '5.3.4.3.5.3.4.3.' },
    { kick: '7...............', ride: '6...............' },
  ])
  emitir({ e: 'Worship', s: '4-4', n: 'Transición crescendo al coro', g: '16', b: 76, i: 4, c: 2, t: ['transicion', 'crescendo', 'toms'], tipo: 'transicion', cres: [0.7, 1.15] }, [
    { kick: '9...9...9...9...', snare: '..4...4.4.4.6.6.', tomL: '................' },
    { kick: '9...............', snare: '5.5.6.6.7.7.8.8.', tomM: '................' },
  ])
  emitir({ e: 'Worship', s: '4-4', n: 'Transición al puente', g: '16', b: 72, i: 3, c: 1, t: ['transicion', 'puente'], tipo: 'transicion' }, [{ kick: '9.......5.......', xstick: '....6.......6.5.', tomL: '............7.8.' }])
  emitir({ e: 'Worship', s: '6-8', n: 'Intro 6-8', g: '68', b: 62, i: 1, c: 2, t: ['intro', '6-8'], tipo: 'intro' }, [{ hat: '6.....6.....' }, { ...FILLS['68'][0].v }])
  emitir({ e: 'Worship', s: '6-8', n: 'Final 6-8', g: '68', b: 62, i: 2, c: 2, t: ['outro', 'final', '6-8'], tipo: 'outro' }, [
    { kick: '9.....5.5...', snare: '......7.....', hat: '6.4.4.6.4.4.' },
    { kick: '9...........', crashLargo: '9...........' },
  ])
  void rej
}
// Un outro/intro por otros estilos básicos
for (const [e, s, g, bpm, n] of [
  ['Pop', '', '16', 108, 'Pop'],
  ['Rock', '', '16', 120, 'Rock'],
]) {
  emitir({ e, s, n: `Intro ${n}`, g, b: bpm, i: 3, c: 2, t: ['intro'], tipo: 'intro' }, [{ hat: '7...7...7...7...' }, { ...FILLS[g][0].v }])
  emitir({ e, s, n: `Final ${n}`, g, b: bpm, i: 4, c: 2, t: ['outro', 'final'], tipo: 'outro' }, [
    { kick: '9.....5.9.5.....', snare: '....9.......9...', hat: '8.5.7.5.8.5.7.5.' },
    { kick: '9...............', crashLargo: '9...............', snare: '9...............' },
  ])
}

// ── Escritura de archivos ───────────────────────────────────────────────────
const aplanarRuta = (e, s) => [e, s].filter(Boolean)
const archivos = new Map() // ruta relativa -> Buffer | string
const jsons = new Map() // carpeta -> { archivos: {} }
const catalogo = []
const usados = new Set()
let n = 0
for (const g of salidaPlana) {
  const { spec, rej } = g
  const carpeta = aplanarRuta(spec.e, spec.s)
  let nombreArchivo = `${slug(spec.n)}.mid`
  const clave = [...carpeta, nombreArchivo].join('/')
  if (usados.has(clave)) throw new Error(`nombre repetido: ${clave}`)
  usados.add(clave)
  const compases = g.bars
  const bin = escribirMidi({ nombre: spec.n, bpm: spec.b, compas: rej.compas, notas: g.notas })
  const sha = createHash('sha256').update(bin).digest('hex')
  archivos.set(clave, bin)
  const id = `jw-${slug(spec.e)}${spec.s ? '-' + slug(spec.s) : ''}-${slug(spec.n)}`
  const dirKey = carpeta.join('/')
  const j = jsons.get(dirKey) ?? { archivos: {} }
  j.archivos[nombreArchivo] = {
    id,
    nombre: spec.n,
    tempo: spec.b,
    compas: `${rej.compas[0]}/${rej.compas[1]}`,
    compases,
    tipo: spec.tipo,
    etiquetas: spec.t,
    intensidad: spec.i,
    revision: REVISION,
    origen: 'catalogo',
    autor: AUTOR,
    licencia: LICENCIA,
  }
  jsons.set(dirKey, j)
  catalogo.push({ id, ruta: clave, sha256: sha, revision: REVISION })
  n++
}
for (const [dir, j] of jsons) archivos.set(`${dir}/groove.json`, JSON.stringify(j, null, 2) + '\n')
catalogo.sort((a, b) => a.ruta.localeCompare(b.ruta))
const manifiesto = JSON.stringify({ version: 1, generador: 'generar_grooves.mjs', licencia: LICENCIA, total: catalogo.length, grooves: catalogo }, null, 2) + '\n'

const verificar = process.argv.includes('--verificar')
if (verificar) {
  let mal = 0
  for (const [ruta, dato] of archivos) {
    const f = join(SALIDA, ruta)
    if (!existsSync(f) || !readFileSync(f).equals(Buffer.isBuffer(dato) ? dato : Buffer.from(dato))) {
      console.error('difiere:', ruta)
      mal++
    }
  }
  if (!existsSync(join(RAIZ, 'catalogo.json')) || readFileSync(join(RAIZ, 'catalogo.json'), 'utf8') !== manifiesto) mal++
  process.exit(mal ? 1 : 0)
}
if (existsSync(SALIDA)) rmSync(SALIDA, { recursive: true, force: true })
for (const [ruta, dato] of archivos) {
  const f = join(SALIDA, ruta)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, dato)
}
writeFileSync(join(RAIZ, 'catalogo.json'), manifiesto)
const porEstilo = {}
for (const g of salidaPlana) porEstilo[g.spec.e] = (porEstilo[g.spec.e] ?? 0) + 1
console.log(`${n} grooves en ${SALIDA}`)
console.log(JSON.stringify(porEstilo))
void readdirSync
