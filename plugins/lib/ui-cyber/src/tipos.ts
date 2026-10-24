/** Formato de plugins/<id>/ui-layout.json (lo genera `<Target>_snapshot.exe --dump-layout`). */

/** [izquierda, arriba, derecha, abajo] en unidades de diseño (1100×620). */
export type Rect4 = [number, number, number, number]

export type TipoWidget = 'knob' | 'fader' | 'toggle' | 'dropdown' | 'section' | 'meter' | 'button'
export type EscalaParametro = 'linear' | 'log' | 'stepped'

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
}

export type UiLayout = {
  productId: string
  titulo: string
  subtitulo: string
  instrumento: boolean
  visualizador: 'espectro-dual' | 'espectro-instrumento' | 'vectorscopio'
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
  widgets: WidgetLayout[]
}

/** Parámetro con todo lo necesario para mapear y formatear su valor. */
export type DefParametro = Required<Pick<WidgetLayout, 'min' | 'max' | 'defecto' | 'escala'>> &
  Pick<WidgetLayout, 'pasos' | 'decimales' | 'bipolar' | 'bypass' | 'unidad' | 'opciones' | 'nombre'>
