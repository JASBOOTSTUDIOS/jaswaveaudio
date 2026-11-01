/**
 * Tempo del proyecto en BPM. En el estado real `project.bpm` es un objeto `{ valor }` (con su historial), no un
 * número: leerlo con `Number(project.bpm)` daba NaN y dejaba sin efecto la humanización, la coordinación de voces y
 * el legato de la banda sin que ningún test lo notara (sus fixtures usaban un número).
 */
export function bpmDeProyecto(project: { bpm?: unknown } | null | undefined): number {
  const b = project?.bpm
  const v = typeof b === 'object' && b !== null ? (b as { valor?: unknown }).valor : b
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
