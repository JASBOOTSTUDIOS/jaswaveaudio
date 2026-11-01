/**
 * Al seleccionar una pista en el Arrange, su tira del Mixer se desplaza hasta verse (y al revés),
 * aunque estuviera oculta por el scroll.
 */
import { expect, test, type Locator } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { findTrack, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'revela-contraparte', bridge: true })

/** true si el elemento se ve entero dentro de su contenedor con scroll `scroller`. */
async function visibleEn(el: Locator, scroller: Locator): Promise<boolean> {
  const [r, s] = await Promise.all([el.boundingBox(), scroller.boundingBox()])
  if (!r || !s) return false
  return r.x >= s.x - 1 && r.x + r.width <= s.x + s.width + 1 && r.y >= s.y - 1 && r.y + r.height <= s.y + s.height + 1
}

test('seleccionar en un panel revela la contraparte en el otro', async () => {
  test.setTimeout(180_000)
  const { bridge, page } = app()
  await newProject(bridge!, 'E2E Revela', page)
  const N = 14
  for (let i = 0; i < N; i++) await bridge!.run('track.create', { nombre: `R${String(i).padStart(2, '0')}`, tipo: 'midi' })
  const primera = await findTrack(bridge!, 'R00')
  const ultima = await findTrack(bridge!, `R${N - 1}`)
  expect(primera && ultima).toBeTruthy()

  const scrollerArrange = page.getByTestId(`arrange-track-header-${primera!.id}`).locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
  const scrollerMixer = page.getByTestId(`mixer-strip-${primera!.id}`).locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]')
  await expect(page.getByTestId(`mixer-strip-${ultima!.id}`)).toBeAttached({ timeout: 30_000 })

  // Mixer → Arrange: el Arrange está arriba del todo; se elige la última tira en el mixer.
  await scrollerArrange.evaluate((el) => el.scrollTo({ top: 0 }))
  const tiraUltima = page.getByTestId(`mixer-strip-${ultima!.id}`)
  await tiraUltima.scrollIntoViewIfNeeded()
  await tiraUltima.locator('p').first().click()
  await expect
    .poll(() => visibleEn(page.getByTestId(`arrange-track-header-${ultima!.id}`), scrollerArrange), { timeout: 5_000 })
    .toBe(true)

  // Arrange → Mixer: el mixer se lleva al final; se elige la primera pista en el Arrange.
  await scrollerMixer.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await scrollerArrange.evaluate((el) => el.scrollTo({ top: 0 }))
  await page.getByTestId(`arrange-track-header-${primera!.id}`).click()
  await expect
    .poll(() => visibleEn(page.getByTestId(`mixer-strip-${primera!.id}`), scrollerMixer), { timeout: 5_000 })
    .toBe(true)
})
