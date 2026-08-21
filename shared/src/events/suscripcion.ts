/**
 * Contratos y utilidades para suscripciones a eventos del BusEventos.
 *
 * Propósito:
 *   Definir las interfaces, opciones y estados relacionados con la
 *   suscripción a eventos, permitiendo manejo avanzado de filtros,
 *   prioridades, agrupación y ciclo de vida de suscripciones.
 *
 * Importancia:
 *   - Desacopla a los consumidores de eventos de la implementación concreta
 *     del bus, permitiendo cambiar la estrategia de suscripción sin romper
 *     la API pública.
 *   - Facilita la gestión de memoria al permitir liberar manejadores
 *     cuando ya no son necesarios.
 *   - Soporta características avanzadas como suscripciones filtradas,
 *     priorizadas, agrupadas, con replay, auto-cancelables y con
 *     manejo de errores.
 *
 * Función:
 *   Exporta Suscripcion, SuscripcionPersistente, SuscripcionUnaVez,
 *   SuscripcionFiltrada, SuscripcionPrioritaria, OpcionesSuscripcion,
 *   EstadoSuscripcion, TipoSuscripcion, ManejadorSuscripcion,
 *   AgrupacionSuscripcion, CancelacionSuscripcion, ReplaySuscripcion
 *   y utilidades para gestión de suscripciones.
 */

export type TipoSuscripcion = 'persistente' | 'unaVez' | 'filtrada' | 'prioritaria' | 'agrupada' | 'replay' | 'autoCancelable' | 'condicional';

export interface EstadoSuscripcion {
  activa: boolean;
  cancelada: boolean;
  vecesInvocada: number;
  ultimaInvocacion: number;
  primeraInvocacion?: number;
  errores: number;
  ultimoError?: string;
  descripcion?: string;
}

export interface OpcionesSuscripcion {
  tipo?: TipoSuscripcion;
  descripcion?: string;
  filtro?: (evento: import('./evento-dominio').EventoDominio) => boolean;
  prioridad?: number;
  agruparCon?: string;
  replay?: boolean;
  replayDesde?: number;
  replayLimite?: number;
  autoCancelarDespues?: number;
  autoCancelarSiError?: boolean;
  maximoErrores?: number;
  capturarErrores?: boolean;
  manejarError?: (error: Error, evento: import('./evento-dominio').EventoDominio) => void;
  contexto?: Record<string, unknown>;
  tags?: string[];
  categoria?: string;
  nombre?: string;
  retrasoMs?: number;
  debounceMs?: number;
  throttleMs?: number;
  maximoInvocaciones?: number;
  minimoInvocaciones?: number;
  retry?: {
    maximoIntentos: number;
    retrasoInicialMs: number;
    retrasoMaximoMs: number;
    factorBackoff: number;
  };
}

export interface Suscripcion {
  cancelarSuscripcion(): void;
  unsubscribe(): void;
  estado: EstadoSuscripcion;
  opciones: OpcionesSuscripcion;
  id: string;
  nombreEvento: string;
  manejadorId: string;
}

export interface SuscripcionPersistente extends Suscripcion {
  tipo: 'persistente';
}

export interface SuscripcionUnaVez extends Suscripcion {
  tipo: 'unaVez';
  invocada: boolean;
}

export interface SuscripcionFiltrada extends Suscripcion {
  tipo: 'filtrada';
  filtro: (evento: import('./evento-dominio').EventoDominio) => boolean;
  eventosFiltrados: number;
}

export interface SuscripcionPrioritaria extends Suscripcion {
  tipo: 'prioritaria';
  prioridad: number;
  orden: number;
}

export interface SuscripcionAgrupada extends Suscripcion {
  tipo: 'agrupada';
  grupoId: string;
  grupoNombre: string;
  miembros: string[];
}

export interface SuscripcionReplay extends Suscripcion {
  tipo: 'replay';
  replayDesde: number;
  replayLimite: number;
  eventosReplay: import('./evento-dominio').EventoDominio[];
}

export interface SuscripcionAutoCancelable extends Suscripcion {
  tipo: 'autoCancelable';
  autoCancelarDespues: number;
  autoCancelarSiError: boolean;
  maximoErrores: number;
  temporizadorId?: ReturnType<typeof setTimeout>;
}

export interface SuscripcionCondicional extends Suscripcion {
  tipo: 'condicional';
  condicion: (evento: import('./evento-dominio').EventoDominio) => boolean;
  suspendida: boolean;
  razonSuspension?: string;
}

export interface AgrupacionSuscripcion {
  id: string;
  nombre: string;
  descripcion: string;
  suscripciones: Suscripcion[];
  activa: boolean;
  autoCancelarGrupo: boolean;
}

export interface ReplaySuscripcion {
  suscripcionId: string;
  eventos: import('./evento-dominio').EventoDominio[];
  maximoEventos: number;
  desdeMarcaTiempo?: number;
  filtro?: (evento: import('./evento-dominio').EventoDominio) => boolean;
}

export interface CancelacionSuscripcion {
  suscripcionId: string;
  motivo?: string;
  canceladaPor?: string;
  marcaTiempo: number;
  exitosa: boolean;
  error?: string;
}

export interface ManejadorSuscripcion<T = unknown> {
  id: string;
  tipo: TipoSuscripcion;
  manejador: (payload: T) => void;
  opciones: OpcionesSuscripcion;
  estado: EstadoSuscripcion;
  cancelar: () => void;
}

export interface EstadisticasSuscripcion {
  totalSuscripciones: number;
  suscripcionesActivas: number;
  suscripcionesCanceladas: number;
  suscripcionesPorTipo: Record<TipoSuscripcion, number>;
  suscripcionesPorEvento: Record<string, number>;
  erroresTotales: number;
  invocacionesTotales: number;
  promedioInvocacionesPorSuscripcion: number;
}

export function crearEstadoSuscripcion(descripcion?: string): EstadoSuscripcion {
  return {
    activa: true,
    cancelada: false,
    vecesInvocada: 0,
    ultimaInvocacion: 0,
    errores: 0,
    descripcion,
  };
}

export function crearOpcionesSuscripcion(opciones?: Partial<OpcionesSuscripcion>): OpcionesSuscripcion {
  return {
    tipo: 'persistente',
    descripcion: '',
    capturarErrores: true,
    maximoErrores: 10,
    ...opciones,
  };
}

export function esSuscripcionActiva(suscripcion: Suscripcion): boolean {
  return suscripcion.estado.activa && !suscripcion.estado.cancelada;
}

export function puedeCancelarse(suscripcion: Suscripcion): boolean {
  return esSuscripcionActiva(suscripcion) && !suscripcion.estado.cancelada;
}
