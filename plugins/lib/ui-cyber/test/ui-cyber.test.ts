import { describe, expect, it } from 'vitest'
import eq from '../../../com.jaswave.plugin.param-eq/ui-layout.json'
import comp from '../../../com.jaswave.plugin.bus-compressor/ui-layout.json'
import lim from '../../../com.jaswave.plugin.truepeak-limiter/ui-layout.json'
import de from '../../../com.jaswave.plugin.smart-deesser/ui-layout.json'
import util from '../../../com.jaswave.plugin.utility-tool/ui-layout.json'
import piano from '../../../com.jaswave.plugin.piano-synth/ui-layout.json'
import roles from '../../../com.jaswave.plugin.roles-vst/ui-layout.json'
import vocalTune from '../../../com.jaswave.plugin.vocal-tune/ui-layout.json'
import bajo from '../../../com.jaswave.plugin.electric-bass/ui-layout.json'
import {
  layoutParaVista,
  modoEnSelector,
  modoInicial,
  visibleEnPagina,
  Balistica,
  aNormalizado,
  aPlano,
  columnasDesdeBins,
  defDe,
  dibujarEditor,
  formatear,
  interpretar,
  modoPorAncho,
  normalizadoPorDefecto,
  pasoRueda,
  tamanoDe,
  vistaDe,
  widgetEn,
  xDeFrecuencia,
  yDeDbfs,
  type DefParametro,
  type UiLayout,
} from '../src'

const LAYOUTS = [eq, comp, lim, de, util, piano, roles] as unknown as UiLayout[]

describe('valores: mismo mapeo y texto que jw_params.h', () => {
  it('ida y vuelta normalizado ↔ plano y valor por defecto en los 7 plugins', () => {
    let n = 0
    for (const L of LAYOUTS)
      for (const w of L.widgets) {
        const d = defDe(w)
        if (!d) continue
        n++
        expect(aPlano(d, normalizadoPorDefecto(d)), `${L.productId} ${w.etiqueta}`).toBeCloseTo(d.defecto, 6)
        for (const x of [0, 0.25, 0.5, 1]) expect(aNormalizado(d, aPlano(d, x)), `${L.productId} ${w.etiqueta}`).toBeCloseTo(d.escala === 'stepped' ? Math.round(x * (d.pasos ?? 1)) / (d.pasos ?? 1) : x, 6)
      }
    expect(n).toBeGreaterThan(40)
  })

  it('formatea Hz, ms, bipolares y escalonados como el VST', () => {
    const hz: DefParametro = { min: 20, max: 20000, defecto: 1000, escala: 'log', unidad: 'Hz', decimales: 0 }
    expect(formatear(hz, 1234)).toBe('1.23 kHz')
    expect(formatear(hz, 440)).toBe('440 Hz')
    expect(formatear(hz, 55.55)).toBe('55.5 Hz')
    const ms: DefParametro = { min: 1, max: 2000, defecto: 100, escala: 'log', unidad: 'ms', decimales: 1 }
    expect(formatear(ms, 1500)).toBe('1.50 s')
    expect(formatear(ms, 12.34)).toBe('12.3 ms')
    const db: DefParametro = { min: -24, max: 24, defecto: 0, escala: 'linear', unidad: 'dB', decimales: 1, bipolar: true }
    expect(formatear(db, 3)).toBe('+3.0 dB')
    expect(formatear(db, -3)).toBe('-3.0 dB')
    expect(formatear(db, 0)).toBe('0.0 dB')
    const sel: DefParametro = { min: 0, max: 2, defecto: 0, escala: 'stepped', pasos: 2, opciones: ['Off', '16 bit', '24 bit'] }
    expect(formatear(sel, 1)).toBe('16 bit')
  })

  it('interpreta lo que escribe el usuario (unidades, coma decimal, opciones) y limita al rango', () => {
    const hz: DefParametro = { min: 20, max: 20000, defecto: 1000, escala: 'log', unidad: 'Hz' }
    expect(aPlano(hz, interpretar(hz, '2,5 kHz')!)).toBeCloseTo(2500, 6)
    expect(aPlano(hz, interpretar(hz, '99999')!)).toBeCloseTo(20000, 6)
    expect(interpretar(hz, 'hola')).toBeNull()
    const sel: DefParametro = { min: 0, max: 1, defecto: 0, escala: 'stepped', pasos: 1, opciones: ['Off', 'On'] }
    expect(interpretar(sel, 'on')).toBe(1)
    expect(pasoRueda(sel, 0, 1)).toBe(1)
    expect(pasoRueda(hz, 0.5, -1)).toBeCloseTo(0.49, 9)
    expect(pasoRueda(hz, 0.5, 1, true)).toBeCloseTo(0.501, 9)
  })
})

describe('texto', () => {
  it('lee el tamaño de las fuentes con peso (el espaciado de +12 % se calcula sobre él)', () => {
    expect(tamanoDe('400 11px Bahnschrift, sans-serif')).toBe(11)
    expect(tamanoDe('11.5px Consolas')).toBe(11.5)
    expect(tamanoDe('300 22px X')).toBe(22)
  })
})

describe('espectro: escalas y balística de V3', () => {
  it('ejes 20 Hz–20 kHz log y −120..0 dBFS', () => {
    expect(xDeFrecuencia(0, 1000, 20)).toBeCloseTo(0)
    expect(xDeFrecuencia(0, 1000, 20000)).toBeCloseTo(1000)
    expect(xDeFrecuencia(0, 1000, 632.456)).toBeCloseTo(500, 1)
    expect(yDeDbfs(0, 120, 0)).toBe(0)
    expect(yDeDbfs(0, 120, -120)).toBe(120)
    expect(yDeDbfs(0, 120, 10)).toBe(0)
  })

  it('columnas log-frecuencia desde los bins de una FFT con inclinación de 3 dB/oct', () => {
    const bins = new Float32Array(4097).fill(-60)
    const cols = columnasDesdeBins(bins, 48000, 8192, 64)
    // a 1 kHz la inclinación es 0; una octava arriba, +3 dB
    const c1k = Math.round((Math.log(1000 / 20) / Math.log(1000)) * 64)
    expect(cols[c1k]).toBeGreaterThan(-61)
    expect(cols[c1k]).toBeLessThan(-59)
    expect(cols[63]! - cols[c1k]!).toBeGreaterThan(9)
  })

  it('ataque instantáneo y caída de 14 dB/s, independiente de los fps', () => {
    const b = new Balistica(2)
    expect(b.actualizar([-10, -20], 1 / 60)[0]).toBe(-10)
    expect(b.actualizar(null, 0.25)[0]).toBeCloseTo(-13.5, 6)
    expect(b.actualizar(null, 5)[0]).toBeCloseTo(-17, 6) // dt limitado a 0.25 s
    const a30 = new Balistica(1), a15 = new Balistica(1)
    a30.actualizar([-6], 0)
    a15.actualizar([-6], 0)
    a30.actualizar(null, 1 / 30)
    a30.actualizar(null, 1 / 30)
    a15.actualizar(null, 1 / 15)
    expect(a30.valores[0]).toBeCloseTo(a15.valores[0]!, 6)
    expect(b.actualizar([0, 0], 0.1)[0]).toBe(0)
  })
})

describe('disposición responsiva y controles', () => {
  it('breakpoints de V3 §4.5 y vistas de las pestañas', () => {
    expect(modoPorAncho(1280)).toBe('completo')
    expect(modoPorAncho(800)).toBe('compacto')
    expect(modoPorAncho(390)).toBe('pestanas')
    expect(vistaDe(eq as unknown as UiLayout, 'completo')).toEqual([0, 0, 1100, 620])
    const z = (eq as unknown as UiLayout).zonas
    expect(vistaDe(eq as unknown as UiLayout, 'pestanas', 'controles')).toEqual([z.controles[0] - 8, z.controles[1] - 8, z.salida[2] + 8, z.salida[3] + 8])
  })

  it('encuentra perillas, la píldora de bypass y, en táctil, controles pequeños cercanos', () => {
    const L = comp as unknown as UiLayout
    const umbral = L.widgets.find((w) => w.etiqueta === 'UMBRAL')!
    const cx = (umbral.rect[0] + umbral.rect[2]) / 2
    expect(widgetEn(L, cx, umbral.rect[1] + 30)).toBe(umbral)
    const salida = L.widgets.find((w) => w.tipo === 'section' && w.bypass)!
    expect(widgetEn(L, salida.rect[2] - 24, salida.rect[1] + 13)).toBe(salida)
    // fuera del rectángulo de la perilla RATIO pero a menos de 22 px de su centro horizontal
    const ratio = L.widgets.find((w) => w.etiqueta === 'RATIO')!
    expect(widgetEn(L, ratio.rect[2] + 4, (ratio.rect[1] + ratio.rect[3]) / 2)).not.toBe(ratio)
    expect(widgetEn(L, ratio.rect[2] + 4, (ratio.rect[1] + ratio.rect[3]) / 2, 120)).toBe(ratio)
  })

  it('dibuja los 7 editores sin errores (contexto Canvas simulado)', () => {
    const llamadas: string[] = []
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === 'measureText') return (s: string) => ({ width: s.length * 6 })
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => undefined })
          return (...args: unknown[]) => {
            llamadas.push(String(k))
            return args.length ? undefined : undefined
          }
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D
    for (const L of LAYOUTS) {
      const cols = new Float32Array(192).fill(-50)
      dibujarEditor(ctx, { layout: L, valor: () => 0.5, espectro: { in: cols, out: cols }, mostrarValores: true, avisoMedicion: 'La medición en vivo la calcula el VST en escritorio.' })
    }
    expect(llamadas.filter((c) => c === 'fillText').length).toBeGreaterThan(200)
  })
})

describe('botón RESET', () => {
  const layoutConReset: UiLayout = {
    ...(piano as unknown as UiLayout),
    widgets: [
      ...(piano as unknown as UiLayout).widgets,
      { tipo: 'reset', rect: [624, 48, 684, 68], etiqueta: 'RESET' },
    ],
  }

  it('es un widget sensible aunque no tenga parámetro asociado', () => {
    const w = widgetEn(layoutConReset, 650, 58)
    expect(w?.tipo).toBe('reset')
    expect(w?.param).toBeUndefined()
  })

  it('no captura clics fuera de su rectángulo', () => {
    expect(widgetEn(layoutConReset, 600, 58)?.tipo).not.toBe('reset')
    expect(widgetEn(layoutConReset, 650, 80)?.tipo).not.toBe('reset')
  })
})

describe('modo Básico / Avanzado', () => {
  const VT = vocalTune as unknown as UiLayout
  const TODOS = [...LAYOUTS, VT, bajo as unknown as UiLayout]

  it('cada editor tiene un selector BÁSICO | AVANZADO y abre en Avanzado', () => {
    for (const L of TODOS) {
      expect(L.widgets.filter((w) => w.tipo === 'modo'), L.productId).toHaveLength(1)
      expect(modoInicial(L)).toBe('avanzado')
    }
  })

  it('Avanzado muestra todo; Básico solo los esenciales, recolocados y sin páginas extra', () => {
    for (const L of TODOS) {
      expect(layoutParaVista(L, 'avanzado').widgets).toEqual(L.widgets)
      const b = layoutParaVista(L, 'basico')
      expect(b.widgets.length, L.productId).toBeLessThan(L.widgets.length)
      expect(b.widgets.some((w) => w.basico === false || (w.pagina ?? 0) > 0 || w.tipo === 'pagina')).toBe(false)
      for (const w of b.widgets) if (w.rectBasico) expect(w.rect).toEqual(w.rectBasico)
      // el resultado se cachea: mismos objetos en cada fotograma (el widget activo se compara por identidad)
      expect(layoutParaVista(L, 'basico')).toBe(b)
    }
    const nombres = layoutParaVista(VT, 'basico').widgets.filter((w) => w.param !== undefined).map((w) => w.nombre)
    expect(nombres).toEqual(expect.arrayContaining(['Retune Speed', 'Humanize', 'Scale', 'Root', 'Mix', 'Bypass']))
    expect(nombres).not.toContain('Formant Shift')
  })

  it('el selector cambia de modo según la mitad pulsada', () => {
    const sel = VT.widgets.find((w) => w.tipo === 'modo')!
    expect(widgetEn(VT, (sel.rect[0] + sel.rect[2]) / 2, (sel.rect[1] + sel.rect[3]) / 2)).toBe(sel)
    expect(modoEnSelector(sel, sel.rect[0] + 4)).toBe('basico')
    expect(modoEnSelector(sel, sel.rect[2] - 4)).toBe('avanzado')
  })

  it('página PARÁMETROS: su botón se ve en el editor y en su página (en la cabecera), no en MIX / FX', () => {
    const L = bajo as unknown as UiLayout
    const boton = L.widgets.find((w) => w.tipo === 'pagina' && w.paginaDestino === 2)!
    expect(visibleEnPagina(boton, 0)).toBe(true)
    expect(visibleEnPagina(boton, 1)).toBe(false)
    const abierta = layoutParaVista(L, 'avanzado', 2)
    const movido = abierta.widgets.find((w) => w.tipo === 'pagina' && w.paginaDestino === 2)!
    expect(movido.rect[0]).toBe(484)
    expect(movido.rect[1]).toBe(51)
    const rejilla = L.widgets.filter((w) => w.pagina === 2 && w.param !== undefined)
    expect(rejilla.length).toBeGreaterThan(0)
    for (const w of rejilla) expect(widgetEn(abierta, (w.rect[0] + w.rect[2]) / 2, (w.rect[1] + w.rect[3]) / 2, 0, 2)).toBe(w)
  })

  it('dibuja ambos modos y la página PARÁMETROS sin errores', () => {
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) => {
          if (k === 'measureText') return (s: string) => ({ width: s.length * 6 })
          if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => undefined })
          return () => undefined
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D
    for (const L of TODOS)
      for (const modo of ['basico', 'avanzado'] as const)
        for (const pagina of [0, 2]) dibujarEditor(ctx, { layout: L, valor: () => 0.5, modo, pagina })
  })
})
