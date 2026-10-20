/**
 * npx tsx --test src/lib/clip-edit-commands.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import { loteBorrarClips, loteDuplicarClips, lotePegarClips } from './clip-edit-commands'
import type { ClipboardClip } from './daw-clipboard'

async function tiendaConClips() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  const r = await tienda.executor.execute('track.create', { nombre: 'Audio', tipo: 'audio' })
  const pistaId = (r.result as { trackId: string }).trackId
  for (const [id, inicio] of [['a', 0], ['b', 4]] as const) {
    const c = await tienda.executor.execute('clip.create', {
      pistaId,
      id,
      inicio,
      duracion: 2,
      sourceId: `${id}.wav`,
      clipInicio: 1,
    })
    assert.equal(c.success, true, c.error?.message)
  }
  return { tienda, pistaId }
}

function aPortapapeles(pistaId: string, clips: ReadonlyArray<Record<string, unknown>>): ClipboardClip[] {
  return clips.map((c) => ({
    pistaOrigenId: pistaId,
    nombre: String(c.nombre),
    inicio: Number(c.inicio),
    duracion: Number(c.duracion),
    tipo: 'audio',
    sourceId: (c.source as { ruta: string }).ruta,
    clipInicio: Number(c.clipInicio),
  }))
}

let contador = 0
const ids = () => `nuevo-${++contador}`

describe('clip-edit-commands', () => {
  it('pegar: un lote, conserva separación relativa y clipInicio, un solo undo', async () => {
    const { tienda, pistaId } = await tiendaConClips()
    const pista = tienda.obtenerEstado().project.tracks.find((t) => t.id === pistaId)!
    const clips = aPortapapeles(pistaId, pista.clips as unknown as Record<string, unknown>[])
    const lote = lotePegarClips(clips, pistaId, 16, ids)
    const depth = tienda.executor.getUndoDepth()
    const r = await tienda.executor.batch(lote.comandos)
    assert.equal(r.success, true)
    assert.equal(tienda.executor.getUndoDepth(), depth + 1)
    const creados = tienda
      .obtenerEstado()
      .project.tracks.find((t) => t.id === pistaId)!
      .clips.filter((c) => lote.idsCreados.includes(c.id)) as unknown as Array<{ inicio: number; clipInicio: number }>
    assert.deepEqual(creados.map((c) => c.inicio), [16, 20])
    assert.deepEqual(creados.map((c) => c.clipInicio), [1, 1])
    await tienda.executor.undo()
    assert.equal(tienda.obtenerEstado().project.tracks.find((t) => t.id === pistaId)!.clips.length, 2)
  })

  it('duplicar: justo después del original y con clipInicio', () => {
    const lote = loteDuplicarClips(
      [{ pistaOrigenId: 'p', nombre: 'X', inicio: 2, duracion: 3, tipo: 'audio', sourceId: 'x.wav', clipInicio: 0.5 }],
      ids,
    )
    assert.equal(lote.comandos.length, 1)
    const payload = lote.comandos[0]!.payload as { inicio: number; clipInicio: number; nombre: string }
    assert.equal(payload.inicio, 5)
    assert.equal(payload.clipInicio, 0.5)
    assert.equal(payload.nombre, 'X (Copia)')
  })

  it('borrar/cortar varios clips = un lote = un undo', async () => {
    const { tienda, pistaId } = await tiendaConClips()
    const comandos = loteBorrarClips(tienda.obtenerEstado().project, ['a', 'b', 'a', 'inexistente'])
    assert.equal(comandos.length, 2)
    const depth = tienda.executor.getUndoDepth()
    const r = await tienda.executor.batch(comandos)
    assert.equal(r.success, true)
    assert.equal(tienda.executor.getUndoDepth(), depth + 1)
    await tienda.executor.undo()
    assert.equal(tienda.obtenerEstado().project.tracks.find((t) => t.id === pistaId)!.clips.length, 2)
  })
})
