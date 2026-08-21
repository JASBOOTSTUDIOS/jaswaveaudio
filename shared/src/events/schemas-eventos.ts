/**
 * Registro de schemas versionados para eventos de dominio.
 *
 * Cada nombre de evento puede asociarse a una versión de payload y a un
 * validador opcional. La versión se incrementa cuando cambia el schema.
 */

import type { ValorJSON } from './evento-dominio';
import {
  EventosAudio,
  EventosAutomatizacion,
  EventosClip,
  EventosIAExt,
  EventosMidi,
  EventosPlugin,
  EventosProyecto,
  EventosSistema,
  EventosTrack,
  EventosTransporte,
  EventosUIExt,
} from '../constants/nombres-eventos';

export type ValidadorPayload = (payload: ValorJSON) => true | string;

export interface SchemaEvento {
  version: number;
  validar?: ValidadorPayload;
}

export interface ResultadoValidacionSchema {
  ok: boolean;
  error?: string;
  version: number;
}

export class RegistroSchemasEventos {
  private schemas = new Map<string, SchemaEvento>();

  registrar(nombre: string, schema: SchemaEvento): void {
    if (schema.version < 1) {
      throw new Error(`La versión del schema para "${nombre}" debe ser >= 1`);
    }
    this.schemas.set(nombre, schema);
  }

  registrarGrupo(nombres: Record<string, string>, version = 1): void {
    for (const nombre of Object.values(nombres)) {
      if (!this.schemas.has(nombre)) {
        this.schemas.set(nombre, { version });
      }
    }
  }

  obtener(nombre: string): SchemaEvento | undefined {
    return this.schemas.get(nombre);
  }

  obtenerVersion(nombre: string): number {
    return this.schemas.get(nombre)?.version ?? 1;
  }

  validar(nombre: string, payload: ValorJSON): ResultadoValidacionSchema {
    const schema = this.schemas.get(nombre);
    const version = schema?.version ?? 1;
    if (!schema?.validar) {
      return { ok: true, version };
    }
    const resultado = schema.validar(payload);
    if (resultado === true) {
      return { ok: true, version };
    }
    return { ok: false, error: resultado, version };
  }

  tiene(nombre: string): boolean {
    return this.schemas.has(nombre);
  }

  limpiar(): void {
    this.schemas.clear();
  }
}

/** Registro global con schemas base del DAW (versión 1). */
export const registroSchemasEventos = new RegistroSchemasEventos();

function esObjeto(payload: ValorJSON): payload is Record<string, ValorJSON> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload);
}

function registrarSchemasBase(registro: RegistroSchemasEventos): void {
  registro.registrarGrupo(EventosProyecto);
  registro.registrarGrupo(EventosTransporte);
  registro.registrarGrupo(EventosTrack);
  registro.registrarGrupo(EventosClip);
  registro.registrarGrupo(EventosPlugin);
  registro.registrarGrupo(EventosAutomatizacion);
  registro.registrarGrupo(EventosMidi);
  registro.registrarGrupo(EventosAudio);
  registro.registrarGrupo(EventosUIExt);
  registro.registrarGrupo(EventosIAExt);
  registro.registrarGrupo(EventosSistema);

  // Validadores mínimos para eventos de alta frecuencia / críticos
  registro.registrar(EventosAudio.analisisActualizado, {
    version: 1,
    validar: (payload) => (esObjeto(payload) ? true : 'audio.analisis.actualizado requiere un objeto'),
  });
  registro.registrar(EventosTransporte.posicionCambiada, {
    version: 1,
    validar: (payload) => (esObjeto(payload) ? true : 'transporte.posicionCambiada requiere un objeto'),
  });
  registro.registrar(EventosSistema.error, {
    version: 1,
    validar: (payload) => (esObjeto(payload) ? true : 'sistema.error requiere un objeto'),
  });
}

registrarSchemasBase(registroSchemasEventos);
