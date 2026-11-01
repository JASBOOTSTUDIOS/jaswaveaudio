/**
 * Reparación de notas MIDI inválidas.
 *
 * Propósito:
 *   Versiones anteriores podían guardar notas con `inicio`/`duracion`/`pitch`
 *   no numéricos (NaN en memoria → `null` en el JSON). Una sola nota así
 *   rompía el piano roll (anchos NaN) y, con la validación por esquema, haría
 *   que el proyecto entero no abriera.
 *
 * Función:
 *   `esNotaMidiValida` decide si una nota es utilizable y
 *   `repararNotasMidi` devuelve una copia del proyecto sin las notas inválidas
 *   junto con cuántas se eliminaron.
 */

export function esNotaMidiValida(n: unknown): boolean {
  if (!n || typeof n !== 'object') return false;
  const nota = n as { pitch?: unknown; inicio?: unknown; duracion?: unknown };
  return (
    typeof nota.pitch === 'number' &&
    Number.isFinite(nota.pitch) &&
    typeof nota.inicio === 'number' &&
    Number.isFinite(nota.inicio) &&
    typeof nota.duracion === 'number' &&
    Number.isFinite(nota.duracion) &&
    nota.duracion > 0
  );
}

/** Copia del proyecto sin notas MIDI inválidas (no muta la entrada). */
export function repararNotasMidi<T>(proyecto: T): { proyecto: T; eliminadas: number } {
  const p = proyecto as { tracks?: unknown };
  if (!p || typeof p !== 'object' || !Array.isArray(p.tracks)) return { proyecto, eliminadas: 0 };
  let eliminadas = 0;
  const tracks = p.tracks.map((t) => {
    const track = t as { clips?: unknown };
    if (!track || typeof track !== 'object' || !Array.isArray(track.clips)) return t;
    let cambio = false;
    const clips = track.clips.map((c) => {
      const clip = c as { notas?: unknown };
      if (!clip || typeof clip !== 'object' || !Array.isArray(clip.notas)) return c;
      const validas = clip.notas.filter(esNotaMidiValida);
      if (validas.length === clip.notas.length) return c;
      eliminadas += clip.notas.length - validas.length;
      cambio = true;
      return { ...clip, notas: validas };
    });
    return cambio ? { ...track, clips } : t;
  });
  if (eliminadas === 0) return { proyecto, eliminadas: 0 };
  return { proyecto: { ...(proyecto as object), tracks } as T, eliminadas };
}
