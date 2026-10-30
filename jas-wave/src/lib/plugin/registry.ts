/**
 * Registry en memoria de descriptores (ADR-0011).
 * No escanea filesystem agresivamente; no carga VST3.
 */

import type { PluginDescriptor, PluginFormat } from './types'
import { expandPluginNameQueries } from './known-vst-aliases'

export class PluginRegistry {
  private byId = new Map<string, PluginDescriptor>()

  register(desc: PluginDescriptor): void {
    this.byId.set(desc.pluginId, desc)
  }

  unregister(pluginId: string): void {
    this.byId.delete(pluginId)
  }

  findById(pluginId: string): PluginDescriptor | undefined {
    return this.byId.get(pluginId)
  }

  findByName(name: string): PluginDescriptor[] {
    const queries = expandPluginNameQueries(name).map((q) => q.toLowerCase())
    return this.list().filter((d) => {
      const n = d.name.toLowerCase()
      const compact = n.replace(/\s+/g, '')
      const soloLetras = n.replace(/[^a-z0-9]/g, '')
      return queries.some((q) => {
        if (n.includes(q) || compact.includes(q.replace(/\s+/g, ''))) return true
        // El nombre de manifiesto («JasWave True-Peak Limiter Pro») no coincide con el del archivo
        // («JasWaveTruePeakLimiter»): se compara sin signos y sin el sufijo comercial «pro».
        const qLetras = q.replace(/[^a-z0-9]/g, '').replace(/pro$/, '')
        return qLetras.length >= 6 && soloLetras.includes(qLetras)
      })
    })
  }

  findByVendor(vendor: string): PluginDescriptor[] {
    const q = vendor.toLowerCase()
    return this.list().filter((d) => d.vendor.toLowerCase().includes(q))
  }

  findByCategory(category: string): PluginDescriptor[] {
    const q = category.toLowerCase()
    return this.list().filter((d) => d.category.toLowerCase().includes(q))
  }

  findInstruments(): PluginDescriptor[] {
    return this.list().filter((d) => d.isInstrument)
  }

  findEffects(): PluginDescriptor[] {
    return this.list().filter((d) => d.isEffect)
  }

  findByFormat(format: PluginFormat): PluginDescriptor[] {
    return this.list().filter((d) => d.format === format)
  }

  getAvailablePlugins(): PluginDescriptor[] {
    return this.list().filter((d) => d.scanStatus === 'ok' && d.hostReady)
  }

  list(): PluginDescriptor[] {
    return [...this.byId.values()]
  }

  clear(): void {
    this.byId.clear()
  }
}

export const pluginRegistry = new PluginRegistry()
