/**
 * npx tsx --test src/lib/backend/backend.test.ts
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { configBackend, backendConfigurado } from './config'
import { crearClienteApi, ErrorApiCliente } from './api'
import { leerCargaLicencia, msHastaRenovar, renovarLicenciaEquipo, MARGEN_RENOVACION_MS, type PuertoLicenciaLocal } from './licencia-equipo'
import { _reiniciarPluginsParaPruebas, activarPaquetes, planificarHerramientaPlugin } from '../plugins/registro-plugins'

type Llamada = { url: string; init: RequestInit }

function fetchFalso(respuestas: Record<string, { status: number; body?: unknown }>, llamadas: Llamada[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    const clave = `${init.method} ${url.replace('http://api', '')}`
    const r = respuestas[clave]
    if (!r) throw new TypeError('network error')
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

describe('backend — configuración', () => {
  it('usa valores locales por defecto y quita barras finales', () => {
    const c = configBackend({ VITE_API_URL: 'https://api.jaswave.app/', VITE_OAUTH_PROVIDERS: 'google, github, otro' })
    assert.equal(c.apiUrl, 'https://api.jaswave.app')
    assert.equal(c.supabaseUrl, 'http://127.0.0.1:55321')
    assert.deepEqual(c.proveedoresOAuth, ['google', 'github'])
    assert.equal(backendConfigurado(c), false) // sin clave anónima
  })
})

describe('backend — cliente API', () => {
  it('añade el Bearer y devuelve la identidad', async () => {
    const llamadas: Llamada[] = []
    const api = crearClienteApi({
      base: 'http://api',
      token: async () => 'jwt-1',
      fetch: fetchFalso({ 'GET /me': { status: 200, body: { identidad: { userId: 'u', email: 'a@b.c', roles: [], esAdmin: true } } } }, llamadas),
    })
    assert.equal((await api.me()).esAdmin, true)
    assert.equal((llamadas[0]!.init.headers as Record<string, string>).Authorization, 'Bearer jwt-1')
  })

  it('sin sesión no llama al servidor y da 401', async () => {
    const llamadas: Llamada[] = []
    const api = crearClienteApi({ base: 'http://api', token: async () => null, fetch: fetchFalso({}, llamadas) })
    await assert.rejects(() => api.admin.productos(), (e: unknown) => e instanceof ErrorApiCliente && e.estado === 401)
    assert.equal(llamadas.length, 0)
  })

  it('traduce errores del servidor y la falta de red', async () => {
    const api = crearClienteApi({
      base: 'http://api',
      token: async () => 't',
      fetch: fetchFalso({ 'POST /admin/productos': { status: 409, body: { error: { codigo: 'conflicto', mensaje: 'ya existe' } } } }, []),
    })
    await assert.rejects(() => api.admin.crearProducto('com.x.y.z', 'Z'), (e: unknown) => e instanceof ErrorApiCliente && e.codigo === 'conflicto')
    await assert.rejects(() => api.me(), (e: unknown) => e instanceof ErrorApiCliente && e.codigo === 'sin_conexion')
  })

  it('codifica ids en la ruta (no permite inyectar segmentos)', async () => {
    const llamadas: Llamada[] = []
    const api = crearClienteApi({ base: 'http://api', token: async () => 't', fetch: fetchFalso({}, llamadas) })
    await api.admin.eliminarProducto('../usuarios').catch(() => undefined)
    assert.match(llamadas[0]!.url, /\/admin\/productos\/\.\.%2Fusuarios$/)
  })
})

describe('backend — licencia del equipo', () => {
  afterEach(() => _reiniciarPluginsParaPruebas())

  const respuesta = {
    estado: 'aprobado',
    token: `jwl1.${b64url({ sub: 'u', email: 'a@b.c', dispositivo: 'PC', productos: { 'com.jaswave.plugin.param-eq': ['eq.avanzado'] }, iat: 1, exp: 2 })}.${'x'.repeat(86)}`,
    expiraEn: new Date(Date.now() + 24 * 3600_000).toISOString(),
    productos: { 'com.jaswave.plugin.param-eq': ['eq.avanzado'] },
    tokenDispositivo: 'nuevo-token-dispositivo-0123456789',
  }

  it('renueva, guarda para los VST (rotando el token) y aplica funciones a la IA', async () => {
    const llamadas: Llamada[] = []
    const api = crearClienteApi({ base: 'http://api', token: async () => 't', fetch: fetchFalso({ 'POST /license/refresh': { status: 200, body: respuesta } }, llamadas) })
    const guardados: unknown[] = []
    const puerto: PuertoLicenciaLocal = {
      nombreEquipo: async () => 'Estudio',
      leerTokenDispositivo: async () => 'token-anterior-0123456789abcdef',
      guardar: async (d) => guardados.push(d),
    }
    const r = await renovarLicenciaEquipo(api, puerto)
    assert.equal(r.estado, 'activa')
    assert.deepEqual(JSON.parse(String(llamadas[0]!.init.body)), { dispositivo: 'Estudio', tokenDispositivo: 'token-anterior-0123456789abcdef' })
    assert.deepEqual(guardados, [{ token: respuesta.token, tokenDispositivo: respuesta.tokenDispositivo }])

    activarPaquetes([
      {
        dir: 'x',
        integridad: 'verificada',
        manifiesto: {
          id: 'com.jaswave.plugin.param-eq',
          name: 'EQ',
          version: '1.0.0',
          category: 'audio-effect',
          vendor: 'JasWave',
          targetPlatforms: ['win-x64'],
          entrypoints: { dspDesktop: 'bin/a.vst3' },
          vst3: { classId: '{4A15A3A0-3C1A-4C4F-B19A-8E40280D5E01}' },
          permissions: { commands: ['plugin.setParameter'] },
          rolesAllowed: ['mezcla'],
          license: { productId: 'com.jaswave.plugin.param-eq', features: [{ key: 'eq.avanzado' }, { key: 'eq.otra' }] },
          ai: {
            parameters: [
              { id: 'a', vstParamId: 1, name: 'A', min: 0, max: 1, default: 0, feature: 'eq.avanzado' },
              { id: 'b', vstParamId: 2, name: 'B', min: 0, max: 1, default: 0, feature: 'eq.otra' },
            ],
          },
        },
      },
    ])
    assert.equal(planificarHerramientaPlugin('plugin.param-eq.ajustar', { trackId: 't', pluginInstanceId: 'p', valores: { a: 1 } }).tipo, 'comandos')
    assert.throws(() => planificarHerramientaPlugin('plugin.param-eq.ajustar', { trackId: 't', pluginInstanceId: 'p', valores: { b: 1 } }), /licencia/)
  })

  it('sin licencia (403) no guarda nada e informa el estado', async () => {
    const api = crearClienteApi({
      base: 'http://api',
      token: async () => 't',
      fetch: fetchFalso({ 'POST /license/refresh': { status: 403, body: { error: { codigo: 'sin_licencia', mensaje: 'sin productos' } } } }, []),
    })
    const guardados: unknown[] = []
    const r = await renovarLicenciaEquipo(api, { nombreEquipo: async () => 'PC', leerTokenDispositivo: async () => null, guardar: async (d) => guardados.push(d) })
    assert.deepEqual(r, { estado: 'sin-licencia' })
    assert.equal(guardados.length, 0)
  })

  it('lee la carga de una licencia y calcula la próxima renovación', () => {
    const carga = leerCargaLicencia(respuesta.token)
    assert.deepEqual(carga?.productos, respuesta.productos)
    assert.equal(leerCargaLicencia('jwt.no.licencia'), null)
    const expira = new Date(Date.now() + 24 * 3600_000)
    const ms = msHastaRenovar({ estado: 'activa', productos: {}, expiraEn: expira })
    assert.ok(Math.abs(ms - (24 * 3600_000 - MARGEN_RENOVACION_MS)) < 5000)
    assert.equal(msHastaRenovar({ estado: 'error', mensaje: 'x' }), 5 * 60 * 1000)
  })
})
