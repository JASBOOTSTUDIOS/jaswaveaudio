/**
 * npx tsx --test src/lib/project-conflict.test.ts
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  _reiniciarFirmasArchivo,
  detectarConflictoProyecto,
  firmaConocida,
  leerFirmaArchivo,
  registrarFirmaArchivo,
  refrescarFirmaArchivo,
} from './project-conflict'

type Stat = { mtimeMs: number; size: number } | null

function conArchivo(stat: Stat): void {
  ;(globalThis as any).window = {
    electron: {
      fileStat: async () => stat,
    },
  }
}

describe('project-conflict', () => {
  beforeEach(() => {
    _reiniciarFirmasArchivo()
    conArchivo(null)
  })

  it('sin firma conocida no hay conflicto', async () => {
    conArchivo({ mtimeMs: 1000, size: 10 })
    assert.equal(await detectarConflictoProyecto('C:/p.jaswave'), null)
  })

  it('el archivo sin cambios no da conflicto', async () => {
    conArchivo({ mtimeMs: 1000, size: 10 })
    registrarFirmaArchivo('C:/p.jaswave', { mtimeMs: 1000, size: 10 })
    assert.equal(await detectarConflictoProyecto('C:/p.jaswave'), null)
  })

  it('el archivo modificado en disco da conflicto', async () => {
    conArchivo({ mtimeMs: 2000, size: 10 })
    registrarFirmaArchivo('C:/p.jaswave', { mtimeMs: 1000, size: 10 })
    const conflicto = await detectarConflictoProyecto('C:/p.jaswave')
    assert.ok(conflicto)
    assert.equal(conflicto!.ruta, 'C:/p.jaswave')
    assert.equal(conflicto!.actual.mtimeMs, 2000)
  })

  it('la ruta se compara sin distinguir mayúsculas ni barras', async () => {
    conArchivo({ mtimeMs: 2000, size: 10 })
    registrarFirmaArchivo('C:\\Proyectos\\P.jaswave', { mtimeMs: 1000, size: 10 })
    assert.ok(firmaConocida('c:/proyectos/p.jaswave'))
    assert.ok(await detectarConflictoProyecto('c:/proyectos/p.jaswave'))
  })

  it('refrescarFirmaArchivo actualiza la firma conocida', async () => {
    conArchivo({ mtimeMs: 5000, size: 20 })
    await refrescarFirmaArchivo('C:/p.jaswave')
    assert.deepEqual(firmaConocida('C:/p.jaswave'), { mtimeMs: 5000, size: 20 })
    assert.equal(await detectarConflictoProyecto('C:/p.jaswave'), null)
  })

  it('si el archivo desaparece, la firma se borra (se recreará al guardar)', async () => {
    conArchivo(null)
    registrarFirmaArchivo('C:/p.jaswave', { mtimeMs: 1000, size: 10 })
    await refrescarFirmaArchivo('C:/p.jaswave')
    assert.equal(firmaConocida('C:/p.jaswave'), null)
  })

  it('leerFirmaArchivo devuelve null sin electron', async () => {
    ;(globalThis as any).window = {}
    assert.equal(await leerFirmaArchivo('C:/p.jaswave'), null)
  })
})
