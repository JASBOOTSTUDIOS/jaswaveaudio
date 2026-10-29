/**
 * Turno «banda» (G8): la producción completa la hace un equipo de agentes reales por etapas
 * (`ejecutarProduccion`): planificador → director → músicos en paralelo → QA → mezcla → QA → máster → QA.
 *
 * Los participantes son los especialistas activos del usuario (instrucciones, habilidades y grupos de
 * herramientas permitidas). Las escrituras pasan por el motor (permisos, auditoría y un deshacer para
 * todo el turno); lo destructivo no se ejecuta en una producción automática. El QA combina el
 * veredicto de su agente con la medición del DAW (`analysis.mix`).
 */
import { NOMBRE_ETAPA, agentActionClass, buildReadOnlyProjectContext, diagnosticarSonidoPistas, ejecutarProduccion, limpiarTextoUsuario, medidorMezclaApp, autonomyBlocksMutation } from '@jaswave/host-sdk'
import type {
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
import { habilidadesDelEspecialista } from '../habilidades-agentes'
import { catalogoAgente, HERRAMIENTAS_BASE, herramientasDeGrupos } from './catalogo-agente'
import { analizarCoherencia } from './coherencia-banda'
import { chatDelMotor, ESPERAS_REINTENTO_BANDA, type UltimoErrorIA } from './chat-agente'
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
  qa: ['analysis.trackSound', 'analysis.mix'],
  mezcla: ['track.update', 'mix.eq', 'mix.compress', 'bus.create', 'send.set', 'automation.writePoint', 'plugin.insert', 'plugin.setParameter', 'analysis.mix', 'analysis.trackSound'],
  master: ['master.update', 'mix.limit', 'mix.eq', 'plugin.insert', 'plugin.setParameter', 'analysis.mix', 'analysis.loudness'],
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

/** Medición determinista para el QA (lo que el agente no puede «opinar»). */
export function medirBanda(tienda: TiendaDAW, medirMezcla = medidorMezclaApp(tienda)): (etapa: EtapaMedible) => Promise<MedicionQA | null> {
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

export async function runTurnoBanda(ctx: TurnContext, tienda: TiendaDAW): Promise<TurnProgramOutcome> {
  const lc = (ctx.input.context ?? {}) as Partial<LegacyTurnContext>
  const conversationId = ctx.run.conversationId
  const assistantMsgId = lc.assistantMsgId ?? ctx.run.messageId ?? ''
  const projectId = lc.projectId ?? (tienda.obtenerEstado().project?.id || 'default')
  const pedido = ctx.run.userText.replace(/^\s*\/banda\s*/i, '').replace(/^banda:\s*/i, '').trim() || 'Compón y produce una canción completa.'
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
  const ejecutar = async (l: LlamadaAgente, h: HerramientaAgente): Promise<ResultadoHerramienta> => {
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
  const alEvento = (e: EventoProduccion) => {
    orquestadorBandaSingleton.evento(e)
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
    } else if (e.tipo === 'qa' && e.etapa === 'qa_musicos') {
      progreso.subagentes = progreso.subagentes.map((s) => ({ ...s, estado: e.veredicto.aprobado ? 'ok' : 'en_curso' }))
    } else return
    publicar()
  }

  const ultimoError: UltimoErrorIA = {}
  const medir = medirBanda(tienda)
  escuchaEnVivo.comenzar(tienda)
  let r
  try {
    r = await ejecutarProduccion({
      pedido,
      catalogo,
      base: HERRAMIENTAS_BASE,
      participantes,
      chat: chatDelMotor(ctx, cfg, ultimoError, { delta: 'nunca', esperas: ESPERAS_REINTENTO_BANDA }),
      ejecutar,
      contexto: () => buildReadOnlyProjectContext(tienda.obtenerEstado()).slice(0, 3000),
      partes: () => resumenPartes(tienda.obtenerEstado()),
      // Cada músico escribe solo en su pista: la referencia del encargo (id o nombre) se resuelve contra el proyecto.
      resolverPista: (ref) => {
        const q = ref.trim().toLowerCase()
        const t = (tienda.obtenerEstado().project?.tracks ?? []).find((x) => x.id === ref || x.nombre.trim().toLowerCase() === q)
        return t ? { id: t.id, nombre: t.nombre } : null
      },
      coherencia: (hoja) => analizarCoherencia(tienda.obtenerEstado(), hoja),
      // La medición renderiza offline (bloquea el transporte): la escucha se pausa mientras.
      medir: async (etapa) => {
        await escuchaEnVivo.pausar()
        try {
          return await medir(etapa)
        } finally {
          escuchaEnVivo.reanudar()
        }
      },
      herramientasPorRol: HERRAMIENTAS_POR_ROL,
      instruccionesExtra: instruccionesConfiguradas(projectId),
      // Lo que el usuario escribe en el chat o en el panel de la banda mientras trabaja llega al agente en turno.
      notasUsuario: () => orquestadorBandaSingleton.tomarNotas(),
      onEvento: alEvento,
      signal: control.signal,
    })
  } finally {
    ctx.signal.removeEventListener('abort', abortar)
    await escuchaEnVivo.parar()
  }
  orquestadorBandaSingleton.terminar(r)
  // Traza para diagnosticar producciones largas (qué llamó cada agente y qué falló); sin datos del usuario.
  console.info(
    `[banda] ${r.estado} · ${r.llamadas.length} llamadas · ${r.llamadas
      .map((x) => `${x.agente}:${x.nombre}${x.ok ? '' : `✗(${String(x.error ?? '').slice(0, 120)})`}`)
      .join(' | ')
      .slice(0, 16000)}`,
  )
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
