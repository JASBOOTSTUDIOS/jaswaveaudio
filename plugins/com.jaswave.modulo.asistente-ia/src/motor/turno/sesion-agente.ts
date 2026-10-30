/**
 * Modos que duran varios mensajes en una conversación: una meta (/meta) que el agente persigue hasta
 * cumplirla, una entrevista (/entrevista) en la que pregunta hasta tener claras las decisiones y
 * /configurar: una entrevista con recomendaciones para crear, editar o eliminar la configuración del
 * asistente (reglas, habilidades, prompts y planes). Dura hasta «/configurar salir».
 */

export type ModoSesion =
  | { tipo: 'meta'; objetivo: string; progreso?: string; inicio: number }
  | { tipo: 'entrevista'; tema: string; inicio: number }
  | { tipo: 'configurar'; tema: string; inicio: number }

const CLAVE = 'jaswave-agente-sesiones-v1'
const MAX_EDAD_MS = 7 * 24 * 3600_000

function leer(): Record<string, ModoSesion> {
  try {
    const raw = localStorage.getItem(CLAVE)
    const p = raw ? (JSON.parse(raw) as Record<string, ModoSesion>) : {}
    const ahora = Date.now()
    return Object.fromEntries(Object.entries(p).filter(([, v]) => v && ahora - v.inicio < MAX_EDAD_MS))
  } catch {
    return {}
  }
}

function escribir(m: Record<string, ModoSesion>): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(m))
  } catch {
    /* sin almacenamiento: el modo dura solo este turno */
  }
}

export function modoSesion(conversationId: string): ModoSesion | null {
  return leer()[conversationId] ?? null
}

export function fijarModoSesion(conversationId: string, modo: ModoSesion | null): void {
  const m = leer()
  if (modo) m[conversationId] = modo
  else delete m[conversationId]
  escribir(m)
}
