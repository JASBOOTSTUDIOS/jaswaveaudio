import { describe, expect, it } from 'vitest'
import shimmer from '../../../com.jaswave.plugin.shimmer-pad/ui-layout.json'
import {
  BANDAS,
  OFF,
  RANGO,
  aNormalizado,
  defDe,
  disenar,
  dibujarEditor,
  idBanda,
  leerParamsEq,
  magnitudDb,
  normalizadoPorDefecto,
  resolverWidget,
  respuestaDb,
  vistaDe,
  widgetEn,
  widgetEq,
  type ParamsEq,
  type UiLayout,
} from '../src'

const L = shimmer as unknown as UiLayout
const SR = 48000

const neutro = (): ParamsEq => ({
  hpfOn: false, hpfHz: 80, hpfSlope: 0, lpfOn: false, lpfHz: 16000, lpfSlope: 0, eqOn: true,
  bandas: [
    { hz: 80, gainDb: 0, q: 0.71 }, { hz: 200, gainDb: 0, q: 1 }, { hz: 800, gainDb: 0, q: 1 },
    { hz: 2500, gainDb: 0, q: 1 }, { hz: 6000, gainDb: 0, q: 1 }, { hz: 10000, gainDb: 0, q: 0.71 },
  ],
})

describe('FX Rack web: respuesta del ecualizador (mismas ecuaciones que jw_fxrack.h)', () => {
  it('EQ plano = 0 dB; una campana a su frecuencia da exactamente su ganancia', () => {
    const p = neutro()
    expect(respuestaDb(p, SR, 1000)).toBeCloseTo(0, 9)
    p.bandas[2] = { hz: 1000, gainDb: 9, q: 2 }
    expect(respuestaDb(p, SR, 1000)).toBeCloseTo(9, 6)
    expect(respuestaDb(p, SR, 100)).toBeLessThan(0.5)
    // Q coherente: puntos de media ganancia (+4.5 dB) separados ~ f0 / Q
    let lo = 500, hi = 1000
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (respuestaDb(p, SR, m) > 4.5) hi = m; else lo = m }
    const fd = lo
    lo = 1000; hi = 2000
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (respuestaDb(p, SR, m) > 4.5) lo = m; else hi = m }
    expect(1000 / (lo - fd)).toBeCloseTo(2, 0)
  })

  it('shelves, paso-altos y paso-bajos', () => {
    const p = neutro()
    p.bandas[0] = { hz: 100, gainDb: 6, q: 0.71 }
    p.bandas[5] = { hz: 8000, gainDb: -6, q: 0.71 }
    expect(respuestaDb(p, SR, 20)).toBeCloseTo(6, 0)
    expect(respuestaDb(p, SR, 20000)).toBeCloseTo(-6, 0)
    const q = neutro()
    q.hpfOn = true; q.hpfHz = 1000
    expect(respuestaDb(q, SR, 1000)).toBeCloseTo(-3.01, 1)
    expect(respuestaDb(q, SR, 500)).toBeCloseTo(-12.3, 0)
    q.hpfSlope = 1
    expect(respuestaDb(q, SR, 1000)).toBeCloseTo(-3.01, 1)
    expect(respuestaDb(q, SR, 500)).toBeCloseTo(-24.1, 0)
    q.hpfOn = false; q.lpfOn = true; q.lpfHz = 4000; q.lpfSlope = 0
    expect(respuestaDb(q, SR, 4000)).toBeCloseTo(-3.01, 1)
    // la respuesta analitica coincide con la del coeficiente directo
    const c = disenar('bell', SR, 1234, 7, 1.7)
    expect(magnitudDb(c, 1234, SR)).toBeCloseTo(7, 6)
  })
})

describe('FX Rack web: página MIX / FX del layout de Shimmer Pad', () => {
  const eq = widgetEq(L.widgets)!
  const pag = L.widgets.filter((w) => w.pagina === 1)

  it('declara la gráfica con 6 bandas, el medidor de reducción, RESET FX y el botón de cabecera', () => {
    expect(eq.tipo).toBe('mixfx-eq')
    expect(eq.base).toBe(100)
    expect(eq.bandas).toHaveLength(BANDAS)
    expect(pag.filter((w) => w.tipo === 'mixfx-gr')).toHaveLength(1)
    expect(pag.filter((w) => w.tipo === 'reset-fx')).toHaveLength(1)
    // (el otro botón de página, «+N PARÁM.», abre la página PARÁMETROS: paginaDestino 2)
    const boton = L.widgets.filter((w) => w.tipo === 'pagina' && w.paginaDestino !== 2)
    expect(boton).toHaveLength(1)
    expect(boton[0]!.paginaDestino).toBe(1)
    expect(boton[0]!.pagina ?? 0).toBe(0)
  })

  it('expone los 58 parámetros estándar con ids base + offset dentro del rango del rack', () => {
    const ids = new Set<number>()
    for (const w of pag) if (w.param !== undefined) ids.add(w.param)
    for (const b of eq.bandas!) for (const d of [b.freq, b.gain, b.q]) ids.add(d.param)
    expect(ids.size).toBe(58)
    for (const id of ids) { expect(id).toBeGreaterThanOrEqual(100); expect(id).toBeLessThan(100 + RANGO) }
    for (let b = 0; b < BANDAS; b++) {
      expect(eq.bandas![b]!.gain.param).toBe(idBanda(100, b, 'gain'))
      expect(eq.bandas![b]!.gain.nombre).toBe(`FX · EQ Band ${b + 1} Gain`)
    }
    expect(ids.has(100 + OFF.OutGain)).toBe(true)
  })

  it('las perillas FREQ / GAIN / Q siguen a la banda seleccionada con los rangos de esa banda', () => {
    const gain = pag.find((w) => w.bandaRol === 'gain')!
    const r4 = resolverWidget(L.widgets, gain, 4)
    expect(r4.param).toBe(idBanda(100, 4, 'gain'))
    expect(r4.nombre).toBe('FX · EQ Band 5 Gain')
    const freq = pag.find((w) => w.bandaRol === 'freq')!
    expect(resolverWidget(L.widgets, freq, 0).max).toBe(1000) // low shelf: 20..1000 Hz
    expect(resolverWidget(L.widgets, freq, 5).min).toBe(1000) // high shelf: 1k..20k Hz
    const d = defDe(resolverWidget(L.widgets, freq, 3))!
    expect(aNormalizado(d, d.defecto)).toBeCloseTo(normalizadoPorDefecto(d), 9)
  })

  it('leerParamsEq con los valores por defecto da un EQ apagado y plano', () => {
    const defs = new Map<number, number>()
    for (const w of pag) { const d = defDe(w); if (d && w.param !== undefined) defs.set(w.param, normalizadoPorDefecto(d)) }
    for (const b of eq.bandas!) for (const x of [b.freq, b.gain, b.q]) defs.set(x.param, aNormalizado({ ...x }, x.defecto))
    const p = leerParamsEq(L.widgets, (id) => defs.get(id) ?? 0)!
    expect(p.eqOn).toBe(false)
    expect(p.hpfOn).toBe(false)
    expect(p.bandas.map((b) => b.hz)).toEqual([80, 200, 800, 2500, 6000, 10000].map((f) => expect.closeTo(f, 3)))
    expect(respuestaDb(p, SR, 1000)).toBeCloseTo(0, 9)
  })

  it('el editor base no ve los widgets de la página y la página no ve los del plugin', () => {
    const g = eq.rect
    const cx = (g[0] + g[2]) / 2, cy = (g[1] + g[3]) / 2
    expect(widgetEn(L, cx, cy, 0, 1)?.tipo).toBe('mixfx-eq')
    expect(widgetEn(L, cx, cy, 0, 0)?.tipo).not.toBe('mixfx-eq')
    const resetFx = pag.find((w) => w.tipo === 'reset-fx')!
    expect(widgetEn(L, (resetFx.rect[0] + resetFx.rect[2]) / 2, (resetFx.rect[1] + resetFx.rect[3]) / 2, 0, 1)?.tipo).toBe('reset-fx')
    expect(widgetEn(L, (resetFx.rect[0] + resetFx.rect[2]) / 2, (resetFx.rect[1] + resetFx.rect[3]) / 2, 0, 0)?.tipo).not.toBe('reset-fx')
    const boton = L.widgets.find((w) => w.tipo === 'pagina')!
    for (const pg of [0, 1]) expect(widgetEn(L, (boton.rect[0] + boton.rect[2]) / 2, (boton.rect[1] + boton.rect[3]) / 2, 0, pg)?.tipo).toBe('pagina')
  })

  it('vistas móviles de la página: EQ, DINÁMICA y EFECTOS', () => {
    expect(vistaDe(L, 'pestanas', 'espectro', 1)).toEqual([44, 84, 660, 412])
    expect(vistaDe(L, 'pestanas', 'controles', 1)).toEqual([658, 84, 1056, 412])
    expect(vistaDe(L, 'pestanas', 'medicion', 1)).toEqual([44, 410, 1056, 564])
    expect(vistaDe(L, 'completo', 'medicion', 1)).toEqual([0, 0, 1100, 620])
  })

  it('dibuja la página MIX / FX (con y sin EQ activo) sin errores y con los textos de las perillas', () => {
    const textos: string[] = []
    const ctx = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'measureText') return (s: string) => ({ width: s.length * 6 })
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => undefined })
        if (k === 'fillText') return (s: string) => { textos.push(s) }
        return () => undefined
      },
      set: () => true,
    }) as unknown as CanvasRenderingContext2D
    for (const encendido of [0, 1]) {
      textos.length = 0
      const cols = new Float32Array(192).fill(-60)
      dibujarEditor(ctx, {
        layout: L,
        valor: (id) => (id === 100 + OFF.EqOn ? encendido : id === eq.bandas![2]!.gain.param ? 0.8 : 0.5),
        pagina: 1, bandaSel: 2, espectro: { out: cols }, grDb: null,
      })
      expect(textos.some((t) => t.startsWith('BANDA 3'))).toBe(true)
      for (const t of ['COMPRESOR', 'SATURACIÓN', 'CHORUS', 'DELAY', 'REVERB', 'RESET FX', 'EDITOR', 'THRESH', 'FEEDBACK']) expect(textos, t).toContain(t)
      expect(textos).not.toContain('CUTOFF') // los controles del plugin no se dibujan en la página
    }
    textos.length = 0
    dibujarEditor(ctx, { layout: L, valor: () => 0.5, pagina: 0 })
    expect(textos).toContain('CUTOFF')
    expect(textos).toContain('MIX / FX')
    expect(textos).not.toContain('COMPRESOR')
  })
})
