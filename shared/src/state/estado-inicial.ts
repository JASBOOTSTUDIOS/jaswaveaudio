/**
 * Factory para crear el estado inicial del DAW.
 *
 * Propósito:
 *   Proveer un estado DAWState válido y mínimo para arrancar la aplicación,
 *   inicializar pruebas y servir como baseline para migraciones.
 *
 * Importancia:
 *   - Evita código disperso de inicialización en componentes.
 *   - Garantiza que todo el estado cumpla los invariantes básicos.
 *   - Facilita testing y snapshots de referencia.
 *
 * Función:
 *   Exporta crearEstadoInicial() con valores por defecto para
 *   proyecto, transporte, selección, UI, capacidades y helpers.
 */

import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';
import type { TransportState } from '../types/transport';
import type { EstadoSeleccion } from '../types/seleccion';
import type { UIState } from '../types/ui';
import type { CapabilityRegistry } from '../types/capabilities';
import type { CommandStack } from '../types/command';
import type { EventoDominio } from '../events/evento-dominio';
import type { ContextoIA } from '../types/entidades';
import type { Cache } from '../types/entidades';
import type { Proxy } from '../types/entidades';
import type { Historial } from '../types/historial';
import type { BPM, TimeSignature, TimePosition, TimeDuration, TimelineState, Track, AudioTrack, RoutingMatrix, MasterChannel, ProjectAnalysis, ProjectMetadata } from '../types';

function crearBPM(): BPM {
  return {
    valor: 120,
    min: 20,
    max: 300,
    texto: '120',
    modo: 'fijo',
    cambios: [],
  };
}

function crearCompas(): TimeSignature {
  return {
    numerador: 4,
    denominador: 4,
    nombre: '4/4',
    cambios: [],
  };
}

function crearPosicionCero(): TimePosition {
  return {
    beats: 0,
    segundos: 0,
    samples: 0,
    ticks: 0,
    compases: 0,
    frames: 0,
    tiempoMusical: '1.1.1.0',
    porcentaje: 0,
  };
}

function crearDuracionCero(): TimeDuration {
  return {
    beats: 0,
    segundos: 0,
    samples: 0,
    ticks: 0,
    compases: 0,
    frames: 0,
    texto: '0.0.0.0',
    porcentaje: 0,
  };
}

function crearTimelineInicial(): TimelineState {
  return {
    duracion: crearDuracionCero(),
    loop: {
      activo: false,
      inicio: crearPosicionCero(),
      fin: crearPosicionCero(),
    },
    punch: {
      activo: false,
      inicio: crearPosicionCero(),
      fin: crearPosicionCero(),
    },
    zoomHorizontal: 1,
    zoomVertical: 1,
    scrollX: 0,
    scrollY: 0,
    playhead: crearPosicionCero(),
    snap: true,
    snapTipo: 'beat',
    snapValor: 1,
    marcadores: [],
    escenas: [],
    tracksOrden: [],
    alturaTrack: 64,
    compasInicio: 1,
    compasFin: 8,
  };
}

function crearPistaVacia(id: string): AudioTrack {
  return {
    id,
    nombre: 'Pista sin nombre',
    nombreOriginal: 'Pista sin nombre',
    color: '#808080',
    tipo: 'audio',
    rol: 'normal',
    estado: 'activo',
    volumen: 1,
    volumenOriginal: 1,
    paneo: 0,
    paneoOriginal: 0,
    silenciada: false,
    soloActiva: false,
    armada: false,
    frozen: false,
    soloSeguro: false,
    muteSeguro: false,
    orden: 0,
    profundidad: 0,
    hijos: [],
    clips: [],
    plugins: [],
    automatizaciones: [],
    envios: [],
    receives: [],
    fades: [],
    marcadores: [],
    medios: [],
    tags: [],
    notas: '',
    modificado: false,
    fechaCreacion: Date.now(),
    fechaModificacion: Date.now(),
    estadisticas: {
      clipsTotales: 0,
      clipsAudio: 0,
      clipsMidi: 0,
      duracionTotal: 0,
      duracionUtil: 0,
      pluginsTotales: 0,
      automatizacionesTotales: 0,
      puntosAutomatizacion: 0,
      enviosTotales: 0,
      receivesTotales: 0,
      fadesTotales: 0,
      marcadoresTotales: 0,
      mediosTotales: 0,
      eventosTotales: 0,
    },
    configuracion: {
      cuantizacion: 0,
      delayCompensacion: 0,
      retardoSincronizacion: 0,
      filtroEntrada: false,
      filtroSalida: false,
      monitorizarEntrada: false,
      grabacionAutomática: false,
      sobrescrituraAutomatica: false,
      cuantizarGrabacion: false,
      loop: false,
      punchIn: 0,
      punchOut: 0,
      metronomo: false,
      click: false,
      preRoll: false,
      postRoll: false,
    },
    colorDefecto: '#808080',
    visible: true,
    bloqueada: false,
    seleccionada: false,
    enRuta: false,
    enSidechain: false,
    enLoop: false,
    enEscena: false,
    controladoresVinculados: [],
    superficiesVinculadas: [],
    metadatos: {},
    entrada: undefined,
    salida: undefined,
    waveform: undefined,
    formato: 'stereo',
    canales: 2,
    sampleRate: 44100,
    bitDepth: 24,
    latenciaEntrada: 0,
    latenciaSalida: 0,
    bufferSize: 512,
    dispositivoEntrada: '',
    dispositivoSalida: '',
    gainStaging: 0,
    headroom: 0,
    phase: 0,
    stereoCorrelation: 1,
    lufs: -23,
    rangoDinamico: 0,
    clipping: false,
    xruns: 0,
    ultimoXrun: 0,
  };
}

function crearRoutingInicial(): RoutingMatrix {
  return {
    buses: [],
    sends: [],
    rutas: [],
    sidechains: [],
    inserts: [],
    conexionesDirectas: [],
    puentes: [],
    grupos: [],
    validacion: {
      errores: [],
      validado: true,
      ultimaValidacion: Date.now(),
    },
    estadisticas: {
      busesTotales: 0,
      enviosTotales: 0,
      rutasTotales: 0,
      sidechainsTotales: 0,
      insertsTotales: 0,
      conexionesDirectasTotales: 0,
      buclesDetectados: 0,
      latenciaPromedio: 0,
      gananciaPromedio: 0,
      usoCPU: 0,
      usoMemoriaMB: 0,
    },
    historial: {
      cambios: [],
      maximoCambios: 100,
    },
    ordenTracks: [],
    ordenBuses: [],
    etiquetas: [],
  };
}

function crearMasterInicial(): MasterChannel {
  return {
    volumen: 1,
    paneo: 0,
    muted: false,
    solo: false,
    eq: {
      graves: 0,
      medios: 0,
      agudos: 0,
      habilitado: false,
      gravesFrecuencia: 100,
      mediosFrecuencia: 1000,
      agudosFrecuencia: 10000,
      gravesQ: 1,
      mediosQ: 1,
      agudosQ: 1,
      tipo: 'parametrico',
    },
    compresor: {
      umbral: -24,
      relacion: 4,
      ataque: 10,
      liberacion: 100,
      gananciaSalida: 0,
      habilitado: false,
      tipo: 'vca',
      lookahead: false,
      knee: 'soft',
    },
    limitador: {
      habilitado: true,
      umbral: -0.3,
      gananciaSalida: 0,
      release: 50,
    },
    nivelPico: 0,
    nivelRMS: 0,
    reduccionGain: 0,
    corrupcion: false,
  };
}

function crearAnalisisInicial(): ProjectAnalysis {
  return {
    tracks: [],
    master: {
      trackId: 'master',
      loudness: {
        integrated: -23,
        shortTerm: -23,
        momentary: -23,
        rangoDinamico: 0,
        peak: -6,
        truePeak: -6,
        lufs: -23,
      },
      spectrum: [],
      waveform: {
        samples: [],
        peaks: [],
        rms: [],
        duracion: 0,
        sampleRate: 44100,
        canales: 2,
      },
      nivelPico: 0,
      nivelRMS: 0,
      clipping: false,
      phase: 0,
      stereoCorrelation: 1,
    },
    resumen: {
      duracionTotal: 0,
      pistasActivas: 0,
      clipsTotales: 0,
      usoCPU: 0,
      usoMemoriaMB: 0,
      xruns: 0,
      latenciaMs: 0,
    },
    histograma: {
      frecuencias: [],
      magnitudes: [],
    },
  };
}

function crearMetadatosIniciales(): ProjectMetadata {
  return {
    autor: '',
    genero: '',
    tags: [],
    notas: '',
    copyright: '',
    fechaCreacion: Date.now(),
    fechaModificacion: Date.now(),
    version: 1,
    readOnly: false,
    customData: {},
  };
}

function crearCapabilitiesIniciales(): CapabilityRegistry {
  return {
    capacidades: [],
    licenciaTipo: 'gratuita',
    licenciaExpiracion: 0,
    hardwareConectado: [],
    pluginsDisponibles: [],
  };
}

function crearCommandStackInicial(): CommandStack {
  return {
    deshacer: [],
    rehacer: [],
    limite: 50,
    grupos: [],
  };
}

function crearSeleccionInicial(): EstadoSeleccion {
  return {
    idsPistas: [],
    idsClips: [],
    idsMarcadores: [],
    idsPuntosAutomatizacion: [],
    idsParametrosPlugin: [],
    idsRegiones: [],
    idsTomas: [],
    idsEscenas: [],
    idsLoops: [],
    idsFades: [],
    idsVCAs: [],
    idsBuses: [],
    idsInserts: [],
    idsEnvios: [],
    idsRutas: [],
    idsSidechains: [],
    idsPuentes: [],
    idsGruposRuteo: [],
    idsTemas: [],
    idsAtajos: [],
    idsPlantillas: [],
    idsPresets: [],
    idsMedios: [],
    idsCarpetas: [],
    idsNotas: [],
    idsEventos: [],
    idPrincipal: null,
    tipoPrincipal: null,
    ultimaSeleccion: null,
    seleccionAnterior: null,
    modoSeleccion: 'reemplazar',
  };
}

import type { ConfiguracionAtajos } from '../types/atajos';
import { ATAJOS_POR_DEFECTO } from '../config/atajos';

function crearAtajosIniciales(): ConfiguracionAtajos {
  return {
    mapa: { ...ATAJOS_POR_DEFECTO },
    porDefecto: { ...ATAJOS_POR_DEFECTO },
  };
}

function crearUIInicial(): UIState {
  return {
    tema: 'sistema',
    idioma: 'es',
    vistaSidebar: 'explorador',
    vistaPanelInferior: 'terminal',
    vistaPanelDerecho: 'propiedades',
    layout: {
      anchoBarraLateral: 250,
      altoPanelInferior: 200,
      anchoPanelDerecho: 300,
      barraLateralVisible: true,
      panelInferiorVisible: false,
      panelDerechoVisible: true,
    },
    playheadVisible: true,
    scrollX: 0,
    scrollY: 0,
    zoomHorizontal: 1,
    zoomVertical: 1,
    panelActivo: 'editor',
    paletaComandosAbierta: false,
    dialogoActivo: null,
    arrastrando: false,
    cargaProgreso: 0,
    etiquetaEstado: 'Listo',
    tooltip: null,
    herramientaActiva: 'select',
    modoEdicion: 'arrange',
    panelesDesacoplados: [],
    panelMinimizados: [],
    atajosPersonalizados: {},
    busquedaAbierta: false,
    busquedaTexto: '',
    ultimoFoco: 'editor',
  };
}

function crearCacheInicial(): Cache {
  return {
    archivos: new Map(),
    maximoBytes: 512 * 1024 * 1024,
    bytesUsados: 0,
  };
}

function crearProxiesIniciales(): Proxy[] {
  return [];
}

function crearContextoIAInicial(): ContextoIA {
  return {
    proyectoId: '',
    usuarioId: '',
    herramientasDisponibles: [],
    capacidades: [],
    historialReciente: [],
    estadoActual: {},
    sesionId: '',
    idioma: 'es',
    modo: 'manual',
    permisos: [],
  };
}

function crearHistorialInicial(): Historial {
  return {
    acciones: [],
    eventos: [],
    versiones: [],
    maximoAcciones: 200,
    maximoEventos: 1000,
    maximoVersiones: 50,
    accionActualId: null,
    indiceActual: 0,
  };
}

function crearTransporteInicial(): TransportState {
  return {
    reproduciendo: false,
    posicion: crearPosicionCero(),
    bpm: 120,
    modo: 'stop',
    loop: {
      activo: false,
      inicio: crearPosicionCero(),
      fin: crearPosicionCero(),
      duracion: crearDuracionCero(),
      modo: 'none',
      contador: 0,
    },
    punch: {
      activo: false,
      inicio: crearPosicionCero(),
      fin: crearPosicionCero(),
      modo: 'none',
    },
    metronomo: {
      activo: false,
      tempo: 120,
      compas: 4,
      subdivision: 4,
      tiempoSonando: false,
      tiempoMarcado: 0,
      sonidoInicio: true,
      sonidoCompas: true,
      sonidoSubdivision: false,
      patronAcento: [],
      sonido: 'click',
      volumen: 0.8,
      preroll: false,
      postroll: false,
    },
    grabacion: 'inactiva',
    sincronizado: false,
    relojMaestro: null,
    historialPosiciones: [],
    maximoHistorial: 1000,
    ultimaPosicionGuardada: null,
    tiempoInicioReproduccion: 0,
    duracionUltimaReproduccion: 0,
    ciclos: 0,
    modoGrabacion: 'normal',
    modoSincronizacion: 'interno',
    shuttle: {
      activo: false,
      velocidad: 0,
      modo: 'linear',
      direccion: 'adelante',
    },
    preroll: {
      activo: false,
      compases: 2,
      tipo: 'metronomo',
    },
    postroll: {
      activo: false,
      compases: 2,
      tipo: 'metronomo',
    },
    metronomoVisual: {
      activo: false,
      color: '#ff0000',
      tamano: 12,
      posicion: 'abajo',
    },
    countIn: {
      activo: false,
      compases: 1,
      tipo: 'metronomo',
    },
    click: {
      activo: false,
      volumen: 0.8,
      pitch: 1000,
    },
    tempoMap: {
      bpmInicial: crearBPM(),
      timeSignatureInicial: crearCompas(),
      eventos: [],
      curvaInterpolacion: 'lineal',
      suavizado: 0,
    },
    timeCode: {
      tipo: 'full',
      fps: 24,
      dropFrame: false,
      horas: 0,
      minutos: 0,
      segundos: 0,
      frames: 0,
    },
    sincronizacionReloj: {
      fuente: 'interno',
      modo: 'desconectado',
      bpm: 120,
      tiempoActual: crearPosicionCero(),
      ultimaSincronizacion: 0,
      desfaseMs: 0,
      latenciaMs: 0,
      estable: false,
    },
    link: {
      activo: false,
      bpm: 120,
      compas: crearCompas(),
      fase: 0,
      fuente: '',
      dispositivos: [],
      latenciaMs: 0,
    },
    mtc: {
      tipo: 'full',
      fps: 24,
      dropFrame: false,
      horas: 0,
      minutos: 0,
      segundos: 0,
      frames: 0,
      tiempo: crearPosicionCero(),
    },
    relojMidi: {
      activo: false,
      fuente: 'interno',
      modo: 'desconectado',
      bpm: 120,
      ticksPorBeat: 480,
    },
    master: {
      activo: false,
      bpm: 120,
      timeSignature: crearCompas(),
      posicion: crearPosicionCero(),
    },
    estado: {
      activo: true,
      bloqueado: false,
    },
    estadisticas: {
      reproduccionesTotales: 0,
      grabacionesTotales: 0,
      tiempoTotalReproduccionMs: 0,
      tiempoTotalGrabacionMs: 0,
      ciclosTotales: 0,
      punchInTotales: 0,
      punchOutTotales: 0,
      erroresTransporte: 0,
      xrunsDuranteReproduccion: 0,
      latenciaPromedioMs: 0,
    },
    historial: {
      posiciones: [],
      eventos: [],
      maximoEntries: 1000,
    },
    configuracion: {
      autoPlay: false,
      autoRecord: false,
      autoReturn: false,
      returnToStart: false,
      loopEnabled: false,
      punchEnabled: false,
      metronomeEnabled: false,
      countInEnabled: false,
      prerollEnabled: false,
      postrollEnabled: false,
      shuttleEnabled: false,
      syncEnabled: false,
      linkEnabled: false,
      mtcEnabled: false,
      midiClockEnabled: false,
      tiempoLimiteReproduccion: 0,
      tiempoLimiteGrabacion: 0,
    },
    tags: [],
    notas: '',
    modificado: false,
    fechaCreacion: Date.now(),
    fechaModificacion: Date.now(),
    marcaTiempoInicio: Date.now(),
    tiempoTotalUsoMs: 0,
  };
}

export function crearEstadoInicial(): DAWState {
  const ahora = Date.now();
  const idProyecto = `proyecto-${ahora}-${Math.random().toString(36).slice(2, 9)}`;
  const dispositivoId = `dispositivo-${Math.random().toString(36).slice(2, 9)}`;
  const sesionId = `sesion-${ahora}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    project: {
      id: idProyecto,
      nombre: 'Proyecto sin nombre',
      sampleRate: 44100,
      bitDepth: 24,
      bpm: crearBPM(),
      timeSignature: crearCompas(),
      timeline: crearTimelineInicial(),
      tracks: [],
      routing: crearRoutingInicial(),
      master: crearMasterInicial(),
      analysis: crearAnalisisInicial(),
      metadata: crearMetadatosIniciales(),
      capabilities: crearCapabilitiesIniciales(),
      modificado: false,
      fechaCreacion: ahora,
      fechaModificacion: ahora,
      marcadores: [],
      escenas: [],
      version: 1,
      configuracion: {
        sampleRate: 44100,
        bitDepth: 24,
        bufferSize: 512,
        bufferSizeMax: 2048,
        bufferSizeMin: 64,
        dispositivoEntrada: '',
        dispositivoSalida: '',
        dispositivosAlternativos: [],
        latenciaObjetivo: 0,
        modoAltaLatencia: false,
        ditherActivo: false,
        ditherTipo: 'triangular',
        oversampling: 1,
        antiAliasing: true,
        renderizadoOffline: false,
        prioridadCPU: 'normal',
        hilosCPU: 0,
        memoriaBufferMax: 0,
        precargarPlugins: false,
        confirmarCierre: true,
        autoGuardadoActivo: true,
        autoGuardadoIntervalo: 60000,
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
        autoGuardadoIntervalo: 60000,
        maximoUndo: 50,
        maximoHistorial: 100,
        maximoEventos: 200,
        tamanoBufferReplay: 1024,
        compresionGuardado: false,
        cifradoGuardado: false,
      },
      sesion: undefined,
      ultimaExportacion: undefined,
      etiquetas: [],
      archivado: false,
      estadisticas: {
        duracionTotal: 0,
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
        compasesTotales: 0,
      },
      colaboracion: {
        compartido: false,
        proyectoId: idProyecto,
        usuarioId: '',
        usuarios: [],
        conflictos: [],
        comentarios: [],
        permisos: {
          editar: true,
          exportar: true,
          compartir: true,
          administrar: true,
        },
      },
      versiones: [],
      validacion: {
        errores: [],
        validada: true,
        ultimaValidacion: ahora,
      },
      configuracionRenderizado: {
        formato: 'wav',
        bitrate: 320,
        sampleRate: 44100,
        bitDepth: 24,
        canales: 2,
        rangoInicio: 0,
        rangoFin: 0,
        normalizar: false,
        dither: true,
        metadatos: {},
        incluirMarcadores: true,
        incluirMetadatos: true,
        rebobinadoTiempoReal: true,
        renderizarMaster: true,
        renderizarStems: false,
        stemsPorPista: false,
        stemsPorBus: false,
        stemsPorGrupo: false,
      },
      checksum: '',
      tamanioBytes: 0,
      ultimaCompaction: ahora,
      notasVersion: {},
      historialAcciones: [],
    },
    transport: crearTransporteInicial(),
    selection: crearSeleccionInicial(),
    ui: crearUIInicial(),
    atajos: crearAtajosIniciales(),
    capabilities: crearCapabilitiesIniciales(),
    commandStack: crearCommandStackInicial(),
    busEventos: [],
    contextoIA: crearContextoIAInicial(),
    cache: crearCacheInicial(),
    proxies: crearProxiesIniciales(),
    historial: crearHistorialInicial(),
    marcaTiempo: ahora,
    version: '0.1.0',
    esquemaVersion: '1.0.0',
    dispositivoId,
    sesionId,
    modoColaboracion: false,
    sincronizado: false,
    ultimaSincronizacion: 0,
    checksum: '',
    tamanioBytes: 0,
    etiquetas: [],
    notas: '',
    plantillaId: undefined,
    presetId: undefined,
    temaId: undefined,
    idioma: 'es',
    zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/Mexico_City',
    marcaTiempoInicio: ahora,
    tiempoTotalUsoMs: 0,
    estadisticasUso: {
      sesionesTotales: 0,
      tiempoPromedioSesionMs: 0,
      comandosEjecutados: 0,
      eventosProcesados: 0,
      erroresTotales: 0,
      advertenciasTotales: 0,
      exportacionesTotales: 0,
      importacionesTotales: 0,
      guardadosTotales: 0,
      cambiosNoGuardados: 0,
    },
    rendimiento: {
      cpuPromedio: 0,
      memoriaPromedioMB: 0,
      xrunsTotales: 0,
      latenciaPromedioMs: 0,
      buffersDescartados: 0,
    },
    configuracionAvanzada: {
      telemetriaActiva: false,
      actualizacionesAutomaticas: true,
      confirmacionCierre: true,
      confirmacionSobrescritura: true,
      autoGuardadoActivo: true,
      autoGuardadoIntervalo: 60000,
      maximoUndo: 50,
      maximoHistorial: 200,
      tamanoBufferReplay: 2000,
      compresionGuardado: false,
      cifradoGuardado: false,
    },
    extensiones: {
      activas: [],
      desactivadas: [],
      pendientes: [],
      errores: [],
    },
    logs: {
      errores: [],
      advertencias: [],
      eventos: [],
      maximoEntries: 1000,
    },
    snapshots: [],
    migraciones: [],
    validaciones: [],
    comparaciones: [],
    contexto: {},
  };
}
