/**
 * Producción de un tema de worship de principio a fin con el compositor determinista + mezcla por medición.
 *
 * Fases: planificación (spec) → composición (+ validación) → pistas y clips (comandos con undo) →
 * instrumentos (un VST3 independiente por rol) → mezcla (balance por rol medido, paneo, master a −14 LUFS
 * con techo de true-peak). La ejecución y la medición se inyectan: en la app van por `executeDawActions`
 * (permisos y auditoría) y `analysis.mix`; en los tests por el ejecutor directo y un proveedor simulado.
 * Si no hay medición disponible la fase de mezcla lo dice: nunca da por aprobado lo que no midió.
 */

import {
  ROLES_WORSHIP,
  arregloAComandos,
  componerWorship,
  idPistaWorship,
  resumenArreglo,
  validarArregloWorship,
  type ArregloWorship,
  type EstiloWorship,
  type OpcionesComandosWorship,
  type RolWorship,
  type SpecWorship,
} from '../../../shared/src/music/worship'

export type AccionBuild = { type: string; payload: Record<string, unknown> }
export type ResultadoAccionBuild = { type: string; success: boolean; message?: string; data?: unknown }
export type EjecutarAcciones = (acciones: AccionBuild[]) => Promise<ResultadoAccionBuild[]>

export type MedicionMezcla = {
  pistas: Array<{ trackId: string; integrated: number }>
  master: { integrated: number; truePeakDb: number }
}
export type MedirMezcla = () => Promise<MedicionMezcla | null>

export type FaseBuild = 'planificacion' | 'composicion' | 'pistas' | 'instrumentos' | 'mezcla' | 'qa' | 'completado' | 'error'
export type PasoBuild = { fase: FaseBuild; mensaje: string; detalle?: string; progreso: number }

/** Un VST3 independiente por instrumento (nombres tal y como los publica cada plugin). */
export const PLUGIN_POR_ROL: Record<RolWorship, string> = {
  piano: 'JasWave Grand Piano',
  pad: 'JasWave Shimmer Pad',
  cuerdas: 'JasWave Strings Section',
  bajo: 'JasWave Electric Bass',
  bateria: 'JasWave Worship Drums',
  guitarra: 'JasWave Electric Guitar',
  melodia: 'JasWave Grand Piano',
}

/** Loudness integrado objetivo de cada pista medida en solitario (LUFS) para un balance de worship moderno. */
/**
 * Piano y melodía a la par o por encima del bajo (el bajo profundo pesa mucho en LUFS por su energía grave y no necesita
 * más presencia: con el piano 3 dB por debajo se confundía con un bajo eléctrico).
 * En worship moderno la batería y la guitarra eléctrica mandan, con el pad detrás; piano, bajo y cuerdas son la base.
 */
export const OBJETIVO_LUFS_POR_ROL: Record<RolWorship, number> = {
  bateria: -21,
  guitarra: -22,
  melodia: -22,
  piano: -23.5,
  bajo: -24,
  pad: -27,
  cuerdas: -30,
}

export const PAN_POR_ROL: Record<RolWorship, number> = {
  bateria: 0,
  bajo: 0,
  melodia: 0,
  piano: -0.18,
  guitarra: 0.28,
  cuerdas: 0.1,
  pad: 0,
}

export const OBJETIVO_MASTER_LUFS = -14
export const TECHO_TRUE_PEAK_DBTP = -1

export type AjusteBalance = { trackId: string; rol: RolWorship; medidoLufs: number; objetivoLufs: number; deltaDb: number }

/**
 * Ajustes de ganancia para acercar cada pista a su objetivo. Pura. Omite pistas silenciosas (nada que medir)
 * y las que ya están dentro de la tolerancia; acota el paso para no dar saltos bruscos entre rondas.
 */
export function calcularAjustesBalance(
  medicion: MedicionMezcla,
  rolPorPista: Record<string, RolWorship>,
  opciones: { tolerancia?: number; maxPaso?: number; objetivos?: Record<RolWorship, number> } = {},
): AjusteBalance[] {
  const tolerancia = opciones.tolerancia ?? 1.0
  const maxPaso = opciones.maxPaso ?? 9
  const objetivos = opciones.objetivos ?? OBJETIVO_LUFS_POR_ROL
  const ajustes: AjusteBalance[] = []
  for (const m of medicion.pistas) {
    const rol = rolPorPista[m.trackId]
    if (!rol) continue
    if (!Number.isFinite(m.integrated) || m.integrated < -70) continue // silenciosa: no se puede balancear
    const objetivoLufs = objetivos[rol]
    const delta = objetivoLufs - m.integrated
    if (Math.abs(delta) <= tolerancia) continue
    ajustes.push({ trackId: m.trackId, rol, medidoLufs: m.integrated, objetivoLufs, deltaDb: Math.max(-maxPaso, Math.min(maxPaso, delta)) })
  }
  return ajustes
}

export type InformeMezcla = {
  medible: boolean
  rondas: number
  ajustes: AjusteBalance[]
  master?: { integrated: number; truePeakDb: number }
  cumpleLoudness?: boolean
  cumpleTruePeak?: boolean
  notas: string[]
}

export type ResultadoProduccion = {
  arreglo: ArregloWorship
  resumen: string
  problemasValidacion: string[]
  pistas: Array<{ rol: RolWorship; trackId: string; plugin?: string; instrumentoCargado: boolean; detalle?: string }>
  mezcla?: InformeMezcla
  errores: string[]
}

export type OpcionesProduccion = {
  ejecutar: EjecutarAcciones
  medir?: MedirMezcla
  /** Volumen lineal actual de una pista (para aplicar deltas en dB). */
  leerVolumen: (trackId: string) => number
  pluginPorRol?: Partial<Record<RolWorship, string>>
  /** Asignar un VST a cada pista (false = solo MIDI). */
  instrumentos?: boolean
  mezcla?: boolean
  objetivoLufs?: number
  techoDbtp?: number
  rondasBalance?: number
  onPaso?: (p: PasoBuild) => void
  signal?: AbortSignal
  /** Colocación de los comandos: continuar tras contenido existente (`inicioBeat`), prefijo de ids, no tocar tempo/tonalidad. */
  colocacion?: Pick<OpcionesComandosWorship, 'inicioBeat' | 'prefijoId' | 'ajustarBpm' | 'ajustarTonalidad'>
}

/**
 * El agente audiciona por defecto cada clip MIDI que crea (arrancaría la reproducción una vez por rol). Los
 * envoltorios que ejecutan por `executeDawActions` aplican esto; el comando directo no admite `audition`.
 */
export function sinAudicion(acciones: AccionBuild[]): AccionBuild[] {
  return acciones.map((a) => (a.type === 'midi.clip.create' ? { ...a, payload: { ...a.payload, audition: false } } : a))
}

const aDb = (lineal: number) => 20 * Math.log10(Math.max(lineal, 1e-6))
const aLineal = (db: number) => Math.pow(10, db / 20)

function abortado(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

/** Deriva una spec del texto del usuario (tonalidad, tempo, estilo y semilla estable si no se indica). */
export function especDesdePrompt(prompt: string, semillaExplicita?: number): SpecWorship {
  const t = prompt.toLowerCase()
  const spec: SpecWorship = { semilla: semillaExplicita ?? hashTexto(prompt), humanizacion: 0.65 }
  const bpm = /(\d{2,3})\s*bpm/.exec(t)
  if (bpm) spec.bpm = Math.max(50, Math.min(140, Number(bpm[1])))
  const notas: Array<[RegExp, NonNullable<SpecWorship['tonalidad']>['raiz']]> = [
    [/\b(?:re|d)\s+(?:mayor|major)\b/, 'D'],
    [/\b(?:do|c)\s+(?:mayor|major)\b/, 'C'],
    [/\b(?:sol|g)\s+(?:mayor|major)\b/, 'G'],
    [/\b(?:la|a)\s+(?:mayor|major)\b/, 'A'],
    [/\b(?:mi|e)\s+(?:mayor|major)\b/, 'E'],
  ]
  for (const [re, raiz] of notas) if (re.test(t)) spec.tonalidad = { raiz, escala: 'mayor' }
  const estilo: EstiloWorship | undefined = /ambient|ambiental|atmosf/.test(t) ? 'ambient' : /anthem|himno|épico|epico|grande/.test(t) ? 'anthem' : /balada|ballad|íntimo|intimo/.test(t) ? 'ballad' : undefined
  if (estilo) spec.estilo = estilo
  const compas = /6\s*\/\s*8/.test(t)
  if (compas) spec.compas = '6/8'
  return spec
}

function hashTexto(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 1_000_000
}

export async function producirWorship(spec: SpecWorship, o: OpcionesProduccion): Promise<ResultadoProduccion> {
  const paso = (fase: FaseBuild, mensaje: string, progreso: number, detalle?: string) => o.onPaso?.({ fase, mensaje, progreso, detalle })
  const errores: string[] = []

  paso('planificacion', 'Definiendo tonalidad, tempo y forma del tema', 5)
  const arreglo = componerWorship(spec)
  const validacion = validarArregloWorship(arreglo)
  const resumen = resumenArreglo(arreglo)
  paso('composicion', `Composición lista: ${arreglo.secciones.length} secciones, ${arreglo.totalCompases} compases a ${arreglo.bpm} BPM`, 15, resumen)
  if (!validacion.ok) {
    errores.push(...validacion.problemas.map((p) => `Validación: ${p}`))
    paso('error', 'El arreglo generado no pasa la validación', 15, validacion.problemas.join('\n'))
    return { arreglo, resumen, problemasValidacion: validacion.problemas, pistas: [], errores }
  }
  if (abortado(o.signal)) return { arreglo, resumen, problemasValidacion: [], pistas: [], errores: ['Cancelado'] }

  // ── pistas y clips (comandos con undo) ──────────────────────────────────────
  paso('pistas', 'Creando pistas y clips MIDI', 25)
  const nombres = { ...PLUGIN_POR_ROL, ...(o.pluginPorRol ?? {}) }
  const acciones = arregloAComandos(arreglo, { tipoPista: 'instrumento', nombrePluginPorRol: nombres, ...(o.colocacion ?? {}) })
  const aEjecutar: AccionBuild[] = acciones.map((a) => ({ type: a.type, payload: a.payload as Record<string, unknown> }))
  const res = await o.ejecutar(aEjecutar)
  const fallidas = res.filter((r) => !r.success)
  for (const f of fallidas) errores.push(`${f.type}: ${f.message ?? 'falló'}`)
  if (fallidas.some((f) => f.type === 'track.create' || f.type === 'midi.clip.create')) {
    paso('error', 'No se pudieron crear todas las pistas/clips', 30, errores.join('\n'))
    return { arreglo, resumen, problemasValidacion: [], pistas: [], errores }
  }

  const roles = ROLES_WORSHIP.filter((r) => arreglo.partes[r].length > 0)
  const rolPorPista: Record<string, RolWorship> = {}
  const pistas: ResultadoProduccion['pistas'] = roles.map((rol) => {
    const trackId = idPistaWorship(arreglo, rol, o.colocacion?.prefijoId)
    rolPorPista[trackId] = rol
    return { rol, trackId, instrumentoCargado: false }
  })

  // ── instrumentos: un VST3 por rol ─────────────────────────────────────────────
  if (o.instrumentos !== false) {
    paso('instrumentos', 'Cargando un instrumento VST3 independiente en cada pista', 40)
    for (const p of pistas) {
      if (abortado(o.signal)) break
      const plugin = nombres[p.rol]
      p.plugin = plugin
      const [r] = await o.ejecutar([{ type: 'plugin.insert', payload: { trackId: p.trackId, nombre: plugin } }])
      p.instrumentoCargado = r?.success === true
      if (!p.instrumentoCargado) {
        p.detalle = r?.message
        errores.push(`Instrumento «${plugin}» en ${p.rol}: ${r?.message ?? 'no se pudo insertar (¿está instalado y escaneado?)'}`)
      }
    }
  }

  // ── mezcla por medición ───────────────────────────────────────────────────────
  let mezcla: InformeMezcla | undefined
  if (o.mezcla !== false && !abortado(o.signal)) {
    mezcla = await mezclarPorMedicion(rolPorPista, o, paso)
    errores.push(...mezcla.notas.filter((n) => n.startsWith('⚠')))
  }

  const ok = errores.length === 0
  paso(ok ? 'completado' : 'error', ok ? 'Producción completada' : 'Producción terminada con avisos', 100, errores.join('\n') || undefined)
  return { arreglo, resumen, problemasValidacion: [], pistas, mezcla, errores }
}

async function mezclarPorMedicion(
  rolPorPista: Record<string, RolWorship>,
  o: OpcionesProduccion,
  paso: (f: FaseBuild, m: string, p: number, d?: string) => void,
): Promise<InformeMezcla> {
  const informe: InformeMezcla = { medible: false, rondas: 0, ajustes: [], notas: [] }
  paso('mezcla', 'Balanceando por rol, paneo y master', 60)

  // Paneo por rol (no depende de medir)
  const pan = Object.entries(rolPorPista).map(([trackId, rol]) => ({ type: 'pista.pan', payload: { trackId, pan: PAN_POR_ROL[rol] } }))
  await o.ejecutar(pan)

  if (!o.medir) {
    informe.notas.push('⚠ Sin medición disponible: balance y master no se ajustaron (no se da por aprobada la mezcla)')
    return informe
  }
  const rondas = o.rondasBalance ?? 3
  for (let i = 0; i < rondas; i++) {
    if (abortado(o.signal)) break
    const medicion = await o.medir()
    if (!medicion) {
      informe.notas.push('⚠ El motor de análisis no devolvió medidas: no se pudo balancear')
      return informe
    }
    informe.medible = true
    const ajustes = calcularAjustesBalance(medicion, rolPorPista)
    if (ajustes.length === 0) break
    informe.rondas++
    informe.ajustes.push(...ajustes)
    await o.ejecutar(
      ajustes.map((a) => ({
        type: 'track.update',
        payload: { trackId: a.trackId, datos: { volumen: Math.min(4, Math.max(0.001, aLineal(aDb(o.leerVolumen(a.trackId)) + a.deltaDb))) } },
      })),
    )
    paso('mezcla', `Ronda de balance ${informe.rondas}: ${ajustes.length} pistas ajustadas`, 60 + informe.rondas * 8)
  }

  // Master: loudness objetivo y techo de true-peak medidos
  const objetivo = o.objetivoLufs ?? OBJETIVO_MASTER_LUFS
  const techo = o.techoDbtp ?? TECHO_TRUE_PEAK_DBTP
  paso('qa', `Ajustando el master a ${objetivo} LUFS con techo ${techo} dBTP`, 90)
  let objetivoActual = objetivo
  for (let i = 0; i < 4; i++) {
    const r = await o.ejecutar([{ type: 'master.normalizar', payload: { objetivoLufs: objetivoActual } }])
    if (!r[0]?.success) {
      informe.notas.push(`⚠ master.normalizar falló: ${r[0]?.message ?? 'sin detalle'}`)
      break
    }
    const m = await o.medir()
    if (!m) break
    informe.master = m.master
    const exceso = m.master.truePeakDb - techo
    if (exceso > 0.1) {
      objetivoActual -= exceso + 0.2 // el pico manda: se baja el loudness objetivo lo justo
      continue
    }
    break
  }
  if (informe.master) {
    informe.cumpleTruePeak = informe.master.truePeakDb <= techo + 0.1
    informe.cumpleLoudness = Math.abs(informe.master.integrated - objetivo) <= 1.5
    if (!informe.cumpleTruePeak) informe.notas.push(`⚠ True-peak medido ${informe.master.truePeakDb.toFixed(1)} dBTP por encima del techo ${techo} dBTP: hace falta un limitador en el master`)
    if (!informe.cumpleLoudness) informe.notas.push(`Loudness medido ${informe.master.integrated.toFixed(1)} LUFS (objetivo ${objetivo}); con el techo de pico el master queda más bajo`)
  }
  return informe
}
