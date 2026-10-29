/**
 * G7: formateo del texto dictado por voz (estilo teclado de móvil).
 *
 * - Puntuación hablada en español: «coma», «punto», «punto y coma», «dos puntos», «signo de interrogación»,
 *   «signo de exclamación», «punto y seguido», «punto y aparte», «nueva línea» / «salto de línea»…
 * - Términos del DAW con su grafía: MIDI, VST, BPM, dB, EQ…
 * - Espacios dobles fuera y mayúscula tras punto o salto de línea.
 *
 * Funciones puras: el hook de dictado las aplica sobre todo el tramo dictado (finales + provisional) en cada
 * resultado, así el texto nunca se duplica ni se formatea dos veces.
 */

/** Frase hablada → signo. Se prueban en este orden (las frases largas antes que «punto» o «coma»). */
const PUNTUACION_HABLADA: ReadonlyArray<readonly [RegExp, string]> = [
  [/punto y coma/, ';'],
  [/punto (?:y )?aparte/, '.\n'],
  [/punto (?:y )?seguido/, '.'],
  [/punto final/, '.'],
  [/(?:nueva|siguiente) l[ií]nea|salto de l[ií]nea/, '\n'],
  [/nuevo p[aá]rrafo/, '\n\n'],
  [/puntos suspensivos/, '…'],
  [/dos puntos/, ':'],
  [/(?:abre|abrir) (?:signo de )?(?:interrogaci[oó]n|pregunta)/, '¿'],
  [/(?:abre|abrir) (?:signo de )?(?:exclamaci[oó]n|admiraci[oó]n)/, '¡'],
  [/(?:cierra |cerrar )?signo de (?:interrogaci[oó]n|pregunta)|cierra (?:interrogaci[oó]n|pregunta)/, '?'],
  [/(?:cierra |cerrar )?signo de (?:exclamaci[oó]n|admiraci[oó]n)|cierra (?:exclamaci[oó]n|admiraci[oó]n)/, '!'],
  [/coma/, ','],
  // «punto de inicio», «punto de corte»…: ahí «punto» es un sustantivo, no un signo.
  [/punto(?!\s+del?\b)/, '.'],
];

/** Términos de producción con su grafía habitual (se comparan sin distinguir mayúsculas). */
const TERMINOS_DAW: Readonly<Record<string, string>> = {
  midi: 'MIDI',
  vst: 'VST',
  vst2: 'VST2',
  vst3: 'VST3',
  bpm: 'BPM',
  db: 'dB',
  dbfs: 'dBFS',
  lufs: 'LUFS',
  eq: 'EQ',
  fx: 'FX',
  daw: 'DAW',
  lfo: 'LFO',
  adsr: 'ADSR',
  hz: 'Hz',
  khz: 'kHz',
  wav: 'WAV',
  mp3: 'MP3',
  pan: 'Pan',
  sidechain: 'Sidechain',
  reverb: 'Reverb',
  master: 'Master',
  jaswave: 'JasWave',
};

/** Letras del español para los límites de palabra (\b de JS no entiende acentos ni eñes). */
const LETRA = 'A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ';

export interface OpcionesFormatoDictado {
  /** Poner mayúscula a la primera letra (al empezar un campo vacío o tras un punto). Por defecto, true. */
  mayusculaInicial?: boolean;
}

function frase(re: RegExp): RegExp {
  // Palabra completa, sin distinguir mayúsculas, con los espacios de alrededor (se recolocan después).
  return new RegExp(`[ \\t]*(?<![${LETRA}])(?:${re.source})(?![${LETRA}])[ \\t]*`, 'giu');
}

const PUNTUACION_COMPILADA = PUNTUACION_HABLADA.map(([re, signo]) => [frase(re), signo] as const);
const TERMINO_RE = new RegExp(`(?<![${LETRA}])(${Object.keys(TERMINOS_DAW).join('|')})(?![${LETRA}])`, 'giu');

/** Sustituye la puntuación hablada por sus signos y los coloca pegados a la palabra anterior. */
export function aplicarPuntuacionHablada(texto: string): string {
  let s = texto;
  // El signo queda entre espacios: limpiarEspaciado decide luego cuál sobra.
  for (const [re, signo] of PUNTUACION_COMPILADA) s = s.replace(re, ` ${signo} `);
  return s;
}

/** MIDI, VST, BPM, dB, EQ… con su grafía. */
export function normalizarTerminosDaw(texto: string): string {
  return texto.replace(TERMINO_RE, (m) => TERMINOS_DAW[m.toLowerCase()] ?? m);
}

/** Espacios: uno solo entre palabras, ninguno antes de , . ; : ? ! … ni después de ¿ ¡, ninguno junto a saltos de línea. */
export function limpiarEspaciado(texto: string): string {
  return texto
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/ +([,.;:?!…])/g, '$1')
    .replace(/([¿¡]) +/g, '$1')
    // Signos repetidos por decir «punto» tras una frase que el reconocedor ya cerró con punto.
    .replace(/([,.;:])\1+/g, '$1')
    .replace(/([,;:])([.?!])/g, '$2')
    .replace(/([,.;:?!…])(?=[^\s,.;:?!…)\]"'»\d])/gu, '$1 ')
    .replace(/^ +| +$/g, '');
}

/** Mayúscula al principio (opcional) y tras . ? ! … o salto de línea. */
export function capitalizarFrases(texto: string, mayusculaInicial = true): string {
  let s = texto.replace(/([.?!…]\s+|\n\s*)([¿¡]?)(\p{Ll})/gu, (_m, sep: string, abre: string, l: string) => sep + abre + l.toLocaleUpperCase('es'));
  if (mayusculaInicial) s = s.replace(/^(\s*[¿¡]?)(\p{Ll})/u, (_m, pre: string, l: string) => pre + l.toLocaleUpperCase('es'));
  return s;
}

/** Formateo completo de un tramo dictado. */
export function formatearTextoDictado(texto: string, opciones: OpcionesFormatoDictado = {}): string {
  if (!texto.trim()) return '';
  const conSignos = aplicarPuntuacionHablada(texto);
  const conTerminos = normalizarTerminosDaw(conSignos);
  return capitalizarFrases(limpiarEspaciado(conTerminos), opciones.mayusculaInicial ?? true);
}

/** «Sube» → «sube»; deja «MIDI», «VST» o «A» tal cual. */
function minusculaInicial(texto: string): string {
  return texto.replace(/^(\p{Lu})(?=\p{Ll})/u, (l: string) => l.toLocaleLowerCase('es'));
}

/** ¿El texto anterior termina una frase (o está vacío)? Entonces lo dictado empieza con mayúscula. */
export function terminaFrase(texto: string): boolean {
  const t = texto.replace(/[ \t]+$/, '');
  return t === '' || /[.?!…\n]$/.test(t);
}

export interface PartesDictado {
  /** Lo que había en el campo al pulsar el micrófono. */
  ancla: string;
  /** Frases ya confirmadas por el reconocedor, en orden. */
  finales: readonly string[];
  /** Hipótesis provisional de la frase en curso (se sustituye en cada resultado, nunca se acumula). */
  provisional?: string;
  /** Aplicar puntuación hablada y términos del DAW (por defecto, true). */
  formatear?: boolean;
}

/** Tramo dictado (finales + provisional) ya formateado, sin el ancla. */
export function textoDictado(partes: Omit<PartesDictado, 'ancla'> & { ancla?: string }): string {
  const trozos = [...partes.finales, partes.provisional ?? ''].map((p) => p.trim()).filter(Boolean);
  if (!trozos.length) return '';
  const mayusculaInicial = terminaFrase(partes.ancla ?? '');
  // El reconocedor empieza cada frase con mayúscula: a mitad de frase se quita (salvo siglas como MIDI).
  const crudo = trozos
    .map((t, i) => (terminaFrase(i === 0 ? (partes.ancla ?? '') : trozos[i - 1]) ? t : minusculaInicial(t)))
    .join(' ');
  return partes.formatear === false
    ? limpiarEspaciado(crudo)
    : formatearTextoDictado(crudo, { mayusculaInicial });
}

/**
 * Valor del campo = ancla + tramo dictado. Se recalcula entero en cada resultado del reconocedor
 * (no se concatena al valor anterior), por eso la hipótesis provisional nunca deja palabras duplicadas.
 */
export function componerTextoDictado(partes: PartesDictado): string {
  const dictado = textoDictado(partes);
  if (!dictado) return partes.ancla;
  const ancla = partes.ancla;
  const pegado = ancla === '' || /\s$/.test(ancla) || /^[,.;:?!…]/.test(dictado);
  return ancla + (pegado ? '' : ' ') + dictado;
}
