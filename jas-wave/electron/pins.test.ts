import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GestorPins, type VentanaPin } from './pins'

function ventanaFalsa(registro: string[], nombre: string): VentanaPin & { visible: boolean } {
  return {
    visible: true,
    isDestroyed: () => false,
    setAlwaysOnTop: (f, n, r) => registro.push(`${nombre}:top=${f}${n ? `:${n}:${r}` : ''}`),
    moveTop: () => registro.push(`${nombre}:moveTop`),
    hide() { this.visible = false; registro.push(`${nombre}:hide`) },
    showInactive() { this.visible = true; registro.push(`${nombre}:show`) },
    isVisible() { return this.visible },
    on: () => undefined,
  }
}

function montar(inicial: string | null = null) {
  const registro: string[] = []
  const host: Array<Record<string, unknown>> = []
  const ventanas = new Map<string, ReturnType<typeof ventanaFalsa>>()
  let archivo = inicial
  const difusiones: number[] = []
  const g = new GestorPins({
    leerArchivo: () => archivo,
    escribirArchivo: (c) => { archivo = c },
    enviarHost: (c) => host.push(c),
    ventanaPanel: (id) => ventanas.get(id) ?? null,
    difundir: (e) => difusiones.push(e.lista.length),
  })
  return { g, registro, host, ventanas, leerArchivo: () => archivo, difusiones }
}

test('alternar ancla al final y reaplica del índice más alto al 0 intercalando editores y paneles', () => {
  const t = montar()
  t.ventanas.set('mixer', ventanaFalsa(t.registro, 'mixer'))
  t.g.alternar('editor', 'trk1:eq', 'EQ')
  t.g.alternar('panel', 'mixer', 'Mezclador')
  t.g.alternar('editor', 'trk2:synth', 'Synth')
  t.host.length = 0
  t.registro.length = 0
  t.g.reaplicar()
  // orden de aplicación: synth (idx 2), mixer (idx 1), eq (idx 0)
  assert.deepEqual(t.host.map((c) => `${c.slotId}:${c.index}:${c.raise}`), ['trk2:synth:2:true', 'trk1:eq:0:true'])
  assert.deepEqual(t.registro, ['mixer:top=true:floating:1', 'mixer:moveTop'])
})

test('desanclar envía pinned:false al host y quita always-on-top al panel', () => {
  const t = montar()
  t.ventanas.set('mixer', ventanaFalsa(t.registro, 'mixer'))
  t.g.alternar('editor', 'a')
  t.g.alternar('panel', 'mixer')
  t.host.length = 0
  t.registro.length = 0
  t.g.alternar('editor', 'a')
  t.g.alternar('panel', 'mixer')
  assert.ok(t.host.some((c) => c.slotId === 'a' && c.pinned === false))
  assert.ok(t.registro.includes('mixer:top=false'))
  assert.equal(t.g.estado().lista.length, 0)
})

test('mover cambia el índice enviado al host', () => {
  const t = montar()
  t.g.alternar('editor', 'a')
  t.g.alternar('editor', 'b')
  t.host.length = 0
  t.g.mover('editor:b', -1)
  assert.deepEqual(t.g.estado().lista.map((p) => p.id), ['b', 'a'])
  const b = t.host.filter((c) => c.slotId === 'b').pop()!
  assert.equal(b.index, 0)
})

test('persiste por proyecto y restaura al cambiar de proyecto y al reiniciar', () => {
  const t = montar()
  t.g.establecerProyecto('p1')
  t.g.alternar('editor', 'a')
  t.g.alternar('panel', 'mixer')
  t.g.establecerProyecto('p2')
  assert.equal(t.g.estado().lista.length, 0)
  t.g.alternar('editor', 'z')
  const reinicio = montar(t.leerArchivo())
  reinicio.g.establecerProyecto('p1')
  assert.deepEqual(reinicio.g.estado().lista.map((p) => p.clave), ['editor:a', 'panel:mixer'])
  reinicio.g.establecerProyecto('p2')
  assert.deepEqual(reinicio.g.estado().lista.map((p) => p.clave), ['editor:z'])
})

test('al cambiar de proyecto se desanclan los del anterior', () => {
  const t = montar()
  t.g.establecerProyecto('p1')
  t.g.alternar('editor', 'a')
  t.host.length = 0
  t.g.establecerProyecto('p2')
  assert.ok(t.host.some((c) => c.slotId === 'a' && c.pinned === false))
})

test('slotDescargado elimina el pin del editor', () => {
  const t = montar()
  t.g.alternar('editor', 'a')
  t.g.alternar('editor', 'b')
  t.g.slotDescargado('a')
  assert.deepEqual(t.g.estado().lista.map((p) => p.id), ['b'])
  t.g.slotDescargado('no-existe')
  assert.equal(t.g.estado().lista.length, 1)
})

test('prepararEditor solo anuncia al host los editores anclados', () => {
  const t = montar()
  t.g.alternar('editor', 'a')
  t.host.length = 0
  t.g.prepararEditor('b')
  assert.equal(t.host.length, 0)
  t.g.prepararEditor('a')
  assert.deepEqual(t.host[0], { type: 'pinEditor', slotId: 'a', pinned: true, index: 0, reorder: false })
})

test('app minimizada: los anclados se ocultan y al restaurar reaparecen y se reordenan', () => {
  const t = montar()
  const w = ventanaFalsa(t.registro, 'mixer')
  t.ventanas.set('mixer', w)
  t.g.alternar('panel', 'mixer')
  t.g.alternar('editor', 'a')
  t.host.length = 0
  t.g.appOcultada(true)
  assert.equal(w.visible, false)
  assert.deepEqual(t.host[0], { type: 'setPinsVisible', visible: false })
  t.host.length = 0
  t.g.appOcultada(false)
  assert.equal(w.visible, true)
  assert.deepEqual(t.host[0], { type: 'setPinsVisible', visible: true })
  assert.ok(t.host.some((c) => c.type === 'pinEditor' && c.raise === true))
})
