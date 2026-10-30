/**
 * Exporta un arreglo de worship a un .mid multipista estándar (SMF tipo 1, 480 PPQ, un track por rol,
 * batería en el canal 10, pista 0 con tempo/compás/marcadores).
 *
 * Uso (desde shared/):
 *   npx vite-node scripts/exportar-worship-midi.ts <ruta.mid> [--semilla N] [--bpm N] [--estilo ballad|anthem|ambient]
 *                                                  [--compas 4/4|6/8] [--humanizacion 0..1] [--stats]
 * También funciona con tsx:  npx tsx scripts/exportar-worship-midi.ts ...
 */

import { writeFileSync } from 'node:fs';
import { RAIZ_PC } from '../src/music/worship/armonia';
import { componerWorship, ROLES_WORSHIP, type ArregloWorship, type EstiloWorship, type RolWorship } from '../src/music/worship';

const PPQ = 480;

const CANAL: Record<RolWorship, number> = { piano: 0, pad: 1, cuerdas: 2, bajo: 3, guitarra: 4, melodia: 5, bateria: 9 };
const PROGRAMA: Partial<Record<RolWorship, number>> = { piano: 0, pad: 89, cuerdas: 48, bajo: 33, guitarra: 27, melodia: 0 };
const NOMBRE: Record<RolWorship, string> = {
  piano: 'Piano', pad: 'Pad', cuerdas: 'Cuerdas', bajo: 'Bajo', bateria: 'Bateria', guitarra: 'Guitarra', melodia: 'Melodia',
};

type Evento = { tick: number; orden: number; bytes: number[] };

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out = [v & 0x7f];
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const texto = (s: string) => [...Buffer.from(s, 'latin1')];

function meta(tipo: number, datos: number[]): number[] {
  return [0xff, tipo, ...vlq(datos.length), ...datos];
}

function pista(eventos: Evento[]): number[] {
  const ord = [...eventos].sort((a, b) => a.tick - b.tick || a.orden - b.orden);
  const cuerpo: number[] = [];
  let t = 0;
  for (const e of ord) {
    cuerpo.push(...vlq(e.tick - t), ...e.bytes);
    t = e.tick;
  }
  cuerpo.push(...vlq(0), ...meta(0x2f, []));
  return [...texto('MTrk'), ...u32(cuerpo.length), ...cuerpo];
}

const ticks = (beats: number) => Math.round(beats * PPQ);

function arregloAMidi(a: ArregloWorship): Buffer {
  const pistas: number[][] = [];

  // Pista 0: tempo, compás, tonalidad y marcadores de sección.
  const us = Math.round(60_000_000 / a.bpm);
  const t0: Evento[] = [
    { tick: 0, orden: 0, bytes: meta(0x03, texto(a.titulo)) },
    { tick: 0, orden: 1, bytes: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    {
      tick: 0,
      orden: 2,
      bytes: meta(0x58, a.compas === '4/4' ? [4, 2, 24, 8] : [6, 3, 24, 8]),
    },
  ];
  const pc = RAIZ_PC[a.tonalidad.raiz];
  const sf = a.tonalidad.escala === 'mayor' ? [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5][pc]! : [-3, 4, -1, 6, 1, -4, 3, -2, 5, 0, -5, 2][pc]!;
  t0.push({ tick: 0, orden: 3, bytes: meta(0x59, [sf & 255, a.tonalidad.escala === 'mayor' ? 0 : 1]) });
  for (const m of a.marcadores) t0.push({ tick: ticks(m.inicio), orden: 4, bytes: meta(0x06, texto(m.nombre)) });
  pistas.push(pista(t0));

  for (const rol of ROLES_WORSHIP) {
    const notas = a.partes[rol];
    if (notas.length === 0) continue;
    const ch = CANAL[rol];
    const ev: Evento[] = [{ tick: 0, orden: 0, bytes: meta(0x03, texto(NOMBRE[rol])) }];
    const prog = PROGRAMA[rol];
    if (prog !== undefined) ev.push({ tick: 0, orden: 1, bytes: [0xc0 | ch, prog] });
    for (const n of notas) {
      const on = ticks(n.inicio);
      const off = Math.max(on + 1, ticks(n.inicio + n.duracion));
      ev.push({ tick: on, orden: 3, bytes: [0x90 | ch, n.pitch, n.velocidad] });
      ev.push({ tick: off, orden: 2, bytes: [0x80 | ch, n.pitch, 0] });
    }
    for (const b of a.pitchBend[rol] ?? []) {
      const v = Math.max(0, Math.min(16383, Math.round(8192 + (b.semitonos / 2) * 8191)));
      ev.push({ tick: ticks(b.inicio), orden: 2.5, bytes: [0xe0 | ch, v & 127, (v >> 7) & 127] });
    }
    pistas.push(pista(ev));
  }

  const cabecera = [...texto('MThd'), ...u32(6), ...u16(1), ...u16(pistas.length), ...u16(PPQ)];
  return Buffer.from([...cabecera, ...pistas.flat()]);
}

function argumentos() {
  const args = process.argv.slice(2);
  const ruta = args.find((x, i) => !x.startsWith('--') && (i === 0 || !args[i - 1]!.startsWith('--')));
  const val = (nombre: string) => {
    const i = args.indexOf(`--${nombre}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return { ruta, semilla: Number(val('semilla') ?? 7), bpm: val('bpm'), estilo: val('estilo'), compas: val('compas'), humanizacion: val('humanizacion') };
}

function estadisticas(a: ArregloWorship) {
  const porRol = Object.fromEntries(ROLES_WORSHIP.map((r) => [r, a.partes[r].length]));
  console.log(`  notas por rol: ${JSON.stringify(porRol)}`);
  const coros = a.secciones.filter((s) => s.tipo === 'coro' || s.tipo === 'coroFinal');
  const huella = (rol: RolWorship, s: (typeof coros)[number], desde: number, hasta: number) =>
    new Set(
      a.partes[rol]
        .filter((n) => n.inicio >= s.inicioBeat + desde * a.beatsPorCompas - 0.05 && n.inicio < s.inicioBeat + hasta * a.beatsPorCompas - 0.05)
        .map((n) => `${Math.round((n.inicio - s.inicioBeat - desde * a.beatsPorCompas) * 4)}:${n.pitch}`),
    );
  const dist = (x: Set<string>, y: Set<string>) => {
    let c = 0;
    for (const k of x) if (y.has(k)) c++;
    return +(1 - c / new Set([...x, ...y]).size).toFixed(2);
  };
  const [c1, c2, cf] = coros;
  if (c1 && c2 && cf) {
    console.log(
      `  distancia de patrón (1=totalmente distinto)  coro1↔coro2: batería ${dist(huella('bateria', c1, 0, 8), huella('bateria', c2, 0, 8))}, piano ${dist(huella('piano', c1, 0, 8), huella('piano', c2, 0, 8))}` +
        ` | coroFinal mitad1↔mitad2: batería ${dist(huella('bateria', cf, 0, 8), huella('bateria', cf, 8, 16))}, piano ${dist(huella('piano', cf, 0, 8), huella('piano', cf, 8, 16))}`,
    );
    const media = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : 0);
    const todas = (s: typeof c1) => ROLES_WORSHIP.flatMap((r) => a.partes[r].filter((n) => n.inicio >= s.inicioBeat && n.inicio < s.inicioBeat + s.duracionBeats));
    const f = (s: typeof c1) => `${(todas(s).length / s.compases).toFixed(1)} notas/compás, vel media ${media(todas(s).map((n) => n.velocidad)).toFixed(1)}`;
    console.log(`  coro1: ${f(c1)} | coro2: ${f(c2)} | coroFinal: ${f(cf)}`);
  }
  const caja = a.partes.bateria.filter((n) => n.pitch === 38 && !n.articulacion).map((n) => n.desfaseMs ?? 0);
  const bombo = a.partes.bateria.filter((n) => n.pitch === 36).map((n) => n.desfaseMs ?? 0);
  const m = (xs: number[]) => (xs.length ? xs.reduce((p, q) => p + q, 0) / xs.length : 0);
  console.log(
    `  micro-timing batería: caja media ${m(caja).toFixed(1)} ms (n=${caja.length}), bombo media ${m(bombo).toFixed(1)} ms (n=${bombo.length}); fantasmas ${a.partes.bateria.filter((n) => n.articulacion === 'fantasma').length}, flams ${a.partes.bateria.filter((n) => n.articulacion === 'flam').length}`,
  );
  console.log(`  forma: ${a.secciones.map((s) => `${s.nombre}(${s.compases})`).join(' → ')}`);
  console.log(`  acordes verso1: ${a.acordes.filter((c) => c.seccion === 1).map((c) => c.simbolo).join(' ')}`);
}

{
  const { ruta, semilla, bpm, estilo, compas, humanizacion } = argumentos();
  if (!ruta) {
    console.error('Uso: exportar-worship-midi.ts <ruta.mid> [--semilla N] [--bpm N] [--estilo ...] [--compas 4/4|6/8] [--humanizacion 0..1]');
    process.exit(1);
  }
  const arreglo = componerWorship({
    semilla,
    ...(bpm ? { bpm: Number(bpm) } : {}),
    ...(estilo ? { estilo: estilo as EstiloWorship } : {}),
    ...(compas ? { compas: compas as '4/4' | '6/8' } : {}),
    ...(humanizacion ? { humanizacion: Number(humanizacion) } : {}),
  });
  const buf = arregloAMidi(arreglo);
  writeFileSync(ruta, buf);
  console.log(`${ruta}  (${buf.length} bytes) · semilla ${semilla} · ${arreglo.bpm} BPM · ${arreglo.totalCompases} compases · ${arreglo.duracionSegundos}s`);
  estadisticas(arreglo);
}
