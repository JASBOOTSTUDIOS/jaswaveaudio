/**
 * Botones del transporte «Escuchar lo que hace la IA» y «Ver lo que toca la IA»: cada uno se apaga y se
 * enciende por separado, se recuerda y, con «Ver» apagado, los controles que toca la IA no se iluminan.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { createMidiTrackWithClip, newProject } from './fixtures/project'
import { crearPasos } from './fixtures/pasos'

const app = setupJasWave({ label: 'transporte-seguir-ia', bridge: true })
const paso = crearPasos(() => app().page, '30-transporte-ia')

test('escuchar y ver a la IA se controlan desde el transporte', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Seguir IA')
  const { trackId } = await createMidiTrackWithClip(bridge!, 'E2E Seguida')

  const grupo = page.getByTestId('transporte-ia')
  await expect(grupo).toBeVisible({ timeout: 30_000 })
  const escuchar = grupo.getByRole('button', { name: 'Escuchar lo que hace la IA' })
  const ver = grupo.getByRole('button', { name: 'Ver lo que toca la IA' })
  await expect(escuchar).toHaveAttribute('aria-pressed', 'true')
  await expect(ver).toHaveAttribute('aria-pressed', 'true')

  const tocar = () => page.evaluate((id) => window.dispatchEvent(new CustomEvent('jaswave-ia-toca', { detail: { trackId: id, campos: ['volumen', 'notas'] } })), trackId)
  const brillos = page.locator('[data-ia-resaltado="si"]')

  // Escuchar apagado: solo cambia la escucha (ver sigue encendido y se recuerda).
  await escuchar.click()
  await expect(escuchar).toHaveAttribute('aria-pressed', 'false')
  await expect(ver).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('jaswave.ia.escuchar'))).toBe('no')
  await tocar()
  await expect(brillos.first()).toBeVisible({ timeout: 2_000 })

  // Ver apagado: nada se ilumina.
  await expect(brillos).toHaveCount(0, { timeout: 4_000 })
  await ver.click()
  await expect(ver).toHaveAttribute('aria-pressed', 'false')
  await tocar()
  await page.waitForTimeout(300)
  await expect(brillos).toHaveCount(0)

  // Se vuelven a encender.
  await ver.click()
  await escuchar.click()
  await expect(ver).toHaveAttribute('aria-pressed', 'true')
  await expect(escuchar).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('jaswave.ia.escuchar'))).not.toBe('no')
  await tocar()
  await expect(brillos.first()).toBeVisible({ timeout: 2_000 })
})

test('la monitorización silencia la salida sin tocar el master y avisa cuando la IA trabaja en silencio', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Monitor')
  const monitor = page.getByTestId('monitor-salida')
  await expect(monitor).toBeVisible({ timeout: 30_000 })
  const mute = monitor.getByRole('button', { name: /salida a los altavoces/ })
  const volumen = page.getByTestId('monitor-volumen')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  await expect(volumen).toHaveValue('100')

  // El volumen del monitor no cambia el master del proyecto.
  const leerMaster = async () => JSON.stringify(((await bridge!.state()) as { master?: unknown }).master ?? null)
  const masterAntes = await leerMaster()
  await volumen.fill('30')
  await expect(volumen).toHaveValue('30')
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('jaswave.monitor') ?? '{}'))).toMatchObject({ volumen: 0.3 })
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('jaswave.monitor') ?? '{}'))).toMatchObject({ silenciado: true })
  expect(await leerMaster()).toBe(masterAntes)
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'false')

  // La IA trabaja sin sacar audio: marca «IA» en el altavoz; al terminar desaparece.
  const marca = page.getByTestId('monitor-silencio-ia')
  await expect(marca).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-monitor-ia', { detail: { silencio: true } })))
  await expect(marca).toBeVisible({ timeout: 2_000 })
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('jaswave-monitor-ia', { detail: { silencio: false } })))
  await expect(marca).toHaveCount(0, { timeout: 2_000 })
  await volumen.fill('100')
})

test('el medidor del monitor muestra en tiempo real la señal del master', async () => {
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Monitor señal')
  const medidor = page.getByTestId('monitor-medidor')
  await expect(medidor).toBeVisible({ timeout: 30_000 })
  const niveles = () => medidor.locator('[data-nivel]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-nivel')) || 0))
  await expect.poll(niveles).toEqual([0, 0])
  await paso('monitor en reposo')

  // Metrónomo y play: el clic pasa por el master, así que las barras L/R deben moverse con la señal real.
  await page.getByTitle('Metrónomo inactivo').click()
  await bridge!.run('transport.toggle', {})
  await expect.poll(async () => Math.max(...(await niveles())), { timeout: 10_000, message: 'el medidor debe subir con el metrónomo sonando' }).toBeGreaterThan(5)
  await paso('monitor con señal del metrónomo')
  // Con la salida silenciada el master sigue midiendo señal: eso es exactamente lo que se quiere ver.
  await page.getByTestId('monitor-salida').getByRole('button', { name: /salida a los altavoces/ }).click()
  await expect.poll(async () => Math.max(...(await niveles())), { timeout: 10_000 }).toBeGreaterThan(5)
  await paso('salida en silencio con señal en el master')
  await page.getByTestId('monitor-salida').getByRole('button', { name: /salida a los altavoces/ }).click()
  // Con señal hay marca de pico retenido (la rayita que cae despacio).
  await expect(medidor.locator('[aria-hidden]').first()).toBeVisible({ timeout: 5_000 })
  await bridge!.run('transport.stop', {})
  await page.getByTitle('Metrónomo activo').click()
  await expect.poll(niveles, { timeout: 10_000 }).toEqual([0, 0])
  // En reposo la marca de pico termina de caer y desaparece (antes se quedaba congelada a media barra).
  await expect(medidor.locator('[aria-hidden]')).toHaveCount(0, { timeout: 10_000 })
})
