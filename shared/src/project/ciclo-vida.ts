import type { ProjectState } from '../types/proyecto';
import type { BPM } from '../types/tiempo';
import type { TimeSignature } from '../types/tiempo';
import type { RoutingMatrix } from '../types/routing';

export interface AudioReference {
  id: string;
  rutaRelativa: string;
  formato: 'wav' | 'flac' | 'mp3' | 'ogg';
  sampleRate: number;
  canales: number;
  duracion: number;
}

export interface ProyectoArchivo {
  version: number;
  project: ProjectState;
  audioReferences: Record<string, AudioReference>;
}

const FORMATO_ACTUAL = 1;

const NOMBRES_SIN_TITULO = new Set([
  'untitled',
  'untitled project',
  'proyecto sin nombre',
  'sin título',
  'sin titulo',
]);

export function esNombreSinTitulo(nombre: string | undefined | null): boolean {
  const n = (nombre ?? '').trim().toLowerCase();
  return !n || NOMBRES_SIN_TITULO.has(n);
}

export function nombreDesdeRuta(ruta: string): string {
  const recortada = ruta.replace(/\\/g, '/');
  const archivo = recortada.split('/').pop() || ruta;
  const sinExt = archivo.replace(/\.jaswave$/i, '').trim();
  return sinExt || 'Proyecto';
}

export function nombreAlGuardar(nombreActual: string | undefined | null, ruta: string): string {
  if (esNombreSinTitulo(nombreActual)) return nombreDesdeRuta(ruta);
  return (nombreActual ?? '').trim() || nombreDesdeRuta(ruta);
}

const idUnico = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const bpmDefecto = (): BPM => ({ valor: 120, min: 30, max: 300, texto: '120', modo: 'fijo', cambios: [] });
const compasDefecto = (): TimeSignature => ({ numerador: 4, denominador: 4, nombre: '4/4', cambios: [] });

const proyectoNuevo = (nombre: string): ProjectState => {
  const ahora = Date.now();
  const nombreFinal = !nombre || typeof nombre !== 'string' || nombre.trim().length === 0 ? 'Untitled' : nombre;

  return {
    id: idUnico(),
    nombre: nombreFinal,
    ruta: undefined,
    sampleRate: 44100,
    bitDepth: 24,
    bpm: bpmDefecto(),
    timeSignature: compasDefecto(),
    timeline: {
      duracion: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, texto: '0', porcentaje: 0 },
      loop: { activo: false, inicio: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, tiempoMusical: '0:0:0', porcentaje: 0 }, fin: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, tiempoMusical: '0:0:0', porcentaje: 0 } },
      punch: { activo: false, inicio: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, tiempoMusical: '0:0:0', porcentaje: 0 }, fin: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, tiempoMusical: '0:0:0', porcentaje: 0 } },
      zoomHorizontal: 1,
      zoomVertical: 1,
      scrollX: 0,
      scrollY: 0,
      playhead: { beats: 0, segundos: 0, samples: 0, ticks: 0, compases: 0, frames: 0, tiempoMusical: '0:0:0', porcentaje: 0 },
      snap: false,
      snapTipo: 'beat',
      snapValor: 1,
      marcadores: [],
      escenas: [],
      tracksOrden: [],
      alturaTrack: 30,
      compasInicio: 0,
      compasFin: 30,
    },
    tracks: [],
    routing: {
      buses: [],
      sends: [],
      rutas: [],
      sidechains: [],
      inserts: [],
      conexionesDirectas: [],
      puentes: [],
      grupos: [],
      presetActual: undefined,
      validacion: { errores: [], validado: true, ultimaValidacion: Date.now() },
      estadisticas: { busesTotales: 0, enviosTotales: 0, rutasTotales: 0, sidechainsTotales: 0, insertsTotales: 0, conexionesDirectasTotales: 0, buclesDetectados: 0, latenciaPromedio: 0, gananciaPromedio: 0, usoCPU: 0, usoMemoriaMB: 0 },
      historial: { cambios: [], maximoCambios: 100 },
      ordenTracks: [],
      ordenBuses: [],
      snapshot: undefined,
      comentario: undefined,
      etiquetas: [],
    } as RoutingMatrix,
    master: {
      volumen: 0,
      paneo: 0,
      muted: false,
      solo: false,
      eq: { graves: 0, medios: 0, agudos: 0, habilitado: false, gravesFrecuencia: 60, mediosFrecuencia: 1000, agudosFrecuencia: 8000, gravesQ: 1, mediosQ: 1, agudosQ: 1, tipo: 'parametrico' } as any,
      compresor: { umbral: 0, relacion: 1, ataque: 0.01, liberacion: 0.1, gananciaSalida: 0, habilitado: false, tipo: 'digital', lookahead: false, knee: 'soft' },
      limitador: { habilitado: false, umbral: 0, gananciaSalida: 0, release: 0.1 },
      nivelPico: 0,
      nivelRMS: 0,
      reduccionGain: 0,
      corrupcion: false,
    },
    analysis: {
      tracks: [],
      master: {
        loudness: { integrated: -14, shortTerm: -14, momentary: -14, rangoDinamico: 8, peak: 0, truePeak: 0, lufs: -14 } as any,
        spectrum: [],
        waveform: { samples: [], peaks: [], rms: [], duracion: 0, sampleRate: 44100, canales: 2 },
        nivelPico: 0,
        nivelRMS: 0,
        clipping: false,
        phase: 0,
        stereoCorrelation: 1,
        frecuenciaFundamental: 0,
        notaFundamental: 0,
      },
      resumen: { duracionTotal: 60, pistasActivas: 0, clipsTotales: 0, usoCPU: 0, usoMemoriaMB: 0, xruns: 0, latenciaMs: 0 },
      histograma: { frecuencias: [], magnitudes: [] },
    },
    metadata: {
      autor: 'Usuario',
      genero: 'Otro',
      tags: ['demo'],
      notas: '',
      copyright: '',
      fechaCreacion: ahora,
      fechaModificacion: ahora,
      version: 1,
      readOnly: false,
      customData: {},
    },
    capabilities: { hardwareConectado: [], pluginsDisponibles: [], capacidades: [], licenciaTipo: 'gratuita', licenciaExpiracion: 0 },
    modificado: false,
    fechaCreacion: ahora,
    fechaModificacion: ahora,
    marcadores: [],
    escenas: [],
    plantillaActual: undefined,
    historialAcciones: [],
    version: 1,
    configuracion: {
      sampleRate: 44100,
      bitDepth: 24,
      bufferSize: 256,
      bufferSizeMax: 2048,
      bufferSizeMin: 32,
      dispositivoEntrada: '',
      dispositivoSalida: '',
      dispositivosAlternativos: [],
      latenciaObjetivo: 5,
      modoAltaLatencia: false,
      ditherActivo: false,
      ditherTipo: 'triangular',
      oversampling: 1,
      antiAliasing: true,
      renderizadoOffline: false,
      prioridadCPU: 'normal',
      hilosCPU: 4,
      memoriaBufferMax: 1024,
      precargarPlugins: false,
      confirmarCierre: true,
      autoGuardadoActivo: true,
      autoGuardadoIntervalo: 5,
      autoGuardadoMaxCopias: 10,
      sobreescrituraAutomatica: false,
      compresionGuardado: false,
      cifradoGuardado: false,
      rutaGuardado: '',
      rutaTemporal: '',
      rutaExportacion: '',
      rutaMedios: '',
      rutaPlugins: '',
      rutaPlantillas: '',
      soloLectura: false,
    },
    configuracionAvanzada: {
      telemetriaActiva: false,
      actualizacionesAutomaticas: true,
      confirmacionCierre: true,
      confirmacionSobrescritura: true,
      autoGuardadoActivo: true,
      autoGuardadoIntervalo: 5,
      maximoUndo: 50,
      maximoHistorial: 100,
      maximoEventos: 200,
      tamanoBufferReplay: 1024,
      compresionGuardado: false,
      cifradoGuardado: false,
      proxy: undefined,
    },
    sesion: undefined,
    ultimaExportacion: undefined,
    etiquetas: [],
    archivado: false,
    estadisticas: {
      duracionTotal: 60,
      pistasTotales: 0,
      pistasAudio: 0,
      pistasMidi: 0,
      pistasBus: 0,
      pistasVCA: 0,
      pistasCarpeta: 0,
      clipsTotales: 0,
      clipsAudio: 0,
      clipsMidi: 0,
      pluginsTotales: 0,
      automatizacionesTotales: 0,
      puntosAutomatizacion: 0,
      marcadoresTotales: 0,
      regionesTotales: 0,
      escenasTotales: 0,
      eventosTotales: 0,
      tamanioProyectoBytes: 0,
      tamanioMediosBytes: 0,
      tamanioPluginsBytes: 0,
      tiempoCargaMs: 0,
      tiempoGuardadoMs: 0,
      tiempoExportacionMs: 0,
      usoCPU: 0,
      usoMemoriaMB: 0,
      usoDiscoMB: 0,
      xruns: 0,
      ultimoXrun: 0,
      ciclosTiempoRealPerdidos: 0,
      compasesTotales: 30,
    },
    colaboracion: { compartido: false, proyectoId: '', usuarioId: '', usuarios: [], conflictos: [], comentarios: [], permisos: { editar: true, exportar: true, compartir: false, administrar: true } },
    versiones: [],
    validacion: { errores: [], validada: true, ultimaValidacion: Date.now() },
    configuracionRenderizado: {
      formato: 'wav',
      bitrate: 320,
      sampleRate: 44100,
      bitDepth: 16,
      canales: 2,
      rangoInicio: 0,
      rangoFin: 60,
      normalizar: false,
      dither: false,
      metadatos: {},
      incluirMarcadores: true,
      incluirMetadatos: true,
      rebobinadoTiempoReal: false,
      renderizarMaster: true,
      renderizarStems: false,
      stemsPorPista: false,
      stemsPorBus: false,
      stemsPorGrupo: false,
    },
    comparacion: undefined,
    checksum: 'abc',
    tamanioBytes: 1024,
    ultimaCompaction: 0,
    notasVersion: {},
  };
};

const validarNombre = (nombre: string) => {
  if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
    throw new Error('El nombre del proyecto no puede estar vacío');
  }
};

const validarExtensionRuta = (ruta: string) => {
  if (!ruta.toLowerCase().endsWith('.jaswave')) {
    throw new Error('Solo se permiten archivos con extensión .jaswave');
  }
};

const audioReferencesDefecto = (): Record<string, AudioReference> => ({});

const proyectoParaGuardar = (proyecto: ProjectState): ProyectoArchivo => ({
  version: FORMATO_ACTUAL,
  project: proyecto,
  audioReferences: audioReferencesDefecto(),
});

const archivoValido = (archivo: unknown): archivo is ProyectoArchivo => {
  if (!archivo || typeof archivo !== 'object') {
    return false;
  }

  const candidato = archivo as ProyectoArchivo;
  return (
    typeof candidato.version === 'number' &&
    candidato.version === FORMATO_ACTUAL &&
    typeof candidato.project === 'object' &&
    candidato.project !== null &&
    typeof candidato.audioReferences === 'object' &&
    candidato.audioReferences !== null
  );
};

const validarIntegridadProyecto = (proyecto: unknown): ProjectState => {
  if (!proyecto || typeof proyecto !== 'object') {
    throw new Error('El proyecto cargado está corrupto: estructura vacía');
  }

  const p = proyecto as Record<string, unknown>;

  if (typeof p.id !== 'string' || p.id.length === 0) {
    throw new Error('El proyecto cargado está corrupto: falta project.id');
  }
  if (typeof p.nombre !== 'string') {
    throw new Error('El proyecto cargado está corrupto: falta project.nombre');
  }
  if (typeof p.sampleRate !== 'number' || p.sampleRate <= 0) {
    throw new Error('El proyecto cargado está corrupto: sampleRate inválido');
  }
  if (typeof p.bitDepth !== 'number' || p.bitDepth <= 0) {
    throw new Error('El proyecto cargado está corrupto: bitDepth inválido');
  }
  if (!p.bpm || typeof p.bpm !== 'object' || typeof (p.bpm as any).valor !== 'number') {
    throw new Error('El proyecto cargado está corrupto: bpm inválido');
  }
  if (!p.timeSignature || typeof p.timeSignature !== 'object') {
    throw new Error('El proyecto cargado está corrupto: timeSignature inválida');
  }
  if (!Array.isArray(p.tracks)) {
    throw new Error('El proyecto cargado está corrupto: tracks debe ser un array');
  }
  if (!p.routing || typeof p.routing !== 'object') {
    throw new Error('El proyecto cargado está corrupto: routing faltante');
  }
  if (!p.master || typeof p.master !== 'object') {
    throw new Error('El proyecto cargado está corrupto: master faltante');
  }

  const routing = p.routing as Record<string, unknown>;
  const camposRequeridosRouting = ['buses', 'sends', 'rutas', 'sidechains', 'inserts', 'conexionesDirectas', 'puentes', 'grupos'];
  for (const campo of camposRequeridosRouting) {
    if (!Array.isArray(routing[campo])) {
      throw new Error(`El proyecto cargado está corrupto: routing.${campo} debe ser un array`);
    }
  }

  return p as unknown as ProjectState;
};

const reconstruirRouting = (proyecto: ProjectState): ProjectState => {
  const routing: RoutingMatrix = {
    ...(proyecto.routing || {}),
    buses: Array.isArray(proyecto.routing?.buses) ? proyecto.routing.buses : [],
    sends: Array.isArray(proyecto.routing?.sends) ? proyecto.routing.sends : [],
    rutas: Array.isArray(proyecto.routing?.rutas) ? proyecto.routing.rutas : [],
    sidechains: Array.isArray(proyecto.routing?.sidechains) ? proyecto.routing.sidechains : [],
    inserts: Array.isArray(proyecto.routing?.inserts) ? proyecto.routing.inserts : [],
    conexionesDirectas: Array.isArray(proyecto.routing?.conexionesDirectas) ? proyecto.routing.conexionesDirectas : [],
    puentes: Array.isArray(proyecto.routing?.puentes) ? proyecto.routing.puentes : [],
    grupos: Array.isArray(proyecto.routing?.grupos) ? proyecto.routing.grupos : [],
    presetActual: proyecto.routing?.presetActual,
    validacion: proyecto.routing?.validacion || { errores: [], validado: true, ultimaValidacion: Date.now() },
    estadisticas: proyecto.routing?.estadisticas || { busesTotales: 0, enviosTotales: 0, rutasTotales: 0, sidechainsTotales: 0, insertsTotales: 0, conexionesDirectasTotales: 0, buclesDetectados: 0, latenciaPromedio: 0, gananciaPromedio: 0, usoCPU: 0, usoMemoriaMB: 0 },
    historial: proyecto.routing?.historial || { cambios: [], maximoCambios: 100 },
    ordenTracks: Array.isArray(proyecto.routing?.ordenTracks) ? proyecto.routing.ordenTracks : [],
    ordenBuses: Array.isArray(proyecto.routing?.ordenBuses) ? proyecto.routing.ordenBuses : [],
    snapshot: proyecto.routing?.snapshot,
    comentario: proyecto.routing?.comentario,
    etiquetas: Array.isArray(proyecto.routing?.etiquetas) ? proyecto.routing.etiquetas : [],
  };

  return { ...proyecto, routing };
};

import type { FileService } from '../project/persistencia';

const verificarReferenciasAudio = async (referencias: Record<string, AudioReference>, fileService?: Pick<FileService, 'existe'>): Promise<string[]> => {
  const faltantes: string[] = [];
  for (const [id, ref] of Object.entries(referencias)) {
    if (!ref.rutaRelativa || ref.rutaRelativa.length === 0) {
      faltantes.push(id);
      continue;
    }
    if (fileService) {
      try {
        const existe = await fileService.existe(ref.rutaRelativa);
        if (!existe) {
          faltantes.push(id);
        }
      } catch {
        faltantes.push(id);
      }
    }
  }
  return faltantes;
};

export {
  proyectoNuevo,
  validarNombre,
  validarExtensionRuta,
  proyectoParaGuardar,
  archivoValido,
  FORMATO_ACTUAL,
  validarIntegridadProyecto,
  reconstruirRouting,
  verificarReferenciasAudio,
};
