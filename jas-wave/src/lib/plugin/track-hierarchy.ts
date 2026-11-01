/**
 * Jerarquía de carpetas-bus para el grafo nativo: a qué stem va la salida de cada pista
 * y quién suena con mute/solo heredados.
 */

export type PistaJerarquia = {
  id: string
  tipo?: string
  padreId?: string
  silenciada?: boolean
  soloActiva?: boolean
}

/**
 * Padre efectivo de cada pista: solo si existe en la lista, es una carpeta y no forma ciclo.
 * Una pista cuyo padre no sirve queda en la raíz (sale al master).
 */
export function padresEfectivos(pistas: readonly PistaJerarquia[]): Map<string, string> {
  const porId = new Map(pistas.map((p) => [p.id, p]))
  const padres = new Map<string, string>()
  for (const p of pistas) {
    const padre = p.padreId ? porId.get(p.padreId) : undefined
    if (!padre || padre.id === p.id || padre.tipo !== 'carpeta') continue
    padres.set(p.id, padre.id)
  }
  // Rompe ciclos (a→b→a): la pista que cierra el ciclo pasa a la raíz.
  for (const p of pistas) {
    const vistos = new Set<string>([p.id])
    let actual = padres.get(p.id)
    while (actual) {
      if (vistos.has(actual)) {
        padres.delete(p.id)
        break
      }
      vistos.add(actual)
      actual = padres.get(actual)
    }
  }
  return padres
}

/** Ancestros de `id`, del padre hacia la raíz. */
export function ancestros(id: string, padres: ReadonlyMap<string, string>): string[] {
  const out: string[] = []
  let actual = padres.get(id)
  while (actual && !out.includes(actual)) {
    out.push(actual)
    actual = padres.get(actual)
  }
  return out
}

/**
 * Pistas que suenan con herencia de carpetas:
 * - mute: una pista calla si ella o cualquier carpeta por encima está silenciada;
 * - solo: con algún solo activo suena la pista en solo, todo lo que cuelga de una carpeta en solo
 *   y las carpetas por encima de una pista en solo (si no, su salida no llegaría al master).
 * Los buses de retorno (`busIds`) no los apaga el solo de otra pista, para no perder los envíos.
 */
export function pistasAudibles(
  pistas: readonly PistaJerarquia[],
  busIds: ReadonlySet<string> = new Set(),
): Set<string> {
  const padres = padresEfectivos(pistas)
  const porId = new Map(pistas.map((p) => [p.id, p]))
  const enSolo = pistas.filter((p) => p.soloActiva)
  const audibles = new Set<string>()

  if (enSolo.length > 0) {
    const porSolo = new Set<string>()
    for (const p of enSolo) {
      porSolo.add(p.id)
      for (const a of ancestros(p.id, padres)) porSolo.add(a)
    }
    for (const p of pistas) {
      if (porSolo.has(p.id) || busIds.has(p.id)) audibles.add(p.id)
      else if (ancestros(p.id, padres).some((a) => porId.get(a)?.soloActiva)) audibles.add(p.id)
    }
    return audibles
  }

  for (const p of pistas) {
    if (p.silenciada) continue
    if (ancestros(p.id, padres).some((a) => porId.get(a)?.silenciada)) continue
    audibles.add(p.id)
  }
  return audibles
}

/** Profundidad de anidado (0 = raíz) para la sangría de la cabecera. */
export function profundidad(id: string, padres: ReadonlyMap<string, string>): number {
  return ancestros(id, padres).length
}

export type ComandoSoltar =
  | { type: 'track.move'; payload: { trackId: string; toIndex: number } }
  | { type: 'track.update'; payload: { trackId: string; datos: { padreId: string | null } } }

/**
 * Comandos al soltar la pista `arrastrada` sobre la cabecera `destino` del Arrange:
 * - `dentro` (sobre la mitad derecha de una carpeta): la pista pasa a colgar de esa carpeta, justo debajo;
 * - si no: reordena a la posición del destino y adopta su carpeta (soltar entre las hijas de una carpeta
 *   la mete; soltar sobre la propia carpeta o entre pistas raíz la saca).
 * Nunca crea ciclos (una carpeta no entra en sí misma ni en una de sus hijas).
 */
export function planSoltarPista(
  pistas: readonly PistaJerarquia[],
  arrastrada: string,
  destino: string,
  dentro: boolean,
): ComandoSoltar[] {
  const from = pistas.findIndex((p) => p.id === arrastrada)
  const to = pistas.findIndex((p) => p.id === destino)
  if (from < 0 || to < 0 || from === to) return []
  const padres = padresEfectivos(pistas)
  const meterDentro = dentro && pistas[to]!.tipo === 'carpeta'
  const nuevoPadre = meterDentro ? destino : (padres.get(destino) ?? null)
  const out: ComandoSoltar[] = []
  // track.move quita la pista y la inserta en toIndex: hacia abajo queda tras el destino, hacia arriba antes.
  const toIndex = meterDentro ? (from < to ? to : to + 1) : to
  if (toIndex !== from) out.push({ type: 'track.move', payload: { trackId: arrastrada, toIndex } })
  const padreActual = padres.get(arrastrada) ?? null
  if (nuevoPadre !== padreActual && !creariaCiclo(arrastrada, nuevoPadre ?? undefined, padres)) {
    out.push({ type: 'track.update', payload: { trackId: arrastrada, datos: { padreId: nuevoPadre } } })
  }
  return out
}

/** true si mover `id` dentro de `nuevoPadreId` crearía un ciclo. */
export function creariaCiclo(
  id: string,
  nuevoPadreId: string | undefined,
  padres: ReadonlyMap<string, string>,
): boolean {
  if (!nuevoPadreId) return false
  if (nuevoPadreId === id) return true
  return ancestros(nuevoPadreId, padres).includes(id)
}
