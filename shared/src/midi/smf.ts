/**
 * Standard MIDI File (SMF) tipo 1: escritura del proyecto y lectura mínima (G2).
 *
 * - Pista 0: nombre, tempo, compás y marcadores del proyecto.
 * - Una pista SMF por pista del proyecto con notas (canal 10 si la pista es de batería), con sus notas
 *   no silenciadas, CC de expresión y el nombre de la pista.
 * Las posiciones del proyecto están en beats; se escriben a 480 PPQ.
 */

export const PPQ_SMF = 480

export type NotaSmf = { pitch: number; velocidad: number; inicio: number; duracion: number }
export type CcSmf = { cc: number; valor: number; tiempo: number }
export type PistaSmf = { nombre: string; canal: number; notas: NotaSmf[]; ccs?: CcSmf[]; programa?: number }

export type CancionSmf = {
  titulo?: string
  bpm: number
  compas?: { numerador: number; denominador: number }
  marcadores?: Array<{ nombre: string; inicio: number }>
  pistas: PistaSmf[]
}

type Evento = { tick: number; orden: number; bytes: number[] }

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n))
  const out = [v & 0x7f]
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80)
  return out
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number) => [(n >>> 8) & 255, n & 255]
/** Texto de meta-eventos en UTF-8 (los DAW actuales lo leen; ASCII queda igual). */
const texto = (s: string) => [...new TextEncoder().encode(s)]
const meta = (tipo: number, datos: number[]) => [0xff, tipo, ...vlq(datos.length), ...datos]
const clamp7 = (v: number) => Math.max(0, Math.min(127, Math.round(v)))

function bloquePista(eventos: Evento[]): number[] {
  const ord = [...eventos].sort((a, b) => a.tick - b.tick || a.orden - b.orden)
  const cuerpo: number[] = []
  let t = 0
  for (const e of ord) {
    cuerpo.push(...vlq(e.tick - t), ...e.bytes)
    t = e.tick
  }
  cuerpo.push(...vlq(0), ...meta(0x2f, []))
  return [...texto('MTrk'), ...u32(cuerpo.length), ...cuerpo]
}

export function escribirSmf(c: CancionSmf, ppq = PPQ_SMF): Uint8Array {
  const ticks = (beats: number) => Math.max(0, Math.round(beats * ppq))
  const bpm = c.bpm > 0 ? c.bpm : 120
  const us = Math.round(60_000_000 / bpm)
  const num = c.compas?.numerador ?? 4
  const den = c.compas?.denominador ?? 4
  const t0: Evento[] = [
    ...(c.titulo ? [{ tick: 0, orden: 0, bytes: meta(0x03, texto(c.titulo)) }] : []),
    { tick: 0, orden: 1, bytes: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { tick: 0, orden: 2, bytes: meta(0x58, [num, Math.max(0, Math.round(Math.log2(den))), 24, 8]) },
  ]
  for (const m of c.marcadores ?? []) t0.push({ tick: ticks(m.inicio), orden: 3, bytes: meta(0x06, texto(m.nombre)) })
  const bloques = [bloquePista(t0)]
  for (const p of c.pistas) {
    const ch = Math.max(0, Math.min(15, p.canal))
    const ev: Evento[] = [{ tick: 0, orden: 0, bytes: meta(0x03, texto(p.nombre)) }]
    if (p.programa != null) ev.push({ tick: 0, orden: 1, bytes: [0xc0 | ch, clamp7(p.programa)] })
    for (const n of p.notas) {
      const on = ticks(n.inicio)
      const off = Math.max(on + 1, ticks(n.inicio + n.duracion))
      // Note-off antes que note-on en el mismo tick: notas repetidas no se pisan.
      ev.push({ tick: on, orden: 3, bytes: [0x90 | ch, clamp7(n.pitch), Math.max(1, clamp7(n.velocidad))] })
      ev.push({ tick: off, orden: 2, bytes: [0x80 | ch, clamp7(n.pitch), 0] })
    }
    for (const cc of p.ccs ?? []) ev.push({ tick: ticks(cc.tiempo), orden: 2.5, bytes: [0xb0 | ch, clamp7(cc.cc), clamp7(cc.valor)] })
    bloques.push(bloquePista(ev))
  }
  const cabecera = [...texto('MThd'), ...u32(6), ...u16(1), ...u16(bloques.length), ...u16(ppq)]
  return Uint8Array.from([...cabecera, ...bloques.flat()])
}

/** Lectura mínima de SMF (tipo 0/1, PPQ): notas por pista, tempo inicial y nombres. */
export function leerSmf(bin: Uint8Array): CancionSmf & { ppq: number } {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const tag = (o: number) => String.fromCharCode(bin[o]!, bin[o + 1]!, bin[o + 2]!, bin[o + 3]!)
  if (tag(0) !== 'MThd') throw new Error('no es un archivo MIDI (falta MThd)')
  const nPistas = dv.getUint16(10)
  const division = dv.getUint16(12)
  if (division & 0x8000) throw new Error('MIDI con división SMPTE no soportada')
  const ppq = division
  let o = 8 + dv.getUint32(4)
  let bpm = 120
  let compas: CancionSmf['compas']
  let titulo: string | undefined
  const marcadores: NonNullable<CancionSmf['marcadores']> = []
  const pistas: PistaSmf[] = []
  const dec = new TextDecoder()
  for (let k = 0; k < nPistas && o + 8 <= bin.length; k++) {
    if (tag(o) !== 'MTrk') throw new Error(`bloque inesperado en la pista ${k}`)
    const fin = o + 8 + dv.getUint32(o + 4)
    let p = o + 8
    let tick = 0
    let estado = 0
    let nombre = ''
    let canal = 0
    let programa: number | undefined
    const abiertas = new Map<number, { inicio: number; vel: number }>()
    const notas: NotaSmf[] = []
    const ccs: CcSmf[] = []
    const leerVlq = () => {
      let v = 0
      for (let i = 0; i < 4; i++) {
        const b = bin[p++]!
        v = (v << 7) | (b & 0x7f)
        if (!(b & 0x80)) break
      }
      return v
    }
    while (p < fin) {
      tick += leerVlq()
      let st = bin[p]!
      if (st & 0x80) p++
      else st = estado
      if (st === 0xff) {
        const tipo = bin[p++]!
        const len = leerVlq()
        const datos = bin.subarray(p, p + len)
        p += len
        if (tipo === 0x51 && len === 3 && tick === 0) bpm = 60_000_000 / ((datos[0]! << 16) | (datos[1]! << 8) | datos[2]!)
        else if (tipo === 0x58 && len >= 2) compas = { numerador: datos[0]!, denominador: 2 ** datos[1]! }
        else if (tipo === 0x03) nombre = dec.decode(datos)
        else if (tipo === 0x06) marcadores.push({ nombre: dec.decode(datos), inicio: tick / ppq })
        continue
      }
      if (st === 0xf0 || st === 0xf7) {
        p += leerVlq()
        continue
      }
      estado = st
      const tipo = st & 0xf0
      canal = st & 0x0f
      const d1 = bin[p++]!
      const d2 = tipo === 0xc0 || tipo === 0xd0 ? 0 : bin[p++]!
      const clave = (canal << 7) | d1
      if (tipo === 0x90 && d2 > 0) {
        abiertas.set(clave, { inicio: tick, vel: d2 })
      } else if (tipo === 0x80 || (tipo === 0x90 && d2 === 0)) {
        const a = abiertas.get(clave)
        if (a) {
          notas.push({ pitch: d1, velocidad: a.vel, inicio: a.inicio / ppq, duracion: (tick - a.inicio) / ppq })
          abiertas.delete(clave)
        }
      } else if (tipo === 0xb0) {
        ccs.push({ cc: d1, valor: d2, tiempo: tick / ppq })
      } else if (tipo === 0xc0) {
        programa = d1
      }
    }
    if (k === 0 && nPistas > 1 && notas.length === 0) titulo = nombre || undefined
    else if (notas.length || ccs.length) pistas.push({ nombre, canal, notas, ccs, programa })
    o = fin
  }
  return { titulo, bpm, compas, marcadores, pistas, ppq }
}

// ── Proyecto → SMF ───────────────────────────────────────────────────────────

type NotaProyecto = { pitch: number; velocidad?: number; inicio: number; duracion: number; mute?: boolean }
type ClipProyecto = {
  id: string
  tipo?: string
  inicio?: number
  duracion?: number
  silenciado?: boolean
  notas?: NotaProyecto[]
  expression?: { cc?: Array<{ cc: number; puntos?: Array<{ tiempo: number; valor: number }> }> }
}
type PistaProyecto = { id: string; nombre: string; tags?: string[]; clips?: ClipProyecto[] | null }

export type ProyectoSmf = {
  nombre?: string
  bpm?: { valor?: number } | null
  timeSignature?: { numerador?: number; denominador?: number } | null
  /** `tiempo` en beats (misma unidad que los clips). */
  marcadores?: Array<{ nombre?: string; tiempo?: number }> | null
  tracks?: PistaProyecto[] | null
}

const RE_BATERIA = /bater|drum|perc|kit/i

/**
 * Convierte el proyecto a SMF. `trackIds` limita las pistas; `clipId` exporta un único clip
 * (desde el beat 0 si `clipDesdeCero`). Las notas silenciadas y los clips silenciados no se exportan
 * y lo que cae fuera de la región del clip se recorta, igual que en la reproducción.
 */
export function proyectoASmf(
  p: ProyectoSmf,
  opts: { trackIds?: string[]; clipId?: string; clipDesdeCero?: boolean } = {},
): CancionSmf {
  const bpm = Number(p.bpm?.valor) > 0 ? Number(p.bpm!.valor) : 120
  const pistas: PistaSmf[] = []
  let canalLibre = 0
  for (const t of p.tracks ?? []) {
    if (opts.trackIds?.length && !opts.trackIds.includes(t.id)) continue
    const bateria = RE_BATERIA.test(t.nombre) || (t.tags ?? []).some((x) => RE_BATERIA.test(x))
    const notas: NotaSmf[] = []
    const ccs: CcSmf[] = []
    for (const c of t.clips ?? []) {
      if (c.tipo !== 'midi' || c.silenciado) continue
      if (opts.clipId && c.id !== opts.clipId) continue
      const base = opts.clipId && opts.clipDesdeCero ? 0 : Number(c.inicio ?? 0)
      const largo = Number(c.duracion ?? Number.POSITIVE_INFINITY)
      for (const n of c.notas ?? []) {
        if (n.mute || !Number.isFinite(n.pitch) || n.inicio >= largo) continue
        const dur = Math.min(n.duracion, largo - n.inicio)
        if (dur <= 0) continue
        notas.push({ pitch: n.pitch, velocidad: n.velocidad ?? 100, inicio: base + n.inicio, duracion: dur })
      }
      for (const lane of c.expression?.cc ?? []) {
        for (const pt of lane.puntos ?? []) {
          if (pt.tiempo > largo) continue
          ccs.push({ cc: lane.cc, valor: pt.valor <= 1 ? pt.valor * 127 : pt.valor, tiempo: base + pt.tiempo })
        }
      }
    }
    if (!notas.length && !ccs.length) continue
    let canal = 9
    if (!bateria) {
      canal = canalLibre
      canalLibre = (canalLibre + 1) % 16
      if (canalLibre === 9) canalLibre = 10
    }
    pistas.push({ nombre: t.nombre, canal, notas, ccs })
  }
  return {
    titulo: p.nombre,
    bpm,
    compas: {
      numerador: p.timeSignature?.numerador ?? 4,
      denominador: p.timeSignature?.denominador ?? 4,
    },
    marcadores: opts.clipId
      ? []
      : (p.marcadores ?? [])
          .map((m) => ({ nombre: m.nombre ?? '', inicio: Number(m.tiempo ?? 0) }))
          .filter((m) => m.nombre && Number.isFinite(m.inicio)),
    pistas,
  }
}
