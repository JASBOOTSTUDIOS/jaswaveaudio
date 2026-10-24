/**
 * Escenario 18 (X1): extensiones `.jwx` instaladas desde archivo, como los `.vsix` de VS Code.
 * - Un .jwx firmado se inspecciona, se confirma, se instala y su módulo se carga sin reiniciar.
 * - Uno sin firma se bloquea; con el Modo desarrollador se instala marcado «sin firmar».
 * - Abrir un .jwx con «doble clic» (segunda instancia con la ruta en argv) muestra la confirmación.
 * - Desinstalar lo quita del disco y del DAW.
 * Usa un LOCALAPPDATA temporal (no toca las instalaciones del usuario) y una clave de pruebas que solo
 * acepta el build de desarrollo (JASWAVE_PRUEBAS_CLAVE_PUBLICA).
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { firmarPaquete } from '../electron/plugins/firma-paquete'
import { resolveExecutable, waitFor } from './fixtures/app'
import { setupJasWave } from './fixtures/harness'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privada = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-e2e-jwx-'))
const localAppData = path.join(raiz, 'local')
fs.mkdirSync(localAppData, { recursive: true })

const app = setupJasWave({
  label: 'extensiones-jwx',
  env: { LOCALAPPDATA: localAppData, JASWAVE_PRUEBAS_CLAVE_PUBLICA: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
})
test.afterAll(() => fs.rmSync(raiz, { recursive: true, force: true }))

const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** Módulo mínimo real (SDK v1) con una herramienta que pinta un texto. */
function crearJwx(id: string, nombre: string, firmar: boolean): string {
  const dir = path.join(raiz, `${id}-src`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
  const herramienta = `${id.split('.').pop()}-panel`
  const archivos: Record<string, Buffer> = {
    'jaswave-plugin.json': Buffer.from(
      JSON.stringify({
        id,
        name: nombre,
        version: '1.0.0',
        vendor: 'JasWave E2E',
        category: 'ui-extension',
        description: `Módulo de prueba ${nombre}`,
        targetPlatforms: ['win-x64'],
        entrypoints: { ui: 'dist/modulo.js' },
        permissions: { realtimeAudio: false, fileSystem: 'none', network: false, commands: [] },
        rolesAllowed: ['productor'],
      }),
    ),
    'dist/modulo.js': Buffer.from(
      `const R = globalThis.__JASWAVE_SDK__.react
export default {
  id: ${JSON.stringify(id)}, sdk: 1,
  herramientas: [{ id: ${JSON.stringify(herramienta)}, titulo: ${JSON.stringify(nombre)}, descripcion: 'prueba', zona: 'right', bajoDemanda: true }],
  activar() { return { paneles: { ${JSON.stringify(herramienta)}: () => R.createElement('div', { 'data-testid': ${JSON.stringify(herramienta)} }, 'Hola desde un .jwx') } } },
}
`,
    ),
  }
  for (const [rel, c] of Object.entries(archivos)) fs.writeFileSync(path.join(dir, rel), c)
  if (firmar) {
    const f = firmarPaquete(id, '1.0.0', Object.fromEntries(Object.entries(archivos).map(([k, v]) => [k, sha(v)])), privada)
    fs.writeFileSync(path.join(dir, 'jaswave-firma.json'), JSON.stringify(f))
  }
  const zip = path.join(raiz, `${id}-1.0.0.zip`)
  execFileSync(tar, ['-a', '-c', '-f', zip, '-C', dir, ...fs.readdirSync(dir)], { windowsHide: true })
  const jwx = zip.replace(/\.zip$/, '.jwx')
  fs.renameSync(zip, jwx)
  return jwx
}

async function abrir(page: Page, toolId: string, visible: Locator): Promise<void> {
  await expect(async () => {
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent('jaswave-open-tool', { detail: { toolId: id } })), toolId)
    await expect(visible).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}
const pedirInstalacion = (page: Page, ruta: string) =>
  page.evaluate((r) => window.dispatchEvent(new CustomEvent('jaswave-instalar-jwx', { detail: { ruta: r } })), ruta)

test('un .jwx firmado se instala desde archivo y su módulo se carga sin reiniciar', async () => {
  test.skip(process.platform !== 'win32', 'paquetes .jwx: Windows')
  const { page, target } = app()
  test.skip(target !== 'dev', 'la clave de pruebas solo la acepta el build de desarrollo')
  const jwx = crearJwx('com.jaswave.modulo.e2e-hola', 'Hola E2E', true)
  const panel = page.getByTestId('panel-modulos')
  await abrir(page, 'modulos', panel)

  await pedirInstalacion(page, jwx)
  const dialogo = page.getByTestId('dialogo-instalar-jwx')
  await expect(dialogo).toContainText('Hola E2E')
  await expect(dialogo.getByTestId('jwx-firma')).toHaveText(/Firmado por JasWave/)
  await dialogo.getByRole('button', { name: 'Instalar', exact: true }).click()
  await expect(dialogo.getByTestId('jwx-instalado')).toBeVisible({ timeout: 30_000 })
  await dialogo.getByRole('button', { name: 'Aceptar' }).click()

  // Instalado en la carpeta de usuario (temporal) con su registro de integridad y origen
  const registro = JSON.parse(fs.readFileSync(path.join(localAppData, 'JasWave', 'plugins', 'com.jaswave.modulo.e2e-hola', 'instalacion.json'), 'utf8'))
  expect(registro.origen).toBe('archivo-firmado')
  const lista = page.getByTestId('extensiones-instaladas')
  await expect(lista.locator('[data-extension="com.jaswave.modulo.e2e-hola"]')).toContainText('Archivo firmado')
  // El módulo se cargó en caliente y aporta su herramienta
  await expect(panel).toContainText('Hola E2E')
  await abrir(page, 'e2e-hola-panel', page.getByTestId('e2e-hola-panel'))
  await expect(page.getByTestId('e2e-hola-panel')).toHaveText('Hola desde un .jwx')
})

test('sin firma: bloqueado; con el Modo desarrollador se instala marcado como sin firmar', async () => {
  const { page, userData, target } = app()
  test.skip(process.platform !== 'win32' || target !== 'dev', 'solo desarrollo en Windows')
  const jwx = crearJwx('com.jaswave.modulo.e2e-sinfirma', 'Sin firma E2E', false)
  const dialogo = page.getByTestId('dialogo-instalar-jwx')

  await pedirInstalacion(page, jwx)
  await expect(dialogo.getByTestId('jwx-firma')).toHaveText(/Sin firmar/)
  await expect(dialogo.getByTestId('jwx-bloqueado')).toBeVisible()
  await expect(dialogo.getByRole('button', { name: /Instalar/ })).toHaveCount(0)
  await dialogo.getByRole('button', { name: 'Cancelar' }).click()
  expect(fs.existsSync(path.join(localAppData, 'JasWave', 'plugins', 'com.jaswave.modulo.e2e-sinfirma'))).toBe(false)

  // El usuario activó el Modo desarrollador (en la app lo confirma un diálogo nativo de main)
  const ajustes = path.join(userData, 'jaswave-settings.json')
  const previos = fs.existsSync(ajustes) ? JSON.parse(fs.readFileSync(ajustes, 'utf8')) : {}
  fs.writeFileSync(ajustes, JSON.stringify({ ...previos, modoDesarrollador: true }))
  await pedirInstalacion(page, jwx)
  await dialogo.getByRole('button', { name: 'Instalar sin firma' }).click()
  await expect(dialogo.getByTestId('jwx-instalado')).toBeVisible({ timeout: 30_000 })
  await dialogo.getByRole('button', { name: 'Aceptar' }).click()
  await abrir(page, 'modulos', page.getByTestId('panel-modulos'))
  await expect(page.getByTestId('extensiones-instaladas').locator('[data-extension="com.jaswave.modulo.e2e-sinfirma"]')).toContainText('Sin firmar')
})

test('abrir un .jwx con doble clic (segunda instancia) muestra la confirmación en el DAW', async () => {
  const { page, userData, target } = app()
  test.skip(process.platform !== 'win32' || target !== 'dev', 'solo desarrollo en Windows')
  const jwx = crearJwx('com.jaswave.modulo.e2e-dobleclic', 'Doble clic E2E', true)
  const { exe, args, cwd } = resolveExecutable(target)
  const segunda = spawn(exe, [...args, `--user-data-dir=${userData}`, jwx], { cwd, env: { ...process.env, LOCALAPPDATA: localAppData }, stdio: 'ignore' })
  try {
    const dialogo = page.getByTestId('dialogo-instalar-jwx')
    await expect(dialogo).toContainText('Doble clic E2E', { timeout: 60_000 })
    await expect(dialogo.getByTestId('jwx-firma')).toHaveText(/Firmado por JasWave/)
    await dialogo.getByRole('button', { name: 'Cancelar' }).click()
    // No se instaló nada sin confirmar
    expect(fs.existsSync(path.join(localAppData, 'JasWave', 'plugins', 'com.jaswave.modulo.e2e-dobleclic'))).toBe(false)
    await waitFor('segunda instancia cerrada', async () => segunda.exitCode !== null, 30_000)
  } finally {
    if (segunda.exitCode === null) segunda.kill()
  }
})

test('desinstalar quita la extensión del disco y del DAW', async () => {
  const { page, target } = app()
  test.skip(process.platform !== 'win32' || target !== 'dev', 'solo desarrollo en Windows')
  await abrir(page, 'modulos', page.getByTestId('panel-modulos'))
  const item = page.getByTestId('extensiones-instaladas').locator('[data-extension="com.jaswave.modulo.e2e-hola"]')
  await item.getByRole('button', { name: /Desinstalar/ }).click()
  await page.getByRole('button', { name: 'Desinstalar', exact: true }).click()
  await expect(item).toHaveCount(0, { timeout: 30_000 })
  expect(fs.existsSync(path.join(localAppData, 'JasWave', 'plugins', 'com.jaswave.modulo.e2e-hola'))).toBe(false)
  await expect(page.getByTestId('panel-modulos')).not.toContainText('Hola E2E')
})
