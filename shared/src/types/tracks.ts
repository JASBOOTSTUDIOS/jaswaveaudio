/**
 * Tipos de tracks del DAW.
 *
 * Propósito:
 *   Definir la jerarquía completa de tracks del proyecto como discriminated
 *   union, representando audio, MIDI, instrumentos, carpetas, buses,
 *   VCA, grupos, envíos, recepciones, configuraciones y metadatos.
 *
 * Importancia:
 *   - Permite tipado fuerte y exhaustivo según el tipo de track.
 *   - Facilita la consulta de la IA y la renderización condicional en UI.
 *   - Garantiza que cada variante exponga solo los campos relevantes
 *     para su dominio.
 *   - Soporta características avanzadas como folders anidados, VCA,
 *     grupos, envíos pre/post fader, receives, sidechains, freeze,
 *     armado, solo seguro, mute seguro, color, tags, orden y más.
 *
 * Función:
 *   Exporta BaseTrack y las variantes discriminadas por `tipo`:
 *   AudioTrack, MidiTrack, InstrumentTrack, FolderTrack, BusTrack,
 *   VcaTrack, GroupTrack, MasterTrack, junto con interfaces auxiliares
 *   para configuración, metadatos, estadísticas y relaciones.
 */

import type { Clip } from './clips';
import type { PluginInfo } from './entidades';
import type { AutomatizacionInfo } from './entidades';
import type { Envio } from './routing';
import type { Receive } from './entidades';
import type { Fade } from './entidades';
import type { Marcador } from './entidades';
import type { Medio } from './entidades';
import type { ValorJSON } from '../events/evento-dominio';

export type TipoTrack = 'audio' | 'midi' | 'instrumento' | 'carpeta' | 'bus' | 'vca' | 'grupo' | 'master';
export type RolTrack = 'normal' | 'carpeta' | 'bus' | 'vca' | 'grupo' | 'master' | 'retorno' | 'envio';
export type EstadoTrack = 'activo' | 'silenciado' | 'solo' | 'armado' | 'frozen' | 'grabando' | 'inactivo';

export interface BaseTrack {
  id: string;
  nombre: string;
  nombreOriginal: string;
  color: string;
  icono?: string;
  tipo: TipoTrack;
  rol: RolTrack;
  estado: EstadoTrack;
  volumen: number;
  volumenOriginal: number;
  paneo: number;
  paneoOriginal: number;
  silenciada: boolean;
  soloActiva: boolean;
  armada: boolean;
  frozen: boolean;
  soloSeguro: boolean;
  muteSeguro: boolean;
  orden: number;
  profundidad: number;
  padreId?: string;
  hijos: string[];
  takeFolderId?: string;
  clips: Clip[];
  plugins: PluginInfo[];
  automatizaciones: AutomatizacionInfo[];
  envios: Envio[];
  receives: Receive[];
  fades: Fade[];
  marcadores: Marcador[];
  medios: Medio[];
  tags: string[];
  comentario?: string;
  notas: string;
  modificado: boolean;
  fechaCreacion: number;
  fechaModificacion: number;
  estadisticas: {
    clipsTotales: number;
    clipsAudio: number;
    clipsMidi: number;
    duracionTotal: number;
    duracionUtil: number;
    pluginsTotales: number;
    automatizacionesTotales: number;
    puntosAutomatizacion: number;
    enviosTotales: number;
    receivesTotales: number;
    fadesTotales: number;
    marcadoresTotales: number;
    mediosTotales: number;
    eventosTotales: number;
  };
  configuracion: {
    cuantizacion: number;
    delayCompensacion: number;
    retardoSincronizacion: number;
    filtroEntrada: boolean;
    filtroSalida: boolean;
    monitorizarEntrada: boolean;
    grabacionAutomática: boolean;
    sobrescrituraAutomatica: boolean;
    cuantizarGrabacion: boolean;
    loop: boolean;
    punchIn: number;
    punchOut: number;
    metronomo: boolean;
    click: boolean;
    preRoll: boolean;
    postRoll: boolean;
  };
  colorDefecto: string;
  visible: boolean;
  bloqueada: boolean;
  seleccionada: boolean;
  enRuta: boolean;
  enSidechain: boolean;
  enLoop: boolean;
  enEscena: boolean;
  preset?: string;
  plantilla?: string;
  controladoresVinculados: string[];
  superficiesVinculadas: string[];
  metadatos: Record<string, ValorJSON>;
}

export interface AudioTrack extends BaseTrack {
  tipo: 'audio';
  clips: Array<import('./clips').AudioClip | import('./clips').MidiClip>;
  entrada?: string;
  salida?: string;
  waveform?: number[];
  formato: 'mono' | 'stereo' | 'multicanal' | 'surround' | 'binaural';
  canales: number;
  sampleRate: number;
  bitDepth: number;
  latenciaEntrada: number;
  latenciaSalida: number;
  bufferSize: number;
  dispositivoEntrada: string;
  dispositivoSalida: string;
  gainStaging: number;
  headroom: number;
  phase: number;
  stereoCorrelation: number;
  frecuenciaFundamental?: number;
  notaFundamental?: string;
  lufs: number;
  rangoDinamico: number;
  clipping: boolean;
  xruns: number;
  ultimoXrun: number;
}

export interface MidiTrack extends BaseTrack {
  tipo: 'midi';
  clips: import('./clips').MidiClip[];
  entrada?: string;
  salida?: string;
  canal: number;
  canalOmni: boolean;
  cuantizacion: number;
  filtro: {
    notasMin: number;
    notasMax: number;
    ccMin: number;
    ccMax: number;
    tipos: string[];
  };
  mpe: boolean;
  mpeZonaInferior: number;
  mpeZonaSuperior: number;
  mpeDimensiones: number;
  retardoSincronizacion: number;
  modoReloj: 'interno' | 'externo' | 'midiClock' | 'mtc' | 'link';
  transmitirReloj: boolean;
  transmitirMTC: boolean;
  transmitirMidi: boolean;
  recibirMidi: boolean;
  filtroReloj: boolean;
  filtroActiveSense: boolean;
  filtroSysEx: boolean;
  programaInicial?: number;
  bancoInicial?: number;
}

export interface InstrumentTrack extends BaseTrack {
  tipo: 'instrumento';
  clips: import('./clips').MidiClip[];
  instrumento: PluginInfo;
  entrada?: string;
  salida?: string;
  canal: number;
  canalOmni: boolean;
  cuantizacion: number;
  mpe: boolean;
  mpeZonaInferior: number;
  mpeZonaSuperior: number;
  mpeDimensiones: number;
  retardoSincronizacion: number;
  modoReloj: 'interno' | 'externo' | 'midiClock' | 'mtc' | 'link';
  transmitirReloj: boolean;
  transmitirMTC: boolean;
  transmitirMidi: boolean;
  recibirMidi: boolean;
  filtroReloj: boolean;
  filtroActiveSense: boolean;
  filtroSysEx: boolean;
  programaInicial?: number;
  bancoInicial?: number;
  presetInicial?: string;
}

export interface FolderTrack extends BaseTrack {
  tipo: 'carpeta';
  hijos: string[];
  expandida: boolean;
  colorHijos: boolean;
  heredarVolumen: boolean;
  heredarPaneo: boolean;
  heredarMute: boolean;
  heredarSolo: boolean;
  heredarPlugins: boolean;
  modoGrupo: 'grupo' | 'vca' | 'bus' | 'fx';
  busDestino?: string;
}

export interface BusTrack extends BaseTrack {
  tipo: 'bus';
  tracksEnviando: { trackId: string; cantidad: number; pan?: number; muted?: boolean; preFader?: boolean }[];
  formato: 'mono' | 'stereo' | 'multicanal' | 'surround' | 'binaural';
  canales: number;
  plugins: PluginInfo[];
  automatizaciones: AutomatizacionInfo[];
  envios: Envio[];
  receives: Receive[];
  entrada?: string;
  salida?: string;
  gainStaging: number;
  headroom: number;
  phase: number;
  stereoCorrelation: number;
  frecuenciaFundamental?: number;
  notaFundamental?: string;
  lufs: number;
  rangoDinamico: number;
  clipping: boolean;
  xruns: number;
  ultimoXrun: number;
}

export interface VcaTrack extends BaseTrack {
  tipo: 'vca';
  tracksVinculadas: string[];
  modo: 'vca' | 'grupo' | 'dcafollower';
  seguimiento: boolean;
  curvas: { trackId: string; curva: string }[];
}

export interface GroupTrack extends BaseTrack {
  tipo: 'grupo';
  hijos: string[];
  expandida: boolean;
  modoGrupo: 'grupo' | 'vca' | 'bus' | 'fx';
  busDestino?: string;
  colorHijos: boolean;
  heredarVolumen: boolean;
  heredarPaneo: boolean;
  heredarMute: boolean;
  heredarSolo: boolean;
  heredarPlugins: boolean;
}

export interface MasterTrack extends BaseTrack {
  tipo: 'master';
  plugins: PluginInfo[];
  automatizaciones: AutomatizacionInfo[];
  formato: 'mono' | 'stereo' | 'multicanal' | 'surround' | 'binaural' | 'atmos' | 'dts';
  canales: number;
  sampleRate: number;
  bitDepth: number;
  bufferSize: number;
  dispositivoSalida: string;
  gainStaging: number;
  headroom: number;
  phase: number;
  stereoCorrelation: number;
  frecuenciaFundamental?: number;
  notaFundamental?: string;
  lufs: number;
  rangoDinamico: number;
  clipping: boolean;
  xruns: number;
  ultimoXrun: number;
  limitador: {
    activo: boolean;
    umbral: number;
    gananciaSalida: number;
    release: number;
    knee: 'hard' | 'soft';
    lookahead: boolean;
  };
  monitoreo: {
    activo: boolean;
    modo: 'stereo' | 'mono' | 'multicanal' | 'surround' | 'binaural';
    nivel: number;
  };
  dither: {
    activo: boolean;
    tipo: 'rectangular' | 'triangular' | 'moldeado';
    bits: number;
  };
  normalizacion: {
    activa: boolean;
    objetivo: number;
    tipo: 'integrated' | 'truePeak' | 'loudness';
  };
}

export type Track = AudioTrack | MidiTrack | InstrumentTrack | FolderTrack | BusTrack | VcaTrack | GroupTrack | MasterTrack;

export function esTrackAudio(track: Track): track is AudioTrack {
  return track.tipo === 'audio';
}

export function esTrackMidi(track: Track): track is MidiTrack {
  return track.tipo === 'midi';
}

export function esTrackInstrumento(track: Track): track is InstrumentTrack {
  return track.tipo === 'instrumento';
}

export function esTrackCarpeta(track: Track): track is FolderTrack {
  return track.tipo === 'carpeta';
}

export function esTrackBus(track: Track): track is BusTrack {
  return track.tipo === 'bus';
}

export function esTrackVCA(track: Track): track is VcaTrack {
  return track.tipo === 'vca';
}

export function esTrackGrupo(track: Track): track is GroupTrack {
  return track.tipo === 'grupo';
}

export function esTrackMaster(track: Track): track is MasterTrack {
  return track.tipo === 'master';
}

export function esTrackDeAudio(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'bus' || track.tipo === 'master';
}

export function esTrackDeMidi(track: Track): boolean {
  return track.tipo === 'midi' || track.tipo === 'instrumento' || track.tipo === 'audio';
}

export function esTrackDeControl(track: Track): boolean {
  return track.tipo === 'vca' || track.tipo === 'grupo' || track.tipo === 'carpeta';
}

export function puedeGrabar(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento';
}

export function puedeArmar(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento';
}

export function puedeSolo(track: Track): boolean {
  return track.tipo !== 'master';
}

export function puedeMute(track: Track): boolean {
  return track.tipo !== 'master';
}

export function puedeFrozen(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento';
}

export function puedeRecibirEnvio(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'bus' || track.tipo === 'master';
}

export function puedeEnviar(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento' || track.tipo === 'bus';
}

export function puedeTenerPlugins(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento' || track.tipo === 'bus' || track.tipo === 'master';
}

export function puedeTenerAutomatizacion(track: Track): boolean {
  return true;
}

export function puedeTenerClips(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento';
}

export function puedeTenerHijos(track: Track): boolean {
  return track.tipo === 'carpeta' || track.tipo === 'grupo';
}

export function puedeTenerVinculados(track: Track): boolean {
  return track.tipo === 'vca' || track.tipo === 'grupo';
}

export function esTrackVisible(track: Track): boolean {
  return track.visible && !track.bloqueada;
}

export function esTrackEditable(track: Track): boolean {
  return !track.bloqueada;
}

export function esTrackExportable(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'bus' || track.tipo === 'master';
}

export function esTrackRenderizable(track: Track): boolean {
  return track.tipo === 'audio' || track.tipo === 'midi' || track.tipo === 'instrumento' || track.tipo === 'bus' || track.tipo === 'master';
}

export function obtenerNivelPico(track: BaseTrack): number {
  return track.estadisticas.clipsTotales > 0 ? 0.8 : 0;
}

export function obtenerNivelRMS(track: BaseTrack): number {
  return track.estadisticas.clipsTotales > 0 ? 0.6 : 0;
}

export function obtenerReduccionGanancia(track: BaseTrack): number {
  return track.estadisticas.pluginsTotales > 0 ? 2 : 0;
}
