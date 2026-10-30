import { ejecutarLeerHabilidad, H_LEER_HABILIDAD, herramientaLeerHabilidad, listadoHabilidades, unirHabilidades, type HabilidadAgente } from './habilidades'
import { asignarPistasHuerfanas, separarPistasExtra } from './duenos'
import { Candado, ejecutarAgente, type EjecutorHerramienta } from './runtime'
import { seleccionarIniciales } from './seleccion'
import { crearCronometro, formatearDuracion, LIMITE_MS_DEFECTO, PRESUPUESTO_MS_DEFECTO, resumenTiempos, type MotivoOmision, type TiemposProduccion } from './tiempos'
import type { ChatAgente, EventoAgente, HerramientaAgente, PerfilSubagente, RegistroLlamada, ResultadoAgente, ResultadoHerramienta } from './tipos'
import type { EstadoProduccionGuardado } from './diario'

/**
 * Producción por etapas con agentes reales (G8): Planificador → Director → Músicos (en paralelo) → QA
 * (rondas de corrección) → Mezcla → QA → Máster → QA → entrega.
 *
 * Cada participante es un agente LLM con sus instrucciones y su subconjunto de herramientas. Las escrituras
 * de agentes que trabajan a la vez se serializan con un candado común. El QA combina la medición del host
 * (LUFS, picos, análisis por pista) con el veredicto de un agente que solo puede consultar.
 */

export type RolProduccion = 'planificador' | 'director' | 'musico' | 'coherencia' | 'qa' | 'mezcla' | 'master'

export type ParticipanteProduccion = PerfilSubagente & { rol: RolProduccion }

export type EtapaProduccion = 'plan' | 'direccion' | 'musicos' | 'ensayo' | 'coherencia' | 'qa_musicos' | 'mezcla' | 'qa_mezcla' | 'master' | 'qa_master' | 'entrega'

/** Arreglista por defecto: siempre hay quien vigile la coherencia aunque el usuario no lo haya configurado. */
export const ARREGLISTA_POR_DEFECTO: ParticipanteProduccion = {
  id: 'arreglista',
  nombre: 'Arreglista',
  rol: 'coherencia',
  descripcion: 'Coherencia de tiempo, armonía y ritmo entre todas las partes',
  instrucciones: '',
}

/** Máximo de rondas del arreglista (medir → corregir → medir). */
const RONDAS_COHERENCIA = 2
/** Rondas de ensayo (escuchar → proponer → acordar → ajustar). Una basta: la coherencia y el QA vienen después. */
const RONDAS_ENSAYO = 1
/** Ajustes acordados que recibe un mismo músico por ronda de ensayo. */
const MAX_AJUSTES_POR_MUSICO = 3
/** Veces que un músico retoma su parte si la medición dice que le faltan secciones. */
export const MAX_REINTENTOS_COMPLETITUD = 3

/** Etapas revisables y qué mide el host en cada una. */
export type EtapaMedible = 'musicos' | 'mezcla' | 'master'

export type ProblemaQA = { /** Id del participante que debe corregirlo (si se sabe). */ quien?: string; problema: string }
export type VeredictoQA = { aprobado: boolean; problemas: ProblemaQA[]; resumen: string }
export type MedicionQA = { ok: boolean; detalles: string[] }

export type Encargo = {
  participante: string
  encargo: string
  /**
   * Pista del músico (id, o nombre exacto). Con ella, sus escrituras en otra pista se rechazan: en paralelo,
   * un músico no puede pisar la parte de otro (se vio al bajista creando clips en «Cuerdas»).
   */
  pista?: string
  /** Otras pistas que también lleva este músico (plan S: pistas huérfanas repartidas tras la dirección). */
  pistasExtra?: string[]
  /** Texto original del encargo antes de ampliarlo con las pistas extra (para repartirlas en turnos propios). */
  encargoBase?: string
  /** Texto del encargo de cada pista extra, por id de pista. */
  textosExtra?: Record<string, string>
}

/** A quién se devuelve un trabajo que no es del oficio de quien lo detecta. */
export type DestinoDevolucion = 'musicos' | 'arreglista' | 'mezcla'
export type Devolucion = { destino: DestinoDevolucion; musico?: string; problema: string }

/**
 * Ensayo: cada músico escucha a los demás y dice si está conforme con cómo encaja el conjunto; lo que no le
 * cuadra lo propone como ajuste concreto (a su propia parte o a la de otro). El director arbitra y lo acordado
 * se toca de nuevo. Así la banda se pone de acuerdo antes de que el arreglista y el QA revisen.
 */
export type PropuestaEnsayo = { de: string; para: string; ajuste: string }
export type AjusteAcordado = { musico: string; ajuste: string }

export type EventoProduccion =
  | { tipo: 'devolucion'; etapa: EtapaProduccion; participante: { id: string; nombre: string; rol: RolProduccion }; devolucion: Devolucion }
  | { tipo: 'ensayo'; ronda: number; conformes: string[]; propuestas: PropuestaEnsayo[]; acordados: AjusteAcordado[]; nota?: string }
  | { tipo: 'etapa'; etapa: EtapaProduccion; fase: 'inicio' | 'fin'; ronda?: number; ok?: boolean; resumen?: string }
  | { tipo: 'agente'; etapa: EtapaProduccion; participante: { id: string; nombre: string; rol: RolProduccion }; evento: EventoAgente }
  | { tipo: 'encargos'; encargos: Encargo[] }
  /** Plan S: pistas sin encargo que se asignaron a un músico (`rescate` = estaba vacía tras la grabación y se le pidió tocarla). */
  /** Plan S: resultado de la coordinación vertical de las voces. */
  | { tipo: 'coordinacion'; resumen: string }
  | { tipo: 'pistas_asignadas'; asignaciones: Array<{ pista: string; nombre: string; participante: string; rescate?: boolean }> }
  | { tipo: 'participante'; etapa: EtapaProduccion; participante: { id: string; nombre: string; rol: RolProduccion }; estado: ResultadoAgente['estado']; error?: string }
  | { tipo: 'qa'; etapa: EtapaProduccion; ronda: number; veredicto: VeredictoQA; medicion?: MedicionQA | null }
  /** Una indicación del usuario llegó al agente en turno (en mitad de su trabajo). */
  | { tipo: 'nota'; etapa: EtapaProduccion; participante: { id: string; nombre: string; rol: RolProduccion }; texto: string }
  /** Duración de reloj y peticiones de una etapa (o de un tramo de ella) recién terminada. `totalMs` = desde que empezó la producción. */
  | { tipo: 'tiempo'; etapa: EtapaProduccion; ms: number; peticiones: number; totalMs: number }
  /** Una medición del host (LUFS, picos, partes…) terminó; `ok` = null si no fue medible. */
  | { tipo: 'medicion'; etapa: EtapaMedible; ms: number; ok: boolean | null }
  /** Se omitió un refinamiento (por tiempo o por falta de progreso). */
  | { tipo: 'omitido'; que: string; motivo: MotivoOmision; texto: string; totalMs: number }
  /** Al terminar: todos los tiempos de la producción. */
  | { tipo: 'tiempos'; tiempos: TiemposProduccion }
  /** Plan y hoja de ruta ya definidos (el diario los guarda para poder reanudar). */
  | { tipo: 'plan_definido'; plan: string; hoja: HojaDeRuta | null }
  /** Una etapa terminó con este informe (el diario lo usa para saltarla al reanudar). */
  | { tipo: 'informe'; informe: InformeEtapa }
  /** La parte de un músico se dio por terminada (completa o agotados los reintentos). */
  | { tipo: 'musico'; participante: string; ok: boolean }
  /** Se aplicó el máster mínimo determinista (sin modelo) tras superar el límite de tiempo. */
  | { tipo: 'master_minimo'; ok: boolean; resumen: string }
  /** Plan T: mezcla inicial determinista (sin modelo) aplicada justo antes de la etapa de mezcla del modelo. */
  | { tipo: 'mezcla_inicial'; ok: boolean; aplicada: boolean; resumen: string; perfil?: string }

/** Indicación del usuario durante la producción; `para` = id del participante al que va dirigida (si falta, a todos). */
export type NotaUsuario = { texto: string; para?: string }

export type InformeEtapa = { etapa: EtapaProduccion; ok: boolean; resumen: string; rondas?: number }

export type ResultadoProduccionAgentes = {
  estado: 'completado' | 'con_avisos' | 'fallo' | 'cancelado'
  plan: string
  etapas: InformeEtapa[]
  encargos: Encargo[]
  llamadas: RegistroLlamada[]
  /** Resumen para el usuario. */
  texto: string
  /** Duración y peticiones por etapa, mediciones y refinamientos omitidos. */
  tiempos?: TiemposProduccion
}

export type ConfigProduccion = {
  pedido: string
  catalogo: HerramientaAgente[]
  base?: string[]
  participantes: ParticipanteProduccion[]
  chat: ChatAgente
  ejecutar: EjecutorHerramienta
  /** Resumen actual del proyecto (se vuelve a pedir antes de cada etapa). */
  contexto?: () => string | Promise<string>
  /** Medición determinista del host para el QA; null = no medible. */
  medir?: (etapa: EtapaMedible) => Promise<MedicionQA | null>
  /**
   * Resuelve una referencia de pista (id o nombre) a la pista real, para comprobar que cada músico escribe
   * solo en la suya. Sin él, se compara el texto tal cual.
   */
  resolverPista?: (ref: string) => { id: string; nombre: string } | null
  /**
   * Plan S: pistas de instrumento del proyecto (no máster ni bus) con cuántas notas tienen. Tras la dirección, las
   * que no tienen encargo se asignan al músico más afín; si tras la grabación una sigue con 0 notas, su dueño
   * recibe un rescate (una vez).
   */
  pistas?: () => Array<{ id: string; nombre: string; tipo?: string; notas?: number }>
  /**
   * Plan S: coordinación vertical determinista al terminar los músicos (choques de segunda menor entre pistas, pad que
   * sigue al acorde, bajo en el bajo de la barra). Devuelve una línea de resumen para el usuario o null. Un fallo no
   * detiene la producción.
   */
  afinarConjunto?: () => string | null | Promise<string | null>
  /**
   * Herramientas de oficio que cada rol ve desde el principio (p. ej. el músico, crear clips y notas). Sin
   * ellas la selección por relevancia del encargo puede dejarle solo consultas.
   */
  herramientasPorRol?: Partial<Record<RolProduccion, string[]>>
  /**
   * Habilidades de serie por rol (conocimiento de oficio: método del baterista, de la mezcla, del máster…).
   * Cada participante las ve listadas junto a las suyas (`PerfilSubagente.habilidades`) y lee con
   * `leer_habilidad` solo la que aplica a su encargo.
   */
  habilidadesPorRol?: Partial<Record<RolProduccion, HabilidadAgente[]>>
  /**
   * Resumen de las partes ya grabadas (por pista y sección: registro, ritmo, intensidad), para que cada músico
   * «escuche» a los demás y responda a lo que tocan. Sin él, los músicos graban a ciegas.
   */
  partes?: () => string | Promise<string>
  /**
   * Medición determinista de la coherencia de todas las partes con la hoja de ruta: tiempo (secciones,
   * rejilla, final), armonía (tonalidad, acorde de cada compás, bajo en la fundamental) y ritmo (bajo con el
   * bombo). Con problemas, el arreglista corrige las notas y se vuelve a medir.
   */
  coherencia?: (hoja: HojaDeRuta) => MedicionQA | Promise<MedicionQA>
  /**
   * Completitud de la parte de un músico frente a la hoja de ruta: devuelve qué secciones le faltan (texto
   * accionable) o null si está completa. Mientras falte algo, el músico retoma su parte (hasta
   * `MAX_REINTENTOS_COMPLETITUD` veces) en lugar de dar el trabajo por terminado a medias.
   */
  completitud?: (encargo: Encargo, hoja: HojaDeRuta) => string | null | Promise<string | null>
  /**
   * Ensayo de la banda tras grabar (por defecto, cuando hay dos o más músicos): cada uno escucha a los demás,
   * propone ajustes y el director arbitra; lo acordado se vuelve a tocar. `false` lo desactiva.
   */
  ensayo?: boolean
  /**
   * Diagnóstico inmediato de la pista del músico tras una escritura MIDI (qué secciones faltan, variedad de
   * duraciones y velocidades, defectos de tiempo y armonía de SU pista). Texto corto o null si está todo bien.
   */
  diagnostico?: (encargo: Encargo, hoja: HojaDeRuta) => string | null | Promise<string | null>
  /** Se llama al fijarse la hoja de ruta (el guardia de armonía de las escrituras la necesita). */
  alDefinirHoja?: (hoja: HojaDeRuta) => void
  /**
   * Guía de armonía del músico (acordes de SUS secciones con las notas permitidas ya calculadas): se añade a su
   * encargo. null = nada que añadir (p. ej. batería).
   */
  guiaArmonia?: (encargo: Encargo, hoja: HojaDeRuta) => string | null
  /** Palancas de ahorro de tokens; `false` = comportamiento anterior. Por defecto, todas activas. */
  ahorro?: boolean | Partial<AhorroProduccion>
  maxRondasQA?: number
  maxPasos?: number
  /** Tope de reloj por intento de cada rol (ms). Pasado, se aborta al agente y se sigue con lo que hizo. Por defecto: ver `TOPE_AGENTE_MS_DEFECTO`. */
  topesAgenteMs?: Partial<Record<RolProduccion, number>>
  /** Mediciones `analysis.*` seguidas que puede hacer el QA antes de que se le pida el veredicto (por defecto 4). */
  maxAnalisisSeguidos?: number
  /** Cada cuántos ms (reloj real) se vigilan los topes de los agentes (por defecto 1000). */
  vigilanciaMs?: number
  /**
   * Tiempo de reloj objetivo (ms; por defecto 15 min). Al agotarlo se sacrifican los refinamientos en orden, según la
   * fracción de la ventana presupuesto→límite que se haya consumido: al 0 % el ensayo y la revisión de partes por el
   * modelo; al 20 % las rondas extra del arreglista (máx. 1); al 40 % la segunda ronda de corrección de mezcla/máster;
   * al 60 % la revisión de la mezcla. Infinity lo desactiva.
   */
  presupuestoMs?: number
  /**
   * Tope duro (ms; por defecto 30 min). Al superarlo se entrega lo que hay: la grabación de los músicos y la
   * medición final no se saltan. `Infinity` lo desactiva.
   */
  limiteMs?: number
  /** Reloj en ms (por defecto `Date.now`); inyectable para pruebas. */
  reloj?: () => number
  /**
   * Los músicos de la segunda oleada empiezan en cuanto la base termina su primera pasada (los reintentos por
   * completitud de la base corren a la vez que ellos). Por defecto activo; `false` = esperar a la base entera.
   */
  solaparOleadas?: boolean
  instruccionesExtra?: string
  /**
   * Estilo de interpretación del usuario (skill «estilo-<slug>» aprendida de su teclado): resumen en español con
   * números (micro-tiempos, dinámica, legato, pedal, rubato). Solo lo ven los músicos; tras cada uno, la app
   * aplica el perfil a su pista.
   */
  estiloMusical?: string
  /**
   * Indicaciones que el usuario escribe mientras la banda trabaja (lo que él ve y oye en el DAW y los agentes
   * no). Se consulta a menudo y debe devolver solo las nuevas: cada agente activo las recibe entre dos pasos y
   * los que empiezan después las ven en su contexto. Con `para`, solo las ve ese participante.
   */
  notasUsuario?: () => Array<string | NotaUsuario>
  onEvento?: (e: EventoProduccion) => void
  signal?: AbortSignal
  /**
   * Plan Q: continúa una producción interrumpida (estado reconstruido del diario). Salta las etapas terminadas,
   * restaura plan, hoja y encargos, mide la completitud de cada músico y solo repite a los incompletos.
   */
  reanudar?: EstadoProduccionGuardado
  /**
   * Plan Q: se llama al terminar cada etapa y cada músico (`que` = «etapa:mezcla», «musico:bat»…) para que la
   * app guarde un punto de control del proyecto. Un fallo aquí nunca detiene la producción.
   */
  alPuntoDeControl?: (que: string) => void | Promise<void>
  /**
   * Plan Q: máster mínimo determinista, SIN modelo (limitador true-peak a −1 dBTP + normalización a −14 LUFS con los
   * comandos de máster existentes). Pasado `limiteMs` se ejecuta siempre en lugar de entregar la canción sin limitador.
   */
  masterMinimo?: () => Promise<{ ok: boolean; resumen: string }>
  /**
   * Plan T: mezcla inicial determinista (ganancias por rol, filtros, paneo, reverb, balance espectral y dinámica por
   * sección), SIN modelo. Se llama una vez justo antes de la etapa de mezcla; el modelo de mezcla pasa a solo afinar con
   * pocos pasos. Debe acotar su propia medición y no lanzar.
   */
  mezclaInicial?: (hoja: HojaDeRuta | null, ctx: { estilo?: string; pedido: string }) => Promise<{ ok: boolean; aplicada: boolean; resumen: string; perfil?: string; guion?: string }>
  /** Plan T: estilo/género que fijó el productor (ajuste); manda sobre el que emita el planificador en la hoja de ruta. */
  estilo?: string
  /** Plan T: peticiones al modelo por ronda de la revisión de partes (revisión + correcciones). Por defecto 40. */
  maxPeticionesRondaQA?: number
}

/**
 * Ahorro de tokens (plan N). Cada palanca se puede apagar por separado; `ahorro: false` restituye el comportamiento
 * anterior (útil para medir antes/después). Por defecto todas están activas.
 */
export type AhorroProduccion = {
  /** El músico/rol solo ve sus herramientas de oficio (+ consultas base) en vez de ~25 por relevancia del pedido. */
  herramientasPorRol: boolean
  /** Historial: resultados de herramientas antiguos recortados y escrituras correctas con acuse mínimo. */
  resultados: boolean
  /** Sin ensayo (varios agentes opinando) cuando la medición determinista de coherencia ya aprueba. */
  ensayoLimpio: boolean
  /** Mezcla y máster: si la medición del host ya aprueba, no se llama al modelo QA. */
  qaMedible: boolean
  /** Revisión de las partes: sin llamada al QA si medición, coherencia y completitud aprueban. */
  qaPartesLimpias: boolean
  /** Diagnóstico determinista de la pista en el resultado de cada escritura MIDI del músico. */
  diagnostico: boolean
  /** Plan T, revisión de partes: si la medición determinista ya da problemas concretos, el modelo no vuelve a juzgar: se corrige con ellos. */
  qaSoloMedicion: boolean
  /** Plan T, revisión de partes: tope de peticiones por ronda (`maxPeticionesRondaQA`) y pasos acotados en las correcciones. */
  topeRondaQA: boolean
  /** Plan T, QA: una lectura ya hecha (misma herramienta y argumentos) no se repite mientras no se haya escrito nada. */
  lecturasUnicas: boolean
}

export function resolverAhorro(a?: boolean | Partial<AhorroProduccion>): AhorroProduccion {
  const v = a !== false
  const base: AhorroProduccion = { herramientasPorRol: v, resultados: v, ensayoLimpio: v, qaMedible: v, qaPartesLimpias: v, diagnostico: v, qaSoloMedicion: v, topeRondaQA: v, lecturasUnicas: v }
  return a && typeof a === 'object' ? { ...base, ...a } : base
}

export const H_ENCARGOS = 'asignar_encargos'
export const H_VEREDICTO = 'veredicto_calidad'
export const H_HOJA = 'hoja_de_ruta'
export const H_DEVOLVER = 'devolver_trabajo'
export const H_PROPONER = 'proponer_ajustes'
export const H_ACORDAR = 'acordar_ajustes'
/** Devoluciones que se atienden por etapa (después, el agente resuelve con sus medios). */
const MAX_DEVOLUCIONES_POR_ETAPA = 1
/** Indicaciones del usuario: largo máximo de cada una y cuántas (las últimas) ve un agente que empieza. */
const MAX_NOTA_USUARIO = 600
const MAX_NOTAS_EN_CONTEXTO = 12
const NOMBRE_DESTINO: Record<DestinoDevolucion, string> = { musicos: 'los músicos', arreglista: 'el arreglista', mezcla: 'la mezcla' }

/**
 * Cada agente es también un filtro: lo que ve mal y no es de su oficio no lo tapa, lo devuelve al grupo o al
 * agente especializado. El orquestador lo atiende al terminar su turno y después el agente retoma su etapa.
 */
function herramientaDevolver(destinos: DestinoDevolucion[], musicos: ParticipanteProduccion[]): HerramientaAgente {
  const musico: Record<string, unknown> = { type: 'string', description: 'Músico concreto, si el problema es de una parte.' }
  if (musicos.length) musico.enum = musicos.map((m) => m.id)
  return {
    nombre: H_DEVOLVER,
    descripcion:
      'Devuelve al equipo algo que no es de tu oficio y que no debes tapar: una parte mal tocada o vacía (a los músicos), notas que no encajan con la hoja de ruta (al arreglista) o una mezcla que impide masterizar (a la mezcla). Di el problema concreto: pista, compases y qué pasa. Sigue con tu trabajo: se atiende al terminar tu turno y luego lo retomas.',
    parametros: {
      type: 'object',
      properties: { destino: { type: 'string', enum: destinos }, musico, problema: { type: 'string' } },
      required: ['destino', 'problema'],
    },
    clase: 'lectura',
    titulo: 'Devolviendo el trabajo al equipo',
  }
}

/** En el ensayo, cada músico dice si está conforme y propone ajustes concretos (a sí mismo o a otro). */
function herramientaProponer(musicos: ParticipanteProduccion[], yo: string): HerramientaAgente {
  return {
    nombre: H_PROPONER,
    descripcion:
      'Tu opinión del ensayo (obligatoria). `conforme: true` si tu parte encaja con las demás tal como está. Cada propuesta es un ajuste concreto y pequeño que mejora el conjunto: para ti («yo») o para otro músico (su id): registro, densidad, ritmo, dejar espacio, doblar o contestar un motivo. No propongas cambiar tonalidad, tempo ni forma, ni rehacer partes enteras.',
    parametros: {
      type: 'object',
      properties: {
        conforme: { type: 'boolean' },
        propuestas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              para: { type: 'string', enum: ['yo', ...musicos.filter((m) => m.id !== yo).map((m) => m.id)], description: '«yo» o el id del músico.' },
              ajuste: { type: 'string', description: 'Qué cambiar, en qué sección o compases y por qué.' },
            },
            required: ['para', 'ajuste'],
          },
        },
      },
      required: ['conforme'],
    },
    clase: 'lectura',
    titulo: 'Opinando en el ensayo',
  }
}

/** El director arbitra el ensayo: qué propuestas se acuerdan y para quién. */
function herramientaAcordar(musicos: ParticipanteProduccion[]): HerramientaAgente {
  return {
    nombre: H_ACORDAR,
    descripcion:
      'Decide qué ajustes acuerda la banda (obligatorio). Acepta solo lo que mejore el conjunto y sea coherente con el plan; descarta lo contradictorio y lo que no haga falta. Un ajuste por músico y asunto, concreto (pista, sección, qué cambiar). Lista vacía = la banda está de acuerdo tal como está.',
    parametros: {
      type: 'object',
      properties: {
        ajustes: {
          type: 'array',
          items: { type: 'object', properties: { musico: { type: 'string', enum: musicos.map((m) => m.id) }, ajuste: { type: 'string' } }, required: ['musico', 'ajuste'] },
        },
        nota: { type: 'string', description: 'Qué se acordó y por qué, en una frase para la banda.' },
      },
      required: ['ajustes'],
    },
    clase: 'lectura',
    titulo: 'Acordando los ajustes',
  }
}

/** Ajustes válidos (músico existente, texto), como mucho MAX_AJUSTES_POR_MUSICO por músico. */
export function normalizarAjustes(v: unknown, musicos: ParticipanteProduccion[]): AjusteAcordado[] {
  if (!Array.isArray(v)) return []
  const ids = new Set(musicos.map((m) => m.id))
  const porMusico = new Map<string, number>()
  const out: AjusteAcordado[] = []
  for (const a of v) {
    const o = (a ?? {}) as Record<string, unknown>
    const musico = String(o.musico ?? o.para ?? '').trim()
    const ajuste = String(o.ajuste ?? '').trim()
    const n = porMusico.get(musico) ?? 0
    if (!ids.has(musico) || !ajuste || n >= MAX_AJUSTES_POR_MUSICO) continue
    porMusico.set(musico, n + 1)
    out.push({ musico, ajuste })
  }
  return out
}

/** Hoja de ruta común (lead sheet): la misma forma y armonía para todos los músicos. */
export type SeccionHoja = { nombre: string; compases: number; acordes: string[]; caracter?: string }
/** `estilo`: género/estilo que declara el planificador a partir del pedido (worship moderno, pop, rock, balada, jazz, electrónica…); la mezcla elige su perfil con él. */
export type HojaDeRuta = { tonalidad: string; bpm?: number; numerador: number; secciones: SeccionHoja[]; estilo?: string }

function herramientaHoja(): HerramientaAgente {
  return {
    nombre: H_HOJA,
    descripcion:
      'Entrega la hoja de ruta de la canción (obligatorio): tonalidad, tempo, compás y cada sección en orden con su número de compases y UN acorde por compás (cifrado americano: D, Bm, G/B, A7sus4…). Todos los músicos tocarán exactamente estos acordes en estos compases.',
    parametros: {
      type: 'object',
      properties: {
        tonalidad: { type: 'string', description: 'p. ej. «Re mayor»' },
        bpm: { type: 'number' },
        estilo: { type: 'string', description: 'Género/estilo de la canción según el pedido, en pocas palabras: worship moderno, pop, rock, balada, jazz, electrónica…' },
        numerador: { type: 'number', description: 'Tiempos por compás (4 en 4/4).' },
        secciones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nombre: { type: 'string' },
              compases: { type: 'number' },
              acordes: { type: 'array', items: { type: 'string' }, description: 'Un acorde por compás (tantos como compases).' },
              caracter: { type: 'string', description: 'Dinámica y textura: suave, lleno, crece…' },
            },
            required: ['nombre', 'compases', 'acordes'],
          },
        },
      },
      required: ['tonalidad', 'numerador', 'secciones'],
    },
    clase: 'lectura',
    titulo: 'Escribiendo la hoja de ruta',
  }
}

/** Valida la hoja: un acorde por compás (se repite el último o se recorta si no cuadra). null si no sirve. */
export function normalizarHoja(v: Record<string, unknown>): HojaDeRuta | null {
  const numerador = Math.round(Number(v.numerador ?? 4))
  const secciones = (Array.isArray(v.secciones) ? v.secciones : [])
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>
      const compases = Math.round(Number(o.compases))
      const acordes = (Array.isArray(o.acordes) ? o.acordes : []).map((a) => String(a).trim()).filter(Boolean)
      if (!String(o.nombre ?? '').trim() || !(compases > 0 && compases <= 64) || !acordes.length) return null
      const completos = Array.from({ length: compases }, (_, i) => acordes[i] ?? acordes[acordes.length - 1]!)
      return { nombre: String(o.nombre).trim(), compases, acordes: completos, ...(o.caracter ? { caracter: String(o.caracter).trim() } : {}) }
    })
    .filter((s): s is SeccionHoja => s !== null)
  if (!secciones.length || !(numerador >= 2 && numerador <= 12)) return null
  const bpm = Number(v.bpm)
  const estilo = String(v.estilo ?? '').trim().slice(0, 60)
  return { tonalidad: String(v.tonalidad ?? '').trim(), ...(bpm > 20 && bpm < 300 ? { bpm } : {}), ...(estilo ? { estilo } : {}), numerador, secciones }
}

/** Texto de la hoja con el beat exacto donde empieza cada sección (lo que necesita cada músico para su clip). */
export function hojaComoTexto(h: HojaDeRuta): string {
  const lineas = [
    `HOJA DE RUTA (obligatoria para todos): ${h.tonalidad}${h.bpm ? `, ${h.bpm} BPM` : ''}, ${h.numerador}/4.`,
    'Cada sección = un clip que empieza en «beat inicio» y dura «beats». Los acordes van uno por compás, en orden; el bajo toca la fundamental (o la nota tras «/»).',
  ]
  let beat = 0
  let compas = 1
  for (const s of h.secciones) {
    const beats = s.compases * h.numerador
    lineas.push(`- ${s.nombre}: compases ${compas}–${compas + s.compases - 1}, beat inicio ${beat}, ${beats} beats${s.caracter ? `, ${s.caracter}` : ''}. Acordes: ${s.acordes.join(' | ')}`)
    beat += beats
    compas += s.compases
  }
  lineas.push(`Final de la canción: beat ${beat}. Nada debe sonar después.`)
  return lineas.join('\n')
}

const MAX_ENCARGOS = 16
/** Mediciones seguidas del QA sin escribir nada. */
const MAX_ANALISIS_SEGUIDOS = 4
/** Plan T: peticiones al modelo por ronda de la revisión de partes (revisión + corrección). */
export const MAX_PETICIONES_RONDA_QA = 40
/** Plan T: pasos del modelo de mezcla cuando solo afina una mezcla inicial ya aplicada. */
export const PASOS_AFINAR_MEZCLA = 6
/** Tope de reloj por intento de agente. Sin tope para el planificador y el director. */
export const TOPE_AGENTE_MS_DEFECTO: Partial<Record<RolProduccion, number>> = {
  musico: 6 * 60_000,
  coherencia: 4 * 60_000,
  qa: 3 * 60_000,
  mezcla: 5 * 60_000,
  master: 4 * 60_000,
}

/**
 * Pasos del modelo por rol. Quien escribe (notas, mezcla, máster) consulta, crea, comprueba y corrige:
 * con 10 pasos el pianista o el máster se quedaban a medias y el QA tenía que rehacerlo.
 */
export const PASOS_POR_ROL: Partial<Record<RolProduccion, number>> = {
  planificador: 8,
  director: 12,
  // Una parte de canción completa son ~10 secciones (un clip cada una) más cargar y comprobar el instrumento.
  musico: 32,
  coherencia: 24,
  qa: 10,
  mezcla: 16,
  master: 10,
}

function herramientaEncargos(musicos: ParticipanteProduccion[]): HerramientaAgente {
  return {
    nombre: H_ENCARGOS,
    descripcion: 'Reparte el trabajo entre los músicos. Cada encargo lleva la pista del músico (pista: su id) y un texto autosuficiente: secciones o compases, estilo, tonalidad y qué tocar. Cada músico solo podrá escribir en su pista.',
    parametros: {
      type: 'object',
      properties: {
        encargos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              musico: { type: 'string', enum: musicos.map((m) => m.id) },
              pista: { type: 'string', description: 'Id de la pista donde trabaja este músico (o su nombre exacto). Sus escrituras en otras pistas se rechazan.' },
              encargo: { type: 'string' },
            },
            required: ['musico', 'encargo'],
          },
        },
      },
      required: ['encargos'],
    },
    clase: 'lectura',
    titulo: 'Repartiendo el trabajo',
  }
}

function herramientaVeredicto(responsables: ParticipanteProduccion[]): HerramientaAgente {
  const quien: Record<string, unknown> = { type: 'string', description: 'Quién debe corregirlo.' }
  if (responsables.length) quien.enum = responsables.map((r) => r.id)
  return {
    nombre: H_VEREDICTO,
    descripcion: 'Entrega tu veredicto de calidad. `aprobado: true` solo si lo comprobaste en el proyecto. Cada problema, concreto y corregible.',
    parametros: {
      type: 'object',
      properties: {
        aprobado: { type: 'boolean' },
        resumen: { type: 'string' },
        problemas: { type: 'array', items: { type: 'object', properties: { quien, problema: { type: 'string' } }, required: ['problema'] } },
      },
      required: ['aprobado', 'resumen'],
    },
    clase: 'lectura',
    titulo: 'Dando el veredicto',
  }
}

const INSTRUCCIONES_ROL: Record<RolProduccion, string> = {
  planificador:
    'Eres el planificador de la producción. Revisa el proyecto y entrega la hoja de ruta con `hoja_de_ruta`: tonalidad, tempo, compás y cada sección con sus compases y un acorde por compás, con una progresión coherente en la tonalidad (que el coro resuelva y el puente contraste). Usa cifrado con color moderno cuando el estilo lo pida (Cadd9, Gsus4, Em7, Fmaj7, Am9, inversiones como G/B o C/E para bajos que caminan), no solo triadas. Después escribe un plan breve: instrumentación por pista y qué hace cada una en cada sección, pidiendo a los músicos variedad rítmica, arpegios y adornos humanos, no bloques iguales. No edites el proyecto.',
  director:
    'Eres el director musical. Con el plan, prepara lo común (tempo, tonalidad, compás y una pista por instrumento con su instrumento VST3 cargado con `track.addVstLayer`; los nombres instalados te los da `analysis.trackSound`) y reparte el trabajo con `asignar_encargos`: un encargo por músico con `pista` (el id de su pista) y un texto autosuficiente que diga en qué pista (nombre e id) trabaja. Crea solo las pistas que vayas a repartir: cada pista debe tener un músico encargado (si un músico lleva dos instrumentos, dilo en su encargo con los ids de ambas); una pista sin encargo se queda vacía. Ningún músico podrá escribir en la pista de otro. No toques las partes de los músicos.',
  musico:
    'Eres un músico de sesión y tocas en una banda: sabes qué hace cada compañero (reparto más abajo) y tu parte debe encajar con las suyas, no lucirse sola. Toca como una persona, no como una máquina: el cifrado es un punto de partida, no una jaula. Usa toda la escala de la tonalidad (notas de paso, bordaduras, apoyaturas, anticipaciones) y colorea los acordes con extensiones (add9, sus2/sus4, 6, maj7, m7, 11) e inversiones; en el tiempo fuerte de cada compás que suene el acorde de ese compás y el resto del compás tiene libertad. Varía las duraciones (largas en los apoyos, cortas de paso, alguna síncopa y anticipación en la «y» de 4, silencios), arpegia y adorna en vez de repetir el mismo bloque en cada compás; ninguna frase igual dos compases seguidos. Humaniza: velocidades distintas en cada nota (±10, acentos en los apoyos, más suaves las de paso) y micro-tiempo de hasta ±0,04 beats en instrumentos melódicos y armónicos (la batería, en la rejilla, humanizada con velocidades y ghost notes). Sigue la HOJA DE RUTA: cada compás con su acorde, cada sección en su beat de inicio y con su largo; notas de la tonalidad (las cromáticas, breves y de paso). Así todas las partes encajan entre sí y suenan vivas. Trabaja solo en la pista de tu encargo; si no existe, créala una sola vez. Nunca dupliques pistas. Tiempos en beats: el `inicio` del clip cuenta desde el principio de la canción (compás N = beat (N−1)×4 en 4/4) y el `inicio` de cada nota cuenta desde el principio de SU clip (la primera nota de un clip suele estar en 0). Un clip por sección, del largo de la sección. Al terminar, comprueba con `analysis.trackSound` que tu pista suena: si no tiene instrumento o el VST no cargó, cárgalo como te indique. En worship, ninguna nota se suelta hasta que el sonido cae: en piano, guitarra, cuerdas, sintes y bajo deja cada nota o acorde pisado como con el pedal y suéltalo unos 500 ms DESPUÉS de que empiece la siguiente, sin huecos en las melodías; los pads siempre suenan hasta el siguiente acorde; la batería y la percusión no (el DAW ya lo aplica al escribir, así que no lo deshagas con notas cortas).',
  coherencia:
    'Eres el arreglista: te encargas de que TODAS las partes sean congruentes entre sí y con el proyecto, en tiempo, en armonía y en ritmo. Recibes la hoja de ruta y la medición del DAW con los compases exactos donde algo no encaja (y el acorde que toca en cada uno). Trabaja con método: por cada pista señalada, lee UNA vez el clip de esa sección con `midi.notes.get` y corrige todos sus compases en un solo `midi.notes.patch` (rango en beats de la canción; o `midi.notes.set` con reemplazarTodas si hay que rehacer el clip). Nunca cambies tonalidad, tempo ni forma, ni toques pistas que no estén señaladas. Si una parte está tan fuera de lugar que habría que rehacerla entera, devuélvela a su músico con `devolver_trabajo` en vez de reescribirla tú. Reglas: cada clip empieza en el beat de su sección; las notas caen cerca de la rejilla (semicorcheas o tresillos; un desvío humano de hasta ±0,05 beats es bueno, NO lo cuantices); en el tiempo fuerte de cada compás suenan notas del acorde de ese compás (las extensiones add9, 6, maj7, sus cuentan como del acorde); el bajo toca la fundamental (o la nota tras «/») en el primer tiempo y se apoya en el bombo; nada suena después del final. Conserva la intención musical de cada músico: corrige lo mínimo y nunca «aplanes» una parte (no igualar duraciones ni velocidades, no quitar notas de paso, adornos ni síncopas). Si la medición dice que una parte suena robótica (todas las notas iguales), no la arregles tú: devuélvela a su músico con `devolver_trabajo`.',
  qa:
    'Eres el control de calidad. Solo consultas: revisa el proyecto con las herramientas de lectura y análisis y entrega `veredicto_calidad`. Marca solo problemas que hayas comprobado y que el responsable pueda corregir; lo que no puedes comprobar no es un problema. Usa `analysis.trackSound` para comprobar que cada pista suena (instrumento cargado, sin mute ni solo que la tape, fader razonable). Nombra pistas por su nombre, nunca por id.',
  mezcla:
    'Eres el ingeniero de mezcla. Equilibra volúmenes y paneo, aplica ecualización, compresión y envíos donde haga falta. Trabaja en LOTES: las llamadas independientes (volumen, paneo, EQ, compresión y envíos de TODAS las pistas) van juntas en un solo paso (hasta 24 llamadas por paso), no una pista por paso: cada paso cuesta una espera del modelo. Empieza con `analysis.trackSound` y corrige primero lo que impide oír una pista (mute, solo, fader casi a cero). Usa solo herramientas que existan en tu lista o en `buscar_herramientas`. Volumen con `track.update` (datos.volumen lineal 0–4, 1 = 0 dB) y paneo (datos.paneo −1 a 1); EQ con `mix.eq`, compresión con `mix.compress`; para la reverb crea un bus con `bus.create` y manda los instrumentos con `send.set`. No cambies las notas ni el arreglo. Eres también un filtro: si oyes algo que no es de tu oficio —una parte mal tocada o vacía, notas que chocan con la armonía, una pista que no suena por su parte— no lo tapes con la mezcla: devuélvelo con `devolver_trabajo` (al músico o al arreglista) y sigue con lo tuyo; cuando lo corrijan, retomarás la mezcla.',
  master:
    'Eres el ingeniero de máster. Ajusta la cadena del máster para llegar a un volumen de unos −14 LUFS integrados con picos por debajo de −1 dBTP, sin aplastar la dinámica. El máster se direcciona con trackId "master": `mix.limit` (ceiling en dB), `mix.eq` y `master.update` (volumen); mide con `analysis.loudness` o `analysis.mix`. Eres también un filtro: si el problema no es del máster —una mezcla desequilibrada que no se puede masterizar, una parte mal tocada, notas fuera de la armonía— no lo fuerces con el limitador: devuélvelo con `devolver_trabajo` (a la mezcla, al arreglista o al músico) y retoma el máster cuando lo corrijan.',
}

function sistemaParticipante(o: {
  p: ParticipanteProduccion | null
  rol: RolProduccion
  extra?: string
  contexto: string
  plan?: string
  encargo?: string
  habilidades?: HabilidadAgente[]
  /** Estilo de interpretación del usuario (solo músicos). */
  estilo?: string
  /** Indicaciones que el usuario ya dio durante esta producción. */
  notas?: string[]
}): string {
  const lineas = [
    `Eres ${o.p?.nombre ?? 'un miembro del equipo'} en la producción de una canción dentro de JasWave, un DAW. Trabajas en equipo con otros agentes.`,
    INSTRUCCIONES_ROL[o.rol],
    'Consulta antes de editar y nunca inventes ids. No preguntes al usuario: decide con criterio musical. Si no ves una herramienta, usa `buscar_herramientas`.',
    'Trabaja como un buen ingeniero: entiende el encargo, actúa, y VERIFICA antes de terminar (vuelve a leer lo que escribiste con `midi.notes.get` o mide con `analysis.*`); si algo no cuadra, corrígelo tú mismo en vez de darlo por bueno. Llama a varias herramientas en el mismo paso cuando sean independientes.',
    'Al terminar, informa en 1–3 frases qué hiciste y qué comprobaste, nombrando pistas y clips por su nombre. Si algo falló o quedó pendiente, dilo tal cual: nunca afirmes que está hecho lo que no se ejecutó.',
  ]
  if (o.p?.instrucciones?.trim()) lineas.push('', o.p.instrucciones.trim())
  if (o.habilidades?.length) lineas.push('', listadoHabilidades(o.habilidades))
  if (o.extra?.trim()) lineas.push('', o.extra.trim())
  if (o.rol === 'musico' && o.estilo?.trim()) lineas.push('', 'Estilo de interpretación del usuario (así toca él; hazlo tuyo, sin copiarlo literal):', o.estilo.trim().slice(0, 1800), 'La app aplicará su micro-tiempo, dinámica y pedal a tu parte al terminar: tú entrega notas musicalmente buenas y no cuantices ni aplanes.')
  if (o.plan?.trim()) lineas.push('', 'Plan de la producción:', o.plan.trim())
  if (o.notas?.length) lineas.push('', 'Indicaciones del usuario durante esta producción (él ve y oye el DAW; mandan sobre el plan):', ...o.notas.map((n) => `- ${n}`))
  if (o.contexto.trim()) lineas.push('', 'Estado actual del proyecto:', o.contexto.trim())
  if (o.encargo?.trim()) lineas.push('', `Tu encargo: ${o.encargo.trim()}`)
  return lineas.join('\n')
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/**
 * Quién es «pianista», «Pianista», «Baterista / Percusión» o «el bajista»: por id exacto, por nombre, o por el
 * id/nombre que contenga la palabra (sin acentos ni mayúsculas). Ambiguo → nadie.
 */
export function resolverMusico(ref: unknown, musicos: ParticipanteProduccion[]): ParticipanteProduccion | undefined {
  const t = String(ref ?? '').trim()
  if (!t) return undefined
  const exacto = musicos.find((m) => m.id === t)
  if (exacto) return exacto
  const q = sinAcentos(t).replace(/^(el|la|los|las)\s+/, '')
  const porNombre = musicos.filter((m) => sinAcentos(m.id) === q || sinAcentos(m.nombre) === q)
  if (porNombre.length === 1) return porNombre[0]
  const parcial = musicos.filter((m) => {
    const id = sinAcentos(m.id)
    const nombre = sinAcentos(m.nombre)
    return id.includes(q) || q.includes(id) || nombre.includes(q) || q.split(/[\s/,-]+/).some((p) => p.length > 3 && (id.includes(p) || nombre.includes(p)))
  })
  return parcial.length === 1 ? parcial[0] : undefined
}

function normalizarEncargos(v: unknown, musicos: ParticipanteProduccion[]): Encargo[] {
  const lista = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([musico, encargo]) => (encargo && typeof encargo === 'object' ? { musico, ...(encargo as object) } : { musico, encargo })) : []
  const out: Encargo[] = []
  for (const e of lista) {
    const o = (e ?? {}) as Record<string, unknown>
    const quien = resolverMusico(o.musico ?? o.participante ?? o.id ?? o.nombre, musicos)
    const encargo = String(o.encargo ?? o.tarea ?? o.instrucciones ?? o.descripcion ?? '').trim()
    const pista = String(o.pista ?? o.pistaId ?? o.trackId ?? '').trim().replace(/^["'«»]+|["'«»]+$/g, '')
    if (quien && encargo && !out.some((x) => x.participante === quien.id)) out.push({ participante: quien.id, encargo, ...(pista ? { pista } : {}) })
  }
  return out.slice(0, MAX_ENCARGOS)
}

function normalizarVeredicto(v: Record<string, unknown>, ids: Set<string>): VeredictoQA {
  const problemas = (Array.isArray(v.problemas) ? v.problemas : [])
    .map((p) => {
      if (typeof p === 'string') return { problema: p }
      const o = (p ?? {}) as Record<string, unknown>
      const quien = String(o.quien ?? '').trim()
      return { ...(ids.has(quien) ? { quien } : {}), problema: String(o.problema ?? '').trim() }
    })
    .filter((p) => p.problema)
    .slice(0, 10)
  const resumen = String(v.resumen ?? '').trim().slice(0, 600)
  const aprobado = v.aprobado === true && problemas.length === 0
  // Rechazo sin lista de problemas: el resumen es el problema a corregir.
  if (!aprobado && !problemas.length && resumen) problemas.push({ problema: resumen })
  return { aprobado, problemas, resumen }
}

export async function ejecutarProduccion(cfg: ConfigProduccion): Promise<ResultadoProduccionAgentes> {
  const candado = new Candado()
  const ahorro = resolverAhorro(cfg.ahorro)
  const maxRondas = Math.max(0, cfg.maxRondasQA ?? 2)
  const llamadas: RegistroLlamada[] = []
  const etapas: InformeEtapa[] = []
  const emitir = (e: EventoProduccion) => {
    try {
      cfg.onEvento?.(e)
    } catch {
      /* la UI no debe romper la producción */
    }
  }
  // Tiempo: cronómetro por etapas, presupuesto (objetivo) y límite (tope duro) de reloj.
  const reloj = cfg.reloj ?? Date.now
  const presupuestoMs = cfg.presupuestoMs ?? PRESUPUESTO_MS_DEFECTO
  const limiteMs = Math.max(presupuestoMs, cfg.limiteMs ?? LIMITE_MS_DEFECTO)
  const cron = crearCronometro(reloj, (e) => emitir({ tipo: 'tiempo', ...e }))
  /**
   * Degradación ordenada: entre el presupuesto y el límite hay una ventana; cada refinamiento se sacrifica al pasar
   * una fracción de ella (0 = al agotar el presupuesto). Sin límite finito la ventana es igual al presupuesto.
   */
  const ventanaMs = Number.isFinite(limiteMs) ? limiteMs - presupuestoMs : presupuestoMs
  const pasado = (fraccion: number) => cron.transcurrido() >= (fraccion === 0 ? presupuestoMs : presupuestoMs + fraccion * ventanaMs)
  const sobrePresupuesto = () => pasado(0)
  const sobreLimite = () => cron.transcurrido() >= limiteMs
  const omitir = (que: string, motivo: MotivoOmision, texto: string) => {
    if (cron.omitir({ que, motivo, texto })) emitir({ tipo: 'omitido', que, motivo, texto, totalMs: cron.transcurrido() })
  }
  const POR = (motivo: MotivoOmision) => (motivo === 'limite' ? 'por superar el límite de tiempo' : 'por tiempo')
  /** Medición del host cronometrada (la medición nativa es lo más lento fuera del modelo). */
  let medidoMaster = false
  const medirHost = cfg.medir
    ? async (etapa: EtapaMedible): Promise<MedicionQA | null> => {
        const t0 = reloj()
        let r: MedicionQA | null = null
        try {
          r = await cfg.medir!(etapa)
        } finally {
          const ms = reloj() - t0
          const ok = r ? r.ok : null
          cron.medicion({ etapa, ms, ok })
          emitir({ tipo: 'medicion', etapa, ms, ok })
        }
        if (etapa === 'master' && r) medidoMaster = true
        return r
      }
    : undefined
  /** Firma de lo que dice una revisión: si dos seguidas coinciden, la corrección no cambió nada y se corta el bucle. */
  let firmaMedicion = ''
  /** Plan T: peticiones usadas en la ronda de revisión de partes en curso (null = sin tope) y pasos de los músicos al corregir. */
  let presupuestoRondaQA: { usadas: number; max: number } | null = null
  let pasosMusicoCorreccion = 0
  /** Plan T: lecturas del QA ya hechas (se invalidan al escribir cualquier agente). */
  const lecturasHechas = new Map<string, ResultadoHerramienta>()
  const de = (rol: RolProduccion) => cfg.participantes.filter((p) => p.rol === rol)
  const uno = (rol: RolProduccion) => de(rol)[0] ?? null
  const musicos = de('musico')
  const cancelado = () => !!cfg.signal?.aborted
  const punto = async (que: string) => {
    try {
      await cfg.alPuntoDeControl?.(que)
    } catch {
      /* un fallo al guardar el punto de control no detiene la producción */
    }
  }
  const registrar = async (i: InformeEtapa) => {
    etapas.push(i)
    emitir({ tipo: 'informe', informe: i })
    await punto(`etapa:${i.etapa}`)
  }
  const previo = cfg.reanudar
  const hecha = (e: EtapaProduccion) => !!previo?.etapasCompletas.includes(e)
  const informePrevio = (e: EtapaProduccion) => previo?.etapas.find((x) => x.etapa === e)
  /** Aplica el máster mínimo determinista (una sola vez por producción). */
  let masterMinimoAplicado = false
  let resumenMasterMinimo = ''
  const aplicarMasterMinimo = async () => {
    if (masterMinimoAplicado || !cfg.masterMinimo || cancelado()) return
    masterMinimoAplicado = true
    let r: { ok: boolean; resumen: string }
    try {
      r = await cfg.masterMinimo()
    } catch (err) {
      r = { ok: false, resumen: `No se pudo aplicar el máster mínimo: ${err instanceof Error ? err.message : String(err)}` }
    }
    resumenMasterMinimo = r.resumen
    emitir({ tipo: 'master_minimo', ok: r.ok, resumen: r.resumen })
    await registrar({ etapa: 'master', ok: r.ok, resumen: `Máster mínimo (sin modelo): ${r.resumen}`.slice(0, 300) })
  }
  /** Plan T: mezcla inicial determinista (una sola vez por producción), antes de la etapa de mezcla del modelo. */
  let mezclaInicialHecha = false
  let mezclaInicialAplicada = false
  let resumenMezclaInicial = ''
  let guionMezclaInicial = ''
  let perfilMezclaInicial = ''
  const aplicarMezclaInicial = async () => {
    if (mezclaInicialHecha || !cfg.mezclaInicial || cancelado()) return
    mezclaInicialHecha = true
    let r: { ok: boolean; aplicada: boolean; resumen: string; perfil?: string; guion?: string }
    try {
      r = await cron.medir('mezcla', () => cfg.mezclaInicial!(hoja, { estilo: cfg.estilo, pedido: cfg.pedido }))
    } catch (err) {
      r = { ok: false, aplicada: false, resumen: `No se pudo aplicar la mezcla inicial: ${err instanceof Error ? err.message : String(err)}` }
    }
    mezclaInicialAplicada = r.aplicada || r.ok
    resumenMezclaInicial = r.resumen
    guionMezclaInicial = r.guion ?? ''
    perfilMezclaInicial = r.perfil ?? ''
    emitir({ tipo: 'mezcla_inicial', ok: r.ok, aplicada: r.aplicada, resumen: r.resumen, ...(r.perfil ? { perfil: r.perfil } : {}) })
    await punto('mezcla_inicial')
  }
  const contexto = async () => {
    try {
      return (await cfg.contexto?.()) ?? ''
    } catch {
      return ''
    }
  }

  let plan = ''
  let hoja: HojaDeRuta | null = null
  let encargos: Encargo[] = []
  let capturaEncargos: Encargo[] | null = null
  /** Plan S: pistas repartidas por el harness (no por el director) y rescates de pistas vacías, para el resumen. */
  let resumenCoordinacion = ''
  let asignacionesPistas: Array<{ pista: string; nombre: string; participante: string; rescate?: boolean }> = []
  const asignarHuerfanas = () => {
    if (!cfg.pistas || !musicos.length) return []
    let pistas: ReturnType<NonNullable<ConfigProduccion['pistas']>> = []
    try {
      pistas = cfg.pistas()
    } catch {
      return []
    }
    const r = asignarPistasHuerfanas(encargos, musicos, pistas, cfg.pedido, cfg.resolverPista)
    encargos = r.encargos
    if (r.asignaciones.length) emitir({ tipo: 'pistas_asignadas', asignaciones: r.asignaciones })
    return [...r.asignaciones]
  }
  let capturaVeredicto: VeredictoQA | null = null
  let capturaHoja: HojaDeRuta | null = null
  let capturaDevoluciones: Devolucion[] = []
  /** Resultado de la última medición de coherencia (undefined = no se midió). */
  let ultimaCoherenciaOk: boolean | undefined
  let capturaPropuestas: { de: string; conforme: boolean; propuestas: PropuestaEnsayo[] }[] = []
  let capturaAcuerdo: { ajustes: AjusteAcordado[]; nota?: string } | null = null
  /**
   * Indicaciones del usuario durante la producción, en orden. Cada agente activo recibe las nuevas entre dos
   * pasos (los músicos en paralelo las reciben todos: nadie «se las lleva»); los que empiezan después las ven
   * en su contexto.
   */
  const notasUsuario: NotaUsuario[] = []
  const refrescarNotas = () => {
    let nuevas: Array<string | NotaUsuario> = []
    try {
      nuevas = cfg.notasUsuario?.() ?? []
    } catch {
      nuevas = []
    }
    for (const n of nuevas) {
      const texto = String((typeof n === 'string' ? n : n?.texto) ?? '').trim()
      const para = typeof n === 'string' ? '' : String(n?.para ?? '').trim()
      if (texto) notasUsuario.push({ texto: texto.slice(0, MAX_NOTA_USUARIO), ...(para ? { para } : {}) })
    }
  }
  /** Lo que un participante debe ver: lo dirigido a todos y lo dirigido a él. */
  const paraQuien = (id: string, notas: NotaUsuario[]) => notas.filter((n) => !n.para || n.para === id).map((n) => n.texto)
  const devolucionesAtendidas = new Map<EtapaProduccion, number>()
  const tomarDevoluciones = () => {
    const d = capturaDevoluciones
    capturaDevoluciones = []
    return d
  }

  /** Pistas que cada músico creó él mismo en esta producción (también son suyas). */
  const pistasCreadas = new Map<string, Set<string>>()
  const anotarPistaCreada = (musico: string, datos: unknown, args: Record<string, unknown>) => {
    const d = (datos ?? {}) as Record<string, unknown>
    const anidado = (d.pista ?? d.track ?? d.result ?? {}) as Record<string, unknown>
    const refs = [d.id, d.trackId, d.pistaId, anidado.id, args.nombre, args.id].filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    if (!refs.length) return
    const s = pistasCreadas.get(musico) ?? new Set<string>()
    for (const r of refs) s.add(r.trim().toLowerCase())
    pistasCreadas.set(musico, s)
  }
  const igual = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  /**
   * Mensaje de rechazo si la llamada escribe en la pista de OTRO músico; null si puede. Una pista que nadie
   * tiene asignada (el director la creó y no la repartió) la puede llenar cualquiera: antes quedaban canales
   * vacíos porque el veto solo dejaba a cada músico su pista.
   */
  const fueraDeSuPista = (musico: string, args: Record<string, unknown>): string | null => {
    const asignada = encargos.find((e) => e.participante === musico)?.pista
    if (!asignada) return null
    const ref = String(args.pistaId ?? args.trackId ?? '').trim().replace(/^["'«»]+|["'«»]+$/g, '')
    if (!ref) return null
    const mia = cfg.resolverPista?.(asignada) ?? { id: asignada, nombre: asignada }
    const resuelta = cfg.resolverPista?.(ref)
    const suya = resuelta ?? { id: ref, nombre: ref }
    const creadas = pistasCreadas.get(musico)
    if (igual(ref, asignada) || suya.id === mia.id || igual(suya.nombre, mia.nombre)) return null
    // Pistas extra (plan S): un músico con dos pistas escribe en ambas.
    for (const x of encargos.find((e) => e.participante === musico)?.pistasExtra ?? []) {
      const px = cfg.resolverPista?.(x) ?? { id: x, nombre: x }
      if (igual(ref, x) || suya.id === px.id || igual(suya.nombre, px.nombre)) return null
    }
    if (creadas && (creadas.has(suya.id.toLowerCase()) || creadas.has(suya.nombre.toLowerCase()) || creadas.has(ref.toLowerCase()))) return null
    // El máster y los buses no son pistas de músico: eso es de la mezcla.
    if (cfg.resolverPista && !resuelta) {
      return `«${ref}» no es una pista de músico (el máster y los buses son de la mezcla): tu encargo es en «${mia.nombre}» = "${mia.id}". Repite la llamada con pistaId "${mia.id}".`
    }
    const esDe = (e: Encargo) => {
      if (!e.pista) return false
      for (const x of [e.pista, ...(e.pistasExtra ?? [])]) {
        const p = cfg.resolverPista?.(x) ?? { id: x, nombre: x }
        if (igual(ref, x) || suya.id === p.id || igual(suya.nombre, p.nombre)) return true
      }
      return pistasCreadas.get(e.participante)?.has(suya.id.toLowerCase()) ?? false
    }
    const dueno = encargos.find((e) => e.participante !== musico && esDe(e))
    if (!dueno) return null
    const nombreDueno = cfg.participantes.find((p) => p.id === dueno.participante)?.nombre ?? dueno.participante
    return `La pista «${suya.nombre}» no es la tuya, es de ${nombreDueno}: tu encargo es en «${mia.nombre}» = "${mia.id}" y en esta banda cada músico escribe solo en su pista (o en una que nadie tenga asignada). Repite la llamada con pistaId "${mia.id}".`
  }

  /** Ejecuta un agente de la producción con su subconjunto de herramientas e intercepta las propias. */
  const correr = async (o: {
    etapa: EtapaProduccion
    p: ParticipanteProduccion | null
    rol: RolProduccion
    pedido: string
    soloLectura?: boolean
    extras?: HerramientaAgente[]
    encargo?: string
    /** Plan T: tope de pasos de esta ejecución (sustituye al del rol). */
    maxPasos?: number
  }): Promise<ResultadoAgente> => {
    const permitidas = o.p?.herramientas?.length ? new Set(o.p.herramientas) : null
    // Habilidades: las de serie del rol más las propias del participante (las suyas mandan si repiten id).
    const habilidades = unirHabilidades(cfg.habilidadesPorRol?.[o.rol], o.p?.habilidades)
    const extras = [...(o.extras ?? []), ...(habilidades.length ? [herramientaLeerHabilidad(habilidades)] : [])]
    const propio = extras.map((h) => h.nombre)
    const catalogo = [...extras, ...(permitidas ? cfg.catalogo.filter((h) => permitidas.has(h.nombre)) : cfg.catalogo)]
    const ids = new Set(cfg.participantes.map((p) => p.id))
    const quien = { id: o.p?.id ?? o.rol, nombre: o.p?.nombre ?? o.rol, rol: o.rol }
    // Revisión: tras unas cuantas mediciones seguidas sin escribir nada, el agente debe dar su veredicto con lo medido.
    let analisisSeguidos = 0
    let ultimoAnalisis: ResultadoHerramienta | null = null
    const ejecutar: EjecutorHerramienta = async (l, h, ctx) => {
      if (h.nombre === H_LEER_HABILIDAD) return ejecutarLeerHabilidad(l, habilidades)
      // Propiedad de pista: un músico escribe solo en la pista de su encargo (o en una que creó él).
      if (o.rol === 'musico' && o.p && h.clase !== 'lectura' && !propio.includes(h.nombre)) {
        // Si la herramienta pide pista y el modelo no la mandó («Falta pistaId/trackId», 7 veces seguidas en una pasada
        // real), se completa con la pista de su encargo en vez de obligarle a repetir la llamada.
        const asignada = encargos.find((e) => e.participante === o.p!.id)?.pista
        const props = (h.parametros as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}
        const clave = 'pistaId' in props ? 'pistaId' : 'trackId' in props ? 'trackId' : null
        if (asignada && clave && !String(l.argumentos.pistaId ?? l.argumentos.trackId ?? '').trim()) {
          l = { ...l, argumentos: { ...l.argumentos, [clave]: cfg.resolverPista?.(asignada)?.id ?? asignada } }
        }
        const veto = fueraDeSuPista(o.p.id, l.argumentos)
        if (veto) return { ok: false, error: veto }
      }
      if (h.nombre === H_DEVOLVER) {
        const destino = String(l.argumentos.destino ?? '') as DestinoDevolucion
        const problema = String(l.argumentos.problema ?? '').trim()
        const musico = String(l.argumentos.musico ?? '').trim()
        if (!(destino in NOMBRE_DESTINO) || !problema) return { ok: false, error: 'Indica el destino (musicos, arreglista o mezcla) y el problema concreto (pista, compases, qué pasa).' }
        if ((devolucionesAtendidas.get(o.etapa) ?? 0) >= MAX_DEVOLUCIONES_POR_ETAPA) {
          return { ok: false, error: 'En esta etapa ya se devolvió trabajo una vez y se atendió. Resuélvelo con tus medios o descríbelo en tu informe final.' }
        }
        const d: Devolucion = { destino, problema, ...(musico && musicos.some((m) => m.id === musico) ? { musico } : {}) }
        capturaDevoluciones.push(d)
        emitir({ tipo: 'devolucion', etapa: o.etapa, participante: quien, devolucion: d })
        return { ok: true, resumen: `Se devolverá a ${NOMBRE_DESTINO[destino]}`, datos: { registrado: true, nota: 'Sigue con lo que sí puedes hacer; al terminar tu turno se atenderá y retomarás tu etapa.' } }
      }
      if (h.nombre === H_PROPONER) {
        const yo = quien.id
        const propuestas = (Array.isArray(l.argumentos.propuestas) ? l.argumentos.propuestas : [])
          .map((p) => {
            const o = (p ?? {}) as Record<string, unknown>
            const para = String(o.para ?? '').trim()
            return { de: yo, para: para === 'yo' || para === yo ? yo : para, ajuste: String(o.ajuste ?? '').trim() }
          })
          .filter((p) => p.ajuste && musicos.some((m) => m.id === p.para))
          .slice(0, 4)
        capturaPropuestas.push({ de: yo, conforme: l.argumentos.conforme === true && !propuestas.some((p) => p.para === yo), propuestas })
        return { ok: true, resumen: propuestas.length ? `${propuestas.length} propuestas` : 'conforme', datos: { registrado: true } }
      }
      if (h.nombre === H_ACORDAR) {
        const ajustes = normalizarAjustes(l.argumentos.ajustes, musicos)
        const nota = String(l.argumentos.nota ?? '').trim().slice(0, 300)
        capturaAcuerdo = { ajustes, ...(nota ? { nota } : {}) }
        return { ok: true, resumen: ajustes.length ? `${ajustes.length} ajustes acordados` : 'sin cambios', datos: { registrado: true } }
      }
      if (h.nombre === H_ENCARGOS) {
        capturaEncargos = normalizarEncargos(l.argumentos.encargos, musicos)
        return capturaEncargos.length
          ? { ok: true, resumen: `${capturaEncargos.length} encargos`, datos: { asignados: capturaEncargos.length } }
          : { ok: false, error: `Ningún encargo válido: cada encargo lleva "musico" (uno de: ${musicos.map((m) => `${m.id} = ${m.nombre}`).join(', ')}) y "encargo" (texto).` }
      }
      if (h.nombre === H_VEREDICTO) {
        capturaVeredicto = normalizarVeredicto(l.argumentos, ids)
        return { ok: true, datos: { registrado: true } }
      }
      if (h.nombre === H_HOJA) {
        const hoja = normalizarHoja(l.argumentos)
        if (!hoja) return { ok: false, error: 'Hoja no válida: cada sección necesita nombre, compases (1–64) y al menos un acorde; numerador entre 2 y 12.' }
        capturaHoja = hoja
        return { ok: true, resumen: `${hoja.secciones.length} secciones`, datos: { hoja: hojaComoTexto(hoja) } }
      }
      if (o.rol === 'qa' && /^analysis./.test(h.nombre)) {
        if (analisisSeguidos >= (cfg.maxAnalisisSeguidos ?? MAX_ANALISIS_SEGUIDOS) && ultimoAnalisis) {
          return {
            ok: true,
            resumen: 'ya mediste',
            datos: { nota: 'Ya mediste: da tu veredicto con estos datos (llama a veredicto_calidad), sin más análisis.', ultimaMedicion: ultimoAnalisis.datos ?? ultimoAnalisis.resumen ?? null },
          }
        }
        analisisSeguidos++
        const medido = await cfg.ejecutar(l, h, ctx)
        if (medido.ok) ultimoAnalisis = medido
        return medido
      }
      if (h.clase !== 'lectura') analisisSeguidos = 0
      // Plan T: una lectura que el QA ya hizo (y nada se ha escrito desde entonces) no se repite: se devuelve la anterior.
      if (o.rol === 'qa' && ahorro.lecturasUnicas && h.clase === 'lectura' && !/^analysis\./.test(h.nombre)) {
        const clave = `${h.nombre}:${JSON.stringify(l.argumentos)}`
        const previa = lecturasHechas.get(clave)
        if (previa) return previa
        const nueva = await cfg.ejecutar(l, h, ctx)
        if (nueva.ok) lecturasHechas.set(clave, nueva)
        return nueva
      }
      let r = await cfg.ejecutar(l, h, ctx)
      if (r.ok && h.clase !== 'lectura') lecturasHechas.clear()
      if (r.ok && o.rol === 'musico' && o.p && h.nombre === 'track.create') anotarPistaCreada(o.p.id, r.datos, l.argumentos)
      // Como el compilador de un IDE: la escritura devuelve ya qué le falta o le sobra a la pista.
      if (r.ok && ahorro.diagnostico && cfg.diagnostico && hoja && o.rol === 'musico' && o.p && h.clase !== 'lectura' && /^midi\./.test(h.nombre)) {
        const enc = encargos.find((e) => e.participante === o.p!.id)
        const d = enc ? await Promise.resolve(cfg.diagnostico(enc, hoja)).catch(() => null) : null
        if (d) r = { ...r, datos: { ...(r.datos && typeof r.datos === 'object' && !Array.isArray(r.datos) ? (r.datos as object) : {}), diagnostico: d } }
      }
      return r
    }
    const base = [...(cfg.base ?? []), ...propio]
    const deOficio = (cfg.herramientasPorRol?.[o.rol] ?? []).filter((n) => !permitidas || permitidas.has(n))
    // Las indicaciones ya dadas van en el contexto; las que lleguen durante su turno, entre dos pasos.
    refrescarNotas()
    let notasVistas = notasUsuario.length
    const notasNuevas = () => {
      refrescarNotas()
      const nuevas = paraQuien(quien.id, notasUsuario.slice(notasVistas))
      notasVistas = notasUsuario.length
      for (const texto of nuevas) emitir({ tipo: 'nota', etapa: o.etapa, participante: quien, texto })
      return nuevas
    }
    // Tope de reloj por agente (y límite global para los agentes de refinamiento): se aborta con su propia señal y se
    // devuelve lo que tenga. Un agente atascado en consultas ya no retiene la producción hasta el final de su etapa.
    const topeMs = (cfg.topesAgenteMs ?? TOPE_AGENTE_MS_DEFECTO)[o.rol] ?? Infinity
    const refinamiento = o.rol === 'qa' || o.rol === 'coherencia' || o.rol === 'mezcla' || o.rol === 'master' || o.etapa === 'ensayo'
    const ctlAgente = new AbortController()
    const alAbortar = () => ctlAgente.abort()
    if (cfg.signal?.aborted) ctlAgente.abort()
    else cfg.signal?.addEventListener('abort', alAbortar, { once: true })
    let cortado: 'tope' | 'limite' | null = null
    const inicioAgente = reloj()
    const vigilante =
      Number.isFinite(topeMs) || (refinamiento && Number.isFinite(limiteMs))
        ? setInterval(() => {
            if (cortado || ctlAgente.signal.aborted) return
            if (reloj() - inicioAgente >= topeMs) cortado = 'tope'
            else if (refinamiento && sobreLimite()) cortado = 'limite'
            if (cortado) ctlAgente.abort()
          }, Math.max(1, cfg.vigilanciaMs ?? 1000))
        : null
    const corteAgente = new Promise<{ ok: false; texto: string; llamadas: []; error: string }>((resolve) => {
      ctlAgente.signal.addEventListener('abort', () => resolve({ ok: false, texto: '', llamadas: [], error: 'cortado por tiempo' }), { once: true })
    })
    const r0 = await ejecutarAgente({
      pedido: o.pedido,
      catalogo,
      // Con herramientas limitadas, el agente las ve todas desde el principio; si no, las de su oficio más
      // las que se eligen por relevancia.
      iniciales: permitidas
        ? ahorro.herramientasPorRol && deOficio.length
          ? [...propio, ...deOficio, ...base.filter((n) => permitidas.has(n))]
          : [...propio, ...deOficio, ...[...permitidas].slice(0, 30)]
        : deOficio.length
          ? [...propio, ...deOficio, ...(ahorro.herramientasPorRol ? base : seleccionarIniciales(o.pedido, catalogo, { base }))]
          : ahorro.herramientasPorRol
            ? [...propio, ...seleccionarIniciales(o.pedido, catalogo, { base, max: 8 })]
            : undefined,
      base,
      sistema: sistemaParticipante({
        p: o.p,
        rol: o.rol,
        extra: cfg.instruccionesExtra,
        contexto: await contexto(),
        plan: o.rol === 'planificador' ? undefined : plan,
        encargo: o.encargo,
        habilidades,
        estilo: cfg.estiloMusical,
        notas: paraQuien(quien.id, notasUsuario.slice(0, notasVistas)).slice(-MAX_NOTAS_EN_CONTEXTO),
      }),
      chat: (p) => {
        // Plan T: tope de peticiones por ronda de la revisión de partes. Agotado, el agente se corta sin llamar al modelo.
        if (presupuestoRondaQA && presupuestoRondaQA.usadas >= presupuestoRondaQA.max) {
          omitir('peticiones de la revisión de partes', 'presupuesto', `se cortó una ronda de la revisión de las partes al llegar a ${presupuestoRondaQA.max} peticiones al modelo`)
          return Promise.resolve({ ok: false, texto: '', llamadas: [], error: 'tope de peticiones de la ronda' })
        }
        if (presupuestoRondaQA) presupuestoRondaQA.usadas++
        cron.peticion()
        // Un modelo que no responde nunca no retiene al agente más allá de su tope.
        const pendiente = Promise.resolve(cfg.chat(p))
        pendiente.catch(() => undefined)
        return Promise.race([pendiente, corteAgente])
      },
      ejecutar,
      soloLectura: o.soloLectura,
      maxPasos: Math.min(o.maxPasos ?? Infinity, (o.rol === 'musico' && pasosMusicoCorreccion ? pasosMusicoCorreccion : Infinity), cfg.maxPasos ?? PASOS_POR_ROL[o.rol] ?? 10),
      maxSubagentes: 0,
      ahorro: { resultados: ahorro.resultados },
      onEvento: (evento) => emitir({ tipo: 'agente', etapa: o.etapa, participante: quien, evento }),
      notas: notasNuevas,
      signal: ctlAgente.signal,
      // Profundidad 1: sin delegar ni preguntar al usuario (el orquestador coordina).
      profundidad: 1,
      nombreAgente: quien.id,
      candado,
    })
    if (vigilante) clearInterval(vigilante)
    cfg.signal?.removeEventListener('abort', alAbortar)
    let r = r0
    if (cortado && !cfg.signal?.aborted) {
      // No es una cancelación del usuario: el agente se cortó por tiempo y la producción sigue con lo que hay.
      const por = cortado as 'tope' | 'limite'
      r = { ...r0, estado: 'limite', error: 'cortado por tiempo' }
      omitir(`${o.rol}/${quien.id} ${o.etapa}`, por === 'limite' ? 'limite' : 'tope_agente', `${quien.nombre} (${NOMBRE_ETAPA[o.etapa].toLowerCase()}) cortado por tiempo${por === 'tope' ? ` tras ${formatearDuracion(topeMs)}` : ' al superar el límite'}`)
    }
    llamadas.push(...r.llamadas)
    emitir({ tipo: 'participante', etapa: o.etapa, participante: quien, estado: r.estado, ...(r.error ? { error: r.error } : {}) })
    return r
  }

  /** Revisión con medición del host + agente QA; devuelve el veredicto combinado. */
  const revisar = async (etapa: EtapaProduccion, medible: EtapaMedible, ronda: number, responsables: ParticipanteProduccion[], soloMedir = false): Promise<VeredictoQA> => {
    const medicion = medirHost ? await medirHost(medible).catch(() => null) : null
    firmaMedicion = medicion ? medicion.detalles.join('|') : ''
    // Sin tiempo para el juicio del modelo: manda la medición del host.
    // Plan T: con problemas concretos ya medidos en las partes (vacías, sin instrumento…), el modelo no re-juzga: se corrige con ellos.
    const medicionConcreta = ahorro.qaSoloMedicion && medible === 'musicos' && !!medicion && !medicion.ok && medicion.detalles.length > 0
    const qa = soloMedir || medicionConcreta ? null : uno('qa')
    let veredicto: VeredictoQA | null = null
    // La medición del host ya es el criterio: si aprueba, preguntarle lo mismo al modelo solo cuesta tokens.
    const omitirQA = async () => {
      if (!medicion?.ok) return false
      if (medible !== 'musicos') return ahorro.qaMedible
      if (!ahorro.qaPartesLimpias || ultimaCoherenciaOk !== true || !cfg.completitud || !hoja) return false
      for (const e of encargos) {
        if (!e.pista) continue
        if (await Promise.resolve(cfg.completitud(e, hoja)).catch(() => null)) return false
      }
      return true
    }
    if (qa && (await omitirQA())) {
      veredicto = { aprobado: true, problemas: [], resumen: `Medición del DAW dentro de objetivo${medible === 'musicos' ? ', coherencia y completitud correctas' : ''}: ${medicion!.detalles.join(' · ')}`.slice(0, 600) }
    } else if (qa) {
      capturaVeredicto = null
      const r = await correr({
        etapa,
        p: qa,
        rol: 'qa',
        soloLectura: true,
        extras: [herramientaVeredicto(responsables)],
        pedido: [
          medible === 'musicos'
            ? `Revisa las partes grabadas por los músicos frente al plan y al pedido: «${cfg.pedido}». Juzga el arreglo: que cada parte exista, siga la hoja de ruta (cada sección en su beat, el acorde de cada compás, la tonalidad) y suene musical junto a las demás. Consulta las notas con midi.notes.get para comprobarlo.`
            : medible === 'mezcla'
              ? 'Revisa SOLO la mezcla (equilibrio de volúmenes, paneo, efectos). El arreglo y las notas ya se aprobaron: no los juzgues ni pidas cambiarlos.'
              : 'Revisa SOLO el máster (volumen final y picos). El arreglo y la mezcla ya se aprobaron: no los juzgues.',
          medicion ? `Medición del DAW: ${medicion.ok ? 'dentro de objetivo' : 'fuera de objetivo'}. ${medicion.detalles.join(' · ')}` : '',
          'Termina llamando a `veredicto_calidad`.',
        ]
          .filter(Boolean)
          .join('\n'),
      })
      if (capturaVeredicto) veredicto = capturaVeredicto
      else if (r.estado === 'completado' && r.texto) veredicto = { aprobado: true, problemas: [], resumen: r.texto.slice(0, 600) }
      // El QA no pudo revisar (fallo del modelo): sin medición del DAW no se da nada por bueno.
      else if (!medicion) veredicto = { aprobado: false, problemas: [], resumen: 'No se pudo revisar esta parte.' }
    }
    // La medición manda: si el host dice que no cumple, no se aprueba aunque el agente lo diga.
    const combinado: VeredictoQA = veredicto ?? { aprobado: medicion?.ok ?? true, problemas: [], resumen: medicion?.detalles.join(' · ') || 'Sin revisión.' }
    if (medicion && !medicion.ok) {
      combinado.aprobado = false
      if (!combinado.problemas.length) combinado.problemas = medicion.detalles.map((d) => ({ problema: d }))
    }
    emitir({ tipo: 'qa', etapa, ronda, veredicto: combinado, medicion })
    return combinado
  }

  const terminar = (estado: ResultadoProduccionAgentes['estado'], texto: string): ResultadoProduccionAgentes => {
    emitir({ tipo: 'etapa', etapa: 'entrega', fase: 'fin', ok: estado === 'completado', resumen: texto })
    const tiempos = cron.instantanea(presupuestoMs, limiteMs)
    emitir({ tipo: 'tiempos', tiempos })
    return { estado, plan, etapas, encargos, llamadas, texto, tiempos }
  }

  // Grabación por oleadas (la base rítmica primero; los demás la escuchan). También sirve para regrabar.
  const escuchar = async () => {
    try {
      const t = (await cfg.partes?.())?.trim()
      return t ? `\n\nLo que ya tocan los demás (escúchalo y responde a ello: encaja con su ritmo, deja espacio a sus frases, contesta o dobla sus motivos; no los tapes en su registro):\n${t}` : ''
    } catch {
      return ''
    }
  }
  /** El reparto de la banda: cada músico sabe qué hacen los demás (acuerdo previo, como en una banda real). */
  const reparto = (yo: string) => {
    const otros = encargos.filter((e) => e.participante !== yo)
    if (!otros.length) return ''
    const nombre = (id: string) => musicos.find((m) => m.id === id)?.nombre ?? id
    return `\n\nReparto de la banda (lo que hace cada compañero; deja sitio a lo suyo y complétalo):\n${otros.map((e) => `- ${nombre(e.participante)}${e.pista ? ` (pista ${e.pista})` : ''}: ${e.encargo.slice(0, 220)}`).join('\n')}`
  }
  const guia = (e: Encargo) => {
    try {
      const t = hoja && cfg.guiaArmonia ? cfg.guiaArmonia(e, hoja) : null
      return t ? `

${t}` : ''
    } catch {
      return ''
    }
  }
  const primeraPasada = async (e: Encargo): Promise<ResultadoAgente> => {
    const p = musicos.find((m) => m.id === e.participante) ?? null
    return correr({ etapa: 'musicos', p, rol: 'musico', pedido: `${e.encargo}${guia(e)}${reparto(e.participante)}${await escuchar()}` })
  }
  const completar = async (e: Encargo, r0: ResultadoAgente): Promise<ResultadoAgente> => {
    const p = musicos.find((m) => m.id === e.participante) ?? null
    let r = r0
    // Los modelos rápidos dan la parte por terminada tras la primera sección: se mide y se le devuelve lo que falta.
    // Pasado el límite de tiempo solo se concede un reintento (la parte completa manda, pero no a cualquier precio).
    for (let i = 0; i < MAX_REINTENTOS_COMPLETITUD && cfg.completitud && hoja && !cancelado(); i++) {
      if (i >= 1 && sobreLimite()) {
        omitir('reintentos de completitud', 'limite', `se limitaron los reintentos de la parte de ${p?.nombre ?? e.participante} ${POR('limite')}`)
        break
      }
      const falta = await Promise.resolve(cfg.completitud(e, hoja)).catch(() => null)
      if (!falta) break
      r = await correr({
        etapa: 'musicos',
        p,
        rol: 'musico',
        pedido: `Tu parte está INCOMPLETA: ${falta}\nSigue donde lo dejaste: escribe ahora solo lo que falta (un clip por sección, en tu pista), sin duplicar lo que ya está y sin pedir confirmación. No termines hasta cubrirlo todo.\nEncargo original: ${e.encargo}${guia(e)}${reparto(e.participante)}${await escuchar()}`,
      })
    }
    return r
  }
  /**
   * Plan S: una pista que sigue con 0 notas tras la grabación (nadie la tocó) se encarga, una vez, a su dueño.
   * Una pasada real dejó «Cuerdas» vacía hasta la entrega.
   */
  const rescatarPistasVacias = async () => {
    if (!cfg.pistas || cancelado() || sobreLimite()) return
    let pistas: ReturnType<NonNullable<ConfigProduccion['pistas']>>
    try {
      pistas = cfg.pistas()
    } catch {
      return
    }
    for (const e of encargos) {
      const p = musicos.find((m) => m.id === e.participante) ?? null
      for (const ref of [e.pista, ...(e.pistasExtra ?? [])]) {
        if (!ref || cancelado() || sobreLimite()) continue
        const pr = pistas.find((x) => x.id === ref || igual(x.nombre, ref))
        if (!pr || (pr.notas ?? 1) > 0) continue
        const a = { pista: pr.id, nombre: pr.nombre, participante: e.participante, rescate: true }
        asignacionesPistas.push(a)
        emitir({ tipo: 'pistas_asignadas', asignaciones: [a] })
        await correr({
          etapa: 'musicos',
          p,
          rol: 'musico',
          pedido: `Tu pista «${pr.nombre}» (id ${pr.id}) sigue VACÍA: no tiene ninguna nota. Tócala ahora en TODA la canción (un clip por sección, cada compás con su acorde de la hoja de ruta, sin compases vacíos), en esa pista y sin pedir confirmación.
Encargo original: ${e.encargo}${guia(e)}${reparto(e.participante)}${await escuchar()}`,
        })
      }
    }
  }
  /** Cierra la parte de un músico: queda anotado y se guarda un punto de control del proyecto. */
  const cerrarMusico = async (e: Encargo, r: ResultadoAgente): Promise<ResultadoAgente> => {
    const fin = await completar(e, r)
    if (!cancelado()) {
      emitir({ tipo: 'musico', participante: e.participante, ok: fin.estado === 'completado' })
      await punto(`musico:${e.participante}`)
    }
    return fin
  }
  const correrMusico = async (e: Encargo): Promise<ResultadoAgente> => cerrarMusico(e, await primeraPasada(e))
  /** Tras una interrupción: se mide primero qué le falta a la parte y solo se repite a quien no la tiene completa. */
  const RESULTADO_VACIO: ResultadoAgente = { estado: 'completado', texto: '', tareas: [], llamadas: [], pasos: 0 }
  const retomarMusico = async (e: Encargo): Promise<ResultadoAgente> => {
    if (cfg.completitud && hoja) return cerrarMusico(e, RESULTADO_VACIO)
    if (previo?.musicosTerminados.includes(e.participante)) return RESULTADO_VACIO
    return correrMusico(e)
  }
  const grabar = async (listaCompleta: Encargo[], retomando = false) => {
    // Un músico con dos pistas las graba en turnos paralelos propios (cada uno con su tope y sus pasos): en una pasada real
    // el piano agotó los 6 minutos y las cuerdas, que llevaba de extra, quedaron vacías.
    const lista = separarPistasExtra(listaCompleta)
    const [base, resto] = oleadas(lista, musicos)
    const uno1 = retomando ? retomarMusico : correrMusico
    if (retomando) {
      const primeros = await Promise.all(base.map(uno1))
      if (cancelado()) return primeros
      return [...primeros, ...(await Promise.all(resto.map(uno1)))]
    }
    if (resto.length && cfg.solaparOleadas !== false) {
      // La segunda oleada no espera a los reintentos por completitud de la base: arranca en cuanto la base
      // termina su primera pasada (ya tiene escrito lo que los demás necesitan oír) y ambos corren a la vez.
      const primeras = await Promise.all(base.map(async (e) => ({ e, r: await primeraPasada(e) })))
      if (cancelado()) return primeras.map((x) => x.r)
      const [a, b] = await Promise.all([Promise.all(primeras.map((x) => cerrarMusico(x.e, x.r))), Promise.all(resto.map(correrMusico))])
      return [...a, ...b]
    }
    const primeros = await Promise.all(base.map(correrMusico))
    if (cancelado()) return primeros
    return [...primeros, ...(await Promise.all(resto.map(correrMusico)))]
  }

  /** Los músicos regraban lo que otro agente les devolvió (cada uno su parte; sin músico concreto, todos los encargados). */
  const regrabar = async (desde: EtapaProduccion, devs: Devolucion[]): Promise<number> => {
    const porMusico = new Map<string, string[]>()
    for (const d of devs) {
      const ids = d.musico ? [d.musico] : encargos.length ? encargos.map((e) => e.participante) : musicos.map((m) => m.id)
      for (const id of ids) porMusico.set(id, [...(porMusico.get(id) ?? []), d.problema])
    }
    if (!porMusico.size) return 0
    await cron.medir('musicos', () => grabar(
      [...porMusico.entries()].map(([participante, lista]) => ({
        participante,
        encargo: `Te devuelven tu parte desde ${NOMBRE_ETAPA[desde].toLowerCase()}: ${lista.join('; ')}.\nCorrige editando o reemplazando tus clips en tu pista: no crees pistas nuevas ni dupliques clips.\nEncargo original: ${encargos.find((e) => e.participante === participante)?.encargo ?? ''}`,
      })),
    ))
    return porMusico.size
  }

  /** La coherencia se vuelve a medir (y corregir) y sustituye al informe anterior: la última medición es la que cuenta. */
  const remedirCoherencia = async (h: HojaDeRuta, forzadas?: string[]) => {
    const otra = await cicloCoherencia(h, forzadas)
    const i = etapas.findIndex((e) => e.etapa === 'coherencia')
    if (i >= 0) {
      etapas[i] = { ...otra, rondas: (etapas[i]!.rondas ?? 0) + (otra.rondas ?? 0) }
      emitir({ tipo: 'informe', informe: etapas[i]! })
    } else await registrar(otra)
  }

  /**
   * Atiende lo que un agente devolvió al equipo: músicos → regraban y se vuelve a medir la coherencia;
   * arreglista → corrige; mezcla → retoca. Devuelve un resumen para que el agente que devolvió retome su etapa.
   */
  const atenderDevoluciones = async (etapa: EtapaProduccion, devs: Devolucion[]): Promise<string> => {
    if (!devs.length) return ''
    if (sobreLimite()) {
      omitir('devoluciones', 'limite', `no se atendieron las devoluciones de ${NOMBRE_ETAPA[etapa].toLowerCase()} ${POR('limite')}`)
      return ''
    }
    devolucionesAtendidas.set(etapa, (devolucionesAtendidas.get(etapa) ?? 0) + 1)
    const hechas: string[] = []
    const aMusicos = devs.filter((d) => d.destino === 'musicos')
    if (aMusicos.length && musicos.length) {
      const n = await regrabar(etapa, aMusicos)
      if (n) hechas.push(n === 1 ? 'el músico corrigió su parte' : `${n} músicos corrigieron sus partes`)
      if (cancelado()) return hechas.join('; ')
      if (n && hoja && cfg.coherencia) {
        await remedirCoherencia(hoja)
        hechas.push('la coherencia se volvió a medir')
      }
    }
    const alArreglista = devs.filter((d) => d.destino === 'arreglista')
    if (alArreglista.length && hoja && cfg.coherencia && !cancelado()) {
      await remedirCoherencia(hoja, alArreglista.map((d) => d.problema))
      hechas.push('el arreglista revisó las partes')
    }
    const aMezcla = devs.filter((d) => d.destino === 'mezcla')
    const mezclador = uno('mezcla')
    if (aMezcla.length && mezclador && !cancelado()) {
      await correr({
        etapa: 'mezcla',
        p: mezclador,
        rol: 'mezcla',
        extras: [herramientaDevolver(['musicos', 'arreglista'], musicos)],
        pedido: `Desde el máster te devuelven la mezcla: ${aMezcla.map((d) => d.problema).join('; ')}. Corrige solo eso y comprueba con analysis.mix.`,
      })
      const otras = tomarDevoluciones()
      if (otras.length && !cancelado()) hechas.push(await atenderDevoluciones('mezcla', otras))
      hechas.push('la mezcla se retocó')
    }
    return hechas.filter(Boolean).join('; ')
  }

  // 1. Plan
  if (hecha('plan') && previo?.hoja) {
    // Reanudación: plan y hoja de ruta salen del diario (no se vuelve a llamar al planificador).
    hoja = previo.hoja
    plan = previo.plan
    try {
      cfg.alDefinirHoja?.(hoja)
    } catch {
      /* un fallo del guardia no detiene la producción */
    }
    emitir({ tipo: 'plan_definido', plan, hoja })
    etapas.push(informePrevio('plan') ?? { etapa: 'plan', ok: true, resumen: plan.slice(0, 400) })
    emitir({ tipo: 'informe', informe: etapas[etapas.length - 1]! })
  } else {
    emitir({ tipo: 'etapa', etapa: 'plan', fase: 'inicio' })
    const planificador = uno('planificador') ?? uno('director')
    const rPlan = await cron.medir('plan', () => correr({ etapa: 'plan', p: planificador, rol: 'planificador', soloLectura: true, extras: [herramientaHoja()], pedido: `Planifica esta producción: ${cfg.pedido}` }))
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    // Sin hoja común cada músico inventa su forma y su armonía: se pide una vez más.
    if (!capturaHoja && rPlan.estado !== 'fallo') {
      await cron.medir('plan', () => correr({ etapa: 'plan', p: planificador, rol: 'planificador', soloLectura: true, extras: [herramientaHoja()], pedido: `Entrega ya la hoja de ruta con \`hoja_de_ruta\` para: ${cfg.pedido}` }))
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    }
    hoja = capturaHoja as HojaDeRuta | null
    if (hoja) {
      try {
        cfg.alDefinirHoja?.(hoja)
      } catch {
        /* un fallo del guardia no detiene la producción */
      }
    }
    plan = [hoja ? hojaComoTexto(hoja) : '', rPlan.texto || (hoja ? '' : cfg.pedido)].filter(Boolean).join('\n\n')
    emitir({ tipo: 'plan_definido', plan, hoja })
    await registrar({ etapa: 'plan', ok: rPlan.estado === 'completado', resumen: plan.slice(0, 400) })
    emitir({ tipo: 'etapa', etapa: 'plan', fase: 'fin', ok: true, resumen: plan.slice(0, 400) })
    if (rPlan.estado === 'fallo') return terminar('fallo', `No se pudo planificar: ${(rPlan.error ?? 'el modelo no respondió').replace(/[.\s]+$/, '')}.`)
  }

  // 2. Dirección: preparación común y reparto
  if (hecha('direccion') && previo) {
    encargos = previo.encargos
    const inf = informePrevio('direccion')
    if (inf) {
      etapas.push(inf)
      emitir({ tipo: 'informe', informe: inf })
    }
  } else {
  emitir({ tipo: 'etapa', etapa: 'direccion', fase: 'inicio' })
  if (musicos.length) {
    capturaEncargos = null
    const rDir = await cron.medir('direccion', () =>
      correr({
        etapa: 'direccion',
        p: uno('director'),
        rol: 'director',
        extras: [herramientaEncargos(musicos)],
        pedido: [
          `Prepara la producción y reparte el trabajo. Pedido del usuario: «${cfg.pedido}».`,
          'Músicos disponibles:',
          ...musicos.map((m) => `- ${m.id}: ${m.nombre} — ${m.descripcion}`),
        ].join('\n'),
      }),
    )
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    // Si el director no repartió, cada músico recibe el plan como encargo.
    encargos = (capturaEncargos as Encargo[] | null) ?? musicos.map((m) => ({ participante: m.id, encargo: `Graba tu parte (${m.descripcion}) siguiendo el plan.` }))
    // Plan S: toda pista de instrumento sin encargo recibe dueño (antes se quedaban vacías, p. ej. «Cuerdas»).
    asignacionesPistas = asignarHuerfanas()
    etapas.push({ etapa: 'direccion', ok: rDir.estado !== 'fallo', resumen: rDir.texto.slice(0, 300) })
  }
  emitir({ tipo: 'encargos', encargos })
  if (etapas.some((x) => x.etapa === 'direccion')) emitir({ tipo: 'informe', informe: etapas.find((x) => x.etapa === 'direccion')! })
  await punto('etapa:direccion')
  emitir({ tipo: 'etapa', etapa: 'direccion', fase: 'fin', ok: true })
  }

  // 3. Músicos por oleadas (la base rítmica primero; los demás la escuchan) + QA con rondas de corrección
  if (encargos.length) {
    let okMusicos: number
    if (hecha('musicos')) {
      okMusicos = Number(/^(\d+) de/.exec(informePrevio('musicos')?.resumen ?? '')?.[1] ?? encargos.length)
      const inf = informePrevio('musicos')
      if (inf) {
        etapas.push(inf)
        emitir({ tipo: 'informe', informe: inf })
      }
    } else {
      emitir({ tipo: 'etapa', etapa: 'musicos', fase: 'inicio' })
      // Reanudando: cada músico mide primero su completitud y solo repite el incompleto.
      const r = await cron.medir('musicos', () => grabar(encargos, !!previo))
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      okMusicos = r.filter((x) => x.estado === 'completado').length
      await registrar({ etapa: 'musicos', ok: okMusicos === r.length, resumen: `${okMusicos} de ${r.length} partes grabadas` })
      emitir({ tipo: 'etapa', etapa: 'musicos', fase: 'fin', ok: okMusicos > 0, resumen: `${okMusicos} de ${r.length} partes grabadas` })
      await rescatarPistasVacias()
      if (cfg.afinarConjunto && !cancelado()) {
        try {
          const t = await cfg.afinarConjunto()
          if (t) {
            resumenCoordinacion = t
            emitir({ tipo: 'coordinacion', resumen: t })
          }
        } catch {
          /* la coordinación es un refinamiento: un fallo no detiene la producción */
        }
      }
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    }

    // 3a. Ensayo: la banda se escucha, se pone de acuerdo y ajusta antes de que nadie revise.
    // Ensayan los que grabaron algo (quien no escribió nada no tiene parte que encajar).
    const grabaron = new Set(encargos.map((e) => e.participante).filter((id) => llamadas.some((l) => l.agente === id && l.ok && l.clase === 'escritura')))
    let ensayoInnecesario = false
    // Primer refinamiento que se sacrifica si ya no hay tiempo.
    const ensayoPosible = cfg.ensayo !== false && grabaron.size >= 2 && !hecha('ensayo') && !hecha('coherencia') && !hecha('qa_musicos')
    const ensayoSinTiempo = ensayoPosible && sobrePresupuesto()
    if (ensayoSinTiempo) omitir('ensayo', sobreLimite() ? 'limite' : 'presupuesto', `se omitió el ensayo ${POR(sobreLimite() ? 'limite' : 'presupuesto')}`)
    if (ensayoPosible && !ensayoSinTiempo && ahorro.ensayoLimpio && hoja && cfg.coherencia) {
      const previa = await Promise.resolve(cfg.coherencia(hoja)).catch(() => null)
      ensayoInnecesario = !!previa?.ok
      if (ensayoInnecesario) {
        emitir({ tipo: 'etapa', etapa: 'ensayo', fase: 'inicio', ronda: 0 })
        emitir({ tipo: 'etapa', etapa: 'ensayo', fase: 'fin', ok: true, ronda: 0, resumen: 'La medición de coherencia ya aprueba todas las partes: no hizo falta ensayo.' })
      }
    }
    if (ensayoPosible && !ensayoSinTiempo && !ensayoInnecesario) {
      await registrar(await cron.medir('ensayo', () => ensayar(grabaron)))
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    }

    // 3b. Coherencia: el arreglista mide (determinista) y corrige hasta que todo encaje en tiempo, armonía y ritmo.
    if (hecha('qa_musicos')) {
      const c = informePrevio('coherencia')
      if (c) {
        etapas.push(c)
        emitir({ tipo: 'informe', informe: c })
      }
    } else if (hoja && cfg.coherencia && okMusicos > 0) {
      // Reanudando, la coherencia se vuelve a medir (solo se corrige si la medición falla).
      const informeCoherencia = await cicloCoherencia(hoja)
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      await registrar(informeCoherencia)
    }

    const yaQaMusicos = informePrevio('qa_musicos')
    const informe = hecha('qa_musicos') && yaQaMusicos ? yaQaMusicos : await cicloQA('qa_musicos', 'musicos', musicos, async (problemas) => {
      const porMusico = new Map<string, string[]>()
      for (const pr of problemas) {
        const destino = pr.quien && musicos.some((m) => m.id === pr.quien) ? [pr.quien] : encargos.map((e) => e.participante)
        for (const d of destino) porMusico.set(d, [...(porMusico.get(d) ?? []), pr.problema])
      }
      const correcciones = [...porMusico.entries()].map(([participante, lista]) => {
        const original = encargos.find((e) => e.participante === participante)?.encargo ?? ''
        return { participante, encargo: `Corrige tu parte. Problemas detectados: ${lista.join('; ')}.\nEdita o reemplaza tus clips en tu pista: no crees pistas nuevas ni dupliques clips.\nEncargo original: ${original}` }
      })
      await grabar(correcciones)
    })
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    if (informe === yaQaMusicos) {
      etapas.push(informe)
      emitir({ tipo: 'informe', informe })
    } else await registrar(informe)
    // Si el QA hizo regrabar partes, la coherencia se mide otra vez (la última medición es la que cuenta).
    if (informe !== yaQaMusicos && informe.rondas && hoja && cfg.coherencia) {
      await remedirCoherencia(hoja)
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    }
    // Sin ninguna parte escrita no hay nada que mezclar: seguir solo gastaría tiempo y daría un máster mudo.
    const idsMusicos = new Set(musicos.map((m) => m.id))
    if (!informe.ok && !llamadas.some((l) => idsMusicos.has(l.agente) && l.ok && l.clase === 'escritura')) {
      return terminar(
        'fallo',
        `Los músicos no consiguieron grabar ninguna parte, así que no seguí con la mezcla ni el máster.${informe.resumen ? ` ${breve(informe.resumen)}` : ''}`,
      )
    }
  }

  // 4. Mezcla y 5. Máster, cada uno con su revisión
  for (const [rol, etapa, qaEtapa, medible] of [
    ['mezcla', 'mezcla', 'qa_mezcla', 'mezcla'],
    ['master', 'master', 'qa_master', 'master'],
  ] as const) {
    const p = uno(rol)
    // Plan T: la mezcla inicial determinista va ANTES del modelo de mezcla (y aunque no haya uno): si el modelo se corta o no
    // responde, la canción ya está equilibrada.
    if (rol === 'mezcla' && !hecha('mezcla') && !cancelado()) await aplicarMezclaInicial()
    if (!p) continue
    // Filtro: la mezcla puede devolver a músicos o arreglista; el máster, además, a la mezcla.
    const destinos: DestinoDevolucion[] = rol === 'mezcla' ? ['musicos', 'arreglista'] : uno('mezcla') ? ['musicos', 'arreglista', 'mezcla'] : ['musicos', 'arreglista']
    const extras = [herramientaDevolver(destinos, musicos)]
    // Reanudación: la etapa y su revisión ya estaban hechas.
    if (hecha(qaEtapa) && informePrevio(etapa) && informePrevio(qaEtapa)) {
      for (const i of [informePrevio(etapa)!, informePrevio(qaEtapa)!]) {
        etapas.push(i)
        emitir({ tipo: 'informe', informe: i })
      }
      continue
    }
    // Pasado el límite: la mezcla se omite, pero el máster mínimo determinista (limitador + −14 LUFS, sin modelo) SIEMPRE se aplica.
    if (sobreLimite()) {
      omitir(qaEtapa, 'limite', `se omitió la ${NOMBRE_ETAPA[qaEtapa].toLowerCase()} ${POR('limite')}`)
      if (rol === 'master' && cfg.masterMinimo) {
        omitir(etapa, 'limite', 'el máster hecho por el modelo se sustituyó por un máster mínimo automático por superar el límite de tiempo')
        await aplicarMasterMinimo()
        continue
      }
      omitir(etapa, 'limite', `se omitió ${rol === 'mezcla' ? 'la mezcla' : 'el máster'} ${POR('limite')}`)
      await registrar({ etapa, ok: false, resumen: `Omitida ${POR('limite')}.` })
      continue
    }
    if (hecha(etapa) && informePrevio(etapa)) {
      const i = informePrevio(etapa)!
      etapas.push(i)
      emitir({ tipo: 'informe', informe: i })
    } else {
    emitir({ tipo: 'etapa', etapa, fase: 'inicio' })
    // Con la mezcla inicial hecha, el modelo solo afina: revisa lo medido, retoca lo que falte y termina en pocos pasos.
    const afinar = rol === 'mezcla' && mezclaInicialAplicada
    const pedido = afinar
      ? `La mezcla inicial YA está aplicada por el sistema como punto de partida SEGURO (no como dogma)${perfilMezclaInicial ? `, con el perfil de estilo «${perfilMezclaInicial}»` : ''}: ganancias por rol, pasa-altos, paneo, reverb, balance espectral y volumen por sección.
${guionMezclaInicial ? `${guionMezclaInicial}
` : ''}Resultado y balance medido: ${resumenMezclaInicial}
El criterio de género y estilo es tuyo (pedido: «${cfg.pedido}»): mide con analysis.mix, ajusta con criterio de ese estilo y puedes modificar o deshacer cualquier cosa del perfil (un volumen, una banda de EQ —las bandas 1–4 de cada pista son del perfil—, un envío, la curva de secciones). Tus decisiones mandan sobre la base automática. No rehagas lo que ya suena bien y termina en pocos pasos.`
      : rol === 'mezcla'
        ? `Mezcla la canción según el plan. Pedido del usuario: «${cfg.pedido}».`
        : 'Prepara el máster de la canción.'
    let r = await cron.medir(etapa, () => correr({ etapa, p, rol, pedido, extras, ...(afinar ? { maxPasos: PASOS_AFINAR_MEZCLA } : {}) }))
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    const devueltas = tomarDevoluciones()
    if (devueltas.length) {
      const atendido = await atenderDevoluciones(etapa, devueltas)
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      if (sobreLimite()) omitir(`${etapa} (segunda pasada)`, 'limite', `se omitió la segunda pasada de ${rol === 'mezcla' ? 'la mezcla' : 'el máster'} ${POR('limite')}`)
      else {
        r = await cron.medir(etapa, () =>
          correr({
            etapa,
            p,
            rol,
            extras,
            pedido: `Lo que devolviste ya se atendió (${atendido || 'sin cambios'}). Termina ${rol === 'mezcla' ? 'la mezcla' : 'el máster'}: comprueba con tus herramientas y ajusta lo que haga falta.`,
          }),
        )
        if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      }
      tomarDevoluciones()
    }
    await registrar({ etapa, ok: r.estado === 'completado', resumen: r.texto.slice(0, 300) })
    emitir({ tipo: 'etapa', etapa, fase: 'fin', ok: r.estado === 'completado', resumen: r.texto.slice(0, 300) })
    // Plan T: si el modelo de máster no terminó (fallo o corte por tiempo), el máster mínimo determinista se aplica igual.
    if (rol === 'master' && r.estado !== 'completado' && cfg.masterMinimo && !cancelado()) await aplicarMasterMinimo()
    }
    const informe = await cicloQA(qaEtapa, medible, [p], async (problemas) => {
      await correr({ etapa, p, rol, extras, pedido: `Corrige solo lo que corresponde a ${rol === 'mezcla' ? 'la mezcla' : 'el máster'}: ${problemas.map((x) => x.problema).join('; ')}` })
      const d = tomarDevoluciones()
      if (d.length && !cancelado()) await atenderDevoluciones(etapa, d)
    })
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    await registrar(informe)
  }

  // La medición final no se salta: si el máster no se midió (se entregó por límite de tiempo), se mide ahora.
  // Si el límite se superó y no hubo máster (p. ej. sin participante de máster), el mínimo determinista se aplica ahora.
  if (sobreLimite() && !cancelado()) await aplicarMasterMinimo()
  if (!medidoMaster && medirHost && cron.omitidos().some((o) => o.motivo === 'limite') && !cancelado()) {
    const m = await cron.medir('qa_master', () => medirHost('master').catch(() => null))
    if (m) etapas.push({ etapa: 'qa_master', ok: m.ok, resumen: `Medición final: ${m.detalles.join(' · ')}`.slice(0, 400) })
  }
  const revisiones = etapas.filter((e) => e.etapa.startsWith('qa_') || e.etapa === 'coherencia' || e.etapa === 'ensayo')
  const todoOk = etapas.every((e) => e.ok)
  const omitidos = cron.omitidos()
  const texto = [
    todoOk ? 'La producción está lista.' : 'La producción terminó con algunos avisos.',
    ...revisiones.map((e) => `${NOMBRE_ETAPA[e.etapa]}: ${e.ok ? 'aprobada' : 'con avisos'}${e.rondas ? ` (${e.rondas} ${e.rondas === 1 ? 'corrección' : 'correcciones'})` : ''}.${e.ok ? '' : ` ${breve(e.resumen)}`}`),
    ...(asignacionesPistas.length
      ? [
          `Pistas sin encargo repartidas por la producción: ${asignacionesPistas
            .map((a) => `«${a.nombre}» → ${musicos.find((m) => m.id === a.participante)?.nombre ?? a.participante}${a.rescate ? ' (estaba vacía: rescate)' : ''}`)
            .join('; ')}.`,
        ]
      : []),
    ...(resumenCoordinacion ? [resumenCoordinacion] : []),
    ...(resumenMezclaInicial ? [`Mezcla inicial (sin modelo): ${resumenMezclaInicial}`] : []),
    ...(masterMinimoAplicado ? [`Se aplicó un máster mínimo automático (limitador a −1 dBTP y volumen a −14 LUFS, sin modelo): ${resumenMasterMinimo}`] : []),
    ...(omitidos.length ? [`Para entregar a tiempo (${formatearDuracion(cron.transcurrido())}${omitidos.some((o) => o.motivo === 'limite') ? ', límite superado' : ''}): ${omitidos.map((o) => o.texto).join('; ')}.`] : []),
    resumenTiempos(cron.instantanea(presupuestoMs, limiteMs)),
  ].join('\n')
  return terminar(todoOk ? 'completado' : 'con_avisos', texto)

  /**
   * Ensayo de la banda. Como en un ensayo real: todos escuchan el conjunto a la vez (solo lectura), cada uno
   * dice si está conforme y propone ajustes concretos; el director arbitra (sin director, se acuerda lo que
   * cada músico propone para los demás) y los afectados vuelven a tocar solo lo acordado.
   */
  async function ensayar(grabaron: Set<string>): Promise<InformeEtapa> {
    const presentes = musicos.filter((m) => grabaron.has(m.id))
    const nombre = (id: string) => musicos.find((m) => m.id === id)?.nombre ?? id
    emitir({ tipo: 'etapa', etapa: 'ensayo', fase: 'inicio', ronda: 0 })
    let ronda = 0
    let ajustados = 0
    let resumen = 'La banda está de acuerdo: cada parte encaja con las demás.'
    while (ronda < RONDAS_ENSAYO && !cancelado()) {
      ronda++
      capturaPropuestas = []
      const oido = await escuchar()
      await Promise.all(
        presentes.map((m) =>
          correr({
            etapa: 'ensayo',
            p: m,
            rol: 'musico',
            soloLectura: true,
            extras: [herramientaProponer(presentes, m.id)],
            pedido: [
              `Ensayo de la banda. Escucha el conjunto (resumen abajo; lee con midi.notes.get lo que necesites comprobar) y juzga cómo encaja TU parte con las de los demás: ritmo con la base, registro sin pisar a nadie, espacio para las frases de otros, dinámica por sección.`,
              `Tu encargo era: ${encargos.find((e) => e.participante === m.id)?.encargo.slice(0, 300) ?? ''}`,
              'No edites nada. Termina llamando a `proponer_ajustes` con tu opinión: conforme o con propuestas concretas (para ti o para un compañero).',
              oido.trim(),
            ]
              .filter(Boolean)
              .join('\n'),
          }),
        ),
      )
      if (cancelado()) break
      const opiniones = capturaPropuestas
      const conformes = opiniones.filter((o) => o.conforme && !o.propuestas.length).map((o) => o.de)
      const propuestas = opiniones.flatMap((o) => o.propuestas)
      if (!propuestas.length) {
        emitir({ tipo: 'ensayo', ronda, conformes, propuestas: [], acordados: [] })
        break
      }
      // El director arbitra: acepta lo que mejora el conjunto y descarta lo contradictorio.
      const director = uno('director')
      let acuerdo: { ajustes: AjusteAcordado[]; nota?: string }
      if (director) {
        capturaAcuerdo = null
        await correr({
          etapa: 'ensayo',
          p: director,
          rol: 'director',
          soloLectura: true,
          extras: [herramientaAcordar(presentes)],
          pedido: [
            'Ensayo de la banda: los músicos han escuchado el conjunto y opinan. Decide qué ajustes se acuerdan (coherentes con el plan y entre sí; descarta lo contradictorio o innecesario) y termina con `acordar_ajustes`.',
            conformes.length ? `Conformes con su parte: ${conformes.map(nombre).join(', ')}.` : '',
            'Propuestas:',
            ...propuestas.map((p) => `- ${nombre(p.de)} propone a ${p.para === p.de ? 'sí mismo' : nombre(p.para)}: ${p.ajuste}`),
          ]
            .filter(Boolean)
            .join('\n'),
        })
        if (cancelado()) break
        // Sin decisión del director (fallo del modelo), nadie cambia nada: no se improvisa en nombre de la banda.
        acuerdo = (capturaAcuerdo as { ajustes: AjusteAcordado[]; nota?: string } | null) ?? { ajustes: [], nota: 'El director no decidió; se deja como está.' }
      } else {
        acuerdo = { ajustes: normalizarAjustes(propuestas.map((p) => ({ musico: p.para, ajuste: `${p.ajuste} (lo pide ${nombre(p.de)})` })), presentes) }
      }
      emitir({ tipo: 'ensayo', ronda, conformes, propuestas, acordados: acuerdo.ajustes, ...(acuerdo.nota ? { nota: acuerdo.nota } : {}) })
      if (!acuerdo.ajustes.length) {
        resumen = acuerdo.nota ?? 'Se escucharon propuestas, pero la banda acordó dejarlo como está.'
        break
      }
      const porMusico = new Map<string, string[]>()
      for (const a of acuerdo.ajustes) porMusico.set(a.musico, [...(porMusico.get(a.musico) ?? []), a.ajuste])
      await grabar(
        [...porMusico.entries()].map(([participante, lista]) => ({
          participante,
          encargo: `Ensayo de la banda: se acordó que ajustes tu parte así: ${lista.join('; ')}.${acuerdo.nota ? ` (${acuerdo.nota})` : ''}\nCambia solo eso, editando tus clips en tu pista (midi.notes.get y luego midi.notes.patch o midi.notes.set): no crees pistas nuevas ni dupliques clips, y conserva lo que ya encaja.\nEncargo original: ${encargos.find((e) => e.participante === participante)?.encargo ?? ''}`,
        })),
      )
      ajustados += porMusico.size
      resumen = `La banda acordó ${acuerdo.ajustes.length} ${acuerdo.ajustes.length === 1 ? 'ajuste' : 'ajustes'} (${[...porMusico.keys()].map(nombre).join(', ')})${acuerdo.nota ? `: ${acuerdo.nota}` : '.'}`
    }
    emitir({ tipo: 'etapa', etapa: 'ensayo', fase: 'fin', ok: true, ronda, resumen })
    return { etapa: 'ensayo', ok: true, resumen, rondas: ajustados ? ronda : 0 }
  }

  /** `forzadas`: problemas que otro agente devolvió al arreglista (se atienden aunque la medición apruebe). */
  async function cicloCoherencia(h: HojaDeRuta, forzadas: string[] = []): Promise<InformeEtapa> {
    return cron.medir('coherencia', async () => {
      const medirCoherencia = async (): Promise<MedicionQA | null> => {
        try {
          return (await cfg.coherencia?.(h)) ?? null
        } catch {
          return null
        }
      }
      const arreglista = uno('coherencia') ?? ARREGLISTA_POR_DEFECTO
      emitir({ tipo: 'etapa', etapa: 'coherencia', fase: 'inicio', ronda: 0 })
      let m = await medirCoherencia()
      let ronda = 0
      let pendientes = forzadas
      // Con el presupuesto agotado solo se concede una ronda; pasado el límite, ninguna (la medición sí se hace).
      const tope = () => (sobreLimite() ? 0 : pasado(0.2) ? 1 : RONDAS_COHERENCIA)
      const firma = (x: MedicionQA | null) => (x && !x.ok ? x.detalles.join('|') : '')
      while ((pendientes.length || (m && !m.ok)) && ronda < tope() && !cancelado()) {
        ronda++
        const problemas = [...pendientes, ...(m && !m.ok ? m.detalles : [])]
        const antes = firma(m)
        pendientes = []
        await correr({
          etapa: 'coherencia',
          p: arreglista,
          rol: 'coherencia',
          extras: [herramientaDevolver(['musicos'], musicos)],
          pedido: [
            'Haz que todas las partes encajen con la hoja de ruta y entre sí. Problemas detectados (medición del DAW y avisos de otros agentes; pista: problema, compases):',
            ...problemas.map((d) => '- ' + d),
            'Corrige solo lo señalado y termina informando qué cambiaste.',
          ].join('\n'),
        })
        if (cancelado()) break
        // El arreglista puede devolver una parte entera a su músico (rehacerla no es corregir compases).
        const devs = tomarDevoluciones()
        if (devs.length) {
          devolucionesAtendidas.set('coherencia', (devolucionesAtendidas.get('coherencia') ?? 0) + 1)
          await regrabar('coherencia', devs)
          if (cancelado()) break
        }
        m = await medirCoherencia()
        // Misma medición que antes de corregir: otra ronda no cambiaría nada.
        if (m && !m.ok && antes && firma(m) === antes) {
          omitir('rondas del arreglista', 'sin_progreso', 'se cortaron las rondas del arreglista: la medición de coherencia no cambió tras corregir')
          break
        }
      }
      if (ronda < RONDAS_COHERENCIA && m && !m.ok && !cancelado() && ronda >= tope()) {
        omitir('rondas del arreglista', sobreLimite() ? 'limite' : 'presupuesto', ronda === 0 ? 'se omitió la corrección del arreglista ' + POR(sobreLimite() ? 'limite' : 'presupuesto') : 'se limitó el arreglista a una ronda ' + POR('presupuesto'))
      }
      const ok = m?.ok ?? true
      ultimaCoherenciaOk = m ? m.ok : undefined
      const resumen = m ? (m.ok ? 'Todas las partes encajan en tiempo, armonía y ritmo.' : m.detalles.join(' · ').slice(0, 400)) : 'Sin medición de coherencia.'
      emitir({ tipo: 'qa', etapa: 'coherencia', ronda, veredicto: { aprobado: ok, problemas: ok ? [] : (m?.detalles ?? []).map((d) => ({ problema: d })), resumen }, medicion: m })
      emitir({ tipo: 'etapa', etapa: 'coherencia', fase: 'fin', ok, ronda, resumen })
      return { etapa: 'coherencia' as const, ok, resumen, rondas: ronda }
    })
  }

  async function cicloQA(
    etapa: EtapaProduccion,
    medible: EtapaMedible,
    responsables: ParticipanteProduccion[],
    corregir: (problemas: ProblemaQA[]) => Promise<void>,
  ): Promise<InformeEtapa> {
    return cron.medir(etapa, async () => {
      // Sin tiempo: la revisión de la mezcla se omite (la medición nativa es lenta y el máster se mide después);
      // la de las partes y la del máster quedan en medición del host, sin juicio del modelo y sin rondas extra.
      const sinTiempo = etapa === 'qa_musicos' ? sobrePresupuesto() : pasado(0.6)
      if (sinTiempo && etapa === 'qa_mezcla') {
        omitir(etapa, sobreLimite() ? 'limite' : 'presupuesto', 'se omitió la revisión de la mezcla ' + POR(sobreLimite() ? 'limite' : 'presupuesto'))
        return { etapa, ok: true, resumen: 'Omitida por tiempo.', rondas: 0 }
      }
      if (sinTiempo && etapa === 'qa_musicos' && uno('qa')) omitir(etapa, sobreLimite() ? 'limite' : 'presupuesto', 'se omitió la revisión de las partes por el modelo ' + POR(sobreLimite() ? 'limite' : 'presupuesto'))
      emitir({ tipo: 'etapa', etapa, fase: 'inicio', ronda: 0 })
      // Plan T: en la revisión de partes cada ronda (revisión o corrección + revisión) tiene un tope de peticiones al modelo.
      const topeRonda = etapa === 'qa_musicos' && ahorro.topeRondaQA ? Math.max(10, cfg.maxPeticionesRondaQA ?? MAX_PETICIONES_RONDA_QA) : 0
      const abrirRonda = () => {
        presupuestoRondaQA = topeRonda ? { usadas: 0, max: topeRonda } : null
      }
      abrirRonda()
      let v = await revisar(etapa, medible, 0, responsables, sinTiempo)
      presupuestoRondaQA = null
      let ronda = 0
      // Rondas de corrección permitidas ahora: todas; con el presupuesto agotado, ninguna en las partes y una en
      // mezcla/máster; pasado el límite, ninguna.
      const tope = () => (sobreLimite() ? 0 : etapa === 'qa_musicos' ? (sobrePresupuesto() ? 0 : maxRondas) : pasado(0.4) ? 1 : maxRondas)
      let firmaAntes = ''
      // Solo se corrige lo que tiene problemas concretos (si el QA no pudo revisar, no se repite a ciegas).
      while (!v.aprobado && v.problemas.length && ronda < tope() && !cancelado()) {
        ronda++
        firmaAntes = firmaMedicion + '#' + v.problemas.map((x) => x.problema).join('|')
        abrirRonda()
        // Los músicos que corrigen se reparten el tope: cada uno termina su parte en pocos pasos en vez de quedar a medias.
        if (topeRonda) pasosMusicoCorreccion = Math.max(4, Math.floor((topeRonda - 10) / Math.max(1, Math.min(musicos.length, encargos.length || musicos.length))))
        try {
          await corregir(v.problemas)
        } finally {
          pasosMusicoCorreccion = 0
        }
        if (cancelado()) break
        v = await revisar(etapa, medible, ronda, responsables, etapa === 'qa_musicos' ? sobrePresupuesto() : pasado(0.6))
        presupuestoRondaQA = null
        // Mismo veredicto y misma medición que antes de corregir: seguir repitiendo solo gasta tiempo.
        if (!v.aprobado && firmaAntes === firmaMedicion + '#' + v.problemas.map((x) => x.problema).join('|')) {
          omitir(etapa, 'sin_progreso', 'se cortó la revisión de ' + NOMBRE_ETAPA[etapa].toLowerCase().replace(/^revisión de /, '') + ': la corrección no cambió el veredicto ni la medición')
          break
        }
      }
      if (!v.aprobado && v.problemas.length && ronda < maxRondas && ronda >= tope() && !cancelado()) {
        omitir(etapa + ' (rondas)', sobreLimite() ? 'limite' : 'presupuesto', 'se limitaron las correcciones de la ' + NOMBRE_ETAPA[etapa].toLowerCase() + ' ' + POR(sobreLimite() ? 'limite' : 'presupuesto'))
      }
      const resumen = v.aprobado ? v.resumen : [v.resumen, ...v.problemas.map((x) => x.problema)].filter(Boolean).join(' · ').slice(0, 400)
      emitir({ tipo: 'etapa', etapa, fase: 'fin', ok: v.aprobado, ronda, resumen })
      return { etapa, ok: v.aprobado, resumen, rondas: ronda }
    })
  }
}

const BASE_RITMICA = /bater|drum|percus|bajo|bass|groove|ritm/i

/**
 * Oleadas de grabación: primero la base rítmica (batería, bajo) y luego el resto, que ya puede escucharla.
 * Si todos o ninguno son base, una sola oleada.
 */
export function oleadas(lista: Encargo[], musicos: ParticipanteProduccion[]): [Encargo[], Encargo[]] {
  const esBase = (e: Encargo) => {
    const m = musicos.find((x) => x.id === e.participante)
    return BASE_RITMICA.test(`${m?.nombre ?? ''} ${m?.descripcion ?? ''} ${e.participante}`)
  }
  const base = lista.filter(esBase)
  const resto = lista.filter((e) => !esBase(e))
  return base.length && resto.length ? [base, resto] : [lista, []]
}

/** Primera frase (máx. 160 caracteres) de un informe, para el resumen al usuario. */
function breve(s: string): string {
  const t = s.split(' · ')[0]!.trim()
  const frase = /^(.{20,160}?[.!?])(\s|$)/.exec(t)?.[1] ?? t
  return frase.length > 160 ? `${frase.slice(0, 157)}…` : frase
}

export const NOMBRE_ETAPA: Record<EtapaProduccion, string> = {
  plan: 'Plan',
  direccion: 'Dirección',
  musicos: 'Grabación',
  ensayo: 'Ensayo',
  coherencia: 'Coherencia',
  qa_musicos: 'Revisión de las partes',
  mezcla: 'Mezcla',
  qa_mezcla: 'Revisión de la mezcla',
  master: 'Máster',
  qa_master: 'Revisión del máster',
  entrega: 'Entrega',
}
