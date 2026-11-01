/**
 * Escenario 2: smoke de seguridad desde la propia página (lo que podría hacer un XSS).
 * Se ejecuta dos veces: con el agent bridge apagado (por defecto en la app empaquetada)
 * y encendido (JASWAVE_AGENT_BRIDGE=1), donde además se comprueba el rechazo por Origin.
 */
import { expect, test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'

/** Comprobaciones de IPC comunes a ambos modos. */
async function ipcHardening(page: Page) {
  const r = await page.evaluate(async () => {
    const api = (window as any).electron
    const out: Record<string, unknown> = {}
    try {
      await api.fileRead('C:/Windows/win.ini')
      out.fileRead = 'leído'
    } catch (e) {
      out.fileRead = `rechazado: ${e instanceof Error ? e.message : String(e)}`
    }
    try {
      await api.fileSave('C:/Windows/Temp/jaswave-e2e-evil.txt', 'x')
        .then((res: any) => (out.fileSave = res))
    } catch (e) {
      out.fileSave = { success: false, error: String(e) }
    }
    out.fileExists = await api.fileExists('C:/Windows/win.ini')
    out.pluginLoad = await api.pluginHostSend({ type: 'load', path: 'C:/Users/Public/evil.dll' })
    out.openFile = await api.shellOpenExternal('file:///C:/Windows/System32/calc.exe')
    out.openJs = await api.shellOpenExternal('javascript:alert(1)')
    out.windowOpen = window.open('https://example.com', '_blank') === null
    return out
  })
  expect(String(r.fileRead)).toMatch(/^rechazado/)
  expect(r.fileSave).toMatchObject({ success: false })
  expect(r.fileExists).toBe(false)
  expect(r.pluginLoad).toMatchObject({ ok: false })
  expect(r.openFile).toBe(false)
  expect(r.openJs).toBe(false)
  expect(r.windowOpen).toBe(true)
}

/** fetch desde el renderer al bridge: CSP (connect-src) y/o el bridge deben impedirlo. */
async function pageFetchBridge(page: Page, port: number) {
  return page.evaluate(async (p) => {
    try {
      const res = await fetch(`http://127.0.0.1:${p}/health`)
      return { ok: res.ok, status: res.status }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  }, port)
}

test.describe('bridge apagado (por defecto)', () => {
  const app = setupJasWave({ label: 'sec-off', bridge: false })

  test('IPC rechaza rutas, plugins y URLs no concedidas', async () => {
    await ipcHardening(app().page)
  })

  test('el bridge no escucha y la página no puede alcanzarlo', async () => {
    const a = app()
    for (const port of [a.bridgePort, 18787]) {
      const r = await pageFetchBridge(a.page, port)
      expect(r.ok, `fetch a :${port} desde la página no debe tener éxito`).toBe(false)
    }
    // Desde Node: nadie escucha en el puerto asignado.
    const nodeFetch = await fetch(`http://127.0.0.1:${a.bridgePort}/health`, { signal: AbortSignal.timeout(3000) }).then(
      (res) => `status ${res.status}`,
      () => 'refused',
    )
    expect(nodeFetch).toBe('refused')
  })
})

test.describe('bridge encendido (JASWAVE_AGENT_BRIDGE=1)', () => {
  const app = setupJasWave({ label: 'sec-on', bridge: true })

  test('IPC sigue endurecido con el bridge activo', async () => {
    await ipcHardening(app().page)
  })

  test('peticiones con Origin → 403, sin token → 401, página bloqueada', async () => {
    const a = app()
    const bridge = a.bridge!
    const withOrigin = await bridge.request('GET', '/health', undefined, { Origin: 'http://evil.example' })
    expect(withOrigin.status).toBe(403)
    const fileOrigin = await bridge.request('POST', '/actions', { actions: [] }, { Origin: 'file://' })
    expect(fileOrigin.status).toBe(403)

    // El token vive en el userData aislado del test (lo lee la CLI local).
    const tokenFile = JSON.parse(fs.readFileSync(path.join(a.userData, 'agent-bridge.json'), 'utf8'))
    expect(tokenFile.port).toBe(bridge.port)

    const noToken = await fetch(`${bridge.base}/state`)
    expect(noToken.status).toBe(401)

    // DNS rebinding: Host distinto de 127.0.0.1/localhost:<puerto> → 403.
    const badHost = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: bridge.port, path: '/health', headers: { Host: `evil.example:${bridge.port}` } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(badHost).toBe(403)

    const r = await pageFetchBridge(a.page, a.bridgePort)
    expect(r.ok).toBe(false)
  })
})
