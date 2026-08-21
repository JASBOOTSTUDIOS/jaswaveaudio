/**
 * Gestor de watchers para el estado del DAW.
 *
 * Propósito:
 *   Permitir observar cambios en campos específicos de DAWState con
 *   filtrado, debounce y throttle, sin acoplar la tienda de estado
 *   a la lógica de observación.
 *
 * Importancia:
 *   - Facilita la reactividad sin librerías externas.
 *   - Centraliza la lógica de notificación selectiva.
 *   - Soporta debugging, profiling y sincronización externa.
 *
 * Función:
 *   Exporta ObservadorEstado con registrar, desregistrar y
 *   notificarCambio, basado en la interfaz DAWStateWatch.
 */

import type { DAWState } from '../types/state';
import type { DAWStateWatch, DAWStateChange } from '../types/state';
import type { TiendaDAW } from './tienda';
import type { ValorJSON } from '../events/evento-dominio';

interface WatchEntry {
  watch: DAWStateWatch;
  ultimoValores: Record<string, unknown>;
  ultimaEjecucion: number;
  temporizadorDebounce?: ReturnType<typeof setTimeout>;
}

export interface ObservadorEstado {
  registrar(watch: DAWStateWatch): () => void;
  desregistrar(id: string): void;
  notificarCambio(estadoNuevo: DAWState, estadoAnterior: DAWState): void;
  obtenerCambios(): DAWStateChange[];
}

export function crearObservadorEstado(tienda: TiendaDAW): ObservadorEstado {
  const watches = new Map<string, WatchEntry>();

  function obtenerValorCampo(estado: DAWState, campo: string): unknown {
    const partes = campo.split('.');
    let valor: unknown = estado as unknown as Record<string, unknown>;
    for (const parte of partes) {
      if (valor && typeof valor === 'object' && parte in (valor as Record<string, unknown>)) {
        valor = (valor as Record<string, unknown>)[parte];
      } else {
        return undefined;
      }
    }
    return valor;
  }

  function camposCambiaron(entry: WatchEntry, estadoNuevo: DAWState, estadoAnterior: DAWState): string[] {
    const cambios: string[] = [];
    for (const campo of entry.watch.campos) {
      const valorNuevo = obtenerValorCampo(estadoNuevo, campo);
      const valorAnterior = obtenerValorCampo(estadoAnterior, campo);
      if (valorNuevo !== valorAnterior) {
        cambios.push(campo);
      }
    }
    return cambios;
  }

  function ejecutarWatch(entry: WatchEntry, estadoNuevo: DAWState, estadoAnterior: DAWState, cambios: string[]): void {
    if (!entry.watch.activo) return;
    if (entry.watch.filtro && !entry.watch.filtro(estadoNuevo, estadoAnterior)) return;
    try {
      entry.watch.callback(estadoNuevo, estadoAnterior, cambios);
    } catch (error) {
      console.error(`Error en watch "${entry.watch.nombre}":`, error);
    }
  }

  function notificarCambioInterno(estadoNuevo: DAWState, estadoAnterior: DAWState): void {
    const ahora = Date.now();
    for (const [id, entry] of watches) {
      if (!entry.watch.activo) continue;
      const cambios = camposCambiaron(entry, estadoNuevo, estadoAnterior);
      if (cambios.length === 0) continue;

      if (entry.watch.inmediato) {
        ejecutarWatch(entry, estadoNuevo, estadoAnterior, cambios);
        continue;
      }

      if (entry.watch.debounceMs) {
        if (entry.temporizadorDebounce) {
          clearTimeout(entry.temporizadorDebounce);
        }
        entry.temporizadorDebounce = setTimeout(() => {
          ejecutarWatch(entry, estadoNuevo, estadoAnterior, cambios);
          entry.temporizadorDebounce = undefined;
        }, entry.watch.debounceMs);
        continue;
      }

      if (entry.watch.throttleMs) {
        const tiempoTranscurrido = ahora - entry.ultimaEjecucion;
        if (tiempoTranscurrido >= entry.watch.throttleMs) {
          ejecutarWatch(entry, estadoNuevo, estadoAnterior, cambios);
          entry.ultimaEjecucion = ahora;
        }
        continue;
      }

      ejecutarWatch(entry, estadoNuevo, estadoAnterior, cambios);
    }
  }

  tienda.suscribir((estadoNuevo, estadoAnterior) => {
    notificarCambioInterno(estadoNuevo, estadoAnterior);
  });

  return {
    registrar(watch: DAWStateWatch): () => void {
      const entry: WatchEntry = {
        watch,
        ultimoValores: {},
        ultimaEjecucion: 0,
      };
      watches.set(watch.id, entry);
      if (watch.inmediato) {
        const estado = tienda.obtenerEstado();
        const cambios = watch.campos.filter(campo => {
          const valor = obtenerValorCampo(estado, campo);
          entry.ultimoValores[campo] = valor;
          return true;
        });
        if (watch.filtro && !watch.filtro(estado, estado)) {
          return () => watches.delete(watch.id);
        }
        try {
          watch.callback(estado, estado, cambios);
        } catch (error) {
          console.error(`Error en watch inicial "${watch.nombre}":`, error);
        }
      }
      return () => watches.delete(watch.id);
    },

    desregistrar(id: string): void {
      const entry = watches.get(id);
      if (entry?.temporizadorDebounce) {
        clearTimeout(entry.temporizadorDebounce);
      }
      watches.delete(id);
    },

    notificarCambio(estadoNuevo: DAWState, estadoAnterior: DAWState): void {
      notificarCambioInterno(estadoNuevo, estadoAnterior);
    },

    obtenerCambios(): DAWStateChange[] {
      const cambios: DAWStateChange[] = [];
      for (const [id, entry] of watches) {
        if (!entry.watch.activo) continue;
        const estado = tienda.obtenerEstado();
        const cambiosCampos = camposCambiaron(entry, estado, estado);
        if (cambiosCampos.length > 0) {
          cambios.push({
            watchId: id,
            marcaTiempo: Date.now(),
            cambios: cambiosCampos,
            estadoAnterior: estado as unknown as Record<string, ValorJSON>,
            estadoNuevo: estado as unknown as Record<string, ValorJSON>,
          });
        }
      }
      return cambios;
    },
  };
}
