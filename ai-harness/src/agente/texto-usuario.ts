/**
 * Limpia la respuesta del modelo antes de mostrarla: los usuarios de JasWave no deben ver JSON, marcadores
 * internos, nombres técnicos de herramientas ni identificadores largos.
 */

const MARCADORES = /<<<[A-Z_ ]+>>>|<\/?(?:think|thinking|tool_call|tool_response|function_call)[^>]*>/gi
const BLOQUE_CODIGO = /```[\s\S]*?(```|$)/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const ID_TECNICO = /\b(?:trk|track|clip|note|slot|fx|bus)[_-][A-Za-z0-9_-]{4,}\b/g
const ENTRE_COMILLAS_INVERSAS = /`([^`\n]{1,80})`/g
const HERRAMIENTA_EN_TEXTO = /\b[a-z]+(?:\.[a-zA-Z]+){1,3}\b(?=\s*(?:\(|$|[\s,.;:]))/g

/** Quita el razonamiento visible y el JSON suelto que algunos modelos pequeños escriben. */
function quitarJsonSuelto(t: string): string {
  return t
    .split('\n')
    .filter((linea) => {
      const s = linea.trim()
      if (!s) return true
      if (/^[[{]/.test(s) && /[\]}],?$/.test(s)) return false
      if (/^"[\w.]+"\s*:/.test(s)) return false
      return true
    })
    .join('\n')
}

export function limpiarTextoUsuario(texto: string, o: { nombresHerramientas?: Iterable<string> } = {}): string {
  let t = String(texto ?? '')
  t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  t = t.replace(BLOQUE_CODIGO, '')
  t = t.replace(MARCADORES, '')
  t = quitarJsonSuelto(t)
  const nombres = new Set(o.nombresHerramientas ?? [])
  t = t.replace(ENTRE_COMILLAS_INVERSAS, (_m, dentro: string) => (nombres.has(dentro) || /[._]/.test(dentro) && !/\s/.test(dentro) ? '' : dentro))
  t = t.replace(HERRAMIENTA_EN_TEXTO, (m) => (nombres.has(m) ? '' : m))
  t = t.replace(UUID, '').replace(ID_TECNICO, '')
  t = t
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+([,.;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t
}
