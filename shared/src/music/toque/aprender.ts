/**
 * Aprende el «toque» de un intérprete a partir de sus notas MIDI: micro-timing por posición métrica,
 * dispersión y orden de entrada de los acordes, microdinámica (por posición, por voz del acorde, curva
 * de arpegios), articulación (legato/staccato) y ataque de frase. Pura y determinista.
 */

import {
  agruparAtaques,
  ajustarARejilla,
  estadistica,
  iniciosDeFrase,
  notasValidas,
  posicionMetrica,
  r2,
  tramosDeArpegio,
  velocidadDe,
} from './analisis';
import {
  POSICIONES_METRICAS,
  type ConfianzaToque,
  type Estadistica,
  type NotaToque,
  type OpcionesAprenderToque,
  type PerfilToque,
  type PosicionMetrica,
} from './tipos';

/** Por debajo de este span (ms) un acorde se considera plaqué (simultáneo). */
export const UMBRAL_ARPEGIADO_MS = 6;

const RE_PERCUSIVO = /bater|drum|perc|kit|toms?\b|caj[oó]n/i;

export function esInstrumentoPercusivo(instrumento?: string): boolean {
  return !!instrumento && RE_PERCUSIVO.test(instrumento);
}

function porPosicionVacia(): Record<PosicionMetrica, number[]> {
  return { fuerte: [], debil: [], contratiempo: [], subdivision: [] };
}

function aEstadisticas(m: Record<PosicionMetrica, number[]>): Record<PosicionMetrica, Estadistica> {
  const r = {} as Record<PosicionMetrica, Estadistica>;
  for (const p of POSICIONES_METRICAS) r[p] = estadistica(m[p]);
  return r;
}

/** Elige la rejilla que mejor explica los ataques: semicorchea salvo que el tresillo encaje claramente mejor. */
function elegirRejilla(anclas: readonly number[]): number {
  if (anclas.length < 4) return 0.25;
  const err = (r: number) => anclas.reduce((a, t) => a + Math.abs(t - ajustarARejilla(t, r)), 0) / anclas.length;
  return err(1 / 3) < 0.6 * err(0.25) ? 1 / 3 : 0.25;
}

export function aprenderPerfilToque(notas: readonly NotaToque[], opts: OpcionesAprenderToque): PerfilToque {
  const bpm = Number.isFinite(opts.bpm) && opts.bpm > 0 ? opts.bpm : 120;
  const msPorBeat = 60000 / bpm;
  const offset = opts.offsetBeats ?? 0;
  const bpc = opts.beatsPorCompas && opts.beatsPorCompas > 0 ? opts.beatsPorCompas : 4;
  const percusivo = esInstrumentoPercusivo(opts.instrumento);

  const ordenadas = notasValidas(notas).map((x) => x.nota);
  const inicios = ordenadas.map((n) => n.inicio);
  const grupos = agruparAtaques(inicios, msPorBeat, opts.ventanaAcordeMs ?? 35);
  const rejilla = opts.rejillaBeats && opts.rejillaBeats > 0 ? opts.rejillaBeats : elegirRejilla(grupos.map((g) => g.ancla + offset));
  const pasoMs = rejilla * msPorBeat;

  const vels = ordenadas.map(velocidadDe);
  const globalVel = estadistica(vels);

  // ── micro-timing y dinámica por posición (un valor por ataque) ─────────────
  const timingPos = porPosicionVacia();
  const velPos = porPosicionVacia();
  const posDeGrupo: PosicionMetrica[] = [];
  const velMediaGrupo: number[] = [];
  for (const g of grupos) {
    const abs = g.ancla + offset;
    const q = ajustarARejilla(abs, rejilla);
    const pos = posicionMetrica(q, bpc);
    posDeGrupo.push(pos);
    const desvMs = (abs - q) * msPorBeat;
    // Desvíos cercanos a media rejilla son ambiguos (nota fuera de rejilla): no cuentan para el timing.
    if (Math.abs(desvMs) <= 0.42 * pasoMs) timingPos[pos].push(desvMs);
    const vm = g.idx.reduce((a, i) => a + vels[i]!, 0) / g.idx.length;
    velMediaGrupo.push(vm);
    velPos[pos].push(vm);
  }
  const todosTiming = POSICIONES_METRICAS.flatMap((p) => timingPos[p]);

  // ── acordes: dispersión, orden y voces ──────────────────────────────────────
  let acordes = 0;
  let arpegiados = 0;
  let asc = 0;
  let desc = 0;
  const gaps: number[] = [];
  const spans: number[] = [];
  const enfSup: number[] = [];
  const enfBajo: number[] = [];
  const enfMedio: number[] = [];
  grupos.forEach((g, k) => {
    if (g.idx.length < 2) return;
    acordes += 1;
    const ns = g.idx.map((i) => ordenadas[i]!);
    const span = (ns[ns.length - 1]!.inicio - ns[0]!.inicio) * msPorBeat;
    if (span > UMBRAL_ARPEGIADO_MS) {
      arpegiados += 1;
      spans.push(span);
      for (let j = 1; j < ns.length; j++) gaps.push((ns[j]!.inicio - ns[j - 1]!.inicio) * msPorBeat);
      let sube = 0;
      let baja = 0;
      for (let j = 1; j < ns.length; j++) {
        if (ns[j]!.pitch > ns[j - 1]!.pitch) sube += 1;
        else if (ns[j]!.pitch < ns[j - 1]!.pitch) baja += 1;
      }
      if (baja === 0 && sube > 0) asc += 1;
      else if (sube === 0 && baja > 0) desc += 1;
    }
    const media = velMediaGrupo[k]!;
    const porPitch = [...g.idx].sort((a, b) => ordenadas[a]!.pitch - ordenadas[b]!.pitch);
    enfSup.push(vels[porPitch[porPitch.length - 1]!]! - media);
    enfBajo.push(vels[porPitch[0]!]! - media);
    for (const i of porPitch.slice(1, -1)) enfMedio.push(vels[i]! - media);
  });
  const mediaDe = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const medio = estadistica(enfMedio);

  // ── arpegios melódicos: curva de velocidad inicio/medio/fin ────────────────
  const { corridas } = tramosDeArpegio(grupos, ordenadas);
  const curva: [number[], number[], number[]] = [[], [], []];
  for (const c of corridas) {
    const m = c.reduce((a, k) => a + velMediaGrupo[k]!, 0) / c.length;
    c.forEach((k, i) => {
      const f = i / (c.length - 1);
      curva[f < 1 / 3 ? 0 : f < 2 / 3 ? 1 : 2].push(velMediaGrupo[k]! - m);
    });
  }

  // ── articulación ────────────────────────────────────────────────────────────
  const ratios: number[] = [];
  const solapes: number[] = [];
  for (let k = 0; k < grupos.length - 1; k++) {
    const ioi = grupos[k + 1]!.ancla - grupos[k]!.ancla;
    if (ioi <= 0) continue;
    for (const i of grupos[k]!.idx) {
      const n = ordenadas[i]!;
      const ratio = n.duracion / ioi;
      // Notas mantenidas sobre varios ataques (pedal, bajo largo) no describen la articulación.
      if (ratio > 1.6) continue;
      ratios.push(ratio);
      const solape = (n.inicio + n.duracion - grupos[k + 1]!.ancla) * msPorBeat;
      if (solape > 0) solapes.push(solape);
    }
  }

  // ── ataque: inicio de frase y acentos ──────────────────────────────────────
  const frases = iniciosDeFrase(grupos, ordenadas, msPorBeat);
  const velPosEst = aEstadisticas(velPos);
  const deltasFrase: number[] = [];
  for (const k of frases) {
    // El primer ataque de cada frase frente a lo esperado en su posición métrica.
    deltasFrase.push(velMediaGrupo[k]! - velPosEst[posDeGrupo[k]!].media);
  }
  const umbralAcento = globalVel.media + Math.max(8, globalVel.sd);
  const acentos = vels.filter((v) => v >= umbralAcento);

  // ── por pitch (batería) ─────────────────────────────────────────────────────
  const porPitchRaw = new Map<number, { t: number[]; v: number[] }>();
  ordenadas.forEach((n, i) => {
    const abs = n.inicio + offset;
    const q = ajustarARejilla(abs, rejilla);
    const desvMs = (abs - q) * msPorBeat;
    const e = porPitchRaw.get(n.pitch) ?? { t: [], v: [] };
    if (Math.abs(desvMs) <= 0.42 * pasoMs) e.t.push(desvMs);
    e.v.push(vels[i]!);
    porPitchRaw.set(n.pitch, e);
  });
  const porPitch: PerfilToque['porPitch'] = {};
  for (const [pitch, e] of [...porPitchRaw.entries()].sort((a, b) => b[1].v.length - a[1].v.length).slice(0, 32)) {
    if (e.v.length >= 4) porPitch[String(pitch)] = { timing: estadistica(e.t), velocidad: estadistica(e.v) };
  }

  const utiles = todosTiming.length;
  const confianza: ConfianzaToque = utiles < 12 ? 'baja' : utiles < 40 ? 'media' : 'alta';
  const pitches = ordenadas.map((n) => n.pitch);

  return {
    version: 1,
    ...(opts.instrumento ? { instrumento: opts.instrumento } : {}),
    percusivo,
    bpmReferencia: bpm,
    rejillaBeats: rejilla,
    beatsPorCompas: bpc,
    muestras: { notas: ordenadas.length, grupos: grupos.length, acordes, arpegios: corridas.length, frases: frases.size },
    confianza,
    confianzaNum: r2(Math.min(1, utiles / 48)),
    timing: { global: estadistica(todosTiming), porPosicion: aEstadisticas(timingPos) },
    dinamica: {
      global: globalVel,
      porPosicion: velPosEst,
      min: vels.length ? Math.min(...vels) : 0,
      max: vels.length ? Math.max(...vels) : 0,
    },
    acordes: {
      probArpegiado: acordes ? r2(arpegiados / acordes) : 0,
      ordenAscendente: arpegiados ? r2(asc / arpegiados) : 0,
      ordenDescendente: arpegiados ? r2(desc / arpegiados) : 0,
      msEntreNotas: estadistica(gaps),
      spanMs: estadistica(spans),
      enfasisSuperior: mediaDe(enfSup),
      enfasisBajo: mediaDe(enfBajo),
      enfasisMedio: medio.media,
      sdVelocidadInterna: medio.sd,
    },
    arpegios: { n: corridas.length, curva: [mediaDe(curva[0]), mediaDe(curva[1]), mediaDe(curva[2])] },
    articulacion: {
      ratio: estadistica(ratios),
      legato: ratios.length ? r2(ratios.filter((r) => r >= 1).length / ratios.length) : 0,
      staccato: ratios.length ? r2(ratios.filter((r) => r < 0.5).length / ratios.length) : 0,
      solapeMs: estadistica(solapes),
    },
    ataque: {
      inicioFraseDelta: estadistica(deltasFrase),
      acentos: {
        proporcion: vels.length ? r2(acentos.length / vels.length) : 0,
        deltaMedio: acentos.length ? r2(acentos.reduce((a, v) => a + v, 0) / acentos.length - globalVel.media) : 0,
      },
    },
    porPitch,
    rango: pitches.length ? { pitchMin: Math.min(...pitches), pitchMax: Math.max(...pitches) } : null,
  };
}

const NOMBRE_POS: Record<PosicionMetrica, string> = {
  fuerte: 'tiempo fuerte',
  debil: 'tiempos débiles',
  contratiempo: 'contratiempos',
  subdivision: 'subdivisiones',
};

function ms(x: number): string {
  return `${x > 0 ? '+' : ''}${x.toFixed(1)} ms`;
}

/** Informe legible (español) del perfil de toque. */
export function describirPerfilToque(p: PerfilToque): string {
  if (p.muestras.notas === 0) return 'Sin notas que analizar.';
  const l: string[] = [];
  l.push(
    `${p.muestras.notas} notas · ${p.muestras.grupos} ataques · ${p.muestras.acordes} acordes · ${p.muestras.arpegios} arpegios` +
      `${p.instrumento ? ` · ${p.instrumento}` : ''} · confianza ${p.confianza}` +
      ` (rejilla ${p.rejillaBeats === 0.25 ? 'semicorchea' : p.rejillaBeats.toFixed(3) + ' beat'} a ${p.bpmReferencia} BPM)`,
  );
  const tPos = POSICIONES_METRICAS.filter((k) => p.timing.porPosicion[k].n > 0)
    .map((k) => `${NOMBRE_POS[k]} ${ms(p.timing.porPosicion[k].media)} (±${p.timing.porPosicion[k].sd.toFixed(1)}, n=${p.timing.porPosicion[k].n})`)
    .join('; ');
  const tg = p.timing.global;
  l.push(
    `Micro-timing: ${tg.media > 2 ? 'detrás del tiempo' : tg.media < -2 ? 'por delante del tiempo' : 'centrado'} ${ms(tg.media)} ±${tg.sd.toFixed(1)} · ${tPos}`,
  );
  const vPos = POSICIONES_METRICAS.filter((k) => p.dinamica.porPosicion[k].n > 0)
    .map((k) => `${NOMBRE_POS[k]} ${p.dinamica.porPosicion[k].media.toFixed(0)}`)
    .join(', ');
  l.push(
    `Dinámica: media ${p.dinamica.global.media.toFixed(0)} ±${p.dinamica.global.sd.toFixed(1)} (rango ${p.dinamica.min}–${p.dinamica.max}) · ${vPos}`,
  );
  if (p.muestras.acordes > 0) {
    const a = p.acordes;
    const orden = a.ordenAscendente >= a.ordenDescendente ? `grave→agudo ${Math.round(a.ordenAscendente * 100)}%` : `agudo→grave ${Math.round(a.ordenDescendente * 100)}%`;
    l.push(
      `Acordes: ${Math.round(a.probArpegiado * 100)}% arpegiados` +
        (a.msEntreNotas.n ? ` (${a.msEntreNotas.media.toFixed(1)} ms entre notas, span ${a.spanMs.media.toFixed(0)} ms, ${orden})` : '') +
        ` · voz superior ${a.enfasisSuperior >= 0 ? '+' : ''}${a.enfasisSuperior.toFixed(1)} · bajo ${a.enfasisBajo >= 0 ? '+' : ''}${a.enfasisBajo.toFixed(1)}`,
    );
  }
  if (p.arpegios.n > 0) {
    const [i, m, f] = p.arpegios.curva;
    l.push(`Arpegios: curva de velocidad inicio ${i.toFixed(1)} · medio ${m.toFixed(1)} · fin ${f.toFixed(1)}`);
  }
  const ar = p.articulacion;
  if (ar.ratio.n > 0) {
    const tipo = ar.ratio.media >= 0.95 ? 'legato' : ar.ratio.media < 0.5 ? 'staccato' : 'semi-legato';
    l.push(
      `Articulación: ${tipo} (duración/espacio ${ar.ratio.media.toFixed(2)} ±${ar.ratio.sd.toFixed(2)}; ${Math.round(ar.legato * 100)}% con solape` +
        `${ar.solapeMs.n ? ` de ${ar.solapeMs.media.toFixed(0)} ms` : ''}, ${Math.round(ar.staccato * 100)}% staccato)`,
    );
  }
  const at = p.ataque;
  l.push(
    `Ataque: inicio de frase ${at.inicioFraseDelta.media >= 0 ? '+' : ''}${at.inicioFraseDelta.media.toFixed(1)} vel (n=${at.inicioFraseDelta.n}) · ` +
      `acentos ${Math.round(at.acentos.proporcion * 100)}% (+${at.acentos.deltaMedio.toFixed(0)})`,
  );
  if (p.percusivo) {
    const piezas = Object.entries(p.porPitch)
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${ms(v.timing.media)} vel ${v.velocidad.media.toFixed(0)}`)
      .join('; ');
    if (piezas) l.push(`Por pieza: ${piezas}`);
  }
  if (p.confianza === 'baja') l.push('Aviso: pocas muestras; graba más compases para un perfil fiable.');
  return l.join('\n');
}
