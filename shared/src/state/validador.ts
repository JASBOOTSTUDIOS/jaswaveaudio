/**
 * Validador de integridad de DAWState.
 *
 * Propósito:
 *   Verificar que un DAWState cumpla los invariantes básicos y avanzados
 *   del dominio antes de persistirlo, migrarlo o procesarlo.
 *
 * Importancia:
 *   - Detecta corrupción de estado tempranamente.
 *   - Provee feedback estructurado para debugging y UI.
 *   - Facilita la validación antes de migraciones, exportación o
 *     sincronización en nube.
 *
 * Función:
 *   Exporta validarEstado que devuelve ValidacionEstadoResultado con
 *   errores, advertencias y resumen de validación exhaustivo.
 */

import type { DAWState } from '../types/state';

export interface ValidacionEstadoResultado {
  validado: boolean;
  errores: Array<{
    campo: string;
    mensaje: string;
    severidad: 'error' | 'advertencia' | 'info';
    entidadId?: string;
    solucion?: string;
  }>;
  advertencias: Array<{
    campo: string;
    mensaje: string;
    entidadId?: string;
  }>;
  resumen: {
    totalErrores: number;
    totalAdvertencias: number;
    camposAfectados: string[];
  };
}

export function validarEstado(estado: DAWState): ValidacionEstadoResultado {
  const errores: ValidacionEstadoResultado['errores'] = [];
  const advertencias: ValidacionEstadoResultado['advertencias'] = [];
  const camposAfectados = new Set<string>();

  const reg = (campo: string, mensaje: string, severidad: 'error' | 'advertencia' | 'info' = 'error', entidadId?: string, solucion?: string) => {
    if (severidad === 'error') {
      errores.push({ campo, mensaje, severidad, entidadId, solucion });
    } else {
      advertencias.push({ campo, mensaje, entidadId });
    }
    camposAfectados.add(campo);
  };

  if (!estado.project.id || typeof estado.project.id !== 'string' || estado.project.id.length === 0) {
    reg('project.id', 'El proyecto debe tener un id válido', 'error');
  }
  if (!estado.project.nombre || typeof estado.project.nombre !== 'string') {
    reg('project.nombre', 'El proyecto debe tener un nombre', 'advertencia');
  }
  if (typeof estado.project.sampleRate !== 'number' || estado.project.sampleRate <= 0) {
    reg('project.sampleRate', 'sampleRate debe ser un número mayor a 0', 'error');
  }
  if (typeof estado.project.bitDepth !== 'number' || estado.project.bitDepth <= 0) {
    reg('project.bitDepth', 'bitDepth debe ser un número mayor a 0', 'error');
  }
  if (!estado.project.bpm || typeof estado.project.bpm.valor !== 'number' || estado.project.bpm.valor <= 0) {
    reg('project.bpm.valor', 'BPM debe ser mayor a 0', 'error');
  }
  if (!estado.project.timeSignature || typeof estado.project.timeSignature.numerador !== 'number' || estado.project.timeSignature.numerador <= 0) {
    reg('project.timeSignature.numerador', 'El numerador del compás debe ser mayor a 0', 'error');
  }
  if (!estado.project.tracks || !Array.isArray(estado.project.tracks)) {
    reg('project.tracks', 'project.tracks debe ser un array', 'error');
  }

  const nombresTracks = new Set<string>();
  for (const track of estado.project.tracks) {
    if (!track.id) {
      reg('track.id', 'Track sin id', 'error', track.id);
    }
    if (typeof track.nombre !== 'string' || track.nombre.length === 0) {
      reg('track.nombre', 'Track sin nombre', 'advertencia', track.id);
    }
    if (nombresTracks.has(track.nombre)) {
      reg('track.nombre', `Nombre de track duplicado: ${track.nombre}`, 'error', track.id);
    }
    nombresTracks.add(track.nombre);
    if (typeof track.volumen !== 'number' || track.volumen < 0 || track.volumen > 2) {
      reg('track.volumen', 'Volumen fuera de rango [0, 2]', 'advertencia', track.id);
    }
    if (typeof track.paneo !== 'number' || track.paneo < -1 || track.paneo > 1) {
      reg('track.paneo', 'Paneo fuera de rango [-1, 1]', 'advertencia', track.id);
    }
    if (typeof track.volumenOriginal !== 'number' || track.volumenOriginal < -60 || track.volumenOriginal > 12) {
      reg('track.volumenOriginal', 'Volumen original en dB fuera de rango [-60, 12]', 'advertencia', track.id);
    }
    if (!Array.isArray(track.clips)) {
      reg('track.clips', 'track.clips debe ser un array', 'error', track.id);
    }
    if (!Array.isArray(track.plugins)) {
      reg('track.plugins', 'track.plugins debe ser un array', 'error', track.id);
    }
    if (!Array.isArray(track.automatizaciones)) {
      reg('track.automatizaciones', 'track.automatizaciones debe ser un array', 'advertencia', track.id);
    }
    if (!Array.isArray(track.envios)) {
      reg('track.envios', 'track.envios debe ser un array', 'error', track.id);
    }
    if (!Array.isArray(track.receives)) {
      reg('track.receives', 'track.receives debe ser un array', 'error', track.id);
    }
    if (!Array.isArray(track.fades)) {
      reg('track.fades', 'track.fades debe ser un array', 'error', track.id);
    }
    if (!Array.isArray(track.marcadores)) {
      reg('track.marcadores', 'track.marcadores debe ser un array', 'error', track.id);
    }
    if (!Array.isArray(track.medios)) {
      reg('track.medios', 'track.medios debe ser un array', 'error', track.id);
    }
    if (typeof track.color !== 'string') {
      reg('track.color', 'track.color debe ser un string', 'advertencia', track.id);
    }
    if (typeof track.orden !== 'number') {
      reg('track.orden', 'track.orden debe ser un número', 'advertencia', track.id);
    }
  }

  for (const track of estado.project.tracks) {
    for (const clip of track.clips) {
      if (typeof clip.inicio !== 'number' || clip.inicio < 0) {
        reg('clip.inicio', 'Clip con inicio negativo', 'error', clip.id);
      }
      if (typeof clip.duracion !== 'number' || clip.duracion <= 0) {
        reg('clip.duracion', 'Clip con duración inválida', 'error', clip.id);
      }
      if (typeof clip.nombre !== 'string' || clip.nombre.length === 0) {
        reg('clip.nombre', 'Clip sin nombre', 'advertencia', clip.id);
      }
      if (clip.tipo === 'audio') {
        const audioClip = clip as any;
        if (typeof audioClip.clipInicio !== 'number') {
          reg('audioClip.clipInicio', 'clipInicio inválido', 'advertencia', clip.id);
        }
        if (!audioClip.fadeIn || typeof audioClip.fadeIn.duracion !== 'number' || audioClip.fadeIn.duracion < 0) {
          reg('audioClip.fadeIn.duracion', 'Duración de fadeIn inválida', 'error', clip.id);
        }
        if (!audioClip.fadeOut || typeof audioClip.fadeOut.duracion !== 'number' || audioClip.fadeOut.duracion < 0) {
          reg('audioClip.fadeOut.duracion', 'Duración de fadeOut inválida', 'error', clip.id);
        }
        if (audioClip.waveform && !Array.isArray(audioClip.waveform)) {
          reg('audioClip.waveform', 'waveform debe ser un array', 'advertencia', clip.id);
        }
      }
      if (clip.tipo === 'midi') {
        const midiClip = clip as any;
        if (!Array.isArray(midiClip.notas)) {
          reg('midiClip.notas', 'notas debe ser un array', 'error', clip.id);
        } else {
          for (const nota of midiClip.notas) {
            if (typeof nota.pitch !== 'number' || nota.pitch < 0 || nota.pitch > 127) {
              reg('midiClip.nota.pitch', 'Pitch de nota MIDI inválido', 'error', clip.id);
            }
            if (typeof nota.velocity !== 'number' || nota.velocity < 0 || nota.velocity > 127) {
              reg('midiClip.nota.velocity', 'Velocity de nota MIDI inválida', 'error', clip.id);
            }
            if (typeof nota.start !== 'number' || nota.start < 0) {
              reg('midiClip.nota.start', 'Start de nota MIDI inválido', 'error', clip.id);
            }
            if (typeof nota.duration !== 'number' || nota.duration <= 0) {
              reg('midiClip.nota.duration', 'Duration de nota MIDI inválida', 'error', clip.id);
            }
          }
        }
      }
    }
  }

  if (!estado.transport || typeof estado.transport.bpm !== 'number' || estado.transport.bpm <= 0) {
    reg('transport.bpm', 'BPM de transporte inválido', 'error');
  }
  if (typeof estado.transport.reproduciendo !== 'boolean') {
    reg('transport.reproduciendo', 'Estado de reproducción inválido', 'advertencia');
  }
  if (!estado.transport.posicion || typeof estado.transport.posicion.segundos !== 'number' || estado.transport.posicion.segundos < 0) {
    reg('transport.posicion.segundos', 'Posición de transporte inválida', 'error');
  }
  if (estado.transport.loop && estado.transport.loop.activo && estado.transport.loop.inicio.segundos >= estado.transport.loop.fin.segundos) {
    reg('transport.loop', 'Inicio de loop debe ser menor que el fin', 'error');
  }

  if (!estado.project.routing) {
    reg('project.routing', 'Routing matrix faltante', 'error');
  } else {
    if (!Array.isArray(estado.project.routing.buses)) {
      reg('project.routing.buses', 'Routing buses debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.sends)) {
      reg('project.routing.sends', 'Routing sends debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.rutas)) {
      reg('project.routing.rutas', 'Routing rutas debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.sidechains)) {
      reg('project.routing.sidechains', 'Routing sidechains debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.inserts)) {
      reg('project.routing.inserts', 'Routing inserts debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.conexionesDirectas)) {
      reg('project.routing.conexionesDirectas', 'Routing conexionesDirectas debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.puentes)) {
      reg('project.routing.puentes', 'Routing puentes debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.grupos)) {
      reg('project.routing.grupos', 'Routing grupos debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.ordenTracks)) {
      reg('project.routing.ordenTracks', 'Routing ordenTracks debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.ordenBuses)) {
      reg('project.routing.ordenBuses', 'Routing ordenBuses debe ser un array', 'error');
    }
    if (!Array.isArray(estado.project.routing.etiquetas)) {
      reg('project.routing.etiquetas', 'Routing etiquetas debe ser un array', 'error');
    }
  }

  if (!estado.project.master) {
    reg('project.master', 'Master channel faltante', 'error');
  } else {
    if (typeof estado.project.master.volumen !== 'number' || estado.project.master.volumen < -60 || estado.project.master.volumen > 12) {
      reg('project.master.volumen', 'Volumen de master fuera de rango [-60, 12]', 'error');
    }
    if (typeof estado.project.master.paneo !== 'number' || estado.project.master.paneo < -1 || estado.project.master.paneo > 1) {
      reg('project.master.paneo', 'Paneo de master fuera de rango [-1, 1]', 'error');
    }
    if (typeof estado.project.master.limitador.umbral !== 'number') {
      reg('project.master.limitador.umbral', 'Umbral de limitador inválido', 'advertencia');
    }
    if (typeof estado.project.master.limitador.gananciaSalida !== 'number') {
      reg('project.master.limitador.gananciaSalida', 'Ganancia de salida de limitador inválida', 'advertencia');
    }
    if (typeof estado.project.master.limitador.release !== 'number') {
      reg('project.master.limitador.release', 'Release de limitador inválido', 'advertencia');
    }
    if (typeof estado.project.master.compresor.umbral !== 'number') {
      reg('project.master.compresor.umbral', 'Umbral de compresor inválido', 'advertencia');
    }
    if (typeof estado.project.master.compresor.relacion !== 'number' || estado.project.master.compresor.relacion <= 0) {
      reg('project.master.compresor.relacion', 'Relación de compresor inválida', 'advertencia');
    }
    if (typeof estado.project.master.compresor.ataque !== 'number' || estado.project.master.compresor.ataque < 0) {
      reg('project.master.compresor.ataque', 'Ataque de compresor inválido', 'advertencia');
    }
    if (typeof estado.project.master.compresor.liberacion !== 'number' || estado.project.master.compresor.liberacion < 0) {
      reg('project.master.compresor.liberacion', 'Liberación de compresor inválida', 'advertencia');
    }
    if (typeof estado.project.master.compresor.gananciaSalida !== 'number') {
      reg('project.master.compresor.gananciaSalida', 'Ganancia de salida de compresor inválida', 'advertencia');
    }
    if (typeof estado.project.master.nivelPico !== 'number' || estado.project.master.nivelPico < -60 || estado.project.master.nivelPico > 12) {
      reg('project.master.nivelPico', 'Nivel pico de master inválido', 'advertencia');
    }
    if (typeof estado.project.master.nivelRMS !== 'number' || estado.project.master.nivelRMS < -60 || estado.project.master.nivelRMS > 12) {
      reg('project.master.nivelRMS', 'Nivel RMS de master inválido', 'advertencia');
    }
    if (typeof estado.project.master.reduccionGain !== 'number' || estado.project.master.reduccionGain < 0) {
      reg('project.master.reduccionGain', 'Reducción de ganancia de master inválida', 'advertencia');
    }
    if (typeof estado.project.master.corrupcion !== 'boolean') {
      reg('project.master.corrupcion', 'Corrupción de master inválida', 'advertencia');
    }
  }

  if (!estado.project.analysis) {
    reg('project.analysis', 'Análisis de proyecto faltante', 'advertencia');
  } else {
    if (typeof estado.project.analysis.resumen.duracionTotal !== 'number' || estado.project.analysis.resumen.duracionTotal < 0) {
      reg('project.analysis.resumen.duracionTotal', 'Duración total de análisis inválida', 'error');
    }
    if (!Array.isArray(estado.project.analysis.tracks)) {
      reg('project.analysis.tracks', 'Analysis tracks debe ser un array', 'error');
    }
    if (!estado.project.analysis.master) {
      reg('project.analysis.master', 'Analysis master faltante', 'error');
    }
    if (!estado.project.analysis.histograma || !Array.isArray(estado.project.analysis.histograma.frecuencias)) {
      reg('project.analysis.histograma.frecuencias', 'Histograma frecuencias inválido', 'error');
    }
  }

  if (!estado.project.metadata) {
    reg('project.metadata', 'Metadatos de proyecto faltantes', 'error');
  } else {
    if (typeof estado.project.metadata.autor !== 'string') {
      reg('project.metadata.autor', 'Autor de proyecto inválido', 'advertencia');
    }
    if (typeof estado.project.metadata.genero !== 'string') {
      reg('project.metadata.genero', 'Género de proyecto inválido', 'advertencia');
    }
    if (!Array.isArray(estado.project.metadata.tags)) {
      reg('project.metadata.tags', 'Tags de proyecto deben ser un array', 'advertencia');
    }
    if (typeof estado.project.metadata.version !== 'number') {
      reg('project.metadata.version', 'Versión de metadatos inválida', 'error');
    }
  }

  if (!estado.project.configuracion) {
    reg('project.configuracion', 'Configuración de proyecto faltante', 'error');
  } else {
    if (typeof estado.project.configuracion.sampleRate !== 'number' || estado.project.configuracion.sampleRate <= 0) {
      reg('project.configuracion.sampleRate', 'sampleRate de configuración inválido', 'error');
    }
    if (typeof estado.project.configuracion.bitDepth !== 'number' || estado.project.configuracion.bitDepth <= 0) {
      reg('project.configuracion.bitDepth', 'bitDepth de configuración inválido', 'error');
    }
    if (typeof estado.project.configuracion.soloLectura !== 'boolean') {
      reg('project.configuracion.soloLectura', 'soloLectura debe ser booleano', 'error');
    }
  }

  if (!estado.project.configuracionAvanzada) {
    reg('project.configuracionAvanzada', 'Configuración avanzada faltante', 'advertencia');
  } else {
    if (typeof estado.project.configuracionAvanzada.autoGuardadoIntervalo !== 'number' || estado.project.configuracionAvanzada.autoGuardadoIntervalo <= 0) {
      reg('project.configuracionAvanzada.autoGuardadoIntervalo', 'Intervalo de auto-guardado inválido', 'error');
    }
  }

  if (!Array.isArray(estado.project.marcadores)) {
    reg('project.marcadores', 'Marcadores deben ser un array', 'error');
  } else {
    for (const marcador of estado.project.marcadores) {
      if (!marcador.id) {
        reg('marcador.id', 'Marcador sin id', 'error', marcador.id);
      }
      if (typeof marcador.tiempo !== 'number' || marcador.tiempo < 0) {
        reg('marcador.tiempo', 'Tiempo de marcador inválido', 'error', marcador.id);
      }
    }
  }

  if (!Array.isArray(estado.project.escenas)) {
    reg('project.escenas', 'Escenas deben ser un array', 'error');
  } else {
    for (const escena of estado.project.escenas) {
      if (!escena.id) {
        reg('escena.id', 'Escena sin id', 'error', escena.id);
      }
    }
  }

  if (typeof estado.marcaTiempo !== 'number' || estado.marcaTiempo <= 0) {
    reg('marcaTiempo', 'marcaTiempo inválido', 'error');
  }
  if (typeof estado.esquemaVersion !== 'string' || estado.esquemaVersion.length === 0) {
    reg('esquemaVersion', 'esquemaVersion inválido', 'error');
  }
  if (typeof estado.dispositivoId !== 'string' || estado.dispositivoId.length === 0) {
    reg('dispositivoId', 'dispositivoId inválido', 'error');
  }
  if (typeof estado.sesionId !== 'string' || estado.sesionId.length === 0) {
    reg('sesionId', 'sesionId inválido', 'error');
  }
  if (typeof estado.checksum !== 'string' || estado.checksum.length === 0) {
    reg('checksum', 'checksum inválido', 'advertencia');
  }
  if (typeof estado.tamanioBytes !== 'number' || estado.tamanioBytes < 0) {
    reg('tamanioBytes', 'tamanioBytes inválido', 'advertencia');
  }

  if (!Array.isArray(estado.etiquetas)) {
    reg('etiquetas', 'etiquetas deben ser un array', 'error');
  }
  if (typeof estado.notas !== 'string') {
    reg('notas', 'notas deben ser un string', 'advertencia');
  }
  if (typeof estado.idioma !== 'string' || estado.idioma.length === 0) {
    reg('idioma', 'idioma inválido', 'advertencia');
  }
  if (typeof estado.zonaHoraria !== 'string' || estado.zonaHoraria.length === 0) {
    reg('zonaHoraria', 'zonaHoraria inválida', 'advertencia');
  }
  if (typeof estado.marcaTiempoInicio !== 'number' || estado.marcaTiempoInicio <= 0) {
    reg('marcaTiempoInicio', 'marcaTiempoInicio inválido', 'error');
  }
  if (typeof estado.tiempoTotalUsoMs !== 'number' || estado.tiempoTotalUsoMs < 0) {
    reg('tiempoTotalUsoMs', 'tiempoTotalUsoMs inválido', 'error');
  }

  if (!estado.estadisticasUso) {
    reg('estadisticasUso', 'estadisticasUso faltantes', 'error');
  } else {
    if (typeof estado.estadisticasUso.sesionesTotales !== 'number' || estado.estadisticasUso.sesionesTotales < 0) {
      reg('estadisticasUso.sesionesTotales', 'sesionesTotales inválido', 'error');
    }
    if (typeof estado.estadisticasUso.tiempoPromedioSesionMs !== 'number' || estado.estadisticasUso.tiempoPromedioSesionMs < 0) {
      reg('estadisticasUso.tiempoPromedioSesionMs', 'tiempoPromedioSesionMs inválido', 'error');
    }
    if (typeof estado.estadisticasUso.comandosEjecutados !== 'number' || estado.estadisticasUso.comandosEjecutados < 0) {
      reg('estadisticasUso.comandosEjecutados', 'comandosEjecutados inválido', 'error');
    }
    if (typeof estado.estadisticasUso.eventosProcesados !== 'number' || estado.estadisticasUso.eventosProcesados < 0) {
      reg('estadisticasUso.eventosProcesados', 'eventosProcesados inválido', 'error');
    }
    if (typeof estado.estadisticasUso.erroresTotales !== 'number' || estado.estadisticasUso.erroresTotales < 0) {
      reg('estadisticasUso.erroresTotales', 'erroresTotales inválido', 'error');
    }
    if (typeof estado.estadisticasUso.advertenciasTotales !== 'number' || estado.estadisticasUso.advertenciasTotales < 0) {
      reg('estadisticasUso.advertenciasTotales', 'advertenciasTotales inválido', 'error');
    }
    if (typeof estado.estadisticasUso.exportacionesTotales !== 'number' || estado.estadisticasUso.exportacionesTotales < 0) {
      reg('estadisticasUso.exportacionesTotales', 'exportacionesTotales inválido', 'error');
    }
    if (typeof estado.estadisticasUso.importacionesTotales !== 'number' || estado.estadisticasUso.importacionesTotales < 0) {
      reg('estadisticasUso.importacionesTotales', 'importacionesTotales inválido', 'error');
    }
    if (typeof estado.estadisticasUso.guardadosTotales !== 'number' || estado.estadisticasUso.guardadosTotales < 0) {
      reg('estadisticasUso.guardadosTotales', 'guardadosTotales inválido', 'error');
    }
    if (typeof estado.estadisticasUso.cambiosNoGuardados !== 'number' || estado.estadisticasUso.cambiosNoGuardados < 0) {
      reg('estadisticasUso.cambiosNoGuardados', 'cambiosNoGuardados inválido', 'error');
    }
  }

  if (!estado.rendimiento) {
    reg('rendimiento', 'rendimiento faltante', 'error');
  } else {
    if (typeof estado.rendimiento.cpuPromedio !== 'number' || estado.rendimiento.cpuPromedio < 0 || estado.rendimiento.cpuPromedio > 100) {
      reg('rendimiento.cpuPromedio', 'CPU promedio fuera de rango [0, 100]', 'advertencia');
    }
    if (typeof estado.rendimiento.memoriaPromedioMB !== 'number' || estado.rendimiento.memoriaPromedioMB < 0) {
      reg('rendimiento.memoriaPromedioMB', 'Memoria promedio inválida', 'advertencia');
    }
    if (typeof estado.rendimiento.xrunsTotales !== 'number' || estado.rendimiento.xrunsTotales < 0) {
      reg('rendimiento.xrunsTotales', 'xrunsTotales inválido', 'error');
    }
    if (typeof estado.rendimiento.latenciaPromedioMs !== 'number' || estado.rendimiento.latenciaPromedioMs < 0) {
      reg('rendimiento.latenciaPromedioMs', 'Latencia promedio inválida', 'advertencia');
    }
    if (typeof estado.rendimiento.buffersDescartados !== 'number' || estado.rendimiento.buffersDescartados < 0) {
      reg('rendimiento.buffersDescartados', 'Buffers descartados inválido', 'advertencia');
    }
  }

  if (!estado.configuracionAvanzada) {
    reg('configuracionAvanzada', 'configuracionAvanzada faltante', 'error');
  } else {
    if (typeof estado.configuracionAvanzada.telemetriaActiva !== 'boolean') {
      reg('configuracionAvanzada.telemetriaActiva', 'telemetriaActiva inválida', 'advertencia');
    }
    if (typeof estado.configuracionAvanzada.actualizacionesAutomaticas !== 'boolean') {
      reg('configuracionAvanzada.actualizacionesAutomaticas', 'actualizacionesAutomaticas inválida', 'advertencia');
    }
    if (typeof estado.configuracionAvanzada.confirmacionCierre !== 'boolean') {
      reg('configuracionAvanzada.confirmacionCierre', 'confirmacionCierre inválida', 'advertencia');
    }
    if (typeof estado.configuracionAvanzada.autoGuardadoActivo !== 'boolean') {
      reg('configuracionAvanzada.autoGuardadoActivo', 'autoGuardadoActivo inválida', 'error');
    }
  }

  if (!Array.isArray(estado.extensiones.activas)) {
    reg('extensiones.activas', 'extensiones.activas debe ser un array', 'error');
  } else {
    for (const ext of estado.extensiones.activas) {
      if (typeof ext !== 'string' || ext.length === 0) {
        reg('extensiones.activas', 'Extensión activa inválida', 'error');
        break;
      }
    }
  }
  if (!Array.isArray(estado.extensiones.desactivadas)) {
    reg('extensiones.desactivadas', 'extensiones.desactivadas debe ser un array', 'error');
  } else {
    for (const ext of estado.extensiones.desactivadas) {
      if (typeof ext !== 'string' || ext.length === 0) {
        reg('extensiones.desactivadas', 'Extensión desactivada inválida', 'error');
        break;
      }
    }
  }
  if (!Array.isArray(estado.extensiones.pendientes)) {
    reg('extensiones.pendientes', 'extensiones.pendientes debe ser un array', 'error');
  } else {
    for (const ext of estado.extensiones.pendientes) {
      if (typeof ext !== 'string' || ext.length === 0) {
        reg('extensiones.pendientes', 'Extensión pendiente inválida', 'error');
        break;
      }
    }
  }
  if (!Array.isArray(estado.extensiones.errores)) {
    reg('extensiones.errores', 'extensiones.errores debe ser un array', 'error');
  } else {
    for (const ext of estado.extensiones.errores) {
      if (typeof ext !== 'object' || ext === null) {
        reg('extensiones.errores', 'Extensión con error inválida', 'error');
        break;
      }
      if (typeof ext.extensionId !== 'string' || typeof ext.mensaje !== 'string' || typeof ext.marcaTiempo !== 'number') {
        reg('extensiones.errores', 'Extensión con error inválida', 'error');
        break;
      }
    }
  }

  if (!estado.logs) {
    reg('logs', 'logs faltantes', 'advertencia');
  } else {
    if (!Array.isArray(estado.logs.errores)) {
      reg('logs.errores', 'logs.errores debe ser un array', 'error');
    }
    if (!Array.isArray(estado.logs.advertencias)) {
      reg('logs.advertencias', 'logs.advertencias debe ser un array', 'error');
    }
    if (!Array.isArray(estado.logs.eventos)) {
      reg('logs.eventos', 'logs.eventos debe ser un array', 'error');
    }
    if (typeof estado.logs.maximoEntries !== 'number' || estado.logs.maximoEntries <= 0) {
      reg('logs.maximoEntries', 'maximoEntries inválido', 'error');
    }
  }

  if (!Array.isArray(estado.snapshots)) {
    reg('snapshots', 'snapshots debe ser un array', 'error');
  } else {
    for (const snapshot of estado.snapshots) {
      if (typeof snapshot !== 'object' || snapshot === null) {
        reg('snapshot', 'Snapshot inválido', 'error');
      } else {
        if (!snapshot.id) {
          reg('snapshot.id', 'Snapshot sin id', 'error', snapshot.id);
        }
        if (typeof snapshot.marcaTiempo !== 'number' || snapshot.marcaTiempo <= 0) {
          reg('snapshot.marcaTiempo', 'Snapshot con marcaTiempo inválida', 'error', snapshot.id);
        }
      }
    }
  }

  if (!Array.isArray(estado.migraciones)) {
    reg('migraciones', 'migraciones debe ser un array', 'error');
  }
  if (!Array.isArray(estado.validaciones)) {
    reg('validaciones', 'validaciones debe ser un array', 'error');
  }
  if (!Array.isArray(estado.comparaciones)) {
    reg('comparaciones', 'comparaciones debe ser un array', 'error');
  }

  if (typeof estado.contextoIA !== 'object' || estado.contextoIA === null) {
    reg('contextoIA', 'contextoIA inválido', 'error');
  }
  if (typeof estado.cache !== 'object' || estado.cache === null) {
    reg('cache', 'cache inválida', 'error');
  }
  if (!Array.isArray(estado.proxies)) {
    reg('proxies', 'proxies debe ser un array', 'error');
  }
  if (!estado.historial) {
    reg('historial', 'historial faltante', 'error');
  } else {
    if (!Array.isArray(estado.historial.acciones)) {
      reg('historial.acciones', 'historial.acciones debe ser un array', 'error');
    }
  }

  if (!Array.isArray(estado.busEventos)) {
    reg('busEventos', 'busEventos debe ser un array', 'error');
  }

  if (typeof estado.modoColaboracion !== 'boolean') {
    reg('modoColaboracion', 'modoColaboracion inválido', 'advertencia');
  }
  if (typeof estado.sincronizado !== 'boolean') {
    reg('sincronizado', 'sincronizado inválido', 'advertencia');
  }
  if (typeof estado.ultimaSincronizacion !== 'number' || estado.ultimaSincronizacion < 0) {
    reg('ultimaSincronizacion', 'ultimaSincronizacion inválida', 'advertencia');
  }

  if (typeof estado.ui.tema !== 'string' || estado.ui.tema.length === 0) {
    reg('ui.tema', 'Tema de UI inválido', 'advertencia');
  }
  if (typeof estado.ui.idioma !== 'string' || estado.ui.idioma.length === 0) {
    reg('ui.idioma', 'Idioma de UI inválido', 'advertencia');
  }
  if (typeof estado.ui.herramientaActiva !== 'string') {
    reg('ui.herramientaActiva', 'Herramienta activa inválida', 'advertencia');
  }
  if (typeof estado.ui.modoEdicion !== 'string') {
    reg('ui.modoEdicion', 'Modo de edición inválido', 'advertencia');
  }

  const totalErrores = errores.length;
  const totalAdvertencias = advertencias.length;

  return {
    validado: totalErrores === 0,
    errores,
    advertencias,
    resumen: {
      totalErrores,
      totalAdvertencias,
      camposAfectados: Array.from(camposAfectados),
    },
  };
}
