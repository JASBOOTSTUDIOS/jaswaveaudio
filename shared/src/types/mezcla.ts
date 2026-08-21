/**
 * Tipos de mezcla y canal maestro del DAW.
 *
 * Propósito:
 *   Modelar el canal maestro y la estructura de mezcla del proyecto,
 *   incluyendo EQ, compresor, envíos, inserciones y parámetros globales.
 *
 * Importancia:
 *   - Centraliza los parámetros de mezcla para el motor de audio,
 *     la UI del mezclador y la automatización.
 *   - Permite persistir presets de mezcla y comparar configuraciones.
 *   - Facilita la consulta de la IA sobre el estado de la mezcla.
 *
 * Función:
 *   Exporta MasterChannel, MixerChannel, EQParametros, CompresorParametros,
 *   ChannelStrip y sus niveles asociados.
 */

export interface EQParametros {
  graves: number;
  medios: number;
  agudos: number;
  habilitado: boolean;
  gravesFrecuencia: number;
  mediosFrecuencia: number;
  agudosFrecuencia: number;
  gravesQ: number;
  mediosQ: number;
  agudosQ: number;
  tipo: 'parametrico' | 'graficos' | 'analogico';
}

export interface CompresorParametros {
  umbral: number;
  relacion: number;
  ataque: number;
  liberacion: number;
  gananciaSalida: number;
  habilitado: boolean;
  tipo: 'optico' | 'fet' | 'vca' | 'digital';
  lookahead: boolean;
  knee: 'hard' | 'soft';
}

export interface ChannelStrip {
  volumen: number;
  paneo: number;
  muted: boolean;
  solo: boolean;
  eq: EQParametros;
  compresor: CompresorParametros;
  envios: { busId: string; cantidad: number; preFader: boolean }[];
  inserts: import('./entidades').PluginInfo[];
  nivelPico: number;
  nivelRMS: number;
  reduccionGain: number;
}

export interface MasterChannel {
  volumen: number;
  paneo: number;
  muted: boolean;
  solo: boolean;
  eq: EQParametros;
  compresor: CompresorParametros;
  limitador: {
    habilitado: boolean;
    umbral: number;
    gananciaSalida: number;
    release: number;
  };
  nivelPico: number;
  nivelRMS: number;
  reduccionGain: number;
  corrupcion: boolean;
}

export interface MixerChannel {
  trackId: string;
  volumen: number;
  paneo: number;
  muted: boolean;
  solo: boolean;
  eq: EQParametros;
  compresor: CompresorParametros;
  envios: { busId: string; cantidad: number }[];
  nivelPico: number;
  nivelRMS: number;
  reduccionGain: number;
}
