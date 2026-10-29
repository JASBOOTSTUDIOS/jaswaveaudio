/**
 * Armonía al escribir: una vez definida la hoja de ruta (acorde por compás), las notas que un músico manda a una
 * pista armónica/melódica/de bajo se comprueban ANTES de tocar el proyecto, de forma determinista y sin modelo:
 *
 *  - tiempo fuerte (primer tiempo del compás) y notas largas (≥ 1 beat): del acorde del compás (más 9.ª y 6.ª
 *    como color, salvo en el bajo);
 *  - el resto: dentro de la escala de la tonalidad (o del acorde); las cromáticas solo como paso (< 0,5 beat)
 *    en tiempo débil;
 *  - el bajo, en el primer tiempo, en la fundamental (o la nota tras «/»).
 *  La batería y la percusión no se tocan.
 *
 * Con notas fuera: `ajustar` las lleva a la nota permitida más cercana y lo cuenta; `rechazar` devuelve un
 * mensaje exacto (compás, acorde, nota, permitidas) para reescribir; `auto` (por defecto) ajusta si son pocas
 * (≤ 15 %) y rechaza si son muchas (la idea está mal y moverlas en bloque destrozaría la frase).
 * Las reglas son las mismas que mide `analizarCoherencia`, así que una parte que las cumple pasa la medición.
 */
import { camposNota, comoListaDeNotas, tonoMidi } from '../agent-tool-runner'
import { MAYOR, MENOR, parsearAcorde, parsearTonalidad, type HojaCoherencia } from './coherencia-banda'

export type ModoArmonia = 'ajustar' | 'rechazar' | 'auto'
export type OpcionesArmonia = { modo: ModoArmonia; /** Fracción máxima de notas que `auto` ajusta en vez de rechazar. */ maxAjuste: number }
// 35 %: con 4 notas de 24 fuera (17 %) rechazar obligaba a reescribir la frase entera varias veces seguidas.
export const ARMONIA_POR_DEFECTO: OpcionesArmonia = { modo: 'auto', maxAjuste: 0.35 }

export type TipoPista = { bateria: boolean; bajo: boolean }

const NOMBRES = ['do', 'do♯', 're', 're♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si']
const EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const pc = (n: number) => ((n % 12) + 12) % 12
const nombre = (p: number) => NOMBRES[pc(p)]!

/** ¿Qué tipo de pista es? (misma detección que la medición de coherencia). */
export function tipoDePista(nombrePista: string, plugins: ReadonlyArray<{ nombre?: string }> = []): TipoPista {
  const texto = `${nombrePista} ${plugins.map((p) => p.nombre ?? '').join(' ')}`
  const bateria = /bater|drum|percus|kit/i.test(texto)
  return { bateria, bajo: !bateria && /bajo|bajista|bass/i.test(texto) }
}

type Compas = { simbolo: string; acorde: NonNullable<ReturnType<typeof parsearAcorde>> | null }

function compasesDe(hoja: HojaCoherencia): Compas[] {
  const out: Compas[] = []
  for (const s of hoja.secciones) {
    for (let i = 0; i < s.compases; i++) {
      const simbolo = s.acordes[i % Math.max(1, s.acordes.length)] ?? ''
      out.push({ simbolo, acorde: parsearAcorde(simbolo) })
    }
  }
  return out
}

function escalaDe(hoja: HojaCoherencia): Set<number> | null {
  const t = parsearTonalidad(hoja.tonalidad)
  return t ? new Set((t.menor ? MENOR : MAYOR).map((i) => pc(t.raiz + i))) : null
}

/** Clases de nota permitidas para una nota; `null` = cualquiera (cromática de paso). */
function permitidas(c: Compas, escala: Set<number> | null, tipo: TipoPista, off: number, dur: number): Set<number> | null {
  const a = c.acorde
  if (!a) return null
  const acorde = new Set(a.notas)
  // 9.ª y 6.ª/13.ª siempre; la 11.ª solo en acordes menores (en uno mayor choca con la tercera).
  const color = tipo.bajo ? [] : [pc(a.raiz + 2), pc(a.raiz + 9), ...(acorde.has(pc(a.raiz + 3)) ? [pc(a.raiz + 5)] : [])]
  if (tipo.bajo && off < 0.25) return new Set([a.bajo, a.raiz])
  if (off < 0.125 || dur >= 1) return new Set([...acorde, ...color])
  if (dur < 0.5) return null
  return new Set([...(escala ?? []), ...acorde, ...color])
}

const lista = (s: Set<number>) => [...s].sort((a, b) => a - b).map(nombre).join(', ')

export type NotaFuera = { compas: number; simbolo: string; pitch: number; beat: number; dur: number; destino: number; permitidas: string; indice: number }

/** Notas fuera de armonía de una lista (beats de la canción = `inicioClip` + inicio de la nota). */
export function notasFueraDeArmonia(
  hoja: HojaCoherencia,
  notas: Array<{ pitch: number; inicio: number; duracion: number }>,
  inicioClip: number,
  tipo: TipoPista,
): { fuera: NotaFuera[]; evaluadas: number } {
  if (tipo.bateria) return { fuera: [], evaluadas: 0 }
  const num = Math.max(1, Math.round(hoja.numerador || 4))
  const compases = compasesDe(hoja)
  const escala = escalaDe(hoja)
  const fuera: NotaFuera[] = []
  let evaluadas = 0
  notas.forEach((n, indice) => {
    const beat = inicioClip + n.inicio
    const i = Math.floor(beat / num + 1e-9)
    const c = compases[i]
    if (!c || !c.acorde || beat < 0) return
    evaluadas++
    const ok = permitidas(c, escala, tipo, beat - i * num, n.duracion)
    if (!ok || ok.has(pc(n.pitch))) return
    // Nota permitida más cercana (a igual distancia, la más grave: no sube de registro sin querer).
    let mejor = n.pitch
    let dist = 99
    for (let d = 0; d <= 12; d++) {
      for (const p of [n.pitch - d, n.pitch + d]) if (p >= 0 && p <= 127 && ok.has(pc(p)) && d < dist) ((mejor = p), (dist = d))
    }
    fuera.push({ compas: i + 1, simbolo: c.simbolo, pitch: n.pitch, beat, dur: n.duracion, destino: mejor, permitidas: lista(ok), indice })
  })
  return { fuera, evaluadas }
}

const r2 = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',')

function mensajeRechazo(f: NotaFuera[], evaluadas: number): string {
  const ejemplos = f.slice(0, 4).map((x) => `compás ${x.compas} (${x.simbolo}): ${nombre(x.pitch)} en beat ${r2(x.beat)} no pertenece; permitidas: ${x.permitidas}`)
  return `${f.length} de ${evaluadas} notas fuera de la armonía de la hoja de ruta; no se ha escrito nada. ${ejemplos.join(' · ')}${f.length > 4 ? ` · …y ${f.length - 4} más` : ''}. Reglas: primer tiempo y notas largas (≥ 1 beat) en notas del acorde; el resto en la escala; cromáticas solo como paso (< 0,5 beat) en tiempo débil; el bajo, en la fundamental. Reescribe la llamada completa con notas permitidas.`
}

export type ResultadoGuardiaArmonia = { args: Record<string, unknown>; avisos: string[] } | { error: string }

const HERRAMIENTAS_NOTAS = /^midi\.(clip\.create|notes\.set|createNotes|notes\.add|notes\.patch)$/

/**
 * Comprueba (y, según el modo, ajusta) las notas de una escritura MIDI. `inicioClip` = inicio del clip destino
 * si ya existe; en `midi.clip.create` se usa `args.inicio`. Sin lista de notas legible: no se toca nada.
 */
export function guardiaArmonia(
  tool: string,
  args: Record<string, unknown>,
  o: { hoja: HojaCoherencia; tipo: TipoPista; inicioClip?: number; opciones?: OpcionesArmonia },
): ResultadoGuardiaArmonia {
  const opciones = o.opciones ?? ARMONIA_POR_DEFECTO
  if (!HERRAMIENTAS_NOTAS.test(tool) || o.tipo.bateria) return { args, avisos: [] }
  const clave = (['upsert', 'notas', 'notes', 'cambios'] as const).find((k) => args[k] != null)
  if (!clave) return { args, avisos: [] }
  const crudo = comoListaDeNotas(args[clave])
  if (!crudo?.length) return { args, avisos: [] }
  const porRango = tool === 'midi.notes.patch' && Number.isFinite(Number(args.rangeStart ?? args.inicioRango ?? args.start))
  const inicioClip = porRango ? 0 : tool === 'midi.clip.create' ? Number(args.inicio ?? 0) || 0 : (o.inicioClip ?? 0)
  const campos = crudo.map((it) => camposNota((it && typeof it === 'object' ? it : {}) as Record<string, unknown>))
  const idx: number[] = []
  const notas: Array<{ pitch: number; inicio: number; duracion: number }> = []
  campos.forEach((c, i) => {
    const pitch = tonoMidi(c.pitchCrudo)
    const inicio = Number(c.inicio)
    const duracion = Number(c.duracion)
    if (pitch == null || !Number.isFinite(inicio) || !Number.isFinite(duracion)) return
    idx.push(i)
    notas.push({ pitch, inicio, duracion })
  })
  const { fuera, evaluadas } = notasFueraDeArmonia(o.hoja, notas, inicioClip, o.tipo)
  if (!fuera.length) return { args, avisos: [] }
  const ratio = fuera.length / Math.max(1, evaluadas)
  const ajustar = opciones.modo === 'ajustar' || (opciones.modo === 'auto' && ratio <= opciones.maxAjuste)
  if (!ajustar) return { error: mensajeRechazo(fuera, evaluadas) }
  const nueva = crudo.map((it) => (it && typeof it === 'object' ? { ...(it as Record<string, unknown>) } : it))
  for (const f of fuera) {
    const item = nueva[idx[f.indice]!] as Record<string, unknown> | undefined
    if (!item) continue
    const k = ['pitch', 'nota', 'tono', 'note', 'midi', 'key', 'altura'].find((x) => item[x] != null) ?? 'pitch'
    item[k] = f.destino
  }
  const resumen = fuera
    .slice(0, 6)
    .map((f) => `compás ${f.compas} (${f.simbolo}) beat ${r2(f.beat)} ${nombre(f.pitch)}→${nombre(f.destino)}`)
    .join('; ')
  const avisos = [`Ajusté ${fuera.length} de ${evaluadas} notas a la armonía de la hoja de ruta: ${resumen}${fuera.length > 6 ? '; …' : ''}. Toca dentro de las notas permitidas de cada compás.`]
  return { args: { ...args, [clave]: nueva }, avisos }
}

/**
 * Tabla de armonía para el encargo de un músico: por cada acorde distinto de SUS secciones, las notas permitidas
 * (clases y ejemplo en su registro). Corta: una línea por acorde, no por compás (la secuencia ya va en la hoja).
 */
export function tablaArmoniaMusico(hoja: HojaCoherencia, o: { encargo: string; tipo: TipoPista }): string | null {
  if (o.tipo.bateria) return null
  const sinAc = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const enc = sinAc(o.encargo)
  const nombradas = hoja.secciones.filter((s) => {
    const base = sinAc(s.nombre).replace(/[\s\d]+$/g, '').trim()
    return base.length >= 3 && enc.includes(base)
  })
  const secciones = nombradas.length ? nombradas : hoja.secciones
  const simbolos = [...new Set(secciones.flatMap((s) => s.acordes))]
  const escala = escalaDe(hoja)
  const octava = o.tipo.bajo ? 2 : 4
  const filas: string[] = []
  for (const simbolo of simbolos) {
    const a = parsearAcorde(simbolo)
    if (!a) continue
    const tonos = [...a.notas].sort((x, y) => pc(x - a.bajo) - pc(y - a.bajo))
    // Ejemplo en su registro, en orden ascendente a partir de la nota más grave.
    let previo = 12 * (octava + 1) + tonos[0]!
    const ejemplos = tonos.map((t, i) => {
      if (i > 0) {
        previo += pc(t - tonos[i - 1]!) || 12
      }
      return `${EN[pc(t)]}${Math.floor(previo / 12) - 1}`
    })
    const colores = o.tipo.bajo ? [] : [pc(a.raiz + 2), pc(a.raiz + 9)].filter((c) => !a.notas.has(c))
    const color = colores.length ? `; color: ${colores.map(nombre).join(', ')}` : ''
    filas.push(`- ${simbolo}: ${tonos.map(nombre).join(', ')} (${ejemplos.join(' ')})${color}${o.tipo.bajo ? `; primer tiempo: ${nombre(a.bajo)}` : ''}`)
  }
  if (!filas.length) return null
  return [
    `ARMONÍA DE TUS SECCIONES${escala ? ` (${hoja.tonalidad}: ${lista(escala)})` : ''}. NO SALGAS de estas notas: en el primer tiempo de cada compás y en las notas largas (≥ 1 beat), solo notas del acorde; el resto, de la escala; una cromática solo como paso corto (< 0,5 beat) en tiempo débil. Si te sales, la herramienta ajusta o rechaza la escritura.`,
    ...filas,
  ].join('\n')
}

/** Guardia sobre el estado del proyecto: localiza la pista y el clip de la llamada. Sin pista o sin hoja, no toca nada. */
export function guardarEscrituraArmonia(
  st: { project?: { tracks?: Array<{ id: string; nombre: string; plugins?: ReadonlyArray<{ nombre?: string }>; clips?: Array<{ id: string; inicio: number }> }> } },
  hoja: HojaCoherencia | null,
  llamada: { nombre: string; argumentos?: Record<string, unknown> },
  opciones?: OpcionesArmonia,
): ResultadoGuardiaArmonia {
  const args = llamada.argumentos ?? {}
  if (!hoja || !HERRAMIENTAS_NOTAS.test(llamada.nombre)) return { args, avisos: [] }
  const pista = (st.project?.tracks ?? []).find((t) => t.id === String(args.pistaId ?? args.trackId ?? ''))
  if (!pista) return { args, avisos: [] }
  const clip = pista.clips?.find((c) => c.id === String(args.clipId ?? ''))
  return guardiaArmonia(llamada.nombre, args, { hoja, tipo: tipoDePista(pista.nombre, pista.plugins ?? []), inicioClip: clip?.inicio, opciones })
}
