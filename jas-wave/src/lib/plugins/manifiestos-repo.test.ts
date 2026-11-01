/**
 * npx tsx --test src/lib/plugins/manifiestos-repo.test.ts
 * Guarda de integración: los manifiestos reales de plugins/ cumplen el esquema V5 de @jaswave/shared
 * (los genera plugins/scripts/sync-manifests.mjs desde el código C++).
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { herramientasDesdeManifiesto, validarManifiesto } from '@jaswave/shared'

describe('manifiestos de plugins/ del repositorio', () => {
  it('todos validan con el esquema V5 y exponen describir/ajustar', () => {
    const raiz = resolve(__dirname, '../../../../plugins')
    const dirs = readdirSync(raiz).filter((d) => existsSync(join(raiz, d, 'jaswave-plugin.json')))
    assert.ok(dirs.length >= 7, `se esperaban al menos 7 plugins, hay ${dirs.length}`)
    for (const d of dirs) {
      const r = validarManifiesto(readFileSync(join(raiz, d, 'jaswave-plugin.json'), 'utf8'))
      assert.equal(r.ok ? 'ok' : `${d}: ${r.errores.join(' | ')}`, 'ok')
      if (r.ok && (r.manifiesto.category === 'ui-extension' || r.manifiesto.category === 'ai-skill')) {
        // Módulo del DAW (M3): código ESM en dist/, sin binario VST3.
        assert.match(r.manifiesto.entrypoints.ui ?? '', /^dist\//, d)
        assert.equal(r.manifiesto.entrypoints.dspDesktop, undefined, d)
        continue
      }
      if (r.ok) {
        assert.equal(herramientasDesdeManifiesto(r.manifiesto).length, 2, d)
        assert.equal(r.manifiesto.license?.productId, r.manifiesto.id, `${d}: productId debe ser el id`)
      }
    }
  })
})
