/**
 * Acordes cromáticos: parser completo de cifrado americano, nombrador a partir de pitches
 * (inversiones, slash, omisiones y tensiones), voicing y transposición.
 *
 * Complementa a `worship/armonia.ts` (que solo construye acordes diatónicos por grados): aquí
 * cualquier símbolo vale («F#m7b5», «Bb/D», «C7(b9,#11)», «Dmaj7#11», «G13sus4», «E7alt»).
 *
 * Convenciones:
 *   - Intervalos en semitonos sobre la fundamental, sin módulo (9 = 14, 11 = 17, 13 = 21) para que el
 *     voicing conserve el registro natural de las tensiones.
 *   - Los nombres normalizados usan `m`, `maj7`, `dim`, `aug`, `sus2/sus4`, `add9`, `m7b5`, `7b9`…
 */

const NOMBRES_SOSTENIDOS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOMBRES_BEMOLES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Deletreo por defecto de cada pitch class cuando no hay tonalidad: lo más habitual en cifrados. */
const NOMBRES_HABITUALES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_LETRA: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type CalidadAcorde =
  | 'mayor'
  | 'menor'
  | 'disminuido'
  | 'aumentado'
  | 'sus2'
  | 'sus4'
  | 'quinta'
  | 'dominante'
  | 'semidisminuido'
  | 'alterado';

export interface AcordeComplejo {
  /** Nombre normalizado (p. ej. «F#m7b5», «D/F#»). */
  nombre: string;
  /** Fundamental con el deletreo del usuario normalizado («F#», «Bb»). */
  raiz: string;
  raizPc: number;
  calidad: CalidadAcorde;
  /** Séptima y extensiones presentes: «6», «7», «maj7», «9», «11», «13», «add9», «add11», «6/9»… */
  extensiones: string[];
  /** Alteraciones: «b5», «#5», «b9», «#9», «#11», «b13», «alt», «omit3», «omit5». */
  alteraciones: string[];
  /** Nota del bajo si es un acorde con barra («D/F#» → «F#»). */
  bajo?: string;
  bajoPc?: number;
  /** Semitonos sobre la fundamental, ascendentes y únicos (sin módulo; 14 = novena). */
  intervalos: number[];
  /** Pitch classes del acorde (sin el bajo ajeno). */
  pcs: number[];
  /** Pitches MIDI en posición fundamental desde la octava dada (C4 = 60); el bajo ajeno una octava por debajo. */
  pitches: (octava?: number) => number[];
}

export interface OpcionesNombre {
  /** Fuerza deletreo con bemoles (true) o sostenidos (false). Por defecto el habitual (Eb, Bb, Ab, F#, C#). */
  bemoles?: boolean;
}

/** Pitch class (0..11) de un nombre de nota («F#», «Bb», «E♭», «cb»); -1 si no es nota. */
export function pcDeNota(nombre: string): number {
  const m = /^([A-Ga-g])((?:#|♯|b|♭|x){0,2})$/.exec(nombre.trim());
  if (!m) return -1;
  let pc = PC_LETRA[m[1]!.toUpperCase()]!;
  for (const ch of m[2]!) {
    if (ch === '#' || ch === '♯') pc += 1;
    else if (ch === 'x') pc += 2;
    else pc -= 1;
  }
  return ((pc % 12) + 12) % 12;
}

export function nombreDeNota(pc: number, opts?: OpcionesNombre): string {
  const p = ((Math.round(pc) % 12) + 12) % 12;
  if (opts?.bemoles === true) return NOMBRES_BEMOLES[p]!;
  if (opts?.bemoles === false) return NOMBRES_SOSTENIDOS[p]!;
  return NOMBRES_HABITUALES[p]!;
}

/** Normaliza un nombre de nota a letra mayúscula + «#»/«b» (conserva la enarmonía escrita). */
function normalizarNota(nombre: string): string {
  const letra = nombre[0]!.toUpperCase();
  const resto = nombre.slice(1).replace(/♯/g, '#').replace(/♭/g, 'b');
  return letra + resto;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface Construccion {
  calidad: 'mayor' | 'menor' | 'disminuido' | 'aumentado' | 'sus' | 'quinta' | 'alterado';
  /** 3 / 4 / null (sus, power, omit3). */
  tercera: number | null;
  /** Notas sus (2 y/o 5). */
  sus: number[];
  /** 7 / 6 / 8 / null (omit5). */
  quinta: number | null;
  sexta: boolean;
  /** 10 / 11 / 9 / null. */
  septima: number | null;
  /** Tensiones: 13, 14, 15 (novenas), 16, 17, 18 (oncenas), 20, 21, 22 (trecenas). */
  tensiones: Set<number>;
  /** La oncena justa se pidió como «add11» (conserva la tercera). */
  add11: boolean;
  omit3: boolean;
  omit5: boolean;
  extensiones: string[];
  alteraciones: string[];
}

function construccionBase(): Construccion {
  return {
    calidad: 'mayor',
    tercera: 4,
    sus: [],
    quinta: 7,
    sexta: false,
    septima: null,
    tensiones: new Set(),
    add11: false,
    omit3: false,
    omit5: false,
    extensiones: [],
    alteraciones: [],
  };
}

/** Separa «C7(b9,#11)/E» en raíz, sufijo (sin paréntesis ni separadores) y bajo. */
function trocear(texto: string): { raiz: string; sufijo: string; bajo?: string } | null {
  let t = texto.trim().replace(/\s+/g, '');
  if (!t) return null;
  t = t
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/Δ|∆/g, 'maj')
    .replace(/ø|Ø/g, 'm7b5')
    .replace(/°|º/g, 'dim')
    .replace(/Maj/g, 'maj')
    .replace(/Min/g, 'min')
    .replace(/Dim/g, 'dim')
    .replace(/Aug/g, 'aug')
    .replace(/Sus/g, 'sus')
    .replace(/Add/g, 'add')
    .replace(/Alt/g, 'alt')
    .replace(/Omit/g, 'omit');
  const m = /^([A-Ga-g])((?:#|b){0,2})(.*)$/.exec(t);
  if (!m) return null;
  let resto = m[3]!;
  let bajo: string | undefined;
  // La barra puede ser bajo («/F#») o parte de «6/9».
  const slash = /\/([A-Ga-g](?:#|b)?)$/.exec(resto);
  if (slash) {
    bajo = normalizarNota(slash[1]!);
    resto = resto.slice(0, slash.index);
  }
  const sufijo = resto.replace(/[(),\s]/g, '');
  return { raiz: normalizarNota(m[1]! + m[2]!), sufijo, bajo };
}

/** Tokens reconocidos del sufijo; el primero que encaja gana, así que los largos van antes que sus prefijos. */
const TOKENS = [
  'maj13', 'maj11', 'maj9', 'maj7', 'maj',
  'min7b5', 'min', 'mi',
  'dim7', 'dim', 'aug',
  'sus2', 'sus4', 'sus',
  'add13', 'add11', 'add9', 'add6', 'add4', 'add2',
  'omit3', 'omit5', 'no3', 'no5',
  'alt',
  '6/9', '69',
  'b13', '#13', 'b11', '#11', 'b9', '#9', 'b5', '#5', 'b6',
  '13', '11', '9', '7', '6', '5', '2', '4',
  'M13', 'M9', 'M7', 'M',
  'm', '-', '+', '^',
] as const;

function tokenizar(sufijo: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < sufijo.length) {
    let hit: string | null = null;
    for (const tok of TOKENS) {
      if (sufijo.startsWith(tok, i)) {
        hit = tok;
        break;
      }
    }
    if (!hit) return null;
    out.push(hit);
    i += hit.length;
  }
  return out;
}

function septimaPorDefecto(c: Construccion, mayor: boolean): number {
  if (mayor) return 11;
  return c.calidad === 'disminuido' ? 9 : 10;
}

function aplicarTokens(tokens: string[], c: Construccion): boolean {
  let mayorSeptima = false; // «maj»/«M»/«^» pendiente de un número
  const pila = (n: '7' | '9' | '11' | '13', mayor: boolean) => {
    c.septima = c.septima ?? septimaPorDefecto(c, mayor);
    if (mayor) c.septima = 11;
    if (n !== '7') c.tensiones.add(14);
    if (n === '11') c.tensiones.add(17);
    if (n === '13') c.tensiones.add(21);
    c.extensiones.push(`${mayor ? 'maj' : c.septima === 9 ? 'dim' : ''}${n}`);
  };
  const tension = (semi: number, etiqueta: string) => {
    c.septima = c.septima ?? septimaPorDefecto(c, false);
    c.tensiones.add(semi);
    c.alteraciones.push(etiqueta);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    switch (t) {
      case 'maj': case 'M': case '^': mayorSeptima = true; break;
      case 'maj7': case 'M7': pila('7', true); break;
      case 'maj9': case 'M9': pila('9', true); break;
      case 'maj11': pila('11', true); break;
      case 'maj13': case 'M13': pila('13', true); break;
      case 'm': case 'min': case 'mi': case '-': c.calidad = 'menor'; c.tercera = 3; break;
      case 'min7b5': c.calidad = 'menor'; c.tercera = 3; c.quinta = 6; pila('7', false); c.alteraciones.push('b5'); break;
      case 'dim': c.calidad = 'disminuido'; c.tercera = 3; c.quinta = 6; break;
      case 'dim7': c.calidad = 'disminuido'; c.tercera = 3; c.quinta = 6; c.septima = 9; c.extensiones.push('dim7'); break;
      case 'aug': case '+': c.calidad = 'aumentado'; c.quinta = 8; break;
      case 'sus2': c.calidad = 'sus'; c.tercera = null; c.sus.push(2); break;
      case 'sus4': case 'sus': c.calidad = 'sus'; c.tercera = null; c.sus.push(5); break;
      case '2':
        if (c.tercera === null) c.sus.push(2);
        else { c.tensiones.add(14); c.extensiones.push('add9'); }
        break;
      case '4':
        if (c.tercera === null) c.sus.push(5);
        else { c.tensiones.add(17); c.add11 = true; c.extensiones.push('add11'); }
        break;
      case '5':
        if (c.calidad === 'mayor' && c.tercera === 4 && c.extensiones.length === 0 && c.tensiones.size === 0) {
          c.calidad = 'quinta';
          c.tercera = null;
        }
        break;
      case '6': case 'add6': c.sexta = true; c.extensiones.push('6'); break;
      case '6/9': case '69': c.sexta = true; c.tensiones.add(14); c.extensiones.push('6/9'); break;
      case '7': pila('7', mayorSeptima); mayorSeptima = false; break;
      case '9': pila('9', mayorSeptima); mayorSeptima = false; break;
      case '11': pila('11', mayorSeptima); mayorSeptima = false; break;
      case '13': pila('13', mayorSeptima); mayorSeptima = false; break;
      case 'add2': case 'add9': c.tensiones.add(14); c.extensiones.push('add9'); break;
      case 'add4': case 'add11': c.tensiones.add(17); c.add11 = true; c.extensiones.push('add11'); break;
      case 'add13': c.tensiones.add(21); c.extensiones.push('add13'); break;
      case 'b5': c.quinta = 6; c.alteraciones.push('b5'); break;
      case '#5': c.quinta = 8; c.alteraciones.push('#5'); break;
      case 'b6': c.tensiones.add(20); c.alteraciones.push('b13'); break;
      case 'b9': tension(13, 'b9'); break;
      case '#9': tension(15, '#9'); break;
      case 'b11': tension(16, 'b11'); break;
      case '#11': tension(18, '#11'); break;
      case 'b13': tension(20, 'b13'); break;
      case '#13': tension(22, '#13'); break;
      case 'alt':
        c.calidad = 'alterado';
        c.septima = 10;
        c.quinta = null;
        c.tensiones.add(13).add(15).add(20);
        c.extensiones.push('7');
        c.alteraciones.push('alt');
        break;
      case 'omit3': case 'no3': c.tercera = null; c.omit3 = true; c.alteraciones.push('omit3'); break;
      case 'omit5': case 'no5': c.quinta = null; c.omit5 = true; c.alteraciones.push('omit5'); break;
      default:
        return false;
    }
  }
  return true;
}

const tiene = (c: Construccion, ...semis: number[]) => semis.some((s) => c.tensiones.has(s));

/** Grado más alto de la pila natural de tensiones (sin alteraciones ni «add»). */
function cimaDe(c: Construccion): '7' | '9' | '11' | '13' | null {
  if (c.septima === null || c.calidad === 'disminuido') return null;
  if (c.tensiones.has(21) && !c.extensiones.includes('add13')) return '13';
  if (c.tensiones.has(17) && !c.add11) return '11';
  if (c.tensiones.has(14) && !c.extensiones.includes('add9') && !c.extensiones.includes('6/9')) return '9';
  return '7';
}

function intervalosDe(c: Construccion): number[] {
  const s = new Set<number>([0]);
  for (const x of c.sus) s.add(x);
  if (c.tercera !== null) s.add(c.tercera);
  if (c.quinta !== null) s.add(c.quinta);
  if (c.sexta) s.add(9);
  if (c.septima !== null) s.add(c.septima);
  const cima = cimaDe(c);
  for (const t of c.tensiones) {
    // Oncena justa sobre tercera mayor choca (novena menor): en «11» se omite la tercera, en «13» la oncena.
    if (t === 17 && c.tercera === 4 && !c.add11) {
      if (cima === '13') continue;
      s.delete(4);
    }
    s.add(t);
  }
  return [...s].sort((a, b) => a - b);
}

function calidadFinal(c: Construccion): CalidadAcorde {
  if (c.calidad === 'alterado') return 'alterado';
  if (c.calidad === 'menor' && c.quinta === 6 && c.septima === 10) return 'semidisminuido';
  if (c.calidad === 'mayor' && c.septima === 10) return 'dominante';
  if (c.calidad === 'sus') return c.sus.includes(5) ? 'sus4' : 'sus2';
  return c.calidad;
}

/** Sufijo normalizado a partir de la construcción (orden estándar de cifrado). */
function sufijoNormalizado(c: Construccion, calidad: CalidadAcorde): string {
  if (calidad === 'alterado') return '7alt';
  let s = '';
  const esMenor = c.tercera === 3;
  const dim = c.calidad === 'disminuido';
  if (dim) s += c.septima === 9 ? 'dim7' : 'dim';
  else if (c.calidad === 'aumentado') s += 'aug';
  else if (esMenor) s += 'm';
  else if (calidad === 'quinta') s += '5';

  const maj = c.septima === 11;
  const cima = cimaDe(c);
  if (c.sexta && !cima) s += c.tensiones.has(14) ? '6/9' : '6';
  if (cima) s += maj ? (esMenor ? `(maj${cima})` : `maj${cima}`) : cima;
  if (c.sus.includes(2)) s += 'sus2';
  if (c.sus.includes(5)) s += 'sus4';
  if (c.sexta && cima) s += 'add13';
  // Tensiones añadidas fuera de la pila
  if (c.tensiones.has(14) && (!cima || cima === '7') && !(c.sexta && !cima)) s += 'add9';
  if (c.tensiones.has(17) && (c.add11 || !cima || cima === '7')) s += 'add11';
  if (c.tensiones.has(21) && (!cima || cima !== '13')) s += 'add13';
  // Alteraciones
  if (c.quinta === 6 && !dim) s += 'b5';
  if (c.quinta === 8 && c.calidad !== 'aumentado') s += '#5';
  if (c.tensiones.has(13)) s += 'b9';
  if (c.tensiones.has(15)) s += '#9';
  if (c.tensiones.has(16)) s += 'b11';
  if (c.tensiones.has(18)) s += '#11';
  if (c.tensiones.has(20)) s += 'b13';
  if (c.tensiones.has(22)) s += '#13';
  if (c.omit3) s += '(no3)';
  if (c.omit5) s += '(no5)';
  return s;
}

/**
 * Parsea un cifrado completo. Lanza Error si no se reconoce.
 * Acepta ♯/♭, mayúsculas/minúsculas, paréntesis y comas: «F#m7b5», «Bb/D», «C7(b9,#11)», «dmaj7#11», «G13sus4», «E7alt».
 */
export function parsearAcordeComplejo(texto: string): AcordeComplejo {
  const partes = trocear(texto);
  if (!partes) throw new Error(`Acorde no reconocido: «${texto}»`);
  const tokens = tokenizar(partes.sufijo);
  if (tokens === null) throw new Error(`Acorde no reconocido: «${texto}»`);
  const c = construccionBase();
  if (!aplicarTokens(tokens, c)) throw new Error(`Acorde no reconocido: «${texto}»`);
  const calidad = calidadFinal(c);
  const intervalos = intervalosDe(c);
  const raizPc = pcDeNota(partes.raiz);
  const bajoPc = partes.bajo ? pcDeNota(partes.bajo) : undefined;
  const pcs = [...new Set(intervalos.map((i) => (raizPc + i) % 12))];
  const sufijo = sufijoNormalizado(c, calidad);
  const conBajo = partes.bajo !== undefined && bajoPc !== raizPc;
  const nombre = `${partes.raiz}${sufijo}${conBajo ? `/${partes.bajo}` : ''}`;
  const acorde: AcordeComplejo = {
    nombre,
    raiz: partes.raiz,
    raizPc,
    calidad,
    extensiones: [...new Set(c.extensiones)],
    alteraciones: [...new Set(c.alteraciones)],
    ...(conBajo ? { bajo: partes.bajo, bajoPc } : {}),
    intervalos,
    pcs,
    pitches: (octava = 4) => pitchesDeAcorde(acorde, octava),
  };
  return acorde;
}

/** Igual que `parsearAcordeComplejo` pero devuelve null en vez de lanzar. */
export function intentarParsearAcorde(texto: string): AcordeComplejo | null {
  try {
    return parsearAcordeComplejo(texto);
  } catch {
    return null;
  }
}

/** Pitches en posición fundamental desde la octava dada; el bajo ajeno va por debajo de la fundamental. */
export function pitchesDeAcorde(acorde: AcordeComplejo, octava = 4): number[] {
  const base = 12 * (octava + 1) + acorde.raizPc;
  const out = acorde.intervalos.map((i) => base + i);
  if (acorde.bajoPc !== undefined) {
    let bajo = base - 12 + ((acorde.bajoPc - acorde.raizPc + 12) % 12);
    if (bajo >= base) bajo -= 12;
    out.unshift(bajo);
  }
  return out.filter((p) => p >= 0 && p <= 127);
}

// ---------------------------------------------------------------------------
// Nombrador (pitches → nombre)
// ---------------------------------------------------------------------------

/** Plantillas en orden de preferencia (las más sencillas primero). */
const PLANTILLAS: string[] = [
  '', 'm', 'dim', 'aug', '5', 'sus2', 'sus4',
  '7', 'maj7', 'm7', 'm7b5', 'dim7', 'm(maj7)', '7sus4', '7sus2',
  '6', 'm6', 'add9', 'madd9', 'add11', 'madd11', '6/9', 'm6/9', 'sus2sus4',
  '9', 'maj9', 'm9', 'm9b5', 'maj7#11', 'maj7#5', '7b5', '7#5', '7b9', '7#9', 'm7b9', '9b5', '9#5', 'm(maj9)',
  '11', 'm11', 'maj11', '9#11', '7#11', '7add11',
  '13', 'm13', 'maj13', '13sus4', 'maj13sus4', '7b13', '9b13', '13b9', '13#11',
  '7alt', '7b9#9', '7b9#11', '7#9b13', '7b9b13', 'maj9#11', 'm7add11', 'madd9add11',
];

interface Plantilla {
  sufijo: string;
  pcsRel: number[];
  tieneQuinta: boolean;
  tieneTercera: boolean;
}

let plantillasCache: Plantilla[] | null = null;
function plantillas(): Plantilla[] {
  if (plantillasCache) return plantillasCache;
  const out: Plantilla[] = [];
  const vistos = new Set<string>();
  for (const s of PLANTILLAS) {
    const a = intentarParsearAcorde(`C${s}`);
    if (!a) continue;
    const pcsRel = [...new Set(a.intervalos.map((i) => i % 12))].sort((x, y) => x - y);
    const clave = pcsRel.join(',');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    out.push({
      sufijo: s,
      pcsRel,
      tieneQuinta: a.intervalos.includes(7),
      tieneTercera: a.intervalos.includes(3) || a.intervalos.includes(4),
    });
  }
  plantillasCache = out;
  return out;
}

const igual = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface OpcionesNombrar extends OpcionesNombre {
  /** Si false, no se anota «(no5)»/«(no3)» en tríadas y séptimas incompletas. */
  anotarOmisiones?: boolean;
}

/**
 * Nombra un conjunto de pitches MIDI (lo que se está tocando en el teclado).
 * Detecta inversiones (acorde con barra), omisión de quinta/tercera y tensiones; `null` si no hay
 * acorde reconocible (menos de 2 notas distintas o conjunto sin plantilla).
 */
export function nombrarAcorde(pitches: readonly number[], opts: OpcionesNombrar = {}): string | null {
  const validos = pitches.filter((p) => Number.isFinite(p)).map((p) => Math.round(p));
  if (validos.length === 0) return null;
  const bajoPc = ((Math.min(...validos) % 12) + 12) % 12;
  const pcs = [...new Set(validos.map((p) => ((p % 12) + 12) % 12))].sort((a, b) => a - b);
  if (pcs.length < 2) return null;
  const anotar = opts.anotarOmisiones !== false;
  const candidatos: Array<{ nombre: string; costo: number }> = [];

  for (const raiz of pcs) {
    const rel = pcs.map((pc) => (pc - raiz + 12) % 12).sort((a, b) => a - b);
    const bajoAjeno = raiz !== bajoPc;
    const barra = bajoAjeno ? `/${nombreDeNota(bajoPc, opts)}` : '';
    plantillas().forEach((pl, i) => {
      let costo = i * 0.01 + (bajoAjeno ? 1.5 : 0);
      let sufijo = pl.sufijo;
      const sinQuinta = pl.pcsRel.filter((x) => x !== 7);
      const sinTercera = pl.pcsRel.filter((x) => x !== 3 && x !== 4);
      if (igual(rel, pl.pcsRel)) {
        // coincidencia exacta
      } else if (pl.tieneQuinta && igual(rel, sinQuinta)) {
        costo += pl.pcsRel.length <= 4 ? 1 : 0.4;
        if (anotar && pl.pcsRel.length <= 4) sufijo += '(no5)';
      } else if (pl.tieneTercera && pl.pcsRel.length >= 5 && igual(rel, sinTercera)) {
        costo += 0.6;
      } else if (pl.tieneTercera && pl.tieneQuinta && pl.pcsRel.length >= 5 && igual(rel, sinTercera.filter((x) => x !== 7))) {
        costo += 1.2;
      } else return;
      candidatos.push({ nombre: `${nombreDeNota(raiz, opts)}${sufijo}${barra}`, costo });
    });
  }
  if (candidatos.length === 0) {
    if (pcs.length === 2) {
      const otro = pcs.find((p) => p !== bajoPc)!;
      const inter = (otro - bajoPc + 12) % 12;
      const r = nombreDeNota(bajoPc, opts);
      if (inter === 4) return anotar ? `${r}(no5)` : r;
      if (inter === 3) return anotar ? `${r}m(no5)` : `${r}m`;
      if (inter === 7) return `${r}5`;
    }
    return null;
  }
  candidatos.sort((a, b) => a.costo - b.costo);
  return candidatos[0]!.nombre;
}

// ---------------------------------------------------------------------------
// Voicing y transposición
// ---------------------------------------------------------------------------

export interface OpcionesVoicing {
  /** Octava de la fundamental (C4 = 60). Por defecto 4. */
  octava?: number;
  /** Máximo de voces (sin contar el bajo). Se retiran por orden: 5, 11, 9, 13, fundamental. */
  voces?: number;
  /** Rango MIDI permitido para las voces [lo, hi]; por defecto [48, 84]. */
  rango?: [number, number];
  /** Añadir el bajo (fundamental o nota de la barra) por debajo. Por defecto solo si hay barra. */
  conBajo?: boolean;
}

/** Voicing cerrado del acorde: tensiones por encima, bajo opcional debajo; respeta el rango plegando octavas. */
export function voicingDeAcorde(nombre: string | AcordeComplejo, opts: OpcionesVoicing = {}): number[] {
  const acorde = typeof nombre === 'string' ? parsearAcordeComplejo(nombre) : nombre;
  const octava = opts.octava ?? 4;
  const [lo, hi] = opts.rango ?? [48, 84];
  const base = 12 * (octava + 1) + acorde.raizPc;
  let intervalos = [...acorde.intervalos];
  const voces = opts.voces ?? Infinity;
  const ordenRetiro = [7, 6, 8, 17, 18, 16, 14, 13, 15, 21, 20, 22, 0];
  for (const i of ordenRetiro) {
    if (intervalos.length <= voces) break;
    if (intervalos.includes(i) && intervalos.length > 2) intervalos = intervalos.filter((x) => x !== i);
  }
  let pitches = intervalos.map((i) => base + i);
  pitches = pitches.map((p) => {
    let q = p;
    while (q > hi) q -= 12;
    while (q < lo) q += 12;
    return q;
  });
  pitches = [...new Set(pitches)].sort((a, b) => a - b);
  const conBajo = opts.conBajo ?? acorde.bajoPc !== undefined;
  if (conBajo) {
    const pcBajo = acorde.bajoPc ?? acorde.raizPc;
    let bajo = (pitches[0] ?? base) - 1;
    while (((bajo % 12) + 12) % 12 !== pcBajo) bajo -= 1;
    while (bajo < 24) bajo += 12;
    pitches.unshift(bajo);
  }
  return pitches.filter((p) => p >= 0 && p <= 127);
}

/** Transpone el cifrado (raíz y bajo) `semitonos`; conserva el sufijo normalizado. */
export function transponerAcorde(nombre: string, semitonos: number, opts?: OpcionesNombre): string {
  const a = parsearAcordeComplejo(nombre);
  const escrito = `${a.raiz}${a.bajo ?? ''}`;
  const spell: OpcionesNombre =
    opts ?? { bemoles: escrito.includes('b') ? true : escrito.includes('#') ? false : undefined };
  const raiz = nombreDeNota(a.raizPc + semitonos, spell);
  const sufijo = a.nombre.slice(a.raiz.length).replace(/\/[A-G](?:#|b)?$/, '');
  const bajo = a.bajoPc !== undefined ? `/${nombreDeNota(a.bajoPc + semitonos, spell)}` : '';
  return `${raiz}${sufijo}${bajo}`;
}

/** Nombre normalizado («f#m7b5» → «F#m7b5»); null si no se reconoce. */
export function normalizarNombreAcorde(texto: string): string | null {
  return intentarParsearAcorde(texto)?.nombre ?? null;
}
