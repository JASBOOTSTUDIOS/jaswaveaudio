export interface ExploradorArchivo {
  id: string;
  nombre: string;
  ruta: string;
  extension: string;
  tamanioBytes?: number;
  fechaModificacion?: number;
  tipo?: 'audio' | 'midi' | 'video' | 'imagen' | 'documento' | 'otro';
}

export interface ExploradorCarpeta {
  id: string;
  nombre: string;
  ruta: string;
  hijos: (ExploradorCarpeta | ExploradorArchivo)[];
  expandida: boolean;
}

export type ExploradorArbol = ExploradorCarpeta | ExploradorArchivo;

export interface ExploradorEstado {
  raiz: ExploradorArbol | null;
  seleccionId: string | null;
  filtro: string;
  cargando: boolean;
  error: string | null;
  rutaProyecto: string | null;
  ultimaActualizacion: number | null;
}

export const crearExploradorVacio = (): ExploradorEstado => ({
  raiz: null,
  seleccionId: null,
  filtro: '',
  cargando: false,
  error: null,
  rutaProyecto: null,
  ultimaActualizacion: null,
});

export const marcarCargando = (estado: ExploradorEstado): ExploradorEstado => ({
  ...estado,
  cargando: true,
  error: null,
});

export const marcarError = (estado: ExploradorEstado, error: string): ExploradorEstado => ({
  ...estado,
  cargando: false,
  error,
});
