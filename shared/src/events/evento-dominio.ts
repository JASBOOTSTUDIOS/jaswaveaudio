/**
 * Contratos de tipos para eventos de dominio y valores JSON serializables.
 *
 * Propósito:
 *   Establecer la estructura base que todo evento debe cumplir para circular
 *   por el BusEventos, además de definir el tipo de payload serializable
 *   (ValorJSON) usado en eventos, configuraciones y respuestas.
 *
 * Importancia:
 *   - Asegura que cada evento capture metadatos mínimos de trazabilidad:
 *     nombre, versión, marca de tiempo, fuente y trazabilidad causal.
 *   - Permite filtrar, replay y correlacionar eventos de forma type-safe.
 *   - Define el formato estándar de comunicación entre productores y
 *     consumidores de eventos en todo el sistema.
 *   - Soporta eventos extendidos con tipo, severidad, tags, origen/destino,
 *     contexto, metadatos y payloads estructurados para IA y auditoría.
 *
 * Función:
 *   Exporta EventoDominio, EventoAsincrono, FiltroEvento, tipos de eventos
 *   especializados (error, advertencia, info, debug, métrica, auditoría,
 *   comando, respuesta, feedback, notificación, alerta, cambio de estado,
 *   inicio, fin, progreso) y el sistema de tipos ValorJSON/ObjetoJSON/ArregloJSON
 *   utilizados por el bus y por cualquier módulo que necesite payloads
 *   tipados y serializables.
 */

export type ValorJSON = string | number | boolean | null | ObjetoJSON | ArregloJSON;
export interface ObjetoJSON {
  [clave: string]: ValorJSON;
}
export interface ArregloJSON extends Array<ValorJSON> {}

export interface EventoDominio {
  nombre: string;
  version: number;
  marcaTiempo: number;
  fuente: string;
  payload: ValorJSON;
  idCausacion?: string;
  idCorrelacion?: string;
  /** true cuando el evento proviene de una fuente asíncrona (análisis, render, IA remota). */
  asincrono?: boolean;
  tipo?: 'dominio' | 'sistema' | 'ui' | 'audio' | 'midi' | 'hardware' | 'ia' | 'red' | 'licencia' | 'nube';
  subtipo?: string;
  severidad?: 'debug' | 'info' | 'advertencia' | 'error' | 'critico';
  tags?: string[];
  origen?: {
    modulo: string;
    componente: string;
    funcion: string;
    linea?: number;
  };
  destino?: {
    modulo: string;
    componente: string;
  };
  contexto?: Record<string, ValorJSON>;
  metadatos?: Record<string, ValorJSON>;
  duracionMs?: number;
  exito?: boolean;
  error?: {
    codigo: string;
    mensaje: string;
    stack?: string;
    detalles?: Record<string, ValorJSON>;
  };
}

/**
 * Evento emitido por una fuente asíncrona. Requiere `idCorrelacion` para
 * vincularlo con el comando u operación que lo originó.
 */
export interface EventoAsincrono extends EventoDominio {
  asincrono: true;
  idCorrelacion: string;
}

/** Metadatos opcionales al emitir en el bus. */
export interface MetaEmit {
  fuente?: string;
  version?: number;
  idCausacion?: string;
  idCorrelacion?: string;
  asincrono?: boolean;
}

export interface FiltroEvento {
  nombre?: string;
  fuente?: string;
  desde?: number;
  limite?: number;
  tipo?: EventoDominio['tipo'];
  severidad?: EventoDominio['severidad'];
  idCorrelacion?: string;
  idCausacion?: string;
  tag?: string;
  exito?: boolean;
}

export interface EventoError extends EventoDominio {
  tipo: 'sistema';
  severidad: 'error' | 'critico';
  error: {
    codigo: string;
    mensaje: string;
    stack?: string;
    detalles?: Record<string, ValorJSON>;
  };
}

export interface EventoAdvertencia extends EventoDominio {
  tipo: 'sistema';
  severidad: 'advertencia';
  advertencia: {
    codigo: string;
    mensaje: string;
    sugerencia?: string;
  };
}

export interface EventoInfo extends EventoDominio {
  tipo: 'sistema';
  severidad: 'info';
  info: {
    mensaje: string;
    detalle?: string;
  };
}

export interface EventoDebug extends EventoDominio {
  tipo: 'sistema';
  severidad: 'debug';
  debug: {
    mensaje: string;
    datos?: Record<string, ValorJSON>;
  };
}

export interface EventoMetrica extends EventoDominio {
  tipo: 'audio';
  metrica: {
    nombre: string;
    valor: number;
    unidad: string;
    minimo?: number;
    maximo?: number;
    promedio?: number;
    historial?: number[];
  };
}

export interface EventoAuditoria extends EventoDominio {
  tipo: 'sistema';
  auditoria: {
    accion: string;
    entidadId: string;
    entidadTipo: string;
    cambios: { campo: string; valorAnterior: ValorJSON; valorNuevo: ValorJSON }[];
    usuarioId?: string;
    dispositivoId?: string;
  };
}

export interface EventoComando extends EventoDominio {
  tipo: 'dominio';
  comando: {
    id: string;
    nombre: string;
    parametros: Record<string, ValorJSON>;
    opciones?: Record<string, ValorJSON>;
  };
}

export interface EventoRespuesta extends EventoDominio {
  tipo: 'dominio';
  respuesta: {
    comandoId: string;
    exito: boolean;
    resultado?: ValorJSON;
    error?: EventoError['error'];
    duracionMs: number;
  };
}

export interface EventoFeedback extends EventoDominio {
  tipo: 'audio';
  feedback: {
    frecuencia: number;
    nivel: number;
    tiempo: number;
    fuente: string;
  };
}

export interface EventoNotificacion extends EventoDominio {
  tipo: 'ui';
  notificacion: {
    id: string;
    titulo: string;
    mensaje: string;
    tipo: 'info' | 'advertencia' | 'error' | 'exito';
    duracionMs?: number;
    acciones?: { id: string; etiqueta: string; comando?: string }[];
    thumbnail?: string;
  };
}

export interface EventoAlerta extends EventoDominio {
  tipo: 'sistema';
  severidad: 'advertencia' | 'error' | 'critico';
  alerta: {
    id: string;
    codigo: string;
    titulo: string;
    mensaje: string;
    parametros?: Record<string, ValorJSON>;
    acciones?: { id: string; etiqueta: string; comando?: string }[];
    silenciable: boolean;
    tiempoSilenciado?: number;
  };
}

export interface EventoCambioEstado extends EventoDominio {
  tipo: 'dominio';
  cambioEstado: {
    entidadId: string;
    entidadTipo: string;
    estadoAnterior: Record<string, ValorJSON>;
    estadoNuevo: Record<string, ValorJSON>;
    diferencias: { campo: string; valorAnterior: ValorJSON; valorNuevo: ValorJSON }[];
  };
}

export interface EventoInicio extends EventoDominio {
  tipo: 'dominio';
  inicio: {
    proceso: string;
    parametros: Record<string, ValorJSON>;
    estimadoMs?: number;
  };
}

export interface EventoFin extends EventoDominio {
  tipo: 'dominio';
  fin: {
    proceso: string;
    exito: boolean;
    resultado?: ValorJSON;
    error?: EventoError['error'];
    duracionMs: number;
  };
}

export interface EventoProgreso extends EventoDominio {
  tipo: 'dominio';
  progreso: {
    proceso: string;
    porcentaje: number;
    etapa?: string;
    estimadoMs?: number;
    detalle?: string;
  };
}

export interface EventoInicioSesion extends EventoDominio {
  tipo: 'sistema';
  inicioSesion: {
    usuarioId: string;
    dispositivoId: string;
    plataforma: string;
    version: string;
  };
}

export interface EventoFinSesion extends EventoDominio {
  tipo: 'sistema';
  finSesion: {
    usuarioId: string;
    dispositivoId: string;
    duracionMs: number;
    motivo?: string;
  };
}
