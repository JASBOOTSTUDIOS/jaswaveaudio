/**
 * Legato worship: «ninguna nota se suelta hasta que el sonido cae». En una pista afinada cada nota o acorde se
 * mantiene (como con el pedal pisado) hasta `solapeMs` DESPUÉS del inicio de la siguiente nota/acorde, sin huecos.
 * Los pads suenan siempre: sostienen hasta el siguiente acorde y se solapan con él (y el último, hasta el fin del clip).
 * La batería y la percusión las excluye quien llama. Función pura: no muta la entrada y es idempotente.
 */

/** Forma mínima de una nota (compatible con `MidiNote` y con las notas crudas de las herramientas). */
export interface NotaLegato {
  pitch: number;
  /** Beats. */
  inicio: number;
  /** Beats. */
  duracion: number;
  mute?: boolean;
}

export interface OpcionesLegatoWorship {
  bpm: number;
  modo: 'legato' | 'pad';
  /** Milisegundos que la nota sigue sonando tras el inicio de la siguiente. Por defecto 500 (pad: 1000). */
  solapeMs?: number;
  /** Fin del clip en beats: ninguna nota se alarga más allá. */
  finClip?: number;
  /** Hueco (beats) a partir del cual es un silencio intencional y no se puentea. Por defecto 8. */
  maxHuecoBeats?: number;
  /** Notas cuyo inicio difiere menos de esto (beats) forman un acorde. Por defecto 1/32. */
  tolAcorde?: number;
  /** Beats (relativos al mismo origen que `inicio`) que ninguna nota cruza: cambios de sección. */
  cortes?: number[];
}

export interface ResumenLegatoWorship {
  /** Notas cuya duración creció. */
  alargadas: number;
  /** Silencios entre eventos que quedaron cubiertos. */
  huecosCerrados: number;
}

export const SOLAPE_LEGATO_MS = 500;
export const SOLAPE_PAD_MS = 1000;
const EPS = 1e-6;
const DUR_MIN = 1 / 32;
/** Separación antes de la re-entrada de la misma altura (beats). */
const RESPIRO_MISMA_NOTA = 1 / 64;

interface Evento {
  inicio: number;
  fin: number;
  indices: number[];
}

export function aplicarLegatoWorship<T extends NotaLegato>(
  notas: readonly T[],
  opciones: OpcionesLegatoWorship,
): { notas: T[]; resumen: ResumenLegatoWorship } {
  const { bpm, modo, finClip } = opciones;
  const solapeMs = opciones.solapeMs ?? (modo === 'pad' ? SOLAPE_PAD_MS : SOLAPE_LEGATO_MS);
  const maxHueco = opciones.maxHuecoBeats ?? 8;
  const tol = opciones.tolAcorde ?? 1 / 32;
  const cortes = opciones.cortes ?? [];
  const solape = bpm > 0 && Number.isFinite(bpm) ? (Math.max(0, solapeMs) * bpm) / 60000 : 0;
  const nuevas: T[] = notas.map((n) => ({ ...n }));
  const resumen: ResumenLegatoWorship = { alargadas: 0, huecosCerrados: 0 };
  if (!solape) return { notas: nuevas, resumen };

  const validas = notas
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => !n.mute && Number.isFinite(n.inicio) && Number.isFinite(n.duracion) && n.duracion > 0)
    .sort((a, b) => a.n.inicio - b.n.inicio || a.n.pitch - b.n.pitch);

  // Eventos: notas simultáneas (acordes).
  const eventos: Evento[] = [];
  for (const { n, i } of validas) {
    const ult = eventos[eventos.length - 1];
    if (ult && n.inicio - ult.inicio <= tol + EPS) {
      ult.indices.push(i);
      ult.fin = Math.max(ult.fin, n.inicio + n.duracion);
    } else eventos.push({ inicio: n.inicio, fin: n.inicio + n.duracion, indices: [i] });
  }

  const tope = (ini: number) => (finClip == null ? Infinity : Math.max(0, finClip - ini));
  const duracionNueva = new Map<number, number>();
  for (let e = 0; e < eventos.length; e++) {
    const ev = eventos[e]!;
    const sig = eventos[e + 1];
    let objetivo: number | null = null; // fin absoluto deseado
    if (sig) {
      const hueco = sig.inicio - ev.fin;
      const cruzaCorte = cortes.some((c) => c > ev.inicio + EPS && c <= sig.inicio + EPS);
      const puentea = !cruzaCorte && (hueco <= maxHueco + EPS || modo === 'pad');
      if (puentea) {
        objetivo = sig.inicio + solape;
        if (hueco > EPS) resumen.huecosCerrados++;
      }
    } else if (modo === 'pad' && finClip != null) objetivo = finClip;
    if (objetivo == null) continue;
    for (const i of ev.indices) {
      const n = notas[i]!;
      const quiere = Math.min(objetivo - n.inicio, tope(n.inicio));
      if (quiere > n.duracion + EPS) duracionNueva.set(i, quiere);
    }
  }

  // Una misma altura que vuelve a sonar antes de acabar se recorta justo antes de su nueva entrada.
  const porAltura = new Map<number, number[]>();
  for (const { i } of validas) {
    const l = porAltura.get(notas[i]!.pitch) ?? [];
    l.push(i);
    porAltura.set(notas[i]!.pitch, l);
  }
  for (const lista of porAltura.values()) {
    for (let k = 0; k < lista.length - 1; k++) {
      const i = lista[k]!;
      const ini = notas[i]!.inicio;
      const j = lista.slice(k + 1).find((x) => notas[x]!.inicio > ini + tol + EPS);
      if (j == null) continue;
      const dur = duracionNueva.get(i) ?? notas[i]!.duracion;
      const limite = notas[j]!.inicio - RESPIRO_MISMA_NOTA - ini;
      if (ini + dur > notas[j]!.inicio - RESPIRO_MISMA_NOTA + EPS && limite >= DUR_MIN) {
        // Solo se recorta lo que este algoritmo habría alargado, o un solape ya existente de la misma altura.
        duracionNueva.set(i, limite);
      }
    }
  }

  for (const [i, d] of duracionNueva) {
    if (Math.abs(d - notas[i]!.duracion) < EPS) continue;
    if (d > notas[i]!.duracion) resumen.alargadas++;
    nuevas[i]!.duracion = d;
  }
  return { notas: nuevas, resumen };
}

export type TipoPistaLegato = 'bateria' | 'pad' | 'afinada';

/** Clasifica una pista por su nombre y los de sus plugins: la batería y la percusión quedan fuera; los pads, en modo `pad`. */
export function clasificarPistaLegato(nombre: string, plugins: ReadonlyArray<{ nombre?: string }> = []): TipoPistaLegato {
  const texto = `${nombre} ${plugins.map((p) => p.nombre ?? '').join(' ')}`;
  if (/bater|drum|percus|kit/i.test(texto)) return 'bateria';
  if (/(^|[^a-z])pads?($|[^a-z])|atmos|shimmer|ambient|ambiente/i.test(texto)) return 'pad';
  return 'afinada';
}
