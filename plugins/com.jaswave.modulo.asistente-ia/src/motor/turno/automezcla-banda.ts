/**
 * Mezcla inicial determinista de la banda (plan T): aplica con los comandos reales el plan de
 * `planificarAutomezcla` (shared) ANTES de la etapa de mezcla del modelo, que pasa a solo afinar.
 *
 *  - Volumen y paneo: `track.update` (con undo). Filtros y EQ: `mix.eq accion:"ajustar" banda:N` (un slot fijo por
 *    función, así repetirlo no apila bandas). Dinámica por sección: `automation.setCurve parametro:"volumen"`.
 *    Reverb corta: un solo bus «Reverb corta» (`bus.create` + `plugin.insert`) y `send.set` por pista.
 *  - Idempotente: `MemoriaAutomezcla` recuerda lo aplicado; aplicarla otra vez con las mismas pistas no cambia nada.
 *  - Reversible: `revertirAutomezcla` devuelve volumen/paneo, quita las bandas, las curvas y los envíos que puso.
 *  - Medición: una sola `analysis.mix` con tope de tiempo (60 s); si falla o tarda más, usa valores por rol y avisa.
 *    No toca pistas con automatización de volumen del usuario ni pistas silenciadas por el usuario.
 */
import { PERFIL_MEZCLA_DEFECTO, clasificarRolMezcla, describirPerfilMezcla, planificarAutomezcla } from '@jaswave/host-sdk'
import type { PerfilMezcla, PistaAutomezcla, PlanMezcla, SeccionMezcla, TiendaDAW } from '@jaswave/host-sdk'

export const MAX_MS_MEDICION_AUTOMEZCLA = 60_000
export const NOMBRE_BUS_REVERB = 'Reverb corta'
export const PLUGIN_REVERB = 'JasWave Ambience'

export type ResultadoComando = { ok: boolean; mensaje?: string; datos?: unknown }
export type EjecutarMezcla = (nombre: string, args: Record<string, unknown>) => Promise<ResultadoComando>

/** Lo que hay que saber de una medición para planificar: stems POST-FADER y la suma antes del máster. */
export type MedicionAutomezcla = {
  pistas: Array<{ trackId: string; rmsDb?: number; picoDb?: number; bandasDb?: number[] }>
  suma?: { crestDb?: number; bandasDb?: number[] }
}

export type MemoriaAutomezcla = {
  /** Firma de las pistas sobre las que ya se aplicó. */
  firma?: string
  /** Estado de antes, para revertir. */
  antes?: Array<{ id: string; volumen: number; paneo: number }>
  eq: Map<string, string>
  curvas: Map<string, string>
  envios: Set<string>
  busId?: string
  masterEq: string
  /** Perfil de estilo aplicado (el máster mínimo usa su LUFS y su techo). */
  perfil?: PerfilMezcla
}
export const nuevaMemoriaAutomezcla = (): MemoriaAutomezcla => ({ eq: new Map(), curvas: new Map(), envios: new Set(), masterEq: '' })

export type ResultadoAutomezcla = {
  ok: boolean
  /** true si se aplicó algo en esta llamada. */
  aplicada: boolean
  cambios: number
  resumen: string
  notas: string[]
  plan?: PlanMezcla
  medido: boolean
  /** Nombre del perfil de estilo aplicado y su descripción para el modelo de mezcla. */
  perfil?: string
  guion?: string
}

type PistaEstado = {
  id: string
  nombre: string
  tipo?: string
  volumen?: number
  paneo?: number
  silenciada?: boolean
  clips?: unknown[]
  plugins?: Array<{ nombre?: string }>
  automatizaciones?: Array<{ parametro?: string; puntos?: unknown[] }>
}

async function conLimite<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<null>((ok) => (t = setTimeout(() => ok(null), ms)))])
  } finally {
    if (t) clearTimeout(t)
  }
}

const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
const bandasDeMedida = (m: { bandasAgregadas?: Array<{ db?: number }> } | undefined): number[] | undefined => {
  const b = m?.bandasAgregadas
  return Array.isArray(b) && b.length >= 6 ? b.slice(0, 6).map((x) => (Number.isFinite(x?.db) ? (x.db as number) : -120)) : undefined
}

/**
 * Medición para la mezcla inicial: un `analysis.mix` (stems post-fader + suma) con tope de tiempo. Guarda el último
 * resultado por huella del proyecto, de modo que repetirla sin cambios no renderiza otra vez. Si no hay medición, null.
 */
export function medidorAutomezcla(
  tienda: TiendaDAW,
  opts: { huella: (st: ReturnType<TiendaDAW['obtenerEstado']>) => string; maxMs?: number; pausar?: () => Promise<void>; reanudar?: () => void },
): () => Promise<MedicionAutomezcla | null> {
  let guardada: { huella: string; m: MedicionAutomezcla } | null = null
  return async () => {
    const huella = opts.huella(tienda.obtenerEstado())
    if (guardada?.huella === huella) return guardada.m
    const medir = async (): Promise<MedicionAutomezcla | null> => {
      await opts.pausar?.()
      try {
        const r = await tienda.executor.execute('analysis.mix', {})
        const res = r.result as { pistas?: Array<Record<string, unknown>>; suma?: Record<string, unknown> } | undefined
        if (!r.success || !Array.isArray(res?.pistas)) return null
        const m: MedicionAutomezcla = {
          pistas: res!.pistas!.map((p) => ({
            trackId: String(p.trackId),
            rmsDb: num(p.rmsDb),
            picoDb: num(p.peakDb),
            bandasDb: bandasDeMedida(p as { bandasAgregadas?: Array<{ db?: number }> }),
          })),
          ...(res!.suma ? { suma: { crestDb: num(res!.suma.crestFactorDb), bandasDb: bandasDeMedida(res!.suma as { bandasAgregadas?: Array<{ db?: number }> }) } } : {}),
        }
        return m
      } catch {
        return null
      } finally {
        opts.reanudar?.()
      }
    }
    const m = await conLimite(medir(), opts.maxMs ?? MAX_MS_MEDICION_AUTOMEZCLA)
    if (m) guardada = { huella, m }
    return m
  }
}

function pistasDeMusica(tienda: TiendaDAW): PistaEstado[] {
  const tracks = (tienda.obtenerEstado().project?.tracks ?? []) as unknown as PistaEstado[]
  return tracks.filter((t) => (t.tipo === 'audio' || t.tipo === 'midi' || t.tipo === 'instrumento') && ((t.clips ?? []).length > 0 || (t.plugins ?? []).length > 0))
}

const firmaDePistas = (ps: PistaEstado[]) => ps.map((p) => `${p.id}:${clasificarRolMezcla(p.nombre, (p.plugins ?? []).map((x) => x.nombre ?? ''))}`).join('|')
const firmaBanda = (b: unknown) => JSON.stringify(b)

export type OpcionesAplicarAutomezcla = {
  tienda: TiendaDAW
  ejecutar: EjecutarMezcla
  /** Medición (puede devolver null o tardar: ya lleva su tope). Sin ella, se usan valores por rol. */
  medir?: () => Promise<MedicionAutomezcla | null>
  /** Secciones de la hoja de ruta y compás, para la dinámica por sección. */
  hoja?: { secciones: SeccionMezcla[]; bpm?: number; numerador?: number }
  memoria: MemoriaAutomezcla
  /** Perfil de estilo (por defecto el worship moderno). */
  perfil?: PerfilMezcla
  /** Tope de espera de la medición (ms); por defecto el del medidor. */
  maxMsMedicion?: number
  signal?: AbortSignal
}

/** Aplica la mezcla inicial. Nunca lanza: devuelve ok=false con el motivo. */
export async function aplicarAutomezcla(o: OpcionesAplicarAutomezcla): Promise<ResultadoAutomezcla> {
  const { tienda, ejecutar, memoria } = o
  const notas: string[] = []
  try {
    const musica = pistasDeMusica(tienda)
    if (!musica.length) return { ok: true, aplicada: false, cambios: 0, resumen: 'Mezcla inicial: no hay pistas con música que mezclar.', notas, medido: false }
    const firma = firmaDePistas(musica)
    if (memoria.firma === firma) return { ok: true, aplicada: false, cambios: 0, resumen: 'Mezcla inicial: ya estaba aplicada (sin cambios).', notas, medido: true }

    let medicion: MedicionAutomezcla | null = null
    if (o.medir) {
      try {
        medicion = await conLimite(o.medir(), o.maxMsMedicion ?? MAX_MS_MEDICION_AUTOMEZCLA + 5_000)
      } catch {
        medicion = null
      }
      if (!medicion) notas.push('La medición tardó demasiado o falló: se usaron niveles típicos por rol.')
    }
    if (o.signal?.aborted) return { ok: false, aplicada: false, cambios: 0, resumen: 'Mezcla inicial cancelada.', notas, medido: false }

    const entrada: PistaAutomezcla[] = musica.map((p) => {
      const m = medicion?.pistas.find((x) => x.trackId === p.id)
      const rms = m?.rmsDb
      return {
        id: p.id,
        nombre: p.nombre,
        plugins: (p.plugins ?? []).map((x) => x.nombre ?? ''),
        volumen: Number(p.volumen ?? 1) > 0 ? Number(p.volumen ?? 1) : 1,
        paneo: Number(p.paneo ?? 0),
        medicion: m && Number.isFinite(rms) && (rms as number) > -70 ? { rmsDb: rms, picoDb: m.picoDb, bandasDb: m.bandasDb } : null,
      }
    })
    memoria.perfil = o.perfil
    const plan = planificarAutomezcla(entrada, {
      ...(o.perfil ? { perfil: o.perfil } : {}),
      ...(medicion?.suma?.crestDb != null && medicion.suma.crestDb > 3 ? { crestaSumaDb: medicion.suma.crestDb } : {}),
      ...(medicion?.suma?.bandasDb ? { sumaBandasDb: medicion.suma.bandasDb } : {}),
      ...(o.hoja?.secciones?.length ? { secciones: o.hoja.secciones, bpm: o.hoja.bpm ?? Number(tienda.obtenerEstado().project?.bpm ?? 0), numerador: o.hoja.numerador ?? 4 } : {}),
    })
    notas.push(...plan.notas)

    let cambios = 0
    const fallos: string[] = []
    const intentar = async (etiqueta: string, nombre: string, args: Record<string, unknown>): Promise<ResultadoComando> => {
      try {
        const r = await ejecutar(nombre, args)
        if (r.ok) cambios++
        else fallos.push(`${etiqueta}: ${String(r.mensaje ?? 'error').slice(0, 100)}`)
        return r
      } catch (e) {
        fallos.push(`${etiqueta}: ${e instanceof Error ? e.message : String(e)}`)
        return { ok: false }
      }
    }

    // Guardar el estado de antes SOLO la primera vez (revertir vuelve al original aunque se aplique varias veces).
    memoria.antes ??= musica.map((p) => ({ id: p.id, volumen: Number(p.volumen ?? 1), paneo: Number(p.paneo ?? 0) }))

    // 1. Volumen y paneo (se saltan las pistas silenciadas por el usuario: no se las despierta).
    for (const pp of plan.pistas) {
      if (o.signal?.aborted) break
      const actual = musica.find((x) => x.id === pp.id)!
      if (actual.silenciada) {
        notas.push(`«${pp.nombre}» está silenciada: no se tocó.`)
        continue
      }
      const datos: Record<string, number> = {}
      if (Math.abs(Number(actual.volumen ?? 1) - pp.volumen) > 0.004) datos.volumen = pp.volumen
      if (Math.abs(Number(actual.paneo ?? 0) - pp.paneo) > 0.004) datos.paneo = pp.paneo
      if (Object.keys(datos).length) await intentar(`${pp.nombre} volumen/paneo`, 'track.update', { trackId: pp.id, datos })
    }

    // 2. EQ por pista (slot fijo por función: el mismo ajuste dos veces no apila bandas).
    for (const pp of plan.pistas) {
      for (const b of pp.eq) {
        if (o.signal?.aborted) break
        const clave = `${pp.id}#${b.slot}`
        const f = firmaBanda(b)
        if (memoria.eq.get(clave) === f) continue
        const r = await intentar(`${pp.nombre} EQ banda ${b.slot}`, 'mix.eq', {
          trackId: pp.id,
          accion: 'ajustar',
          banda: b.slot,
          tipo: b.tipo,
          freq: b.freq,
          gain: b.gain,
          q: b.q,
          ...(b.pendiente ? { pendiente: b.pendiente } : {}),
        })
        if (r.ok) memoria.eq.set(clave, f)
      }
    }

    // 3. EQ ancho del máster (segundo paso del balance espectral).
    const fm = firmaBanda(plan.master.eq)
    if (plan.master.eq.length && memoria.masterEq !== fm) {
      let ok = true
      for (const b of plan.master.eq) {
        const r = await intentar(`máster EQ banda ${b.slot}`, 'mix.eq', {
          trackId: 'master',
          accion: 'ajustar',
          banda: b.slot,
          tipo: b.tipo,
          freq: b.freq,
          gain: b.gain,
          q: b.q,
          ...(b.pendiente ? { pendiente: b.pendiente } : {}),
        })
        ok = ok && r.ok
      }
      if (ok) memoria.masterEq = fm
    }

    // 4. Dinámica por sección (volumen automatizado). No se pisa la automatización del usuario.
    for (const pp of plan.pistas) {
      if (!pp.curvaVolumen || o.signal?.aborted) continue
      const actual = musica.find((x) => x.id === pp.id)!
      const f = firmaBanda(pp.curvaVolumen)
      if (memoria.curvas.get(pp.id) === f) continue
      const propia = (actual.automatizaciones ?? []).find((a) => a.parametro === 'volumen' && (a.puntos ?? []).length > 0)
      if (propia && !memoria.curvas.has(pp.id)) {
        notas.push(`«${pp.nombre}» ya tiene automatización de volumen: se respetó.`)
        continue
      }
      const r = await intentar(`${pp.nombre} dinámica por sección`, 'automation.setCurve', { trackId: pp.id, parametro: 'volumen', puntos: pp.curvaVolumen.map((p) => ({ tiempo: p.tiempo, valor: p.valor, tipoCurva: 'lineal' })) })
      if (r.ok) memoria.curvas.set(pp.id, f)
    }

    // 5. Reverb corta: un solo bus con su reverb; los envíos solo si la reverb quedó cargada.
    const conEnvio = plan.pistas.filter((p) => p.envioReverb > 0)
    if (conEnvio.length && !o.signal?.aborted) {
      const busId = await asegurarBusReverb(tienda, memoria, intentar, notas)
      if (busId) {
        for (const pp of conEnvio) {
          const clave = `${pp.id}>${busId}:${pp.envioReverb}`
          if (memoria.envios.has(clave)) continue
          const r = await intentar(`${pp.nombre} envío a la reverb`, 'send.set', { trackId: pp.id, busId, amount: pp.envioReverb })
          if (r.ok) memoria.envios.add(clave)
        }
      }
    }

    if (fallos.length) notas.push(`No se pudo: ${fallos.slice(0, 4).join('; ')}${fallos.length > 4 ? `; y ${fallos.length - 4} más` : ''}.`)
    memoria.firma = firma
    const medidas = plan.pistas.filter((p) => p.origen === 'medido').length
    const pct = (x: number) => `${Math.round(x * 100)} %`
    const resumen = [
      `Mezcla inicial determinista: ${plan.pistas.length} pistas (${medidas} con medición, ${plan.pistas.length - medidas} por rol), ${cambios} cambios.`,
      `Suma estimada ${plan.sumaRmsDb} dBFS RMS, pico ≈ ${plan.picoSumaDb} dBFS.`,
      `Graves ${plan.espectroAntes ? `${pct(plan.espectroAntes.graves)} → ` : ''}${pct(plan.espectroDespues.graves)}, medios ${plan.espectroAntes ? `${pct(plan.espectroAntes.medios)} → ` : ''}${pct(plan.espectroDespues.medios)}.`,
      ...(notas.length ? [notas.slice(0, 4).join(' ')] : []),
    ].join(' ')
    return { ok: fallos.length === 0 || cambios > 0, aplicada: cambios > 0, cambios, resumen, notas, plan, medido: !!medicion, perfil: plan.perfil.nombre, guion: describirPerfilMezcla(o.perfil ?? PERFIL_MEZCLA_DEFECTO) }
  } catch (e) {
    return { ok: false, aplicada: false, cambios: 0, resumen: `No se pudo aplicar la mezcla inicial: ${e instanceof Error ? e.message : String(e)}`, notas, medido: false }
  }
}

async function asegurarBusReverb(
  tienda: TiendaDAW,
  memoria: MemoriaAutomezcla,
  intentar: (etiqueta: string, nombre: string, args: Record<string, unknown>) => Promise<ResultadoComando>,
  notas: string[],
): Promise<string | null> {
  const buscar = () => ((tienda.obtenerEstado().project?.tracks ?? []) as unknown as PistaEstado[]).find((t) => t.tipo === 'bus' && t.nombre === NOMBRE_BUS_REVERB)
  let bus = buscar()
  if (!bus) {
    const r = await intentar('bus de reverb', 'bus.create', { nombre: NOMBRE_BUS_REVERB, tipo: 'fx' })
    bus = buscar()
    if (!bus && r.ok) {
      const id = (r.datos as { busId?: string } | undefined)?.busId
      if (id) bus = { id, nombre: NOMBRE_BUS_REVERB, plugins: [] }
    }
  }
  if (!bus) {
    notas.push('No se pudo crear el bus de reverb: sin envíos.')
    return null
  }
  memoria.busId = bus.id
  if (!(bus.plugins ?? []).length) {
    const r = await intentar('reverb del bus', 'plugin.insert', { trackId: bus.id, nombre: PLUGIN_REVERB })
    if (!r.ok) {
      notas.push(`El bus «${NOMBRE_BUS_REVERB}» no tiene reverb (${PLUGIN_REVERB} no se pudo cargar): sin envíos para no sumar señal seca.`)
      return null
    }
  }
  return bus.id
}

/** Deshace la mezcla inicial: fader y paneo originales, bandas de EQ, curvas y envíos puestos por ella. */
export async function revertirAutomezcla(ejecutar: EjecutarMezcla, memoria: MemoriaAutomezcla): Promise<{ ok: boolean; cambios: number }> {
  let cambios = 0
  let ok = true
  const probar = async (nombre: string, args: Record<string, unknown>) => {
    try {
      const r = await ejecutar(nombre, args)
      if (r.ok) cambios++
      else ok = false
    } catch {
      ok = false
    }
  }
  for (const a of memoria.antes ?? []) await probar('track.update', { trackId: a.id, datos: { volumen: a.volumen, paneo: a.paneo } })
  for (const clave of memoria.eq.keys()) {
    const [trackId, slot] = clave.split('#')
    await probar('mix.eq', { trackId, accion: 'quitarBanda', banda: Number(slot) })
  }
  if (memoria.masterEq) for (const b of JSON.parse(memoria.masterEq) as Array<{ slot: number }>) await probar('mix.eq', { trackId: 'master', accion: 'quitarBanda', banda: b.slot })
  for (const id of memoria.curvas.keys()) await probar('automation.clear', { trackId: id, parametro: 'volumen' })
  for (const e of memoria.envios) {
    const [trackId, resto] = e.split('>')
    await probar('send.set', { trackId, busId: String(resto).split(':')[0], amount: 0, activo: false })
  }
  memoria.eq.clear()
  memoria.curvas.clear()
  memoria.envios.clear()
  memoria.masterEq = ''
  memoria.firma = undefined
  memoria.antes = undefined
  return { ok, cambios }
}
