import { ejecutarLeerHabilidad, H_LEER_HABILIDAD, herramientaLeerHabilidad, listadoHabilidades, unirHabilidades, type HabilidadAgente } from './habilidades'
import { Candado, ejecutarAgente, type EjecutorHerramienta } from './runtime'
import { seleccionarIniciales } from './seleccion'
import type { ChatAgente, EventoAgente, HerramientaAgente, PerfilSubagente, RegistroLlamada, ResultadoAgente } from './tipos'

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
  | { tipo: 'participante'; etapa: EtapaProduccion; participante: { id: string; nombre: string; rol: RolProduccion }; estado: ResultadoAgente['estado']; error?: string }
  | { tipo: 'qa'; etapa: EtapaProduccion; ronda: number; veredicto: VeredictoQA; medicion?: MedicionQA | null }
  /** Una indicación del usuario llegó al agente en turno (en mitad de su trabajo). */
  | { tipo: 'nota'; etapa: EtapaProduccion; participante: { id: string; nombre: string; rol: RolProduccion }; texto: string }

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
   * Ensayo de la banda tras grabar (por defecto, cuando hay dos o más músicos): cada uno escucha a los demás,
   * propone ajustes y el director arbitra; lo acordado se vuelve a tocar. `false` lo desactiva.
   */
  ensayo?: boolean
  maxRondasQA?: number
  maxPasos?: number
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
export type HojaDeRuta = { tonalidad: string; bpm?: number; numerador: number; secciones: SeccionHoja[] }

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
  return { tonalidad: String(v.tonalidad ?? '').trim(), ...(bpm > 20 && bpm < 300 ? { bpm } : {}), numerador, secciones }
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

const MAX_ENCARGOS = 8

/**
 * Pasos del modelo por rol. Quien escribe (notas, mezcla, máster) consulta, crea, comprueba y corrige:
 * con 10 pasos el pianista o el máster se quedaban a medias y el QA tenía que rehacerlo.
 */
export const PASOS_POR_ROL: Partial<Record<RolProduccion, number>> = {
  planificador: 8,
  director: 12,
  // Una parte de canción completa son ~10 secciones (un clip cada una) más cargar y comprobar el instrumento.
  musico: 36,
  coherencia: 40,
  qa: 14,
  mezcla: 24,
  master: 14,
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
    'Eres un músico de sesión y tocas en una banda: sabes qué hace cada compañero (reparto más abajo) y tu parte debe encajar con las suyas, no lucirse sola. Toca como una persona, no como una máquina: el cifrado es un punto de partida, no una jaula. Usa toda la escala de la tonalidad (notas de paso, bordaduras, apoyaturas, anticipaciones) y colorea los acordes con extensiones (add9, sus2/sus4, 6, maj7, m7, 11) e inversiones; en el tiempo fuerte de cada compás que suene el acorde de ese compás y el resto del compás tiene libertad. Varía las duraciones (largas en los apoyos, cortas de paso, alguna síncopa y anticipación en la «y» de 4, silencios), arpegia y adorna en vez de repetir el mismo bloque en cada compás; ninguna frase igual dos compases seguidos. Humaniza: velocidades distintas en cada nota (±10, acentos en los apoyos, más suaves las de paso) y micro-tiempo de hasta ±0,04 beats en instrumentos melódicos y armónicos (la batería, en la rejilla, humanizada con velocidades y ghost notes). Sigue la HOJA DE RUTA: cada compás con su acorde, cada sección en su beat de inicio y con su largo; notas de la tonalidad (las cromáticas, breves y de paso). Así todas las partes encajan entre sí y suenan vivas. Trabaja solo en la pista de tu encargo; si no existe, créala una sola vez. Nunca dupliques pistas. Tiempos en beats: el `inicio` del clip cuenta desde el principio de la canción (compás N = beat (N−1)×4 en 4/4) y el `inicio` de cada nota cuenta desde el principio de SU clip (la primera nota de un clip suele estar en 0). Un clip por sección, del largo de la sección. Al terminar, comprueba con `analysis.trackSound` que tu pista suena: si no tiene instrumento o el VST no cargó, cárgalo como te indique.',
  coherencia:
    'Eres el arreglista: te encargas de que TODAS las partes sean congruentes entre sí y con el proyecto, en tiempo, en armonía y en ritmo. Recibes la hoja de ruta y la medición del DAW con los compases exactos donde algo no encaja (y el acorde que toca en cada uno). Trabaja con método: por cada pista señalada, lee UNA vez el clip de esa sección con `midi.notes.get` y corrige todos sus compases en un solo `midi.notes.patch` (rango en beats de la canción; o `midi.notes.set` con reemplazarTodas si hay que rehacer el clip). Nunca cambies tonalidad, tempo ni forma, ni toques pistas que no estén señaladas. Si una parte está tan fuera de lugar que habría que rehacerla entera, devuélvela a su músico con `devolver_trabajo` en vez de reescribirla tú. Reglas: cada clip empieza en el beat de su sección; las notas caen cerca de la rejilla (semicorcheas o tresillos; un desvío humano de hasta ±0,05 beats es bueno, NO lo cuantices); en el tiempo fuerte de cada compás suenan notas del acorde de ese compás (las extensiones add9, 6, maj7, sus cuentan como del acorde); el bajo toca la fundamental (o la nota tras «/») en el primer tiempo y se apoya en el bombo; nada suena después del final. Conserva la intención musical de cada músico: corrige lo mínimo y nunca «aplanes» una parte (no igualar duraciones ni velocidades, no quitar notas de paso, adornos ni síncopas). Si la medición dice que una parte suena robótica (todas las notas iguales), no la arregles tú: devuélvela a su músico con `devolver_trabajo`.',
  qa:
    'Eres el control de calidad. Solo consultas: revisa el proyecto con las herramientas de lectura y análisis y entrega `veredicto_calidad`. Marca solo problemas que hayas comprobado y que el responsable pueda corregir; lo que no puedes comprobar no es un problema. Usa `analysis.trackSound` para comprobar que cada pista suena (instrumento cargado, sin mute ni solo que la tape, fader razonable). Nombra pistas por su nombre, nunca por id.',
  mezcla:
    'Eres el ingeniero de mezcla. Equilibra volúmenes y paneo, aplica ecualización, compresión y envíos donde haga falta. Empieza con `analysis.trackSound` y corrige primero lo que impide oír una pista (mute, solo, fader casi a cero). Usa solo herramientas que existan en tu lista o en `buscar_herramientas`. Volumen con `track.update` (datos.volumen lineal 0–4, 1 = 0 dB) y paneo (datos.paneo −1 a 1); EQ con `mix.eq`, compresión con `mix.compress`; para la reverb crea un bus con `bus.create` y manda los instrumentos con `send.set`. No cambies las notas ni el arreglo. Eres también un filtro: si oyes algo que no es de tu oficio —una parte mal tocada o vacía, notas que chocan con la armonía, una pista que no suena por su parte— no lo tapes con la mezcla: devuélvelo con `devolver_trabajo` (al músico o al arreglista) y sigue con lo tuyo; cuando lo corrijan, retomarás la mezcla.',
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
  const de = (rol: RolProduccion) => cfg.participantes.filter((p) => p.rol === rol)
  const uno = (rol: RolProduccion) => de(rol)[0] ?? null
  const musicos = de('musico')
  const cancelado = () => !!cfg.signal?.aborted
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
  let capturaVeredicto: VeredictoQA | null = null
  let capturaHoja: HojaDeRuta | null = null
  let capturaDevoluciones: Devolucion[] = []
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
    if (creadas && (creadas.has(suya.id.toLowerCase()) || creadas.has(suya.nombre.toLowerCase()) || creadas.has(ref.toLowerCase()))) return null
    // El máster y los buses no son pistas de músico: eso es de la mezcla.
    if (cfg.resolverPista && !resuelta) {
      return `«${ref}» no es una pista de músico (el máster y los buses son de la mezcla): tu encargo es en «${mia.nombre}» = "${mia.id}". Repite la llamada con pistaId "${mia.id}".`
    }
    const esDe = (e: Encargo) => {
      if (!e.pista) return false
      const p = cfg.resolverPista?.(e.pista) ?? { id: e.pista, nombre: e.pista }
      return igual(ref, e.pista) || suya.id === p.id || igual(suya.nombre, p.nombre) || (pistasCreadas.get(e.participante)?.has(suya.id.toLowerCase()) ?? false)
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
  }): Promise<ResultadoAgente> => {
    const permitidas = o.p?.herramientas?.length ? new Set(o.p.herramientas) : null
    // Habilidades: las de serie del rol más las propias del participante (las suyas mandan si repiten id).
    const habilidades = unirHabilidades(cfg.habilidadesPorRol?.[o.rol], o.p?.habilidades)
    const extras = [...(o.extras ?? []), ...(habilidades.length ? [herramientaLeerHabilidad(habilidades)] : [])]
    const propio = extras.map((h) => h.nombre)
    const catalogo = [...extras, ...(permitidas ? cfg.catalogo.filter((h) => permitidas.has(h.nombre)) : cfg.catalogo)]
    const ids = new Set(cfg.participantes.map((p) => p.id))
    const quien = { id: o.p?.id ?? o.rol, nombre: o.p?.nombre ?? o.rol, rol: o.rol }
    const ejecutar: EjecutorHerramienta = async (l, h, ctx) => {
      if (h.nombre === H_LEER_HABILIDAD) return ejecutarLeerHabilidad(l, habilidades)
      // Propiedad de pista: un músico escribe solo en la pista de su encargo (o en una que creó él).
      if (o.rol === 'musico' && o.p && h.clase !== 'lectura' && !propio.includes(h.nombre)) {
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
      const r = await cfg.ejecutar(l, h, ctx)
      if (r.ok && o.rol === 'musico' && o.p && h.nombre === 'track.create') anotarPistaCreada(o.p.id, r.datos, l.argumentos)
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
    const r = await ejecutarAgente({
      pedido: o.pedido,
      catalogo,
      // Con herramientas limitadas, el agente las ve todas desde el principio; si no, las de su oficio más
      // las que se eligen por relevancia.
      iniciales: permitidas
        ? [...propio, ...deOficio, ...[...permitidas].slice(0, 30)]
        : deOficio.length
          ? [...propio, ...deOficio, ...seleccionarIniciales(o.pedido, catalogo, { base })]
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
      chat: cfg.chat,
      ejecutar,
      soloLectura: o.soloLectura,
      maxPasos: cfg.maxPasos ?? PASOS_POR_ROL[o.rol] ?? 10,
      maxSubagentes: 0,
      onEvento: (evento) => emitir({ tipo: 'agente', etapa: o.etapa, participante: quien, evento }),
      notas: notasNuevas,
      signal: cfg.signal,
      // Profundidad 1: sin delegar ni preguntar al usuario (el orquestador coordina).
      profundidad: 1,
      nombreAgente: quien.id,
      candado,
    })
    llamadas.push(...r.llamadas)
    emitir({ tipo: 'participante', etapa: o.etapa, participante: quien, estado: r.estado, ...(r.error ? { error: r.error } : {}) })
    return r
  }

  /** Revisión con medición del host + agente QA; devuelve el veredicto combinado. */
  const revisar = async (etapa: EtapaProduccion, medible: EtapaMedible, ronda: number, responsables: ParticipanteProduccion[]): Promise<VeredictoQA> => {
    const medicion = cfg.medir ? await cfg.medir(medible).catch(() => null) : null
    const qa = uno('qa')
    let veredicto: VeredictoQA | null = null
    if (qa) {
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
    return { estado, plan, etapas, encargos, llamadas, texto }
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
  const correrMusico = async (e: Encargo) =>
    correr({ etapa: 'musicos', p: musicos.find((m) => m.id === e.participante) ?? null, rol: 'musico', pedido: `${e.encargo}${reparto(e.participante)}${await escuchar()}` })
  const grabar = async (lista: Encargo[]) => {
    const [base, resto] = oleadas(lista, musicos)
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
    await grabar(
      [...porMusico.entries()].map(([participante, lista]) => ({
        participante,
        encargo: `Te devuelven tu parte desde ${NOMBRE_ETAPA[desde].toLowerCase()}: ${lista.join('; ')}.\nCorrige editando o reemplazando tus clips en tu pista: no crees pistas nuevas ni dupliques clips.\nEncargo original: ${encargos.find((e) => e.participante === participante)?.encargo ?? ''}`,
      })),
    )
    return porMusico.size
  }

  /** La coherencia se vuelve a medir (y corregir) y sustituye al informe anterior: la última medición es la que cuenta. */
  const remedirCoherencia = async (h: HojaDeRuta, forzadas?: string[]) => {
    const otra = await cicloCoherencia(h, forzadas)
    const i = etapas.findIndex((e) => e.etapa === 'coherencia')
    if (i >= 0) etapas[i] = { ...otra, rondas: (etapas[i]!.rondas ?? 0) + (otra.rondas ?? 0) }
    else etapas.push(otra)
  }

  /**
   * Atiende lo que un agente devolvió al equipo: músicos → regraban y se vuelve a medir la coherencia;
   * arreglista → corrige; mezcla → retoca. Devuelve un resumen para que el agente que devolvió retome su etapa.
   */
  const atenderDevoluciones = async (etapa: EtapaProduccion, devs: Devolucion[]): Promise<string> => {
    if (!devs.length) return ''
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
  emitir({ tipo: 'etapa', etapa: 'plan', fase: 'inicio' })
  const planificador = uno('planificador') ?? uno('director')
  const rPlan = await correr({ etapa: 'plan', p: planificador, rol: 'planificador', soloLectura: true, extras: [herramientaHoja()], pedido: `Planifica esta producción: ${cfg.pedido}` })
  if (cancelado()) return terminar('cancelado', 'Producción detenida.')
  // Sin hoja común cada músico inventa su forma y su armonía: se pide una vez más.
  if (!capturaHoja && rPlan.estado !== 'fallo') {
    await correr({ etapa: 'plan', p: planificador, rol: 'planificador', soloLectura: true, extras: [herramientaHoja()], pedido: `Entrega ya la hoja de ruta con \`hoja_de_ruta\` para: ${cfg.pedido}` })
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
  }
  hoja = capturaHoja as HojaDeRuta | null
  plan = [hoja ? hojaComoTexto(hoja) : '', rPlan.texto || (hoja ? '' : cfg.pedido)].filter(Boolean).join('\n\n')
  etapas.push({ etapa: 'plan', ok: rPlan.estado === 'completado', resumen: plan.slice(0, 400) })
  emitir({ tipo: 'etapa', etapa: 'plan', fase: 'fin', ok: true, resumen: plan.slice(0, 400) })
  if (rPlan.estado === 'fallo') return terminar('fallo', `No se pudo planificar: ${(rPlan.error ?? 'el modelo no respondió').replace(/[.\s]+$/, '')}.`)

  // 2. Dirección: preparación común y reparto
  emitir({ tipo: 'etapa', etapa: 'direccion', fase: 'inicio' })
  if (musicos.length) {
    capturaEncargos = null
    const rDir = await correr({
      etapa: 'direccion',
      p: uno('director'),
      rol: 'director',
      extras: [herramientaEncargos(musicos)],
      pedido: [
        `Prepara la producción y reparte el trabajo. Pedido del usuario: «${cfg.pedido}».`,
        'Músicos disponibles:',
        ...musicos.map((m) => `- ${m.id}: ${m.nombre} — ${m.descripcion}`),
      ].join('\n'),
    })
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    // Si el director no repartió, cada músico recibe el plan como encargo.
    encargos = (capturaEncargos as Encargo[] | null) ?? musicos.map((m) => ({ participante: m.id, encargo: `Graba tu parte (${m.descripcion}) siguiendo el plan.` }))
    etapas.push({ etapa: 'direccion', ok: rDir.estado !== 'fallo', resumen: rDir.texto.slice(0, 300) })
  }
  emitir({ tipo: 'encargos', encargos })
  emitir({ tipo: 'etapa', etapa: 'direccion', fase: 'fin', ok: true })

  // 3. Músicos por oleadas (la base rítmica primero; los demás la escuchan) + QA con rondas de corrección
  if (encargos.length) {
    emitir({ tipo: 'etapa', etapa: 'musicos', fase: 'inicio' })
    const r = await grabar(encargos)
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    const okMusicos = r.filter((x) => x.estado === 'completado').length
    etapas.push({ etapa: 'musicos', ok: okMusicos === r.length, resumen: `${okMusicos} de ${r.length} partes grabadas` })
    emitir({ tipo: 'etapa', etapa: 'musicos', fase: 'fin', ok: okMusicos > 0, resumen: `${okMusicos} de ${r.length} partes grabadas` })

    // 3a. Ensayo: la banda se escucha, se pone de acuerdo y ajusta antes de que nadie revise.
    // Ensayan los que grabaron algo (quien no escribió nada no tiene parte que encajar).
    const grabaron = new Set(encargos.map((e) => e.participante).filter((id) => llamadas.some((l) => l.agente === id && l.ok && l.clase === 'escritura')))
    if (cfg.ensayo !== false && grabaron.size >= 2) {
      etapas.push(await ensayar(grabaron))
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    }

    // 3b. Coherencia: el arreglista mide (determinista) y corrige hasta que todo encaje en tiempo, armonía y ritmo.
    if (hoja && cfg.coherencia && okMusicos > 0) {
      const informeCoherencia = await cicloCoherencia(hoja)
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      etapas.push(informeCoherencia)
    }

    const informe = await cicloQA('qa_musicos', 'musicos', musicos, async (problemas) => {
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
    etapas.push(informe)
    // Si el QA hizo regrabar partes, la coherencia se mide otra vez (la última medición es la que cuenta).
    if (informe.rondas && hoja && cfg.coherencia) {
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
    if (!p) continue
    emitir({ tipo: 'etapa', etapa, fase: 'inicio' })
    const pedido = rol === 'mezcla' ? `Mezcla la canción según el plan. Pedido del usuario: «${cfg.pedido}».` : 'Prepara el máster de la canción.'
    // Filtro: la mezcla puede devolver a músicos o arreglista; el máster, además, a la mezcla.
    const destinos: DestinoDevolucion[] = rol === 'mezcla' ? ['musicos', 'arreglista'] : uno('mezcla') ? ['musicos', 'arreglista', 'mezcla'] : ['musicos', 'arreglista']
    const extras = [herramientaDevolver(destinos, musicos)]
    let r = await correr({ etapa, p, rol, pedido, extras })
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    const devueltas = tomarDevoluciones()
    if (devueltas.length) {
      const atendido = await atenderDevoluciones(etapa, devueltas)
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      r = await correr({
        etapa,
        p,
        rol,
        extras,
        pedido: `Lo que devolviste ya se atendió (${atendido || 'sin cambios'}). Termina ${rol === 'mezcla' ? 'la mezcla' : 'el máster'}: comprueba con tus herramientas y ajusta lo que haga falta.`,
      })
      if (cancelado()) return terminar('cancelado', 'Producción detenida.')
      tomarDevoluciones()
    }
    etapas.push({ etapa, ok: r.estado === 'completado', resumen: r.texto.slice(0, 300) })
    emitir({ tipo: 'etapa', etapa, fase: 'fin', ok: r.estado === 'completado', resumen: r.texto.slice(0, 300) })
    const informe = await cicloQA(qaEtapa, medible, [p], async (problemas) => {
      await correr({ etapa, p, rol, extras, pedido: `Corrige solo lo que corresponde a ${rol === 'mezcla' ? 'la mezcla' : 'el máster'}: ${problemas.map((x) => x.problema).join('; ')}` })
      const d = tomarDevoluciones()
      if (d.length && !cancelado()) await atenderDevoluciones(etapa, d)
    })
    if (cancelado()) return terminar('cancelado', 'Producción detenida.')
    etapas.push(informe)
  }

  const revisiones = etapas.filter((e) => e.etapa.startsWith('qa_') || e.etapa === 'coherencia' || e.etapa === 'ensayo')
  const todoOk = etapas.every((e) => e.ok)
  const texto = [
    todoOk ? 'La producción está lista.' : 'La producción terminó con algunos avisos.',
    ...revisiones.map((e) => `${NOMBRE_ETAPA[e.etapa]}: ${e.ok ? 'aprobada' : 'con avisos'}${e.rondas ? ` (${e.rondas} ${e.rondas === 1 ? 'corrección' : 'correcciones'})` : ''}.${e.ok ? '' : ` ${breve(e.resumen)}`}`),
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
    while ((pendientes.length || (m && !m.ok)) && ronda < RONDAS_COHERENCIA && !cancelado()) {
      ronda++
      const problemas = [...pendientes, ...(m && !m.ok ? m.detalles : [])]
      pendientes = []
      await correr({
        etapa: 'coherencia',
        p: arreglista,
        rol: 'coherencia',
        extras: [herramientaDevolver(['musicos'], musicos)],
        pedido: [
          'Haz que todas las partes encajen con la hoja de ruta y entre sí. Problemas detectados (medición del DAW y avisos de otros agentes; pista: problema, compases):',
          ...problemas.map((d) => `- ${d}`),
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
    }
    const ok = m?.ok ?? true
    const resumen = m ? (m.ok ? 'Todas las partes encajan en tiempo, armonía y ritmo.' : m.detalles.join(' · ').slice(0, 400)) : 'Sin medición de coherencia.'
    emitir({ tipo: 'qa', etapa: 'coherencia', ronda, veredicto: { aprobado: ok, problemas: ok ? [] : (m?.detalles ?? []).map((d) => ({ problema: d })), resumen }, medicion: m })
    emitir({ tipo: 'etapa', etapa: 'coherencia', fase: 'fin', ok, ronda, resumen })
    return { etapa: 'coherencia', ok, resumen, rondas: ronda }
  }

  async function cicloQA(
    etapa: EtapaProduccion,
    medible: EtapaMedible,
    responsables: ParticipanteProduccion[],
    corregir: (problemas: ProblemaQA[]) => Promise<void>,
  ): Promise<InformeEtapa> {
    emitir({ tipo: 'etapa', etapa, fase: 'inicio', ronda: 0 })
    let v = await revisar(etapa, medible, 0, responsables)
    let ronda = 0
    // Solo se corrige lo que tiene problemas concretos (si el QA no pudo revisar, no se repite a ciegas).
    while (!v.aprobado && v.problemas.length && ronda < maxRondas && !cancelado()) {
      ronda++
      await corregir(v.problemas)
      if (cancelado()) break
      v = await revisar(etapa, medible, ronda, responsables)
    }
    const resumen = v.aprobado ? v.resumen : [v.resumen, ...v.problemas.map((p) => p.problema)].filter(Boolean).join(' · ').slice(0, 400)
    emitir({ tipo: 'etapa', etapa, fase: 'fin', ok: v.aprobado, ronda, resumen })
    return { etapa, ok: v.aprobado, resumen, rondas: ronda }
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
