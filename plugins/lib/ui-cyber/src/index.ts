/**
 * @jaswave/ui-cyber — el editor cyber de los VST de JasWave en Canvas, para la web (V4).
 * Se dibuja desde plugins/<id>/ui-layout.json, la misma fuente que el editor nativo (V3), con los mismos
 * tokens, escalas, balística y comportamiento de los controles.
 */

export type { DefParametro, EscalaParametro, Rect4, TipoWidget, UiLayout, WidgetLayout } from './tipos'
export { aNormalizado, aPlano, defDe, formatear, interpretar, limitar01, normalizadoPorDefecto, pasoRueda } from './valores'
export { Balistica, CAIDA_DB_S, DB_MAX, DB_MIN, F_MAX, F_MIN, columnasDesdeBins, frecuenciaDeX, xDeFrecuencia, yDeDbfs } from './espectro'
export { PESTANAS, altoDe, anchoDe, areaSensible, contiene, escalaPara, modoPorAncho, pildora, vistaDe, widgetEn, type Modo, type Pestana } from './disposicion'
export { PAL, dibujarEditor, tamanoDe, type EstadoDibujo, type Medidor } from './dibujo'
export { EditorCyber, type FaseCambio, type OpcionesEditor, type RectCss } from './editor'
