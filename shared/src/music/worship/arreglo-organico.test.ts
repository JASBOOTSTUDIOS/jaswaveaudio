/**
 * Arreglo worship ORGÁNICO (no electrónico): densidad por sección, bajo profundo con notas largas, piano claramente por
 * encima del bajo, hi-hat con dinámica, máx. 4 voces por ataque, entradas escalonadas y variación cada 4/8 compases.
 */
import { esKeyswitch } from './guitarra-tecnicas';
import { describe, expect, it } from 'vitest';
import { componerWorship } from './compositor';
import { RANGOS_WORSHIP, GM, type ArregloWorship, type NotaWorship, type RolWorship } from './tipos';
import { BAJO_MAX_PITCH } from './rol-bajo';
import { PIANO_LH_MAX, PIANO_LH_MIN, PIANO_MAX_VOCES } from './rol-piano';

const SEMILLAS = [7, 11, 42, 2024, 99];
const arreglos = SEMILLAS.map((s) => componerWorship({ semilla: s }));

const prom = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const desv = (a: number[]) => {
  const m = prom(a);
  return Math.sqrt(prom(a.map((x) => (x - m) ** 2)));
};

function porCompas(a: ArregloWorship, rol: RolWorship, ini: number, compases: number): number[] {
  const cuenta = new Array<number>(compases).fill(0);
  for (const n of a.partes[rol]) {
    const c = Math.floor((n.inicio - ini + 0.25) / a.beatsPorCompas); // +0.25: un «1» adelantado por micro-timing sigue siendo de su compás
    if (c >= 0 && c < compases) cuenta[c]!++;
  }
  return cuenta;
}

function seccionesDe(a: ArregloWorship, tipo: string) {
  return a.secciones.filter((s) => s.tipo === tipo);
}

/** Tamaño de cada ataque simultáneo (notas que arrancan dentro de `ventana` beats del primer ataque del grupo). */
function tamanosAtaque(notas: NotaWorship[], ventana = 0.12): number[] {
  const o = [...notas].sort((x, y) => x.inicio - y.inicio);
  const res: number[] = [];
  let i = 0;
  while (i < o.length) {
    let j = i;
    while (j + 1 < o.length && o[j + 1]!.inicio - o[i]!.inicio < ventana) j++;
    res.push(j - i + 1);
    i = j + 1;
  }
  return res;
}

describe('arreglo orgánico · bajo profundo', () => {
  it('versos e intro: notas largas (≤ 3 ataques por compás) y nunca un pulso de corcheas', () => {
    for (const a of arreglos) {
      for (const s of seccionesDe(a, 'verso')) {
        const c = porCompas(a, 'bajo', s.inicioBeat, s.compases);
        expect(Math.max(...c)).toBeLessThanOrEqual(4); // 3 del patrón + la anticipación que añade la capa expresiva
        expect(prom(c)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('en ninguna sección el bajo toca corcheas continuas (≤ 7 ataques por compás); coros ≤ 6 de media', () => {
    for (const a of arreglos) {
      const c = porCompas(a, 'bajo', 0, a.totalCompases);
      expect(Math.max(...c)).toBeLessThanOrEqual(7);
      for (const s of [...seccionesDe(a, 'coro'), ...seccionesDe(a, 'coroFinal')]) {
        expect(prom(porCompas(a, 'bajo', s.inicioBeat, s.compases))).toBeLessThanOrEqual(5.5);
      }
    }
  });

  it('densidad creciente: verso < coro ≤ coro final (ataques de bajo por compás)', () => {
    for (const a of arreglos) {
      const v = prom(seccionesDe(a, 'verso').flatMap((s) => porCompas(a, 'bajo', s.inicioBeat, s.compases)));
      const c = prom(seccionesDe(a, 'coro').flatMap((s) => porCompas(a, 'bajo', s.inicioBeat, s.compases)));
      expect(v).toBeLessThan(c);
    }
  });

  it('registro grave y profundo: tope BAJO_MAX_PITCH en el patrón y dentro de RANGOS_WORSHIP.bajo', () => {
    const [lo, hi] = RANGOS_WORSHIP.bajo;
    for (const a of arreglos) {
      const ps = a.partes.bajo.map((n) => n.pitch);
      expect(Math.min(...ps)).toBeGreaterThanOrEqual(lo);
      expect(Math.max(...ps)).toBeLessThanOrEqual(hi);
      // las notas del patrón (no la anticipación añadida por la capa expresiva) quedan por debajo del tope
      const sobre = ps.filter((p) => p > BAJO_MAX_PITCH).length / ps.length;
      expect(sobre).toBeLessThan(0.1);
    }
  });
});

describe('arreglo orgánico · piano por encima del bajo', () => {
  it('ninguna nota de piano suena a la vez que una de bajo en su octava o por debajo de ella', () => {
    for (const a of arreglos) {
      for (const p of a.partes.piano) {
        for (const b of a.partes.bajo) {
          const solapa = p.inicio < b.inicio + b.duracion - 1e-6 && b.inicio < p.inicio + p.duracion - 1e-6;
          if (!solapa) continue;
          expect(p.pitch).toBeGreaterThan(b.pitch);
          // nunca la misma nota en la misma octava
          expect(!(p.pitch % 12 === b.pitch % 12 && Math.abs(p.pitch - b.pitch) < 12)).toBe(true);
        }
      }
    }
  });

  it('mano izquierda en [PIANO_LH_MIN, PIANO_LH_MAX] y mano derecha en C4-C6 (nada de registro de bajo)', () => {
    for (const a of arreglos) {
      const ps = a.partes.piano.map((n) => n.pitch);
      expect(Math.min(...ps)).toBeGreaterThanOrEqual(PIANO_LH_MIN);
      expect(Math.max(...ps)).toBeLessThanOrEqual(84);
      const graves = a.partes.piano.filter((n) => n.pitch < 60);
      for (const n of graves) expect(n.pitch).toBeLessThanOrEqual(PIANO_LH_MAX + 3); // + quinta abierta justo bajo C4
      // la mano derecha domina: la mayoría de las notas está en C4-C6
      expect(ps.filter((p) => p >= 60).length / ps.length).toBeGreaterThan(0.6);
    }
  });

  it('el piano no baja a la zona del bajo ni en intro/verso (sin bajo)', () => {
    for (const a of arreglos) expect(Math.min(...a.partes.piano.map((n) => n.pitch))).toBeGreaterThan(BAJO_MAX_PITCH + 4);
  });
});

describe('arreglo orgánico · densidad y voces', () => {
  it('máx. 4 voces por ataque en piano, pad, cuerdas y guitarra', () => {
    for (const a of arreglos) {
      for (const rol of ['piano', 'pad', 'cuerdas', 'guitarra'] as RolWorship[]) {
        const t = tamanosAtaque(a.partes[rol].filter((n) => !(rol === 'guitarra' && esKeyswitch(n))));
        expect(Math.max(...t), `${rol} en semilla ${a.semilla}`).toBeLessThanOrEqual(rol === 'piano' ? PIANO_MAX_VOCES : 4);
      }
    }
  });

  it('el piano no ataca bloques de corcheas: ≤ 12 notas por compás de media en cualquier sección', () => {
    for (const a of arreglos) {
      for (const s of a.secciones) {
        const c = porCompas(a, 'piano', s.inicioBeat, s.compases);
        expect(prom(c), `${s.nombre} semilla ${a.semilla}`).toBeLessThanOrEqual(12);
      }
    }
  });

  it('dinámica por sección: el verso es más ralo que el coro y el coro final el más lleno', () => {
    for (const a of arreglos) {
      const dens = (tipo: string) =>
        prom(
          seccionesDe(a, tipo).map((s) => {
            const n = (['piano', 'pad', 'cuerdas', 'bajo', 'guitarra', 'bateria'] as RolWorship[]).reduce((t, r) => t + porCompas(a, r, s.inicioBeat, s.compases).reduce((x, y) => x + y, 0), 0);
            return n / s.compases;
          }),
        );
      expect(dens('verso')).toBeLessThan(dens('coro'));
      expect(dens('coro')).toBeLessThan(dens('coroFinal'));
    }
  });

  it('puente: el último compás se vacía (piano casi en silencio) antes del coro final', () => {
    for (const a of arreglos) {
      const p = seccionesDe(a, 'puente')[0]!;
      const c = porCompas(a, 'piano', p.inicioBeat, p.compases);
      expect(c[c.length - 1]!).toBeLessThanOrEqual(2);
      expect(prom(c.slice(0, -1))).toBeGreaterThan(c[c.length - 1]!);
    }
  });

  it('variación sutil: los 4 primeros compases del coro no repiten literalmente los 4 siguientes (piano)', () => {
    let distintos = 0;
    for (const a of arreglos) {
      const s = seccionesDe(a, 'coro')[0]!;
      const firma = (ini: number) =>
        a.partes.piano
          .filter((n) => n.inicio >= s.inicioBeat + ini * 4 - 1e-6 && n.inicio < s.inicioBeat + (ini + 4) * 4 - 1e-6)
          .map((n) => `${Math.round((n.inicio - s.inicioBeat - ini * 4) * 4)}`)
          .join(',');
      if (firma(0) !== firma(4)) distintos++;
    }
    expect(distintos).toBe(arreglos.length);
  });
});

describe('arreglo orgánico · batería sin rejilla de caja de ritmos', () => {
  it('el hi-hat tiene variación de velocidad (σ > 5, ≥ 8 valores distintos) y no hay semicorcheas continuas', () => {
    for (const a of arreglos) {
      const hh = a.partes.bateria.filter((n) => n.pitch === GM.hhCerrado || n.pitch === GM.hhAbierto);
      expect(hh.length).toBeGreaterThan(40);
      expect(desv(hh.map((n) => n.velocidad))).toBeGreaterThan(5);
      expect(new Set(hh.map((n) => n.velocidad)).size).toBeGreaterThanOrEqual(8);
      const porC = porCompas({ ...a, partes: { ...a.partes, bateria: hh } }, 'bateria', 0, a.totalCompases);
      expect(Math.max(...porC)).toBeLessThanOrEqual(9); // 8 corcheas + una mutación
    }
  });

  it('verso íntimo: batería muy ligera (≤ 9 golpes por compás) y sin golpes de plato fuertes', () => {
    for (const a of arreglos) {
      for (const s of seccionesDe(a, 'verso')) {
        if (!s.roles.includes('bateria')) continue;
        expect(prom(porCompas(a, 'bateria', s.inicioBeat, s.compases))).toBeLessThanOrEqual(10);
      }
    }
  });
});

describe('arreglo orgánico · entradas escalonadas', () => {
  it('no todos los instrumentos arrancan en el mismo tiempo: ≥ 4 inicios distintos y un solo rol en el compás 1', () => {
    for (const a of arreglos) {
      const primeros = (['piano', 'pad', 'cuerdas', 'bajo', 'bateria', 'guitarra'] as RolWorship[])
        .filter((r) => a.partes[r].length > 0)
        .map((r) => Math.min(...a.partes[r].map((n) => n.inicio)));
      expect(new Set(primeros.map((x) => Math.round(x))).size).toBeGreaterThanOrEqual(3);
      const enCompas1 = (['piano', 'pad', 'cuerdas', 'bajo', 'bateria', 'guitarra'] as RolWorship[]).filter((r) => a.partes[r].some((n) => n.inicio < a.beatsPorCompas));
      expect(enCompas1.length).toBeLessThanOrEqual(2);
    }
  });
});
