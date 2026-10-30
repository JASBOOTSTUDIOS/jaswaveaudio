/** Utilidades compartidas por los generadores de partes. */

import type { ArticulacionWorship } from './tipos';
import { clamp } from './prng';
import type { Ctx, EventoAcorde, SeccionInt } from './estructura';

export interface NotaBruta {
  pitch: number;
  inicio: number;
  duracion: number;
  velocidad: number;
  /** Notas con el mismo grupo (e inicio) forman un acorde sujeto a strum. */
  grupo?: number;
  articulacion?: ArticulacionWorship;
  bend?: number;
  /** No aplicar jitter de duración (batería). */
  fija?: boolean;
}

export class Acum {
  notas: NotaBruta[] = [];
  private g = 0;
  nuevoGrupo(): number {
    return this.g++;
  }
  add(pitch: number, inicio: number, duracion: number, velocidad: number, extra: Partial<NotaBruta> = {}): void {
    if (!Number.isFinite(pitch) || !Number.isFinite(inicio) || !Number.isFinite(duracion)) return;
    this.notas.push({ pitch, inicio, duracion, velocidad, ...extra });
  }
}

export function vel(v: number): number {
  return Math.round(clamp(v, 1, 127));
}

export interface Segmento {
  ev: EventoAcorde;
  ini: number;
  fin: number;
}

/** Segmentos de acorde que cubren el compás global `compas`, recortados a sus límites. */
export function segmentosDeCompas(ctx: Ctx, compas: number): Segmento[] {
  const t0 = compas * ctx.bpc;
  const t1 = t0 + ctx.bpc;
  const res: Segmento[] = [];
  const primero = ctx.eventoEn(t0);
  for (let i = primero.idx; i < ctx.eventos.length; i++) {
    const e = ctx.eventos[i]!;
    if (e.inicio >= t1 - 1e-9) break;
    if (e.fin <= t0 + 1e-9) continue;
    res.push({ ev: e, ini: Math.max(e.inicio, t0), fin: Math.min(e.fin, t1) });
  }
  return res;
}

/** Itera los compases en que el rol está activo en una sección. */
export function* compasesActivos(ctx: Ctx, sec: SeccionInt, rol: Parameters<Ctx['activo']>[1]): Generator<{ b: number; g: number; t0: number; nivel: number }> {
  for (let b = 0; b < sec.compases; b++) {
    if (!ctx.activo(sec, rol, b)) continue;
    const g = sec.inicioCompas + b;
    yield { b, g, t0: g * ctx.bpc, nivel: sec.intensidadPorCompas[b]! };
  }
}

/** Evita que un índice de patrón repita el anterior. */
export function elegirDistinto(rng: { int(a: number, b: number): number }, n: number, previo: number): number {
  if (n <= 1) return 0;
  let i = rng.int(0, n - 1);
  if (i === previo) i = (i + 1 + rng.int(0, n - 2)) % n;
  return i;
}
