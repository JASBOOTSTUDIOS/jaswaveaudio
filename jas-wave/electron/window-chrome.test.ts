import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALTO_BARRA_TITULO,
  asegurarBarraVisible,
  conectarEstadoVentana,
  corregirParaBarraVisible,
  medidasQueCaben,
  normalizarOverlay,
  opcionesVentanaSinMarco,
  type Rect,
  type VentanaMarco,
} from './window-chrome'
import { ALTO_BARRA_TITULO as ALTO_UI, ANCHO_CONTROLES_PROPIOS } from '../src/lib/window-chrome'
import { ANCHO_BOTONES_VENTANA } from './window-chrome'

test('Windows/Linux: sin marco pero con los tres botones nativos (overlay) del alto de la barra de la UI', () => {
  for (const p of ['win32', 'linux'] as const) {
    const o = opcionesVentanaSinMarco(p)
    assert.equal(o.titleBarStyle, 'hidden')
    assert.ok(o.titleBarOverlay, `overlay en ${p}`)
    assert.equal(o.titleBarOverlay!.height, ALTO_BARRA_TITULO)
    assert.match(o.titleBarOverlay!.color, /^#[0-9a-f]{6}$/i)
  }
  // macOS conserva los semáforos nativos
  assert.deepEqual(opcionesVentanaSinMarco('darwin'), { titleBarStyle: 'hidden' })
  // main y renderer comparten medidas
  assert.equal(ALTO_BARRA_TITULO, ALTO_UI)
  assert.equal(ANCHO_BOTONES_VENTANA, ANCHO_CONTROLES_PROPIOS)
})

test('normalizarOverlay solo acepta colores hex y acota el alto', () => {
  assert.deepEqual(normalizarOverlay({ color: '#05060F', symbolColor: '#ffffff' }), { color: '#05060F', symbolColor: '#ffffff' })
  assert.deepEqual(normalizarOverlay({ color: 'red', height: 500 }), { height: 64 })
  assert.equal(normalizarOverlay({ color: 'url(javascript:1)' }), null)
  assert.equal(normalizarOverlay(null), null)
  assert.equal(normalizarOverlay('x'), null)
})

test('medidasQueCaben: en 1366×768 al 150 % la ventana y sus mínimos caben en el área de trabajo', () => {
  const area: Rect = { x: 0, y: 0, width: 911, height: 486 }
  const m = medidasQueCaben(area, { width: 1400, height: 900, minWidth: 1000, minHeight: 600 })
  assert.deepEqual(m, { x: 0, y: 0, width: 911, height: 486, minWidth: 911, minHeight: 486 })
  // Pantalla grande: tamaño pedido, centrado
  const g = medidasQueCaben({ x: 0, y: 0, width: 2560, height: 1400 }, { width: 1400, height: 900, minWidth: 1000, minHeight: 600 })
  assert.deepEqual(g, { x: 580, y: 250, width: 1400, height: 900, minWidth: 1000, minHeight: 600 })
})

test('corregirParaBarraVisible: barra por encima de la pantalla o en un monitor desconectado vuelve a verse', () => {
  const principal: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
  // Visible: nada que hacer
  assert.equal(corregirParaBarraVisible({ x: 100, y: 100, width: 1400, height: 900 }, [principal]), null)
  // Título por encima del borde superior (antes: ventana de 900 px centrada en un área de 672)
  assert.deepEqual(corregirParaBarraVisible({ x: 100, y: -114, width: 1400, height: 900 }, [principal]), {
    x: 100,
    y: 0,
    width: 1400,
    height: 900,
  })
  // Botones fuera por la derecha (ventana más ancha que la pantalla)
  assert.deepEqual(corregirParaBarraVisible({ x: 0, y: 0, width: 1000, height: 500 }, [{ x: 0, y: 0, width: 911, height: 486 }]), {
    x: 0,
    y: 0,
    width: 911,
    height: 486,
  })
  // Monitor secundario desconectado: vuelve al principal
  const r = corregirParaBarraVisible({ x: 2500, y: 200, width: 900, height: 600 }, [principal])!
  assert.ok(r.x + r.width <= 1920 && r.y >= 0)
  // Repartida entre dos monitores con los botones a la vista: se respeta
  const dos = [principal, { x: 1920, y: 0, width: 1920, height: 1040 }]
  assert.equal(corregirParaBarraVisible({ x: 1500, y: 50, width: 1000, height: 700 }, dos), null)
})

function ventanaFalsa(bounds: Rect, estado: Partial<{ max: boolean; min: boolean; full: boolean }> = {}) {
  const enviados: unknown[][] = []
  const oyentes = new Map<string, Array<() => void>>()
  const w: VentanaMarco & { bounds: Rect; enviados: unknown[][]; emit(ev: string): void; max: boolean } = {
    bounds,
    enviados,
    max: Boolean(estado.max),
    isDestroyed: () => false,
    isMaximized() {
      return this.max
    },
    isMinimized: () => Boolean(estado.min),
    isFullScreen: () => Boolean(estado.full),
    getBounds() {
      return this.bounds
    },
    setBounds(r: Rect) {
      this.bounds = r
    },
    on(ev: string, fn: () => void) {
      oyentes.set(ev, [...(oyentes.get(ev) ?? []), fn])
    },
    webContents: { send: (...a: unknown[]) => void enviados.push(a), isDestroyed: () => false },
    emit(ev: string) {
      for (const f of oyentes.get(ev) ?? []) f()
    },
  }
  return w
}

test('conectarEstadoVentana avisa al renderer de maximizar/restaurar (incluido Win+flechas)', () => {
  const w = ventanaFalsa({ x: 0, y: 0, width: 800, height: 600 })
  conectarEstadoVentana(w)
  w.max = true
  w.emit('maximize')
  w.max = false
  w.emit('unmaximize')
  w.emit('restore')
  assert.deepEqual(w.enviados, [
    ['window-maximized-changed', true],
    ['window-maximized-changed', false],
    ['window-maximized-changed', false],
  ])
})

test('asegurarBarraVisible no toca ventanas maximizadas ni minimizadas y recoloca las perdidas', () => {
  const pantalla = {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1280, height: 672 } }],
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1280, height: 672 } }),
    on: () => undefined,
    removeListener: () => undefined,
  }
  const max = ventanaFalsa({ x: -8, y: -8, width: 1296, height: 688 }, { max: true })
  assert.equal(asegurarBarraVisible(max, pantalla), false)
  const perdida = ventanaFalsa({ x: 40, y: -114, width: 1400, height: 900 })
  assert.equal(asegurarBarraVisible(perdida, pantalla), true)
  assert.deepEqual(perdida.bounds, { x: 0, y: 0, width: 1280, height: 672 })
})
