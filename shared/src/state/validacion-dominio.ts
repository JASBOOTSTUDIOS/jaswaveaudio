/**
 * Reglas de validación de dominio del DAW.
 *
 * Propósito:
 *   Centralizar las reglas de negocio que deben cumplirse antes de ejecutar
 *   comandos. El pipeline de validación las aplica por `appliesTo` y, además,
 *   el executor valida el estado resultante contra el esquema del proyecto.
 *
 * Importancia:
 *   - Un valor fuera de rango (BPM 0, compás 4/3, volumen NaN…) se rechaza
 *     antes de tocar el estado: no queda en el undo ni en el archivo guardado.
 *   - Los límites viven en un solo sitio, también para la IA.
 *
 * Función:
 *   Exporta `crearReglasDominio` y los helpers de nombres de pista
 *   (`nombreTrackUnico`, `MAX_NOMBRE_TRACK`).
 */

import type { DomainRule, ValidationError, ValidationResult } from '../types/command';
import type { DAWState } from '../types/state';
import type { Track } from '../types/tracks';
import { puedeTenerClips } from '../types/tracks';
import { isValidBpm } from './bpm';

export type { DomainRule };

export interface ReglasDominio {
  registrar(rule: DomainRule): void;
  validar(estado: DAWState, payload: unknown, tipoComando?: string): ValidationResult;
}

/** Nombre de pista: largo máximo tras recortar espacios. */
export const MAX_NOMBRE_TRACK = 64;
/**
 * Volumen lineal máximo: +12 dB (`10^(12/20) ≈ 3.98`) es el tope del fader.
 * Se deja un margen mínimo para no rechazar valores ya redondeados por la UI.
 */
export const VOLUMEN_MAX_LINEAL = 4;
export const PAN_MIN = -1;
export const PAN_MAX = 1;

const DENOMINADORES_COMPAS = new Set([1, 2, 4, 8, 16, 32]);

const ok = (): ValidationResult => ({ valid: true, errors: [], warnings: [] });
const fallo = (errors: ValidationError[]): ValidationResult => ({ valid: false, errors, warnings: [] });
const error = (code: string, field: string, message: string): ValidationError => ({ code, field, message });

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

const numeroFinito = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor);

/** Nombre recortado que cumple largo mínimo y máximo, o `null` si no. */
function nombreValido(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const nombre = valor.trim();
  if (nombre.length === 0 || nombre.length > MAX_NOMBRE_TRACK) return null;
  return nombre;
}

/**
 * Devuelve un nombre único en el proyecto: si `nombre` ya existe (excluyendo
 * la pista `idExcluido`) añade el sufijo ` (2)`, ` (3)`…
 */
export function nombreTrackUnico(nombre: string, tracks: readonly Track[], idExcluido?: string): string {
  const base = nombre.trim();
  const existentes = new Set(tracks.filter((t) => t.id !== idExcluido).map((t) => t.nombre));
  if (!existentes.has(base)) return base;
  let sufijo = 2;
  while (existentes.has(`${base} (${sufijo})`)) sufijo += 1;
  return `${base} (${sufijo})`;
}

/**
 * Alias con acento para el resto del dominio (el identificador sin acento se
 * conserva por compatibilidad con imports existentes).
 */
export const nombrePistaUnico = nombreTrackUnico;

function validarRangoNumero(
  code: string,
  field: string,
  valor: unknown,
  min: number,
  max: number,
  etiqueta: string,
): ValidationError | null {
  if (!numeroFinito(valor) || valor < min || valor > max) {
    return error(code, field, `${etiqueta} debe ser un número entre ${min} y ${max}`);
  }
  return null;
}

export function crearReglasDominio(): ReglasDominio {
  const reglas: DomainRule[] = [];

  const trackNombreValido: DomainRule = {
    name: 'TrackNombreValido',
    code: 'TRACK_NAME_INVALID',
    description: `El nombre de la pista no puede estar vacío ni superar ${MAX_NOMBRE_TRACK} caracteres.`,
    appliesTo: ['track.create', 'track.update'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload)) return ok();
      const datos = esObjeto(payload.datos) ? payload.datos : payload;
      if (datos.nombre === undefined) return ok();
      if (nombreValido(datos.nombre) === null) {
        return fallo([
          error(
            'TRACK_NAME_INVALID',
            'nombre',
            `El nombre de la pista debe tener entre 1 y ${MAX_NOMBRE_TRACK} caracteres`,
          ),
        ]);
      }
      return ok();
    },
  };

  const trackCamposInmutables: DomainRule = {
    name: 'TrackCamposInmutables',
    code: 'TRACK_FIELD_IMMUTABLE',
    description: 'Una pista no puede cambiar de id ni de tipo mediante track.update.',
    appliesTo: ['track.update'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || !esObjeto(payload.datos)) return ok();
      const errores: ValidationError[] = [];
      for (const campo of ['id', 'tipo'] as const) {
        if (payload.datos[campo] !== undefined) {
          errores.push(
            error('TRACK_FIELD_IMMUTABLE', campo, `El campo '${campo}' de una pista no se puede modificar`),
          );
        }
      }
      return errores.length > 0 ? fallo(errores) : ok();
    },
  };

  const trackVolumenPaneo: DomainRule = {
    name: 'TrackVolumenPaneo',
    code: 'TRACK_MIX_INVALID',
    description: `Volumen lineal entre 0 y ${VOLUMEN_MAX_LINEAL}; paneo entre ${PAN_MIN} y ${PAN_MAX}.`,
    appliesTo: ['track.update'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || !esObjeto(payload.datos)) return ok();
      const errores: ValidationError[] = [];
      if (payload.datos.volumen !== undefined) {
        const e = validarRangoNumero(
          'TRACK_VOLUME_OUT_OF_RANGE',
          'volumen',
          payload.datos.volumen,
          0,
          VOLUMEN_MAX_LINEAL,
          'El volumen',
        );
        if (e) errores.push(e);
      }
      if (payload.datos.paneo !== undefined) {
        const e = validarRangoNumero('TRACK_PAN_OUT_OF_RANGE', 'paneo', payload.datos.paneo, PAN_MIN, PAN_MAX, 'El paneo');
        if (e) errores.push(e);
      }
      return errores.length > 0 ? fallo(errores) : ok();
    },
  };

  const masterVolumenPaneo: DomainRule = {
    name: 'MasterVolumenPaneo',
    code: 'MASTER_MIX_INVALID',
    description: `Volumen lineal del master entre 0 y ${VOLUMEN_MAX_LINEAL}; paneo entre ${PAN_MIN} y ${PAN_MAX}.`,
    appliesTo: ['master.update'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || !esObjeto(payload.datos)) return ok();
      const errores: ValidationError[] = [];
      if (payload.datos.volumen !== undefined) {
        const e = validarRangoNumero(
          'MASTER_VOLUME_OUT_OF_RANGE',
          'volumen',
          payload.datos.volumen,
          0,
          VOLUMEN_MAX_LINEAL,
          'El volumen del master',
        );
        if (e) errores.push(e);
      }
      if (payload.datos.paneo !== undefined) {
        const e = validarRangoNumero('MASTER_PAN_OUT_OF_RANGE', 'paneo', payload.datos.paneo, PAN_MIN, PAN_MAX, 'El paneo del master');
        if (e) errores.push(e);
      }
      return errores.length > 0 ? fallo(errores) : ok();
    },
  };

  const bpmValido: DomainRule = {
    name: 'BpmValido',
    code: 'INVALID_BPM',
    description: 'El BPM debe ser un número finito entre 20 y 300.',
    appliesTo: ['project.setBpm', 'transport.bpm.set'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || payload.bpm === undefined) return ok();
      if (!isValidBpm(payload.bpm)) {
        return fallo([error('INVALID_BPM', 'bpm', `BPM ${String(payload.bpm)} fuera de rango [20, 300]`)]);
      }
      return ok();
    },
  };

  const compasValido: DomainRule = {
    name: 'CompasValido',
    code: 'INVALID_TIME_SIGNATURE',
    description: 'Numerador entero entre 1 y 32; denominador en {1, 2, 4, 8, 16, 32}.',
    appliesTo: ['project.setTimeSignature'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload)) return ok();
      return validarCompas(payload.numerador, payload.denominador);
    },
  };

  const projectUpdateValido: DomainRule = {
    name: 'ProjectUpdateValido',
    code: 'PROJECT_UPDATE_INVALID',
    description: 'BPM, compás, nombre y datos de audio del proyecto deben ser válidos.',
    appliesTo: ['project.update'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || !esObjeto(payload.datos)) return ok();
      const datos = payload.datos;
      const errores: ValidationError[] = [];

      if (datos.nombre !== undefined) {
        if (typeof datos.nombre !== 'string' || datos.nombre.trim().length === 0) {
          errores.push(error('PROJECT_NAME_INVALID', 'nombre', 'El nombre del proyecto no puede estar vacío'));
        }
      }
      if (datos.sampleRate !== undefined && (!numeroFinito(datos.sampleRate) || datos.sampleRate <= 0)) {
        errores.push(error('PROJECT_SAMPLE_RATE_INVALID', 'sampleRate', 'El sample rate debe ser mayor que 0'));
      }
      if (datos.bitDepth !== undefined && (!numeroFinito(datos.bitDepth) || datos.bitDepth <= 0)) {
        errores.push(error('PROJECT_BIT_DEPTH_INVALID', 'bitDepth', 'La profundidad de bits debe ser mayor que 0'));
      }
      if (esObjeto(datos.bpm) && datos.bpm.valor !== undefined && !isValidBpm(datos.bpm.valor)) {
        errores.push(error('INVALID_BPM', 'datos.bpm.valor', `BPM ${String(datos.bpm.valor)} fuera de rango [20, 300]`));
      }
      if (esObjeto(datos.timeSignature)) {
        const compas = validarCompas(datos.timeSignature.numerador, datos.timeSignature.denominador, true);
        errores.push(...compas.errors);
      }

      return errores.length > 0 ? fallo(errores) : ok();
    },
  };

  const clipTiempos: DomainRule = {
    name: 'ClipTiempos',
    code: 'CLIP_TIME_INVALID',
    description: 'Inicio ≥ 0, duración > 0, clipInicio ≥ 0 y punto de corte ≥ 0.',
    appliesTo: ['clip.create', 'midi.clip.create', 'clip.move', 'clip.resize', 'clip.split'],
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload)) return ok();
      const errores: ValidationError[] = [];

      if (payload.inicio !== undefined && (!numeroFinito(payload.inicio) || payload.inicio < 0)) {
        errores.push(error('CLIP_START_INVALID', 'inicio', 'El inicio del clip no puede ser negativo'));
      }
      if (payload.duracion !== undefined && (!numeroFinito(payload.duracion) || payload.duracion <= 0)) {
        errores.push(error('CLIP_DURATION_INVALID', 'duracion', 'La duración del clip debe ser mayor que 0'));
      }
      if (payload.clipInicio !== undefined && (!numeroFinito(payload.clipInicio) || payload.clipInicio < 0)) {
        errores.push(error('CLIP_OFFSET_INVALID', 'clipInicio', 'El desplazamiento del clip no puede ser negativo'));
      }
      if (payload.tiempo !== undefined && (!numeroFinito(payload.tiempo) || payload.tiempo < 0)) {
        errores.push(error('CLIP_SPLIT_INVALID', 'tiempo', 'El punto de corte no puede ser negativo'));
      }

      return errores.length > 0 ? fallo(errores) : ok();
    },
  };

  const clipCreatePista: DomainRule = {
    name: 'ClipCreatePista',
    code: 'CLIP_TRACK_INCOMPATIBLE',
    description: 'Un clip de audio solo puede crearse en una pista de audio.',
    appliesTo: ['clip.create'],
    validate: (state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || typeof payload.pistaId !== 'string') return ok();
      const pista = state.project.tracks.find((t) => t.id === payload.pistaId);
      if (!pista) {
        return fallo([error('CLIP_TRACK_NOT_FOUND', 'pistaId', `Pista no encontrada: ${payload.pistaId}`)]);
      }
      if (!puedeTenerClips(pista) || pista.tipo !== 'audio') {
        return fallo([
          error('CLIP_TRACK_INCOMPATIBLE', 'pistaId', `La pista "${pista.nombre}" no acepta clips de audio`),
        ]);
      }
      return ok();
    },
  };

  const midiClipCreatePista: DomainRule = {
    name: 'MidiClipCreatePista',
    code: 'CLIP_TRACK_INCOMPATIBLE',
    description: 'Un clip MIDI solo puede crearse en una pista que acepte clips.',
    appliesTo: ['midi.clip.create'],
    validate: (state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload)) return ok();
      const pistaId = typeof payload.pistaId === 'string' ? payload.pistaId : payload.trackId;
      if (typeof pistaId !== 'string') return ok();
      const pista = state.project.tracks.find((t) => t.id === pistaId);
      if (!pista) {
        return fallo([error('CLIP_TRACK_NOT_FOUND', 'pistaId', `Pista no encontrada: ${pistaId}`)]);
      }
      if (!puedeTenerClips(pista)) {
        return fallo([
          error('CLIP_TRACK_INCOMPATIBLE', 'pistaId', `La pista "${pista.nombre}" no acepta clips`),
        ]);
      }
      return ok();
    },
  };

  const clipMoveDestino: DomainRule = {
    name: 'ClipMoveDestino',
    code: 'CLIP_TRACK_INCOMPATIBLE',
    description: 'El clip debe moverse a una pista que acepte su tipo.',
    appliesTo: ['clip.move'],
    validate: (state: DAWState, payload: unknown): ValidationResult => {
      if (!esObjeto(payload) || typeof payload.pistaId !== 'string' || typeof payload.clipId !== 'string') return ok();
      const origen = state.project.tracks.find((t) => t.id === payload.pistaId);
      if (!origen) {
        return fallo([error('CLIP_TRACK_NOT_FOUND', 'pistaId', `Pista no encontrada: ${payload.pistaId}`)]);
      }
      const destinoId = typeof payload.pistaDestinoId === 'string' ? payload.pistaDestinoId : payload.pistaId;
      const destino = state.project.tracks.find((t) => t.id === destinoId);
      if (!destino) {
        return fallo([error('CLIP_TRACK_NOT_FOUND', 'pistaDestinoId', `Pista destino no encontrada: ${destinoId}`)]);
      }
      if (!puedeTenerClips(destino)) {
        return fallo([
          error('CLIP_TRACK_INCOMPATIBLE', 'pistaDestinoId', `La pista "${destino.nombre}" no acepta clips`),
        ]);
      }
      const clip = (origen.clips as { id?: string; tipo?: string }[]).find((c) => c.id === payload.clipId);
      if (clip?.tipo !== 'midi' && destino.tipo !== 'audio') {
        return fallo([
          error('CLIP_TRACK_INCOMPATIBLE', 'pistaDestinoId', 'Un clip de audio solo puede ir a una pista de audio'),
        ]);
      }
      return ok();
    },
  };

  reglas.push(
    trackNombreValido,
    trackCamposInmutables,
    trackVolumenPaneo,
    masterVolumenPaneo,
    bpmValido,
    compasValido,
    projectUpdateValido,
    clipTiempos,
    clipCreatePista,
    midiClipCreatePista,
    clipMoveDestino,
  );

  return {
    registrar(rule: DomainRule): void {
      reglas.push(rule);
    },

    validar(estado: DAWState, payload: unknown, tipoComando?: string): ValidationResult {
      const aplicables = tipoComando
        ? reglas.filter((r) => !r.appliesTo || r.appliesTo.includes(tipoComando))
        : reglas;

      const errores: ValidationError[] = [];

      for (const rule of aplicables) {
        let result: ValidationResult;
        try {
          result = rule.validate(estado, payload);
        } catch (e) {
          result = fallo([
            error(rule.code, rule.name, e instanceof Error ? e.message : `Regla ${rule.name} falló`),
          ]);
        }
        if (!result.valid) errores.push(...result.errors);
      }

      return {
        valid: errores.length === 0,
        errors: errores,
        warnings: [],
      };
    },
  };
}

/**
 * Comprueba el compás. `parcial` permite que `project.update` envíe solo uno de
 * los dos campos (el otro se conserva del proyecto actual).
 */
function validarCompas(numerador: unknown, denominador: unknown, parcial = false): ValidationResult {
  const errores: ValidationError[] = [];
  if (numerador !== undefined || !parcial) {
    if (!numeroFinito(numerador) || !Number.isInteger(numerador) || numerador < 1 || numerador > 32) {
      errores.push(error('INVALID_TIME_SIGNATURE', 'numerador', 'El numerador debe ser un entero entre 1 y 32'));
    }
  }
  if (denominador !== undefined || !parcial) {
    if (!numeroFinito(denominador) || !DENOMINADORES_COMPAS.has(denominador)) {
      errores.push(
        error('INVALID_TIME_SIGNATURE', 'denominador', 'El denominador debe ser 1, 2, 4, 8, 16 o 32'),
      );
    }
  }
  return errores.length > 0 ? fallo(errores) : ok();
}
