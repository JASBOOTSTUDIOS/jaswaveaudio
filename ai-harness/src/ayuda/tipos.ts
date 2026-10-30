/** Esquema de la base de ayuda («maestra del DAW»). Sin dependencias de UI. */
export const TIPOS_FICHA = ['pantalla', 'panel', 'herramienta', 'plugin', 'concepto', 'leccion'] as const
export type TipoFicha = (typeof TIPOS_FICHA)[number]

export const NIVELES_FICHA = ['principiante', 'intermedio', 'experto'] as const
export type NivelFicha = (typeof NIVELES_FICHA)[number]

export const FUENTES_FICHA = ['generada', 'curada'] as const
export type FuenteFicha = (typeof FUENTES_FICHA)[number]

export type ComoAbrir = {
  /** Id de herramienta del DAW (se abre con `abrir_pantalla`). */
  herramienta?: string
  /** Menú en texto, p. ej. «Archivo > Exportar». */
  menu?: string
  /** Atajo de teclado, p. ej. «Ctrl+E». */
  atajo?: string
}

export type ControlAyuda = {
  /** Id estable (`data-ayuda`) para poder resaltarlo. */
  ayuda: string
  etiqueta: string
  descripcion?: string
}

export type FichaAyuda = {
  /** `tipo:nombre`, p. ej. `panel:mixer`, `concepto:bus`. El prefijo coincide con `tipo`. */
  id: string
  tipo: TipoFicha
  titulo: string
  resumen: string
  nivel: NivelFicha
  comoAbrir?: ComoAbrir
  /** Qué se hace allí (pasos). */
  pasos?: string[]
  controles?: ControlAyuda[]
  relacionadas?: string[]
  /** Sinónimos y palabras con las que el usuario lo nombra. */
  etiquetas?: string[]
  fuente: FuenteFicha
}

export type ErrorFicha = { id: string; campo: string; mensaje: string }
