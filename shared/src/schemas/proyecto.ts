/**
 * Esquemas zod del archivo de proyecto `.jaswave`.
 *
 * Propósito:
 *   Validar la estructura mínima que el DAW necesita para cargar un proyecto
 *   de forma segura (desde disco o desde la sesión de IndexedDB) antes de
 *   meterlo en la tienda.
 *
 * Importancia:
 *   - Un archivo dañado o editado a mano no debe tumbar la UI ni el motor.
 *   - Los esquemas usan `.passthrough()`: los campos desconocidos o nuevos se
 *     conservan intactos (compatibilidad hacia delante dentro de la misma
 *     versión de formato).
 *   - No se coerciona nada: un `bpm` en texto es un error, no un número.
 *
 * Función:
 *   Exporta los esquemas (`esquemaProyectoArchivo`, `esquemaProyecto`, …) y
 *   helpers que devuelven mensajes de error claros en español con la ruta de
 *   los primeros problemas encontrados.
 */

import { z } from 'zod';

const MAX_PROBLEMAS_MENSAJE = 5;

const texto = z.string();
const textoNoVacio = z.string().min(1, 'no puede estar vacío');
// `finite`: Infinity se serializa como null en JSON y el archivo dejaría de abrir.
const numero = z.number().finite('debe ser un número finito');
const numeroPositivo = z.number().finite('debe ser un número finito').positive('debe ser mayor que 0');
const arrayOpcional = <T extends z.ZodTypeAny>(item: T) => z.array(item).optional();

/** Clip (audio o MIDI): identidad, tipo y tiempos numéricos. */
export const esquemaClip = z
  .object({
    id: textoNoVacio,
    tipo: texto.optional(),
    inicio: numero,
    duracion: numero,
    clipInicio: numero.optional(),
    notas: arrayOpcional(
      z
        .object({
          pitch: numero,
          inicio: numero,
          duracion: numero,
        })
        .passthrough(),
    ),
  })
  .passthrough();

/** Plugin insertado en una pista o en el master. */
export const esquemaPlugin = z
  .object({
    id: textoNoVacio,
  })
  .passthrough();

/** Pista: identidad, tipo, clips y plugins (si existen deben ser arrays). */
export const esquemaTrack = z
  .object({
    id: textoNoVacio,
    nombre: texto,
    tipo: textoNoVacio,
    clips: arrayOpcional(esquemaClip),
    plugins: arrayOpcional(esquemaPlugin),
    volumen: numero.optional(),
    paneo: numero.optional(),
  })
  .passthrough();

export const esquemaBpm = z
  .object({
    valor: numeroPositivo,
  })
  .passthrough();

export const esquemaCompas = z
  .object({
    numerador: numeroPositivo,
    denominador: numeroPositivo,
  })
  .passthrough();

export const esquemaMaster = z
  .object({
    volumen: numero.optional(),
    plugins: arrayOpcional(esquemaPlugin),
  })
  .passthrough();

const CAMPOS_ROUTING = ['buses', 'sends', 'rutas', 'sidechains', 'inserts', 'conexionesDirectas', 'puentes', 'grupos'] as const;

/** Routing opcional: si existe, sus colecciones conocidas deben ser arrays (o faltar). */
export const esquemaRouting = z
  .object(
    Object.fromEntries(CAMPOS_ROUTING.map((c) => [c, z.array(z.unknown()).optional()])) as Record<
      (typeof CAMPOS_ROUTING)[number],
      z.ZodOptional<z.ZodArray<z.ZodUnknown>>
    >,
  )
  .passthrough();

/** Estado de proyecto (`ProjectState`) con los campos necesarios para cargar. */
export const esquemaProyecto = z
  .object({
    id: textoNoVacio,
    nombre: texto,
    sampleRate: numeroPositivo,
    bitDepth: numeroPositivo,
    bpm: esquemaBpm,
    timeSignature: esquemaCompas,
    tracks: z.array(esquemaTrack),
    master: esquemaMaster,
    routing: esquemaRouting.optional(),
  })
  .passthrough();

export const esquemaAudioReference = z
  .object({
    id: texto,
    rutaRelativa: texto,
  })
  .passthrough();

/** Envoltorio del archivo `.jaswave` (`ProyectoArchivo`). */
export const esquemaProyectoArchivo = z
  .object({
    version: z.number().int('debe ser un entero').nonnegative('no puede ser negativa'),
    project: esquemaProyecto,
    audioReferences: z.record(esquemaAudioReference),
  })
  .passthrough();

export type ProyectoValidado = z.infer<typeof esquemaProyecto>;
export type ProyectoArchivoValidado = z.infer<typeof esquemaProyectoArchivo>;

export type ResultadoValidacion<T> = { ok: true; datos: T } | { ok: false; error: string; problemas: string[] };

const NOMBRES_TIPO: Record<string, string> = {
  string: 'texto',
  number: 'número',
  integer: 'entero',
  boolean: 'booleano',
  object: 'objeto',
  array: 'array',
  null: 'null',
  undefined: 'ausente',
  nan: 'NaN',
};

const nombreTipo = (t: string): string => NOMBRES_TIPO[t] ?? t;

const rutaIssue = (prefijo: string, ruta: (string | number)[]): string => {
  let r = prefijo;
  for (const seg of ruta) {
    if (typeof seg === 'number') r += `[${seg}]`;
    else r += r ? `.${seg}` : seg;
  }
  return r || '(raíz)';
};

const mensajeIssue = (issue: z.ZodIssue): string => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined') return `falta el campo (se esperaba ${nombreTipo(issue.expected)})`;
      return `se esperaba ${nombreTipo(issue.expected)}, se recibió ${nombreTipo(issue.received)}`;
    case 'too_small':
    case 'too_big':
    case 'custom':
      return issue.message;
    default:
      return issue.message;
  }
};

/** Formatea los primeros problemas de zod como líneas `ruta: mensaje`. */
export const formatearProblemas = (error: z.ZodError, prefijo = ''): string[] =>
  error.issues.map((issue) => `${rutaIssue(prefijo, issue.path)}: ${mensajeIssue(issue)}`);

const resumirProblemas = (problemas: string[]): string => {
  const primeros = problemas.slice(0, MAX_PROBLEMAS_MENSAJE).join('; ');
  const resto = problemas.length - MAX_PROBLEMAS_MENSAJE;
  return resto > 0 ? `${primeros} (y ${resto} problema${resto === 1 ? '' : 's'} más)` : primeros;
};

const validarCon = <T>(esquema: z.ZodType<T>, valor: unknown, prefijo: string, titulo: string): ResultadoValidacion<T> => {
  const r = esquema.safeParse(valor);
  if (r.success) return { ok: true, datos: r.data };
  const problemas = formatearProblemas(r.error, prefijo);
  return { ok: false, problemas, error: `${titulo}: ${resumirProblemas(problemas)}` };
};

/** Valida un archivo `.jaswave` completo (ya migrado a la versión actual). */
export const validarProyectoArchivo = (valor: unknown): ResultadoValidacion<ProyectoArchivoValidado> =>
  validarCon(esquemaProyectoArchivo, valor, '', 'El proyecto cargado está corrupto');

/** Valida solo el `ProjectState` (p. ej. snapshot de sesión en IndexedDB). */
export const validarProyecto = (valor: unknown): ResultadoValidacion<ProyectoValidado> =>
  validarCon(esquemaProyecto, valor, 'project', 'El proyecto guardado está corrupto');

// ── Validación incremental (executor) ───────────────────────────────────────

/** Proyecto sin bajar a las pistas (se validan aparte, solo las que cambian). */
const esquemaProyectoCabecera = esquemaProyecto.extend({ tracks: z.array(z.unknown()) });
/** Pista sin bajar a los clips (se validan aparte, solo los que cambian). */
const esquemaTrackCabecera = esquemaTrack.extend({ clips: z.array(z.unknown()).optional() });

const TITULO_CAMBIO_INVALIDO = 'El cambio dejaría el proyecto inválido';

type Objeto = Record<string, unknown>;
const esObjeto = (v: unknown): v is Objeto => typeof v === 'object' && v !== null;

/**
 * Valida el proyecto resultante de un comando revisando solo lo que cambió
 * respecto a `antes` (comparación por referencia, estado inmutable): la cabecera
 * del proyecto, las pistas nuevas o modificadas y, dentro de ellas, los clips
 * nuevos o modificados. Equivale a `validarProyecto(despues)` cuando `antes` era
 * válido, pero cuesta O(pistas + clips tocados) y no O(notas del proyecto).
 */
export const validarCambiosProyecto = (antes: unknown, despues: unknown): ResultadoValidacion<unknown> => {
  if (antes === despues) return { ok: true, datos: despues };
  if (!esObjeto(antes) || !esObjeto(despues)) {
    return validarCon(esquemaProyecto, despues, 'project', TITULO_CAMBIO_INVALIDO);
  }
  const problemas: string[] = [];
  const cabecera = esquemaProyectoCabecera.safeParse(despues);
  if (!cabecera.success) problemas.push(...formatearProblemas(cabecera.error, 'project'));

  const tracksAntes = Array.isArray(antes.tracks) ? (antes.tracks as unknown[]) : [];
  const tracksDespues = Array.isArray(despues.tracks) ? (despues.tracks as unknown[]) : null;
  if (tracksDespues && tracksDespues !== tracksAntes) {
    const refsAntes = new Set(tracksAntes);
    const porId = new Map<unknown, Objeto>();
    for (const t of tracksAntes) if (esObjeto(t)) porId.set(t.id, t);
    tracksDespues.forEach((t, i) => {
      if (refsAntes.has(t)) return;
      const prefijo = `project.tracks[${i}]`;
      const r = esquemaTrackCabecera.safeParse(t);
      if (!r.success) problemas.push(...formatearProblemas(r.error, prefijo));
      if (!esObjeto(t) || !Array.isArray(t.clips)) return;
      const previo = porId.get(t.id);
      if (previo && previo.clips === t.clips) return;
      const refsClips = new Set(previo && Array.isArray(previo.clips) ? (previo.clips as unknown[]) : []);
      (t.clips as unknown[]).forEach((c, j) => {
        if (refsClips.has(c)) return;
        const rc = esquemaClip.safeParse(c);
        if (!rc.success) problemas.push(...formatearProblemas(rc.error, `${prefijo}.clips[${j}]`));
      });
    });
  }

  if (problemas.length === 0) return { ok: true, datos: despues };
  return { ok: false, problemas, error: `${TITULO_CAMBIO_INVALIDO}: ${resumirProblemas(problemas)}` };
};
