/** Validación estricta de lo que el administrador sube o edita en el catálogo de grooves. */

import { z } from 'zod';

export const MAX_BYTES_MID = 256 * 1024;
export const MAX_GROOVES = 3000;
export const MAX_POR_ESTILO = 600;
export const MAX_LOTE = 400;
export const MAX_ZIP_BYTES = 12 * 1024 * 1024;
export const MAX_ZIP_DESCOMPRIMIDO = 48 * 1024 * 1024;
export const TIPOS = ['groove', 'fill', 'intro', 'outro', 'transicion'] as const;

const RESERVADOS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
// Control (C0/C1), formato (bidi, ancho cero), separadores de línea/párrafo, sustitución y símbolos de ruta de Windows.
const PROHIBIDOS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}�<>:"/\\|?*]/u;

/** Un segmento de ruta o un nombre: sin separadores, sin `..`, sin control/bidi, sin nombres reservados de Windows. */
export function segmentoSeguro(texto: string, max: number): boolean {
  const t = texto.trim();
  return t.length > 0 && t.length <= max && t === texto && !PROHIBIDOS.test(t) && !t.startsWith('.') && !t.endsWith('.') && !t.includes('..') && !RESERVADOS.test(t);
}

const nombreBase = z.string().min(1).max(80).refine((t) => segmentoSeguro(t, 80), 'el nombre tiene caracteres no permitidos');

/** Estilo: 1 o 2 niveles separados por «/» (p. ej. `Worship/4-4`). */
export const esquemaEstilo = z
  .string()
  .min(1)
  .max(81)
  .refine((e) => {
    const partes = e.split('/');
    return partes.length >= 1 && partes.length <= 2 && partes.every((p) => segmentoSeguro(p, 40));
  }, 'estilo no válido: usa uno o dos niveles sin símbolos especiales');

export const esquemaId = z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/, 'id no válido');
const etiqueta = z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/, 'etiqueta no válida');
const textoCorto = (max: number) => z.string().max(max).refine((t) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(t), 'texto con caracteres no permitidos');

export const esquemaMetadatos = z.object({
  nombre: nombreBase,
  estilo: esquemaEstilo,
  tipo: z.enum(TIPOS),
  compas: z.string().regex(/^(?:[1-9]|1\d|2[0-4])\/(?:2|4|8|16)$/, 'compás no válido'),
  tempo: z.number().int().min(20).max(400),
  compases: z.number().int().min(1).max(64),
  intensidad: z.number().int().min(1).max(5),
  etiquetas: z.array(etiqueta).max(20),
  autor: textoCorto(60),
  licencia: textoCorto(40),
});
export type Metadatos = z.infer<typeof esquemaMetadatos>;

export const base64Mid = z
  .string()
  .max(Math.ceil((MAX_BYTES_MID * 4) / 3) + 8)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'base64 no válido');

/** Nombre de archivo (sin extensión) a partir de un nombre legible: minúsculas, sin acentos, con guiones. */
export function archivoDesdeNombre(nombre: string): string {
  const s = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return s || 'groove';
}

export const esquemaArchivo = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'nombre de archivo no válido');

export function slugId(estilo: string, nombre: string): string {
  return `jw-${archivoDesdeNombre(estilo.replace(/\//g, '-'))}-${archivoDesdeNombre(nombre)}`.slice(0, 80).replace(/-+$/, '');
}

export function tipoDesdeNombre(nombre: string): (typeof TIPOS)[number] {
  const n = nombre.toLowerCase();
  if (/\b(fill|relleno)\b/.test(n)) return 'fill';
  if (/\bintro\b/.test(n)) return 'intro';
  if (/\b(outro|final|ending)\b/.test(n)) return 'outro';
  if (/\b(trans|transicion|transición)\b/.test(n)) return 'transicion';
  return 'groove';
}

/** «01-coro_pleno.mid» → «Coro pleno». */
export function nombreLegible(archivo: string): string {
  const base = archivo.replace(/\.(mid|midi)$/i, '').replace(/^\d+[\s._-]*/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const limpio = Array.from(base).filter((c) => !PROHIBIDOS.test(c)).join('').trim().slice(0, 80);
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : 'Groove';
}
