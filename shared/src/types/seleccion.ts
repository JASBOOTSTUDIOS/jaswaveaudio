/**
 * Estado de selección del dominio JasWave.
 *
 * Propósito:
 *   Representar el conjunto de entidades seleccionadas en el DAW en un
 *   momento dado, permitiendo operaciones grupales, consultas y
 *   persistencia de selecciones.
 *
 * Importancia:
 *   - Centraliza la selección sin acoplarla a componentes de UI.
 *   - Permite determinar rápidamente el contexto activo para comandos,
 *     automatizaciones y herramientas de IA.
 *   - Facilita la serialización del estado para replay y debugging.
 *   - Soporta selecciones múltiples, rangos, selecciones guardadas,
 *     historial de selección y filtros avanzados.
 *
 * Función:
 *   Exporta EstadoSeleccion, FiltroSeleccion, SeleccionGuardada,
 *   HistorialSeleccion, SeleccionRango y sus interfaces relacionadas
 *   para manejo completo de selecciones del DAW.
 */

export interface EstadoSeleccion {
  idsPistas: string[];
  idsClips: string[];
  idsMarcadores: string[];
  idsPuntosAutomatizacion: string[];
  idsParametrosPlugin: { idPlugin: string; idParametro: string }[];
  idsRegiones: string[];
  idsTomas: string[];
  idsEscenas: string[];
  idsLoops: string[];
  idsFades: string[];
  idsVCAs: string[];
  idsBuses: string[];
  idsInserts: string[];
  idsEnvios: string[];
  idsRutas: string[];
  idsSidechains: string[];
  idsPuentes: string[];
  idsGruposRuteo: string[];
  idsTemas: string[];
  idsAtajos: string[];
  idsPlantillas: string[];
  idsPresets: string[];
  idsMedios: string[];
  idsCarpetas: string[];
  idsNotas: string[];
  idsEventos: string[];
  idPrincipal: string | null;
  tipoPrincipal: 'pista' | 'clip' | 'marcador' | 'region' | 'toma' | 'escena' | 'loop' | 'fade' | 'vca' | 'bus' | 'insert' | 'envio' | 'ruta' | 'sidechain' | 'puente' | 'grupoRuteo' | 'tema' | 'atajo' | 'plantilla' | 'preset' | 'medio' | 'carpeta' | 'nota' | 'evento' | 'plugin' | 'automatizacion' | null;
  ultimaSeleccion: {
    tipo: string;
    id: string;
    marcaTiempo: number;
    metodo: 'click' | 'shiftClick' | 'ctrlClick' | 'seleccionTodo' | 'filtro' | 'busqueda' | 'comando' | 'restauracion';
  } | null;
  seleccionAnterior: EstadoSeleccion | null;
  rangoSeleccion?: {
    tipo: 'pistas' | 'clips' | 'marcadores' | 'tomas' | 'automatizacion';
    idInicio: string;
    idFin: string;
    invertido: boolean;
  };
  modoSeleccion: 'reemplazar' | 'agregar' | 'quitar' | 'invertir' | 'rango';
}

export interface FiltroSeleccion {
  tipos?: EstadoSeleccion['tipoPrincipal'][];
  ids?: string[];
  excluirIds?: string[];
  nombre?: string;
  etiqueta?: string;
  soloActivos?: boolean;
  soloVisibles?: boolean;
  soloSeleccionables?: boolean;
  limite?: number;
}

export interface SeleccionGuardada {
  id: string;
  nombre: string;
  marcaTiempo: number;
  seleccion: EstadoSeleccion;
  thumbnail?: string;
  descripcion?: string;
  etiquetas: string[];
}

export interface HistorialSeleccion {
  selecciones: EstadoSeleccion[];
  maximoSelecciones: number;
  indiceActual: number;
}

export interface SeleccionRango {
  tipo: 'pistas' | 'clips' | 'marcadores' | 'tomas' | 'automatizacion';
  idInicio: string;
  idFin: string;
  invertido: boolean;
  paso: number;
}

export interface SeleccionConsulta {
  cantidadTotal: number;
  cantidadPorTipo: Record<string, number>;
  ids: string[];
  entidades: Record<string, unknown>;
}
