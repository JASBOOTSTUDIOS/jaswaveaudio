/**
 * npx tsx --test src/modulos/servicios-modulos.test.ts
 * M5: las acciones del DAW que dependen de un módulo (score.*) usan su servicio si está activo y, si no,
 * informan de qué falta sin romper.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import { definirModulo } from '@jaswave/host-sdk/contrato'
import { VERSION_SDK } from '@jaswave/host-sdk/runtime'
import { executeDawActions } from '../lib/ai-daw-agent'
import { registrarModulo, reiniciarModulosParaPruebas } from './registro-modulos'

;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const accion = { type: 'score.exportClip', payload: { pistaId: 't1', clipId: 'c1' } }
// Como desde la CLI del DAW (acción confirmada por el usuario).
const opciones = { forceApply: true, agentMode: 'create' as const, respectModeGate: false, source: 'cli' as const }

describe('M5 — servicios de módulos en las acciones del DAW', () => {
  beforeEach(() => reiniciarModulosParaPruebas())

  it('sin el módulo Partitura la acción explica qué falta', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const [r] = await executeDawActions(tienda, [accion], opciones)
    assert.equal(r?.success, false)
    assert.match(String(r?.message), /módulo Partitura/)
  })

  it('con el módulo activo la acción usa su servicio', async () => {
    const llamadas: string[] = []
    await registrarModulo({
      id: 'com.jaswave.modulo.partitura',
      nombre: 'Partitura',
      descripcion: '',
      version: '1.0.0',
      origen: 'pruebas',
      cargar: async () =>
        definirModulo({
          id: 'com.jaswave.modulo.partitura',
          nombre: 'Partitura',
          version: '1.0.0',
          sdk: VERSION_SDK,
          herramientas: [],
          activar: () => ({
            paneles: {},
            servicios: {
              partitura: {
                exportarClipPdf: async (_t, pistaId, clipId) => {
                  llamadas.push(`${pistaId}/${clipId}`)
                  return { ok: true, message: 'PDF listo' }
                },
                exportarProyecto: async () => ({ ok: true, message: '', count: 0 }),
              },
            },
          }),
        }),
    })
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const [r] = await executeDawActions(tienda, [accion], opciones)
    assert.deepEqual(llamadas, ['t1/c1'])
    assert.equal(r?.success, true)
    assert.equal(r?.message, 'PDF listo')
  })
})
