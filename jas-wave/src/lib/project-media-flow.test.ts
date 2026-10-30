import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { copiarMediaEntreProyectos, moverMediaPendienteAlProyecto } from './project-media-flow'

type Entrada = { name: string; isDirectory: boolean; isFile: boolean }

/** Instala un `window.electron` falso y devuelve los registros de las llamadas. */
function instalarElectron(archivos: Record<string, Entrada[]>) {
  const g = globalThis as unknown as { window?: { electron?: unknown } }
  const copiados: Array<{ src: string; destDir: string; nombre?: string; mover?: boolean }> = []
  const listados: string[] = []
  g.window = {
    electron: {
      userDataPath: async () => 'C:/userData',
      mediaCopy: async (opts: { src: string; destDir: string; nombre?: string; mover?: boolean }) => {
        copiados.push(opts)
        return { ok: true, ruta: `${opts.destDir}/${opts.nombre ?? 'a.wav'}`, nombre: opts.nombre ?? 'a.wav' }
      },
      fileListDir: async (dir: string) => {
        listados.push(dir)
        return { success: true, entries: archivos[dir] ?? [] }
      },
    },
  }
  return { copiados, listados }
}

function tiendaFalsa(clips: Array<{ pistaId: string; clipId: string; ruta: string }>) {
  const ejecutados: Array<{ type: string; payload: unknown }> = []
  const proyecto = {
    tracks: [
      {
        id: 'p1',
        clips: clips.map((c) => ({ id: c.clipId, source: { ruta: c.ruta } })),
      },
    ],
  }
  const tienda = {
    obtenerEstado: () => ({ project: proyecto }),
    executor: {
      execute: async (type: string, payload: unknown) => {
        ejecutados.push({ type, payload })
        return { success: true }
      },
    },
  }
  return { tienda: tienda as unknown as TiendaDAW, ejecutados }
}

describe('project-media-flow (guardar como)', () => {
  it('copia el árbol media con rutas absolutas', async () => {
    const archivos: Record<string, Entrada[]> = {
      'C:/origen/media': [
        { name: 'intro.wav', isDirectory: false, isFile: true },
        { name: 'sub', isDirectory: true, isFile: false },
      ],
      'C:/origen/media/sub': [{ name: 'b.wav', isDirectory: false, isFile: true }],
    }
    const { copiados, listados } = instalarElectron(archivos)

    const res = await copiarMediaEntreProyectos('C:/origen/cancion.jaswave', 'C:/destino/cancion.jaswave')
    assert.equal(res.ok, true)
    assert.equal(res.movidos, 2)

    // El listado usa rutas absolutas (no relativas al cwd).
    assert.deepEqual(listados, ['C:/origen/media', 'C:/origen/media/sub'])

    const intro = copiados.find((c) => c.nombre === 'intro.wav')
    assert.equal(intro?.src, 'C:/origen/media/intro.wav')
    assert.equal(intro?.destDir, 'C:/destino/media')

    const sub = copiados.find((c) => c.nombre === 'b.wav')
    assert.equal(sub?.src, 'C:/origen/media/sub/b.wav')
    assert.equal(sub?.destDir, 'C:/destino/media/sub')
  })

  it('no hace nada si el origen y el destino son el mismo', async () => {
    const { copiados } = instalarElectron({})
    const res = await copiarMediaEntreProyectos('C:/p/cancion.jaswave', 'C:/p/cancion.jaswave')
    assert.equal(res.ok, true)
    assert.equal(copiados.length, 0)
  })
})

describe('project-media-flow (media pendiente)', () => {
  it('mueve el pendiente al proyecto y reapunta el clip', async () => {
    const { copiados } = instalarElectron({})
    const { tienda, ejecutados } = tiendaFalsa([{ pistaId: 'p1', clipId: 'c1', ruta: 'media/pending/intro.wav' }])

    const res = await moverMediaPendienteAlProyecto(tienda, 'C:/proyectos/cancion.jaswave')
    assert.equal(res.ok, true)
    assert.equal(res.movidos, 1)

    assert.equal(copiados.length, 1)
    assert.equal(copiados[0]!.src, 'C:/userData/media/pending/intro.wav')
    assert.equal(copiados[0]!.destDir, 'C:/proyectos/media')
    assert.equal(copiados[0]!.mover, true)

    const set = ejecutados.find((e) => e.type === 'clip.setSource')
    assert.ok(set)
    assert.deepEqual(set.payload, { pistaId: 'p1', clipId: 'c1', sourceId: 'media/intro.wav' })
  })

  it('no hace nada si no hay clips pendientes', async () => {
    const { copiados } = instalarElectron({})
    const { tienda, ejecutados } = tiendaFalsa([{ pistaId: 'p1', clipId: 'c1', ruta: 'media/intro.wav' }])

    const res = await moverMediaPendienteAlProyecto(tienda, 'C:/proyectos/cancion.jaswave')
    assert.equal(res.ok, true)
    assert.equal(res.movidos, 0)
    assert.equal(copiados.length, 0)
    assert.equal(ejecutados.length, 0)
  })
})
