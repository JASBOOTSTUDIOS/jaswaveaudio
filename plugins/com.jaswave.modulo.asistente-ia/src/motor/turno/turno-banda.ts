/**
 * Turno «banda» (G8): la producción completa la hace un equipo de agentes reales por etapas
 * (`ejecutarProduccion`): planificador → director → músicos en paralelo → QA → mezcla → QA → máster → QA.
 *
 * Los participantes son los especialistas activos del usuario (instrucciones, habilidades y grupos de
 * herramientas permitidas). Las escrituras pasan por el motor (permisos, auditoría y un deshacer para
 * todo el turno); lo destructivo no se ejecuta en una producción automática. El QA combina el
 * veredicto de su agente con la medición del DAW (`analysis.mix`).
 */
import { DiarioProduccion, guardarPuntoProyecto, idSeguro, leerProduccion, nuevoRunId, puertoProducciones, restaurarUltimoPunto, NOMBRE_ETAPA, agentActionClass, formatearDuracion, getStateRevision, resumenTiempos, buildReadOnlyProjectContext, diagnosticarSonidoPistas, ejecutarProduccion, limpiarTextoUsuario, medidorMezclaApp, autonomyBlocksMutation } from '@jaswave/host-sdk'
import type {
  ResultadoProduccionAgentes,
  ResumenDiario,
  ArchivoAsistente,
  EtapaMedible,
  EtapaProduccion,
  EventoProduccion,
  HerramientaAgente,
  LlamadaAgente,
  MedicionQA,
  ParticipanteProduccion,
  ResultadoHerramienta,
  RolProduccion,
  TiendaDAW,
  TurnContext,
  TurnProgramOutcome,
} from '@jaswave/host-sdk'

import { iaRemotaDisponible } from '../../ia/transporte-ia'
import type { LegacyTurnContext } from '../agent-legacy-turn'
import { snapshotUndoDepth } from '../agent-turn-undo'
import { patchMessage, type ProgresoAgente, type StoredChatMessage } from '../ai-chat-store'
import { loadAiSettings } from '../ai-settings'
import { orquestadorBandaSingleton } from '../banda-orchestrator'
import { instruccionesConfiguradas } from '../config-agente'
import { describeActionForUser } from '../describe-action'
import { escuchaEnVivo } from '../escucha-en-vivo'
import { instruccionesHabilidadesEspecialista } from '../especialistas-habilidades'
import { cargarEspecialistas, type EspecialistaConfig } from '../especialistas-storage'
import { estiloActivoDelUsuario, habilidadesDelEspecialista, type EstiloUsuario } from '../habilidades-agentes'
import { catalogoAgente, HERRAMIENTAS_BASE, herramientasDeGrupos } from './catalogo-agente'
import { guardarEscrituraLegato } from './legato-banda'
import { coordinarBanda } from './coordinar-banda'
import { crearMemoriaHumanizado, guardarEscrituraHumanizar, nombrarClipGenerico } from './humanizar-banda'
import { ARMONIA_POR_DEFECTO, guardarEscrituraArmonia, tablaArmoniaMusico, tipoDePista, type OpcionesArmonia } from './armonia-banda'
import { analizarCoherencia, diagnosticoEscritura, seccionesFaltantes, type HojaCoherencia } from './coherencia-banda'
import { chatDelMotor, ESPERAS_REINTENTO_BANDA, redDelNavegador, type UltimoErrorIA } from './chat-agente'
import { masterMinimoDeterminista } from './master-minimo'
import { aplicarAutomezcla, medidorAutomezcla, nuevaMemoriaAutomezcla } from './automezcla-banda'
import { elegirPerfilDeProduccion } from './perfiles-mezcla-usuario'
import { mensajeErrorIA, CHAT_UPDATED } from './turno-agente'

export const KIND_BANDA = 'banda'

const ROL: Record<string, RolProduccion | undefined> = {
  planificador: 'planificador',
  director: 'director',
  musico: 'musico',
  arreglista: 'coherencia',
  coherencia: 'coherencia',
  qa: 'qa',
  mezcla: 'mezcla',
  mastering: 'master',
  master: 'master',
}

/** Lo que cada rol necesita a mano desde el primer paso (el resto lo encuentra con `buscar_herramientas`). */
const HERRAMIENTAS_POR_ROL: Partial<Record<RolProduccion, string[]>> = {
  director: ['project.setBpm', 'project.setTimeSignature', 'project.update', 'track.create', 'track.update', 'track.addVstLayer', 'analysis.trackSound'],
  musico: ['midi.clip.create', 'midi.createNotes', 'midi.notes.set', 'midi.notes.get', 'track.create', 'track.addVstLayer', 'plugin.bypass'],
  coherencia: ['midi.notes.get', 'midi.notes.patch', 'midi.notes.set', 'midi.clip.create'],
  qa: ['analysis.trackSound', 'analysis.mix', 'midi.notes.get'],
  mezcla: ['track.update', 'mix.eq', 'mix.compress', 'bus.create', 'send.set', 'automation.writePoint', 'plugin.insert', 'plugin.setParameter', 'analysis.mix', 'analysis.trackSound'],
  master: ['master.update', 'mix.limit', 'mix.eq', 'plugin.insert', 'plugin.setParameter', 'analysis.mix', 'analysis.loudness'],
}

/** Modo del guardia de armonía (`ajustar` | `rechazar` | `auto`) y % máximo que `auto` ajusta; configurable por almacenamiento local. */
export function opcionesArmonia(): OpcionesArmonia {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem('jaswave-banda-armonia') ?? 'null') as Partial<OpcionesArmonia> | null
    const modo = v?.modo === 'ajustar' || v?.modo === 'rechazar' || v?.modo === 'auto' ? v.modo : ARMONIA_POR_DEFECTO.modo
    const max = Number(v?.maxAjuste)
    return { modo, maxAjuste: Number.isFinite(max) && max >= 0 && max <= 1 ? max : ARMONIA_POR_DEFECTO.maxAjuste }
  } catch {
    return ARMONIA_POR_DEFECTO
  }
}

const ETAPAS_VISIBLES: EtapaProduccion[] = ['plan', 'direccion', 'musicos', 'ensayo', 'coherencia', 'qa_musicos', 'mezcla', 'qa_mezcla', 'master', 'qa_master']

/** Especialistas activos como participantes de la producción (los roles desconocidos actúan como músicos). */
export function participantesDesdeEspecialistas(lista: EspecialistaConfig[], catalogo: HerramientaAgente[], archivos?: readonly ArchivoAsistente[]): ParticipanteProduccion[] {
  return lista
    .filter((e) => e.activo)
    .map((e) => ({
      id: e.id,
      nombre: e.nombre,
      rol: ROL[e.role] ?? 'musico',
      descripcion: [e.instrumento, e.descripcion || e.skills.join(', ')].filter(Boolean).join(' — ').slice(0, 180) || e.nombre,
      instrucciones: [e.instruccionesPersonalizadas, instruccionesHabilidadesEspecialista(e)].filter(Boolean).join('\n\n'),
      herramientas: herramientasDeGrupos(e.herramientasPermitidas, catalogo),
      habilidades: habilidadesDelEspecialista(e, archivos),
    }))
}

const fmt = (n: number) => n.toFixed(1).replace('.', ',')

/** Tiempo máximo de una medición nativa: pasado, se usa la última medición válida o se da por no medible. */
export const MAX_MS_MEDICION = 3 * 60_000

/**
 * Huella de lo que cambia el sonido de la mezcla: la revisión del proyecto (pistas, clips, plugins, tempo) más
 * lo que esa revisión no ve —notas (altura, inicio, duración, velocidad), volumen, paneo, mute/solo, envíos y
 * parámetros de plugins, también en el máster—. Dos huellas iguales = el mismo audio: no hace falta renderizar otra vez.
 */
export function huellaMezcla(st: ReturnType<TiendaDAW['obtenerEstado']>): string {
  const p = st.project
  let h = 5381
  const mezclar = (t: string) => {
    for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) | 0
  }
  for (const t of p?.tracks ?? []) {
    const { clips, ...resto } = t as unknown as { clips?: ClipResumible[] } & Record<string, unknown>
    mezclar(JSON.stringify(resto))
    for (const c of clips ?? []) {
      mezclar(`|${c.inicio},${c.duracion}`)
      for (const n of c.notas ?? []) mezclar(`${n.pitch},${n.inicio},${n.duracion},${n.velocidad ?? ''};`)
    }
  }
  mezclar(JSON.stringify(p?.master ?? null))
  mezclar(JSON.stringify((p as { routing?: unknown } | undefined)?.routing ?? null))
  return `${getStateRevision(st)}:${(h >>> 0).toString(16)}`
}

/** Espera `p` como mucho `ms`; null si se agota (la medición sigue su curso, pero ya no se espera por ella). */
async function conLimite<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<null>((ok) => (t = setTimeout(() => ok(null), ms)))])
  } finally {
    if (t) clearTimeout(t)
  }
}

/**
 * Medición determinista para el QA (lo que el agente no puede «opinar»). La medición nativa (render de toda la
 * canción) es lo más lento fuera del modelo: se guarda por huella del proyecto + rango («todo»), de modo que
 * mezcla → revisión → máster → revisión no renderizan otra vez si nada cambió, y tiene un tiempo máximo con
 * respaldo (la última medición válida o «no medible»). Las mediciones fallidas no se guardan.
 */
export function medirBanda(
  tienda: TiendaDAW,
  medirMezclaNativa = medidorMezclaApp(tienda),
  opts: { maxMs?: number; /** Espera antes de reintentar si el host de audio cayó a mitad de la medición (por defecto 2 s). */ reintentoHostMs?: number } = {},
): (etapa: EtapaMedible) => Promise<MedicionQA | null> {
  type Mezcla = Awaited<ReturnType<typeof medirMezclaNativa>>
  let guardada: { huella: string; rango: string; m: NonNullable<Mezcla> } | null = null
  const maxMs = opts.maxMs ?? MAX_MS_MEDICION
  const medirMezcla = async (): Promise<Mezcla> => {
    const huella = huellaMezcla(tienda.obtenerEstado())
    if (guardada && guardada.huella === huella && guardada.rango === 'todo') return guardada.m
    // Plan Q: si el host de audio cae a mitad de la medición (la app ya lo reinicia), se espera un momento y se
    // reintenta UNA vez; si vuelve a fallar, la medición no es medible (la producción sigue).
    const conReintento = async (): Promise<Mezcla> => {
      try {
        return await medirMezclaNativa()
      } catch {
        await new Promise((ok) => setTimeout(ok, opts.reintentoHostMs ?? 2000))
        return medirMezclaNativa()
      }
    }
    const m = await conLimite(conReintento(), maxMs).catch(() => null)
    if (m) {
      guardada = { huella, rango: 'todo', m }
      return m
    }
    // Agotó el tiempo o falló: mejor la última medición válida (puede estar algo desfasada) que nada.
    return guardada?.m ?? null
  }
  return async (etapa) => {
    const st = tienda.obtenerEstado()
    const pistas = st.project?.tracks ?? []
    // Lo que impide que una pista suene (sin instrumento, VST caído, mute/solo, fader a cero), con la
    // herramienta que lo corrige: el músico carga instrumentos y la mezcla ajusta faders.
    const sonido = (quien: 'musico' | 'mezcla') => {
      const ps = diagnosticarSonidoPistas(st).problemas.filter((p) => p.responsable === quien)
      return { critico: ps.some((p) => p.severidad === 'critico'), detalles: ps.map((p) => `${p.mensaje} Cómo corregirlo: ${p.solucion}`) }
    }
    if (etapa === 'musicos') {
      const conContenido = pistas.filter((t) => t.tipo === 'audio' || t.tipo === 'midi' || t.tipo === 'instrumento')
      const vacias = conContenido.filter((t) => !(t.clips ?? []).length)
      const s = sonido('musico')
      const detalles = [...vacias.map((t) => `La pista «${t.nombre}» no tiene ninguna parte grabada.`), ...s.detalles]
      return { ok: conContenido.length > 0 && vacias.length === 0 && !s.critico, detalles: conContenido.length ? detalles : ['El proyecto no tiene pistas con música todavía.'] }
    }
    // El máster a 0 o en mute deja muda toda la canción; la medición de abajo lo daría por «no medible».
    const master = st.project?.master as { volumen?: number; muted?: boolean } | undefined
    if (master && (master.muted || !(Number(master.volumen ?? 1) > 0.01))) {
      return { ok: false, detalles: [`El canal máster está ${master.muted ? 'en mute' : 'con el volumen a 0'}: la canción entera sale en silencio. Ponlo con master.update datos.volumen entre 0,7 y 1 (1 = 0 dB) y muted false.`] }
    }
    const s = etapa === 'mezcla' ? sonido('mezcla') : { critico: false, detalles: [] as string[] }
    const m = await medirMezcla()
    if (!m) return s.detalles.length ? { ok: !s.critico, detalles: s.detalles } : null
    // El análisis fuera de línea no siempre oye los instrumentos (VST/MIDI): si hay partes grabadas y la
    // medición sale muda, no es medible (no un fallo que nadie podría corregir).
    const hayPartes = pistas.some((t) => (t.clips ?? []).length > 0)
    if (hayPartes && !(Number.isFinite(m.master.integrated) && m.master.integrated > -60)) return s.detalles.length ? { ok: !s.critico, detalles: s.detalles } : null
    const nombre = (id: string) => pistas.find((t) => t.id === id)?.nombre ?? 'una pista'
    const mudas = m.pistas.filter((p) => !Number.isFinite(p.integrated) || p.integrated < -60).map((p) => `«${nombre(p.trackId)}» casi no se oye.`)
    if (etapa === 'mezcla') {
      const satura = m.master.truePeakDb > 0
      return {
        ok: !satura && mudas.length === 0 && !s.critico,
        detalles: [...s.detalles, ...mudas, ...(satura ? [`La mezcla satura: pico de ${fmt(m.master.truePeakDb)} dB.`] : []), `Volumen general ${fmt(m.master.integrated)} LUFS.`],
      }
    }
    const pico = m.master.truePeakDb <= -0.9
    const volumen = Math.abs(m.master.integrated - -14) <= 1.5
    return {
      ok: pico && volumen,
      detalles: [
        `Volumen final ${fmt(m.master.integrated)} LUFS (objetivo −14).`,
        `Pico ${fmt(m.master.truePeakDb)} dBTP (máximo −1).`,
      ],
    }
  }
}

/**
 * Escribe la hoja de ruta de la banda (secciones con un acorde por compás) en el carril de acordes del
 * arreglo con `chords.set` (crea además un marcador por sección). Una misma hoja solo se vuelca una vez por
 * producción; devuelve true si escribió. Nunca interrumpe la producción si falla.
 */
export async function volcarHojaAlCarril(
  tienda: TiendaDAW,
  hoja: { secciones: Array<{ nombre: string; compases: number; acordes: string[] }> },
  volcadas: Set<string>,
): Promise<boolean> {
  const secciones = (hoja.secciones ?? [])
    .map((s) => ({ nombre: String(s.nombre ?? '').trim(), compases: Math.max(1, Math.round(Number(s.compases) || 1)), acordes: (s.acordes ?? []).map((a) => String(a).trim()).filter(Boolean) }))
    .filter((s) => s.acordes.length > 0)
  if (secciones.length === 0) return false
  const firma = JSON.stringify(secciones)
  if (volcadas.has(firma)) return false
  volcadas.add(firma)
  try {
    const r = await tienda.executor.execute('chords.set', { secciones }, 'ai')
    if (!r.success) console.info(`[banda] hoja de ruta no volcada al carril: ${r.error?.message ?? 'error'}`)
    return Boolean(r.success)
  } catch (e) {
    console.info(`[banda] hoja de ruta no volcada al carril: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

const RE_PERCUSIVO = /bater|drum|percu|caja|bombo/i

/**
 * Aplica el estilo del usuario (perfil de toque) a la pista de un músico recién terminado con
 * `style.touch.apply` (un solo lote `midi.notes.set`: un paso de undo). La batería no se humaniza con
 * micro-tiempo, así que se salta. Devuelve true si cambió notas; nunca interrumpe la producción.
 */
export async function aplicarEstiloAMusico(
  tienda: TiendaDAW,
  ejecutarHerramienta: (nombre: string, args: Record<string, unknown>) => Promise<{ ok: boolean; mensaje?: string }>,
  estilo: Pick<EstiloUsuario, 'nombre' | 'perfilId' | 'intensidad'>,
  musico: { id: string; nombre: string; descripcion?: string },
  pistaRef: string | undefined,
  semilla: number,
): Promise<boolean> {
  if (RE_PERCUSIVO.test(`${musico.id} ${musico.nombre} ${musico.descripcion ?? ''}`)) return false
  const ref = (pistaRef ?? '').trim()
  if (!ref) return false
  const q = ref.toLowerCase()
  const pista = (tienda.obtenerEstado().project?.tracks ?? []).find((x) => x.id === ref || x.nombre.trim().toLowerCase() === q)
  if (!pista) return false
  try {
    const r = await ejecutarHerramienta('style.touch.apply', {
      ...(estilo.perfilId ? { perfilId: estilo.perfilId } : {}),
      nombre: estilo.nombre,
      trackId: pista.id,
      intensidad: estilo.intensidad,
      semilla,
    })
    if (!r.ok) console.info(`[banda] estilo no aplicado a ${pista.nombre}: ${String(r.mensaje ?? '').slice(0, 200)}`)
    return r.ok
  } catch (e) {
    console.info(`[banda] estilo no aplicado a ${pista.nombre}: ${e instanceof Error ? e.message : String(e)}`)
    return false
  }
}

export async function runTurnoBanda(ctx: TurnContext, tienda: TiendaDAW): Promise<TurnProgramOutcome> {
  const lc = (ctx.input.context ?? {}) as Partial<LegacyTurnContext>
  const conversationId = ctx.run.conversationId
  const assistantMsgId = lc.assistantMsgId ?? ctx.run.messageId ?? ''
  const projectId = lc.projectId ?? (tienda.obtenerEstado().project?.id || 'default')
  // «/banda reanudar <runId> [copia]»: continúa una producción interrumpida (plan Q) con el estado del diario.
  const reanudacion = /^\s*\/banda\s+reanudar(?:\s+([\w-]+))?(\s+copia)?\s*$/i.exec(ctx.run.userText)
  let pedido = ctx.run.userText.replace(/^\s*\/banda\s*/i, '').replace(/^banda:\s*/i, '').trim() || 'Compón y produce una canción completa.'
  const cfg = loadAiSettings()
  const guardar = (patch: Partial<StoredChatMessage>) => {
    patchMessage(conversationId, assistantMsgId, patch, projectId)
    ctx.emit({ type: 'agent.message', role: ctx.run.role, text: '', data: { kind: CHAT_UPDATED } })
  }
  const terminarCon = (texto: string): TurnProgramOutcome => {
    guardar({ content: texto })
    return { status: 'completed', summary: texto }
  }

  if (!iaRemotaDisponible()) return terminarCon('El asistente no está disponible ahora mismo. Inicia sesión o revisa tu conexión para usarlo.')
  if (autonomyBlocksMutation()) {
    return terminarCon('La banda necesita hacer cambios en el proyecto, pero la IA solo tiene permiso para sugerir. Cámbialo en Ajustes del proyecto y vuelve a pedirlo.')
  }
  const catalogo = catalogoAgente({ rol: ctx.run.role, habilidades: [] })
  const participantes = participantesDesdeEspecialistas(cargarEspecialistas(), catalogo)
  if (!participantes.some((p) => p.rol === 'musico') && !participantes.some((p) => p.rol === 'director')) {
    return terminarCon('No hay músicos activos en la banda. Activa al menos uno en Ajustes → IA → Especialistas.')
  }

  // ── Resiliencia (plan Q): diario de la producción, puntos de control y reanudación ──
  const puerto = puertoProducciones()
  const proyectoSeguro = idSeguro(projectId)
  let previo: ResumenDiario | null = null
  let candado: { run: string; testigo: string } | null = null
  if (reanudacion) {
    if (!puerto) return terminarCon('Reanudar una producción solo está disponible en la aplicación de escritorio.')
    let runPrevio = reanudacion[1] ?? ''
    if (!runPrevio) {
      const l = await puerto.listar(proyectoSeguro)
      runPrevio = l.ok ? (l.producciones[0]?.runId ?? '') : ''
    }
    previo = runPrevio ? await leerProduccion(puerto, proyectoSeguro, runPrevio) : null
    if (!previo?.guardado.hoja) return terminarCon('No encontré esa producción, o se interrumpió antes de tener el plan, así que no hay nada que reanudar. Pídeme la canción de nuevo.')
    // Dos ventanas (o instancias) no pueden reanudar la misma producción a la vez.
    const c = await puerto.candadoTomar(proyectoSeguro, runPrevio)
    if (c.ok && c.testigo === null) return terminarCon('Esa producción ya se está reanudando en otra ventana.')
    if (c.ok && c.testigo) candado = { run: runPrevio, testigo: c.testigo }
    if (reanudacion[2]) {
      const rr = await restaurarUltimoPunto(puerto, tienda, proyectoSeguro)
      if (!rr.ok) return terminarCon(`No pude recuperar la copia de seguridad: ${rr.error ?? 'error desconocido'}`)
    }
    pedido = previo.pedido
  }
  const runId = nuevoRunId()
  const diario = puerto ? new DiarioProduccion(puerto, proyectoSeguro, runId) : null
  await diario?.iniciar({
    pedido,
    config: { esperasReintento: ESPERAS_REINTENTO_BANDA, reanuda: !!previo },
    participantes: participantes.map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol })),
    ...(previo ? { reanudaDe: previo.runId } : {}),
  })
  diario?.estado('en_curso', previo ? 'reanudada' : 'inicio')

  // Detener desde el panel de la banda o desde el chat.
  const control = new AbortController()
  const abortar = () => control.abort()
  ctx.signal.addEventListener('abort', abortar, { once: true })
  orquestadorBandaSingleton.comenzar(pedido, participantes, abortar)

  const progreso: ProgresoAgente = {
    tipo: 'banda',
    estado: 'trabajando',
    tareas: ETAPAS_VISIBLES.filter((e) => e === 'plan' || e === 'direccion' || participantesPara(e, participantes)).map((e) => ({ titulo: NOMBRE_ETAPA[e], estado: 'pendiente' as const })),
    actividad: [],
    subagentes: [],
    inicio: Date.now(),
  }
  const publicar = () => guardar({ agente: { ...progreso } })
  publicar()

  let undoInicio: number | null = null
  let cambios = 0
  /** Hoja de ruta vigente: el guardia de armonía comprueba cada escritura de notas contra ella. */
  let hojaVigente: HojaCoherencia | null = null
  const memoriaHumanizado = crearMemoriaHumanizado()
  const ejecutar = async (l0: LlamadaAgente, h: HerramientaAgente): Promise<ResultadoHerramienta> => {
    let l = l0
    let avisosArmonia: string[] = []
    if (h.clase !== 'lectura') {
      const g = guardarEscrituraArmonia(tienda.obtenerEstado(), hojaVigente, l, opcionesArmonia())
      if ('error' in g) return { ok: false, error: g.error }
      l = { ...l, argumentos: g.args }
      avisosArmonia = g.avisos
      // Nombre de clip con la sección («Guitarra - Verso 1») en lugar de «Clip MIDI», y humanización (micro-timing, dinámica y
      // variación de copias exactas): el tiempo se mueve ANTES del legato para que las notas largas sigan sin huecos.
      l = { ...l, argumentos: nombrarClipGenerico(tienda.obtenerEstado(), hojaVigente, l) }
      const hu = guardarEscrituraHumanizar(tienda.obtenerEstado(), hojaVigente, l, memoriaHumanizado)
      l = { ...l, argumentos: hu.args }
      avisosArmonia = [...avisosArmonia, ...hu.avisos]
      // Legato worship: tras validar la armonía y antes de escribir (solo pedidos de adoración/alabanza/balada).
      const lg = guardarEscrituraLegato(tienda.obtenerEstado(), pedido, l)
      l = { ...l, argumentos: lg.args }
      avisosArmonia = [...avisosArmonia, ...lg.avisos]
    }
    const r = await ejecutarBase(l, h)
    return r.ok && avisosArmonia.length ? { ...r, datos: { ...(r.datos && typeof r.datos === 'object' && !Array.isArray(r.datos) ? (r.datos as object) : {}), avisos: avisosArmonia } } : r
  }
  const ejecutarBase = async (l: LlamadaAgente, h: HerramientaAgente): Promise<ResultadoHerramienta> => {
    const etiqueta = describeActionForUser({ type: l.nombre, payload: l.argumentos ?? {} }, tienda.obtenerEstado()).label
    const claseReal = agentActionClass({ type: l.nombre, payload: l.argumentos ?? {} })
    if (claseReal === 'system' && (l.nombre === 'plugin.insert' || l.nombre === 'track.addVstLayer')) {
      return { ok: false, error: 'En la producción automática los plugins se cargan por su nombre (campo nombre), sin ruta de disco ni objeto plugin. Repite la llamada solo con trackId y nombre.' }
    }
    if (claseReal === 'system') return { ok: false, error: 'En la producción automática no se tocan archivos, dispositivos ni otros proyectos. Trabaja solo dentro de este proyecto.' }
    // Reescribir las notas de un clip propio (midi.notes.set/patch) es parte del oficio del músico y del arreglista
    // (y se deshace con toda la producción); lo que no se toca es borrar pistas, clips o proyectos.
    const reescribeNotas = /^midi\.notes\.(set|patch)$/.test(l.nombre)
    if ((h.clase === 'destructiva' || claseReal === 'destructive') && !reescribeNotas) return { ok: false, error: 'En la producción automática no se borra ni se reemplaza contenido. Trabaja sin eliminar nada.' }
    if (h.clase === 'escritura' && undoInicio == null) {
      undoInicio = snapshotUndoDepth(tienda)
      void ctx.captureSnapshot('turn')
    }
    // La escucha en vivo hace sonar los clips sin frenar al agente: el ensayo propio del comando (que
    // bloquea y se pisa entre músicos en paralelo) se apaga. Los análisis offline pausan la escucha.
    const args = l.nombre === 'midi.clip.create' || l.nombre === 'midi.notes.patch' ? { ...(l.argumentos ?? {}), audition: false } : (l.argumentos ?? {})
    const mide = /^analysis\.(mix|loudness|trackSound)$/.test(l.nombre)
    if (mide) await escuchaEnVivo.pausar()
    let r
    try {
      ;[r] = await ctx.executeTools([{ id: l.id, name: l.nombre, arguments: args }])
    } finally {
      if (mide) escuchaEnVivo.reanudar()
    }
    const ok = r?.status === 'success'
    if (ok && h.clase === 'escritura') cambios++
    if (ok) {
      const region = regionMidiTocada(l.nombre, args, tienda)
      if (region) escuchaEnVivo.oirClip(region.inicio, region.duracion)
    }
    return ok ? { ok, datos: r?.data, resumen: etiqueta } : { ok: false, error: r?.error?.message ?? 'No se pudo completar.', resumen: etiqueta }
  }

  /** Agentes que no terminaron bien (para la traza: sin esto un QA caído solo se ve como «No se pudo revisar»). */
  const fallosAgentes: string[] = []
  // Estilo del usuario (skill «estilo-<slug>»): se aplica a la pista de cada músico al terminar su parte.
  let estilo: EstiloUsuario | null = null
  try {
    estilo = estiloActivoDelUsuario()
  } catch {
    estilo = null
  }
  const pistaDeMusico = new Map<string, string>()
  let colaEstilo: Promise<void> = Promise.resolve()
  const aplicarEstilo = (id: string) => {
    const quien = participantes.find((p) => p.id === id)
    if (!estilo || !quien || quien.rol !== 'musico') return
    const est = estilo
    colaEstilo = colaEstilo.then(async () => {
      const ok = await aplicarEstiloAMusico(
        tienda,
        async (nombre, args) => {
          const [r] = await ctx.executeTools([{ id: `estilo:${id}`, name: nombre, arguments: args }])
          return { ok: r?.status === 'success', mensaje: r?.error?.message }
        },
        est,
        quien,
        pistaDeMusico.get(id),
        Math.abs([...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)),
      )
      if (ok) {
        cambios++
        progreso.actividad = [...progreso.actividad, { id: `estilo:${id}`, texto: `Estilo «${est.nombre}» aplicado a ${quien.nombre}`, estado: 'ok' as const, quien: quien.nombre }].slice(-40)
        publicar()
      }
    })
  }
  const alEvento = (e: EventoProduccion) => {
    orquestadorBandaSingleton.evento(e)
    if (e.tipo === 'encargos') for (const x of e.encargos) if (x.pista) pistaDeMusico.set(x.participante, x.pista)
    if (e.tipo === 'participante' && e.etapa === 'musicos' && e.estado === 'completado') aplicarEstilo(e.participante.id)
    // Mezcla y máster (incluidas sus rondas de corrección): la canción suena en bucle mientras trabajan.
    if ((e.tipo === 'etapa' && e.fase === 'inicio') || e.tipo === 'agente') {
      if (e.etapa === 'mezcla' || e.etapa === 'master') escuchaEnVivo.sonarCancion()
    }
    if (e.tipo === 'participante' && e.estado !== 'completado') fallosAgentes.push(`${e.etapa}/${e.participante.id}:${e.estado}${e.error ? `(${String(e.error).slice(0, 160)})` : ''}`)
    if (e.tipo === 'etapa') {
      const t = progreso.tareas.find((x) => x.titulo === NOMBRE_ETAPA[e.etapa])
      if (t) t.estado = e.fase === 'inicio' ? 'en_curso' : 'hecha'
    } else if (e.tipo === 'encargos') {
      progreso.subagentes = e.encargos.map((x) => ({
        id: x.participante,
        nombre: participantes.find((p) => p.id === x.participante)?.nombre ?? 'Músico',
        tarea: limpiarTextoUsuario(x.encargo).slice(0, 140),
        estado: 'en_curso',
      }))
    } else if (e.tipo === 'agente' && e.evento.tipo === 'herramienta') {
      const ev = e.evento
      const quien = e.participante.nombre
      if (ev.fase === 'inicio') progreso.actividad = [...progreso.actividad, { id: `${quien}:${progreso.actividad.length}`, texto: ev.titulo, estado: 'en_curso' as const, quien }].slice(-40)
      else {
        const i = progreso.actividad.map((x) => x.quien === quien && x.texto === ev.titulo && x.estado === 'en_curso').lastIndexOf(true)
        if (i >= 0) progreso.actividad[i] = { ...progreso.actividad[i]!, estado: ev.ok ? 'ok' : 'error' }
        // Rastro en vivo de cada fallo de herramienta (la línea final `[banda]` solo llega si la producción termina).
        if (!ev.ok) console.info(`[banda] ✗ ${quien}:${ev.nombre} ${String(ev.resumen ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
      }
    } else if (e.tipo === 'mezcla_inicial') {
      progreso.actividad = [...progreso.actividad, { id: `mezcla-inicial:${progreso.actividad.length}`, texto: `Mezcla inicial automática: ${e.resumen.slice(0, 160)}`, estado: e.ok ? ('ok' as const) : ('error' as const), quien: 'Mezcla' }].slice(-40)
    } else if (e.tipo === 'qa' && e.etapa === 'qa_musicos') {
      progreso.subagentes = progreso.subagentes.map((s) => ({ ...s, estado: e.veredicto.aprobado ? 'ok' : 'en_curso' }))
    } else return
    publicar()
  }

  const ultimoError: UltimoErrorIA = {}
  const hojasVolcadas = new Set<string>()
  // La medición nativa renderiza offline (bloquea el transporte): la escucha se pausa solo cuando de verdad se
  // renderiza; si el proyecto no cambió desde la última medición, `medirBanda` responde de su caché sin pausarla.
  const medirNativo = medidorMezclaApp(tienda)
  const medir = medirBanda(tienda, async () => {
    await escuchaEnVivo.pausar()
    try {
      return await medirNativo()
    } finally {
      escuchaEnVivo.reanudar()
    }
  })
  // Plan T: mezcla inicial determinista. Una sola medición (stems + suma) con tope de 60 s; sin ella, valores por rol.
  const memoriaMezcla = nuevaMemoriaAutomezcla()
  const medirParaMezcla = medidorAutomezcla(tienda, { huella: huellaMezcla, pausar: () => escuchaEnVivo.pausar(), reanudar: () => escuchaEnVivo.reanudar() })
  escuchaEnVivo.comenzar(tienda)
  let r: ResultadoProduccionAgentes | undefined
  try {
    r = await ejecutarProduccion({
      pedido,
      catalogo,
      base: HERRAMIENTAS_BASE,
      participantes,
      chat: chatDelMotor(ctx, cfg, ultimoError, {
        delta: 'nunca',
        esperas: ESPERAS_REINTENTO_BANDA,
        // Sin internet la petición espera (no gasta reintentos) y la producción sigue sola al volver.
        red: redDelNavegador({
          alPausar: () => {
            orquestadorBandaSingleton.pausarPorRed()
            diario?.estado('pausada_red', 'sin conexión a internet')
          },
          alReanudar: () => {
            orquestadorBandaSingleton.reanudarDeRed()
            diario?.estado('en_curso', 'volvió la conexión')
          },
        }),
      }),
      ejecutar,
      contexto: () => buildReadOnlyProjectContext(tienda.obtenerEstado()).slice(0, 3000),
      partes: () => resumenPartes(tienda.obtenerEstado()),
      alDefinirHoja: (h) => {
        hojaVigente = h
      },
      // Cada músico recibe las notas permitidas por acorde de SUS secciones (no solo los cifrados).
      guiaArmonia: (encargo, hoja) => {
        const pista = encargo.pista ? (tienda.obtenerEstado().project?.tracks ?? []).find((t) => t.id === encargo.pista || t.nombre.trim().toLowerCase() === encargo.pista!.trim().toLowerCase()) : undefined
        return tablaArmoniaMusico(hoja, { encargo: encargo.encargo, tipo: pista ? tipoDePista(pista.nombre, pista.plugins ?? []) : { bateria: /bater|drum|percus/i.test(encargo.participante), bajo: /bajo|bass/i.test(encargo.participante) } })
      },
      // Diagnóstico inmediato en el resultado de cada escritura MIDI (como los errores del compilador en un IDE).
      diagnostico: (encargo, hoja) => (encargo.pista ? diagnosticoEscritura(tienda.obtenerEstado(), hoja, { pista: encargo.pista, encargo: encargo.encargo }) : null),
      // Cada músico escribe solo en su pista: la referencia del encargo (id o nombre) se resuelve contra el proyecto.
      resolverPista: (ref) => {
        const q = ref.trim().toLowerCase()
        const t = (tienda.obtenerEstado().project?.tracks ?? []).find((x) => x.id === ref || x.nombre.trim().toLowerCase() === q)
        return t ? { id: t.id, nombre: t.nombre } : null
      },
      // Al terminar cada músico se mide si su pista cubre las secciones que le tocan; si no, retoma lo que falta.
      // Plan S: coordinación vertical al terminar los músicos (choques entre pistas, pad con el acorde, bajo de la barra).
      afinarConjunto: async () => {
        if (!hojaVigente) return null
        return coordinarBanda(tienda.obtenerEstado(), hojaVigente, async (nombre, args) => {
          const [x] = await ctx.executeTools([{ id: `coordinar:${nombre}`, name: nombre, arguments: args }])
          if (x?.status === 'success') cambios++
          return x?.status === 'success'
        })
      },
      // Plan S: pistas de instrumento del proyecto (sin máster ni buses) y cuántas notas tienen, para dar dueño a las huérfanas
      // y rescatar las que sigan vacías.
      pistas: () =>
        (tienda.obtenerEstado().project?.tracks ?? [])
          .filter((t) => t.tipo === 'audio' || t.tipo === 'midi' || t.tipo === 'instrumento')
          .map((t) => ({ id: t.id, nombre: t.nombre, tipo: t.tipo, notas: ((t.clips ?? []) as unknown as Array<{ notas?: unknown[] }>).reduce((a, c) => a + (c.notas?.length ?? 0), 0) })),
      // Al terminar cada músico se mide, compás a compás, si su pista (y las extra que lleva) cubre lo que le toca; si no, retoma lo que falta.
      completitud: (encargo, hoja) => {
        const mensajes = [encargo.pista, ...(encargo.pistasExtra ?? [])]
          .filter((x): x is string => !!x)
          .map((pista, i) => seccionesFaltantes(tienda.obtenerEstado(), hoja, { pista, encargo: i === 0 ? encargo.encargo : '' }))
          .filter((m): m is string => !!m)
        return mensajes.length ? mensajes.join(' ') : null
      },
      coherencia: async (hoja) => {
        // La hoja de ruta (acorde por compás y secciones) se vuelca al carril de acordes del arreglo: es la
        // única salida del harness que trae la hoja completa; chords.set reemplaza, así que repetirla es inocuo.
        if (await volcarHojaAlCarril(tienda, hoja, hojasVolcadas)) cambios++
        return analizarCoherencia(tienda.obtenerEstado(), hoja)
      },
      medir,
      herramientasPorRol: HERRAMIENTAS_POR_ROL,
      instruccionesExtra: instruccionesConfiguradas(projectId),
      ...(estilo?.resumen ? { estiloMusical: `${estilo.nombre}: ${estilo.resumen}` } : {}),
      // Lo que el usuario escribe en el chat o en el panel de la banda mientras trabaja llega al agente en turno.
      notasUsuario: () => orquestadorBandaSingleton.tomarNotas(),
      onEvento: (e) => {
        alEvento(e)
        diario?.evento(e, e.tipo === 'medicion' ? huellaMezcla(tienda.obtenerEstado()) : undefined)
      },
      signal: control.signal,
      ...(previo ? { reanudar: previo.guardado } : {}),
      // Al terminar cada etapa y cada músico se guarda una copia del proyecto (también sin ruta), con su huella en el diario.
      alPuntoDeControl: async (que) => {
        const g = await guardarPuntoProyecto(puerto, tienda, que)
        if (g) await diario?.control(que, g.huella, g.archivo)
      },
      // Pasado el límite de tiempo: máster mínimo sin modelo (normalizar a −14 LUFS + limitador a −1 dBTP).
      mezclaInicial: async (hoja, c) => {
        // El estilo lo manda el productor (ajuste); si no, el que emitió el planificador en la hoja; último recurso: el pedido.
        const elegido = elegirPerfilDeProduccion({ estilo: c.estilo, estiloHoja: hoja?.estilo, pedido: c.pedido })
        const r = await aplicarAutomezcla({
          tienda,
          perfil: elegido.perfil,
          memoria: memoriaMezcla,
          medir: medirParaMezcla,
          hoja: hoja ? { secciones: hoja.secciones.map((x) => ({ nombre: x.nombre, compases: x.compases })), bpm: hoja.bpm, numerador: hoja.numerador } : undefined,
          signal: control.signal,
          ejecutar: async (nombre, args) => {
            const [x] = await ctx.executeTools([{ id: `automezcla:${nombre}`, name: nombre, arguments: args }])
            if (x?.status === 'success') cambios++
            return { ok: x?.status === 'success', mensaje: x?.error?.message, datos: x?.data }
          },
        })
        const origen = `Perfil «${elegido.perfil.nombre}»: ${elegido.motivo}.${elegido.avisos.length ? ` Perfiles propios con errores: ${elegido.avisos.join(' ')}` : ''}`
        return { ok: r.ok, aplicada: r.aplicada, resumen: `${origen} ${r.resumen}`, perfil: elegido.perfil.nombre, guion: `${origen} ${r.guion ?? ''}` }
      },
      masterMinimo: () =>
        masterMinimoDeterminista(
          async (nombre, args) => {
            const [x] = await ctx.executeTools([{ id: `minimo:${nombre}`, name: nombre, arguments: args }])
            if (x?.status === 'success') cambios++
            return { ok: x?.status === 'success', mensaje: x?.error?.message }
          },
          () => medir('master'),
          memoriaMezcla.perfil?.master,
        ),
    })
  } finally {
    // Una excepción deja la producción como interrumpida (se podrá reanudar); el cierre normal se escribe más abajo.
    if (r === undefined) await diario?.cerrar('interrumpida', 'error inesperado').catch(() => undefined)
    if (candado && puerto) void puerto.candadoSoltar(proyectoSeguro, candado.run, candado.testigo)
    ctx.signal.removeEventListener('abort', abortar)
    await escuchaEnVivo.parar()
    await colaEstilo.catch(() => undefined)
  }
  orquestadorBandaSingleton.terminar(r)
  await diario?.cerrar(r.estado === 'cancelado' ? 'detenida' : r.estado === 'fallo' ? 'interrumpida' : 'completada', r.estado === 'fallo' ? 'la producción se detuvo por un fallo' : undefined)
  // Traza para diagnosticar producciones largas (qué llamó cada agente y qué falló); sin datos del usuario.
  console.info(
    `[banda] ${r.estado} · ${r.llamadas.length} llamadas · ${r.llamadas
      .map((x) => `${x.agente}:${x.nombre}${x.ok ? '' : `✗(${String(x.error ?? '').slice(0, 120)})`}`)
      .join(' | ')
      .slice(0, 16000)}`,
  )
  // Tiempos por etapa (reloj y peticiones), mediciones y refinamientos omitidos: lo que hace falta para afinar la velocidad.
  if (r.tiempos) {
    const t = r.tiempos
    console.info(
      `[tiempos] ${resumenTiempos(t)} Mediciones: ${t.mediciones.map((m) => `${m.etapa} ${formatearDuracion(m.ms)}${m.ok === null ? ' (no medible)' : m.ok ? '' : ' (fuera de objetivo)'}`).join(', ') || 'ninguna'}. Omitido: ${t.omitidos.map((o) => `${o.que} [${o.motivo}]`).join(', ') || 'nada'}.`,
    )
  }
  if (fallosAgentes.length) console.info(`[banda] agentes sin terminar: ${fallosAgentes.join(' | ').slice(0, 2000)}`)

  const nombres = catalogo.map((h) => h.nombre)
  let texto = limpiarTextoUsuario(r.texto, { nombresHerramientas: nombres })
  // El aviso genérico solo si falló el modelo; si la producción explicó por qué paró, se conserva.
  if (r.estado === 'fallo' && !cambios && (ultimoError.error || !texto)) texto = mensajeErrorIA(ultimoError.error, ultimoError.codigo)
  if (cambios) texto += '\n\nPuedes deshacer toda la producción desde esta respuesta.'
  progreso.estado = r.estado === 'cancelado' ? 'detenido' : r.estado === 'fallo' ? 'error' : 'listo'
  progreso.actividad = progreso.actividad.map((a) => (a.estado === 'en_curso' ? { ...a, estado: 'ok' as const } : a))
  progreso.subagentes = progreso.subagentes.map((s) => (s.estado === 'en_curso' ? { ...s, estado: r.estado === 'completado' ? 'ok' : s.estado } : s))
  progreso.fin = Date.now()
  guardar({ content: texto, agente: progreso, ...(undoInicio != null && cambios ? { undoDepthAtStart: undoInicio } : {}) })

  if (r.estado === 'cancelado') throw new DOMException('Aborted', 'AbortError')
  if (r.estado === 'fallo' && !cambios) return { status: 'failed', error: texto }
  return { status: 'completed', summary: texto, data: { estado: r.estado, etapas: r.etapas } }
}

const NOMBRES_NOTA = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const nombreNota = (p: number) => `${NOMBRES_NOTA[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

type ClipResumible = { nombre?: string; inicio: number; duracion: number; tipo?: string; notas?: Array<{ pitch: number; inicio: number; duracion: number; velocidad?: number }> }

/**
 * Lo que ya está grabado, como lo «oiría» un músico: por pista y clip, el registro, el ritmo del primer
 * compás (posiciones en tiempos, 1 = primer tiempo), la densidad y la intensidad. Compacto (≤ 3000 caracteres).
 */
export function resumenPartes(st: ReturnType<TiendaDAW['obtenerEstado']>, maxCaracteres = 3000): string {
  const num = Number(st.project?.timeSignature?.numerador ?? 4) || 4
  const lineas: string[] = []
  for (const t of st.project?.tracks ?? []) {
    const clips = ((t.clips ?? []) as ClipResumible[]).filter((c) => (c.notas ?? []).length > 0).sort((a, b) => a.inicio - b.inicio)
    if (!clips.length) continue
    const instrumento = (t.plugins ?? []).find((p) => (p as { tipo?: string }).tipo === 'instrumento')?.nombre ?? t.plugins?.[0]?.nombre
    lineas.push(`«${t.nombre}»${instrumento ? ` (${instrumento})` : ''}:`)
    for (const c of clips) {
      const ns = c.notas!
      const pitches = ns.map((n) => n.pitch)
      const primerCompas = [...new Set(ns.filter((n) => n.inicio < num).map((n) => Math.round((n.inicio + 1) * 4) / 4))].sort((a, b) => a - b).slice(0, 12)
      const vel = Math.round(ns.reduce((s, n) => s + (n.velocidad ?? 100), 0) / ns.length)
      const porCompas = (ns.length / Math.max(1, c.duracion / num)).toFixed(1)
      lineas.push(
        `  - ${c.nombre ?? 'clip'} (beats ${c.inicio}–${c.inicio + c.duracion}): ${nombreNota(Math.min(...pitches))}–${nombreNota(Math.max(...pitches))}, ${porCompas} notas/compás, velocidad media ${vel}, ritmo del 1.er compás en tiempos ${primerCompas.join(' ') || '—'}`,
      )
    }
  }
  const texto = lineas.join('\n')
  return texto.length > maxCaracteres ? `${texto.slice(0, maxCaracteres - 1)}…` : texto
}

/** Región (beats de la canción) que una herramienta MIDI acaba de escribir, para escucharla. */
export function regionMidiTocada(nombre: string, args: Record<string, unknown>, tienda: TiendaDAW): { inicio: number; duracion: number } | null {
  if (nombre === 'midi.clip.create') {
    const inicio = Number(args.inicio ?? 0)
    const fin = Math.max(0, ...((Array.isArray(args.notas) ? args.notas : []) as Array<{ inicio?: number; duracion?: number }>).map((n) => Number(n.inicio ?? 0) + Number(n.duracion ?? 0)))
    return { inicio, duracion: Number(args.duracion ?? fin) || 4 }
  }
  if (nombre === 'midi.notes.patch') {
    const ini = Number(args.rangeStart ?? args.inicioRango ?? args.start)
    const fin = Number(args.rangeEnd ?? args.finRango ?? args.end)
    if (Number.isFinite(ini) && fin > ini) return { inicio: ini, duracion: fin - ini }
    // Forma del comando (upsert/removeIds): se escucha el clip entero.
  }
  if (nombre === 'midi.notes.set' || nombre === 'midi.createNotes' || nombre === 'midi.notes.patch') {
    const pista = (tienda.obtenerEstado().project?.tracks ?? []).find((t) => t.id === String(args.pistaId ?? args.trackId ?? ''))
    const clip = pista?.clips?.find((c) => c.id === String(args.clipId ?? ''))
    return clip ? { inicio: clip.inicio, duracion: clip.duracion } : null
  }
  return null
}

function participantesPara(e: EtapaProduccion, p: ParticipanteProduccion[]): boolean {
  if (e === 'musicos' || e === 'coherencia' || e === 'qa_musicos') return p.some((x) => x.rol === 'musico')
  if (e === 'ensayo') return p.filter((x) => x.rol === 'musico').length >= 2
  if (e === 'mezcla' || e === 'qa_mezcla') return p.some((x) => x.rol === 'mezcla')
  if (e === 'master' || e === 'qa_master') return p.some((x) => x.rol === 'master')
  return true
}
