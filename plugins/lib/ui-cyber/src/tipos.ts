/** Formato de plugins/<id>/ui-layout.json (lo genera `<Target>_snapshot.exe --dump-layout`). */

/** [izquierda, arriba, derecha, abajo] en unidades de diseño (1100×620). */
export type Rect4 = [number, number, number, number]

export type TipoWidget =
  | 'knob' | 'fader' | 'toggle' | 'dropdown' | 'section' | 'meter' | 'button' | 'reset'
  // página MIX / FX (FX Rack): botón de cabecera, RESET FX, gráfica del ecualizador y medidor de reducción del compresor
  | 'pagina' | 'reset-fx' | 'mixfx-eq' | 'mixfx-gr'
  // selector [ BÁSICO | AVANZADO ] de la cabecera
  | 'modo'

/** Modo del editor: Básico muestra solo los controles esenciales; Avanzado, el 100 % de los parámetros. */
export type ModoEditor = 'basico' | 'avanzado'
export type EscalaParametro = 'linear' | 'log' | 'stepped'

/** Definición de un parámetro de una banda del ecualizador (volcada junto a la gráfica `mixfx-eq`). */
export type ParamBanda = {
  param: number
  min: number
  max: number
  defecto: number
  escala: EscalaParametro
  decimales: number
  bipolar: boolean
  unidad: string
  nombre: string
}
export type BandaLayout = { freq: ParamBanda; gain: ParamBanda; q: ParamBanda }

export type WidgetLayout = {
  tipo: TipoWidget
  rect: Rect4
  etiqueta: string
  /** Perillas: 30 (pequeña), 44 (normal) o 64 (principal). */
  tamano?: number
  /** Id VST del parámetro (en las secciones, el de su píldora). */
  param?: number
  min?: number
  max?: number
  defecto?: number
  pasos?: number
  escala?: EscalaParametro
  decimales?: number
  bipolar?: boolean
  bypass?: boolean
  nombre?: string
  unidad?: string
  feature?: string
  opciones?: string[]
  /** 0/ausente = editor base del plugin; 1 = página MIX / FX; 2 = página PARÁMETROS (lo que el editor no expone). */
  pagina?: number
  /** false = solo se ve en el modo Avanzado (ausente = siempre). */
  basico?: boolean
  /** Rectángulo en el modo Básico cuando el reflujo lo recoloca (ausente = el mismo `rect`). */
  rectBasico?: Rect4
  /** Selector de modo: x de la frontera entre BÁSICO y AVANZADO. */
  corte?: number
  /** Botón de página: texto mientras la página está abierta. */
  textoAbierta?: string
  /** Desplegable con su nombre encima de la caja (página PARÁMETROS). */
  etiquetaArriba?: boolean
  /** Página MIX / FX: base de ids del rack (`mixfx-eq`, `mixfx-gr`), rango y bandas de la gráfica. */
  base?: number
  dbMin?: number
  dbMax?: number
  fMin?: number
  fMax?: number
  maxDb?: number
  bandas?: BandaLayout[]
  /** Botón de selección de banda (0..5). */
  selBanda?: number
  /** Perilla que sigue a la banda seleccionada: frecuencia, ganancia o Q. */
  bandaRol?: 'freq' | 'gain' | 'q'
  /** Botón de cabecera que abre/cierra la página indicada. */
  paginaDestino?: number
}

export type UiLayout = {
  productId: string
  titulo: string
  subtitulo: string
  instrumento: boolean
  visualizador: 'espectro-dual' | 'espectro-instrumento' | 'vectorscopio' | 'curva-tono'
  acento: string
  base: { ancho: number; alto: number }
  zonas: {
    pantalla: Rect4
    visualizador: Rect4
    espectro: Rect4
    miniPanel: Rect4
    controles: Rect4
    salida: Rect4
    fader: Rect4
    medidores: { x: number; arriba: number; abajo: number }
  }
  escalas: { frecuencia: [number, number]; dbfs: [number, number]; caidaDbS: number }
  modoParam: number | null
  /** Selector BÁSICO | AVANZADO de la cabecera y modo con el que abre el editor. */
  modos?: { selector: Rect4; corte: number; defecto: ModoEditor }
  /** Parámetros expuestos sin widget propio (perillas que siguen a una banda, páginas dibujadas a mano). */
  parametrosCubiertos?: number[]
  widgets: WidgetLayout[]
}

/** Parámetro con todo lo necesario para mapear y formatear su valor. */
export type DefParametro = Required<Pick<WidgetLayout, 'min' | 'max' | 'defecto' | 'escala'>> &
  Pick<WidgetLayout, 'pasos' | 'decimales' | 'bipolar' | 'bypass' | 'unidad' | 'opciones' | 'nombre'>
