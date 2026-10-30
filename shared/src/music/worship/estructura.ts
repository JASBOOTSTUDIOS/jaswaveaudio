/**
 * Forma de la canción, intensidad dinámica por sección, matriz de orquestación con entradas
 * escalonadas y línea de tiempo de acordes. Construye el contexto compartido por los generadores.
 */

import {
  CIERRES_FINALES,
  PROGRESIONES_BASE,
  TURNAROUNDS,
  construirAcorde,
  crearTonal,
  parsearAcorde,
  variarToken,
  type Acorde,
  type Tonal,
} from './armonia';
import { clamp, crearRng, hashSemilla, type Rng } from './prng';
import {
  ROLES_WORSHIP,
  type CompasWorship,
  type EstiloWorship,
  type RolWorship,
  type SeccionArreglo,
  type SpecSeccionWorship,
  type SpecWorship,
  type TipoSeccionWorship,
} from './tipos';

export interface EventoAcorde {
  acorde: Acorde;
  inicio: number;
  fin: number;
  seccion: number;
  /** Compás global (0-based) en que empieza. */
  compas: number;
  idx: number;
}

export interface SeccionInt extends SeccionArreglo {
  eventos: EventoAcorde[];
}

export interface Ctx {
  semilla: number;
  bpm: number;
  compasNombre: CompasWorship;
  /** Beats (negras) por compás: 4 para 4/4, 3 para 6/8. */
  bpc: number;
  /** Corcheas por compás: 8 o 6. */
  cpc: number;
  tonal: Tonal;
  humanizacion: number;
  estilo: EstiloWorship;
  rubato: boolean;
  titulo: string;
  secciones: SeccionInt[];
  eventos: EventoAcorde[];
  totalCompases: number;
  totalBeats: number;
  rolesPermitidos: Set<RolWorship>;
  rng(clave: string): Rng;
  seccionDeCompas(compas: number): SeccionInt;
  eventoEn(beat: number): EventoAcorde;
  /** Siguiente evento de acorde con distinto acorde (o undefined). */
  siguienteEvento(e: EventoAcorde): EventoAcorde | undefined;
  /** Rol tocando en el compás local b de la sección. */
  activo(sec: SeccionInt, rol: RolWorship, b: number): boolean;
  /** Intensidad del compás global. */
  intensidadEn(compas: number): number;
}

export const FORMA_DEFECTO: SpecSeccionWorship[] = [
  { tipo: 'intro', compases: 4 },
  { tipo: 'verso', compases: 8 },
  { tipo: 'precoro', compases: 4 },
  { tipo: 'coro', compases: 8 },
  { tipo: 'verso', compases: 8 },
  { tipo: 'precoro', compases: 4 },
  { tipo: 'coro', compases: 8 },
  { tipo: 'puente', compases: 8 },
  { tipo: 'coroFinal', compases: 16 },
  { tipo: 'outro', compases: 4 },
];

const TIPOS_VALIDOS: TipoSeccionWorship[] = ['intro', 'verso', 'precoro', 'coro', 'puente', 'coroFinal', 'outro'];

/** Arco de intensidad [inicio, fin] por tipo y repetición. */
function arcoIntensidad(tipo: TipoSeccionWorship, rep: number): [number, number] {
  switch (tipo) {
    case 'intro': return [0.2, 0.3];
    case 'verso': return rep === 0 ? [0.35, 0.5] : [0.42, 0.52];
    case 'precoro': return rep === 0 ? [0.52, 0.7] : [0.58, 0.74];
    case 'coro': return rep === 0 ? [0.78, 0.84] : [0.84, 0.9];
    case 'puente': return [0.55, 1.0];
    case 'coroFinal': return [0.95, 1.0];
    case 'outro': return [0.25, 0.12];
  }
}

function nombreSeccion(tipo: TipoSeccionWorship, rep: number, total: number): string {
  const n = total > 1 ? ` ${rep + 1}` : '';
  switch (tipo) {
    case 'intro': return 'Intro';
    case 'verso': return `Verso ${rep + 1}`;
    case 'precoro': return `Pre-coro ${rep + 1}`;
    case 'coro': return `Coro ${rep + 1}`;
    case 'puente': return `Puente${n}`;
    case 'coroFinal': return `Coro final${n}`;
    case 'outro': return 'Outro';
  }
}

function entradasBase(tipo: TipoSeccionWorship, rep: number, c: number, intensidad: number, estilo: EstiloWorship, rng: Rng): Partial<Record<RolWorship, number>> {
  const mitad = Math.floor(c / 2);
  const cuarto = Math.floor(c / 4);
  const e: Partial<Record<RolWorship, number>> = {};
  switch (tipo) {
    case 'intro': {
      const par = rng.pick<[RolWorship, RolWorship]>([['piano', 'pad'], ['pad', 'guitarra'], ['piano', 'guitarra'], ['pad', 'piano']]);
      e[par[0]] = 0;
      e[par[1]] = mitad;
      break;
    }
    case 'verso':
      e.piano = 0;
      e.melodia = 0;
      if (rep === 0) {
        e.pad = cuarto;
        e.bajo = mitad;
        if (estilo !== 'ambient') e.bateria = mitad;
      } else {
        e.pad = 0;
        e.guitarra = 0;
        e.bajo = 0;
        e.bateria = 0;
      }
      if (intensidad >= 0.55) e.cuerdas = rep === 0 ? mitad : cuarto;
      break;
    case 'precoro':
      e.piano = 0;
      e.melodia = 0;
      e.pad = 0;
      e.bajo = 0;
      e.bateria = 0;
      e.cuerdas = rep === 0 ? Math.min(2, mitad) : 0;
      if (rep > 0) e.guitarra = 0;
      break;
    case 'coro':
      for (const r of ROLES_WORSHIP) e[r] = 0;
      if (rep === 0) e.guitarra = mitad;
      break;
    case 'puente':
      e.piano = 0;
      e.pad = 0;
      e.cuerdas = 0;
      e.bateria = 0;
      e.guitarra = 0;
      e.bajo = cuarto;
      e.melodia = mitad;
      break;
    case 'coroFinal':
      for (const r of ROLES_WORSHIP) e[r] = 0;
      break;
    case 'outro':
      e.piano = 0;
      e.pad = 0;
      e.guitarra = Math.min(1, c - 1);
      break;
  }
  return e;
}

const UMBRAL_ROL: Partial<Record<RolWorship, number>> = { bateria: 0.3, bajo: 0.25, guitarra: 0.2, cuerdas: 0.45 };

interface ElementoLayout {
  token: string;
  ini: number;
  dur: number;
}

function disponerTokens(tokens: string[], compases: number, bpc: number, barrasPorAcorde: number): ElementoLayout[] {
  const N = tokens.length;
  const res: ElementoLayout[] = [];
  const total = compases * bpc;
  if (N >= compases && barrasPorAcorde === 1) {
    // N acordes repartidos en los compases (N==compases → 1 por compás; N>compases → varios por compás)
    for (let i = 0; i < N; i++) {
      const ini = Math.round(((i * total) / N) * 2) / 2;
      const fin = Math.round((((i + 1) * total) / N) * 2) / 2;
      if (fin > ini) res.push({ token: tokens[i]!, ini, dur: fin - ini });
    }
    return res;
  }
  const paso = bpc * barrasPorAcorde;
  let k = 0;
  for (let ini = 0; ini < total; ini += paso) {
    res.push({ token: tokens[k % N]!, ini, dur: Math.min(paso, total - ini) });
    k++;
  }
  return res;
}

interface EstadoProg {
  base: Partial<Record<TipoSeccionWorship, string[]>>;
  ultimoTurn: Partial<Record<TipoSeccionWorship, string>>;
}

function construirLayoutSeccion(
  sec: SpecSeccionWorship,
  rep: number,
  esUltima: boolean,
  bpc: number,
  estilo: EstiloWorship,
  rng: Rng,
  est: EstadoProg,
): ElementoLayout[] {
  const c = sec.compases;
  if (sec.progresion && sec.progresion.length > 0) {
    return disponerTokens(sec.progresion, c, bpc, 1);
  }
  let base = est.base[sec.tipo];
  if (!base) {
    const lista = PROGRESIONES_BASE[sec.tipo];
    let idx = rng.int(0, lista.length - 1);
    if (sec.tipo === 'precoro' && rng.prob(0.6)) idx = 1; // pedal de tónica
    base = lista[idx]!;
    est.base[sec.tipo] = base;
  }
  const tokens = rep === 0 ? base : base.map((t) => variarToken(t, () => rng.next()));
  const lento = (sec.tipo === 'intro' || sec.tipo === 'outro') && c >= 4 && (estilo === 'ambient' || rng.prob(0.4));
  let layout = disponerTokens(tokens, c, bpc, lento ? 2 : 1);

  // Turnaround al final de cada bloque de 8 compases y al final de la sección.
  const finales: number[] = [];
  for (let b = 8; b < c; b += 8) finales.push(b - 1);
  finales.push(c - 1);
  for (const bar of finales) {
    const esFinSeccion = bar === c - 1;
    if (sec.tipo === 'outro' && esFinSeccion) continue;
    let opciones: string[][];
    if (esFinSeccion && esUltima) opciones = CIERRES_FINALES;
    else opciones = TURNAROUNDS[sec.tipo];
    const ultimo = est.ultimoTurn[sec.tipo];
    const cand = opciones.filter((o) => o.join(',') !== ultimo);
    const elegido = rng.pick(cand.length > 0 ? cand : opciones);
    est.ultimoTurn[sec.tipo] = elegido.join(',');
    const ini0 = bar * bpc;
    const fin0 = ini0 + bpc;
    const nuevo: ElementoLayout[] = [];
    for (const e of layout) {
      const eFin = e.ini + e.dur;
      if (eFin <= ini0 + 1e-9 || e.ini >= fin0 - 1e-9) {
        nuevo.push(e);
        continue;
      }
      if (e.ini < ini0 - 1e-9) nuevo.push({ ...e, dur: ini0 - e.ini });
      if (eFin > fin0 + 1e-9) nuevo.push({ ...e, ini: fin0, dur: eFin - fin0 });
    }
    const parte = bpc / elegido.length;
    elegido.forEach((t, i) => nuevo.push({ token: t, ini: ini0 + i * parte, dur: parte }));
    nuevo.sort((x, y) => x.ini - y.ini);
    layout = nuevo;
  }
  return layout;
}

export function construirContexto(spec: SpecWorship): Ctx {
  if (!Number.isFinite(spec.semilla)) throw new Error('SpecWorship.semilla debe ser un número');
  const semilla = spec.semilla >>> 0;
  const rngEst = crearRng(hashSemilla(semilla, 'estructura'));
  const compasNombre: CompasWorship = spec.compas ?? '4/4';
  if (compasNombre !== '4/4' && compasNombre !== '6/8') throw new Error(`Compás no soportado: ${String(compasNombre)}`);
  const bpc = compasNombre === '4/4' ? 4 : 3;
  const bpmElegido = rngEst.int(68, 76); // siempre se consume para que bpm explícito no desplace el flujo
  const bpm = clamp(spec.bpm ?? bpmElegido, 40, 200);
  const tonal = crearTonal(spec.tonalidad?.raiz ?? 'D', spec.tonalidad?.escala ?? 'mayor');
  const humanizacion = clamp(spec.humanizacion ?? 0.65, 0, 1);
  const estilo: EstiloWorship = spec.estilo ?? 'ballad';
  const offsetEstilo = estilo === 'anthem' ? 0.08 : estilo === 'ambient' ? -0.08 : 0;
  const rolesPermitidos = new Set<RolWorship>(spec.roles ?? ROLES_WORSHIP);

  const forma = spec.secciones && spec.secciones.length > 0 ? spec.secciones : FORMA_DEFECTO;
  for (const s of forma) {
    if (!TIPOS_VALIDOS.includes(s.tipo)) throw new Error(`Tipo de sección inválido: ${String(s.tipo)}`);
    if (!Number.isInteger(s.compases) || s.compases < 1 || s.compases > 64) throw new Error(`Compases inválidos en ${s.tipo}: ${s.compases}`);
  }
  const totalPorTipo: Record<string, number> = {};
  for (const s of forma) totalPorTipo[s.tipo] = (totalPorTipo[s.tipo] ?? 0) + 1;
  const contadorTipo: Record<string, number> = {};

  const estProg: EstadoProg = { base: {}, ultimoTurn: {} };
  const secciones: SeccionInt[] = [];
  const eventos: EventoAcorde[] = [];
  let inicioCompas = 0;

  forma.forEach((s, indice) => {
    const rep = contadorTipo[s.tipo] ?? 0;
    contadorTipo[s.tipo] = rep + 1;
    const esUltima = indice === forma.length - 1;
    const [ini0, fin0] = arcoIntensidad(s.tipo, rep);
    const sube = s.tipo === 'puente' || s.tipo === 'coroFinal' ? 0 : offsetEstilo;
    let fin = clamp(fin0 + sube, 0, 1);
    let ini = clamp(ini0 + sube, 0, 1);
    if (s.intensidad !== undefined) {
      fin = clamp(s.intensidad, 0, 1);
      ini = clamp(fin - (fin0 - ini0), 0, 1);
    }
    const intensidadPorCompas: number[] = [];
    for (let b = 0; b < s.compases; b++) {
      intensidadPorCompas.push(round3(s.compases === 1 ? fin : ini + ((fin - ini) * b) / (s.compases - 1)));
    }
    const entradasRaw = entradasBase(s.tipo, rep, s.compases, fin, estilo, rngEst);
    const entradas: Partial<Record<RolWorship, number>> = {};
    for (const r of ROLES_WORSHIP) {
      const e = entradasRaw[r];
      if (e === undefined || !rolesPermitidos.has(r)) continue;
      const u = UMBRAL_ROL[r];
      if (u !== undefined && fin < u && s.tipo !== 'intro' && s.tipo !== 'outro') continue;
      entradas[r] = Math.min(e, s.compases - 1);
    }
    const roles = ROLES_WORSHIP.filter((r) => entradas[r] !== undefined);

    const layout = construirLayoutSeccion(s, rep, esUltima, bpc, estilo, rngEst, estProg);
    const inicioBeat = inicioCompas * bpc;
    const evs: EventoAcorde[] = layout.map((l) => {
      const acorde = construirAcorde(tonal, parsearAcorde(l.token, tonal));
      const e: EventoAcorde = {
        acorde,
        inicio: inicioBeat + l.ini,
        fin: inicioBeat + l.ini + l.dur,
        seccion: indice,
        compas: inicioCompas + Math.floor(l.ini / bpc + 1e-9),
        idx: eventos.length,
      };
      eventos.push(e);
      return e;
    });
    secciones.push({
      tipo: s.tipo,
      nombre: nombreSeccion(s.tipo, rep, totalPorTipo[s.tipo]!),
      indice,
      repeticion: rep,
      inicioCompas,
      compases: s.compases,
      inicioBeat,
      duracionBeats: s.compases * bpc,
      intensidad: round3(fin),
      intensidadInicial: round3(ini),
      intensidadPorCompas,
      roles,
      entradas,
      eventos: evs,
    });
    inicioCompas += s.compases;
  });

  const totalCompases = inicioCompas;
  const porCompas: SeccionInt[] = [];
  for (const s of secciones) for (let b = 0; b < s.compases; b++) porCompas.push(s);

  const ctx: Ctx = {
    semilla,
    bpm,
    compasNombre,
    bpc,
    cpc: compasNombre === '4/4' ? 8 : 6,
    tonal,
    humanizacion,
    estilo,
    rubato: spec.rubato ?? true,
    titulo: spec.titulo ?? `Worship en ${tonal.raiz} ${tonal.escalaNombre}`,
    secciones,
    eventos,
    totalCompases,
    totalBeats: totalCompases * bpc,
    rolesPermitidos,
    rng: (clave) => crearRng(hashSemilla(semilla, clave)),
    seccionDeCompas: (c) => porCompas[clamp(c, 0, totalCompases - 1)]!,
    eventoEn: (beat) => {
      let lo = 0;
      let hi = eventos.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (eventos[m]!.inicio <= beat + 1e-9) lo = m;
        else hi = m - 1;
      }
      return eventos[lo]!;
    },
    siguienteEvento: (e) => eventos[e.idx + 1],
    activo: (sec, rol, b) => {
      const e = sec.entradas[rol];
      return e !== undefined && b >= e;
    },
    intensidadEn: (c) => {
      const s = porCompas[clamp(c, 0, totalCompases - 1)]!;
      return s.intensidadPorCompas[clamp(c - s.inicioCompas, 0, s.compases - 1)]!;
    },
  };
  return ctx;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
