#!/usr/bin/env node
/**
 * Análisis musical determinista de un proyecto de JasWave (plan S). Mide, por pista:
 *  - notas, compases sin notas dentro de las secciones exigidas (con rangos), % de compases que son copia exacta de otro,
 *    % de notas en la rejilla EXACTA de semicorcheas, duraciones y velocidades distintas;
 * y del conjunto: % de tiempos con choque de segunda menor / séptima mayor entre pistas distintas (≥ E2) y % de notas
 * de bajo en el primer tiempo que no son el bajo de la barra.
 *
 * Uso:   node jas-wave/scripts/analizar-proyecto-musical.mjs proyecto.json [--json]
 * Entrada: JSON del proyecto (`tracks[].clips[].notas[]` con pitch/inicio/duracion/velocidad; secciones en
 * `marcadores[] {nombre, tiempo}`; acordes en `letra.acordes[] {beat, nombre}`; `bpm.valor`, `timeSignature.numerador`).
 * También se puede importar: `analizarProyecto(json)`, `evaluarCalidad(analisis)` y `tablaResumen(analisis)`.
 */
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

export const UMBRALES = { copias: 0.5, rejillaBateria: 0.9, rejillaResto: 0.6, choques: 0.08 }
const TOL_REJILLA = 0.002
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const pc = (n) => ((n % 12) + 12) % 12
const sinAcentos = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function familiaDePista(nombre) {
  const t = sinAcentos(nombre)
  if (/bater|drum|percus|kit/.test(t)) return 'bateria'
  if (/\bbajo|bajista|bass/.test(t)) return 'bajo'
  if (/guitar|gtr/.test(t)) return 'guitarra'
  if (/\bpads?\b|atmos|ambient|ambiente|textur|drone/.test(t)) return 'pad'
  if (/cuerd|string|violin|viola|cello|orquest/.test(t)) return 'cuerdas'
  if (/lead|solo|melod|arp|sinte|synth/.test(t)) return 'lead'
  if (/pian|teclad|key|organ|rhodes|wurli/.test(t)) return 'piano'
  return 'otro'
}

function acorde(nombre) {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(String(nombre ?? '').trim())
  if (!m) return null
  const alt = (x) => (x === '#' ? 1 : x === 'b' ? -1 : 0)
  const raiz = pc(PC[m[1]] + alt(m[2]))
  return { raiz, bajo: m[4] ? pc(PC[m[4]] + alt(m[5])) : raiz }
}

const redondea = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n

function rangosDe(lista) {
  const out = []
  for (const c of lista) {
    const u = out[out.length - 1]
    if (u && u[1] === c - 1) u[1] = c
    else out.push([c, c])
  }
  return out
}

export function analizarProyecto(p) {
  const num = p.timeSignature?.numerador ?? 4
  const bpm = typeof p.bpm === 'number' ? p.bpm : (p.bpm?.valor ?? 120)
  // Marcadores: la app guarda `marcadores[] {nombre, tiempo}` (en inglés/versiones viejas: markers[] con posicion/inicio).
  const marcadores = (p.marcadores ?? p.timeline?.marcadores ?? p.markers ?? [])
    .map((m) => ({ nombre: m.nombre ?? m.name ?? '', beat: Number(m.tiempo ?? m.posicion?.beats ?? m.inicio ?? m.beat ?? 0) }))
    .sort((a, b) => a.beat - b.beat)
  const tracks = (p.tracks ?? []).filter((t) => (t.tipo ?? 'midi') !== 'bus' && t.rol !== 'master')
  const fin = Math.max(0, ...tracks.flatMap((t) => (t.clips ?? []).map((c) => c.inicio + c.duracion)))
  const totalCompases = Math.ceil(fin / num)
  const secciones = marcadores.map((m, i) => ({ nombre: m.nombre, desde: Math.round(m.beat / num), hasta: Math.round((marcadores[i + 1]?.beat ?? fin) / num) })).filter((s) => s.hasta > s.desde)
  const esExtremo = (s, i) => i === 0 || i === secciones.length - 1
  const pistas = []
  for (const t of tracks) {
    const familia = familiaDePista(t.nombre)
    const notas = []
    for (const c of t.clips ?? []) for (const n of c.notas ?? []) notas.push({ pitch: n.pitch, abs: c.inicio + n.inicio, duracion: n.duracion, velocidad: n.velocidad ?? 0 })
    notas.sort((a, b) => a.abs - b.abs || a.pitch - b.pitch)
    const r = { nombre: t.nombre, familia, notas: notas.length, clips: (t.clips ?? []).length, clipsGenericos: (t.clips ?? []).filter((c) => /^\s*clip(\s*midi)?\s*\d*\s*$/i.test(c.nombre ?? '')).length }
    if (!notas.length) {
      pistas.push({ ...r, vacia: true, huecos: [], pctCopias: 0, pctRejilla: 0, duraciones: 0, velocidades: 0, compasesConNotas: 0, _notas: [] })
      continue
    }
    // Cobertura por compás dentro de las secciones exigidas (intro y outro opcionales; la base, también el outro).
    const base = familia === 'bateria' || familia === 'bajo'
    // Un lead o melodía puede ser «solo en el puente»: no se le exigen secciones (el análisis no conoce el encargo).
    const exigidas = familia === 'lead' ? [] : secciones.filter((s, i) => (base ? i !== 0 : !esExtremo(s, i)))
    const cubierto = new Array(totalCompases).fill(false)
    for (const n of notas) {
      for (let b = Math.max(0, Math.floor(n.abs / num)); b < totalCompases && b * num < n.abs + n.duracion - 1e-9; b++) {
        const a = b * num
        const solape = Math.min(a + num, n.abs + n.duracion) - Math.max(a, n.abs)
        if ((n.abs >= a - 1e-6 && n.abs < a + num - 1e-6) || solape >= 0.4 * num) cubierto[b] = true
      }
    }
    const huecos = []
    for (const s of exigidas) {
      const vacios = []
      for (let b = s.desde; b < s.hasta; b++) if (!cubierto[b]) vacios.push(b + 1)
      if (!vacios.length) continue
      const todos = vacios.length === s.hasta - s.desde
      if (familia === 'lead' && !todos) continue
      if (!todos && vacios.length === 1 && vacios[0] === s.hasta) continue
      for (const [a, b] of rangosDe(vacios)) huecos.push({ seccion: s.nombre, desde: a, hasta: b })
    }
    // Copias exactas: compases con ≥ 3 notas idénticos (altura, posición y duración a 1/32 de beat) a otro.
    const huellas = new Map()
    for (const n of notas) {
      const c = Math.floor(n.abs / num + 1e-9)
      const h = `${n.pitch}@${Math.round((n.abs - c * num) * 32)}/${Math.round(n.duracion * 32)}`
      huellas.set(c, (huellas.get(c) ?? []).concat(h))
    }
    const firmas = [...huellas.values()].filter((l) => l.length >= 3).map((l) => l.sort().join('|'))
    const cuenta = new Map()
    for (const f of firmas) cuenta.set(f, (cuenta.get(f) ?? 0) + 1)
    const copias = firmas.filter((f) => cuenta.get(f) > 1).length
    const enRejilla = notas.filter((n) => Math.abs(n.abs * 4 - Math.round(n.abs * 4)) / 4 <= TOL_REJILLA).length
    pistas.push({
      ...r,
      vacia: false,
      huecos,
      compasesVacios: huecos.reduce((a, h) => a + h.hasta - h.desde + 1, 0),
      compasesConNotas: firmas.length,
      pctCopias: firmas.length ? copias / firmas.length : 0,
      pctRejilla: enRejilla / notas.length,
      duraciones: new Set(notas.map((n) => redondea(n.duracion))).size,
      velocidades: new Set(notas.map((n) => n.velocidad)).size,
      _notas: notas,
    })
  }
  // Choques verticales entre pistas afinadas distintas (≥ E2), por tiempo.
  const afinadas = pistas.filter((x) => !x.vacia && x.familia !== 'bateria' && x.familia !== 'bajo')
  let choques = 0
  let tiempos = 0
  for (let t = 0; t < fin - 1e-9; t++) {
    const sonando = []
    afinadas.forEach((x, i) => {
      for (const n of x._notas) if (n.abs < t + 1 - 1e-9 && n.abs + n.duracion > t + 1e-9 && Math.min(n.abs + n.duracion, t + 1) - Math.max(n.abs, t) >= 0.25 && n.pitch >= 40) sonando.push({ i, pitch: n.pitch })
    })
    if (new Set(sonando.map((s) => s.i)).size < 2) continue
    tiempos++
    if (sonando.some((a, x) => sonando.some((b, y) => y > x && a.i !== b.i && [1, 11].includes(Math.abs(a.pitch - b.pitch))))) choques++
  }
  // Bajo en el primer tiempo: ¿es el bajo de la barra?
  const acordes = (p.letra?.acordes ?? []).map((a) => ({ beat: a.beat, a: acorde(a.nombre) })).sort((x, y) => x.beat - y.beat)
  const acordeEn = (b) => acordes.filter((a) => a.beat <= b + 1e-6).pop()?.a ?? null
  let bajoFuertes = 0
  let bajoMal = 0
  for (const x of pistas.filter((q) => q.familia === 'bajo')) {
    for (const n of x._notas) {
      const a = acordeEn(n.abs)
      if (!a || n.abs - Math.floor(n.abs / num + 1e-9) * num >= 0.25) continue
      bajoFuertes++
      if (pc(n.pitch) !== a.bajo) bajoMal++
    }
  }
  // Se quita el campo interno `_notas` (las notas en bruto) del resultado público.
  const limpias = pistas.map((q) => {
    const copia = { ...q }
    delete copia._notas
    return copia
  })
  return {
    nombre: p.nombre ?? '',
    bpm,
    numerador: num,
    compases: totalCompases,
    secciones: secciones.map((s) => s.nombre),
    pistas: limpias,
    choques: { tiempos, conChoque: choques, pct: tiempos ? choques / tiempos : 0 },
    bajo: { primerosTiempos: bajoFuertes, noEsBajoDeLaBarra: bajoMal, pct: bajoFuertes ? bajoMal / bajoFuertes : 0 },
  }
}

const pct = (x) => `${Math.round(x * 100)} %`
const textoHuecos = (hs) => hs.map((h) => `${h.desde === h.hasta ? h.desde : `${h.desde}–${h.hasta}`} (${h.seccion})`).join(', ')

/** Comprobaciones deterministas de calidad; devuelve la lista de fallos (vacía = todo bien). */
export function evaluarCalidad(a, umbrales = UMBRALES) {
  const fallos = []
  for (const p of a.pistas) {
    if (p.vacia) {
      fallos.push(`«${p.nombre}»: pista de instrumento vacía (0 notas)`)
      continue
    }
    if (p.huecos.length) fallos.push(`«${p.nombre}»: compases sin notas en ${textoHuecos(p.huecos)}`)
    const sostenida = p.familia === 'pad' || p.familia === 'cuerdas'
    if (!sostenida && p.compasesConNotas >= 4 && p.pctCopias >= umbrales.copias) fallos.push(`«${p.nombre}»: ${pct(p.pctCopias)} de los compases son copia exacta (máx. ${pct(umbrales.copias)})`)
    const maxRejilla = p.familia === 'bateria' ? umbrales.rejillaBateria : umbrales.rejillaResto
    if (p.pctRejilla >= maxRejilla) fallos.push(`«${p.nombre}»: ${pct(p.pctRejilla)} de las notas en rejilla exacta (máx. ${pct(maxRejilla)}): sin micro-timing humano`)
  }
  if (a.choques.tiempos >= 8 && a.choques.pct >= umbrales.choques) fallos.push(`choques entre pistas en ${pct(a.choques.pct)} de los tiempos (máx. ${pct(umbrales.choques)})`)
  return fallos
}

/** Tabla de texto, una línea por pista, con el prefijo `[musica]` de los registros del e2e. */
export function tablaResumen(a) {
  const filas = a.pistas.map((p) =>
    p.vacia
      ? `[musica] «${p.nombre}» (${p.familia}): VACÍA`
      : `[musica] «${p.nombre}» (${p.familia}): ${p.notas} notas · ${p.clips} clips (${p.clipsGenericos} sin nombre) · compases vacíos ${p.compasesVacios}${p.huecos.length ? ` [${textoHuecos(p.huecos)}]` : ''} · copias ${pct(p.pctCopias)} · rejilla exacta ${pct(p.pctRejilla)} · ${p.duraciones} duraciones · ${p.velocidades} velocidades`,
  )
  filas.push(`[musica] conjunto: ${a.compases} compases · ${a.bpm} BPM · choques entre pistas ${pct(a.choques.pct)} de ${a.choques.tiempos} tiempos · bajo ≠ bajo de la barra ${pct(a.bajo.pct)} de ${a.bajo.primerosTiempos} primeros tiempos`)
  return filas.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ruta = process.argv[2]
  if (!ruta) {
    console.error('Uso: node analizar-proyecto-musical.mjs proyecto.json [--json]')
    process.exit(2)
  }
  const a = analizarProyecto(JSON.parse(fs.readFileSync(ruta, 'utf8')))
  if (process.argv.includes('--json')) console.log(JSON.stringify({ analisis: a, fallos: evaluarCalidad(a) }, null, 2))
  else {
    console.log(`Proyecto «${a.nombre}» · secciones: ${a.secciones.join(', ')}`)
    console.log(tablaResumen(a))
    const f = evaluarCalidad(a)
    console.log(f.length ? `\nFALLOS (${f.length}):\n- ${f.join('\n- ')}` : '\nSin fallos.')
    process.exitCode = f.length ? 1 : 0
  }
}
