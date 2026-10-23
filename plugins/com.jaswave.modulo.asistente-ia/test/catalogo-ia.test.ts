/**
 * npx tsx --test src/lib/ia/catalogo-ia.test.ts
 * M2: catálogo de modelos desde el backend, ajustes derivados y enrutado servidor / equipo local.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { before, beforeEach, describe, it } from 'node:test'
import type { ProveedorIAApi } from '@/src/lib/backend/api'
import type { AiChatRequest } from '../src/motor/ai-settings'

const credenciales: [string, string][] = []
before(() => {
  const store = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  g.window = {
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // Escritorio simulado: gateway local (no se usa aquí) y almacén de credenciales.
    electron: { aiChat: async () => ({ success: true }), aiHealth: async () => ({ status: 'healthy', models: [] }), aiCredSet: async (id: string, k: string) => void credenciales.push([id, k]) },
  }
})

const ADMIN: ProveedorIAApi = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'principal',
  nombre: 'Principal',
  tipo: 'openai',
  modelos: ['gpt-a', 'gpt-b'],
  modeloPorDefecto: 'gpt-a',
  maxTokens: 4096,
  herramientas: null,
  origen: 'admin',
  ejecucion: 'servidor',
  activo: true,
  tieneClave: true,
}
const LOCAL: ProveedorIAApi = {
  ...ADMIN,
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'u-abc',
  nombre: 'Mi Ollama',
  tipo: 'ollama',
  baseUrl: 'http://localhost:11434',
  modelos: ['llama3'],
  modeloPorDefecto: 'llama3',
  origen: 'propio',
  ejecucion: 'local',
}

async function modulos() {
  const cat = await import('../src/ia/catalogo-ia')
  const ajustes = await import('../src/motor/ai-settings')
  const transporte = await import('../src/ia/transporte-ia')
  return { cat, ajustes, transporte }
}

const req = (providerId: string): AiChatRequest => ({ messages: [{ role: 'user', content: 'hola' }], kind: 'openai', model: 'x', baseUrl: '', providerId })

function transporteFalso(nombre: string, llamadas: { quien: string; req: AiChatRequest }[]) {
  return {
    origen: 'backend' as const,
    chat: async (r: AiChatRequest) => {
      llamadas.push({ quien: nombre, req: r })
      return { success: true, content: nombre }
    },
    cancelar: async () => true,
    salud: async () => ({ status: 'healthy' as const, models: [] }),
  }
}

describe('M2 — catálogo de IA y enrutado', () => {
  beforeEach(() => {
    credenciales.length = 0
  })

  it('los ajustes salen del catálogo: solo modelos permitidos, preferencia de modelo y proveedor recordadas', async () => {
    const { cat, ajustes } = await modulos()
    cat.fijarCatalogoIA({ permisos: { usar: true, modeloPropio: false, proveedores: ['principal'] }, proveedores: [ADMIN] })
    let s = ajustes.loadAiSettings()
    assert.equal(s.providers.length, 1)
    assert.equal(ajustes.getActiveProvider(s).selectedModel, 'gpt-a')
    assert.equal(ajustes.providerIsReady(s.providers[0]!), true)
    assert.deepEqual(
      ajustes.listCatalogModels(s).map((m) => m.model).sort(),
      ['gpt-a', 'gpt-b'],
      'sin modelos sugeridos por presets',
    )
    ajustes.saveAiSettings(ajustes.selectCatalogModel(s, ADMIN.id, 'gpt-b'))
    s = ajustes.loadAiSettings()
    assert.equal(ajustes.getActiveProvider(s).selectedModel, 'gpt-b')
    // Sin proveedores: perfil vacío que nunca está listo (no rompe a los llamadores).
    cat.fijarCatalogoIA({ permisos: { usar: false, modeloPropio: false, proveedores: [] }, proveedores: [] })
    const vacio = ajustes.getActiveProvider(ajustes.loadAiSettings())
    assert.equal(vacio.id, '')
    assert.equal(ajustes.providerIsReady(vacio), false)
    assert.deepEqual(ajustes.buildFallbackAttempts(ajustes.loadAiSettings()), [])
  })

  it('enrutado: admin → backend; propio local → Electron con la credencial preparada y la URL del catálogo', async () => {
    const { cat, transporte } = await modulos()
    cat.fijarCatalogoIA({ permisos: { usar: true, modeloPropio: true, proveedores: ['principal'] }, proveedores: [ADMIN, LOCAL] })
    const llamadas: { quien: string; req: AiChatRequest }[] = []
    let preparadas = 0
    const t = transporte.crearTransporteMixto(transporteFalso('backend', llamadas), transporteFalso('electron', llamadas), async (p) => {
      preparadas++
      return { ok: true, proveedor: p }
    })!
    assert.equal(t.origen, 'mixto')
    assert.equal((await t.chat(req(ADMIN.id))).content, 'backend')
    assert.equal((await t.chat({ ...req(LOCAL.id), apiKey: 'no-debe-viajar' })).content, 'electron')
    assert.equal(preparadas, 1)
    const local = llamadas.at(-1)!.req
    assert.equal(local.baseUrl, 'http://localhost:11434')
    assert.equal(local.kind, 'ollama')
    assert.equal(local.apiKey, undefined)
  })

  it('en la web un modelo propio local no se puede usar; sin sesión no hay backend', async () => {
    const { cat, transporte } = await modulos()
    cat.fijarCatalogoIA({ permisos: { usar: true, modeloPropio: true, proveedores: ['principal'] }, proveedores: [ADMIN, LOCAL] })
    const llamadas: { quien: string; req: AiChatRequest }[] = []
    const web = transporte.crearTransporteMixto(transporteFalso('backend', llamadas), null)!
    const r = await web.chat(req(LOCAL.id))
    assert.equal(r.success, false)
    assert.match(r.error ?? '', /JasWave Desktop/)
    const soloEscritorio = transporte.crearTransporteMixto(null, transporteFalso('electron', llamadas))!
    assert.equal((await soloEscritorio.chat(req(ADMIN.id))).errorCode, 'unauthorized')
  })

  it('permiso retirado: la credencial local se borra del equipo y el chat informa', async () => {
    const { cat, transporte } = await modulos()
    cat.fijarCatalogoIA({ permisos: { usar: true, modeloPropio: true, proveedores: [] }, proveedores: [LOCAL] })
    const r = await cat.prepararCredencialLocal(LOCAL, async () => {
      throw Object.assign(new Error('sin permiso'), { estado: 403 })
    })
    assert.equal(r.ok, false)
    assert.deepEqual(credenciales.at(-1), [LOCAL.id, ''])
    const t = transporte.crearTransporteMixto(null, transporteFalso('electron', []), async () => ({ ok: false, error: 'sin permiso', estado: 403 }))!
    assert.equal((await t.chat(req(LOCAL.id))).errorCode, 'forbidden')
  })

  it('la credencial se trae del backend al almacén cifrado y se reutiliza; al desaparecer del catálogo se olvida', async () => {
    const { cat } = await modulos()
    const otro = { ...LOCAL, id: '33333333-3333-4333-8333-333333333333' }
    cat.fijarCatalogoIA({ permisos: { usar: true, modeloPropio: true, proveedores: [] }, proveedores: [otro] })
    let pedidas = 0
    const pedir = async () => {
      pedidas++
      return { ...otro, apiKey: 'sk-propia' }
    }
    assert.equal((await cat.prepararCredencialLocal(otro, pedir)).ok, true)
    assert.equal((await cat.prepararCredencialLocal(otro, pedir)).ok, true)
    assert.equal(pedidas, 1)
    assert.ok(credenciales.some(([id, k]) => id === otro.id && k === 'sk-propia'))
    cat.fijarCatalogoIA({ permisos: { usar: true, modeloPropio: false, proveedores: [] }, proveedores: [] })
    assert.deepEqual(credenciales.at(-1), [otro.id, ''])
  })

  it('los ajustes antiguos con proveedores locales se eliminan junto con sus claves', async () => {
    localStorage.setItem('jaswave-ai-settings-v2', JSON.stringify({ version: 2, providers: [{ id: 'viejo-1' }, { id: 'viejo-2' }] }))
    // Módulo nuevo para que la limpieza (una vez por sesión) vuelva a correr.
    const ajustes = await import(`../src/motor/ai-settings?limpieza=${Date.now()}`)
    ajustes.loadAiSettings()
    assert.equal(localStorage.getItem('jaswave-ai-settings-v2'), null)
    assert.deepEqual(
      credenciales.filter(([id]) => id.startsWith('viejo')),
      [
        ['viejo-1', ''],
        ['viejo-2', ''],
      ],
    )
  })
})
