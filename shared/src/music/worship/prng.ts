/**
 * PRNG determinista para el motor de worship (mulberry32).
 * Prohibido usar Math.random / Date.now en este directorio.
 */

export interface Rng {
  /** Float en [0, 1). */
  next(): number;
  /** Entero en [a, b] (ambos incluidos). */
  int(a: number, b: number): number;
  /** Probabilidad p de devolver true. */
  prob(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  /** Gaussiana N(0,1) acotada a ±limite (por defecto 2.2). */
  gauss(limite?: number): number;
  /** Float en [a, b). */
  rango(a: number, b: number): number;
  barajar<T>(arr: readonly T[]): T[];
}

export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits de (semilla, clave) para derivar flujos independientes por rol. */
export function hashSemilla(semilla: number, clave: string): number {
  let h = 0x811c9dc5 ^ (semilla >>> 0);
  for (let i = 0; i < clave.length; i++) {
    h ^= clave.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export function crearRng(semilla: number): Rng {
  const f = mulberry32(semilla);
  const rng: Rng = {
    next: f,
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    prob: (p) => f() < p,
    pick: (arr) => arr[Math.floor(f() * arr.length)]!,
    gauss: (limite = 2.2) => {
      const u = Math.max(1e-12, f());
      const v = f();
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      return Math.max(-limite, Math.min(limite, z));
    },
    rango: (a, b) => a + f() * (b - a),
    barajar: (arr) => {
      const r = [...arr];
      for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(f() * (i + 1));
        [r[i], r[j]] = [r[j]!, r[i]!];
      }
      return r;
    },
  };
  return rng;
}

export function clamp(x: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
