/**
 * Reglas de validación de dominio del DAW.
 *
 * Propósito:
 *   Centralizar reglas de negocio específicas que deben cumplirse
 *   antes de ejecutar comandos o herramientas.
 *
 * Importancia:
 *   - Garantiza la consistencia del estado del proyecto.
 *   - Bloquea operaciones que violarían invariantes del dominio.
 *
 * Función:
 *   Exporta DomainRule, crearReglasDominio y validadores específicos
 *   como TrackNameUnique, VolumeRange, ValidTimeSignature, ValidBPM.
 */

import type { DomainRule, ValidationResult, ValidationError } from '../types/command';
import type { DAWState } from '../types/state';

export type { DomainRule };

export interface ReglasDominio {
  registrar(rule: DomainRule): void;
  validar(estado: DAWState, payload: unknown, tipoComando?: string): ValidationResult;
}

export function crearReglasDominio(): ReglasDominio {
  const reglas: DomainRule[] = [];

  const trackNameUnique: DomainRule = {
    name: 'TrackNameUnique',
    code: 'TRACK_NAME_NOT_UNIQUE',
    description: 'No puede haber dos tracks con el mismo nombre en el proyecto.',
    validate: (state: DAWState, payload: unknown): ValidationResult => {
      const p = payload as { nombre?: string; trackId?: string } | null;
      if (!p?.nombre) return { valid: true, errors: [], warnings: [] };
      const existe = state.project.tracks.some(t => t.nombre === p.nombre && t.id !== p.trackId);
      if (existe) {
        return {
          valid: false,
          errors: [{ code: 'TRACK_NAME_NOT_UNIQUE', field: 'nombre', message: `Ya existe un track llamado "${p.nombre}"` }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
    appliesTo: ['track.crear', 'track.renombrar'],
  };

  const volumeRange: DomainRule = {
    name: 'VolumeRange',
    code: 'VOLUME_OUT_OF_RANGE',
    description: 'El volumen debe estar entre -60 dB y +12 dB.',
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      const p = payload as { dB?: number } | null;
      if (p?.dB === undefined) return { valid: true, errors: [], warnings: [] };
      if (p.dB < -60 || p.dB > 12) {
        return {
          valid: false,
          errors: [{ code: 'VOLUME_OUT_OF_RANGE', field: 'dB', message: `Volumen ${p.dB} dB fuera de rango [-60, +12]` }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
    appliesTo: ['track.volume.set', 'clip.volume.set'],
  };

  const validTimeSignature: DomainRule = {
    name: 'ValidTimeSignature',
    code: 'INVALID_TIME_SIGNATURE',
    description: 'El numerador debe ser > 0 y el denominador una potencia de 2.',
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      const p = payload as { numerador?: number; denominador?: number } | null;
      if (p?.numerador === undefined || p?.denominador === undefined) {
        return { valid: true, errors: [], warnings: [] };
      }
      if (p.numerador <= 0) {
        return {
          valid: false,
          errors: [{ code: 'INVALID_TIME_SIGNATURE', field: 'numerador', message: 'El numerador debe ser mayor a 0' }],
          warnings: [],
        };
      }
      const denom = p.denominador;
      const esPotencia2 = denom > 0 && (denom & (denom - 1)) === 0;
      if (!esPotencia2) {
        return {
          valid: false,
          errors: [{ code: 'INVALID_TIME_SIGNATURE', field: 'denominador', message: 'El denominador debe ser una potencia de 2' }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
    appliesTo: ['proyecto.timeSignature.set'],
  };

  const validBPM: DomainRule = {
    name: 'ValidBPM',
    code: 'INVALID_BPM',
    description: 'El BPM debe estar en el rango permitido (20-300).',
    validate: (_state: DAWState, payload: unknown): ValidationResult => {
      const p = payload as { bpm?: number } | null;
      if (p?.bpm === undefined) return { valid: true, errors: [], warnings: [] };
      if (typeof p.bpm !== 'number' || !Number.isFinite(p.bpm) || p.bpm < 20 || p.bpm > 300) {
        return {
          valid: false,
          errors: [{ code: 'INVALID_BPM', field: 'bpm', message: `BPM ${String(p.bpm)} fuera de rango [20, 300]` }],
          warnings: [],
        };
      }
      return { valid: true, errors: [], warnings: [] };
    },
    appliesTo: ['project.setBpm', 'proyecto.bpm.set', 'transport.bpm.set'],
  };

  reglas.push(trackNameUnique, volumeRange, validTimeSignature, validBPM);

  return {
    registrar(rule: DomainRule): void {
      reglas.push(rule);
    },

    validar(estado: DAWState, payload: unknown, tipoComando?: string): ValidationResult {
      const aplicables = tipoComando
        ? reglas.filter(r => !r.appliesTo || r.appliesTo.includes(tipoComando))
        : reglas;

      const errores: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      for (const rule of aplicables) {
        const result = rule.validate(estado, payload);
        if (!result.valid) {
          errores.push(...result.errors);
        }
      }

      return {
        valid: errores.length === 0,
        errors: errores,
        warnings,
      };
    },
  };
}
