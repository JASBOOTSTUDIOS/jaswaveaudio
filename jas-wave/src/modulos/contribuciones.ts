/**
 * Contribuciones de los módulos activos al núcleo (menús, ajustes, componentes globales, zoom). El
 * núcleo las pinta donde corresponde sin conocer los módulos.
 */

import type { ContextoClip, ContribucionMenuClip, PaginaAjustes, ServiciosModulo } from '@jaswave/host-sdk/contrato'
import { contribuciones } from './registro-modulos'
import { useVersionModulos } from './use-modulos'

export function accionesDeClip(c: ContextoClip): ContribucionMenuClip[] {
  return contribuciones()
    .flatMap((m) => m.menus?.clip ?? [])
    .filter((a) => {
      try {
        return a.visible ? a.visible(c) : true
      } catch {
        return false
      }
    })
}

/** Ejecuta una acción de módulo sin que un fallo del módulo afecte al DAW. */
export function ejecutarAccionDeClip(a: ContribucionMenuClip, c: ContextoClip): void {
  try {
    void Promise.resolve(a.ejecutar(c)).catch((e: unknown) => console.warn(`[modulos] ${a.id} falló`, e))
  } catch (e) {
    console.warn(`[modulos] ${a.id} falló`, e)
  }
}

export function useAccionesDeClip(c: ContextoClip | null): ContribucionMenuClip[] {
  useVersionModulos()
  return c ? accionesDeClip(c) : []
}

export function usePaginasAjustes(): PaginaAjustes[] {
  useVersionModulos()
  return contribuciones().flatMap((m) => m.ajustes ?? [])
}

export function useComponentesGlobales() {
  useVersionModulos()
  return contribuciones().flatMap((m) => m.globales ?? [])
}

/** Zoom de texto (Ctrl±) de un módulo cuyo elemento tiene el foco; null si ninguno lo reclama. */
export function zoomDeModulo(el: Element | null) {
  if (!el) return null
  for (const m of contribuciones()) {
    try {
      if (m.zoom?.esObjetivo(el)) return m.zoom
    } catch {
      /* ignora módulos defectuosos */
    }
  }
  return null
}

/** Servicio que ofrece algún módulo activo (p. ej. 'partitura'); undefined si ninguno lo ofrece. */
export function servicioDeModulo<K extends keyof ServiciosModulo>(nombre: K): ServiciosModulo[K] | undefined {
  for (const m of contribuciones()) {
    const s = m.servicios?.[nombre]
    if (s) return s
  }
  return undefined
}
