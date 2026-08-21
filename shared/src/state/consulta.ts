/**
 * Implementación concreta de DAWQuery.
 *
 * Propósito:
 *   Proveer una clase que implemente la interfaz DAWQuery para consultar
 *   un DAWState de forma determinista y sin efectos secundarios.
 *
 * Importancia:
 *   - Es el contrato que usa la IA y otros módulos para leer estado.
 *   - Centraliza la lógica de lectura en un solo lugar.
 *   - Garantiza que las consultas no muten el estado.
 *
 * Función:
 *   Exporta ConsultaDAW con implementaciones de lectura sobre DAWState.
 */

import type { DAWState } from '../types/state';
import type { DAWQuery, ResumenProyecto, FiltroPista, ElementosSeleccionados, DescriptorPlugin, ResumenAnalisisAudio, CarrilAutomatizacion, ResumenEventoDominio, ResultadoBusquedaProyecto, ConsultaTransporte, ConsultaMezcla, ConsultaRuteo, ConsultaMedios, ConsultaRendimiento, ConsultaExportacion, ConsultaSugerenciaIA, ConsultaHistorial, ConsultaSincronizacion, ConsultaControlMIDI, ConsultaHardware, ConsultaLoop, ConsultaEscenas, ConsultaNotacion, ConsultaVCA, ConsultaFades, ConsultaMarcadores, ConsultaPlantillas, ConsultaSesion, ConsultaActualizacion, ConsultaNube, ConsultaLicencia, ConsultaCapabilidades, ConsultaContextoIA, ConsultaEstado, ConsultaBusqueda, ConsultaExportacionEstado, ConsultaPrediccion, ConsultaDiffs, ConsultaReporte, ConsultaBatch } from '../types/query';
import type { ConsultaClip } from '../types/query';
import type { Track } from '../types/tracks';
import type { AudioClip } from '../types/clips';
import type { PluginInfo } from '../types/entidades';
import type { AutomatizacionInfo } from '../types/entidades';
import type { ContextoIA } from '../types/entidades';
import type { ConfiguracionProyecto } from '../types/proyecto';
import type { OpcionesDuplicado, ResultadoDuplicado, ResultadoDuplicadoEspecifico } from '../types/duplicado';
import type { Marcador } from '../types/entidades';
import type { Medio } from '../types/entidades';
import type { ValorJSON } from '../events/evento-dominio';

export class ConsultaDAW implements DAWQuery {
  private estado: DAWState;

  constructor(estado: DAWState) {
    this.estado = estado;
  }

  obtenerResumenProyecto(): ResumenProyecto {
    const proyecto = this.estado.project;
    const tracks = proyecto.tracks;
    const clips = tracks.flatMap(t => t.clips);
    const plugins = tracks.flatMap(t => t.plugins);
    return {
      nombre: proyecto.nombre,
      bpm: proyecto.bpm.valor,
      compas: proyecto.timeSignature.numerador,
      duracion: proyecto.timeline.duracion.segundos,
      sampleRate: proyecto.sampleRate,
      bitDepth: proyecto.bitDepth,
      pistas: tracks.length,
      clips: clips.length,
      plugins: plugins.length,
      modificado: proyecto.modificado,
      marcadores: proyecto.marcadores.length,
      escenas: proyecto.escenas.length,
      tomasGrabadas: 0,
      tomasSeleccionadas: 0,
      estadisticas: {
        usoCPU: proyecto.estadisticas.usoCPU,
        usoMemoriaMB: proyecto.estadisticas.usoMemoriaMB,
        xruns: proyecto.estadisticas.xruns,
        latenciaMs: this.estado.rendimiento.latenciaPromedioMs,
      },
    };
  }

  obtenerPistas(filtro?: FiltroPista): Track[] {
    let tracks = this.estado.project.tracks;
    if (!filtro) return tracks;
    if (filtro.tipo) {
      tracks = tracks.filter(t => t.tipo === filtro.tipo);
    }
    if (filtro.nombre) {
      const nombre = filtro.nombre.toLowerCase();
      tracks = tracks.filter(t => t.nombre.toLowerCase().includes(nombre));
    }
    if (filtro.soloActiva !== undefined) {
      tracks = tracks.filter(t => t.soloActiva === filtro.soloActiva);
    }
    if (filtro.silenciada !== undefined) {
      tracks = tracks.filter(t => t.silenciada === filtro.silenciada);
    }
    if (filtro.armada !== undefined) {
      tracks = tracks.filter(t => t.armada === filtro.armada);
    }
    if (filtro.color) {
      tracks = tracks.filter(t => t.color === filtro.color);
    }
    if (filtro.etiqueta) {
      const etiqueta = filtro.etiqueta;
      tracks = tracks.filter(t => t.tags.includes(etiqueta));
    }
    return tracks;
  }

  obtenerElementosSeleccionados(): ElementosSeleccionados {
    const sel = this.estado.selection;
    return {
      idsPistas: sel.idsPistas,
      idsClips: sel.idsClips,
      idsMarcadores: sel.idsMarcadores,
      idsPuntosAutomatizacion: sel.idsPuntosAutomatizacion,
      idsParametrosPlugin: sel.idsParametrosPlugin.map(p => ({ pluginId: p.idPlugin, parametroId: p.idParametro })),
    };
  }

  obtenerClip(id: string): ConsultaClip | null {
    for (const track of this.estado.project.tracks) {
      const clip = track.clips.find(c => c.id === id);
      if (clip) {
        if (clip.tipo === 'audio') {
          const audio = clip as AudioClip;
          return {
            id: audio.id,
            nombre: audio.nombre,
            idPista: track.id,
            tipo: audio.tipo,
            inicio: audio.inicio,
            duracion: audio.duracion,
            seleccionado: audio.seleccionado,
            fadeIn: { duracion: audio.fadeIn.duracion, curva: audio.fadeIn.curva },
            fadeOut: { duracion: audio.fadeOut.duracion, curva: audio.fadeOut.curva },
            warp: audio.warp,
            velocidad: audio.velocidad,
            inverso: audio.inverso,
            fuente: { ruta: audio.source.ruta, duracion: audio.source.duracion, sampleRate: audio.source.sampleRate, canales: audio.source.canales, bitDepth: audio.source.bitDepth },
          };
        }
        return {
          id: clip.id,
          nombre: clip.nombre,
          idPista: track.id,
          tipo: clip.tipo,
          inicio: clip.inicio,
          duracion: clip.duracion,
          seleccionado: clip.seleccionado,
          fadeIn: null,
          fadeOut: null,
          warp: false,
          velocidad: 1,
          inverso: false,
        };
      }
    }
    return null;
  }

  obtenerPlugins(): DescriptorPlugin[] {
    const plugins: DescriptorPlugin[] = [];
    for (const track of this.estado.project.tracks) {
      for (const plugin of track.plugins) {
        plugins.push({
          id: plugin.id,
          nombre: plugin.nombre,
          fabricante: plugin.autor,
          tipo: plugin.tipo,
          parametros: plugin.parametros.map(p => ({ id: p.id, nombre: p.nombre, valor: p.valor })),
          bypass: plugin.bypass,
          version: plugin.version,
          categoria: plugin.categoria,
          autor: plugin.autor,
          descripcion: plugin.descripcion,
          licencia: plugin.licencia,
          icono: plugin.icono,
        });
      }
    }
    return plugins;
  }

  obtenerParametroPlugin(idPlugin: string, idParametro: string): { valor: number; minimo: number; maximo: number } | null {
    for (const track of this.estado.project.tracks) {
      for (const plugin of track.plugins) {
        if (plugin.id === idPlugin) {
          const parametro = plugin.parametros.find((p: PluginInfo['parametros'][number]) => p.id === idParametro);
          if (parametro) {
            return { valor: parametro.valor, minimo: parametro.minimo, maximo: parametro.maximo };
          }
        }
      }
    }
    return null;
  }

  obtenerAnalisisAudio(idPista?: string): ResumenAnalisisAudio | null {
    const analisis = this.estado.project.analysis;
    if (!idPista) {
      const track = analisis.tracks[0];
      if (!track) return null;
      return {
        idPista: track.trackId,
        nivelPico: track.nivelPico,
        nivelRMS: track.nivelRMS,
        recorte: track.clipping,
        espectro: track.spectrum,
        frecuenciaFundamental: track.frecuenciaFundamental,
        notaFundamental: track.notaFundamental?.toString(),
        lufs: track.loudness.lufs,
        rangoDinamico: track.loudness.rangoDinamico,
        fase: track.phase,
        correlacionEstereo: track.stereoCorrelation,
      };
    }
    const track = analisis.tracks.find(t => t.trackId === idPista);
    if (!track) return null;
    return {
      idPista: track.trackId,
      nivelPico: track.nivelPico,
      nivelRMS: track.nivelRMS,
      recorte: track.clipping,
      espectro: track.spectrum,
      frecuenciaFundamental: track.frecuenciaFundamental,
      notaFundamental: track.notaFundamental?.toString(),
      lufs: track.loudness.lufs,
      rangoDinamico: track.loudness.rangoDinamico,
      fase: track.phase,
      correlacionEstereo: track.stereoCorrelation,
    };
  }

  obtenerRuteo(): ConsultaRuteo {
    const ruteo = this.estado.project.routing;
    return {
      buses: ruteo.buses.map(b => ({
        id: b.id,
        nombre: b.nombre,
        tipo: b.tipo,
        volumen: b.volumen,
        paneo: b.paneo,
        silenciado: b.muted,
        solo: b.solo,
        envios: b.envios.map(e => ({ idBusDestino: e.busId, cantidad: e.cantidad })),
      })),
      envios: ruteo.sends.map(s => ({
        id: s.id,
        idPistaOrigen: s.origenTrackId,
        idBusDestino: s.destinoBusId,
        cantidad: s.cantidad,
        pan: s.pan,
        activo: s.activo,
        preFader: s.preFader,
      })),
      rutas: ruteo.rutas.map(r => ({
        id: r.id,
        origen: r.origen,
        destino: r.destino,
        tipo: r.tipo,
        activa: r.activa,
      })),
      sidechains: ruteo.sidechains.map(s => ({
        id: s.id,
        idPistaOrigen: s.origenTrackId,
        idPistaDestino: s.destinoTrackId,
        activo: s.activo,
        cantidad: s.cantidad,
      })),
    };
  }

  obtenerAutomatizacion(idPista?: string): CarrilAutomatizacion[] {
    const tracks = idPista ? this.estado.project.tracks.filter(t => t.id === idPista) : this.estado.project.tracks;
    const carriles: CarrilAutomatizacion[] = [];
    for (const track of tracks) {
      for (const auto of track.automatizaciones) {
        carriles.push({
          idPista: track.id,
          parametro: auto.parametro,
          puntos: auto.puntos.map(p => ({ tiempo: p.tiempo, valor: p.valor })),
          grabando: auto.grabando,
          modo: auto.modo,
          color: auto.color,
          escalaMinima: auto.escalaMinima,
          escalaMaxima: auto.escalaMaxima,
          suavizado: auto.suavizado,
        });
      }
    }
    return carriles;
  }

  obtenerEventosRecientes(limite = 20): ResumenEventoDominio[] {
    const eventos = this.estado.busEventos.slice(-limite).reverse();
    return eventos.map(e => ({
      nombre: e.nombre,
      marcaTiempo: e.marcaTiempo,
      fuente: e.fuente,
      cargaUtil: e.payload as Record<string, unknown>,
    }));
  }

  obtenerCapabilidades(): import('../types/capabilities').CapabilityDescriptor[] {
    return this.estado.capabilities.capacidades;
  }

  obtenerTransporte(): ConsultaTransporte {
    const t = this.estado.transport;
    return {
      reproduciendo: t.reproduciendo,
      posicion: t.posicion.segundos,
      bpm: t.bpm,
      modo: t.modo,
      loopActivo: t.loop.activo,
      punchIn: t.punch.inicio.segundos,
      punchOut: t.punch.fin.segundos,
      metronomoActivo: t.metronomo.activo,
      grabando: t.grabacion === 'grabando',
      sincronizado: t.sincronizado,
      relojMaestro: t.relojMaestro,
    };
  }

  obtenerCanalesMezcla(): { idPista: string; volumen: number; paneo: number; silenciado: boolean; solo: boolean }[] {
    return this.estado.project.tracks.map(t => ({
      idPista: t.id,
      volumen: t.volumen,
      paneo: t.paneo,
      silenciado: t.silenciada,
      solo: t.soloActiva,
    }));
  }

  obtenerNivelesMaster(): { pico: number; rms: number } {
    const master = this.estado.project.master;
    return { pico: master.nivelPico, rms: master.nivelRMS };
  }

  obtenerMarcadores(): ConsultaMarcadores {
    const marcadores = this.estado.project.marcadores;
    const regiones = marcadores.filter(m => m.tipo === 'region');
    return {
      marcadores: marcadores.map(m => ({
        id: m.id,
        nombre: m.nombre,
        tiempo: m.tiempo,
        color: m.color,
        tipo: m.tipo,
        regionInicio: m.regionInicio,
        regionFin: m.regionFin,
        comentario: m.comentario,
      })),
      regiones: regiones.map(r => ({
        id: r.id,
        nombre: r.nombre,
        inicio: r.regionInicio ?? 0,
        fin: r.regionFin ?? 0,
        color: r.color,
        loop: false,
      })),
    };
  }

  obtenerMedios(filtro?: { tipo?: string; etiqueta?: string }): ConsultaMedios {
    let medios = this.estado.project.tracks.flatMap(t => t.medios);
    if (filtro?.tipo) {
      medios = medios.filter(m => m.tipo === filtro.tipo);
    }
    if (filtro?.etiqueta) {
      const etiqueta = filtro.etiqueta;
      medios = medios.filter(m => m.etiquetas.includes(etiqueta));
    }
    const porTipo: Record<string, number> = {};
    const porFormato: Record<string, number> = {};
    for (const medio of medios) {
      porTipo[medio.tipo] = (porTipo[medio.tipo] || 0) + 1;
      porFormato[medio.tipo] = (porFormato[medio.tipo] || 0) + 1;
    }
    return {
      medios: medios.map(m => ({
        id: m.id,
        nombre: m.nombre,
        tipo: m.tipo,
        ruta: m.ruta,
        duracion: m.duracion,
        tamanoBytes: m.tamanoBytes,
        sampleRate: m.sampleRate,
        canales: m.canales,
        bitDepth: m.bitDepth,
        favorito: m.favorito,
        etiquetas: m.etiquetas,
        ultimoAcceso: m.ultimoAcceso,
      })),
      totales: {
        cantidad: medios.length,
        tamanoTotalBytes: medios.reduce((sum, m) => sum + m.tamanoBytes, 0),
        porTipo,
        porFormato,
      },
    };
  }

  obtenerConfiguracion(): ConfiguracionProyecto {
    return this.estado.project.configuracion;
  }

  obtenerContextoIA(): ConsultaContextoIA {
    const ctx = this.estado.contextoIA;
    return {
      proyectoId: ctx.proyectoId,
      usuarioId: ctx.usuarioId,
      herramientasDisponibles: ctx.herramientasDisponibles,
      capacidades: ctx.capacidades,
      modo: ctx.modo,
      idioma: ctx.idioma,
      sesionId: ctx.sesionId,
      historialReciente: ctx.historialReciente.slice(-10).map(e => ({
        nombre: e.nombre,
        marcaTiempo: e.marcaTiempo,
        fuente: e.fuente,
      })),
      estadoActual: ctx.estadoActual,
    };
  }

  buscar(consulta: string, limite = 10): ResultadoBusquedaProyecto[] {
    const termino = consulta.toLowerCase();
    const resultados: ResultadoBusquedaProyecto[] = [];
    for (const track of this.estado.project.tracks) {
      if (track.nombre.toLowerCase().includes(termino)) {
        resultados.push({ tipo: 'pista', id: track.id, nombre: track.nombre, descripcion: track.notas, relevancia: 1 });
      }
      for (const clip of track.clips) {
        if (clip.nombre.toLowerCase().includes(termino)) {
          resultados.push({ tipo: 'clip', id: clip.id, nombre: clip.nombre, descripcion: '', relevancia: 0.8, entidadPadreId: track.id });
        }
      }
      if (resultados.length >= limite) break;
    }
    return resultados.slice(0, limite);
  }

  exportarEstado(): Record<string, ValorJSON> {
    return this.estado as unknown as Record<string, ValorJSON>;
  }

  predecirMejora(): ConsultaSugerenciaIA[] {
    return [{
      id: 'stub-prediccion-basica',
      tipo: 'no_implementado',
      descripcion: 'predecirMejora no implementado',
      impacto: 'bajo',
      confianza: 0,
    } as unknown as ConsultaSugerenciaIA];
  }

  obtenerEstado(): ConsultaEstado {
    const proyecto = this.obtenerResumenProyecto();
    const transporte = this.obtenerTransporte();
    const seleccion = this.obtenerElementosSeleccionados();
    const ui = {
      tema: this.estado.ui.tema,
      idioma: this.estado.ui.idioma,
      herramientaActiva: this.estado.ui.herramientaActiva,
      modoEdicion: this.estado.ui.modoEdicion,
      zoomHorizontal: this.estado.ui.zoomHorizontal,
      zoomVertical: this.estado.ui.zoomVertical,
      panelActivo: this.estado.ui.panelActivo,
      paletaComandosAbierta: this.estado.ui.paletaComandosAbierta,
    };
    return {
      proyecto,
      transporte,
      seleccion,
      ui,
      mezcla: this.obtenerCanalesMezcla().map(c => ({
        idPista: c.idPista,
        volumen: c.volumen,
        paneo: c.paneo,
        silenciado: c.silenciado,
        solo: c.solo,
        nivelPico: 0,
        nivelRMS: 0,
        reduccionGanancia: 0,
      })) as any,
      ruteo: this.obtenerRuteo(),
      analisis: this.estado.project.analysis.tracks.map(t => ({
        idPista: t.trackId,
        nivelPico: t.nivelPico,
        nivelRMS: t.nivelRMS,
        recorte: t.clipping,
        espectro: t.spectrum,
        frecuenciaFundamental: t.frecuenciaFundamental,
        notaFundamental: t.notaFundamental?.toString(),
        lufs: t.loudness.lufs,
        rangoDinamico: t.loudness.rangoDinamico,
        fase: t.phase,
        correlacionEstereo: t.stereoCorrelation,
      })),
      metronomo: {
        activo: this.estado.transport.metronomo.activo,
        tempo: this.estado.transport.metronomo.tempo,
        compas: this.estado.transport.metronomo.compas,
        subdivision: this.estado.transport.metronomo.subdivision,
        tiempoActual: this.estado.transport.posicion.segundos,
        tiempoMarcado: this.estado.transport.metronomo.tiempoMarcado,
        sonando: this.estado.transport.metronomo.tiempoSonando,
        sonidoInicio: this.estado.transport.metronomo.sonidoInicio,
        sonidoCompas: this.estado.transport.metronomo.sonidoCompas,
        sonidoSubdivision: this.estado.transport.metronomo.sonidoSubdivision,
        sonido: this.estado.transport.metronomo.sonido,
        volumen: this.estado.transport.metronomo.volumen,
      },
      grabacion: {
        estado: this.estado.transport.grabacion,
        pistaId: undefined,
        archivo: undefined,
        formato: 'wav',
        sampleRate: this.estado.project.sampleRate,
        bitDepth: this.estado.project.bitDepth,
        canales: 2,
        entradaDetectada: false,
        nivelEntrada: 0,
        nivelPico: 0,
        punchIn: this.estado.transport.punch.inicio.segundos,
        punchOut: this.estado.transport.punch.fin.segundos,
        loop: this.estado.transport.loop.activo,
        metronomo: this.estado.transport.metronomo.activo,
        takes: [],
        takeActualId: undefined,
        compasesGrabados: 0,
      },
      exportacion: {
        estado: 'idle',
        progreso: 0,
        formato: 'wav',
        bitrate: 320,
        ruta: '',
        tareasPendientes: 0,
        tiempoEstimadoMs: 0,
      } as any,
      sincronizacion: {
        estado: 'desconectado',
        ultimaSincronizacion: this.estado.ultimaSincronizacion,
        relojSincronizado: this.estado.transport.sincronizado,
        relojMaestro: this.estado.transport.relojMaestro,
        seguidores: [],
      } as any,
      controlMIDI: {
        controladores: [],
        mapeos: [],
      } as any,
      hardware: {
        dispositivos: [],
      } as any,
      loops: {
        loops: [],
        loopGlobalActivo: this.estado.transport.loop.activo,
      } as any,
      escenas: {
        escenas: [],
      } as any,
      notacion: {
        compases: 0,
        clave: 'G',
        transportarSincronizado: false,
        tempoVisible: true,
        nombresNotas: 'latino',
        mostrarOctava: true,
        mostrarCompas: true,
        mostrarClave: true,
        mostrarSilencios: true,
        escala: 'cromatica',
        modo: 'mayor',
        transposicion: 0,
      } as any,
      vcas: {
        vcas: [],
      } as any,
      fades: {
        fades: [],
      } as any,
      marcadores: this.obtenerMarcadores(),
      plantillas: {
        plantillas: [],
      } as any,
      sesion: {
        id: this.estado.sesionId,
        nombre: this.estado.project.nombre,
        estado: 'activa',
        fechaCreacion: this.estado.project.fechaCreacion,
        fechaModificacion: this.estado.project.fechaModificacion,
        compartida: this.estado.modoColaboracion,
      } as any,
      rendimiento: {
        cpu: {
          uso: this.estado.rendimiento.cpuPromedio,
          historial: [],
          hilosUtilizados: 0,
          proceso: '',
        },
        memoria: {
          usoMB: this.estado.rendimiento.memoriaPromedioMB,
          historial: [],
          buffers: 0,
          cache: 0,
        },
        disco: {
          usoMB: 0,
          lecturaMBs: 0,
          escrituraMBs: 0,
          espacioLibreGB: 0,
        },
        audio: {
          xruns: this.estado.rendimiento.xrunsTotales,
          historialXruns: [],
          bufferSize: this.estado.project.configuracion.bufferSize,
          sampleRate: this.estado.project.sampleRate,
        },
      } as any,
      actualizacion: {
        disponible: false,
        version: this.estado.version,
        progreso: 0,
        estado: 'ok',
        criticidad: 'baja',
      } as any,
      nube: {
        estado: 'desconectado',
        ultimaSincronizacion: this.estado.ultimaSincronizacion,
        conflicto: false,
        espacioUsadoBytes: 0,
        espacioTotalBytes: 0,
        servidor: '',
        sincronizacionAutomatica: false,
        conflictosResueltos: 0,
      } as any,
      licencia: {
        tipo: this.estado.capabilities.licenciaTipo,
        activada: true,
        expiracion: this.estado.capabilities.licenciaExpiracion ?? 0,
        caracteristicas: this.estado.capabilities.capacidades.map(c => c.id),
        dispositivosActivos: 0,
        dispositivosMaximos: 1,
      } as any,
      capabilidades: {
        licenciaTipo: this.estado.capabilities.licenciaTipo,
        licenciaExpiracion: this.estado.capabilities.licenciaExpiracion,
        capacidades: this.estado.capabilities.capacidades.map(c => ({
          id: c.id,
          nombre: c.nombre,
          descripcion: c.descripcion,
          activa: c.activa,
          razonInactiva: c.razonInactiva,
        })),
        hardwareConectado: this.estado.capabilities.hardwareConectado,
        pluginsDisponibles: this.estado.capabilities.pluginsDisponibles,
      } as any,
      contextoIA: this.obtenerContextoIA(),
      historial: {
        acciones: this.estado.historial.acciones.slice(-20).map(a => ({
          id: a.id,
          tipo: a.tipo,
          nombre: a.nombre,
          descripcion: a.descripcion,
          marcaTiempo: a.marcaTiempo,
          exito: a.exito,
          duracionMs: a.duracionMs,
        })),
        totales: {
          acciones: this.estado.historial.acciones.length,
          errores: 0,
          advertencias: 0,
          comandos: this.estado.commandStack.deshacer.length,
          eventos: this.estado.historial.eventos.length,
        },
      } as any,
      cache: {
        entradas: 0,
        bytesUsados: 0,
        hits: 0,
        misses: 0,
      } as any,
      proxies: {
        proxies: this.estado.proxies.map(p => ({
          id: p.id,
          nombre: p.nombre,
          tipo: p.tipo,
          origen: p.origen,
          destino: p.destino,
          activo: p.activo,
        })),
      } as any,
    };
  }

  buscarAvanzado(consulta: ConsultaBusqueda): ResultadoBusquedaProyecto[] {
    return this.buscar(consulta.termino, consulta.limite);
  }

  exportarEstadoAvanzado(config: ConsultaExportacionEstado): Record<string, ValorJSON> {
    const estado = this.estado;
    const resultado: Record<string, ValorJSON> = {};
    if (config.incluirProyecto) resultado.proyecto = estado.project as unknown as ValorJSON;
    if (config.incluirTransporte) resultado.transporte = estado.transport as unknown as ValorJSON;
    if (config.incluirSeleccion) resultado.seleccion = estado.selection as unknown as ValorJSON;
    if (config.incluirUI) resultado.ui = estado.ui as unknown as ValorJSON;
    if (config.incluirCapabilidades) resultado.capabilities = estado.capabilities as unknown as ValorJSON;
    if (config.incluirContextoIA) resultado.contextoIA = estado.contextoIA as unknown as ValorJSON;
    if (config.incluirCache) resultado.cache = estado.cache as unknown as ValorJSON;
    if (config.incluirProxies) resultado.proxies = estado.proxies as unknown as ValorJSON;
    if (config.incluirHistorial) resultado.historial = estado.historial as unknown as ValorJSON;
    return resultado;
  }

  predecirMejoraAvanzada(filtros?: { tipos?: string[]; impacto?: string[] }): ConsultaPrediccion[] {
    return [{
      id: 'stub-prediccion',
      tipo: 'no_implementado',
      descripcion: 'predecirMejoraAvanzada no implementado',
      impacto: 'bajo',
      confianza: 0,
      disponible: false,
    } as unknown as ConsultaPrediccion];
  }

  obtenerDiffs(consulta: ConsultaDiffs): { diferencias: any[]; resumen: any } {
    return {
      diferencias: [{ tipo: 'no_implementado', mensaje: 'obtenerDiffs no implementado' }],
      resumen: {
        cambiosTotales: 0,
        cambiosCriticos: 0,
        pistasModificadas: 0,
        clipsModificados: 0,
        pluginsModificados: 0,
        disponible: false,
        razon: 'not_implemented',
      },
    };
  }

  generarReporte(consulta: ConsultaReporte): ValorJSON {
    return { disponible: false, razon: 'not_implemented', consulta: consulta as unknown as ValorJSON };
  }

  ejecutarConsultaBatch(consulta: ConsultaBatch): ValorJSON[] {
    return [{ disponible: false, razon: 'not_implemented', consulta: consulta as unknown as ValorJSON }];
  }

  duplicarEntidad(opciones: OpcionesDuplicado): ResultadoDuplicado {
    const copias = Math.max(1, opciones.numeroCopias ?? 1);
    const idsDuplicados: string[] = [];
    const nombresDuplicados: string[] = [];
    const errores: { campo: string; mensaje: string }[] = [];

    if (opciones.tipo === 'pista') {
      const pista = this.estado.project.tracks.find(t => t.id === opciones.idEntidad);
      if (!pista) {
        errores.push({ campo: 'idEntidad', mensaje: `Pista no encontrada: ${opciones.idEntidad}` });
      } else {
        for (let i = 0; i < copias; i++) {
          const id = `dup-${pista.id}-${Date.now()}-${i}`;
          const nombre =
            opciones.nuevoNombre ??
            `${opciones.prefijoNombre ?? ''}${pista.nombre}${opciones.sufijoNombre ?? ' (copia)'}${copias > 1 ? ` ${i + 1}` : ''}`;
          idsDuplicados.push(id);
          nombresDuplicados.push(nombre);
        }
      }
    } else if (opciones.tipo === 'clip') {
      const pista = this.estado.project.tracks.find(t =>
        (t.clips as { id: string }[]).some(c => c.id === opciones.idEntidad),
      );
      const clip = pista ? (pista.clips as { id: string; nombre: string }[]).find(c => c.id === opciones.idEntidad) : undefined;
      if (!clip) {
        errores.push({ campo: 'idEntidad', mensaje: `Clip no encontrado: ${opciones.idEntidad}` });
      } else {
        for (let i = 0; i < copias; i++) {
          const id = `dup-${clip.id}-${Date.now()}-${i}`;
          const nombre =
            opciones.nuevoNombre ??
            `${opciones.prefijoNombre ?? ''}${clip.nombre}${opciones.sufijoNombre ?? ' (copia)'}${copias > 1 ? ` ${i + 1}` : ''}`;
          idsDuplicados.push(id);
          nombresDuplicados.push(nombre);
        }
      }
    } else if (opciones.tipo === 'marcador') {
      const marcador = this.estado.project.marcadores.find(m => m.id === opciones.idEntidad);
      if (!marcador) {
        errores.push({ campo: 'idEntidad', mensaje: `Marcador no encontrado: ${opciones.idEntidad}` });
      } else {
        for (let i = 0; i < copias; i++) {
          idsDuplicados.push(`dup-${marcador.id}-${Date.now()}-${i}`);
          nombresDuplicados.push(opciones.nuevoNombre ?? `${marcador.nombre} (copia)`);
        }
      }
    } else {
      errores.push({
        campo: 'tipo',
        mensaje: `Duplicado de '${opciones.tipo}' planificado solo para pista/clip/marcador; usar comando de dominio para aplicar`,
      });
    }

    return {
      exito: errores.length === 0 && idsDuplicados.length > 0,
      tipo: opciones.tipo,
      idOriginal: opciones.idEntidad,
      idsDuplicados,
      nombresDuplicados,
      errores,
      advertencias:
        errores.length === 0
          ? [{ campo: 'aplicacion', mensaje: 'Resultado de consulta (sin mutar estado); aplicar vía Command System' }]
          : [],
      marcaTiempo: Date.now(),
    };
  }

  duplicarPista(idPista: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const pista = this.estado.project.tracks.find(t => t.id === idPista);
    const resultado = this.duplicarEntidad({
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
      tipo: 'pista',
      idEntidad: idPista,
    } as OpcionesDuplicado);

    return {
      tipo: 'pista',
      opciones: { ...opciones, tipo: 'pista', idEntidad: idPista } as any,
      resultado,
      pistasDuplicadas: resultado.idsDuplicados.map((id, i) => ({
        id,
        nombre: resultado.nombresDuplicados[i] ?? '',
        color: pista?.color ?? '#888',
        clips: (pista?.clips as { id: string }[] | undefined)?.map(c => c.id) ?? [],
        plugins: pista?.plugins?.map(p => p.id) ?? [],
        automatizaciones: pista?.automatizaciones?.map(a => a.id) ?? [],
        envios: [],
        receives: [],
      })),
    };
  }

  duplicarClip(idClip: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    let clip: any;
    let trackId = '';
    for (const t of this.estado.project.tracks) {
      const found = (t.clips as any[]).find(c => c.id === idClip);
      if (found) {
        clip = found;
        trackId = t.id;
        break;
      }
    }
    const resultado = this.duplicarEntidad({
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
      tipo: 'clip',
      idEntidad: idClip,
    } as OpcionesDuplicado);

    return {
      tipo: 'clip',
      opciones: { ...opciones, tipo: 'clip', idEntidad: idClip } as any,
      resultado,
      clipsDuplicados: resultado.idsDuplicados.map((id, i) => ({
        id,
        nombre: resultado.nombresDuplicados[i] ?? '',
        trackId,
        inicio: (clip?.inicio ?? 0) + (opciones?.desplazamientoInicio ?? clip?.duracion ?? 0),
        duracion: clip?.duracion ?? 0,
        fadeIn: clip?.fadeIn ? { duracion: clip.fadeIn.duracion, curva: String(clip.fadeIn.curva) } : null,
        fadeOut: clip?.fadeOut ? { duracion: clip.fadeOut.duracion, curva: String(clip.fadeOut.curva) } : null,
      })),
    };
  }

  duplicarPlugin(idPlugin: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'plugin', idEntidad: idPlugin } as OpcionesDuplicado);
    return {
      tipo: 'plugin',
      opciones: { ...opciones, tipo: 'plugin' } as any,
      resultado,
      pluginsDuplicados: [],
    };
  }

  duplicarAutomatizacion(idAutomatizacion: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'automatizacion', idEntidad: idAutomatizacion } as OpcionesDuplicado);
    return {
      tipo: 'automatizacion',
      opciones: { ...opciones, tipo: 'automatizacion' } as any,
      resultado,
      automatizacionesDuplicadas: [],
    };
  }

  duplicarMarcador(idMarcador: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'marcador', idEntidad: idMarcador } as OpcionesDuplicado);
    return {
      tipo: 'marcador',
      opciones: { ...opciones, tipo: 'marcador' } as any,
      resultado,
      marcadoresDuplicados: [],
    };
  }

  duplicarRegion(idRegion: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'region', idEntidad: idRegion } as OpcionesDuplicado);
    return {
      tipo: 'region',
      opciones: { ...opciones, tipo: 'region' } as any,
      resultado,
      regionesDuplicadas: [],
    };
  }

  duplicarVCA(idVCA: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'vca', idEntidad: idVCA } as OpcionesDuplicado);
    return {
      tipo: 'vca',
      opciones: { ...opciones, tipo: 'vca' } as any,
      resultado,
      vcasDuplicados: [],
    };
  }

  duplicarBus(idBus: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'bus', idEntidad: idBus } as OpcionesDuplicado);
    return {
      tipo: 'bus',
      opciones: { ...opciones, tipo: 'bus' } as any,
      resultado,
      busesDuplicados: [],
    };
  }

  duplicarLoop(idLoop: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'loop', idEntidad: idLoop } as OpcionesDuplicado);
    return {
      tipo: 'loop',
      opciones: { ...opciones, tipo: 'loop' } as any,
      resultado,
      loopsDuplicados: [],
    };
  }

  duplicarEscena(idEscena: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'escena', idEntidad: idEscena } as OpcionesDuplicado);
    return {
      tipo: 'escena',
      opciones: { ...opciones, tipo: 'escena' } as any,
      resultado,
      escenasDuplicadas: [],
    };
  }

  duplicarPreset(idPreset: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'preset', idEntidad: idPreset } as OpcionesDuplicado);
    return {
      tipo: 'preset',
      opciones: { ...opciones, tipo: 'preset' } as any,
      resultado,
      presetsDuplicados: [],
    };
  }

  duplicarPlantilla(idPlantilla: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'plantilla', idEntidad: idPlantilla } as OpcionesDuplicado);
    return {
      tipo: 'plantilla',
      opciones: { ...opciones, tipo: 'plantilla' } as any,
      resultado,
      plantillasDuplicadas: [],
    };
  }

  duplicarMedio(idMedio: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'medio', idEntidad: idMedio } as OpcionesDuplicado);
    return {
      tipo: 'medio',
      opciones: { ...opciones, tipo: 'medio' } as any,
      resultado,
      mediosDuplicados: [],
    };
  }

  duplicarToma(idToma: string, opciones?: Partial<OpcionesDuplicado>): ResultadoDuplicadoEspecifico {
    const resultado = this.duplicarEntidad({ ...opciones, tipo: 'toma', idEntidad: idToma } as OpcionesDuplicado);
    return {
      tipo: 'toma',
      opciones: { ...opciones, tipo: 'toma' } as any,
      resultado,
      tomasDuplicadas: [],
    };
  }
}
