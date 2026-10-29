/**
 * Comandos de barra del chat del asistente (/aprender, /meta, /plan, /entrevista, /programar, /banda, /configurar).
 *
 * Parser puro: el comando solo se reconoce al INICIO del mensaje y como palabra completa (`/planificar` no es
 * `/plan`), y se detecta antes de añadir el prefijo del audio adjunto.
 */

export type ComandoChat =
  | { tipo: 'aprender'; texto: string }
  | { tipo: 'aprender-deshacer' }
  | { tipo: 'meta'; texto: string }
  | { tipo: 'plan'; texto: string }
  | { tipo: 'entrevista'; texto: string }
  | { tipo: 'programar'; texto: string }
  | { tipo: 'banda'; texto: string }
  | { tipo: 'configurar'; texto: string }

const ALIAS: ReadonlyArray<[RegExp, ComandoChat['tipo']]> = [
  [/^\/(?:configurar|config|personalizar)(?=\s|$)/i, 'configurar'],
  [/^\/(?:aprender|learn)(?=\s|$)/i, 'aprender'],
  [/^\/(?:meta|goal)(?=\s|$)/i, 'meta'],
  [/^\/plan(?=\s|$)/i, 'plan'],
  [/^\/(?:entrevista|grill-me)(?=\s|$)/i, 'entrevista'],
  [/^\/(?:programar|schedule)(?=\s|$)/i, 'programar'],
  [/^\/banda(?=\s|$)/i, 'banda'],
]

/** Devuelve el comando reconocido al inicio del texto, o null si es un mensaje normal. */
export function parsearComandoChat(entrada: string): ComandoChat | null {
  const texto = entrada.trim()
  for (const [re, tipo] of ALIAS) {
    const m = re.exec(texto)
    if (!m) continue
    const resto = texto.slice(m[0].length).trim()
    if (tipo === 'aprender' && /^(?:deshacer|undo)$/i.test(resto)) return { tipo: 'aprender-deshacer' }
    return { tipo, texto: resto } as ComandoChat
  }
  return null
}

/** Texto de ayuda cuando un comando requiere argumento y no lo trae. */
export function ayudaComando(tipo: ComandoChat['tipo']): string {
  switch (tipo) {
    case 'aprender':
      return 'Dime qué debo recordar. Por ejemplo: «/aprender usa siempre Re mayor en los temas de adoración». Para olvidar lo último: «/aprender deshacer».'
    case 'meta':
      return 'Dime la meta y trabajaré hasta cumplirla. Por ejemplo: «/meta deja la mezcla lista para publicar». Para detenerla: «/meta parar».'
    case 'programar':
      return 'Dime cuándo y qué. Por ejemplo: «/programar en 10 minutos revisar la mezcla», «/programar cada 30 minutos revisar el volumen» o «/programar a las 18:30 exportar». Para verlas: «/programar lista»; para cancelar una: «/programar cancelar 1».'
    default:
      return ''
  }
}

/** Convierte un comando con directiva en el texto que recibe el modelo (los que no necesitan reescritura devuelven el texto). */
export function directivaParaModelo(cmd: ComandoChat, original: string): string {
  switch (cmd.tipo) {
    case 'meta':
      return `[DIRECTIVA /META: Trabaja en este objetivo hasta completarlo; informa del progreso y de lo que quede pendiente: "${cmd.texto}"]\n${original}`
    case 'entrevista':
      return `[DIRECTIVA /ENTREVISTA: Activa el modo de alineación interactiva. Hazme preguntas cortas, una a una y con opciones, para definir las decisiones del proyecto: "${cmd.texto || 'Definición de estilo, instrumentación y mezcla'}"]\n${original}`
    case 'plan':
      return `[DIRECTIVA /PLAN: Crea o actualiza docs/plan.md con tareas comprobables e intención musical, y evalúa el progreso respecto al DAW: "${cmd.texto || 'Revisar y estructurar plan de trabajo'}"]\n${original}`
    default:
      return original
  }
}
