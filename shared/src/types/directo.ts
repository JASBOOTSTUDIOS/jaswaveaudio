/**
 * Modo Directo (K3): zonas MIDI (splits, capas, transposición, curva de velocidad), seguridad del máster
 * (limitador true-peak) y bloqueo de edición mientras se toca en vivo.
 *
 * Las zonas viven en `project.directo.zonas`: cada una apunta a una pista (`pistaId`); el MIDI que llega a
 * la pista pasa por sus zonas activas (todas sus capas reciben el resultado). Una pista sin zonas recibe el
 * teclado completo sin transponer. Las funciones puras de aquí se usan en el thru web y en los tests; el
 * host nativo aplica la misma lógica en el hilo de audio.
 */

export type CurvaVelocidad = 'lineal' | 'suave' | 'dura' | 'fija';

export const CURVAS_VELOCIDAD: readonly CurvaVelocidad[] = ['lineal', 'suave', 'dura', 'fija'];

export interface ZonaMidi {
  id: string;
  pistaId: string;
  /** Nota MIDI más grave (0..127). */
  lo: number;
  /** Nota MIDI más aguda (0..127), inclusive. */
  hi: number;
  /** Semitonos (−60..60). */
  transposicion: number;
  curvaVelocidad: CurvaVelocidad;
  /** Escala de velocidad (0..4; 1 = sin cambio). No aplica a `fija`. */
  escalaVelocidad: number;
  /** Velocidad para la curva `fija` (1..127). */
  velocidadFija: number;
  /** Canal MIDI de entrada 1..16; sin valor = cualquiera. */
  canalEntrada?: number;
  /** Canal MIDI de salida 1..16; sin valor = el de la nota. */
  canalSalida?: number;
  activa: boolean;
  nombre?: string;
}

export interface SeguridadMaster {
  activa: boolean;
  /** Techo true-peak en dBTP (−24..0). */
  techoDb: number;
}

export interface DirectoState {
  zonas: ZonaMidi[];
  seguridad: SeguridadMaster;
  /** Bloqueo del modo Directo: sin atajos destructivos ni edición hasta desactivarlo. */
  bloqueo: boolean;
}

export const SEGURIDAD_MASTER_DEFECTO: SeguridadMaster = { activa: false, techoDb: -0.5 };

export function directoInicial(): DirectoState {
  return { zonas: [], seguridad: { ...SEGURIDAD_MASTER_DEFECTO }, bloqueo: false };
}

const clampEntero = (v: unknown, lo: number, hi: number, defecto: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : defecto;
  return Math.max(lo, Math.min(hi, n));
};

/** Normaliza una zona (clamp de rangos, curva válida, lo ≤ hi). */
export function normalizarZona(entrada: Partial<ZonaMidi> & { id: string; pistaId: string }): ZonaMidi {
  let lo = clampEntero(entrada.lo, 0, 127, 0);
  let hi = clampEntero(entrada.hi, 0, 127, 127);
  if (lo > hi) [lo, hi] = [hi, lo];
  const curva = CURVAS_VELOCIDAD.includes(entrada.curvaVelocidad as CurvaVelocidad)
    ? (entrada.curvaVelocidad as CurvaVelocidad)
    : 'lineal';
  const escala = typeof entrada.escalaVelocidad === 'number' && Number.isFinite(entrada.escalaVelocidad)
    ? Math.max(0, Math.min(4, entrada.escalaVelocidad))
    : 1;
  const canalEntrada = entrada.canalEntrada == null ? undefined : clampEntero(entrada.canalEntrada, 1, 16, 1);
  const canalSalida = entrada.canalSalida == null ? undefined : clampEntero(entrada.canalSalida, 1, 16, 1);
  return {
    id: entrada.id,
    pistaId: entrada.pistaId,
    lo,
    hi,
    transposicion: clampEntero(entrada.transposicion, -60, 60, 0),
    curvaVelocidad: curva,
    escalaVelocidad: escala,
    velocidadFija: clampEntero(entrada.velocidadFija, 1, 127, 100),
    ...(canalEntrada !== undefined ? { canalEntrada } : {}),
    ...(canalSalida !== undefined ? { canalSalida } : {}),
    activa: entrada.activa !== false,
    ...(typeof entrada.nombre === 'string' && entrada.nombre.trim() ? { nombre: entrada.nombre.trim() } : {}),
  };
}

/** Velocidad 1..127 tras la curva de la zona (igual que el host nativo). */
export function velocidadConCurva(velocidad: number, zona: Pick<ZonaMidi, 'curvaVelocidad' | 'escalaVelocidad' | 'velocidadFija'>): number {
  if (zona.curvaVelocidad === 'fija') return Math.max(1, Math.min(127, Math.round(zona.velocidadFija)));
  let v = Math.max(1, Math.min(127, velocidad)) / 127;
  if (zona.curvaVelocidad === 'suave') v = Math.sqrt(v);
  else if (zona.curvaVelocidad === 'dura') v = v * v;
  v *= zona.escalaVelocidad;
  return Math.max(1, Math.min(127, Math.round(v * 127)));
}

export interface NotaZona {
  pitch: number;
  velocidad: number;
  /** Canal de salida 1..16 (el de entrada si la zona no lo fija). */
  canal: number;
}

/**
 * Aplica una zona a una nota de entrada. `null` si la nota no entra en la zona (fuera de rango, canal de
 * entrada distinto o zona inactiva). La transposición se recorta a 0..127.
 */
export function aplicarZonaANota(zona: ZonaMidi, pitch: number, velocidad: number, canal = 1): NotaZona | null {
  if (!zona.activa) return null;
  if (pitch < zona.lo || pitch > zona.hi) return null;
  if (zona.canalEntrada != null && canal !== zona.canalEntrada) return null;
  return {
    pitch: Math.max(0, Math.min(127, pitch + zona.transposicion)),
    velocidad: velocidadConCurva(velocidad, zona),
    canal: zona.canalSalida ?? canal,
  };
}

/** Zonas activas de una pista, en orden. */
export function zonasDePista(zonas: readonly ZonaMidi[] | undefined, pistaId: string): ZonaMidi[] {
  return (zonas ?? []).filter((z) => z.pistaId === pistaId && z.activa);
}

/**
 * Notas que salen hacia la pista para una nota de entrada: una por zona activa que la acepte. Sin zonas,
 * la nota pasa tal cual (teclado completo). Varias zonas que caen en el mismo tono y canal se funden.
 */
export function notasDeSalidaParaPista(
  zonas: readonly ZonaMidi[] | undefined,
  pistaId: string,
  pitch: number,
  velocidad: number,
  canal = 1,
): NotaZona[] {
  const propias = zonasDePista(zonas, pistaId);
  if (propias.length === 0) return [{ pitch, velocidad, canal }];
  const out: NotaZona[] = [];
  for (const z of propias) {
    const n = aplicarZonaANota(z, pitch, velocidad, canal);
    if (!n) continue;
    if (out.some((o) => o.pitch === n.pitch && o.canal === n.canal)) continue;
    out.push(n);
  }
  return out;
}
