/**
 * Capa de INTERPRETACIÓN humana (pura y determinista por semilla), pensada para reutilizarse tanto desde el
 * compositor (`componerWorship`) como desde composiciones escritas a mano (p. ej. cli/_cancion-manual.mjs).
 *
 * Qué hace, rol por rol (todo acotado y reproducible):
 *  - Tiempo: batería (±3-5 ms, caja un poco atrás), bajo «en el bolsillo» (pegado al bombo y ligeramente
 *    atrás), piano/guitarra con deriva suave ±8-14 ms, cuerdas/pad con entradas escalonadas (hasta ~80 ms),
 *    arpegiado del piano (roll de 6-14 ms) y rasgueo de guitarra (15-40 ms, abajo/arriba alternos).
 *  - Velocidad: contorno por frase (arco de 4 compases), acentos métricos, crescendo hacia el estribillo y
 *    hacia el final de las secciones que suben, jitter acotado, sombreado de voces dentro del acorde
 *    (melodía arriba, cuerdas del rasgueo con distinta fuerza) y patrón de hi-hat (tiempo > contratiempo).
 *  - Duración: legato con solape pequeño en bajo/cuerdas/pad, variación en piano y acordes cuyas notas no
 *    se cortan a la vez, respiración al final de frase, sin solapar nunca el mismo pitch.
 *  - Añadidos: anticipaciones del bajo antes del cambio de acorde, notas fantasma de caja, crash en los
 *    cambios de sección, pickup de fill al final de sección.
 *  - Controladores: CC64 (pedal de sustain del piano, con cambios por acorde y medios pedales) y CC11
 *    (expresión de pad/cuerdas, swell por acorde) como puntos {cc, tiempo, valor 0..1} en beats absolutos.
 *
 * Invariantes: ninguna nota sale de su clip (clip = sección si `clipPorSeccion`, si no el tema entero),
 * velocidades 1..127, el bajo es monofónico (solape máx. 0.05 beat entre pitches distintos, nunca el mismo),
 * ningún rol solapa notas del mismo pitch. Prohibido Math.random / Date.now.
 */

import { clamp, crearRng, hashSemilla, lerp, type Rng } from './prng';
import type { RolWorship } from './tipos';

export interface NotaExpresiva {
  pitch: number;
  /** Beats absolutos (negra = 1). */
  inicio: number;
  duracion: number;
  /** 1..127 */
  velocidad: number;
  articulacion?: string;
}

export interface SeccionExpresiva {
  inicioBeat: number;
  duracionBeats: number;
  /** 0..1 al empezar / terminar la sección (por defecto la misma, `intensidad`). */
  intensidadInicial?: number;
  intensidad: number;
  tipo?: string;
}

export interface EventoCC {
  cc: number;
  /** Beats absolutos. */
  tiempo: number;
  /** 0..1 (la reproducción lo escala a 0..127). */
  valor: number;
}

export interface OpcionesExpresion {
  semilla: number;
  bpm: number;
  beatsPorCompas: number;
  secciones: SeccionExpresiva[];
  /** Los clips son las secciones (true) o un solo clip [0, fin de la última sección] (false). */
  clipPorSeccion?: boolean;
  /** Beats donde cambia el acorde (por defecto, cada compás). Guía pedal, swells y anticipaciones del bajo. */
  cambiosAcorde?: number[];
  /** Desvíos de tiempo, arpegiado y rasgueo (desactívalo si las notas ya vienen con micro-timing). */
  timing?: boolean;
  velocidad?: boolean;
  duracion?: boolean;
  /** Pedal CC64 del piano y CC11 de pad/cuerdas. */
  controladores?: boolean;
  /** Notas añadidas (fantasmas, crash, pickup de fill, anticipaciones de bajo). */
  adiciones?: boolean;
  /** Pega el bajo al bombo. */
  sincronizarBajo?: boolean;
  /** Solape máximo (beats) del legato del bajo entre pitches distintos. 0 = sin solape (por defecto 0.05). */
  solapeBajo?: number;
  /** 0..1: escala todos los desvíos (1 = valores nominales). */
  cantidad?: number;
}

export interface ResultadoExpresion<T extends NotaExpresiva> {
  partes: Partial<Record<RolWorship, T[]>>;
  cc: Partial<Record<RolWorship, EventoCC[]>>;
}

const GM_BOMBO = 36;
const GM_CAJA = 38;
const GM_CRASH = [49, 57];
const GM_TOMS = [41, 43, 45, 47, 48, 50];
const GM_HH = [42, 44, 46];
const MIN_DUR = 0.06;
const PISO_DUR = 0.025;
const HUECO_MISMO_PITCH = 0.02;

const r5 = (x: number) => Math.round(x * 100000) / 100000;

function fraseOrden(rol: RolWorship): number {
  return ['bateria', 'bajo', 'piano', 'guitarra', 'cuerdas', 'pad', 'melodia'].indexOf(rol);
}

/** Humaniza todos los roles a la vez (el bajo necesita al bombo, las adiciones al contexto de sección). */
export function humanizarInterpretacion<T extends NotaExpresiva>(
  entrada: Partial<Record<RolWorship, readonly T[]>>,
  opciones: OpcionesExpresion,
): ResultadoExpresion<T> {
  const o = {
    clipPorSeccion: true,
    timing: true,
    velocidad: true,
    duracion: true,
    controladores: true,
    adiciones: true,
    sincronizarBajo: true,
    cantidad: 1,
    solapeBajo: 0.05,
    ...opciones,
  };
  const secciones = [...o.secciones].sort((a, b) => a.inicioBeat - b.inicioBeat);
  const finTotal = secciones.reduce((m, s) => Math.max(m, s.inicioBeat + s.duracionBeats), 0);
  const bpc = o.beatsPorCompas;
  const ms = o.bpm / 60000; // ms → beats
  const cant = clamp(o.cantidad, 0, 1);

  // ── contexto de secciones y clips ────────────────────────────────────────
  const idxSeccion = (t: number): number => {
    let r = 0;
    for (let i = 0; i < secciones.length; i++) if (t >= secciones[i]!.inicioBeat - 1e-6) r = i;
    return r;
  };
  const limites = (t: number): { ini: number; fin: number } => {
    if (!o.clipPorSeccion || secciones.length === 0) return { ini: 0, fin: finTotal };
    const s = secciones[idxSeccion(t)]!;
    return { ini: s.inicioBeat, fin: s.inicioBeat + s.duracionBeats };
  };
  const intensidadEn = (t: number): number => {
    const s = secciones[idxSeccion(t)];
    if (!s) return 0.5;
    const prog = clamp((t - s.inicioBeat) / Math.max(1e-6, s.duracionBeats), 0, 1);
    return lerp(s.intensidadInicial ?? s.intensidad, s.intensidad, prog);
  };
  const cambios = (o.cambiosAcorde && o.cambiosAcorde.length > 0
    ? [...o.cambiosAcorde]
    : Array.from({ length: Math.ceil(finTotal / bpc) }, (_, i) => i * bpc)
  ).sort((a, b) => a - b);

  // ── copia de trabajo ───────────────────────────────────────────────────
  type W = T & { _orig: number };
  const trab: Partial<Record<RolWorship, W[]>> = {};
  const roles = (Object.keys(entrada) as RolWorship[]).filter((r) => (entrada[r]?.length ?? 0) > 0);
  roles.sort((a, b) => fraseOrden(a) - fraseOrden(b));
  for (const r of roles) trab[r] = (entrada[r] ?? []).map((n) => ({ ...n, _orig: n.inicio }) as W);

  const rngDe = (clave: string): Rng => crearRng(hashSemilla(o.semilla, `expr:${clave}`));

  // ── adiciones (antes del timing para que también se humanicen) ────────────────
  if (o.adiciones) {
    if (trab.bateria) anadirBateria(trab.bateria, secciones, bpc, rngDe('bateria-add'), intensidadEn);
    if (trab.bajo) anadirAnticipacionesBajo(trab.bajo, cambios, limites, idxSeccion, rngDe('bajo-add'), intensidadEn);
  }

  // ── tiempo ─────────────────────────────────────────────────────────────────
  const offsetsBombo: { orig: number; fin: number }[] = [];
  if (o.timing && cant > 0) {
    for (const r of roles) {
      const ns = trab[r]!;
      const rng = rngDe(`t:${r}`);
      aplicarTiempo(r, ns, rng, ms, cant, limites);
      if (r === 'bateria') for (const n of ns) if (n.pitch === GM_BOMBO) offsetsBombo.push({ orig: n._orig, fin: n.inicio });
    }
  } else if (trab.bateria) {
    for (const n of trab.bateria) if (n.pitch === GM_BOMBO) offsetsBombo.push({ orig: n._orig, fin: n.inicio });
  }
  if (o.sincronizarBajo && trab.bajo && offsetsBombo.length > 0) {
    const rng = rngDe('bajo-bombo');
    for (const n of trab.bajo) {
      let mejor: { orig: number; fin: number } | null = null;
      for (const k of offsetsBombo) {
        const d = Math.abs(k.orig - n._orig);
        if (d < 0.08 && (!mejor || d < Math.abs(mejor.orig - n._orig))) mejor = k;
      }
      if (mejor) {
        const lim = limites(n._orig);
        n.inicio = clamp(mejor.fin + (2 + rng.gauss(1.5) * 1.2) * ms * cant, lim.ini, lim.fin - MIN_DUR);
      }
    }
  }

  // ── velocidad ─────────────────────────────────────────────────────────────
  if (o.velocidad) {
    for (const r of roles) aplicarVelocidad(r, trab[r]!, rngDe(`v:${r}`), secciones, idxSeccion, intensidadEn, bpc, cant);
  }

  // ── duración ──────────────────────────────────────────────────────────────
  for (const r of roles) {
    const ns = trab[r]!;
    if (o.duracion) aplicarDuracion(r, ns, rngDe(`d:${r}`), secciones, idxSeccion, limites, bpc, o.solapeBajo, cambios);
    sanear(r, ns, limites, o.solapeBajo);
  }

  // ── controladores ───────────────────────────────────────────────────────────
  const cc: Partial<Record<RolWorship, EventoCC[]>> = {};
  if (o.controladores) {
    if (trab.piano) cc.piano = pedalPiano(trab.piano, secciones, cambios, limites, idxSeccion, intensidadEn, rngDe('pedal'), o.clipPorSeccion);
    for (const r of ['pad', 'cuerdas'] as const) {
      if (trab[r]) cc[r] = expresionSostenida(trab[r]!, cambios, intensidadEn, limites, rngDe(`cc11:${r}`), r === 'cuerdas' ? 0.04 : 0);
    }
  }

  const partes: Partial<Record<RolWorship, T[]>> = {};
  for (const r of roles) {
    partes[r] = trab[r]!
      .map((n) => {
        const { _orig, ...resto } = n as W;
        void _orig;
        return { ...resto, inicio: r5(n.inicio), duracion: r5(n.duracion) } as unknown as T;
      })
      .sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch);
  }
  return { partes, cc };
}

// ═══ TIEMPO ═════════════════════════════════════════════════════════════════════════════

/** Deriva suave (sin ruido blanco): combinación de dos sinusoides lentas de fase aleatoria. */
function crearDeriva(rng: Rng, amplitudMs: number): (t: number) => number {
  const f1 = rng.rango(0, Math.PI * 2);
  const f2 = rng.rango(0, Math.PI * 2);
  const p1 = rng.rango(7, 11);
  const p2 = rng.rango(19, 29);
  return (t) => amplitudMs * (0.6 * Math.sin((2 * Math.PI * t) / p1 + f1) + 0.4 * Math.sin((2 * Math.PI * t) / p2 + f2));
}

function clusters<T extends { inicio: number }>(ns: T[], tol: number): T[][] {
  const ord = [...ns].sort((a, b) => a.inicio - b.inicio);
  const res: T[][] = [];
  for (const n of ord) {
    const ult = res[res.length - 1];
    if (ult && n.inicio - ult[0]!.inicio <= tol) ult.push(n);
    else res.push([n]);
  }
  return res;
}

function aplicarTiempo<W extends NotaExpresiva & { _orig: number }>(
  rol: RolWorship,
  ns: W[],
  rng: Rng,
  ms: number,
  cant: number,
  limites: (t: number) => { ini: number; fin: number },
): void {
  const colocar = (n: W, desvioMs: number) => {
    const lim = limites(n._orig);
    n.inicio = clamp(n._orig + desvioMs * ms * cant, lim.ini, lim.fin - MIN_DUR);
  };

  if (rol === 'bateria') {
    for (const n of ns) {
      const fantasma = n.articulacion === 'fantasma' || (n.pitch === GM_CAJA && n.velocidad < 45);
      let d: number;
      if (n.pitch === GM_BOMBO) d = clamp(rng.gauss() * 2.5, -4, 4);
      else if (n.pitch === GM_CAJA) d = clamp((fantasma ? 4 : 3.5) + rng.gauss() * 2.5, -1, 9);
      else if (GM_HH.includes(n.pitch)) d = clamp(1 + rng.gauss() * 3, -4, 6);
      else d = clamp(rng.gauss() * 3, -5, 5);
      colocar(n, d);
    }
    return;
  }

  if (rol === 'bajo') {
    for (const n of ns) colocar(n, clamp(5 + rng.gauss() * 3, -1, 11)); // en el bolsillo: algo atrás
    return;
  }

  if (rol === 'piano' || rol === 'guitarra' || rol === 'melodia') {
    const deriva = crearDeriva(rng, rol === 'guitarra' ? 8 : 9);
    const grupos = clusters(ns, 0.1);
    let abajo = rng.prob(0.7);
    for (const g of grupos) {
      const t0 = g[0]!._orig;
      const baseMs = clamp(deriva(t0) + rng.gauss() * 4.5, -14, 14);
      const ord = [...g].sort((a, b) => a.pitch - b.pitch);
      if (g.length >= 3 && rol !== 'melodia') {
        // piano: roll corto casi siempre hacia arriba; guitarra: rasgueo 15-40 ms alterno abajo/arriba
        const total = rol === 'guitarra' ? rng.rango(15, 40) : rng.rango(6, 14);
        const sube = rol === 'guitarra' ? abajo : rng.prob(0.8);
        if (rol === 'guitarra') abajo = !abajo;
        const paso = total / (ord.length - 1);
        const seq = sube ? ord : [...ord].reverse();
        seq.forEach((n, k) => colocar(n, baseMs + k * paso));
        // la voz superior (melodía) del piano canta un poco por delante del acompañamiento
        if (rol === 'piano') colocar(ord[ord.length - 1]!, clamp(baseMs - 3 + rng.gauss() * 1.5, -14, 14));
      } else if (rol === 'piano' && g.length === 2) {
        // dos voces simultáneas (p. ej. melodía + acompañamiento): la voz superior se adelanta un poco
        const [bajoN, altoN] = ord as [W, W];
        colocar(bajoN, baseMs + 5);
        colocar(altoN, baseMs - 2);
      } else {
        g.forEach((n) => colocar(n, baseMs + rng.gauss() * 1.5));
      }
    }
    return;
  }

  // cuerdas / pad: entradas escalonadas por voz, siempre «tarde» (el swell del ataque lento)
  const grupos = clusters(ns, 0.12);
  for (const g of grupos) {
    const base = clamp(18 + rng.gauss() * 14, -4, 50);
    const orden = rng.barajar(g);
    orden.forEach((n, k) => colocar(n, clamp(base + k * rng.rango(8, 22), -4, 80)));
  }
}

// ═══ VELOCIDAD ═════════════════════════════════════════════════════════════════════════

function aplicarVelocidad<W extends NotaExpresiva & { _orig: number }>(
  rol: RolWorship,
  ns: W[],
  rng: Rng,
  secciones: SeccionExpresiva[],
  idxSeccion: (t: number) => number,
  intensidadEn: (t: number) => number,
  bpc: number,
  cant: number,
): void {
  const sdJitter = rol === 'bateria' ? 3.5 : rol === 'pad' || rol === 'cuerdas' ? 2 : 3;
  const pesoAcento = rol === 'pad' || rol === 'cuerdas' ? 0 : rol === 'bateria' ? 0.6 : 1;

  // sombreado de voces dentro de cada acorde
  const ajusteVoz = new Map<W, number>();
  if (rol === 'piano' || rol === 'guitarra' || rol === 'cuerdas') {
    for (const g of clusters(ns, 0.1)) {
      if (g.length < 3) continue;
      const ord = [...g].sort((a, b) => a.pitch - b.pitch);
      ord.forEach((n, k) => {
        if (rol === 'piano') ajusteVoz.set(n, k === ord.length - 1 ? 3 : k === 0 ? 1 : -3);
        else if (rol === 'guitarra') ajusteVoz.set(n, 3 - (k * 6) / Math.max(1, ord.length - 1));
        else ajusteVoz.set(n, k === ord.length - 1 ? 2 : -1);
      });
    }
  }

  for (const n of ns) {
    const s = secciones[idxSeccion(n._orig)];
    const t = n._orig;
    const prog = s ? clamp((t - s.inicioBeat) / Math.max(1e-6, s.duracionBeats), 0, 1) : 0;
    const iLocal = intensidadEn(t);
    // balance dinámico: el estribillo (intensidad alta) suena más fuerte que el verso
    let dyn = (iLocal - 0.55) * 16;
    // la sección que sube hace crescendo hacia su final (pre-coro, puente)
    if (s && (s.intensidadInicial ?? s.intensidad) < s.intensidad - 0.05) dyn += prog * prog * 8;
    // arco de frase de 4 compases: arranca más suave, culmina a mitad y relaja al final
    const compasRel = s ? (t - s.inicioBeat) / bpc : t / bpc;
    const frase = (compasRel % 4) / 4;
    const arco = 4 * Math.sin(Math.PI * frase) - 1.5;
    // acentos métricos
    const enCompas = ((t % bpc) + bpc) % bpc;
    const enBeat = enCompas % 1;
    let acento = 0;
    if (Math.abs(enCompas) < 0.1) acento = 5;
    else if (bpc >= 4 && Math.abs(enCompas - 2) < 0.1) acento = 2.5;
    else if (enBeat < 0.1) acento = 1;
    else if (Math.abs(enBeat - 0.5) < 0.1) acento = -2;
    else acento = -3.5;
    acento *= pesoAcento;

    let v = n.velocidad + cant * (dyn + arco + acento + (ajusteVoz.get(n) ?? 0));
    if (rol === 'bateria' && GM_HH.includes(n.pitch)) {
      // hi-hat: golpe en el tiempo > 8vo contratiempo > 16avo
      v += cant * (enBeat < 0.1 ? 6 : Math.abs(enBeat - 0.5) < 0.1 ? -2 : -7);
    }
    const jitter = clamp(rng.gauss() * sdJitter, -8, 8) * cant;
    v += jitter;
    const fantasma = rol === 'bateria' && (n.articulacion === 'fantasma' || (n.pitch === GM_CAJA && n.velocidad < 45));
    // limitador suave: por encima de 108 la velocidad se comprime (evita golpes de piano/bajo estridentes)
    if (!fantasma && rol !== 'bateria' && v > 108) v = 108 + (v - 108) * 0.4;
    n.velocidad = Math.round(fantasma ? clamp(v, 14, 44) : clamp(v, 1, 127));
  }
}

// ═══ DURACIÓN ═════════════════════════════════════════════════════════════════════════

function aplicarDuracion<W extends NotaExpresiva & { _orig: number }>(
  rol: RolWorship,
  ns: W[],
  rng: Rng,
  secciones: SeccionExpresiva[],
  idxSeccion: (t: number) => number,
  limites: (t: number) => { ini: number; fin: number },
  bpc: number,
  solapeBajo: number,
  cambios: number[],
): void {
  if (rol === 'bateria') return; // golpes de una sola emisión: duración irrelevante

  const ord = [...ns].sort((a, b) => a.inicio - b.inicio);
  const siguienteEn = (n: W, filtro: (m: W) => boolean): W | undefined => {
    const i = ord.indexOf(n);
    for (let k = i + 1; k < ord.length; k++) {
      const m = ord[k]!;
      if (m.inicio > n.inicio + 1e-4 && filtro(m)) return m;
    }
    return undefined;
  };

  // final de frase (cada 4 compases desde el inicio de la sección) para respirar
  const finDeFrase = (n: W): number | undefined => {
    const s = secciones[idxSeccion(n._orig)];
    if (!s) return undefined;
    const rel = n.inicio - s.inicioBeat;
    const pf = Math.floor(rel / (4 * bpc + 1e-6)) + 1;
    const fin = s.inicioBeat + pf * 4 * bpc;
    return fin <= s.inicioBeat + s.duracionBeats + 1e-6 ? fin : undefined;
  };

  for (const n of ord) {
    const d0 = n.duracion;
    // una nota ligada por encima de un cambio de acorde (p. ej. anticipación del bajo) no se acorta
    const cruza = cambios.some((c) => c > n.inicio + 0.1 && c < n.inicio + d0 - 0.05);
    const lim = limites(n._orig);
    let dur = d0;
    if (rol === 'piano') {
      dur = d0 * (d0 <= 1.1 ? rng.rango(0.85, 1.08) : rng.rango(0.93, 1.02));
    } else if (rol === 'guitarra') {
      dur = d0 * rng.rango(0.9, 1.05);
    } else if (rol === 'melodia') {
      dur = d0 * rng.rango(0.9, 1.0);
    } else if (rol === 'bajo') {
      dur = d0 * rng.rango(0.88, 1.0);
      const sig = siguienteEn(n, () => true);
      if (sig && sig.inicio - (n.inicio + dur) < 0.35 && sig.inicio - n.inicio < 2.2) {
        // legato: llega hasta la siguiente con un solape mínimo (nunca con el mismo pitch)
        dur = sig.pitch === n.pitch ? sig.inicio - n.inicio - 0.04 : sig.inicio - n.inicio + rng.rango(0.01, solapeBajo * 0.9);
      }
    } else {
      // cuerdas / pad: cada voz cae en un momento algo distinto y se funde con el acorde siguiente
      dur = d0 + rng.rango(-0.06, 0.12);
      if (rol === 'pad') dur = d0 + rng.rango(-0.05, 0.1);
      const sig = siguienteEn(n, (m) => m.pitch !== n.pitch);
      if (sig && Math.abs(n.inicio + dur - sig.inicio) < 0.5) dur = Math.min(dur, sig.inicio - n.inicio + rng.rango(0.04, 0.16));
    }

    // respiración al cierre de frase (nunca en las notas largas del colchón)
    if (cruza && rol === 'bajo') dur = Math.max(dur, d0);
    if (!cruza && (rol === 'piano' || rol === 'guitarra' || rol === 'bajo' || rol === 'melodia') && dur >= 0.5 && dur <= 4.5) {
      const ff = finDeFrase(n);
      if (ff !== undefined && n.inicio < ff - 0.4 && n.inicio + dur > ff - 0.05 && rng.prob(0.65)) {
        dur = Math.min(dur, ff - rng.rango(0.12, 0.3) - n.inicio);
      }
    }
    n.duracion = Math.max(MIN_DUR, Math.min(dur, lim.fin - n.inicio));
  }
}

/** Limpieza final: dentro del clip, mismo pitch sin solapar, bajo monofónico. */
function sanear<W extends NotaExpresiva & { _orig: number }>(
  rol: RolWorship,
  ns: W[],
  limites: (t: number) => { ini: number; fin: number },
  solapeBajo: number,
): void {
  for (const n of ns) {
    const lim = limites(n._orig);
    n.inicio = clamp(n.inicio, lim.ini, lim.fin - MIN_DUR);
    n.duracion = Math.max(MIN_DUR, Math.min(n.duracion, lim.fin - n.inicio));
    n.velocidad = Math.round(clamp(n.velocidad, 1, 127));
  }
  const ord = [...ns].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch);
  // mismo pitch
  const porPitch = new Map<number, W[]>();
  for (const n of ord) {
    const l = porPitch.get(n.pitch) ?? [];
    l.push(n);
    porPitch.set(n.pitch, l);
  }
  for (const lista of porPitch.values()) {
    for (let i = 0; i < lista.length - 1; i++) {
      const a = lista[i]!;
      const b = lista[i + 1]!;
      const tope = b.inicio - HUECO_MISMO_PITCH;
      if (a.inicio + a.duracion > tope) {
        if (tope - a.inicio >= PISO_DUR) a.duracion = tope - a.inicio;
        else {
          // no cabe ni la nota mínima: se retrasa un instante la siguiente (sin salir del clip)
          a.duracion = PISO_DUR;
          const lim = limites(b._orig);
          b.inicio = Math.min(a.inicio + PISO_DUR + HUECO_MISMO_PITCH, lim.fin - PISO_DUR);
          b.duracion = Math.max(PISO_DUR, Math.min(b.duracion, lim.fin - b.inicio));
        }
      }
    }
  }
  if (rol === 'bajo' || rol === 'melodia') {
    const tolerancia = rol === 'bajo' ? solapeBajo : 0;
    ord.sort((x, y) => x.inicio - y.inicio || x.pitch - y.pitch);
    for (let i = 0; i < ord.length - 1; i++) {
      const a = ord[i]!;
      const b = ord[i + 1]!;
      if (b.inicio - a.inicio < PISO_DUR + 0.004) b.inicio = Math.min(a.inicio + PISO_DUR + 0.004, limites(b._orig).fin - PISO_DUR);
      const tope = b.inicio + tolerancia - (tolerancia === 0 ? 0.003 : 0);
      if (a.inicio + a.duracion > tope) a.duracion = Math.max(PISO_DUR, tope - a.inicio);
    }
  }
}

// ═══ ADICIONES ═════════════════════════════════════════════════════════════════════════

function anadirBateria<W extends NotaExpresiva & { _orig: number }>(
  ns: W[],
  secciones: SeccionExpresiva[],
  bpc: number,
  rng: Rng,
  intensidadEn: (t: number) => number,
): void {
  const nueva = (pitch: number, t: number, dur: number, vel: number, articulacion?: string): W =>
    ({ pitch, inicio: t, duracion: dur, velocidad: vel, _orig: t, ...(articulacion ? { articulacion } : {}) }) as W;
  const base = [...ns];
  const nuevas: W[] = [];

  secciones.forEach((s, i) => {
    const enSec = base.filter((n) => n._orig >= s.inicioBeat - 1e-6 && n._orig < s.inicioBeat + s.duracionBeats - 1e-6);
    if (enSec.length === 0) return;
    const compases = Math.round(s.duracionBeats / bpc);

    // crash al subir de sección (si no hay ya un plato en la entrada)
    const previa = secciones[i - 1];
    if (previa && (s.intensidadInicial ?? s.intensidad) - previa.intensidad >= 0.08 && s.intensidad >= 0.5) {
      const hayPlato = base.some((n) => GM_CRASH.includes(n.pitch) && Math.abs(n._orig - s.inicioBeat - 0.1) < 0.4);
      if (!hayPlato) {
        nuevas.push(nueva(49, s.inicioBeat, 3, Math.round(88 + 22 * s.intensidad)));
        if (!base.some((n) => n.pitch === GM_BOMBO && Math.abs(n._orig - s.inicioBeat) < 0.15)) nuevas.push(nueva(GM_BOMBO, s.inicioBeat, 0.4, Math.round(80 + 20 * s.intensidad)));
      }
    }

    // notas fantasma de caja (en las «e»/«a» antes del contratiempo) cuando el groove lo permite
    for (let b = 0; b < compases; b++) {
      const t0 = s.inicioBeat + b * bpc;
      const inten = intensidadEn(t0);
      if (inten < 0.4 || bpc < 4) continue;
      const cajasCompas = enSec.filter((n) => n.pitch === GM_CAJA && n._orig >= t0 - 1e-6 && n._orig < t0 + bpc - 1e-6);
      if (cajasCompas.length === 0 || cajasCompas.some((n) => n.velocidad < 45)) continue;
      if (!rng.prob(0.4)) continue;
      const pos = rng.pick([0.75, 1.75, 2.75, 3.25, 3.75]);
      const t = t0 + pos;
      if (cajasCompas.some((n) => Math.abs(n._orig - t) < 0.3)) continue;
      nuevas.push(nueva(GM_CAJA, t, 0.12, Math.round(rng.rango(20, 34)), 'fantasma'));
    }

    // pickup de fill al final de sección si el último compás no tiene caja/toms en su segunda mitad
    if (compases >= 2 && i < secciones.length - 1) {
      const t0 = s.inicioBeat + (compases - 1) * bpc;
      const segunda = enSec.filter((n) => n._orig >= t0 + bpc / 2 && (n.pitch === GM_CAJA || GM_TOMS.includes(n.pitch)) && n.velocidad >= 45);
      const siguiente = secciones[i + 1]!;
      if (segunda.length === 0 && siguiente.intensidad >= s.intensidad - 0.01 && s.intensidad >= 0.45 && enSec.some((n) => n.pitch === GM_CAJA)) {
        const v = 48 + 20 * s.intensidad;
        nuevas.push(nueva(GM_CAJA, t0 + bpc - 0.5, 0.2, Math.round(v)));
        nuevas.push(nueva(GM_CAJA, t0 + bpc - 0.25, 0.2, Math.round(v + 14)));
      }
    }
  });
  ns.push(...nuevas);
}

/** Anticipa con una corchea la raíz del acorde siguiente cuando el bajo sostiene toda la medida. */
function anadirAnticipacionesBajo<W extends NotaExpresiva & { _orig: number }>(
  ns: W[],
  cambios: number[],
  limites: (t: number) => { ini: number; fin: number },
  idxSeccion: (t: number) => number,
  rng: Rng,
  intensidadEn: (t: number) => number,
): void {
  const ord = [...ns].sort((a, b) => a._orig - b._orig);
  const nuevas: W[] = [];
  for (const c of cambios) {
    const tAnt = c - 0.5;
    if (tAnt <= 0) continue;
    const sec = idxSeccion(tAnt);
    if (idxSeccion(c - 1e-6) !== sec) { /* el cambio es el inicio de otra sección: se anticipa dentro de la anterior */ }
    const lim = limites(tAnt);
    if (tAnt < lim.ini + 1.5) continue;
    if (intensidadEn(tAnt) < 0.5) continue;
    const previas = ord.filter((n) => n._orig < tAnt - 0.05 && n._orig >= tAnt - 4);
    const prev = previas[previas.length - 1];
    if (!prev || idxSeccion(prev._orig) !== sec) continue;
    if (ord.some((n) => n._orig > c - 0.9 && n._orig < c - 0.1)) continue;
    const sig = ord.find((n) => n._orig >= c - 0.06 && n._orig < c + 0.3);
    if (!sig || sig.pitch % 12 === prev.pitch % 12 || idxSeccion(sig._orig) !== idxSeccion(c)) continue;
    if (!rng.prob(0.55)) continue;
    // octava más cercana a la nota anterior dentro del rango del bajo
    let p = sig.pitch;
    while (p - prev.pitch > 6 && p - 12 >= 33) p -= 12;
    while (prev.pitch - p > 6 && p + 12 <= 55) p += 12;
    nuevas.push({ pitch: p, inicio: tAnt, duracion: 0.42, velocidad: Math.max(30, prev.velocidad - 8), _orig: tAnt } as W);
    if (prev._orig + prev.duracion > tAnt - 0.02) prev.duracion = Math.max(MIN_DUR, tAnt - prev._orig - 0.02);
  }
  ns.push(...nuevas);
}

// ═══ CONTROLADORES ═══════════════════════════════════════════════════════════════════════

/** CC64: pedal que se levanta justo antes de cada cambio y vuelve a bajar poco después; medio pedal en pasajes suaves. */
function pedalPiano<W extends NotaExpresiva & { _orig: number }>(
  ns: W[],
  secciones: SeccionExpresiva[],
  cambios: number[],
  limites: (t: number) => { ini: number; fin: number },
  idxSeccion: (t: number) => number,
  intensidadEn: (t: number) => number,
  rng: Rng,
  clipPorSeccion: boolean,
): EventoCC[] {
  const ev: EventoCC[] = [];
  const tieneNotas = (a: number, b: number) => ns.some((n) => n.inicio >= a - 1e-6 && n.inicio < b - 1e-6);
  const nivel = (t: number): number => {
    const i = intensidadEn(t);
    const v = i >= 0.75 ? 1 : i >= 0.5 ? rng.rango(0.8, 0.95) : rng.rango(0.55, 0.78);
    return r5(v);
  };
  const secs = clipPorSeccion && secciones.length > 0 ? secciones : [{ inicioBeat: 0, duracionBeats: secciones.reduce((m, s) => Math.max(m, s.inicioBeat + s.duracionBeats), 0), intensidad: 0.5 }];
  for (const s of secs) {
    const a = s.inicioBeat;
    const b = s.inicioBeat + s.duracionBeats;
    if (!tieneNotas(a, b)) continue;
    const puntos = [a, ...cambios.filter((c) => c > a + 0.5 && c < b - 0.25)];
    puntos.forEach((c, k) => {
      if (k > 0) ev.push({ cc: 64, tiempo: r5(c - rng.rango(0.03, 0.07)), valor: 0 });
      ev.push({ cc: 64, tiempo: r5(Math.max(a, c) + (k === 0 ? 0.02 : rng.rango(0.04, 0.1))), valor: nivel(c) });
    });
    ev.push({ cc: 64, tiempo: r5(b - 0.04), valor: 0 });
  }
  void limites;
  void idxSeccion;
  return ev.sort((x, y) => x.tiempo - y.tiempo);
}

/** CC11: swell por acorde (sube hacia la mitad y se asienta), un punto por pulso. */
function expresionSostenida<W extends NotaExpresiva & { _orig: number }>(
  ns: W[],
  cambios: number[],
  intensidadEn: (t: number) => number,
  limites: (t: number) => { ini: number; fin: number },
  rng: Rng,
  extra: number,
): EventoCC[] {
  const ev: EventoCC[] = [];
  const ord = [...ns].sort((a, b) => a.inicio - b.inicio);
  if (ord.length === 0) return ev;
  const ultimo = Math.max(...ord.map((n) => n.inicio + n.duracion));
  for (let i = 0; i < cambios.length; i++) {
    const c = cambios[i]!;
    const fin = Math.min(cambios[i + 1] ?? c + 4, ultimo);
    if (c >= ultimo) break;
    const lim = limites(c);
    if (!ord.some((n) => n.inicio < fin && n.inicio + n.duracion > c)) continue;
    const base = 0.6 + 0.25 * intensidadEn(c) + extra;
    const pico = base + rng.rango(0.08, 0.15);
    const largo = Math.max(1, fin - c);
    for (let t = c; t < fin - 1e-6; t += 1) {
      const p = (t - c) / largo;
      const forma = p < 0.6 ? Math.sin((p / 0.6) * (Math.PI / 2)) : 1 - 0.3 * ((p - 0.6) / 0.4);
      ev.push({ cc: 11, tiempo: r5(clamp(t, lim.ini, lim.fin - 0.05)), valor: r5(clamp(lerp(base, pico, forma), 0.05, 1)) });
    }
  }
  return ev.sort((x, y) => x.tiempo - y.tiempo);
}
