/**
 * Matriz de enrutamiento de audio y MIDI del proyecto.
 *
 * Propósito:
 *   Modelar las conexiones entre tracks, buses, envíos, sidechains,
 *   inserts, puentes y rutas directas dentro del DAW, permitiendo
 *   consultar, modificar, validar y persistir la topología de señal.
 *
 * Importancia:
 *   - Centraliza la topología de audio para el motor, la UI de mezcla
 *     y la IA.
 *   - Permite validar rutas, detectar bucles, calcular ganancias
 *     y latencias de forma determinista.
 *   - Facilita la serialización del proyecto sin perder la estructura
 *     de mezcla.
 *   - Soporta características avanzadas como sidechain, envíos pre/post
 *     fader, inserciones, puentes, routing virtual y snapshots de ruteo.
 *
 * Función:
 *   Exporta RoutingMatrix, Bus, Envio, Insercion, Ruta, Sidechain,
 *   Puente, CanalRuteo, GrupoRuteo, ConexionDirecta, PresetRuteo,
 *   ValidacionRuteo, EstadisticasRuteo, HistorialRuteo y sus
 *   tipos relacionados con identificadores, niveles, paneo, estado
 *   activo, pre/post fader, fase, delay, latencia, orden, color,
 *   comentarios, tags y configuraciones avanzadas.
 */

import type { PluginInfo } from './entidades';
import type { AutomatizacionInfo } from './entidades';
import type { ValorJSON } from '../events/evento-dominio';

export interface Bus {
  id: string;
  nombre: string;
  tipo: 'audio' | 'midi' | 'aux' | 'vca' | 'fx' | 'master';
  volumen: number;
  paneo: number;
  muted: boolean;
  solo: boolean;
  plugins: PluginInfo[];
  automatizaciones: AutomatizacionInfo[];
  envios: { busId: string; cantidad: number; preFader: boolean }[];
  color: string;
  armado: boolean;
  frozen: boolean;
  icono?: string;
  comentario?: string;
  tags: string[];
  orden: number;
  fase: number;
  delay: number;
  latencia: number;
  preset?: string;
  soloSeguro: boolean;
  muteSeguro: boolean;
  nivelPico: number;
  nivelRMS: number;
  reduccionGanancia: number;
}

export interface Envio {
  id: string;
  origenTrackId: string;
  destinoBusId: string;
  cantidad: number;
  pan: number;
  activo: boolean;
  preFader: boolean;
  solo: boolean;
  tipo: 'envio' | 'retorno' | 'aux';
  nombre?: string;
  comentario?: string;
  tags: string[];
  orden: number;
  color?: string;
}

export interface Insercion {
  id: string;
  trackId: string;
  busId?: string;
  plugin: PluginInfo;
  orden: number;
  activo: boolean;
  bypass: boolean;
  wet: number;
  nombre?: string;
  comentario?: string;
  tags: string[];
  color?: string;
  latencia: number;
  tipo: 'insert' | 'envio' | 'master';
}

export interface Ruta {
  id: string;
  origen: string;
  destino: string;
  tipo: 'audio' | 'midi' | 'sidechain' | 'virtual';
  activa: boolean;
  cantidad: number;
  nombre?: string;
  comentario?: string;
  tags: string[];
  orden: number;
  fase: number;
  delay: number;
  color?: string;
}

export interface Sidechain {
  id: string;
  origenTrackId: string;
  destinoTrackId: string;
  activo: boolean;
  cantidad: number;
  fuente: 'lateral' | 'interna' | 'externa';
  nombre?: string;
  comentario?: string;
  tags: string[];
  /** Slot FX destino (opcional; primer slot con bus sidechain si omitido). */
  destinoSlotId?: string;
  orden: number;
  color?: string;
}

export interface Puente {
  id: string;
  origenId: string;
  destinoId: string;
  tipo: 'audio' | 'midi' | 'sidechain';
  activo: boolean;
  cantidad: number;
  nombre?: string;
  comentario?: string;
  tags: string[];
  orden: number;
}

export interface CanalRuteo {
  id: string;
  busId: string;
  numeroCanal: number;
  nombre: string;
  volumen: number;
  paneo: number;
  muted: boolean;
  solo: boolean;
  etiqueta?: string;
  color?: string;
}

export interface GrupoRuteo {
  id: string;
  nombre: string;
  tipo: 'stereo' | 'mono' | 'multicanal' | 'surround' | 'binaural';
  canales: CanalRuteo[];
  busId: string;
  color: string;
  solo: boolean;
  muted: boolean;
  orden: number;
}

export interface ConexionDirecta {
  id: string;
  origen: string;
  destino: string;
  tipo: 'audio' | 'midi' | 'sidechain';
  activa: boolean;
  cantidad: number;
  nombre?: string;
  comentario?: string;
  tags: string[];
  orden: number;
  color?: string;
}

export interface PresetRuteo {
  id: string;
  nombre: string;
  categoria: string;
  autor: string;
  etiquetas: string[];
  datos: ValorJSON;
  creado: number;
  modificado: number;
  publico: boolean;
  descargas: number;
  valoracion: number;
}

export interface ValidacionRuteo {
  errores: {
    id: string;
    tipo: 'bucle' | 'ruta_vacia' | 'ganancia_invalida' | 'latencia_excesiva' | 'compatibilidad' | 'plugin_faltante';
    severidad: 'error' | 'advertencia' | 'info';
    mensaje: string;
    entidadId?: string;
    solucion?: string;
  }[];
  validado: boolean;
  ultimaValidacion: number;
}

export interface EstadisticasRuteo {
  busesTotales: number;
  enviosTotales: number;
  rutasTotales: number;
  sidechainsTotales: number;
  insertsTotales: number;
  conexionesDirectasTotales: number;
  buclesDetectados: number;
  latenciaPromedio: number;
  gananciaPromedio: number;
  usoCPU: number;
  usoMemoriaMB: number;
}

export interface HistorialRuteo {
  cambios: {
    id: string;
    marcaTiempo: number;
    tipo: 'creado' | 'eliminado' | 'modificado' | 'conectado' | 'desconectado';
    entidadId: string;
    entidadTipo: string;
    estadoAnterior: Record<string, ValorJSON>;
    estadoPosterior: Record<string, ValorJSON>;
    comandoId?: string;
  }[];
  maximoCambios: number;
}

export interface RoutingMatrix {
  buses: Bus[];
  sends: Envio[];
  rutas: Ruta[];
  sidechains: Sidechain[];
  inserts: Insercion[];
  conexionesDirectas: ConexionDirecta[];
  puentes: Puente[];
  grupos: GrupoRuteo[];
  presetActual?: string;
  validacion: ValidacionRuteo;
  estadisticas: EstadisticasRuteo;
  historial: HistorialRuteo;
  ordenTracks: string[];
  ordenBuses: string[];
  snapshot?: ValorJSON;
  comentario?: string;
  etiquetas: string[];
}
