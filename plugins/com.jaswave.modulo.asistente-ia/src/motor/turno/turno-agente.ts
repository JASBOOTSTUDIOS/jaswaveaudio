/**
 * Turno del coproductor como agente (estilo agente de código / IDE con IA): el modelo planifica con una
 * lista de tareas visible, consulta el proyecto, ejecuta herramientas reales en caliente, busca más
 * herramientas cuando las necesita, delega partes independientes en subagentes (incluidos los
 * especialistas del usuario), lee las habilidades del usuario y pregunta solo lo imprescindible.
 *
 * Configurable por el usuario: reglas, AGENTS.md del proyecto, habilidades y agentes (`config-agente.ts`).
 * Modos: auto / create / ask / think / plan, más /plan, /entrevista (grill-me) y /meta (goal), que
 * llegan como dato del turno (`comando`), no como texto pegado al mensaje.
 *
 * Seguridad: en ask/plan/think y en la entrevista solo ve herramientas de lectura; en create/auto las
 * escrituras se ejecutan con deshacer por turno; lo destructivo espera la tarjeta de confirmación; con
 * autonomía «sugerir» las escrituras se reúnen en la tarjeta Aplicar. El usuario solo ve textos legibles.
 */
import {
  CONOCIMIENTO_SLUG,
  PLAN_SLUG,
  agentActionClass,
  autonomyBlocksMutation,
  buildReadOnlyProjectContext,
  collectCitedMessages,
  ejecutarAgente,
  elegirHabilidad,
  esModoSoloLectura,
  executeDawActions,
  formatMusicalSelectionForPrompt,
  formatUserTurnWithCitations,
  getMusicalSelectionAnchor,
  isMutatingAction,
  limpiarTextoUsuario,
  listAgentDocs,
  seleccionarIniciales,
  sistemaAgente,
  writeAgentDoc,
} from '@jaswave/host-sdk'
import type {
  ActionResult,
  AgentMode,
  DawAction,
  EngineChatMessage,
  EventoAgente,
  Habilidad,
  HerramientaAgente,
  LlamadaAgente,
  MensajeAgente,
  ResultadoAgente,
  ResultadoHerramienta,
  TareaAgente,
  TiendaDAW,
  TurnContext,
  TurnProgramOutcome,
} from '@jaswave/host-sdk'

import { iaRemotaDisponible } from '../../ia/transporte-ia'
import { formatSessionRulesBlock, loadSessionRules } from '../agent-context-bridge'
import type { LegacyTurnContext } from '../agent-legacy-turn'
import { snapshotUndoDepth } from '../agent-turn-undo'
import { ID_PREGUNTA_AGENTE, isGreetingOrChitchat, isProjectStatusQuestion, sinOpcionesEnTexto } from '../ai-clarify'
import { getConversation, patchMessage, type ProgresoAgente, type StoredChatMessage } from '../ai-chat-store'
import { loadAiSettings } from '../ai-settings'
import { AGENTS_SLUG, PREFIJO_DOC_HABILIDAD, habilidadesDisponiblesAgente, instruccionesConfiguradas, prepararConfigAgente } from '../config-agente'
import { describeActionForUser } from '../describe-action'
import { chatDelMotor, type UltimoErrorIA } from './chat-agente'
import { catalogoAgente, habilidadesDisponibles, HERRAMIENTAS_BASE, nombreHerramientaHabilidad, perfilesSubagentes } from './catalogo-agente'
import {
  HERRAMIENTAS_CONFIG,
  afirmaCambioConfig,
  ejecutarHerramientaIde,
  sinAvisoModoConfigurar,
  herramientasConfig,
  herramientasIde,
  pideAprender,
  pideConfigurar,
  type EfectosIde,
} from './herramientas-ide'
import { conFuentesDelTurno, iniciarFuentesTurno } from './fuentes-turno'
import { fijarModoSesion, modoSesion, type ModoSesion } from './sesion-agente'

export const AGENTE_PROGRAM_ID = 'jaswave-agente'
export const CHAT_UPDATED = 'chat-updated'

/** Comando de barra que acompaña al turno (el texto del usuario llega sin prefijos). */
export type ComandoTurno = { tipo: 'meta' | 'plan' | 'entrevista' | 'configurar'; texto: string }

const SALIR = /^(parar|detener|cancelar|stop|quitar|salir|terminar|listo)$/i
export type ContextoTurnoAgente = Partial<LegacyTurnContext> & { comando?: ComandoTurno }

const MAX_CONTEXTO = 3500
const MAX_HISTORIAL = 8

type Estado = {
  pendientes: DawAction[]
  confirmar: DawAction[]
  resultados: ActionResult[]
  undoInicio: number | null
  progreso: ProgresoAgente
  ide: EfectosIde
}

/** Error del servicio en palabras del usuario (nunca JSON, códigos ni nombres de proveedores). */
export function mensajeErrorIA(error?: string, codigo?: string): string {
  if (codigo === 'rate_limit' || /cuota|l[ií]mite/i.test(error ?? '')) {
    return error && error.length < 180 && !/[{}<>]/.test(error) ? error : 'Has llegado al límite de uso de la IA por ahora. Inténtalo un poco más tarde.'
  }
  if (codigo === 'unauthorized') return 'Tu sesión caducó. Vuelve a iniciar sesión para usar el asistente.'
  if (codigo === 'forbidden' || codigo === 'missing_model') return 'Tu cuenta no tiene acceso al asistente. Pide acceso a tu administrador.'
  if (codigo === 'connection' || codigo === 'timeout') return 'No pude conectar con el asistente. Revisa tu conexión e inténtalo de nuevo.'
  return 'El asistente no pudo responder esta vez. Inténtalo de nuevo en un momento.'
}

function recortar(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function historialDe(conversationId: string, excluir: string[]): MensajeAgente[] {
  const msgs = (getConversation(conversationId)?.messages ?? []).filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && !excluir.includes(m.id) && m.content.trim(),
  )
  return msgs.slice(-MAX_HISTORIAL).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 1500) }))
}

/**
 * Contexto compacto: estado del proyecto, selección y efectos de la pista seleccionada. Lo demás (notas,
 * parámetros, documentos) el agente lo consulta con herramientas cuando lo necesita.
 */
function contextoProyecto(tienda: TiendaDAW, userText: string, projectId: string): string {
  const st = tienda.obtenerEstado()
  const partes: string[] = [recortar(buildReadOnlyProjectContext(st), MAX_CONTEXTO)]
  const reglasSesion = formatSessionRulesBlock(loadSessionRules(projectId))
  if (reglasSesion) partes.push(reglasSesion)
  const seleccion = formatMusicalSelectionForPrompt(getMusicalSelectionAnchor(), userText)
  if (seleccion) partes.push(recortar(seleccion, 1200))
  const sel = st.project?.tracks?.find((t) => t.id === st.selection?.idsPistas?.[0])
  if (sel?.plugins?.length) partes.push(`Efectos de la pista seleccionada «${sel.nombre}»: ${sel.plugins.map((p) => `${p.nombre}${p.bypass ? ' (apagado)' : ''}`).join(' → ')}`)
  try {
    const docs = listAgentDocs(projectId)
      .map((d) => d.slug)
      .filter((s) => s !== AGENTS_SLUG && s !== CONOCIMIENTO_SLUG && s !== PLAN_SLUG && !s.startsWith(PREFIJO_DOC_HABILIDAD))
    if (docs.length) partes.push(`Otros documentos del proyecto (léelos con las herramientas de documentos si hacen falta): ${docs.join(', ')}`)
  } catch {
    /* sin documentos */
  }
  return partes.filter(Boolean).join('\n\n')
}

/** Instrucciones del modo especial activo (plan, entrevista o meta). */
function bloqueModo(comando: ComandoTurno | undefined, sesion: ModoSesion | null): string {
  if (comando?.tipo === 'plan') {
    return [
      '## Modo plan',
      `Prepara un plan de trabajo${comando.texto ? ` para: «${comando.texto}»` : ' para lo que pide el usuario'}.`,
      'Investiga el proyecto con herramientas de lectura y crea la lista con `tareas`: pasos concretos y comprobables (qué pista, qué sección, qué sonido). No ejecutes cambios.',
      'Responde con la intención musical en 2–4 frases; el plan se guardará y el usuario podrá pedirte que lo ejecutes.',
    ].join('\n')
  }
  if (sesion?.tipo === 'entrevista') {
    return [
      '## Modo entrevista',
      `Estás alineando con el usuario las decisiones sobre: «${sesion.tema}».`,
      'Haz UNA pregunta cada vez con `preguntar`, con 3–5 opciones concretas y musicales (estilo, referencias, tempo, tonalidad, instrumentación, energía por sección, mezcla). Usa las respuestas anteriores del chat.',
      'Cuando tengas lo esencial (o el usuario diga que basta), no preguntes más: resume las decisiones en una lista breve y guarda las importantes con `aprender`.',
    ].join('\n')
  }
  if (sesion?.tipo === 'configurar') {
    return [
      '## Modo configurar asistente',
      `Ayudas al usuario a crear, editar o eliminar su configuración del asistente${sesion.tema ? ` (tema: «${sesion.tema}»)` : ''}: reglas para todos sus proyectos, habilidades (pasos que sigues en ciertos pedidos), prompts (instrucciones reutilizables) y planes. Se guardan como archivos en su carpeta de configuración, que también puede editar a mano.`,
      '1. Mira primero lo que ya tiene con `config_listar` (y `config_leer` antes de editar algo).',
      '2. Entrevístalo: UNA pregunta cada vez con `preguntar`, con 3–5 opciones concretas. Pon primero la que recomiendas y márcala con «(recomendado)»; explica en una frase por qué. Pregunta lo necesario: qué quiere lograr, cuándo debe aplicarse, pasos concretos, estilo, límites.',
      '3. Aporta tu criterio de productor: propone mejoras, avisa si algo choca con otra regla o habilidad, sugiere unir duplicados.',
      '4. Antes de guardar enséñale un borrador breve y pregunta con opciones (Guardar / Cambiar algo / Cancelar). Si ya te dio todo el detalle y pidió guardarlo, guárdalo directamente con `config_escribir`.',
      '5. Elimina con `config_eliminar` solo si el usuario lo pide; dile que se puede recuperar.',
      '6. En este modo no cambies el proyecto musical. Escribe en lenguaje sencillo, sin nombres de archivo ni rutas.',
      '7. Cada cambio se hace SOLO llamando a la herramienta `config_*` en este mismo turno. Nunca digas que creaste, cambiaste, borraste o recuperaste algo si la herramienta no respondió ok.',
    ].join('\n')
  }
  if (sesion?.tipo === 'meta') {
    return [
      '## Meta activa',
      `Objetivo: «${sesion.objetivo}».${sesion.progreso ? ` Avance anterior: ${sesion.progreso}` : ''}`,
      'Trabaja de forma autónoma hacia la meta: planifica con `tareas`, ejecuta, comprueba con herramientas de lectura o análisis y corrige.',
      'Al terminar el turno llama a `actualizar_meta`: `cumplida: true` solo si lo comprobaste en el proyecto; si no, describe qué falta.',
    ].join('\n')
  }
  return ''
}

/** plan.md a partir del plan del agente (intención + tareas como casillas). */
function planMarkdown(tareas: TareaAgente[], intencion: string, pedido: string): string {
  return [
    '# Plan',
    '',
    '## Intención',
    '### Qué se busca',
    intencion || pedido,
    '',
    '### Último pedido',
    pedido,
    '',
    '## Por implementar',
    ...tareas.filter((t) => t.estado !== 'hecha').map((t) => `- [ ] ${t.titulo}`),
    '',
    '## Implementado',
    ...tareas.filter((t) => t.estado === 'hecha').map((t) => `- [x] ${t.titulo}`),
  ].join('\n')
}

function accion(l: LlamadaAgente): DawAction {
  return { type: l.nombre, payload: l.argumentos ?? {} }
}

/** Resumen legible cuando el modelo terminó sin texto. */
function resumenDeLlamadas(r: ResultadoAgente, estado: Estado): string {
  const cambios = estado.resultados.filter((x) => x.success && isMutatingAction({ type: x.type }))
  if (estado.confirmar.length) return 'Necesito tu confirmación antes de seguir: revisa la tarjeta de abajo.'
  if (estado.pendientes.length) return 'Te dejé la propuesta lista: revisa la tarjeta y pulsa Aplicar.'
  if (cambios.length) return `Listo: hice ${cambios.length} cambio${cambios.length === 1 ? '' : 's'} en el proyecto. Puedes deshacerlos desde esta respuesta.`
  if (r.llamadas.length) return 'He revisado el proyecto.'
  return 'Listo.'
}

export async function runTurnoAgente(ctx: TurnContext, tienda: TiendaDAW): Promise<TurnProgramOutcome> {
  const lc = (ctx.input.context ?? {}) as ContextoTurnoAgente
  const conversationId = ctx.run.conversationId
  const userMsgId = lc.userMsgId ?? ''
  const assistantMsgId = lc.assistantMsgId ?? ctx.run.messageId ?? ''
  const projectId = lc.projectId ?? (tienda.obtenerEstado().project?.id || 'default')
  const comando = lc.comando
  // El mensaje visible conserva «/meta …»; el agente recibe solo el pedido.
  const userText = comando ? ctx.run.userText.replace(/^\s*\/[\p{L}-]+\s*/u, '') : ctx.run.userText
  const cfg = loadAiSettings()
  iniciarFuentesTurno()

  const tocar = () => ctx.emit({ type: 'agent.message', role: ctx.run.role, text: '', data: { kind: CHAT_UPDATED } })
  const guardar = (patch: Partial<StoredChatMessage>) => {
    patchMessage(conversationId, assistantMsgId, patch, projectId)
    tocar()
  }
  const terminarCon = (texto: string, extra: Partial<StoredChatMessage> = {}): TurnProgramOutcome => {
    guardar({ content: texto, ...extra })
    return { status: 'completed', summary: texto }
  }

  // Modos que duran varios mensajes.
  if (comando?.tipo === 'meta') {
    if (SALIR.test(comando.texto.trim())) {
      fijarModoSesion(conversationId, null)
      return terminarCon('Meta detenida. Seguimos con normalidad.')
    }
    fijarModoSesion(conversationId, { tipo: 'meta', objetivo: comando.texto, inicio: Date.now() })
  } else if (comando?.tipo === 'entrevista') {
    fijarModoSesion(conversationId, { tipo: 'entrevista', tema: comando.texto || userText || 'el estilo, la instrumentación y la mezcla del tema', inicio: Date.now() })
  } else if (comando?.tipo === 'configurar') {
    if (SALIR.test(comando.texto.trim())) {
      fijarModoSesion(conversationId, null)
      return terminarCon('Listo, salimos de la configuración. Seguimos con la música.')
    }
    fijarModoSesion(conversationId, { tipo: 'configurar', tema: comando.texto, inicio: Date.now() })
  }
  const sesion = modoSesion(conversationId)
  const configurando = sesion?.tipo === 'configurar'
  await prepararConfigAgente().catch(() => undefined)

  const modoBase = ctx.run.mode as AgentMode
  const modo: AgentMode = comando?.tipo === 'plan' ? 'plan' : sesion?.tipo === 'entrevista' || configurando ? 'ask' : modoBase
  const soloLectura = esModoSoloLectura(modo)
  const sugerir = !soloLectura && autonomyBlocksMutation()

  // Atajos locales: sin gastar modelo.
  const estadoDaw = tienda.obtenerEstado()
  if (!comando && !sesion && isGreetingOrChitchat(userText)) return terminarCon('¡Hola! Dime qué quieres crear o cambiar: una canción, una pista, la mezcla, el tempo…')
  if (!iaRemotaDisponible()) {
    return terminarCon('El asistente no está disponible ahora mismo. Inicia sesión o revisa tu conexión para usarlo.')
  }

  const historial = historialDe(conversationId, [userMsgId, assistantMsgId])
  const citados = collectCitedMessages(userText, lc.citedIds ?? [], estadoDaw, (getConversation(conversationId)?.messages ?? []) as never)
  const pedidoBase =
    userText.trim() ||
    comando?.texto ||
    (comando?.tipo === 'entrevista'
      ? 'Entrevístame para definir el estilo, la instrumentación y la mezcla del tema.'
      : comando?.tipo === 'plan'
        ? 'Prepara un plan de trabajo para este proyecto.'
        : comando?.tipo === 'configurar'
          ? 'Ayúdame a configurar mi asistente: revisa lo que tengo y recomiéndame qué crear o mejorar.'
          : '')
  const pedido = citados.length ? formatUserTurnWithCitations(pedidoBase, citados) : pedidoBase

  const habilidades = habilidadesDisponibles()
  const habilidadesUsuario = habilidadesDisponiblesAgente(projectId)
  const puedeAprender = sesion?.tipo === 'entrevista' || pideAprender(userText)
  const editaConfig = configurando || pideConfigurar(userText)
  const catalogo: HerramientaAgente[] = [
    ...herramientasIde({ habilidades: habilidadesUsuario, aprender: puedeAprender, meta: sesion?.tipo === 'meta' }),
    ...herramientasConfig({ escribir: editaConfig }),
    ...catalogoAgente({ rol: ctx.run.role, habilidades }),
  ]
  const habilidadPorHerramienta = new Map(habilidades.map((h) => [nombreHerramientaHabilidad(h), h]))
  const sugerida = soloLectura || isProjectStatusQuestion(userText) ? null : elegirHabilidad({ userText: pedidoBase, state: estadoDaw }, habilidades)
  const subagentes = perfilesSubagentes(catalogo)

  const estado: Estado = {
    pendientes: [],
    confirmar: [],
    resultados: [],
    undoInicio: null,
    progreso: { estado: 'trabajando', tareas: [], actividad: [], subagentes: [], inicio: Date.now() },
    ide: { reglas: [], tareas: [], config: [] },
  }
  const publicarProgreso = () => guardar({ agente: { ...estado.progreso } })
  publicarProgreso()

  const contexto = contextoProyecto(tienda, pedidoBase, projectId)
  const sistema = sistemaAgente({
    modo,
    contexto,
    subagentes,
    instruccionesExtra: [
      instruccionesConfiguradas(projectId),
      bloqueModo(comando, sesion),
      sugerida ? `Para este pedido tienes la habilidad «${sugerida.nombre}» (${nombreHerramientaHabilidad(sugerida)}): úsala si encaja, hace el trabajo completo con calidad.` : '',
      sugerir ? 'El usuario quiere revisar los cambios antes de aplicarlos: tus ediciones quedarán como propuesta.' : '',
      puedeAprender && sesion?.tipo !== 'entrevista' ? 'El usuario te está indicando una preferencia: guárdala con `aprender` además de aplicarla.' : '',
      editaConfig && !configurando
        ? 'El usuario quiere cambiar su configuración del asistente (habilidades, prompts, planes o reglas): usa las herramientas `config_*`; si falta detalle, pregunta con opciones y recomienda una.'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  })

  const marcarEscritura = () => {
    if (estado.undoInicio == null) {
      estado.undoInicio = snapshotUndoDepth(tienda)
      void ctx.captureSnapshot('turn')
    }
  }

  const ejecutarHabilidad = async (h: Habilidad, l: LlamadaAgente): Promise<ResultadoHerramienta> => {
    const texto = String(l.argumentos.pedido ?? pedidoBase)
    const st = tienda.obtenerEstado()
    const [sis, ...usr] = h.mensajesBrief({ userText: texto, state: st })
    const r = await ctx.chat({
      purpose: 'reasoning',
      system: sis?.content,
      messages: [{ role: 'user', content: usr.map((m) => m.content).join('\n\n') }],
      temperature: Math.min(0.95, Math.max(cfg.temperature, 0.7)),
      maxTokens: Math.max(cfg.maxTokens, 8000),
      skipPlan: true,
    })
    const plan = h.planificar({ userText: texto, state: st }, r.success ? (r.content ?? null) : null)
    if (plan.preguntas?.length) return { ok: false, error: `Falta información: ${plan.preguntas.join(' ')}` }
    const acciones = plan.acciones as DawAction[]
    if (sugerir) {
      estado.pendientes.push(...acciones)
      return { ok: true, resumen: plan.resumen, datos: { propuesto: true, decisiones: plan.decisiones.slice(0, 8) } }
    }
    marcarEscritura()
    const res = await executeDawActions(tienda, acciones, {
      agentMode: 'create',
      forceApply: true,
      source: 'model_actions',
      conversationId,
      messageId: assistantMsgId,
    })
    estado.resultados.push(...res)
    const fallos = res.filter((x) => !x.success)
    // Si todo falló, es un fallo. Si fue parcial, lo hecho ya está aplicado: el modelo debe corregir
    // solo lo que falló con herramientas concretas (repetir la habilidad duplicaría lo bueno).
    if (res.length && fallos.length === res.length) {
      return { ok: false, error: `La habilidad no pudo aplicar ningún cambio: ${fallos.slice(0, 3).map((x) => x.message).join(' · ')}`, resumen: plan.resumen }
    }
    return {
      ok: true,
      resumen: plan.resumen,
      datos: {
        decisiones: plan.decisiones.slice(0, 8),
        aplicadas: res.length - fallos.length,
        ...(fallos.length
          ? {
              parcial: true,
              fallos: fallos.slice(0, 6).map((x) => `${x.type}: ${x.message}`),
              aviso: `${fallos.length} de ${res.length} cambios fallaron. Corrige solo esos con herramientas concretas; no repitas la habilidad.`,
            }
          : {}),
      },
    }
  }

  const ejecutar = async (l: LlamadaAgente, h: HerramientaAgente): Promise<ResultadoHerramienta> => {
    const ide = await ejecutarHerramientaIde(l, { projectId, habilidades: habilidadesUsuario, efectos: estado.ide })
    if (ide) return ide
    const hab = habilidadPorHerramienta.get(h.nombre)
    if (hab) return ejecutarHabilidad(hab, l)
    const a = accion(l)
    const etiqueta = describeActionForUser(a, tienda.obtenerEstado()).label
    // La clase real depende también de los argumentos (p. ej. midi.notes.set con lista vacía borra todo).
    const claseReal = agentActionClass(a)
    if (h.clase === 'destructiva' || claseReal === 'destructive' || claseReal === 'system') {
      estado.confirmar.push(a)
      return { ok: true, pendienteConfirmacion: true, resumen: etiqueta }
    }
    if (h.clase === 'escritura' && sugerir) {
      estado.pendientes.push(a)
      return { ok: true, resumen: etiqueta, datos: { propuesto: true } }
    }
    if (h.clase === 'escritura') marcarEscritura()
    const [r] = await ctx.executeTools([{ id: l.id, name: l.nombre, arguments: l.argumentos ?? {} }])
    const ok = r?.status === 'success'
    estado.resultados.push({ type: l.nombre, success: ok, message: r?.error?.message ?? etiqueta, data: r?.data } as ActionResult)
    return ok ? { ok, datos: r?.data, resumen: etiqueta } : { ok: false, error: r?.error?.message ?? 'No se pudo completar.', resumen: etiqueta }
  }

  let textoVivo = ''
  const alEvento = (e: EventoAgente) => {
    const p = estado.progreso
    if (e.tipo === 'texto') {
      if (e.agente === 'jas') {
        textoVivo += e.delta
        ctx.emit({ type: 'agent.delta', role: ctx.run.role, text: e.delta })
      }
      return
    }
    if (e.tipo === 'paso') {
      if (e.agente === 'jas' && textoVivo) {
        textoVivo = ''
        ctx.emit({ type: 'agent.message', role: ctx.run.role, text: '', data: { kind: 'stream-reset' } })
      }
      return
    }
    if (e.tipo === 'tareas') p.tareas = e.tareas
    else if (e.tipo === 'herramienta') {
      const id = `${e.agente}:${e.nombre}:${p.actividad.filter((x) => x.texto === e.titulo).length}`
      if (e.fase === 'inicio') p.actividad = [...p.actividad, { id, texto: e.titulo, estado: 'en_curso' as const, quien: e.agente === 'jas' ? undefined : e.agente }].slice(-40)
      else {
        const i = p.actividad.map((x) => x.texto === e.titulo && x.estado === 'en_curso').lastIndexOf(true)
        if (i >= 0) p.actividad[i] = { ...p.actividad[i]!, estado: e.ok ? 'ok' : 'error' }
      }
    } else if (e.tipo === 'subagente') {
      if (e.fase === 'inicio') p.subagentes = [...p.subagentes, { id: e.id, nombre: e.nombre, tarea: limpiarTextoUsuario(e.tarea).slice(0, 140), estado: 'en_curso' }]
      else p.subagentes = p.subagentes.map((s) => (s.id === e.id ? { ...s, estado: e.ok ? 'ok' : 'error', resumen: limpiarTextoUsuario(e.resumen ?? '').slice(0, 200) } : s))
    }
    publicarProgreso()
  }

  const ultimoError: UltimoErrorIA = {}
  const correr = (p: string) => ejecutarAgente({
    pedido: p,
    historial,
    catalogo,
    base: HERRAMIENTAS_BASE,
    iniciales: [
      ...(sugerida ? [nombreHerramientaHabilidad(sugerida)] : []),
      ...catalogo
        .filter(
          (h) =>
            h.nombre === 'leer_habilidad' ||
            h.nombre === 'aprender' ||
            h.nombre === 'actualizar_meta' ||
            (editaConfig && HERRAMIENTAS_CONFIG.includes(h.nombre)),
        )
        .map((h) => h.nombre),
      ...seleccionarIniciales(pedido, catalogo, { base: HERRAMIENTAS_BASE, max: 18 }),
    ],
    sistema,
    soloLectura,
    subagentes,
    contextoSubagentes: contexto.slice(0, 1500),
    maxPasos: sesion?.tipo === 'meta' ? 24 : 12,
    maxSubagentes: sesion?.tipo === 'entrevista' || configurando ? 0 : 4,
    signal: ctx.signal,
    onEvento: alEvento,
    ejecutar,
    chat: chatDelMotor(ctx, cfg, ultimoError),
  })
  let r = await correr(pedido)

  // El modelo a veces dice «la borré» sin haber llamado a `config_*`: se le exige hacerlo una vez y, si
  // tampoco, se dice la verdad en lugar de dar por hecho un cambio que no ocurrió.
  const terminoNormal = () => r.estado !== 'pregunta' && r.estado !== 'cancelado' && r.estado !== 'fallo'
  const afirmaSinHacer = () => editaConfig && terminoNormal() && !estado.ide.config.length && afirmaCambioConfig(r.texto || textoVivo)
  let cambioNoHecho = false
  if (afirmaSinHacer()) {
    textoVivo = ''
    ctx.emit({ type: 'agent.message', role: ctx.run.role, text: '', data: { kind: 'stream-reset' } })
    r = await correr(
      `${pedido}\n\n(Aviso del sistema: en tu respuesta anterior dijiste que hiciste el cambio, pero no llamaste a ninguna herramienta \`config_*\`, así que NO está hecho. Si el usuario pidió ese cambio, hazlo ahora con la herramienta; si no lo pidió, responde sin afirmar que lo hiciste.)`,
    )
    cambioNoHecho = afirmaSinHacer()
  }

  // Cierre: texto limpio, tarjetas, modos y estado final.
  const nombres = catalogo.map((h) => h.nombre)
  let texto = limpiarTextoUsuario(r.texto || textoVivo, { nombresHerramientas: nombres })
  // Siempre: fuera del modo el modelo también lo copia del historial y confunde al usuario.
  texto = sinAvisoModoConfigurar(texto)
  if (cambioNoHecho) texto = 'No llegué a hacer ese cambio en tu configuración. ¿Quieres que lo intente otra vez?'
  const extra: Partial<StoredChatMessage> = {}
  if (r.estado === 'cancelado') texto = texto || 'Detenido.'
  else if (r.estado === 'fallo' && !r.llamadas.length) texto = mensajeErrorIA(ultimoError.error ?? r.error, ultimoError.codigo)
  else if (r.estado === 'limite' && !texto) texto = 'Avancé todo lo que pude en este turno. Dime «continúa» para seguir.'
  else if (!texto) texto = resumenDeLlamadas(r, estado)

  if (r.estado === 'pregunta' && r.pregunta) {
    texto = limpiarTextoUsuario(r.pregunta.texto) || texto
    if (r.pregunta.opciones.length) {
      texto = sinOpcionesEnTexto(texto, r.pregunta.opciones)
      extra.clarifications = {
        status: 'pending',
        questions: [{ id: ID_PREGUNTA_AGENTE, question: texto, options: r.pregunta.opciones.map((x) => limpiarTextoUsuario(x)), allowCustom: true }],
      }
    }
  }

  const notas: string[] = []
  if (sesion?.tipo === 'entrevista' && r.estado !== 'pregunta' && r.estado !== 'fallo' && r.estado !== 'cancelado') {
    fijarModoSesion(conversationId, null)
  }
  if (sesion?.tipo === 'meta' && r.estado !== 'fallo' && r.estado !== 'cancelado') {
    if (estado.ide.metaCumplida) {
      fijarModoSesion(conversationId, null)
      notas.push('Meta cumplida.')
    } else {
      fijarModoSesion(conversationId, { ...sesion, progreso: estado.ide.progresoMeta || sesion.progreso })
      notas.push('La meta sigue activa: escribe «continúa» para que siga trabajando o «/meta parar» para dejarla.')
    }
  }
  if (comando?.tipo === 'plan' && estado.progreso.tareas.length && r.estado !== 'fallo' && r.estado !== 'cancelado') {
    try {
      writeAgentDoc(projectId, PLAN_SLUG, planMarkdown(estado.progreso.tareas, texto, pedidoBase), { origin: 'ai' })
      notas.push('Guardé el plan en el proyecto. Cuando quieras, dime «ejecuta el plan».')
    } catch {
      /* sin permiso para editar documentos: el plan queda en el chat */
    }
  }
  if (estado.ide.reglas.length) notas.push(`Lo recordaré: ${estado.ide.reglas.map((x) => `«${x}»`).join(', ')}.`)
  if (estado.ide.tareas.length) notas.push(`Programado: ${estado.ide.tareas.join('; ')}.`)
  if (estado.ide.config.length) notas.push(`${estado.ide.config.join('. ')}.`)
  if (configurando && r.estado !== 'fallo' && r.estado !== 'cancelado') {
    notas.push('Sigues en el modo configurar: pídeme más cambios o escribe «/configurar salir» para volver a la música.')
  }
  if (notas.length && r.estado !== 'pregunta') texto = [texto, notas.join(' ')].filter(Boolean).join('\n\n')

  if (estado.confirmar.length) {
    extra.confirmActions = {
      status: 'pending',
      actions: estado.confirmar,
      reason: 'Este cambio borra o reemplaza contenido. ¿Quieres que lo haga?',
    }
  }
  if (estado.pendientes.length) {
    extra.pendingActions = {
      status: 'pending',
      actions: estado.pendientes,
      agentMode: 'create',
      previewSummary: `${estado.pendientes.length} cambio${estado.pendientes.length === 1 ? '' : 's'} por aplicar`,
    }
  }
  const huboCambios = estado.resultados.some((x) => x.success && isMutatingAction({ type: x.type }))
  if (estado.undoInicio != null && huboCambios) extra.undoDepthAtStart = estado.undoInicio
  estado.progreso = {
    ...estado.progreso,
    estado: r.estado === 'cancelado' ? 'detenido' : r.estado === 'fallo' ? 'error' : 'listo',
    actividad: estado.progreso.actividad.map((a) =>
      a.estado === 'en_curso' ? { ...a, estado: r.estado === 'fallo' ? ('error' as const) : ('ok' as const) } : a,
    ),
    fin: Date.now(),
  }
  extra.agente = estado.progreso
  texto = conFuentesDelTurno(texto)
  guardar({ content: texto, ...extra })

  if (r.estado === 'cancelado') throw new DOMException('Aborted', 'AbortError')
  if (extra.pendingActions) {
    return {
      status: 'needs-user',
      summary: texto,
      need: { id: ctx.newId('need'), kind: 'apply', message: extra.pendingActions.previewSummary ?? 'Cambios por aplicar', data: { messageId: assistantMsgId } },
    }
  }
  if (r.estado === 'fallo' && !r.llamadas.length) return { status: 'failed', error: texto }
  return { status: 'completed', summary: texto, data: { estado: r.estado, pasos: r.pasos } }
}
