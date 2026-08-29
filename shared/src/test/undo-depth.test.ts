/**
 * Tests undo depth + revert de turno (Fase 0).
 */

import { describe, it, expect } from 'vitest'
import { crearTiendaDAW } from '../state/tienda'
import { crearEstadoInicial } from '../state/estado-inicial'

describe('CommandExecutor getUndoDepth', () => {
  it('aumenta con execute y baja con undo', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    expect(tienda.executor.getUndoDepth()).toBe(0)
    await tienda.executor.execute('track.create', { nombre: 'A', tipo: 'midi' })
    const d1 = tienda.executor.getUndoDepth()
    expect(d1).toBeGreaterThan(0)
    await tienda.executor.execute('track.create', { nombre: 'B', tipo: 'midi' })
    const d2 = tienda.executor.getUndoDepth()
    expect(d2).toBeGreaterThan(d1)
    await tienda.executor.undo()
    expect(tienda.executor.getUndoDepth()).toBe(d1)
  })

  it('revertir hasta snapshot restaura profundidad', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const start = tienda.executor.getUndoDepth()
    await tienda.executor.execute('track.create', { nombre: 'X', tipo: 'midi' })
    await tienda.executor.execute('track.create', { nombre: 'Y', tipo: 'midi' })
    while (tienda.executor.getUndoDepth() > start) {
      const r = await tienda.executor.undo()
      expect(r.success).toBe(true)
    }
    expect(tienda.executor.getUndoDepth()).toBe(start)
  })
})
