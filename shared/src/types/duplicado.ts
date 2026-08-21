/**
 * Tipos de duplicado de entidades del dominio JasWave.
 *
 * Propósito:
 *   Definir las estructuras para duplicar entidades del DAW (pistas,
 *   clips, plugins, automatizaciones, etc.) con opciones de offset,
 *   renombrado, herencia de propiedades y validación de integridad.
 *
 * Importancia:
 *   - Es una operación fundamental en el flujo de trabajo de un DAW.
 *   - Permite clonar entidades manteniendo o modificando propiedades
 *     como nombre, posición, color, automatizaciones y conexiones.
 *   - Facilita la creación de variantes, respaldos y experimentación
 *     sin afectar el original.
 *
 * Función:
 *   Exporta OpcionesDuplicado, ResultadoDuplicado y variantes
 *   específicas para cada tipo de entidad del DAW, junto con
 *   helpers de validación y aplicación de duplicados.
 */

export type TipoEntidadDuplicable = 'pista' | 'clip' | 'plugin' | 'automatizacion' | 'marcador' | 'region' | 'toma' | 'vca' | 'bus' | 'loop' | 'escena' | 'preset' | 'plantilla' | 'tema' | 'atajo' | 'medio' | 'nota' | 'evento' | 'insert' | 'envio' | 'ruta' | 'sidechain' | 'puente' | 'grupoRuteo';

export interface OpcionesDuplicado {
  tipo: TipoEntidadDuplicable;
  idEntidad: string;
  nuevoNombre?: string;
  desplazamientoInicio?: number;
  desplazamientoPista?: number;
  mantenerColor: boolean;
  mantenerNombre: boolean;
  mantenerConexiones: boolean;
  mantenerAutomatizaciones: boolean;
  mantenerPlugins: boolean;
  mantenerFades: boolean;
  mantenerWaveform: boolean;
  mantenerNotasMidi: boolean;
  mantenerMetadatos: boolean;
  mantenerTags: boolean;
  mantenerComentarios: boolean;
  prefijoNombre?: string;
  sufijoNombre?: string;
  numeroCopias: number;
  destino?: {
    pistaId?: string;
    busId?: string;
    carpetaId?: string;
    escenaId?: string;
  };
}

export interface ResultadoDuplicado {
  exito: boolean;
  tipo: TipoEntidadDuplicable;
  idOriginal: string;
  idsDuplicados: string[];
  nombresDuplicados: string[];
  errores: { campo: string; mensaje: string }[];
  advertencias: { campo: string; mensaje: string }[];
  marcaTiempo: number;
}

export interface DuplicadoPista {
  tipo: 'pista';
  opciones: OpcionesDuplicado & { tipo: 'pista' };
  resultado: ResultadoDuplicado;
  pistasDuplicadas: {
    id: string;
    nombre: string;
    color: string;
    clips: string[];
    plugins: string[];
    automatizaciones: string[];
    envios: { busId: string; cantidad: number }[];
    receives: { pistaId: string; cantidad: number }[];
  }[];
}

export interface DuplicadoClip {
  tipo: 'clip';
  opciones: OpcionesDuplicado & { tipo: 'clip' };
  resultado: ResultadoDuplicado;
  clipsDuplicados: {
    id: string;
    nombre: string;
    trackId: string;
    inicio: number;
    duracion: number;
    fadeIn: { duracion: number; curva: string } | null;
    fadeOut: { duracion: number; curva: string } | null;
    waveform?: number[];
    notasMidi?: { id: string; pitch: number; velocidad: number; inicio: number; duracion: number }[];
  }[];
}

export interface DuplicadoPlugin {
  tipo: 'plugin';
  opciones: OpcionesDuplicado & { tipo: 'plugin' };
  resultado: ResultadoDuplicado;
  pluginsDuplicados: {
    id: string;
    nombre: string;
    fabricante: string;
    presetActual?: string;
    parametros: { id: string; nombre: string; valor: number }[];
  }[];
}

export interface DuplicadoAutomatizacion {
  tipo: 'automatizacion';
  opciones: OpcionesDuplicado & { tipo: 'automatizacion' };
  resultado: ResultadoDuplicado;
  automatizacionesDuplicadas: {
    id: string;
    trackId: string;
    parametro: string;
    puntos: { tiempo: number; valor: number }[];
    modo: string;
    color: string;
  }[];
}

export interface DuplicadoMarcador {
  tipo: 'marcador';
  opciones: OpcionesDuplicado & { tipo: 'marcador' };
  resultado: ResultadoDuplicado;
  marcadoresDuplicados: {
    id: string;
    nombre: string;
    tiempo: number;
    color: string;
    tipo: string;
    regionInicio?: number;
    regionFin?: number;
  }[];
}

export interface DuplicadoRegion {
  tipo: 'region';
  opciones: OpcionesDuplicado & { tipo: 'region' };
  resultado: ResultadoDuplicado;
  regionesDuplicadas: {
    id: string;
    nombre: string;
    inicio: number;
    fin: number;
    color: string;
    trackIds: string[];
    loop: boolean;
  }[];
}

export interface DuplicadoToma {
  tipo: 'toma';
  opciones: OpcionesDuplicado & { tipo: 'toma' };
  resultado: ResultadoDuplicado;
  tomasDuplicadas: {
    id: string;
    nombre: string;
    pistaId: string;
    archivo: string;
    formato: string;
    sampleRate: number;
    bitDepth: number;
    canales: number;
  }[];
}

export interface DuplicadoVCA {
  tipo: 'vca';
  opciones: OpcionesDuplicado & { tipo: 'vca' };
  resultado: ResultadoDuplicado;
  vcasDuplicados: {
    id: string;
    nombre: string;
    nivel: number;
    solo: boolean;
    silenciado: boolean;
    paneo: number;
    tracksVinculadas: string[];
  }[];
}

export interface DuplicadoBus {
  tipo: 'bus';
  opciones: OpcionesDuplicado & { tipo: 'bus' };
  resultado: ResultadoDuplicado;
  busesDuplicados: {
    id: string;
    nombre: string;
    tipo: string;
    volumen: number;
    paneo: number;
    envios: { busId: string; cantidad: number }[];
    plugins: string[];
    automatizaciones: string[];
  }[];
}

export interface DuplicadoLoop {
  tipo: 'loop';
  opciones: OpcionesDuplicado & { tipo: 'loop' };
  resultado: ResultadoDuplicado;
  loopsDuplicados: {
    id: string;
    nombre: string;
    pistaId: string;
    inicio: number;
    duracion: number;
    sincronizado: boolean;
    cuantizado: boolean;
  }[];
}

export interface DuplicadoEscena {
  tipo: 'escena';
  opciones: OpcionesDuplicado & { tipo: 'escena' };
  resultado: ResultadoDuplicado;
  escenasDuplicadas: {
    id: string;
    nombre: string;
    clips: { clipId: string; pistaId: string; estado: string }[];
    color: string;
    transicion: string;
  }[];
}

export interface DuplicadoPreset {
  tipo: 'preset';
  opciones: OpcionesDuplicado & { tipo: 'preset' };
  resultado: ResultadoDuplicado;
  presetsDuplicados: {
    id: string;
    nombre: string;
    categoria: string;
    autor: string;
    datos: Record<string, unknown>;
  }[];
}

export interface DuplicadoPlantilla {
  tipo: 'plantilla';
  opciones: OpcionesDuplicado & { tipo: 'plantilla' };
  resultado: ResultadoDuplicado;
  plantillasDuplicadas: {
    id: string;
    nombre: string;
    categoria: string;
    autor: string;
    datos: Record<string, unknown>;
  }[];
}

export interface DuplicadoTema {
  tipo: 'tema';
  opciones: OpcionesDuplicado & { tipo: 'tema' };
  resultado: ResultadoDuplicado;
  temasDuplicados: {
    id: string;
    nombre: string;
    autor: string;
    fondo: string;
    superficie: string;
    borde: string;
    texto: string;
    acento: string;
  }[];
}

export interface DuplicadoMedio {
  tipo: 'medio';
  opciones: OpcionesDuplicado & { tipo: 'medio' };
  resultado: ResultadoDuplicado;
  mediosDuplicados: {
    id: string;
    nombre: string;
    tipo: string;
    ruta: string;
    duracion: number;
    metadatos: Record<string, unknown>;
  }[];
}

export interface DuplicadoNota {
  tipo: 'nota';
  opciones: OpcionesDuplicado & { tipo: 'nota' };
  resultado: ResultadoDuplicado;
  notasDuplicadas: {
    id: string;
    pitch: number;
    velocidad: number;
    inicio: number;
    duracion: number;
    canal: number;
  }[];
}

export interface DuplicadoEvento {
  tipo: 'evento';
  opciones: OpcionesDuplicado & { tipo: 'evento' };
  resultado: ResultadoDuplicado;
  eventosDuplicados: {
    id: string;
    nombre: string;
    marcaTiempo: number;
    payload: Record<string, unknown>;
  }[];
}

export interface DuplicadoInsert {
  tipo: 'insert';
  opciones: OpcionesDuplicado & { tipo: 'insert' };
  resultado: ResultadoDuplicado;
  insertsDuplicados: {
    id: string;
    trackId: string;
    plugin: { id: string; nombre: string; fabricante: string };
    orden: number;
    activo: boolean;
  }[];
}

export interface DuplicadoEnvio {
  tipo: 'envio';
  opciones: OpcionesDuplicado & { tipo: 'envio' };
  resultado: ResultadoDuplicado;
  enviosDuplicados: {
    id: string;
    origenTrackId: string;
    destinoBusId: string;
    cantidad: number;
    pan: number;
    activo: boolean;
    preFader: boolean;
  }[];
}

export interface DuplicadoRuta {
  tipo: 'ruta';
  opciones: OpcionesDuplicado & { tipo: 'ruta' };
  resultado: ResultadoDuplicado;
  rutasDuplicadas: {
    id: string;
    origen: string;
    destino: string;
    tipo: string;
    activa: boolean;
    cantidad: number;
  }[];
}

export interface DuplicadoSidechain {
  tipo: 'sidechain';
  opciones: OpcionesDuplicado & { tipo: 'sidechain' };
  resultado: ResultadoDuplicado;
  sidechainsDuplicadas: {
    id: string;
    origenTrackId: string;
    destinoTrackId: string;
    activo: boolean;
    cantidad: number;
  }[];
}

export interface DuplicadoPuente {
  tipo: 'puente';
  opciones: OpcionesDuplicado & { tipo: 'puente' };
  resultado: ResultadoDuplicado;
  puentesDuplicados: {
    id: string;
    origenId: string;
    destinoId: string;
    tipo: string;
    activo: boolean;
    cantidad: number;
  }[];
}

export interface DuplicadoGrupoRuteo {
  tipo: 'grupoRuteo';
  opciones: OpcionesDuplicado & { tipo: 'grupoRuteo' };
  resultado: ResultadoDuplicado;
  gruposDuplicados: {
    id: string;
    nombre: string;
    tipo: string;
    busId: string;
    canales: { id: string; numeroCanal: number; nombre: string }[];
  }[];
}

export type ResultadoDuplicadoEspecifico =
  | DuplicadoPista
  | DuplicadoClip
  | DuplicadoPlugin
  | DuplicadoAutomatizacion
  | DuplicadoMarcador
  | DuplicadoRegion
  | DuplicadoToma
  | DuplicadoVCA
  | DuplicadoBus
  | DuplicadoLoop
  | DuplicadoEscena
  | DuplicadoPreset
  | DuplicadoPlantilla
  | DuplicadoTema
  | DuplicadoMedio
  | DuplicadoNota
  | DuplicadoEvento
  | DuplicadoInsert
  | DuplicadoEnvio
  | DuplicadoRuta
  | DuplicadoSidechain
  | DuplicadoPuente
  | DuplicadoGrupoRuteo;

export function crearOpcionesDuplicado(tipo: TipoEntidadDuplicable, idEntidad: string, opciones?: Partial<OpcionesDuplicado>): OpcionesDuplicado {
  return {
    tipo,
    idEntidad,
    mantenerColor: true,
    mantenerNombre: false,
    mantenerConexiones: true,
    mantenerAutomatizaciones: true,
    mantenerPlugins: true,
    mantenerFades: true,
    mantenerWaveform: true,
    mantenerNotasMidi: true,
    mantenerMetadatos: true,
    mantenerTags: true,
    mantenerComentarios: true,
    numeroCopias: 1,
    ...opciones,
  };
}

export function crearResultadoDuplicado(tipo: TipoEntidadDuplicable, idOriginal: string, idsDuplicados: string[]): ResultadoDuplicado {
  return {
    exito: idsDuplicados.length > 0,
    tipo,
    idOriginal,
    idsDuplicados,
    nombresDuplicados: idsDuplicados.map(() => ''),
    errores: [],
    advertencias: [],
    marcaTiempo: Date.now(),
  };
}
