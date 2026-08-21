import type { ExploradorEstado, ExploradorArbol } from './tipos';

export interface ExploradorEventos {
  suscribir: (callback: (estado: ExploradorEstado) => void) => () => void;
  refrescar: () => Promise<ExploradorEstado>;
  establecerSeleccion: (seleccionId: string | null) => ExploradorEstado;
  establecerFiltro: (filtro: string) => ExploradorEstado;
  establecerRutaProyecto: (rutaProyecto: string | null) => ExploradorEstado;
  establecerArbol: (arbol: ExploradorArbol | null) => ExploradorEstado;
  obtenerEstado: () => ExploradorEstado;
}
