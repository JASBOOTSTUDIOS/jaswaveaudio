/**
 * Escenario 15 (K1/P1): el núcleo encuentra los plugins JasWave por manifiesto, sin nombres fijos.
 * En el build de desarrollo los paquetes salen de plugins/ y los binarios de plugins/build/VST3/Release
 * (compilar antes con `npm run native:plugins`); el host debe poder cargarlos y el agente debe ver
 * sus herramientas. En la app empaquetada sin plugins instalados la lista puede estar vacía.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'

const app = setupJasWave({ label: 'plugins-manifiesto' })

type Paquete = { dir: string; manifiesto: { id?: string; entrypoints?: { dspDesktop?: string } } | null; integridad: string; rutaDsp?: string; errores: string[] }

test('lista los paquetes de plugins con integridad y ruta del binario', async () => {
  const { page, target } = app()
  const paquetes = (await page.evaluate(() => (window as any).electron.pluginsListar?.())) as Paquete[]
  test.skip(target !== 'dev' && paquetes.length === 0, 'app empaquetada sin plugins instalados')
  const ids = paquetes.map((p) => p.manifiesto?.id).sort()
  expect(ids).toEqual(
    expect.arrayContaining([
      'com.jaswave.plugin.bus-compressor',
      'com.jaswave.plugin.param-eq',
      'com.jaswave.plugin.piano-synth',
      'com.jaswave.plugin.roles-vst',
      'com.jaswave.plugin.smart-deesser',
      'com.jaswave.plugin.truepeak-limiter',
      'com.jaswave.plugin.utility-tool',
    ]),
  )
  for (const p of paquetes) {
    expect(p.errores, p.dir).toEqual([])
    expect(p.integridad, p.dir).not.toBe('alterada')
    // Los módulos del DAW (asistente IA, MIDI·MD…) no tienen binario VST3.
    if (p.manifiesto?.entrypoints?.dspDesktop) expect(p.rutaDsp, `${p.dir}: binario VST3 resuelto`).toMatch(/\.vst3$/i)
  }
})

test('el host de plugins carga un VST JasWave resuelto por manifiesto', async () => {
  const { page } = app()
  const r = await page.evaluate(async () => {
    const paquetes = (await (window as any).electron.pluginsListar?.()) as Array<{ manifiesto: { id?: string } | null; rutaDsp?: string }>
    const utility = paquetes.find((p) => p.manifiesto?.id === 'com.jaswave.plugin.utility-tool')
    if (!utility?.rutaDsp) return { omitido: true }
    const host = await (window as any).electron.pluginHostEnsure?.()
    const carga = await (window as any).electron.pluginHostSend?.({ type: 'load', path: utility.rutaDsp })
    return { omitido: false, host, carga }
  })
  test.skip(r.omitido === true, 'utility-tool sin binario compilado')
  expect(r.carga, JSON.stringify(r)).toMatchObject({ ok: true })
})

test('las métricas internas del host (getSlotStats) no son accesibles desde el renderer', async () => {
  const { page } = app()
  const r = await page.evaluate(() => (window as any).electron.pluginHostSend?.({ type: 'getSlotStats' }))
  // Solo el proceso main (vigilancia de plugins) las consulta; el allowlist del renderer las rechaza.
  expect(r).toMatchObject({ ok: false })
  expect(String((r as { error?: string }).error)).toMatch(/no permitido/)
})
