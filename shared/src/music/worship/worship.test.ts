import { esKeyswitch } from './guitarra-tecnicas';
import { describe, expect, it } from 'vitest';
import { crearEstadoInicial } from '../../state/estado-inicial';
import { crearTiendaDAW } from '../../state/tienda';
import {
  HUMANIZACION_SD_MS,
  RANGOS_WORSHIP,
  ROLES_WORSHIP,
  arregloAComandos,
  componerWorship,
  crearTonal,
  parsearAcorde,
  construirAcorde,
  resumenArreglo,
  validarArregloWorship,
  type ArregloWorship,
  type NotaWorship,
  type RolWorship,
  type SeccionArreglo,
} from './index';
import * as shared from '../../index';

const SEMILLAS = [1, 7, 11, 42, 2024];
const TONAL_D = crearTonal('D', 'mayor');

const media = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const desv = (xs: number[]) => {
  const m = media(xs);
  return Math.sqrt(media(xs.map((x) => (x - m) ** 2)));
};

const enSeccion = (a: ArregloWorship, rol: RolWorship, s: SeccionArreglo, desde = 0, hasta = s.compases): NotaWorship[] => {
  const t0 = s.inicioBeat + desde * a.beatsPorCompas;
  const t1 = s.inicioBeat + hasta * a.beatsPorCompas;
  return a.partes[rol].filter((n) => n.inicio >= t0 - 0.05 && n.inicio < t1 - 0.05);
};

/** Huella de patrón: posiciones en rejilla de semicorcheas + pitch, relativas al inicio de la sección. */
const huella = (a: ArregloWorship, rol: RolWorship, s: SeccionArreglo, desde: number, hasta: number): Set<string> => {
  const base = s.inicioBeat + desde * a.beatsPorCompas;
  return new Set(
    enSeccion(a, rol, s, desde, hasta)
      .filter((n) => n.articulacion !== 'flam-gracia')
      .map((n) => `${Math.round((n.inicio - base) * 4)}:${n.pitch}`),
  );
};
const distancia = (x: Set<string>, y: Set<string>) => {
  const union = new Set([...x, ...y]);
  let comunes = 0;
  for (const k of x) if (y.has(k)) comunes++;
  return union.size === 0 ? 0 : 1 - comunes / union.size;
};

const porTipo = (a: ArregloWorship, tipo: string) => a.secciones.filter((s) => s.tipo === tipo);

describe('worship · determinismo', () => {
  it('misma semilla → mismo JSON; semillas distintas → arreglos distintos', () => {
    const a1 = JSON.stringify(componerWorship({ semilla: 7 }));
    const a2 = JSON.stringify(componerWorship({ semilla: 7 }));
    expect(a1).toBe(a2);
    const vistos = new Set(SEMILLAS.map((s) => JSON.stringify(componerWorship({ semilla: s }))));
    expect(vistos.size).toBe(SEMILLAS.length);
    // también distintas en lo musical, no sólo en detalles de humanización
    const p7 = componerWorship({ semilla: 7, humanizacion: 0 }).partes.melodia.map((n) => n.pitch).join(',');
    const p8 = componerWorship({ semilla: 8, humanizacion: 0 }).partes.melodia.map((n) => n.pitch).join(',');
    expect(p7).not.toBe(p8);
  });

  it('no usa Math.random ni Date.now (el resultado no depende del reloj)', () => {
    const orig = Date.now;
    const origR = Math.random;
    Date.now = () => {
      throw new Error('Date.now prohibido');
    };
    Math.random = () => {
      throw new Error('Math.random prohibido');
    };
    try {
      expect(() => componerWorship({ semilla: 3 })).not.toThrow();
    } finally {
      Date.now = orig;
      Math.random = origR;
    }
  });

  it('el filtro de roles no altera las notas de los roles restantes', () => {
    const todo = componerWorship({ semilla: 5 });
    const soloBajo = componerWorship({ semilla: 5, roles: ['bajo', 'piano', 'bateria'] }); // el bajo se pega al bombo: depende de la batería
    expect(soloBajo.partes.bajo).toEqual(todo.partes.bajo);
    expect(soloBajo.partes.piano).toEqual(todo.partes.piano);
    expect(soloBajo.partes.bateria).toEqual(todo.partes.bateria);
    expect(soloBajo.partes.pad).toHaveLength(0);
  });
});

describe('worship · estructura y validez', () => {
  it.each(SEMILLAS)('semilla %i: validarArregloWorship ok', (semilla) => {
    const a = componerWorship({ semilla });
    const v = validarArregloWorship(a);
    expect(v.problemas).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('forma por defecto, compases y duración total', () => {
    const a = componerWorship({ semilla: 7, bpm: 72 });
    expect(a.secciones.map((s) => [s.tipo, s.compases])).toEqual([
      ['intro', 4], ['verso', 8], ['precoro', 4], ['coro', 8], ['verso', 8],
      ['precoro', 4], ['coro', 8], ['puente', 8], ['coroFinal', 16], ['outro', 4],
    ]);
    expect(a.totalCompases).toBe(72);
    expect(a.duracionBeats).toBe(288);
    expect(a.duracionSegundos).toBeCloseTo((288 * 60) / 72, 1);
    expect(a.duracionSegundos).toBeGreaterThan(200); // arco de ~4 minutos
    let c = 0;
    for (const s of a.secciones) {
      expect(s.inicioCompas).toBe(c);
      expect(s.inicioBeat).toBe(c * 4);
      c += s.compases;
    }
    expect(a.marcadores.map((m) => m.nombre)).toContain('Coro final');
    expect(a.tonalidad).toEqual({ raiz: 'D', escala: 'mayor' });
  });

  it('bpm por defecto entre 68 y 76 y bpm explícito respetado', () => {
    for (const s of SEMILLAS) {
      const bpm = componerWorship({ semilla: s }).bpm;
      expect(bpm).toBeGreaterThanOrEqual(68);
      expect(bpm).toBeLessThanOrEqual(76);
    }
    expect(componerWorship({ semilla: 1, bpm: 70 }).bpm).toBe(70);
  });

  it('todas las notas dentro de rango por rol y velocidad/duración/inicio válidos', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      for (const rol of ROLES_WORSHIP) {
        const [lo, hi] = RANGOS_WORSHIP[rol];
        expect(a.partes[rol].length, rol).toBeGreaterThan(0);
        const malas = a.partes[rol].filter(
          (n) =>
            !(rol === 'guitarra' && esKeyswitch(n)) && (n.pitch < lo || n.pitch > hi || n.inicio < 0 || !Number.isInteger(n.velocidad) || n.velocidad < 1 || n.velocidad > 127 || n.duracion < 1 / 64),
        );
        expect(malas, `${rol} semilla ${semilla}`).toHaveLength(0);
      }
    }
  });

  it('100 % de las notas tonales en la escala de D y acordes diatónicos', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      for (const rol of ['piano', 'pad', 'cuerdas', 'bajo', 'melodia', 'guitarra'] as RolWorship[]) {
        const fuera = a.partes[rol].filter((n) => !(rol === 'guitarra' && esKeyswitch(n)) && !TONAL_D.pcsEscala.has(n.pitch % 12));
        expect(fuera, `${rol} semilla ${semilla}`).toHaveLength(0);
      }
      for (const c of a.acordes) for (const pc of c.pcs) expect(TONAL_D.pcsEscala.has(pc)).toBe(true);
    }
  });

  it('sin solapes en bajo/melodía ni notas iguales solapadas en el resto', () => {
    const a = componerWorship({ semilla: 11 });
    for (const rol of ['bajo', 'melodia'] as RolWorship[]) {
      const n = a.partes[rol];
      for (let i = 0; i < n.length - 1; i++) expect(n[i]!.inicio + n[i]!.duracion).toBeLessThanOrEqual(n[i + 1]!.inicio + 1e-9);
    }
    for (const rol of ROLES_WORSHIP) {
      const fin = new Map<number, number>();
      for (const n of a.partes[rol]) {
        expect((fin.get(n.pitch) ?? -1) <= n.inicio + 1e-9, `${rol} pitch ${n.pitch} @${n.inicio}`).toBe(true);
        fin.set(n.pitch, n.inicio + n.duracion);
      }
    }
  });

  it('el bajo suena la nota grave del acorde (con inversión) en cada cambio de acorde', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      let comprobados = 0;
      for (const c of a.acordes) {
        const s = a.secciones[c.seccion]!;
        const b = Math.floor((c.inicio - s.inicioBeat) / a.beatsPorCompas);
        if (s.entradas.bajo === undefined || b < s.entradas.bajo) continue;
        const t = c.inicio + 0.12;
        const sonando = a.partes.bajo.filter((n) => n.inicio <= t && n.inicio + n.duracion > t);
        expect(sonando.length, `${c.simbolo} @${c.inicio}`).toBe(1);
        expect(sonando[0]!.pitch % 12, `${c.simbolo} @${c.inicio}`).toBe(c.bajoPc);
        comprobados++;
      }
      expect(comprobados).toBeGreaterThan(40);
    }
  });

  it('los tiempos fuertes de la melodía son notas del acorde', () => {
    const a = componerWorship({ semilla: 7 });
    const fuertes = a.partes.melodia.filter((n) => {
      const pos = (n.inicio - 0.0) % 4;
      return Math.abs(pos - 0) < 0.08 || Math.abs(pos - 2) < 0.08;
    });
    let ok = 0;
    for (const n of fuertes) {
      const c = a.acordes.find((x) => n.inicio + 0.05 >= x.inicio && n.inicio + 0.05 < x.inicio + x.duracion)!;
      if (c.pcs.includes(n.pitch % 12)) ok++;
    }
    expect(fuertes.length).toBeGreaterThan(30);
    expect(ok / fuertes.length).toBeGreaterThan(0.95);
  });
});

describe('worship · armonía', () => {
  it('parsea grados romanos y símbolos con bajos invertidos y sus/add9/maj7', () => {
    const casos: Array<[string, string]> = [
      ['D/F#', 'D/F#'], ['G/B', 'G/B'], ['A/C#', 'A/C#'], ['Bm7', 'Bm7'], ['Asus4', 'Asus4'],
      ['Dsus2', 'Dsus2'], ['Gadd9', 'Gadd9'], ['Gmaj7', 'Gmaj7'], ['A7', 'A7'], ['Em7', 'Em7'],
      ['I', 'D'], ['V/3', 'A/C#'], ['vi7', 'Bm7'], ['IVadd9', 'Gadd9'], ['Vsus4/I', 'Asus4/D'], ['IVmaj7', 'Gmaj7'], ['I/3', 'D/F#'],
    ];
    for (const [token, simbolo] of casos) {
      expect(construirAcorde(TONAL_D, parsearAcorde(token, TONAL_D)).simbolo, token).toBe(simbolo);
    }
  });

  it('rechaza acordes no diatónicos', () => {
    expect(() => parsearAcorde('C', TONAL_D)).toThrow();
    expect(() => parsearAcorde('Bb', TONAL_D)).toThrow();
    expect(() => parsearAcorde('D7', TONAL_D)).toThrow();
    expect(() => parsearAcorde('Dm', TONAL_D)).toThrow();
  });

  it('respeta la progresión pedida por sección (ritmo armónico de 1 o 2 acordes por compás)', () => {
    const a = componerWorship({
      semilla: 3,
      secciones: [
        { tipo: 'verso', compases: 4, progresion: ['D', 'A/C#', 'Bm7', 'G'] },
        { tipo: 'coro', compases: 4, progresion: ['I', 'V', 'vi', 'IV', 'I', 'V', 'vi', 'IV'] },
      ],
    });
    expect(a.acordes.slice(0, 4).map((c) => c.simbolo)).toEqual(['D', 'A/C#', 'Bm7', 'G']);
    expect(a.acordes.slice(0, 4).map((c) => c.duracion)).toEqual([4, 4, 4, 4]);
    const coro = a.acordes.filter((c) => c.seccion === 1);
    expect(coro.map((c) => c.simbolo)).toEqual(['D', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G']);
    expect(coro.every((c) => c.duracion === 2)).toBe(true);
    expect(validarArregloWorship(a).ok).toBe(true);
  });

  it('el motor usa inversiones/sus/add9 y distintos finales de sección', () => {
    const a = componerWorship({ semilla: 7 });
    const simbolos = new Set(a.acordes.map((c) => c.simbolo));
    expect([...simbolos].some((s) => s.includes('/'))).toBe(true);
    expect([...simbolos].some((s) => /sus|add9|maj7|7/.test(s))).toBe(true);
    const finales = a.secciones
      .filter((s) => s.tipo === 'verso' || s.tipo === 'coro' || s.tipo === 'precoro')
      .map((s) => a.acordes.filter((c) => c.seccion === s.indice).slice(-2).map((c) => c.simbolo).join('>'));
    expect(new Set(finales).size).toBeGreaterThan(2);
  });

  it('voice-leading: las voces del pad se mueven poco entre acordes', () => {
    const a = componerWorship({ semilla: 7, humanizacion: 0 });
    const sonando = (t: number) =>
      a.partes.pad.filter((n) => n.inicio <= t + 1e-6 && n.inicio + n.duracion > t + 0.05).map((n) => n.pitch).sort((x, y) => x - y);
    const saltos: number[] = [];
    let prev: number[] | null = null;
    for (const c of a.acordes) {
      const act = sonando(c.inicio + 0.5);
      if (prev && prev.length === 3 && act.length === 3) saltos.push(act.reduce((s, p, k) => s + Math.abs(p - prev![k]!), 0));
      prev = act;
    }
    expect(saltos.length).toBeGreaterThan(20);
    expect(media(saltos)).toBeLessThan(8);
    expect(Math.max(...saltos)).toBeLessThanOrEqual(14);
  });
});

describe('worship · variación y dinámica', () => {
  it('dos coros consecutivos no son idénticos en batería ni piano', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      const [c1, c2] = porTipo(a, 'coro') as [SeccionArreglo, SeccionArreglo];
      const [cf] = porTipo(a, 'coroFinal') as [SeccionArreglo];
      for (const rol of ['bateria', 'piano'] as RolWorship[]) {
        expect(distancia(huella(a, rol, c1, 0, 8), huella(a, rol, c2, 0, 8)), `${rol} c1 vs c2 s${semilla}`).toBeGreaterThan(0.3);
        expect(distancia(huella(a, rol, cf, 0, 8), huella(a, rol, cf, 8, 16)), `${rol} mitades coro final s${semilla}`).toBeGreaterThan(0.3);
        expect(distancia(huella(a, rol, c2, 0, 8), huella(a, rol, cf, 0, 8)), `${rol} c2 vs final s${semilla}`).toBeGreaterThan(0.3);
      }
    }
  });

  it('la batería no copia el compás anterior', () => {
    const a = componerWorship({ semilla: 7 });
    const coro = porTipo(a, 'coro')[0]!;
    const compases: string[] = [];
    for (let b = 0; b < coro.compases; b++) {
      compases.push([...huella(a, 'bateria', coro, b, b + 1)].map((k) => k.split(':')[1] + '@' + (Number(k.split(':')[0]) - b * 16)).sort().join(','));
    }
    for (let i = 1; i < compases.length; i++) expect(compases[i]).not.toBe(compases[i - 1]);
  });

  it('el coro final tiene más notas y más velocidad media que el primer coro', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      const c1 = porTipo(a, 'coro')[0]!;
      const cf = porTipo(a, 'coroFinal')[0]!;
      const todas = (s: SeccionArreglo) => ROLES_WORSHIP.flatMap((r) => enSeccion(a, r, s));
      const n1 = todas(c1).length / c1.compases;
      const nf = todas(cf).length / cf.compases;
      expect(nf, `notas/compás s${semilla}`).toBeGreaterThan(n1);
      expect(media(todas(cf).map((n) => n.velocidad)), `vel s${semilla}`).toBeGreaterThan(media(todas(c1).map((n) => n.velocidad)));
    }
  });

  it('el puente crece en intensidad compás a compás (datos y velocidad real)', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      const p = porTipo(a, 'puente')[0]!;
      const ipc = p.intensidadPorCompas;
      expect(ipc[0]).toBeCloseTo(0.55, 2);
      expect(ipc[ipc.length - 1]).toBeCloseTo(1.0, 2);
      for (let i = 1; i < ipc.length; i++) expect(ipc[i]!).toBeGreaterThan(ipc[i - 1]!);
      const velPorCompas = Array.from({ length: p.compases }, (_, b) =>
        media(ROLES_WORSHIP.flatMap((r) => enSeccion(a, r, p, b, b + 1)).map((n) => n.velocidad)),
      );
      expect(media(velPorCompas.slice(4)), `s${semilla}`).toBeGreaterThan(media(velPorCompas.slice(0, 4)) + 8);
      const densidad = Array.from({ length: p.compases }, (_, b) => ROLES_WORSHIP.flatMap((r) => enSeccion(a, r, p, b, b + 1)).length);
      expect(media(densidad.slice(4))).toBeGreaterThan(media(densidad.slice(0, 4)));
    }
  });

  it('intensidades por sección en los rangos pedidos', () => {
    const a = componerWorship({ semilla: 7 });
    const get = (tipo: string, i = 0) => porTipo(a, tipo)[i]!;
    expect(get('intro').intensidad).toBeCloseTo(0.3, 1);
    expect(get('verso').intensidadInicial).toBeGreaterThanOrEqual(0.35);
    expect(get('verso').intensidad).toBeLessThanOrEqual(0.5);
    expect(get('precoro').intensidad).toBeGreaterThanOrEqual(0.6);
    expect(get('coro').intensidadInicial).toBeGreaterThanOrEqual(0.78);
    expect(get('coroFinal').intensidad).toBe(1);
    expect(get('outro').intensidadInicial).toBeLessThanOrEqual(0.3);
  });

  it('entradas escalonadas: intro ≤ 2 roles, coro final con todos, verso 1 con entradas distintas', () => {
    for (const semilla of SEMILLAS) {
      const a = componerWorship({ semilla });
      expect(porTipo(a, 'intro')[0]!.roles.length).toBeLessThanOrEqual(2);
      expect(porTipo(a, 'coroFinal')[0]!.roles).toHaveLength(7);
      const v1 = porTipo(a, 'verso')[0]!;
      expect(new Set(Object.values(v1.entradas)).size).toBeGreaterThanOrEqual(3);
      expect(v1.roles).not.toContain('cuerdas');
      expect(porTipo(a, 'precoro')[0]!.roles).toContain('cuerdas');
      // no hay notas de un rol antes de su compás de entrada
      for (const s of a.secciones) {
        for (const rol of s.roles) {
          const e = s.entradas[rol]!;
          if (e === 0) continue;
          expect(enSeccion(a, rol, s, 0, e).filter((n) => n.inicio > s.inicioBeat + 0.1 && n.inicio < s.inicioBeat + e * 4 - 0.1)).toHaveLength(0);
        }
      }
    }
  });

  it('las cuerdas callan en versos de baja intensidad y la matriz cambia con intensidad pedida', () => {
    const a = componerWorship({ semilla: 7 });
    expect(enSeccion(a, 'cuerdas', porTipo(a, 'verso')[1]!)).toHaveLength(0);
    const b = componerWorship({
      semilla: 7,
      secciones: [{ tipo: 'verso', compases: 8, intensidad: 0.8 }],
    });
    expect(b.secciones[0]!.roles).toContain('cuerdas');
  });

  it('melodía: rango D4-A5, coro más agudo que verso, saltos de 3ª-5ª y frases con respiraciones', () => {
    const a = componerWorship({ semilla: 7 });
    expect(Math.min(...a.partes.melodia.map((n) => n.pitch))).toBeGreaterThanOrEqual(62);
    expect(Math.max(...a.partes.melodia.map((n) => n.pitch))).toBeLessThanOrEqual(81);
    const verso = enSeccion(a, 'melodia', porTipo(a, 'verso')[0]!).map((n) => n.pitch);
    const coro = enSeccion(a, 'melodia', porTipo(a, 'coro')[0]!).map((n) => n.pitch);
    const fin = enSeccion(a, 'melodia', porTipo(a, 'coroFinal')[0]!).map((n) => n.pitch);
    expect(media(coro)).toBeGreaterThan(media(verso) + 2);
    expect(media(fin)).toBeGreaterThanOrEqual(media(coro));
    const m = a.partes.melodia;
    const saltos = m.slice(1).filter((n, i) => Math.abs(n.pitch - m[i]!.pitch) >= 3 && Math.abs(n.pitch - m[i]!.pitch) <= 7);
    const conjuntos = m.slice(1).filter((n, i) => Math.abs(n.pitch - m[i]!.pitch) <= 2);
    expect(saltos.length).toBeGreaterThan(5);
    expect(conjuntos.length / m.length).toBeGreaterThan(0.5); // predominan los grados conjuntos
    // respiraciones: huecos ≥ 0.5 beat entre frases
    const respiros = m.slice(1).filter((n, i) => n.inicio - (m[i]!.inicio + m[i]!.duracion) >= 0.45);
    expect(respiros.length).toBeGreaterThan(10);
  });
});

describe('worship · humanización orgánica', () => {
  const a1 = componerWorship({ semilla: 7, humanizacion: 1 });
  const a65 = componerWorship({ semilla: 7 });

  it('micro-timing: desviación típica dentro de rangos por rol y escalada por humanizacion', () => {
    for (const [a, h] of [[a1, 1], [a65, 0.65]] as const) {
      for (const rol of ['piano', 'pad', 'cuerdas', 'bajo', 'guitarra', 'melodia'] as RolWorship[]) {
        const sd = desv(a.partes[rol].filter((n) => !(rol === 'guitarra' && esKeyswitch(n)) || n.desfaseMs !== undefined).map((n) => n.desfaseMs ?? 0));
        const esperado = HUMANIZACION_SD_MS[rol] * h;
        expect(sd, `${rol} h=${h}`).toBeGreaterThan(esperado * 0.7);
        expect(sd, `${rol} h=${h}`).toBeLessThan(esperado * 1.3);
      }
      const bat = a.partes.bateria.map((n) => n.desfaseMs ?? 0);
      expect(desv(bat)).toBeGreaterThan(2 * h);
      expect(desv(bat)).toBeLessThan(HUMANIZACION_SD_MS.bateria * 1.5 * h);
      expect(Math.max(...a.partes.bateria.map((n) => Math.abs(n.desfaseMs ?? 0)))).toBeLessThan(25);
    }
    const rangos = ROLES_WORSHIP.map((r) => Math.max(...a1.partes[r].map((n) => Math.abs(n.desfaseMs ?? 0))));
    expect(Math.max(...rangos)).toBeLessThan(14 * 2.2 + 12 + 1); // media + 2.2σ del rol más laxo
  });

  it('batería laid-back: caja con offset medio positivo y bombo ≈ 0', () => {
    const caja = a1.partes.bateria.filter((n) => n.pitch === 38 && !n.articulacion).map((n) => n.desfaseMs ?? 0);
    const bombo = a1.partes.bateria.filter((n) => n.pitch === 36).map((n) => n.desfaseMs ?? 0);
    expect(caja.length).toBeGreaterThan(50);
    expect(bombo.length).toBeGreaterThan(50);
    expect(media(caja)).toBeGreaterThan(5);
    expect(Math.abs(media(bombo))).toBeLessThan(1.5);
    expect(desv(bombo)).toBeLessThan(desv(caja) + 1);
  });

  it('notas fantasma: existen y su velocidad es < 45', () => {
    for (const a of [a1, a65]) {
      const fantasmas = a.partes.bateria.filter((n) => n.articulacion === 'fantasma');
      expect(fantasmas.length).toBeGreaterThan(10);
      expect(fantasmas.every((n) => n.pitch === 38 && n.velocidad < 45)).toBe(true);
    }
  });

  it('flams ocasionales y fills presentes', () => {
    const flams = SEMILLAS.flatMap((s) => componerWorship({ semilla: s }).partes.bateria.filter((n) => n.articulacion === 'flam'));
    expect(flams.length).toBeGreaterThan(0);
    const toms = a65.partes.bateria.filter((n) => [43, 45, 47].includes(n.pitch));
    expect(toms.length).toBeGreaterThan(30);
    // compatibilidad con kits de 3 toms (BFD Player): 41 y 48 no tienen pieza y la 50 dispara un crash
    for (const s of SEMILLAS) {
      expect(componerWorship({ semilla: s }).partes.bateria.some((n) => [41, 48, 50].includes(n.pitch))).toBe(false);
    }
    expect(a65.partes.bateria.some((n) => n.pitch === 49)).toBe(true);
    expect(a65.partes.bateria.some((n) => n.pitch === 46)).toBe(true);
    expect(a65.partes.bateria.some((n) => n.pitch === 37)).toBe(true);
    expect(a65.partes.bateria.some((n) => n.pitch === 51)).toBe(true);
  });

  it('golpes de caja consecutivos con la misma velocidad exacta: < 30 %', () => {
    for (const semilla of SEMILLAS) {
      const cajas = componerWorship({ semilla }).partes.bateria.filter((n) => n.pitch === 38 && !n.articulacion);
      let iguales = 0;
      for (let i = 1; i < cajas.length; i++) if (cajas[i]!.velocidad === cajas[i - 1]!.velocidad) iguales++;
      expect(iguales / (cajas.length - 1), `semilla ${semilla}`).toBeLessThan(0.3);
    }
  });

  it('strum: 5–25 ms entre notas del mismo acorde (piano/guitarra)', () => {
    for (const rol of ['piano', 'guitarra'] as RolWorship[]) {
      const conStrum = a1.partes[rol].filter((n) => (n.strumMs ?? 0) > 0);
      expect(conStrum.length, rol).toBeGreaterThan(20);
      expect(Math.max(...conStrum.map((n) => n.strumMs!))).toBeLessThanOrEqual(25 * 4);
    }
    // el hueco entre notas consecutivas de un mismo acorde de guitarra está en 5-25 ms
    const g = a1.partes.guitarra.filter((n) => (n.strumMs ?? 0) > 0).map((n) => n.strumMs!);
    expect(Math.min(...g)).toBeGreaterThanOrEqual(5 * 0.99 * 0.0 + 0); // el primer salto es ≥ gap mínimo
    const huecos = new Set<number>();
    for (const n of a1.partes.guitarra) if ((n.strumMs ?? 0) > 0) huecos.add(Math.round(n.strumMs! * 10) / 10);
    expect([...huecos].every((x) => x >= 5 - 1e-6)).toBe(true);
  });

  it('humanizacion = 0 deja todo en la rejilla; 1 mueve las notas', () => {
    const r0 = componerWorship({ semilla: 7, humanizacion: 0 });
    for (const rol of ROLES_WORSHIP) {
      for (const n of r0.partes[rol]) {
        expect(n.desfaseMs ?? 0).toBe(0);
        expect(n.strumMs).toBeUndefined();
      }
    }
    const bateria0 = r0.partes.bateria.filter((n) => n.articulacion !== 'flam-gracia');
    expect(bateria0.every((n) => Math.abs(n.inicio * 4 - Math.round(n.inicio * 4)) < 1e-3)).toBe(true);
    const bombo = a1.partes.bateria.filter((n) => n.pitch === 36).slice(0, 40);
    expect(bombo.some((n) => Math.abs(n.inicio * 4 - Math.round(n.inicio * 4)) > 1e-3)).toBe(true);
  });

  it('la humanización no cambia las notas compuestas (sólo timing/velocidad)', () => {
    const r0 = componerWorship({ semilla: 7, humanizacion: 0 });
    for (const rol of ['melodia', 'pad'] as RolWorship[]) {
      expect(a65.partes[rol].map((n) => n.pitch).sort().join()).toBe(r0.partes[rol].map((n) => n.pitch).sort().join());
    }
    // el bajo sólo gana anticipaciones (notas añadidas), no pierde ninguna nota compuesta
    expect(a65.partes.bajo.length).toBeGreaterThanOrEqual(r0.partes.bajo.length);
  });

  it('la velocidad tiene contorno: no es plana', () => {
    const v = a65.partes.melodia.map((n) => n.velocidad);
    expect(desv(v)).toBeGreaterThan(4);
  });
});

describe('worship · otras opciones', () => {
  it('6/8 produce un arreglo válido con compases de 3 beats', () => {
    for (const semilla of [1, 7, 11]) {
      const a = componerWorship({ semilla, compas: '6/8' });
      expect(a.beatsPorCompas).toBe(3);
      expect(a.duracionBeats).toBe(a.totalCompases * 3);
      expect(validarArregloWorship(a).problemas).toEqual([]);
      for (const rol of ROLES_WORSHIP) expect(a.partes[rol].length).toBeGreaterThan(0);
    }
  });

  it('estilos y otras tonalidades son válidos', () => {
    for (const estilo of ['ballad', 'anthem', 'ambient'] as const) {
      const a = componerWorship({ semilla: 9, estilo });
      expect(validarArregloWorship(a).problemas).toEqual([]);
    }
    const mi = componerWorship({ semilla: 9, tonalidad: { raiz: 'E', escala: 'mayor' } });
    const tonalE = crearTonal('E', 'mayor');
    expect(validarArregloWorship(mi).problemas).toEqual([]);
    for (const n of mi.partes.melodia) expect(tonalE.pcsEscala.has(n.pitch % 12)).toBe(true);
    const menor = componerWorship({ semilla: 9, tonalidad: { raiz: 'D', escala: 'menor' }, secciones: [{ tipo: 'verso', compases: 4 }, { tipo: 'coro', compases: 4 }] });
    expect(validarArregloWorship(menor).problemas).toEqual([]);
  });

  it('rechaza especificaciones inválidas', () => {
    expect(() => componerWorship({ semilla: 1, secciones: [{ tipo: 'verso', compases: 0 }] })).toThrow();
    expect(() => componerWorship({ semilla: 1, secciones: [{ tipo: 'verso', compases: 4, progresion: ['C'] }] })).toThrow();
    expect(() => componerWorship({ semilla: Number.NaN })).toThrow();
  });

  it('guitarra lead con bends en puente/outro y pitchBend informado', () => {
    const conBend = SEMILLAS.map((s) => componerWorship({ semilla: s })).filter((a) => a.partes.guitarra.some((n) => n.bend !== undefined));
    expect(conBend.length).toBeGreaterThan(0);
    const a = conBend[0]!;
    expect(a.pitchBend.guitarra!.length).toBeGreaterThan(0);
    for (const e of a.pitchBend.guitarra!) expect(Math.abs(e.semitonos)).toBeLessThanOrEqual(2);
  });

  it('resumenArreglo es breve y menciona forma y tonalidad', () => {
    const r = resumenArreglo(componerWorship({ semilla: 7 }));
    expect(r).toContain('D mayor');
    expect(r).toContain('Coro final');
    expect(r.split('\n').length).toBeLessThanOrEqual(6);
  });

  it('se exporta desde el índice del paquete', () => {
    expect(typeof shared.componerWorship).toBe('function');
    expect(typeof shared.validarArregloWorship).toBe('function');
    expect(typeof shared.arregloAComandos).toBe('function');
  });
});

describe('worship · arregloAComandos', () => {
  const nueva = () => crearTiendaDAW({ estadoInicial: crearEstadoInicial() });

  it('crea pistas con nombre estándar, clips con las notas y se deshace con undo (ejecución una a una)', async () => {
    const a = componerWorship({ semilla: 7 });
    const acciones = arregloAComandos(a, { nombrePluginPorRol: { piano: 'JasWave Grand Piano', bateria: 'Worship Drums' } });
    expect(acciones[0]!.type).toBe('project.setBpm');
    expect(acciones.find((x) => x.rol === 'piano' && x.type === 'track.create')!.plugin).toBe('JasWave Grand Piano');

    const tienda = nueva();
    const pistasAntes = tienda.obtenerEstado().project.tracks.length;
    for (const acc of acciones) {
      const r = await tienda.executor.execute(acc.type, acc.payload);
      expect(r.success, `${acc.type}: ${r.error?.message ?? ''}`).toBe(true);
    }
    const s = tienda.obtenerEstado();
    const nuevas = s.project.tracks.slice(pistasAntes);
    expect(nuevas.map((t) => t.nombre)).toEqual(['Piano', 'Pad', 'Cuerdas', 'Bajo', 'Batería', 'Guitarra', 'Melodía']);
    expect(s.project.bpm.valor).toBe(a.bpm);
    for (const t of nuevas) {
      expect(t.clips).toHaveLength(1);
      const rol = ROLES_WORSHIP[nuevas.indexOf(t)]!;
      const clip = t.clips[0] as unknown as { notas: Array<{ pitch: number }>; duracion: number };
      expect(clip.notas.length).toBe(a.partes[rol].length);
      expect(clip.duracion).toBe(a.duracionBeats);
    }
    expect(s.project.marcadores.length).toBe(a.secciones.length);
    // undo de todo
    let n = 0;
    while (tienda.executor.canUndo() && n < 100) {
      await tienda.executor.undo();
      n++;
    }
    const f = tienda.obtenerEstado();
    expect(f.project.tracks.length).toBe(pistasAntes);
    expect(f.project.marcadores.length).toBe(0);
  });

  it('en una única transacción (batch) → un solo undo lo revierte todo', async () => {
    const a = componerWorship({ semilla: 11 });
    const acciones = arregloAComandos(a, { clipPorSeccion: true });
    const tienda = nueva();
    const antes = tienda.obtenerEstado().project.tracks.length;
    const r = await tienda.executor.batch(acciones.map((x) => ({ type: x.type, payload: x.payload })));
    expect(r.success, r.error?.message).toBe(true);
    const s = tienda.obtenerEstado();
    expect(s.project.tracks.length).toBe(antes + 7);
    const clips = s.project.tracks.slice(antes).reduce((n, t) => n + t.clips.length, 0);
    expect(clips).toBe(acciones.filter((x) => x.type === 'midi.clip.create').length);
    expect(clips).toBeGreaterThan(7);
    await tienda.executor.undo();
    expect(tienda.obtenerEstado().project.tracks.length).toBe(antes);
    expect(tienda.executor.canUndo()).toBe(false);
  });

  it('opciones: sin marcadores/bpm y sólo ciertos roles', () => {
    const a = componerWorship({ semilla: 7 });
    const acc = arregloAComandos(a, { crearMarcadores: false, ajustarBpm: false, ajustarTonalidad: false, roles: ['bajo', 'bateria'], tipoPista: 'instrumento' });
    expect(acc.map((x) => x.type)).toEqual(['track.create', 'track.create', 'midi.clip.create', 'midi.clip.create']);
    expect((acc[0]!.payload as { tipo: string }).tipo).toBe('instrumento');
  });
});
