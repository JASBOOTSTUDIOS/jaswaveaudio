import { describe, expect, it } from 'vitest';
import { componerWorship, humanizarInterpretacion, validarArregloWorship, type NotaExpresiva, type OpcionesExpresion, type RolWorship } from './index';

const BPM = 70;
const BPC = 4;
const aMs = (beats: number) => (beats * 60000) / BPM;
const media = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Mini canción rígida: verso (8, suave) → pre-coro (4, sube) → coro (8, fuerte). Todo en rejilla, velocidades planas. */
const SECCIONES = [
  { inicioBeat: 0, duracionBeats: 32, intensidadInicial: 0.35, intensidad: 0.35, tipo: 'verso' },
  { inicioBeat: 32, duracionBeats: 16, intensidadInicial: 0.35, intensidad: 0.75, tipo: 'precoro' },
  { inicioBeat: 48, duracionBeats: 32, intensidadInicial: 0.85, intensidad: 0.85, tipo: 'coro' },
];
const ACORDES = [
  { bajo: 38, nota: [62, 66, 69] },
  { bajo: 33, nota: [61, 64, 69] },
  { bajo: 35, nota: [62, 66, 71] },
  { bajo: 43, nota: [62, 67, 71] },
];

function crearEntrada(): Partial<Record<RolWorship, NotaExpresiva[]>> {
  const e: Record<string, NotaExpresiva[]> = { piano: [], pad: [], cuerdas: [], bajo: [], bateria: [], guitarra: [] };
  for (let c = 0; c < 20; c++) {
    const t0 = c * BPC;
    const ac = ACORDES[c % 4]!;
    ac.nota.forEach((p) => {
      e.piano!.push({ pitch: p, inicio: t0, duracion: 1.9, velocidad: 70 });
      e.piano!.push({ pitch: p, inicio: t0 + 2, duracion: 1.9, velocidad: 70 });
      e.pad!.push({ pitch: p - 12, inicio: t0, duracion: BPC, velocidad: 60 });
      e.cuerdas!.push({ pitch: p + 5, inicio: t0, duracion: BPC, velocidad: 60 });
      e.guitarra!.push({ pitch: p, inicio: t0, duracion: 3.8, velocidad: 70 });
    });
    e.bajo!.push({ pitch: ac.bajo, inicio: t0, duracion: 1.8, velocidad: 85 });
    e.bajo!.push({ pitch: ac.bajo + 12, inicio: t0 + 2.5, duracion: 0.9, velocidad: 85 });
    e.bateria!.push({ pitch: 36, inicio: t0, duracion: 0.2, velocidad: 90 });
    e.bateria!.push({ pitch: 36, inicio: t0 + 2.5, duracion: 0.2, velocidad: 90 });
    e.bateria!.push({ pitch: 38, inicio: t0 + 1, duracion: 0.2, velocidad: 95 });
    e.bateria!.push({ pitch: 38, inicio: t0 + 3, duracion: 0.2, velocidad: 95 });
    for (let i = 0; i < 8; i++) e.bateria!.push({ pitch: 42, inicio: t0 + i * 0.5, duracion: 0.2, velocidad: 60 });
  }
  return e as Partial<Record<RolWorship, NotaExpresiva[]>>;
}

const opciones = (extra: Partial<OpcionesExpresion> = {}): OpcionesExpresion => ({
  semilla: 99,
  bpm: BPM,
  beatsPorCompas: BPC,
  secciones: SECCIONES,
  ...extra,
});

const ROLES = ['piano', 'pad', 'cuerdas', 'bajo', 'bateria', 'guitarra'] as const;
const enSec = (ns: NotaExpresiva[], i: number) => ns.filter((n) => n.inicio >= SECCIONES[i]!.inicioBeat && n.inicio < SECCIONES[i]!.inicioBeat + SECCIONES[i]!.duracionBeats);

describe('expresión · humanizarInterpretacion', () => {
  const entrada = crearEntrada();
  const r = humanizarInterpretacion(entrada, opciones());

  it('determinista con semilla; otra semilla da otra interpretación', () => {
    const r2 = humanizarInterpretacion(entrada, opciones());
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r));
    const r3 = humanizarInterpretacion(entrada, opciones({ semilla: 100 }));
    expect(JSON.stringify(r3)).not.toBe(JSON.stringify(r));
  });

  it('no muta la entrada', () => {
    const copia = JSON.stringify(crearEntrada());
    expect(JSON.stringify(entrada)).toBe(copia);
  });

  it('desvíos de tiempo dentro de los rangos de cada instrumento', () => {
    // batería: ±3-5 ms (la caja un poco atrás, hasta 9 ms)
    const bat = r.partes.bateria!.filter((n) => n.velocidad > 45 || n.pitch !== 38);
    const desvBat = bat.map((n) => aMs(n.inicio - Math.round(n.inicio * 2) / 2)).filter((d) => Math.abs(d) < 60);
    expect(Math.max(...desvBat.map(Math.abs))).toBeLessThanOrEqual(10);
    const bombos = r.partes.bateria!.filter((n) => n.pitch === 36).map((n) => aMs(n.inicio - Math.round(n.inicio * 2) / 2));
    expect(Math.max(...bombos.map(Math.abs))).toBeLessThanOrEqual(5);
    const cajas = r.partes.bateria!.filter((n) => n.pitch === 38 && n.velocidad > 60).map((n) => aMs(n.inicio - Math.round(n.inicio)));
    expect(media(cajas)).toBeGreaterThan(1);
    // bajo ligeramente atrás
    const bajo = r.partes.bajo!.filter((n) => Math.abs(n.inicio - Math.round(n.inicio)) < 0.2).map((n) => aMs(n.inicio - Math.round(n.inicio)));
    expect(media(bajo)).toBeGreaterThan(1);
    expect(Math.max(...bajo)).toBeLessThanOrEqual(14);
    // piano y guitarra: deriva ±14 ms + arpegiado del acorde
    const piano = r.partes.piano!.map((n) => aMs(n.inicio - Math.round(n.inicio)));
    expect(Math.min(...piano)).toBeGreaterThanOrEqual(-15);
    expect(Math.max(...piano)).toBeLessThanOrEqual(14 + 14 + 6);
    const guit = r.partes.guitarra!.map((n) => aMs(n.inicio - Math.round(n.inicio)));
    expect(Math.min(...guit)).toBeGreaterThanOrEqual(-15);
    expect(Math.max(...guit)).toBeLessThanOrEqual(14 + 40 + 2);
    // cuerdas/pad: entradas tardías y escalonadas (hasta ~80 ms)
    for (const rol of ['cuerdas', 'pad'] as const) {
      const d = r.partes[rol]!.map((n) => aMs(n.inicio - Math.round(n.inicio)));
      expect(Math.max(...d), rol).toBeLessThanOrEqual(80.5);
      expect(Math.max(...d) - Math.min(...d), rol).toBeGreaterThan(30);
      expect(media(d), rol).toBeGreaterThan(8);
    }
  });

  it('rasgueo de guitarra: 15-40 ms entre primera y última cuerda y dirección alterna', () => {
    const dirs: boolean[] = [];
    let ok = 0;
    let total = 0;
    for (let c = 0; c < 20; c++) {
      const acorde = r.partes.guitarra!.filter((n) => Math.abs(n.inicio - c * BPC) < 0.2);
      expect(acorde).toHaveLength(3);
      const orden = [...acorde].sort((a, b) => a.inicio - b.inicio);
      const spread = aMs(orden[2]!.inicio - orden[0]!.inicio);
      total++;
      if (spread >= 14 && spread <= 41) ok++;
      dirs.push(orden[0]!.pitch < orden[2]!.pitch);
    }
    expect(ok / total).toBeGreaterThan(0.9);
    const cambios = dirs.filter((d, i) => i > 0 && d !== dirs[i - 1]).length;
    expect(cambios).toBeGreaterThan(8); // abajo/arriba alternos casi siempre
  });

  it('nunca saca notas de su clip (sección) ni de la canción', () => {
    for (const rol of ROLES) {
      for (const n of r.partes[rol]!) {
        const s = SECCIONES.find((x) => n.inicio >= x.inicioBeat - 1e-9 && n.inicio < x.inicioBeat + x.duracionBeats - 1e-9);
        expect(s, `${rol} @${n.inicio}`).toBeDefined();
        expect(n.inicio + n.duracion, `${rol} @${n.inicio}`).toBeLessThanOrEqual(s!.inicioBeat + s!.duracionBeats + 1e-6);
        expect(n.inicio).toBeGreaterThanOrEqual(0);
      }
    }
    // y sólo se añaden notas (jamás se pierden): cada sección conserva al menos las que tenía
    for (const rol of ROLES) {
      SECCIONES.forEach((_, i) => expect(enSec(r.partes[rol]!, i).length).toBeGreaterThanOrEqual(enSec(entrada[rol]!, i).length));
    }
  });

  it('velocidades enteras 1..127, sin superposición ilegal (mismo pitch ni bajo monofónico)', () => {
    for (const rol of ROLES) {
      const ns = r.partes[rol]!;
      for (const n of ns) {
        expect(Number.isInteger(n.velocidad)).toBe(true);
        expect(n.velocidad).toBeGreaterThanOrEqual(1);
        expect(n.velocidad).toBeLessThanOrEqual(127);
        expect(n.duracion).toBeGreaterThanOrEqual(1 / 64);
      }
      const porPitch = new Map<number, NotaExpresiva[]>();
      for (const n of ns) porPitch.set(n.pitch, [...(porPitch.get(n.pitch) ?? []), n]);
      for (const lista of porPitch.values()) {
        const ord = [...lista].sort((a, b) => a.inicio - b.inicio);
        for (let i = 0; i < ord.length - 1; i++) expect(ord[i]!.inicio + ord[i]!.duracion, `${rol} pitch ${ord[i]!.pitch}`).toBeLessThanOrEqual(ord[i + 1]!.inicio + 1e-6);
      }
    }
    const bajo = [...r.partes.bajo!].sort((a, b) => a.inicio - b.inicio);
    let legato = 0;
    for (let i = 0; i < bajo.length - 1; i++) {
      const solape = bajo[i]!.inicio + bajo[i]!.duracion - bajo[i + 1]!.inicio;
      expect(solape).toBeLessThanOrEqual(0.05 + 1e-6);
      if (solape > 0) legato++;
    }
    expect(legato).toBeGreaterThan(5); // el legato existe (solape pequeño)
  });

  it('con solapeBajo = 0 el bajo no se solapa en absoluto', () => {
    const r0 = humanizarInterpretacion(entrada, opciones({ solapeBajo: 0 }));
    const bajo = [...r0.partes.bajo!].sort((a, b) => a.inicio - b.inicio);
    for (let i = 0; i < bajo.length - 1; i++) expect(bajo[i]!.inicio + bajo[i]!.duracion).toBeLessThanOrEqual(bajo[i + 1]!.inicio + 1e-6);
  });

  it('dos compases idénticos NO salen idénticos (todos los roles)', () => {
    const firma = (ns: NotaExpresiva[], c: number) =>
      ns
        .filter((n) => n.inicio >= c * BPC - 0.3 && n.inicio < (c + 1) * BPC - 0.3)
        .map((n) => `${n.pitch}@${(n.inicio - c * BPC).toFixed(3)}v${n.velocidad}d${n.duracion.toFixed(2)}`)
        .join('|');
    for (const rol of ROLES) {
      const firmas = new Set<string>();
      for (let c = 4; c < 8; c++) firmas.add(firma(r.partes[rol]!, c)); // verso: mismos 4 acordes... (c%4 distinto) → comparamos c y c+4
      const iguales = [0, 1, 2, 3].filter((k) => firma(r.partes[rol]!, 4 + k) === firma(r.partes[rol]!, 8 + k)).length;
      expect(iguales, rol).toBe(0);
    }
  });

  it('el balance dinámico sube hacia el estribillo y crece dentro del pre-coro', () => {
    const vm = (rol: RolWorship, i: number) => media(enSec(r.partes[rol]!, i).map((n) => n.velocidad));
    for (const rol of ['piano', 'guitarra', 'bajo'] as const) {
      expect(vm(rol, 2), rol).toBeGreaterThan(vm(rol, 0) + 5);
    }
    const pre = r.partes.piano!.filter((n) => n.inicio >= 32 && n.inicio < 48);
    const ini = media(pre.filter((n) => n.inicio < 36).map((n) => n.velocidad));
    const fin = media(pre.filter((n) => n.inicio >= 44).map((n) => n.velocidad));
    expect(fin).toBeGreaterThan(ini + 3);
    // contorno de frase: la velocidad no es plana
    const sd = Math.sqrt(media(enSec(r.partes.piano!, 0).map((n) => (n.velocidad - vm('piano', 0)) ** 2)));
    expect(sd).toBeGreaterThan(3);
  });

  it('acentos: tiempos fuertes del hi-hat suenan más que los contratiempos', () => {
    const hh = r.partes.bateria!.filter((n) => n.pitch === 42);
    const fuertes = hh.filter((n) => Math.abs(n.inicio - Math.round(n.inicio)) < 0.1).map((n) => n.velocidad);
    const flojos = hh.filter((n) => Math.abs(n.inicio - Math.round(n.inicio)) >= 0.3).map((n) => n.velocidad);
    expect(media(fuertes)).toBeGreaterThan(media(flojos) + 5);
  });

  it('pedal CC64: cambios por acorde, medios pedales en pasajes suaves y todo dentro de las secciones', () => {
    const ped = r.cc.piano!.filter((e) => e.cc === 64);
    expect(ped.length).toBeGreaterThanOrEqual(40);
    for (const e of ped) {
      expect(e.valor).toBeGreaterThanOrEqual(0);
      expect(e.valor).toBeLessThanOrEqual(1);
      expect(SECCIONES.some((s) => e.tiempo >= s.inicioBeat - 1e-9 && e.tiempo <= s.inicioBeat + s.duracionBeats)).toBe(true);
    }
    // se levanta (0) antes de cada cambio de compás y vuelve a bajar
    for (let c = 1; c < 8; c++) {
      const alrededor = ped.filter((e) => Math.abs(e.tiempo - c * BPC) < 0.2);
      expect(alrededor.some((e) => e.valor === 0), `levanta @${c}`).toBe(true);
      expect(alrededor.some((e) => e.valor > 0 && e.tiempo > c * BPC - 0.01), `baja @${c}`).toBe(true);
    }
    const bajados = (i: number) => ped.filter((e) => e.valor > 0 && e.tiempo >= SECCIONES[i]!.inicioBeat && e.tiempo < SECCIONES[i]!.inicioBeat + SECCIONES[i]!.duracionBeats).map((e) => e.valor);
    expect(Math.min(...bajados(0))).toBeLessThan(0.8); // medio pedal en el verso
    expect(media(bajados(2))).toBeGreaterThan(media(bajados(0)));
    // tiempos monótonos
    for (let i = 1; i < ped.length; i++) expect(ped[i]!.tiempo).toBeGreaterThanOrEqual(ped[i - 1]!.tiempo);
  });

  it('CC11 de pad y cuerdas: swell por acorde en 0..1', () => {
    for (const rol of ['pad', 'cuerdas'] as const) {
      const e = r.cc[rol]!;
      expect(e.length).toBeGreaterThan(20);
      expect(e.every((x) => x.cc === 11 && x.valor > 0 && x.valor <= 1)).toBe(true);
      expect(Math.max(...e.map((x) => x.valor)) - Math.min(...e.map((x) => x.valor))).toBeGreaterThan(0.1);
    }
  });

  it('bajo pegado al bombo: cuando coinciden, <= 6 ms de diferencia', () => {
    const bombos = r.partes.bateria!.filter((n) => n.pitch === 36);
    let pares = 0;
    for (const b of r.partes.bajo!) {
      const k = bombos.find((x) => Math.abs(x.inicio - b.inicio) < 0.08);
      if (!k) continue;
      pares++;
      expect(Math.abs(aMs(b.inicio - k.inicio))).toBeLessThanOrEqual(6);
    }
    expect(pares).toBeGreaterThan(30);
  });

  it('adiciones: crash al entrar el coro, notas fantasma bajas y anticipaciones del bajo', () => {
    expect(r.partes.bateria!.some((n) => n.pitch === 49 && Math.abs(n.inicio - 48) < 0.2)).toBe(true);
    const fantasmas = r.partes.bateria!.filter((n) => n.articulacion === 'fantasma');
    expect(fantasmas.length).toBeGreaterThanOrEqual(1);
    expect(fantasmas.every((n) => n.velocidad <= 44)).toBe(true);
    expect(r.partes.bajo!.length).toBeGreaterThan(entrada.bajo!.length);
    const sinAdiciones = humanizarInterpretacion(entrada, opciones({ adiciones: false }));
    expect(sinAdiciones.partes.bajo!.length).toBe(entrada.bajo!.length);
    expect(sinAdiciones.partes.bateria!.length).toBe(entrada.bateria!.length);
  });

  it('piano: las notas de un mismo acorde no se cortan a la vez', () => {
    const acorde = r.partes.piano!.filter((n) => Math.abs(n.inicio - 8 * BPC) < 0.2);
    const fines = new Set(acorde.map((n) => (n.inicio + n.duracion).toFixed(3)));
    expect(fines.size).toBe(acorde.length);
  });

  it('con todo desactivado y cantidad 0 la música queda como entró', () => {
    const q = humanizarInterpretacion(entrada, opciones({ cantidad: 0, adiciones: false, controladores: false, duracion: false, sincronizarBajo: false }));
    for (const rol of ['piano', 'pad', 'cuerdas', 'guitarra'] as const) {
      expect(q.partes[rol]!.map((n) => [n.pitch, n.inicio, n.velocidad])).toEqual(
        [...entrada[rol]!].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch).map((n) => [n.pitch, n.inicio, n.velocidad]),
      );
    }
    expect(Object.keys(q.cc)).toHaveLength(0);
  });
});

describe('expresión · integrada en componerWorship', () => {
  const a = componerWorship({ semilla: 7 });
  it('produce CC (pedal y expresión), arreglo válido y es determinista', () => {
    expect(a.cc?.piano?.some((e) => e.cc === 64 && e.valor === 0)).toBe(true);
    expect(a.cc?.pad?.length ?? 0).toBeGreaterThan(20);
    expect(validarArregloWorship(a).problemas).toEqual([]);
    expect(JSON.stringify(componerWorship({ semilla: 7 }))).toBe(JSON.stringify(a));
  });
  it('se puede desactivar (expresion: false, humanizacion 0) y entonces no hay CC', () => {
    expect(componerWorship({ semilla: 7, expresion: false }).cc).toBeUndefined();
    expect(componerWorship({ semilla: 7, humanizacion: 0 }).cc).toBeUndefined();
  });
  it('la velocidad media sube de verso a coro final en piano, guitarra y bajo', () => {
    const verso = a.secciones.find((s) => s.tipo === 'verso')!;
    const coro = a.secciones.filter((s) => s.tipo === 'coro' || s.tipo === 'coroFinal').pop()!;
    for (const rol of ['piano', 'bajo', 'bateria'] as const) {
      const v = (s: typeof verso) => media(a.partes[rol].filter((n) => n.inicio >= s.inicioBeat && n.inicio < s.inicioBeat + s.duracionBeats).map((n) => n.velocidad));
      expect(v(coro), rol).toBeGreaterThan(v(verso) + 4);
    }
  });
});

describe('expresión · CC en el DAW (midi.setCC)', () => {
  it('arregloAComandos añade la expresión (CC64/CC11) a los clips y el ejecutor la acepta', async () => {
    const { crearEstadoInicial } = await import('../../state/estado-inicial');
    const { crearTiendaDAW } = await import('../../state/tienda');
    const { arregloAComandos } = await import('./index');
    const a = componerWorship({ semilla: 7 });
    const acciones = arregloAComandos(a, { clipPorSeccion: true });
    const parches = acciones.filter((x) => x.type === 'midi.setCC');
    expect(parches.length).toBeGreaterThan(10);
    expect(arregloAComandos(a, { incluirCC: false }).some((x) => x.type === 'midi.setCC')).toBe(false);
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    for (const acc of acciones) {
      const res = await tienda.executor.execute(acc.type, acc.payload);
      expect(res.success, `${acc.type}: ${res.error?.message ?? ''}`).toBe(true);
    }
    const pista = tienda.obtenerEstado().project.tracks.find((t) => t.id.endsWith('-piano'))!;
    const clip = pista.clips[0] as unknown as { notas: unknown[]; expression?: { cc: Array<{ cc: number; puntos: Array<{ tiempo: number; valor: number }> }> } };
    expect(clip.notas.length).toBeGreaterThan(0);
    const lane = clip.expression?.cc.find((l) => l.cc === 64);
    expect(lane?.puntos.length ?? 0).toBeGreaterThan(0);
    expect(lane!.puntos.every((p) => p.tiempo >= 0 && p.valor >= 0 && p.valor <= 1)).toBe(true);
  }, 20_000); // ejecuta cada acción de la canción completa con validación del estado: prueba de corrección, no de rendimiento
});
