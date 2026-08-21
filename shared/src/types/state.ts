/**
 * Estado raíz del DAW JasWave.
 *
 * Propósito:
 *   Representar el estado completo y centralizado del DAW como la única
 *   fuente de verdad, combinando datos de proyecto, transporte, selección,
 *   UI, capacidades, historial, caché, proxies y contexto IA.
 *
 * Importancia:
 *   - Es el contrato principal entre la capa de dominio y la UI.
 *   - Garantiza inmutabilidad lógica: toda mutación pasa por el
 *     Command System y produce una nueva referencia de DAWState.
 *   - Permite serializar todo el estado a JSON para guardado, replay
 *     y sincronización en nube.
 *   - Facilita la consulta determinista de la IA mediante DAWQuery.
 *
 * Función:
 *   Exporta DAWState, DAWStateSnapshot, DAWStatePartial, DAWStateDiff,
 *   DAWStateMigration, DAWStateValidation, DAWStateMetrics,
 *   DAWStateExport, DAWStateImport, DAWStateClone, DAWStateReset,
 *   DAWStateWatch y sus interfaces relacionadas para manejo completo
 *   del estado global del DAW.
 */

import type { ProjectState } from './proyecto';
import type { TransportState } from './transport';
import type { EstadoSeleccion } from './seleccion';
import type { UIState } from './ui';
import type { CapabilityRegistry } from './capabilities';
import type { CommandStack } from './command';
import type { EventoDominio } from '../events/evento-dominio';
import type { ValorJSON } from '../events/evento-dominio';
import type { ContextoIA } from './entidades';
import type { Cache } from './entidades';
import type { Proxy } from './entidades';
import type { Historial } from './historial';

export interface DAWState {
  project: ProjectState;
  transport: TransportState;
  selection: EstadoSeleccion;
  ui: UIState;
  atajos: import('./atajos').ConfiguracionAtajos;
  capabilities: CapabilityRegistry;
  commandStack: CommandStack;
  busEventos: EventoDominio[];
  contextoIA: ContextoIA;
  cache: Cache;
  proxies: Proxy[];
  historial: Historial;
  marcaTiempo: number;
  version: string;
  esquemaVersion: string;
  dispositivoId: string;
  sesionId: string;
  usuarioId?: string;
  organizacionId?: string;
  modoColaboracion: boolean;
  sincronizado: boolean;
  ultimaSincronizacion: number;
  checksum: string;
  tamanioBytes: number;
  etiquetas: string[];
  notas: string;
  plantillaId?: string;
  presetId?: string;
  temaId?: string;
  idioma: string;
  zonaHoraria: string;
  marcaTiempoInicio: number;
  tiempoTotalUsoMs: number;
  estadisticasUso: {
    sesionesTotales: number;
    tiempoPromedioSesionMs: number;
    comandosEjecutados: number;
    eventosProcesados: number;
    erroresTotales: number;
    advertenciasTotales: number;
    exportacionesTotales: number;
    importacionesTotales: number;
    guardadosTotales: number;
    cambiosNoGuardados: number;
  };
  rendimiento: {
    cpuPromedio: number;
    memoriaPromedioMB: number;
    xrunsTotales: number;
    latenciaPromedioMs: number;
    buffersDescartados: number;
  };
  configuracionAvanzada: {
    telemetriaActiva: boolean;
    actualizacionesAutomaticas: boolean;
    confirmacionCierre: boolean;
    confirmacionSobrescritura: boolean;
    autoGuardadoActivo: boolean;
    autoGuardadoIntervalo: number;
    maximoUndo: number;
    maximoHistorial: number;
    tamanoBufferReplay: number;
    compresionGuardado: boolean;
    cifradoGuardado: boolean;
    proxy?: {
      host: string;
      puerto: number;
      usuario?: string;
      contrasena?: string;
    };
  };
  extensiones: {
    activas: string[];
    desactivadas: string[];
    pendientes: string[];
    errores: { extensionId: string; mensaje: string; marcaTiempo: number }[];
  };
  logs: {
    errores: { marcaTiempo: number; mensaje: string; stack?: string }[];
    advertencias: { marcaTiempo: number; mensaje: string }[];
    eventos: { marcaTiempo: number; nombre: string; fuente: string }[];
    maximoEntries: number;
  };
  snapshots: {
    id: string;
    nombre: string;
    marcaTiempo: number;
    tamanioBytes: number;
    thumbnail?: string;
    estado: Record<string, ValorJSON>;
  }[];
  migraciones: {
    version: string;
    aplicada: boolean;
    marcaTiempo: number;
    descripcion: string;
    errores: string[];
  }[];
  validaciones: {
    id: string;
    tipo: string;
    estado: 'pendiente' | 'ejecutando' | 'exitoso' | 'fallido';
    marcaTiempo: number;
    errores: { campo: string; mensaje: string; severidad: string }[];
  }[];
  comparaciones: {
    id: string;
    versionA: string;
    versionB: string;
    marcaTiempo: number;
    usuarioId?: string;
    diferencias: { tipo: string; entidadId: string; campo: string; valorA: ValorJSON; valorB: ValorJSON }[];
  }[];
  contexto: Record<string, ValorJSON>;
}

export interface DAWStateSnapshot {
  project: ProjectState;
  transport: TransportState;
  selection: EstadoSeleccion;
  ui: UIState;
  capabilities: CapabilityRegistry;
  commandStack: CommandStack;
  busEventos: EventoDominio[];
  contextoIA: ContextoIA;
  cache: Cache;
  proxies: Proxy[];
  historial: Historial;
  marcaTiempo: number;
  version: string;
  esquemaVersion: string;
  dispositivoId: string;
  sesionId: string;
  usuarioId?: string;
  organizacionId?: string;
  modoColaboracion: boolean;
  sincronizado: boolean;
  ultimaSincronizacion: number;
  checksum: string;
  tamanioBytes: number;
  etiquetas: string[];
  notas: string;
  plantillaId?: string;
  presetId?: string;
  temaId?: string;
  idioma: string;
  zonaHoraria: string;
  marcaTiempoInicio: number;
  tiempoTotalUsoMs: number;
  estadisticasUso: DAWState['estadisticasUso'];
  rendimiento: DAWState['rendimiento'];
  configuracionAvanzada: DAWState['configuracionAvanzada'];
  extensiones: DAWState['extensiones'];
  logs: DAWState['logs'];
  migraciones: DAWState['migraciones'];
  validaciones: DAWState['validaciones'];
  comparaciones: DAWState['comparaciones'];
  contexto: Record<string, ValorJSON>;
}

export interface DAWStatePartial {
  project?: Partial<ProjectState>;
  transport?: Partial<TransportState>;
  selection?: Partial<EstadoSeleccion>;
  ui?: Partial<UIState>;
  capabilities?: Partial<CapabilityRegistry>;
  commandStack?: Partial<CommandStack>;
  contextoIA?: Partial<ContextoIA>;
  cache?: Partial<Cache>;
  proxies?: Partial<Proxy>[];
  historial?: Partial<Historial>;
  marcaTiempo?: number;
  version?: string;
  esquemaVersion?: string;
  dispositivoId?: string;
  sesionId?: string;
  usuarioId?: string;
  organizacionId?: string;
  modoColaboracion?: boolean;
  sincronizado?: boolean;
  ultimaSincronizacion?: number;
  checksum?: string;
  tamanioBytes?: number;
  etiquetas?: string[];
  notas?: string;
  plantillaId?: string;
  presetId?: string;
  temaId?: string;
  idioma?: string;
  zonaHoraria?: string;
  marcaTiempoInicio?: number;
  tiempoTotalUsoMs?: number;
  estadisticasUso?: Partial<DAWState['estadisticasUso']>;
  rendimiento?: Partial<DAWState['rendimiento']>;
  configuracionAvanzada?: Partial<DAWState['configuracionAvanzada']>;
  extensiones?: Partial<DAWState['extensiones']>;
  logs?: Partial<DAWState['logs']>;
  migraciones?: Partial<DAWState['migraciones']>;
  validaciones?: Partial<DAWState['validaciones']>;
  comparaciones?: Partial<DAWState['comparaciones']>;
  contexto?: Record<string, ValorJSON>;
}

export interface DAWStateDiff {
  project: boolean;
  transport: boolean;
  selection: boolean;
  ui: boolean;
  capabilities: boolean;
  commandStack: boolean;
  busEventos: boolean;
  contextoIA: boolean;
  cache: boolean;
  proxies: boolean;
  historial: boolean;
  marcaTiempo: boolean;
  version: boolean;
  esquemaVersion: boolean;
  dispositivoId: boolean;
  sesionId: boolean;
  usuarioId: boolean;
  organizacionId: boolean;
  modoColaboracion: boolean;
  sincronizado: boolean;
  ultimaSincronizacion: boolean;
  checksum: boolean;
  tamanioBytes: boolean;
  etiquetas: boolean;
  notas: boolean;
  plantillaId: boolean;
  presetId: boolean;
  temaId: boolean;
  idioma: boolean;
  zonaHoraria: boolean;
  marcaTiempoInicio: boolean;
  tiempoTotalUsoMs: boolean;
  estadisticasUso: boolean;
  rendimiento: boolean;
  configuracionAvanzada: boolean;
  extensiones: boolean;
  logs: boolean;
  migraciones: boolean;
  validaciones: boolean;
  comparaciones: boolean;
  contexto: boolean;
  timestamp: number;
}

export interface DAWStateMigration {
  versionOrigen: string;
  versionDestino: string;
  esquemaVersion: string;
  migraciones: {
    nombre: string;
    descripcion: string;
    ejecutar: (estado: DAWState) => DAWState;
    reversible: boolean;
  }[];
  validar: (estado: DAWState) => boolean;
}

export interface DAWStateValidation {
  id: string;
  estado: 'pendiente' | 'validando' | 'valido' | 'invalido';
  marcaTiempo: number;
  errores: {
    campo: string;
    mensaje: string;
    severidad: 'error' | 'advertencia' | 'info';
    entidadId?: string;
    solucion?: string;
  }[];
  advertencias: {
    campo: string;
    mensaje: string;
    entidadId?: string;
  }[];
  resumen: {
    totalErrores: number;
    totalAdvertencias: number;
    camposAfectados: string[];
  };
}

export interface DAWStateMetrics {
  marcaTiempo: number;
  proyecto: {
    pistas: number;
    clips: number;
    plugins: number;
    duracion: number;
  };
  rendimiento: {
    cpu: number;
    memoriaMB: number;
    xruns: number;
    latenciaMs: number;
  };
  uso: {
    comandos: number;
    eventos: number;
    errores: number;
    advertencias: number;
  };
}

export interface DAWStateExport {
  formato: 'json' | 'binary' | 'compressed' | 'encrypted';
  incluirProyecto: boolean;
  incluirTransporte: boolean;
  incluirSeleccion: boolean;
  incluirUI: boolean;
  incluirCapabilities: boolean;
  incluirCommandStack: boolean;
  incluirBusEventos: boolean;
  incluirContextoIA: boolean;
  incluirCache: boolean;
  incluirProxies: boolean;
  incluirHistorial: boolean;
  incluirConfiguracion: boolean;
  incluirEstadisticas: boolean;
  incluirRendimiento: boolean;
  incluirExtensiones: boolean;
  incluirLogs: boolean;
  incluirMigraciones: boolean;
  incluirValidaciones: boolean;
  incluirComparaciones: boolean;
  incluirContexto: boolean;
  comprimir: boolean;
  encriptar: boolean;
  contrasena?: string;
  ruta?: string;
}

export interface DAWStateImport {
  ruta: string;
  formato: 'json' | 'binary' | 'compressed' | 'encrypted';
  estrategia: 'reemplazar' | 'fusionar' | 'mantener';
  incluirProyecto: boolean;
  incluirTransporte: boolean;
  incluirSeleccion: boolean;
  incluirUI: boolean;
  incluirCapabilities: boolean;
  incluirCommandStack: boolean;
  incluirBusEventos: boolean;
  incluirContextoIA: boolean;
  incluirCache: boolean;
  incluirProxies: boolean;
  incluirHistorial: boolean;
  incluirConfiguracion: boolean;
  incluirEstadisticas: boolean;
  incluirRendimiento: boolean;
  incluirExtensiones: boolean;
  incluirLogs: boolean;
  incluirMigraciones: boolean;
  incluirValidaciones: boolean;
  incluirComparaciones: boolean;
  incluirContexto: boolean;
  contrasena?: string;
  validarIntegridad: boolean;
  ejecutarMigraciones: boolean;
  crearBackup: boolean;
}

export interface DAWStateClone {
  nombre: string;
  incluirProyecto: boolean;
  incluirTransporte: boolean;
  incluirSeleccion: boolean;
  incluirUI: boolean;
  incluirCapabilities: boolean;
  incluirCommandStack: boolean;
  incluirBusEventos: boolean;
  incluirContextoIA: boolean;
  incluirCache: boolean;
  incluirProxies: boolean;
  incluirHistorial: boolean;
  incluirConfiguracion: boolean;
  incluirEstadisticas: boolean;
  incluirRendimiento: boolean;
  incluirExtensiones: boolean;
  incluirLogs: boolean;
  incluirMigraciones: boolean;
  incluirValidaciones: boolean;
  incluirComparaciones: boolean;
  incluirContexto: boolean;
  limpiarIdentificadores: boolean;
  reiniciarContadores: boolean;
}

export interface DAWStateReset {
  mantenerProyecto: boolean;
  mantenerTransporte: boolean;
  mantenerSeleccion: boolean;
  mantenerUI: boolean;
  mantenerCapabilities: boolean;
  mantenerConfiguracion: boolean;
  limpiarCommandStack: boolean;
  limpiarBusEventos: boolean;
  limpiarContextoIA: boolean;
  limpiarCache: boolean;
  limpiarProxies: boolean;
  limpiarHistorial: boolean;
  limpiarLogs: boolean;
  limpiarMigraciones: boolean;
  limpiarValidaciones: boolean;
  limpiarComparaciones: boolean;
  limpiarContexto: boolean;
  reiniciarContadores: boolean;
  motivo?: string;
}

export interface DAWStateWatch {
  id: string;
  nombre: string;
  activo: boolean;
  campos: (keyof DAWState)[];
  filtro?: (estado: DAWState, estadoAnterior: DAWState) => boolean;
  callback: (estado: DAWState, estadoAnterior: DAWState, cambios: string[]) => void;
  inmediato: boolean;
  debounceMs?: number;
  throttleMs?: number;
}

export interface DAWStateChange {
  watchId: string;
  marcaTiempo: number;
  cambios: string[];
  estadoAnterior: Record<string, ValorJSON>;
  estadoNuevo: Record<string, ValorJSON>;
}
