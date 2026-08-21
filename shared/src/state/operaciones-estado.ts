/**
 * Operaciones runtime sobre DAWState: export, import, clone y reset.
 */

import type {
  DAWState,
  DAWStateClone,
  DAWStateExport,
  DAWStateImport,
  DAWStateReset,
} from '../types/state';
import { crearEstadoInicial } from './estado-inicial';
import { deserializarEstado, fusionarConEstadoInicial, serializarEstado } from './serializar-estado';

export interface ResultadoExportacionEstado {
  formato: DAWStateExport['formato'];
  json: string;
  estado: Partial<DAWState>;
  marcaTiempo: number;
}

export interface ResultadoImportacionEstado {
  estado: DAWState;
  estrategia: DAWStateImport['estrategia'];
  marcaTiempo: number;
}

function recortarSegunExport(estado: DAWState, opts: DAWStateExport): Partial<DAWState> {
  const out: Partial<DAWState> = {};
  if (opts.incluirProyecto) out.project = estado.project;
  if (opts.incluirTransporte) out.transport = estado.transport;
  if (opts.incluirSeleccion) out.selection = estado.selection;
  if (opts.incluirUI) out.ui = estado.ui;
  if (opts.incluirCapabilities) out.capabilities = estado.capabilities;
  if (opts.incluirCommandStack) out.commandStack = estado.commandStack;
  if (opts.incluirBusEventos) out.busEventos = estado.busEventos;
  if (opts.incluirContextoIA) out.contextoIA = estado.contextoIA;
  if (opts.incluirCache) out.cache = { ...estado.cache, archivos: new Map() };
  if (opts.incluirProxies) out.proxies = estado.proxies;
  if (opts.incluirHistorial) out.historial = estado.historial;
  if (opts.incluirConfiguracion) {
    out.configuracionAvanzada = estado.configuracionAvanzada;
    out.atajos = estado.atajos;
  }
  if (opts.incluirEstadisticas) out.estadisticasUso = estado.estadisticasUso;
  if (opts.incluirRendimiento) out.rendimiento = estado.rendimiento;
  if (opts.incluirExtensiones) out.extensiones = estado.extensiones;
  if (opts.incluirLogs) out.logs = estado.logs;
  if (opts.incluirMigraciones) out.migraciones = estado.migraciones;
  if (opts.incluirValidaciones) out.validaciones = estado.validaciones;
  if (opts.incluirComparaciones) out.comparaciones = estado.comparaciones;
  if (opts.incluirContexto) out.contexto = estado.contexto;
  out.version = estado.version;
  out.esquemaVersion = estado.esquemaVersion;
  out.marcaTiempo = Date.now();
  return out;
}

export function exportarEstadoDAW(estado: DAWState, opciones?: Partial<DAWStateExport>): ResultadoExportacionEstado {
  const opts: DAWStateExport = {
    formato: 'json',
    incluirProyecto: true,
    incluirTransporte: true,
    incluirSeleccion: true,
    incluirUI: true,
    incluirCapabilities: true,
    incluirCommandStack: false,
    incluirBusEventos: false,
    incluirContextoIA: false,
    incluirCache: false,
    incluirProxies: false,
    incluirHistorial: false,
    incluirConfiguracion: true,
    incluirEstadisticas: false,
    incluirRendimiento: false,
    incluirExtensiones: false,
    incluirLogs: false,
    incluirMigraciones: false,
    incluirValidaciones: false,
    incluirComparaciones: false,
    incluirContexto: false,
    comprimir: false,
    encriptar: false,
    ...opciones,
  };

  const recortado = recortarSegunExport(estado, opts);
  return {
    formato: opts.formato,
    json: serializarEstado(recortado as DAWState),
    estado: recortado,
    marcaTiempo: Date.now(),
  };
}

export function importarEstadoDAW(
  origen: string | Partial<DAWState>,
  opciones?: Partial<DAWStateImport>,
  estadoActual?: DAWState,
): ResultadoImportacionEstado {
  const estrategia = opciones?.estrategia ?? 'reemplazar';
  const parcial =
    typeof origen === 'string' ? (deserializarEstado(origen) as Partial<DAWState>) : origen;

  let estado: DAWState;
  if (estrategia === 'reemplazar') {
    estado = fusionarConEstadoInicial(parcial);
  } else if (estrategia === 'fusionar' && estadoActual) {
    estado = {
      ...estadoActual,
      ...parcial,
      project: { ...estadoActual.project, ...(parcial.project ?? {}) },
      transport: { ...estadoActual.transport, ...(parcial.transport ?? {}) },
      selection: { ...estadoActual.selection, ...(parcial.selection ?? {}) },
      ui: { ...estadoActual.ui, ...(parcial.ui ?? {}) },
    } as DAWState;
  } else {
    estado = estadoActual ?? fusionarConEstadoInicial(parcial);
  }

  return { estado, estrategia, marcaTiempo: Date.now() };
}

export function clonarEstadoDAW(estado: DAWState, opciones?: Partial<DAWStateClone>): DAWState {
  const clon = deserializarEstado(serializarEstado(estado));
  if (opciones?.nombre) {
    clon.project = { ...clon.project, nombre: opciones.nombre };
  }
  if (opciones?.limpiarIdentificadores) {
    clon.sesionId = crypto.randomUUID();
    clon.dispositivoId = crypto.randomUUID();
    clon.project = { ...clon.project, id: crypto.randomUUID() };
  }
  if (opciones?.reiniciarContadores) {
    clon.estadisticasUso = crearEstadoInicial().estadisticasUso;
  }
  if (opciones?.incluirCache === false) {
    clon.cache = { ...clon.cache, archivos: new Map(), bytesUsados: 0 };
  }
  if (opciones?.incluirBusEventos === false) {
    clon.busEventos = [];
  }
  if (opciones?.incluirHistorial === false) {
    clon.historial = crearEstadoInicial().historial;
  }
  clon.marcaTiempo = Date.now();
  return clon;
}

export function resetearEstadoDAW(estadoActual?: DAWState, opciones?: Partial<DAWStateReset>): DAWState {
  const fresco = crearEstadoInicial();
  if (!estadoActual || !opciones) return fresco;

  return {
    ...fresco,
    project: opciones.mantenerProyecto ? estadoActual.project : fresco.project,
    transport: opciones.mantenerTransporte ? estadoActual.transport : fresco.transport,
    selection: opciones.mantenerSeleccion ? estadoActual.selection : fresco.selection,
    ui: opciones.mantenerUI ? estadoActual.ui : fresco.ui,
    capabilities: opciones.mantenerCapabilities ? estadoActual.capabilities : fresco.capabilities,
    atajos: opciones.mantenerConfiguracion ? estadoActual.atajos : fresco.atajos,
    configuracionAvanzada: opciones.mantenerConfiguracion
      ? estadoActual.configuracionAvanzada
      : fresco.configuracionAvanzada,
    commandStack: opciones.limpiarCommandStack === false ? estadoActual.commandStack : fresco.commandStack,
    busEventos: opciones.limpiarBusEventos === false ? estadoActual.busEventos : [],
    contextoIA: opciones.limpiarContextoIA === false ? estadoActual.contextoIA : fresco.contextoIA,
    cache: opciones.limpiarCache === false ? estadoActual.cache : fresco.cache,
    proxies: opciones.limpiarProxies === false ? estadoActual.proxies : [],
    historial: opciones.limpiarHistorial === false ? estadoActual.historial : fresco.historial,
    logs: opciones.limpiarLogs === false ? estadoActual.logs : fresco.logs,
  } as DAWState;
}

export type { DAWStateClone, DAWStateExport, DAWStateImport, DAWStateReset };
