/**
 * npx tsx --test electron/plugins/editor-embebido.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EditoresEmbebidos, panelDesdeComando, rectPantallaDip, type VentanaEditor } from './editor-embebido'

function ventana(id: number, estado: { x?: number; minimizada?: boolean; escala?: number } = {}): VentanaEditor {
  const escala = estado.escala ?? 1.5
  return {
    id,
    isDestroyed: () => false,
    isMinimized: () => !!estado.minimizada,
    isVisible: () => true,
    getContentBounds: () => ({ x: estado.x ?? 100, y: 50, width: 1600, height: 900 }),
    zoom: () => 1,
    aPantalla: (r) => ({ x: Math.round(r.x * escala), y: Math.round(r.y * escala), width: Math.round(r.width * escala), height: Math.round(r.height * escala) }),
  }
}

describe('editor nativo embebido en el panel (V4)', () => {
  it('valida el rectángulo del panel que manda el renderer', () => {
    assert.equal(panelDesdeComando({}), null)
    assert.equal(panelDesdeComando({ embed: { x: 1, y: 2, w: 'a', h: 4 } }), null)
    assert.deepEqual(panelDesdeComando({ embed: { x: 10, y: 20, w: 300, h: 200 } }), { x: 10, y: 20, w: 300, h: 200, visible: true })
    assert.equal(panelDesdeComando({ embed: { x: 10, y: 20, w: 0, h: 200 } })!.visible, false)
    assert.equal(panelDesdeComando({ embed: { x: 10, y: 20, w: 300, h: 200, visible: false } })!.visible, false)
  })

  it('convierte px CSS (con zoom) a DIP de pantalla redondeando hacia fuera', () => {
    assert.deepEqual(rectPantallaDip({ x: 100, y: 50, width: 0, height: 0 }, { x: 10.4, y: 20.6, w: 300.2, h: 200, visible: true }, 1), {
      x: 110,
      y: 70,
      width: 301,
      height: 201,
    })
    assert.deepEqual(rectPantallaDip({ x: 0, y: 0, width: 0, height: 0 }, { x: 10, y: 10, w: 100, h: 50, visible: true }, 1.25), {
      x: 12,
      y: 12,
      width: 126,
      height: 63,
    })
  })

  it('abre en píxeles físicos y sin parentHwnd (nunca hijo de Electron)', () => {
    const enviados: Record<string, unknown>[] = []
    const ed = new EditoresEmbebidos((c) => enviados.push(c))
    const cmd = ed.abrir('s1', ventana(1), { x: 0, y: 0, w: 400, h: 300, visible: true }, { type: 'openEditor', slotId: 's1', path: 'x.vst3', parentHwnd: '123', embed: {} })
    assert.equal(cmd.embedded, true)
    assert.equal(cmd.parentHwnd, undefined)
    assert.equal(cmd.embed, undefined)
    assert.deepEqual([cmd.x, cmd.y, cmd.w, cmd.h], [150, 75, 600, 450])
    assert.equal(enviados.length, 0)
  })

  it('sigue a la ventana: mover, minimizar y volver al frente', () => {
    const enviados: Record<string, unknown>[] = []
    const ed = new EditoresEmbebidos((c) => enviados.push(c))
    const estado = { x: 100, minimizada: false }
    const v = ventana(7, estado)
    ed.abrir('s1', v, { x: 0, y: 0, w: 400, h: 300, visible: true }, { type: 'openEditor', slotId: 's1' })
    ed.abrir('otro', ventana(8), { x: 0, y: 0, w: 10, h: 10, visible: true }, { type: 'openEditor', slotId: 'otro' })
    estado.x = 200
    ed.ventanaCambio(7)
    assert.equal(enviados.length, 1)
    assert.deepEqual(enviados[0], { type: 'setEditorBounds', slotId: 's1', embedded: true, visible: true, raise: false, x: 300, y: 75, w: 600, h: 450 })
    estado.minimizada = true
    ed.ventanaCambio(7)
    assert.equal(enviados[1]!.visible, false)
    estado.minimizada = false
    ed.ventanaCambio(7, true)
    assert.equal(enviados[2]!.raise, true)
    ed.actualizar('s1', { x: 0, y: 0, w: 0, h: 0, visible: false })
    assert.equal(enviados[3]!.visible, false)
    ed.cerrar('s1')
    ed.ventanaCambio(7)
    assert.equal(enviados.length, 4)
    ed.ventanaCerrada(8)
    assert.deepEqual(ed.abiertos(), [])
  })
})
