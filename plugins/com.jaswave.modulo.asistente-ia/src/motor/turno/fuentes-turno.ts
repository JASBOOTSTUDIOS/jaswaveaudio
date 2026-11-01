/**
 * Lista «Fuentes:» automática al cerrar el turno (K6).
 *
 * Las herramientas web de la app registran los enlaces consultados en un registro del host
 * (`jas-wave/src/lib/fuentes-del-turno.ts`) que se expone en `globalThis.__jaswaveFuentesTurno`. Este módulo
 * solo lo consulta de forma defensiva: si no existe (web, tests), no hace nada.
 */

type PuenteFuentes = { limpiar?: () => void; anexar?: (texto: string) => string }

function puente(): PuenteFuentes | null {
  const p = (globalThis as { __jaswaveFuentesTurno?: PuenteFuentes }).__jaswaveFuentesTurno
  return p && typeof p === 'object' ? p : null
}

/** Vacía el registro al empezar un turno. */
export function iniciarFuentesTurno(): void {
  try {
    puente()?.limpiar?.()
  } catch {
    /* sin registro: nada que limpiar */
  }
}

/** Añade «Fuentes:» al texto final si el turno consultó internet y el texto no cita esos enlaces. */
export function conFuentesDelTurno(texto: string): string {
  try {
    const p = puente()
    return p?.anexar ? p.anexar(texto) : texto
  } catch {
    return texto
  }
}
