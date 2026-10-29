import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCanvasView } from '../components/piano-roll-canvas-notes'

test('el canvas del piano roll cubre la ventana visible y nunca la rejilla entera', () => {
  const total = 60_000 // 1250 compases a 48 px/beat: antes un canvas de 60000 px (> límite de Chromium)
  for (const scrollLeft of [0, 100, 5_000, 31_337, 59_000]) {
    const { x0, w } = computeCanvasView(scrollLeft, 1400, total)
    assert.ok(w <= 1400 + 4 * 256, `w=${w}`)
    assert.ok(x0 <= scrollLeft)
    assert.ok(x0 + w >= Math.min(total, scrollLeft + 1400), `cubre el borde derecho en ${scrollLeft}`)
    assert.ok(x0 + w <= total)
  }
})

test('el origen se cuantiza: el scroll de pocos px no cambia la vista (sin repintar)', () => {
  const a = computeCanvasView(3_000, 1400, 60_000)
  const b = computeCanvasView(3_040, 1400, 60_000)
  assert.deepEqual(a, b)
})
