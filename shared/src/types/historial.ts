/**
 * Sistema de historial del dominio JasWave.
 *
 * Propósito:
 *   Modelar el historial de acciones del usuario y del sistema para
 *   permitir navegación temporal, comparación de versiones, replay
 *   y auditoría completa del flujo de trabajo.
 *
 * Importancia:
 *   - Es la base para funcionalidades de undo/redo, timeline histórico
 *     y reconstrucción de sesiones.
 *   - Permite a la IA analizar patrones de uso y sugerir acciones
 *     basadas en el historial reciente.
 *   - Facilita la sincronización en nube y la resolución de conflictos
 *     mediante marcas de tiempo y diferencias.
 *
 * Función:
 *   Exporta Historial, AccionHistorial, FiltroHistorial, EventoHistorial,
 *   VersionHistorial y helpers de navegación y consulta del historial.
 */

export interface AccionHistorial {
  id: string;
  tipo: 'comando' | 'evento' | 'estado' | 'sesion' | 'grabacion' | 'reproduccion' | 'importacion' | 'exportacion';
  nombre: string;
  descripcion: string;
  marcaTiempo: number;
  usuarioId?: string;
  datos: Record<string, unknown>;
  estadoAnterior?: Record<string, unknown>;
  estadoPosterior?: Record<string, unknown>;
  comandosAfectados: string[];
  eventosAfectados: string[];
  duracionMs: number;
  exito: boolean;
  error?: string;
}

export interface EventoHistorial {
  id: string;
  accionId: string;
  nombreEvento: string;
  payload: Record<string, unknown>;
  marcaTiempo: number;
}

export interface VersionHistorial {
  id: string;
  accionId: string;
  nombre: string;
  descripcion: string;
  marcaTiempo: number;
  snapshot: Record<string, unknown>;
  thumbnail?: string;
  tamanioBytes: number;
  autor: string;
}

export interface FiltroHistorial {
  tipo?: AccionHistorial['tipo'];
  desde?: number;
  hasta?: number;
  nombre?: string;
  usuarioId?: string;
  exito?: boolean;
  limite?: number;
}

export interface Historial {
  acciones: AccionHistorial[];
  eventos: EventoHistorial[];
  versiones: VersionHistorial[];
  maximoAcciones: number;
  maximoEventos: number;
  maximoVersiones: number;
  accionActualId: string | null;
  indiceActual: number;
}

export interface NavegacionHistorial {
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  accionDeshacer?: AccionHistorial;
  accionRehacer?: AccionHistorial;
  distanciaInicio: number;
  distanciaFin: number;
}
