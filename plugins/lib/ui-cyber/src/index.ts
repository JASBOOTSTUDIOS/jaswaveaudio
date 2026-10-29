/**
 * @jaswave/ui-cyber — el editor cyber de los VST de JasWave en Canvas, para la web (V4).
 * Se dibuja desde plugins/<id>/ui-layout.json, la misma fuente que el editor nativo (V3), con los mismos
 * tokens, escalas, balística y comportamiento de los controles.
 */

export type { BandaLayout, DefParametro, EscalaParametro, ModoEditor, ParamBanda, Rect4, TipoWidget, UiLayout, WidgetLayout } from './tipos'
export { aNormalizado, aPlano, defDe, formatear, interpretar, limitar01, normalizadoPorDefecto, pasoRueda } from './valores'
export { Balistica, CAIDA_DB_S, DB_MAX, DB_MIN, F_MAX, F_MIN, columnasDesdeBins, frecuenciaDeX, xDeFrecuencia, yDeDbfs } from './espectro'
export { PESTANAS, altoDe, anchoDe, areaSensible, contiene, escalaPara, layoutParaVista, modoEnSelector, modoInicial, modoPorAncho, pildora, vistaDe, visibleEnPagina, widgetEn, type Modo, type Pestana } from './disposicion'
export { BANDA_INICIAL, PAL, dibujarEditor, notaEnTeclado, rectTeclado, tamanoDe, type EstadoDibujo, type Medidor } from './dibujo'
export { BANDAS, OFF, PESTANAS_FX, RANGO, disenar, idBanda, leerParamsEq, magnitudDb, resolverWidget, respuestaDb, widgetEq, type BandaEq, type ParamsEq, type Rol } from './fxrack'
export { EditorCyber, type FaseCambio, type OpcionesEditor, type RectCss } from './editor'
