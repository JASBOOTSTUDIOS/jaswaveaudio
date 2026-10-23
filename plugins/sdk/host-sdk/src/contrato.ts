/**
 * Contrato de un módulo instalable de JasWave (asistente IA, partitura, herramientas de terceros…).
 *
 * Un módulo es un paquete independiente (plugins/<id>/) que exporta por defecto `definirModulo({...})`
 * desde su `entrypoints.ui` (ESM). El DAW lo descarga del catálogo firmado, verifica su integridad, lo
 * carga y llama a `activar`. Todo lo que el módulo necesita del DAW lo toma de `@jaswave/host-sdk`.
 */

import type { ComponentType } from 'react'

export type ZonaDock = 'left' | 'center' | 'right' | 'bottom'

/** Herramienta (pestaña acoplable) que aporta el módulo al workspace. */
export type DefinicionHerramienta = {
  /** Único en todo el DAW: se recomienda prefijarlo con el nombre del módulo. */
  id: string
  titulo: string
  descripcion: string
  zona: ZonaDock
  /** Icono de la pestaña (p. ej. un icono de lucide-react empaquetado en el módulo). */
  icono?: ComponentType<{ className?: string }>
  /** No se coloca sola en el layout: solo cuando se pide. */
  bajoDemanda?: boolean
}

export type ContextoClip = { clipId: string; trackId: string; tipo: 'midi' | 'audio' }

/** Entrada del menú contextual de un clip. */
export type ContribucionMenuClip = {
  id: string
  etiqueta: string
  /** Icono para la barra del piano roll (si no, solo aparece en el menú contextual del clip). */
  icono?: ComponentType<{ className?: string }>
  visible?: (c: ContextoClip) => boolean
  ejecutar: (c: ContextoClip) => void | Promise<void>
}

/** Página de ajustes que el módulo añade a Configuración. */
export type PaginaAjustes = { id: string; titulo: string; componente: ComponentType }

/** Atajo de teclado global del módulo (solo se dispara si el foco no está en un campo de texto). */
export type ContribucionAtajo = { id: string; teclas: string; descripcion: string; ejecutar: () => void }

export type ModuloActivo = {
  /** Componente de cada herramienta declarada (por id). */
  paneles: Record<string, ComponentType>
  ajustes?: PaginaAjustes[]
  menus?: { clip?: ContribucionMenuClip[] }
  /** Montados siempre mientras el módulo está activo (diálogos, escuchas de eventos…). */
  globales?: ComponentType[]
  /** Zoom de texto con Ctrl+rueda/Ctrl± cuando el foco está dentro de un elemento del módulo. */
  zoom?: { esObjetivo: (el: Element) => boolean; cambiar: (delta: number) => void; restablecer: () => void }
  desactivar?: () => void
}

/** Almacenamiento clave-valor del módulo (con espacio de nombres propio). */
export type AlmacenModulo = {
  leer: (clave: string) => string | null
  escribir: (clave: string, valor: string) => void
  borrar: (clave: string) => void
}

export type ContextoModulo = {
  idModulo: string
  plataforma: 'escritorio' | 'web'
  almacen: AlmacenModulo
}

export type DefinicionModulo = {
  id: string
  nombre: string
  version: string
  /** Versión del SDK con la que se compiló (ver VERSION_SDK). */
  sdk: number
  herramientas: DefinicionHerramienta[]
  activar: (ctx: ContextoModulo) => ModuloActivo | Promise<ModuloActivo>
}

export function definirModulo(d: DefinicionModulo): DefinicionModulo {
  return d
}
