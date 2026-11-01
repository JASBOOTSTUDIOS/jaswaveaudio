import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { INTERVALO_SYNC_MS, crearProgramadorSync, esperaReintentoSync } from './sync-programador'

/** Reloj falso: guarda el último temporizador y deja dispararlo a mano. */
function reloj() {
  const pendientes: Array<{ f: () => void; ms: number; vivo: boolean }> = []
  return {
    pendientes,
    set: (f: () => void, ms: number) => {
      const t = { f, ms, vivo: true }
      pendientes.push(t)
      return t
    },
    clear: (h: unknown) => void ((h as { vivo: boolean }).vivo = false),
    siguiente: () => pendientes.filter((p) => p.vivo).at(-1),
  }
}
const esperar = () => new Promise((r) => setTimeout(r, 5))

describe('programador de sincronización de grooves', () => {
  it('espera creciente: 30 s, 1 min, 2 min… con tope de 30 min; intervalo normal de 6 h', () => {
    assert.deepEqual([1, 2, 3, 4].map(esperaReintentoSync), [30_000, 60_000, 120_000, 240_000])
    assert.equal(esperaReintentoSync(50), 30 * 60_000)
    assert.equal(INTERVALO_SYNC_MS, 6 * 3_600_000)
  })

  it('ejecuta al iniciar, repite cada 6 h y reintenta con backoff cuando falla; nunca lanza', async () => {
    const r = reloj()
    let llamadas = 0
    const resultados = [false, false, true]
    const p = crearProgramadorSync({ tarea: async () => (llamadas++, { ok: resultados.shift() ?? true }), temporizadores: r })
    p.iniciar()
    await esperar()
    assert.equal(llamadas, 1)
    assert.equal(r.siguiente()!.ms, 30_000)
    r.siguiente()!.f()
    await esperar()
    assert.equal(r.siguiente()!.ms, 60_000)
    r.siguiente()!.f()
    await esperar()
    assert.equal(p.fallosSeguidos(), 0)
    assert.equal(r.siguiente()!.ms, INTERVALO_SYNC_MS)
    p.parar()
  })

  it('una tarea que lanza cuenta como fallo y no rompe nada; no hay dos a la vez', async () => {
    const r = reloj()
    let enCurso = 0
    let maximo = 0
    const p = crearProgramadorSync({
      tarea: async () => {
        maximo = Math.max(maximo, ++enCurso)
        await esperar()
        enCurso--
        throw new Error('sin red')
      },
      temporizadores: r,
    })
    p.iniciar()
    p.pedir()
    p.pedir()
    await new Promise((x) => setTimeout(x, 30))
    assert.equal(maximo, 1)
    assert.equal(p.fallosSeguidos(), 1)
    p.parar()
  })

  it('sin conexión (activo = false) no intenta nada y vuelve a mirar en 6 h', async () => {
    const r = reloj()
    let llamadas = 0
    const p = crearProgramadorSync({ tarea: async () => (llamadas++, { ok: true }), temporizadores: r, activo: () => false })
    p.iniciar()
    await esperar()
    assert.equal(llamadas, 0)
    assert.equal(r.siguiente()!.ms, INTERVALO_SYNC_MS)
    p.parar()
  })
})
