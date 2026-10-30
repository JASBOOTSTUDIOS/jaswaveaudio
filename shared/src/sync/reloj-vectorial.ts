/**
 * Reloj vectorial: un contador por cliente. Permite saber si dos cambios son causales
 * (uno vio al otro) o concurrentes (ninguno vio al otro), p. ej. para avisar en la UI
 * de que dos colaboradores editaron lo mismo a la vez. El orden de aplicación lo fija
 * siempre el servidor (seq), así que el reloj no decide el resultado: lo explica.
 */

export type RelojVectorial = Readonly<Record<string, number>>;

export type RelacionCausal = 'igual' | 'antes' | 'despues' | 'concurrente';

export function incrementar(reloj: RelojVectorial, clienteId: string): RelojVectorial {
  return { ...reloj, [clienteId]: (reloj[clienteId] ?? 0) + 1 };
}

/** Máximo componente a componente. */
export function fusionar(a: RelojVectorial, b: RelojVectorial): RelojVectorial {
  const r: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) r[k] = Math.max(r[k] ?? 0, v);
  return r;
}

/** Relación de `a` respecto de `b`. */
export function comparar(a: RelojVectorial, b: RelojVectorial): RelacionCausal {
  let menor = false;
  let mayor = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x < y) menor = true;
    if (x > y) mayor = true;
  }
  if (menor && mayor) return 'concurrente';
  if (menor) return 'antes';
  if (mayor) return 'despues';
  return 'igual';
}
