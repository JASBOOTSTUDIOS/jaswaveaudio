/**
 * Herramientas de plugins que ve el agente según su modo (contrato con el DAW real).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { _reiniciarPluginsParaPruebas, activarPaquetes, type PaqueteRecibido } from '@/src/lib/plugins/registro-plugins'
import { listAgentToolSchemas } from '../src/motor/agent-tool-schemas'

const manifiesto = (id = 'com.jaswave.plugin.param-eq') => ({
  id,
  name: 'JasWave EQ',
  version: '1.0.0',
  category: 'audio-effect',
  vendor: 'JasWave Audio',
  targetPlatforms: ['win-x64'],
  entrypoints: { dspDesktop: 'bin/JasWaveParamEq.vst3' },
  vst3: { classId: '{4A15A3A0-3C1A-4C4F-B19A-8E40280D5E01}' },
  permissions: { realtimeAudio: true, fileSystem: 'none', network: false, commands: ['plugin.setParameter'] },
  rolesAllowed: ['mezcla'],
  license: { productId: id, features: [{ key: 'eq.avanzado' }] },
  ai: {
    summary: 'EQ',
    parameters: [
      { id: 'b1.gain', vstParamId: 3, name: 'Banda 1 Ganancia', min: -24, max: 24, default: 0, unit: 'dB' },
      { id: 'b5.gain', vstParamId: 23, name: 'Banda 5 Ganancia', min: -24, max: 24, default: 0, unit: 'dB', feature: 'eq.avanzado' },
    ],
  },
})

const paquete = (extra: Partial<PaqueteRecibido> = {}): PaqueteRecibido => ({
  dir: 'C:/x/com.jaswave.plugin.param-eq',
  manifiesto: manifiesto(),
  integridad: 'verificada',
  ...extra,
})

describe('herramientas de plugins en el agente', () => {
  afterEach(() => _reiniciarPluginsParaPruebas())

  it('en modo ask solo se ven las herramientas de lectura del plugin', () => {
    activarPaquetes([paquete()])
    const ask = listAgentToolSchemas({ mode: 'ask', role: 'mezcla' }).map((t) => t.name)
    assert.ok(ask.includes('plugin.param-eq.describir'))
    assert.ok(!ask.includes('plugin.param-eq.ajustar'))
  })
})
