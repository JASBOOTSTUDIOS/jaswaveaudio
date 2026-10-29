/**
 * Tool Runner único: Registry → permisos → handler/Command → ToolResult.
 * Congela el crecimiento del switch executeDawActions para el Agent Loop.
 */
import { executeDawActions, gateAgentActionExecution, getStateRevision, instrumentosInstalados, isSyntheticReadTool, sourceIsUserConfirmed, syntheticReadResult, toolRegistry } from '@jaswave/host-sdk'
import type { AgentLoopToolCall, AgentLoopToolResult, DawAction, ExecuteDawOptions, TiendaDAW } from '@jaswave/host-sdk'
import { avisarCambioIA } from './aviso-cambio-ia'

export type RunRegisteredToolOpts = ExecuteDawOptions & {
  /** Resolver por nombre en el catálogo (ejecutor heredado), sin pasar por el comando. */
  porNombre?: boolean
  /** Si la revisión no coincide, no mutar. */
  expectedRevision?: string
  /** callIds ya ejecutados en este run (idempotencia). */
  executedCallIds?: ReadonlySet<string>
}

function stripInternalArgs(tool: string, args: Record<string, unknown>, esquema?: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args }
  delete out.__expectedRevision
  // trackId ↔ pistaId: unos comandos usan uno y otros el otro, y el modelo los mezcla. Manda el
  // esquema del comando; sin esquema, los de midi/clip solo admiten pistaId.
  const props = (esquema?.properties ?? null) as Record<string, unknown> | null
  // `audition` es del ejecutor heredado (ensayo tras escribir MIDI); el comando no lo admite.
  if (props && !('audition' in props)) delete out.audition
  const midiOClip = /^(midi\.|clip\.)/.test(tool)
  const admite = (k: string) => (props ? k in props : k === 'pistaId' ? midiOClip : !midiOClip)
  const id = out.pistaId ?? out.trackId
  if (id != null) {
    if (admite('pistaId') && !admite('trackId')) {
      out.pistaId = id
      delete out.trackId
    } else if (admite('trackId') && !admite('pistaId')) {
      out.trackId = id
      delete out.pistaId
    }
  }
  return out
}

type EstadoDaw = ReturnType<TiendaDAW['obtenerEstado']>

/** Códigos del registro que significan «aquí no hay handler»: lo resuelve el ejecutor heredado. */
const SIN_HANDLER = new Set(['DEFERRED', 'COMMAND_NOT_FOUND'])
const sinHandler = (e?: { code?: string; message?: string }) => SIN_HANDLER.has(e?.code ?? '') || /^Comando no registrado:/.test(e?.message ?? '')

function listaPistas(st: EstadoDaw): string {
  const pistas = st.project?.tracks ?? []
  if (!pistas.length) return 'El proyecto no tiene pistas todavía.'
  return `Pistas: ${pistas
    .slice(0, 24)
    .map((t) => `«${t.nombre}» = "${t.id}"${t.tipo === 'master' ? ' (máster)' : ''}`)
    .join(', ')}.`
}

/**
 * Completa el error con lo que el modelo necesita para corregirse en el siguiente paso: parámetros
 * válidos, ids reales de pistas y clips. Sin esto repetía la misma llamada con los mismos errores.
 */
export function explicarErrorHerramienta(
  tool: string,
  mensaje: string,
  args: Record<string, unknown>,
  esquema: Record<string, unknown> | undefined,
  st: EstadoDaw,
): string {
  const extra: string[] = []
  const props = Object.keys((esquema?.properties ?? {}) as Record<string, unknown>)
  if (/Propiedad no permitida|Campo requerido faltante|Tipo inválido|debe ser/i.test(mensaje) && props.length) {
    const req = ((esquema?.required ?? []) as string[]).filter((k) => props.includes(k))
    extra.push(`Parámetros válidos de ${tool}: ${props.join(', ')}${req.length ? ` (obligatorios: ${req.join(', ')})` : ''}.`)
  }
  if (/trackId|pistaId|Pista no encontrada|Falta trackId/i.test(mensaje)) extra.push(listaPistas(st))
  if (/Clip no encontrado|clipId/i.test(mensaje)) {
    const id = String(args.pistaId ?? args.trackId ?? '')
    const pistas = (st.project?.tracks ?? []).filter((t) => !id || t.id === id)
    const clips = pistas.flatMap((t) => (t.clips ?? []).map((c) => `«${c.nombre ?? 'clip'}» = "${c.id}" en «${t.nombre}»`)).slice(0, 24)
    extra.push(clips.length ? `Clips existentes: ${clips.join(', ')}.` : 'No hay clips en esa pista: créalo antes con midi.clip.create.')
  }
  if (/no está en el catálogo|no se encontró el plugin|Plugin no encontrado en catálogo/i.test(mensaje)) {
    const l = instrumentosInstalados()
    const pedido = args.nombre ?? args.pluginName ?? args.instrumento ?? (typeof args.plugin === 'string' ? args.plugin : (args.plugin as { nombre?: unknown } | undefined)?.nombre)
    if (pedido != null && !new RegExp(`«${String(pedido).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}»`).test(mensaje)) extra.push(`Pediste «${String(pedido)}».`)
    if (l.length) extra.push(`Instrumentos instalados (usa el nombre exacto): ${l.map((n) => `«${n}»`).join(', ')}.`)
  } else if (/Plugin no encontrado: /i.test(mensaje)) {
    // Instancia de la cadena de una pista: los ids válidos son los de sus plugins.
    const pista = (st.project?.tracks ?? []).find((t) => t.id === String(args.trackId ?? args.pistaId ?? ''))
    const cadena = (pista?.plugins ?? []).map((p) => `«${p.nombre}» = "${p.id}"`)
    extra.push(pista ? (cadena.length ? `Plugins de «${pista.nombre}»: ${cadena.join(', ')}.` : `«${pista.nombre}» no tiene plugins: cárgalo antes con track.addVstLayer.`) : listaPistas(st))
  }
  if (/no registrad|no soportada|no encontrada: /i.test(mensaje) && !/Pista|Clip/.test(mensaje)) {
    extra.push('Esa herramienta no existe: usa una de tu lista o búscala con buscar_herramientas.')
  }
  return extra.length ? `${mensaje} ${extra.join(' ')}` : mensaje
}

const NOMBRE_NOTA = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/
const SEMITONO: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Tono MIDI desde número, texto numérico o nombre de nota («C4» = 60). null si no es válido. */
export function tonoMidi(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 && v <= 127 ? Math.round(v) : null
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return tonoMidi(Number(t))
  const m = NOMBRE_NOTA.exec(t)
  if (!m) return null
  const alter = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0
  return tonoMidi(SEMITONO[m[1]!.toUpperCase()]! + alter + (Number(m[3]) + 1) * 12)
}

const ALIAS_PITCH = ['pitch', 'nota', 'tono', 'note', 'midi', 'key', 'altura']
const ALIAS_INICIO = ['inicio', 'start', 'tiempo', 'time', 'beat', 'posicion', 'posición', 'comienzo', 'offset']
const ALIAS_DURACION = ['duracion', 'duración', 'duration', 'dur', 'length', 'largo']
const ALIAS_VELOCIDAD = ['velocidad', 'velocity', 'vel', 'dinamica', 'dinámica']
const CLAVES_NOTA = new Set([...ALIAS_PITCH, ...ALIAS_INICIO, ...ALIAS_DURACION, ...ALIAS_VELOCIDAD])

function primero(o: Record<string, unknown>, claves: readonly string[]): unknown {
  for (const k of claves) if (o[k] != null) return o[k]
  return undefined
}

/**
 * Campos de una nota con las claves del comando, las escriba el modelo como las escriba («note», «start»,
 * «duration», «velocity»…). `resto` conserva id y demás campos ajenos a estos cuatro.
 */
export function camposNota(o: Record<string, unknown>): { pitchCrudo: unknown; inicio: unknown; duracion: unknown; velocidad: unknown; resto: Record<string, unknown> } {
  const resto: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (!CLAVES_NOTA.has(k)) resto[k] = v
  return { pitchCrudo: primero(o, ALIAS_PITCH), inicio: primero(o, ALIAS_INICIO), duracion: primero(o, ALIAS_DURACION), velocidad: primero(o, ALIAS_VELOCIDAD), resto }
}

const NOTAS_EN = (tool: string) => /^midi\.(clip\.create|notes\.set|createNotes|notes\.add)$/.test(tool)
const MIDI_EN_PISTA = /^midi\.(clip\.create|createNotes|notes\.set|notes\.add)$/

function instalados(): string[] {
  try {
    return instrumentosInstalados()
  } catch {
    return []
  }
}

/** Palabras que el modelo usa para un instrumento → palabras de los nombres instalados. */
const SINONIMOS_INSTRUMENTO: Record<string, string[]> = {
  bajo: ['bass'], bass: ['bass'], guitarra: ['guitar'], guitar: ['guitar'], piano: ['piano'], keys: ['piano'], teclado: ['piano'],
  cuerdas: ['strings'], strings: ['strings'], string: ['strings'], violin: ['strings'], violines: ['strings'], orquesta: ['strings'],
  pad: ['ambient', 'atmos', 'pad'], pads: ['ambient', 'atmos', 'pad'], ambiente: ['ambient', 'atmos'], atmosfera: ['ambient', 'atmos'],
  synth: ['synth'], sintetizador: ['synth'], organo: ['organ'], organ: ['organ'], bateria: ['drum', 'drums'], drums: ['drum', 'drums'],
  // «piano de cola», «piano acústico» → Grand Piano (sin esto empataba con Piano Synth por «piano»).
  cola: ['grand'], grand: ['grand'], acustico: ['grand'], acoustic: ['grand'], sinte: ['synth'], lead: ['synth'],
}
const RUIDO_NOMBRE = new Set(['jaswave', 'vst', 'vst3', 'plugin', 'instrumento', 'instrument', 'de', 'el', 'la', 'the'])

function palabras(t: string): string[] {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !RUIDO_NOMBRE.has(w))
}

/**
 * Nombre instalado que corresponde a lo que escribió el modelo («Bajo», «JasWave Bass», «piano de cola»).
 * Solo si hay un único mejor candidato; si el nombre ya coincide con uno instalado se devuelve tal cual.
 */
export function instrumentoAproximado(consulta: string, instalados: readonly string[]): string | undefined {
  const q = consulta.trim().toLowerCase()
  if (!q) return undefined
  const exacto = instalados.find((n) => n.toLowerCase() === q)
  if (exacto) return exacto
  const contienen = instalados.filter((n) => n.toLowerCase().includes(q))
  if (contienen.length > 1) return undefined
  if (contienen.length === 1) return contienen[0]
  const buscadas = new Set(palabras(consulta).flatMap((w) => [w, ...(SINONIMOS_INSTRUMENTO[w] ?? [])]))
  if (!buscadas.size) return undefined
  let mejor: string | undefined
  let puntos = 0
  let empate = false
  for (const n of instalados) {
    const p = palabras(n).filter((w) => buscadas.has(w)).length
    if (p > puntos) [mejor, puntos, empate] = [n, p, false]
    else if (p === puntos && p > 0) empate = true
  }
  return puntos > 0 && !empate ? mejor : undefined
}

/**
 * Guardia de las llamadas de la IA: corrige lo que el modelo suele mandar mal (tonos como texto) y
 * rechaza, con una explicación accionable, lo que dañaría el proyecto en silencio (pistas duplicadas,
 * notas MIDI en una pista de audio, notas fuera de rango que se descartarían o se desafinarían).
 */
export type ResultadoGuardia =
  | {
      args: Record<string, unknown>
      porNombre?: boolean
      /** Herramienta que se ejecuta en lugar de la pedida (p. ej. clip repetido → parche de notas). */
      tool?: string
      /** Aviso que el modelo debe ver junto al resultado. */
      aviso?: string
    }
  | { error: string }

export function guardiaIA(tool: string, args: Record<string, unknown>, st: EstadoDaw): ResultadoGuardia {
  const pistas = st.project?.tracks ?? []
  if (tool === 'plugin.insert') {
    // El modelo inventa el objeto `plugin` ({nombre: …} sin ruta): se insertaría un plugin que nadie carga.
    // Sin ruta real se resuelve por nombre en el catálogo, como track.addVstLayer.
    const plugin = (args.plugin ?? null) as Record<string, unknown> | null
    const ruta = typeof args.path === 'string' && args.path.trim() ? args.path : /\.vst3|[A-Za-z]:[\/]/i.test(String(plugin?.descripcion ?? '')) ? 'si' : ''
    const nombre = String(args.nombre ?? args.pluginName ?? plugin?.nombre ?? plugin?.name ?? '').trim()
    if (!ruta && nombre) {
      const { plugin: _p, ...resto } = args
      return { args: { ...resto, nombre: instrumentoAproximado(nombre, instalados()) ?? nombre }, porNombre: true }
    }
    if (!ruta && !nombre) return { error: 'plugin.insert necesita el nombre del plugin (campo nombre) o su ruta (path).' }
  }
  const conRuta = (o: unknown) => !!o && typeof o === 'object' && /\.vst3|[A-Za-z]:[\/]/i.test(String((o as Record<string, unknown>).descripcion ?? ''))
  if (tool === 'track.addVstLayer' && !args.presetId && !(typeof args.path === 'string' && args.path.trim()) && !conRuta(args.plugin)) {
    const plugin = args.plugin
    const nombre = String(args.nombre ?? args.pluginName ?? (typeof plugin === 'string' ? plugin : (plugin as Record<string, unknown> | undefined)?.nombre ?? (plugin as Record<string, unknown> | undefined)?.name) ?? args.instrumento ?? '').trim()
    if (!nombre && !args.pluginId) return { error: 'track.addVstLayer necesita el nombre del instrumento (campo nombre).' }
    if (nombre) {
      const { plugin: _p, pluginName: _n, instrumento: _i, ...resto } = args
      return { args: { ...resto, nombre: instrumentoAproximado(nombre, instalados()) ?? nombre } }
    }
  }
  if (tool === 'master.update' || tool === 'track.update') {
    // El volumen es lineal (1 = 0 dB): el modelo manda 0 o dB negativos pensando en «0 dB» y deja la
    // canción entera (o la pista) muda.
    const datos = (args.datos ?? args) as Record<string, unknown>
    if (datos.volumen != null) {
      const v = Number(datos.volumen)
      if (!Number.isFinite(v) || v <= 0 || v > 4) {
        return {
          error: `volumen ${JSON.stringify(datos.volumen)} no es válido: es lineal de 0 a 4, con 1 = 0 dB (0,5 ≈ −6 dB, 0,25 ≈ −12 dB, 2 ≈ +6 dB). 0 dejaría ${tool === 'master.update' ? 'toda la canción' : 'la pista'} en silencio; para silenciar usa mute: true. No se ha cambiado nada.`,
        }
      }
    }
  }
  if (tool === 'track.create') {
    const nombre = String(args.nombre ?? '').trim().toLowerCase()
    const igual = nombre ? pistas.find((t) => t.nombre.trim().toLowerCase() === nombre) : undefined
    if (igual) return { error: `Ya existe la pista «${igual.nombre}» = "${igual.id}" (${igual.tipo}). Úsala en lugar de crear otra; si de verdad necesitas una segunda, dale otro nombre.` }
    // Desde la IA casi siempre es para notas: sin tipo, una pista de audio quedaría muda con MIDI.
    if (!args.tipo) return { args: { ...args, tipo: 'midi' } }
    return { args }
  }
  let out = sinComillasEnIds(args)
  args = out
  let idPista = String(args.pistaId ?? args.trackId ?? '')
  let pista = pistas.find((t) => t.id === idPista)
  // El clip existe pero en otra pista (el modelo mezcla ids al pasar de una pista a otra, o manda la
  // pista nueva con el clip de la anterior): se corrige la pista en vez de fallar con «Clip no encontrado».
  const clipId = typeof args.clipId === 'string' ? args.clipId : ''
  if (clipId && !(pista?.clips ?? []).some((c) => c.id === clipId)) {
    const duena = pistas.find((t) => (t.clips ?? []).some((c) => c.id === clipId))
    if (duena && duena.id !== idPista) {
      out = args.pistaId == null && args.trackId != null ? { ...out, trackId: duena.id } : { ...out, pistaId: duena.id }
      args = out
      idPista = duena.id
      pista = duena
    }
  }
  // `notas` como texto JSON, como objeto suelto o como mapa: se convierte a lista antes de validar.
  if (NOTAS_EN(tool) && args.notas != null && !Array.isArray(args.notas)) {
    const lista = comoListaDeNotas(args.notas)
    if (!lista) {
      if (esResumenDeHistorial(args.notas)) {
        return { error: `notas trae el resumen del historial («${String(args.notas).trim().slice(0, 60)}»), no las notas: en el historial las listas largas se abrevian, pero a la herramienta hay que mandarle la lista completa de notas reales [{pitch, inicio, duracion, velocidad}]. No se ha cambiado nada.` }
      }
      return { error: `notas debe ser una lista de notas [{pitch, inicio, duracion, velocidad}], no ${describirTipo(args.notas)}${muestraDe(args.notas)}. No se ha cambiado nada.` }
    }
    out = { ...out, notas: lista }
    args = out
  }
  if (tool === 'midi.notes.patch') {
    const parche = normalizarParche(args, pista as Parameters<typeof normalizarParche>[1])
    if ('error' in parche) return parche
    out = parche.args
    args = out
  }
  if (MIDI_EN_PISTA.test(tool)) {
    if (pista && pista.tipo !== 'midi' && pista.tipo !== 'instrumento') {
      return { error: `La pista «${pista.nombre}» es de tipo ${pista.tipo}: las notas MIDI necesitan una pista midi o de instrumento. Usa otra o créala con track.create y tipo "midi".` }
    }
  }
  let reemplazaEn: { id: string; nombre?: string; inicio: number; duracion: number } | undefined
  let reescribeEn: { id: string; nombre?: string; inicio: number; duracion: number } | undefined
  if (tool === 'midi.clip.create' && pista) {
    // Dos clips en el mismo sitio suenan a la vez (partes duplicadas): se edita el que ya está.
    const ini = Number(args.inicio ?? 0)
    const fin = ini + Number(args.duracion ?? 0)
    const choca = (pista.clips ?? []).find((c) => ini < c.inicio + c.duracion - 1e-6 && c.inicio < fin - 1e-6)
    if (choca && Number.isFinite(fin) && fin > ini) {
      const cubre = choca.inicio <= ini + 1e-6 && choca.inicio + choca.duracion >= fin - 1e-6
      const mismoInicio = Math.abs(choca.inicio - ini) <= 1 && Math.abs(choca.duracion - Number(args.duracion ?? 0)) <= Math.max(4, choca.duracion * 0.25)
      if (!cubre && mismoInicio && Array.isArray(args.notas) && args.notas.length) {
        // Misma sección con otra duración (16–48 frente a 16–50): se reescribe el clip existente entero.
        reescribeEn = choca
      } else if (cubre && Array.isArray(args.notas) && args.notas.length) {
        // El músico reescribe una sección que ya grabó (en la banda se repetía 10 veces el mismo error):
        // se sustituyen las notas de ese tramo del clip existente en vez de fallar.
        reemplazaEn = choca
      } else {
        return {
          error: `Ya hay un clip en ese lugar de «${pista.nombre}»: «${choca.nombre ?? 'clip'}» = "${choca.id}" (beats ${choca.inicio}–${choca.inicio + choca.duracion}). Edita sus notas con midi.notes.patch o midi.notes.set, o crea el nuevo a partir del beat ${choca.inicio + choca.duracion}.`,
        }
      }
    }
  }
  if (tool === 'midi.notes.set' && pista) {
    // Reemplaza TODAS las notas: si el modelo solo manda las 2 que quería cambiar, borra el resto.
    const { reemplazarTodas, ...resto } = out
    out = resto
    const clip = (pista.clips ?? []).find((c) => c.id === String(args.clipId ?? '')) as { notas?: unknown[] } | undefined
    const antes = clip?.notas?.length ?? 0
    const despues = Array.isArray(args.notas) ? args.notas.length : 0
    if (antes >= 4 && despues < antes * 0.5 && reemplazarTodas !== true) {
      return {
        error: `midi.notes.set reemplaza todas las notas: el clip tiene ${antes} y quedarían ${despues}. Para cambiar solo algunas usa midi.notes.patch. Si de verdad quieres reemplazarlas todas, repite la llamada con reemplazarTodas: true.`,
      }
    }
  }
  if (NOTAS_EN(tool) && Array.isArray(args.notas)) {
    const malas: string[] = []
    const notas = (args.notas as unknown[]).map((n, i) => {
      if (!n || typeof n !== 'object') {
        malas.push(`#${i + 1} no es una nota`)
        return n
      }
      const o = n as Record<string, unknown>
      const c = camposNota(o)
      const pitch = tonoMidi(c.pitchCrudo)
      const inicio = Number(c.inicio)
      const duracion = Number(c.duracion)
      if (pitch == null) malas.push(`#${i + 1} pitch ${JSON.stringify(c.pitchCrudo)}`)
      else if (!Number.isFinite(inicio) || inicio < 0) malas.push(`#${i + 1} inicio ${JSON.stringify(c.inicio)}`)
      else if (!Number.isFinite(duracion) || duracion <= 0) malas.push(`#${i + 1} duracion ${JSON.stringify(c.duracion)}`)
      return pitch == null ? o : { ...c.resto, pitch, inicio, duracion, ...(c.velocidad != null ? { velocidad: Number(c.velocidad) } : {}) }
    })
    if (malas.length) {
      return {
        error: `Hay ${malas.length} nota(s) inválidas (${malas.slice(0, 6).join('; ')}${malas.length > 6 ? '…' : ''}). Cada nota necesita pitch MIDI 0–127 (número; C4 = 60), inicio ≥ 0 y duracion > 0 en beats. No se ha cambiado nada.`,
      }
    }
    out = { ...out, notas }
    // Las notas van en beats relativos al clip; el modelo a menudo las manda en tiempo de la canción
    // (clip en el beat 64 con notas 64–96): quedaban fuera del clip y ni sonaban ni se exportaban.
    const clipExistente = tool === 'midi.clip.create' ? undefined : (pista?.clips ?? []).find((c) => c.id === String(args.clipId ?? ''))
    const inicioClip = tool === 'midi.clip.create' ? Number(args.inicio ?? 0) : Number(clipExistente?.inicio ?? 0)
    const duracionClip = tool === 'midi.clip.create' ? (args.duracion != null ? Number(args.duracion) : undefined) : clipExistente?.duracion
    const relativas = notasRelativasAlClip(notas as Array<{ inicio: number }>, inicioClip, duracionClip)
    if (relativas) out = { ...out, notas: relativas }
  }
  if (reescribeEn && pista && Array.isArray(out.notas)) {
    return {
      tool: 'midi.notes.set',
      args: { pistaId: pista.id, clipId: reescribeEn.id, notas: out.notas },
      aviso: `Ya había un clip en esa sección de «${pista.nombre}» («${reescribeEn.nombre ?? 'clip'}» = "${reescribeEn.id}", beats ${reescribeEn.inicio}–${reescribeEn.inicio + reescribeEn.duracion}): no se creó otro; se reemplazaron sus notas por las nuevas. Para seguir editándolo usa clipId "${reescribeEn.id}".`,
    }
  }
  if (reemplazaEn && pista && Array.isArray(out.notas)) {
    const ini = Number(args.inicio ?? 0)
    const fin = ini + Number(args.duracion ?? 0)
    // Las notas ya están relativas al clip pedido: pasan a tiempo de la canción y el parche por rango las
    // deja relativas al clip existente, quitando lo que había en ese tramo.
    const enCancion = (out.notas as Array<{ inicio: number }>).map((n) => ({ ...n, inicio: Number(n.inicio) + ini }))
    const parche = normalizarParche({ pistaId: pista.id, rangeStart: ini, rangeEnd: fin, notas: enCancion }, pista as Parameters<typeof normalizarParche>[1])
    if ('error' in parche) return parche
    return {
      tool: 'midi.notes.patch',
      args: parche.args,
      aviso: `Ya había un clip en ese tramo de «${pista.nombre}» («${reemplazaEn.nombre ?? 'clip'}» = "${reemplazaEn.id}", beats ${reemplazaEn.inicio}–${reemplazaEn.inicio + reemplazaEn.duracion}): no se creó otro; se sustituyeron sus notas entre los beats ${ini} y ${fin} por las nuevas. Para seguir editándolo usa clipId "${reemplazaEn.id}".`,
    }
  }
  if (tool === 'midi.clip.create' && pista) {
    // Un clip muy lejos de todo lo demás (p. ej. en el beat 385 de una canción de 250) alarga la canción
    // con minutos de silencio en el render.
    const ini = Number(args.inicio ?? 0)
    const finContenido = Math.max(0, ...pistas.flatMap((t) => (t.clips ?? []).map((c) => c.inicio + c.duracion)))
    if (finContenido > 0 && ini > finContenido + HUECO_MAXIMO_BEATS) {
      return {
        error: `El clip empezaría en el beat ${ini}, pero todo lo grabado termina en el beat ${finContenido}: dejaría ${Math.round(ini - finContenido)} beats de silencio. inicio va en beats desde el principio de la canción (compás N empieza en el beat (N−1)×${st.project?.timeSignature?.numerador ?? 4}). Revisa la cuenta y repite.`,
      }
    }
  }
  return { args: out }
}

/** Hueco máximo (beats) entre el final de lo grabado y un clip nuevo antes de pedir confirmación al modelo. */
const HUECO_MAXIMO_BEATS = 64

const CAMPOS_ID = ['pistaId', 'trackId', 'clipId', 'otherClipId', 'otherTrackId', 'pluginId', 'busId'] as const

/**
 * El modelo copia ids tal como los ve en los errores («Batería» = "1793-x") y manda la cadena con las
 * comillas dentro: la pista existe pero no se encuentra. Se quitan comillas y espacios alrededor.
 */
export function sinComillasEnIds(args: Record<string, unknown>): Record<string, unknown> {
  let out = args
  for (const k of CAMPOS_ID) {
    const v = args[k]
    if (typeof v !== 'string') continue
    const limpio = v.trim().replace(/^["'«»“”‘’`]+|["'«»“”‘’`]+$/g, '').trim()
    if (limpio !== v) out = { ...out, [k]: limpio }
  }
  return out
}

function describirTipo(v: unknown): string {
  if (typeof v === 'string') return 'un texto'
  if (v && typeof v === 'object') return 'un objeto'
  return typeof v
}

/**
 * El historial del agente abrevia las listas largas («[80 elementos]», «[lista de 80 elementos …]») y el
 * modelo a veces copia ese texto en la llamada siguiente en vez de las notas.
 */
export function esResumenDeHistorial(v: unknown): boolean {
  return typeof v === 'string' && /^\s*\[\s*(lista de\s+)?\d+\s+elementos\b/i.test(v)
}

/** Principio de lo que mandó el modelo, para que vea qué envió (y quede en el rastro de la banda). */
function muestraDe(v: unknown): string {
  const t = (typeof v === 'string' ? v : safeStringify(v)).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return ` (empieza: «${t.slice(0, 160)}${t.length > 160 ? '…' : ''}»)`
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

/**
 * `notas` en formas que el modelo manda a veces: JSON en texto (también entre ```fences```, con claves sin
 * comillas o comillas simples, o cortado a mitad), una sola nota, un mapa {0: nota, 1: nota} o filas de texto
 * «pitch inicio duracion [velocidad]» (una por línea o separadas por «;»).
 */
export function comoListaDeNotas(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    const texto = v.replace(/^\s*```[a-z]*\s*|\s*```\s*$/gi, '').trim()
    if (!texto) return null
    for (const candidato of [texto, jsonLaxo(texto), jsonRecortado(texto), jsonRecortado(jsonLaxo(texto))]) {
      if (!candidato) continue
      try {
        const parsed: unknown = JSON.parse(candidato)
        if (parsed === candidato || typeof parsed === 'number') return null
        const lista = comoListaDeNotas(parsed)
        if (lista) return lista
      } catch {
        /* siguiente forma */
      }
    }
    return filasDeNotas(texto)
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('pitch' in o || 'nota' in o || 'tono' in o) return [o]
    if (Array.isArray(o.notas)) return o.notas
    if (Array.isArray(o.notes)) return o.notes
    if (Array.isArray(o.items)) return o.items
    const claves = Object.keys(o)
    if (claves.length && claves.every((k) => /^\d+$/.test(k))) return claves.sort((a, b) => Number(a) - Number(b)).map((k) => o[k])
  }
  return null
}

/** JSON «a la JavaScript»: claves sin comillas, comillas simples, comas finales, y el tartamudeo `{"{"id"` del modelo. */
function jsonLaxo(t: string): string {
  return t
    .replace(/\{\s*"\{"\s*(?=[A-Za-z_"])/g, '{"')
    .replace(/'([^'\\\n]*)'/g, '"$1"')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1')
}

/** JSON cortado por el límite de salida del modelo: se queda con las notas completas y se cierra la lista. */
function jsonRecortado(t: string): string | null {
  const ini = t.indexOf('[')
  const ultimo = t.lastIndexOf('}')
  if (ini < 0 || ultimo < ini) return null
  const cuerpo = t.slice(ini, ultimo + 1)
  return cuerpo.endsWith(']') ? null : `${cuerpo}]`
}

/**
 * Filas «60 0 1 100», «C4, 0, 1», «36:0:0.5:100», «- 60 0 1 100», «pitch=60 inicio=0 duracion=1»,
 * «pitch 36, inicio 0, duracion 0.5, velocidad 100»: una nota por línea, o separadas por «;» o por «,» cuando
 * dentro de cada nota solo hay espacios («C4 0 1 100, E4 1 1 100»). Las filas que no son una nota (cabeceras,
 * comentarios) se saltan mientras no sean la mayoría; un texto en prosa no es una lista.
 */
function filasDeNotas(t: string): unknown[] | null {
  // Coma decimal («0,5») antes de separar por comas.
  const limpio = t.replace(/(\d),(\d)/g, '$1.$2')
  let filas = limpio.split(/[\n;]+/).map((f) => f.trim()).filter(Boolean)
  // Una sola línea con varias notas separadas por comas y sin comas dentro de la nota: «C4 0 1 100, E4 1 1 100».
  if (filas.length === 1 && /,/.test(filas[0]!) && /^[^,]+(\s[^,\s]+){2,3}(\s*,\s*[^,]+(\s[^,\s]+){2,3})+$/.test(filas[0]!.replace(/[|/:]/g, ' '))) {
    filas = filas[0]!.split(',').map((f) => f.trim()).filter(Boolean)
  }
  if (!filas.length) return null
  const out: unknown[] = []
  let saltadas = 0
  for (const cruda of filas) {
    // Viñetas y numeración de lista («- », «* », «• », «1. », «3) »).
    const fila = cruda.replace(/^(?:[-*•]+|\d+[.)])\s+/, '').trim()
    const conClaves = /(?:pitch|nota|tono|note)\s*[=:]?\s*([A-Ga-g][#b♯♭]?-?\d|\d+)\b/i.exec(fila)
    if (conClaves && /(?:inicio|start|duracion|duración|duration)/i.test(fila)) {
      const num = (claves: string) => {
        const m = new RegExp(`(?:${claves})\\s*[=:]?\\s*(-?\\d+(?:[.,]\\d+)?)`, 'i').exec(fila)
        return m ? Number(m[1]!.replace(',', '.')) : undefined
      }
      const velocidad = num('velocidad|velocity|vel')
      out.push({ pitch: tonoMidi(conClaves[1]) ?? conClaves[1], inicio: num('inicio|start'), duracion: num('duracion|duración|duration|dur'), ...(velocidad != null ? { velocidad } : {}) })
      continue
    }
    const partes = fila.split(/[\s,|/:]+/).filter(Boolean)
    const pitch = partes.length >= 3 && partes.length <= 4 ? tonoMidi(partes[0]) : null
    const nums = partes.slice(1).map((p) => Number(p.replace(',', '.')))
    if (pitch == null || nums.some((n) => !Number.isFinite(n))) {
      saltadas++
      continue
    }
    out.push({ pitch, inicio: nums[0], duracion: nums[1], ...(nums.length > 2 ? { velocidad: nums[2] } : {}) })
  }
  return out.length && saltadas <= out.length ? out : null
}

let contadorNotaIA = 0
const idNotaIA = () => `n-ia-${Date.now().toString(36)}-${(++contadorNotaIA).toString(36)}`

/**
 * `midi.notes.patch` espera `upsert: [{nota: {id, pitch, …}, indice}]` y `removeIds`. El modelo manda a
 * menudo las notas sueltas en `upsert`, o `notas`, o `removeIds` ausente: antes reventaba con «Cannot read
 * properties of undefined (reading 'id')». Aquí se convierte a la forma del comando y se validan las notas.
 */
export function normalizarParche(
  args: Record<string, unknown>,
  pista: { nombre?: string; clips?: ReadonlyArray<{ id: string; nombre?: string; inicio: number; duracion: number; notas?: unknown[] }> } | undefined,
): { args: Record<string, unknown> } | { error: string } {
  type NotaExistente = { id: string; pitch?: number; inicio: number; duracion: number; velocidad?: number }
  const clips = pista?.clips ?? []
  let clip = clips.find((c) => c.id === String(args.clipId ?? ''))
  // Forma por rango (la que enseñan algunas guías): {pistaId, rangeStart, rangeEnd, notas} en beats de la
  // canción. Se traduce al comando: se quitan las notas del clip dentro del rango y se insertan las nuevas.
  const ini = Number(args.rangeStart ?? args.inicioRango ?? args.start ?? NaN)
  const fin = Number(args.rangeEnd ?? args.finRango ?? args.end ?? NaN)
  const porRango = Number.isFinite(ini) && Number.isFinite(fin) && fin > ini && !Array.isArray(args.upsert)
  let quitarPorRango: string[] = []
  let desplazar = 0
  if (porRango) {
    const cubre = (c: { inicio: number; duracion: number }) => c.inicio <= ini + 1e-6 && c.inicio + c.duracion >= fin - 1e-6
    if (clip && !cubre(clip)) clip = undefined
    if (!clip) clip = clips.find(cubre)
    if (!clip) {
      const lista = clips.map((c) => `«${c.nombre ?? 'clip'}» = "${c.id}" (beats ${c.inicio}–${c.inicio + c.duracion})`).join(', ')
      return { error: `Ningún clip de «${pista?.nombre ?? 'la pista'}» cubre los beats ${ini}–${fin}.${lista ? ` Clips: ${lista}.` : ''} Crea el clip de esa sección con midi.clip.create o indica el clipId de uno existente.` }
    }
    desplazar = clip.inicio
    const relIni = ini - clip.inicio
    const relFin = fin - clip.inicio
    quitarPorRango = ((clip.notas ?? []) as NotaExistente[]).filter((n) => n.inicio >= relIni - 1e-6 && n.inicio < relFin - 1e-6).map((n) => n.id)
    args = { ...args, clipId: clip.id }
    delete args.rangeStart
    delete args.inicioRango
    delete args.start
    delete args.rangeEnd
    delete args.finRango
    delete args.end
  }
  const existentes = ((clip?.notas ?? []) as NotaExistente[])
  const crudo = args.upsert ?? args.notas ?? args.notes ?? args.cambios ?? []
  const lista = comoListaDeNotas(crudo)
  if (!lista) {
    if (esResumenDeHistorial(crudo)) {
      return { error: `upsert trae el resumen del historial («${String(crudo).trim().slice(0, 60)}»), no las notas: en el historial las listas largas se abrevian, pero a la herramienta hay que mandarle la lista completa de notas reales [{id?, pitch, inicio, duracion, velocidad}]. No se ha cambiado nada.` }
    }
    return { error: `upsert debe ser una lista de notas a crear o cambiar ([{id?, pitch, inicio, duracion, velocidad}]), no ${describirTipo(crudo)}${muestraDe(crudo)}. No se ha cambiado nada.` }
  }
  const malas: string[] = []
  const upsert = lista.map((item, i) => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    // Forma del comando ({nota, indice}) o nota suelta.
    const nota = (o.nota && typeof o.nota === 'object' ? o.nota : o) as Record<string, unknown>
    const indice = Number.isFinite(Number(o.indice)) && o.nota ? Number(o.indice) : existentes.length + i
    const c = camposNota(nota)
    const id = typeof nota.id === 'string' && nota.id.trim() ? nota.id.trim() : idNotaIA()
    // Nota ya existente mandada a medias ({id, velocidad} para cambiar solo la dinámica): lo que falta se
    // toma de la nota actual en vez de rechazar «pitch undefined» 19 veces.
    const previa = existentes.find((n) => n.id === id)
    const pitch = tonoMidi(c.pitchCrudo ?? previa?.pitch)
    // Por rango, las notas vienen en beats de la canción: pasan a relativas al clip.
    const inicioCrudo = c.inicio != null ? Number(c.inicio) : previa ? previa.inicio : NaN
    const inicio = porRango && c.inicio != null && inicioCrudo >= ini - 1e-6 ? Math.max(0, inicioCrudo - desplazar) : inicioCrudo
    const duracion = c.duracion != null ? Number(c.duracion) : previa ? previa.duracion : NaN
    if (pitch == null) malas.push(`#${i + 1} pitch ${JSON.stringify(c.pitchCrudo)}`)
    else if (!Number.isFinite(inicio) || inicio < 0) malas.push(`#${i + 1} inicio ${JSON.stringify(c.inicio)}`)
    else if (!Number.isFinite(duracion) || duracion <= 0) malas.push(`#${i + 1} duracion ${JSON.stringify(c.duracion)}`)
    const { indice: _i, ...resto } = c.resto
    return {
      nota: { ...resto, id, pitch: pitch ?? 0, inicio, duracion, velocidad: Math.max(1, Math.min(127, Math.round(Number(c.velocidad ?? previa?.velocidad ?? 80)) || 80)) },
      indice,
    }
  })
  if (malas.length) {
    return { error: `Hay ${malas.length} nota(s) inválidas en upsert (${malas.slice(0, 6).join('; ')}${malas.length > 6 ? '…' : ''}). Cada nota necesita pitch MIDI 0–127 (número; C4 = 60), inicio ≥ 0 y duracion > 0 en beats relativos al clip. No se ha cambiado nada.` }
  }
  const removeCrudo = args.removeIds ?? args.quitar ?? args.eliminar ?? []
  const removeIds = [
    ...(Array.isArray(removeCrudo) ? removeCrudo : typeof removeCrudo === 'string' ? [removeCrudo] : [])
      .map((x) => (x && typeof x === 'object' ? (x as { id?: unknown }).id : x))
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim()),
    // Por rango: lo que había en ese tramo se sustituye (salvo las notas que el modelo reenvía con su id).
    ...quitarPorRango.filter((id) => !upsert.some((u) => u.nota.id === id)),
  ]
  if (!upsert.length && !removeIds.length) return { error: 'midi.notes.patch no cambia nada: manda en upsert las notas a crear o cambiar (con su id si ya existen) y en removeIds las que sobran.' }
  const { notas: _notas, notes: _notes, cambios: _c, quitar: _q, eliminar: _e, ...resto } = args
  return { args: { ...resto, upsert, removeIds } }
}

/**
 * Si todas las notas están en tiempo de la canción (≥ inicio del clip) y solo así caben en el clip,
 * las devuelve relativas al clip; si no, undefined (se dejan tal cual).
 */
export function notasRelativasAlClip<T extends { inicio: number }>(notas: T[], inicioClip: number, duracionClip?: number): T[] | undefined {
  if (!(inicioClip > 0) || !notas.length) return undefined
  const inicios = notas.map((n) => Number(n.inicio))
  if (inicios.some((x) => !Number.isFinite(x) || x < inicioClip - 1e-6)) return undefined
  if (duracionClip != null && Number.isFinite(duracionClip)) {
    // Relativas ya caben: no se tocan. Absolutas tienen que caber tras restar el inicio.
    if (Math.max(...inicios) < duracionClip) return undefined
    if (Math.max(...inicios) - inicioClip >= duracionClip) return undefined
  }
  return notas.map((n) => ({ ...n, inicio: Math.max(0, Number(n.inicio) - inicioClip) }))
}

/** Avisos del comando (p. ej. notas descartadas) que el modelo debe ver junto al resultado. */
function conAvisos(data: unknown, events: unknown): unknown {
  const avisos = (Array.isArray(events) ? events : [])
    .filter((e) => (e as { nombre?: string })?.nombre === 'validacion.advertencia')
    .map((e) => String((e as { payload?: { message?: unknown } }).payload?.message ?? ''))
    .filter(Boolean)
  if (!avisos.length) return data
  return data && typeof data === 'object' && !Array.isArray(data) ? { ...(data as object), avisos } : { resultado: data, avisos }
}

export async function runRegisteredTool(
  tienda: TiendaDAW,
  call: AgentLoopToolCall,
  opts: RunRegisteredToolOpts = {},
): Promise<AgentLoopToolResult> {
  const guardia = guardiaIA(call.tool, call.arguments ?? {}, tienda.obtenerEstado())
  if ('error' in guardia) {
    return { callId: call.id, tool: call.tool, status: 'error', error: { code: 'AI_GUARD', message: guardia.error }, stateRevision: getStateRevision(tienda.obtenerEstado()) }
  }
  const tool = guardia.tool ?? call.tool
  const r0 = await ejecutarHerramienta(tienda, { ...call, tool, arguments: guardia.args }, { ...opts, porNombre: guardia.porNombre })
  // El resultado vuelve con el nombre que pidió el modelo (la sustitución es interna) y con el aviso.
  const r: AgentLoopToolResult = { ...r0, tool: call.tool }
  if (r.status === 'success') avisarCambioIA(tool, guardia.args)
  if (r.status === 'success' && guardia.aviso) {
    const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? { ...(r.data as object), aviso: guardia.aviso } : { resultado: r.data, aviso: guardia.aviso }
    return { ...r, data }
  }
  if (r.status !== 'error' || !r.error?.message) return r
  const esquema = (tienda.registroComandos?.get?.(tool) as { schema?: Record<string, unknown> } | undefined)?.schema
  return { ...r, error: { ...r.error, message: explicarErrorHerramienta(tool, r.error.message, guardia.args, esquema, tienda.obtenerEstado()) } }
}

async function ejecutarHerramienta(
  tienda: TiendaDAW,
  call: AgentLoopToolCall,
  opts: RunRegisteredToolOpts = {},
): Promise<AgentLoopToolResult> {
  const st0 = tienda.obtenerEstado()
  const fp0 = getStateRevision(st0)
  const expected =
    opts.expectedRevision ??
    (typeof call.arguments.__expectedRevision === 'string' ? call.arguments.__expectedRevision : undefined)

  if (opts.executedCallIds?.has(call.id)) {
    return {
      callId: call.id,
      tool: call.tool,
      status: 'success',
      data: { skipped: true, reason: 'idempotent' },
      stateRevision: fp0,
    }
  }

  if (expected && expected !== fp0 && !isSyntheticReadTool(call.tool)) {
    return {
      callId: call.id,
      tool: call.tool,
      status: 'error',
      error: {
        code: 'STATE_CONFLICT',
        message: `Revision esperada ${expected}, actual ${fp0}`,
      },
      stateRevision: fp0,
    }
  }

  const esquema = (tienda.registroComandos?.get?.(call.tool) as { schema?: Record<string, unknown> } | undefined)?.schema
  const args = stripInternalArgs(call.tool, call.arguments, esquema)

  if (isSyntheticReadTool(call.tool)) {
    const syn = syntheticReadResult(call.tool, args, st0)
    if ('data' in syn) {
      return { callId: call.id, tool: call.tool, status: 'success', data: syn.data, stateRevision: fp0 }
    }
    return { callId: call.id, tool: call.tool, status: 'error', error: syn.error, stateRevision: fp0 }
  }

  // Política fail-closed antes de cualquier handler (registry o switch legacy).
  const gate = gateAgentActionExecution(
    { type: call.tool, payload: args },
    { userConfirmed: opts.userConfirmed === true || sourceIsUserConfirmed(opts.source) },
  )
  if (!gate.allow) {
    return {
      callId: call.id,
      tool: call.tool,
      status: 'rejected',
      error: {
        code: gate.reason === 'unclassified' ? 'UNCLASSIFIED' : 'CONFIRMATION_REQUIRED',
        message: gate.message,
      },
      stateRevision: fp0,
    }
  }

  toolRegistry.setContext(tienda.executor, tienda.permisos)
  const def = toolRegistry.get(call.tool)
  const health = toolRegistry.getHealth()
  const isBroken = health.brokenHandlers.includes(call.tool)

  // Handler real (no deferred): preferir registry.execute
  if (def && !isBroken && !opts.porNombre) {
    try {
      const tr = await toolRegistry.execute(call.tool, args, 'ai')
      if (sinHandler(tr.error)) {
        // caer al switch legacy (las acciones del agente sin comando, p. ej. mix.eq)
      } else if (tr.confirmationRequired && !opts.forceApply) {
        return {
          callId: call.id,
          tool: call.tool,
          status: 'rejected',
          error: { code: 'CONFIRMATION_REQUIRED', message: tr.error?.message ?? 'Requiere confirmación' },
          stateRevision: getStateRevision(tienda.obtenerEstado()),
        }
      } else if (tr.confirmationRequired && opts.forceApply && !tienda.registroComandos?.get?.(call.tool)) {
        // Ya confirmado, pero no es un comando de la tienda (acción del agente como track.addVstLayer o
        // mix.eq): la resuelve el ejecutor heredado; ejecutarla como comando daba «Comando no registrado».
      } else if (tr.confirmationRequired && opts.forceApply) {
        // Usuario ya confirmó (Aplicar) — ejecutar Command directo
        const cmd = await tienda.executor.execute(call.tool, args, 'ai')
        return {
          callId: call.id,
          tool: call.tool,
          status: cmd.success ? 'success' : 'error',
          data: cmd.result,
          error: cmd.success
            ? undefined
            : { code: 'CMD', message: String((cmd as { error?: { message?: string } }).error?.message ?? 'Error') },
          stateRevision: getStateRevision(tienda.obtenerEstado()),
        }
      } else if (!tr.success) {
        if (!sinHandler(tr.error)) {
          return {
            callId: call.id,
            tool: call.tool,
            status: 'error',
            error: { code: tr.error?.code ?? 'TOOL_ERROR', message: tr.error?.message ?? 'Error' },
            stateRevision: getStateRevision(tienda.obtenerEstado()),
          }
        }
      } else {
        return {
          callId: call.id,
          tool: call.tool,
          status: 'success',
          data: conAvisos(tr.data, tr.events),
          stateRevision: getStateRevision(tienda.obtenerEstado()),
        }
      }
    } catch (e) {
      return {
        callId: call.id,
        tool: call.tool,
        status: 'error',
        error: { code: 'TOOL_THROW', message: e instanceof Error ? e.message : String(e) },
        stateRevision: getStateRevision(tienda.obtenerEstado()),
      }
    }
  }

  // Legacy: switch executeDawActions (congelado — no añadir cases nuevos para el loop)
  let payload = args
  if (
    opts.forceApply &&
    (call.tool === 'daw.musicBuild' ||
      call.tool === 'daw.composeProject' ||
      call.tool === 'daw.generateMidiSong' ||
      call.tool === 'daw.wipeProject')
  ) {
    payload = { ...args, aplicar: true, apply: true }
  }
  const actions: DawAction[] = [{ type: call.tool, payload }]
  const results = await executeDawActions(tienda, actions, {
    agentMode: opts.agentMode,
    forceApply: opts.forceApply ?? true,
    source: opts.source ?? 'model_actions',
    conversationId: opts.conversationId,
    messageId: opts.messageId,
    skipWorkPlan: true,
    respectModeGate: false,
    userConfirmed: opts.userConfirmed,
  })
  const r = results[0]
  return {
    callId: call.id,
    tool: call.tool,
    status: r?.success ? 'success' : 'error',
    data: r?.data,
    error: r?.success ? undefined : { code: 'EXECUTE', message: r?.message ?? 'Error' },
    stateRevision: getStateRevision(tienda.obtenerEstado()),
  }
}

export async function runRegisteredTools(
  tienda: TiendaDAW,
  calls: AgentLoopToolCall[],
  opts: RunRegisteredToolOpts = {},
): Promise<AgentLoopToolResult[]> {
  const out: AgentLoopToolResult[] = []
  const done = new Set(opts.executedCallIds ?? [])
  for (const c of calls) {
    const r = await runRegisteredTool(tienda, c, { ...opts, executedCallIds: done })
    out.push(r)
    if (r.status === 'success') done.add(c.id)
  }
  return out
}
