/**
 * Carriles de acordes y letra en la cabecera del arreglo (K2): la IA escribe acordes y letra por el bridge
 * (`chords.set`, `lyrics.set`), el carril los dibuja (insignias y sílabas), el doble clic edita un acorde
 * con undo real, y la sílaba activa brilla siguiendo el playhead al reproducir.
 */
import { expect, test } from '@playwright/test'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'

const app = setupJasWave({ label: 'carril-acordes-letra', bridge: true })

test('acordes y letra visibles, editables y sincronizados con el playhead', async () => {
  test.setTimeout(180_000)
  const { bridge, page } = app()

  await newProject(bridge!, 'E2E Carriles', page)
  await bridge!.run('project.setBpm', { bpm: 120 })
  await bridge!.run('project.setTimeSignature', { numerador: 4, denominador: 4 })

  // Sin datos no hay carriles.
  await expect(page.getByTestId('carril-acordes')).toHaveCount(0)
  await expect(page.getByTestId('carril-letra')).toHaveCount(0)

  // Hoja de ruta por secciones: acordes + un marcador por sección (un solo comando).
  const set = await bridge!.run('chords.set', {
    secciones: [
      { nombre: 'Verso', compases: 4, acordes: ['Cmaj9', 'Dm7', 'G7', 'C'] },
      { nombre: 'Coro', compases: 2, acordes: ['F', 'G'] },
    ],
  })
  expect(set.data).toMatchObject({ acordes: 6 })
  await bridge!.run('lyrics.set', { texto: 'Santo santo santo\nes el Señor', compasesPorFrase: 2 })

  const carrilAcordes = page.getByTestId('carril-acordes')
  const carrilLetra = page.getByTestId('carril-letra')
  const carrilMarcadores = page.getByTestId('carril-marcadores')
  await expect(carrilAcordes).toBeVisible()
  await expect(carrilLetra).toBeVisible()
  await expect(carrilMarcadores).toBeVisible()

  const insignias = page.getByTestId('acorde-insignia')
  await expect(insignias).toHaveCount(6)
  await expect(insignias.filter({ hasText: 'Cmaj9' })).toHaveCount(1)
  await expect(page.getByTestId('marcador-bandera').filter({ hasText: 'Coro' })).toHaveCount(1)

  // «Santo santo santo» = 6 sílabas, «es el Señor» = 4.
  const silabas = page.getByTestId('letra-silaba')
  await expect(silabas).toHaveCount(10)
  await expect(silabas.first()).toHaveText(/San-?/)

  // Lo que ve la IA coincide con el carril.
  const get = await bridge!.run('chords.get', {})
  expect((get.data as { texto: string }).texto).toBe('| Cmaj9 | Dm7 | G7 | C | F | G |')

  // Doble clic en una insignia → input inline → Enter cambia el acorde (undo real).
  await insignias.filter({ hasText: 'Dm7' }).dblclick()
  const input = page.getByTestId('carril-input')
  await expect(input).toBeVisible()
  await input.fill('Dm9')
  await input.press('Enter')
  await expect(insignias.filter({ hasText: 'Dm9' })).toHaveCount(1)
  await expect.poll(async () => ((await bridge!.run('chords.get', {})).data as { texto: string }).texto).toContain('Dm9')
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.keyboard.press('Control+z')
  await expect(insignias.filter({ hasText: 'Dm7' })).toHaveCount(1)

  // Un acorde no válido se rechaza en el propio input (borde rojo, no se aplica).
  await insignias.filter({ hasText: 'G7' }).dblclick()
  await page.getByTestId('carril-input').fill('Hm')
  await page.getByTestId('carril-input').press('Enter')
  await expect(page.getByTestId('carril-input')).toHaveAttribute('aria-invalid', 'true')
  await page.getByTestId('carril-input').press('Escape')
  await expect(insignias.filter({ hasText: 'G7' })).toHaveCount(1)

  // Menú contextual «Quitar».
  await insignias.filter({ hasText: 'F', hasNotText: 'Cmaj9' }).first().click({ button: 'right' })
  await page.getByTestId('carril-menu').getByRole('button', { name: 'Quitar' }).click()
  await expect(insignias).toHaveCount(5)

  // Plegar / desplegar el carril de letra.
  await page.getByTestId('fila-letra-plegar').click()
  await expect(page.getByTestId('fila-letra')).toHaveAttribute('data-plegado', 'true')
  await expect(page.getByTestId('carril-letra')).toHaveCount(0)
  await page.getByTestId('fila-letra-plegar').click()
  await expect(page.getByTestId('carril-letra')).toBeVisible()

  // Glow: al reproducir, la sílaba activa sigue al playhead.
  await bridge!.run('transport.seek', { segundos: 0 })
  await bridge!.run('transport.toggle', {})
  const activa = page.locator('[data-testid="letra-silaba"][data-activa="true"]')
  await expect(activa).toHaveCount(1, { timeout: 10_000 })
  const primera = await activa.getAttribute('data-indice')
  // Dos compases a 120 BPM = 4 s para 6 sílabas: en 2 s la activa ya es otra.
  await expect.poll(async () => activa.getAttribute('data-indice'), { timeout: 8_000 }).not.toBe(primera)
  await bridge!.run('transport.stop', {})

  // Pegar letra desde la barra de herramientas del arreglo.
  await page.getByTestId('boton-pegar-letra').click()
  await page.getByTestId('textarea-letra').fill('Grande es tu fidelidad\nOh Dios')
  await page.getByTestId('aplicar-letra').click()
  await expect(page.getByTestId('letra-silaba').filter({ hasText: 'Gran' })).toHaveCount(1)
  const letra = await bridge!.run('lyrics.get', {})
  expect((letra.data as { texto: string }).texto).toBe('Grande es tu fidelidad\nOh Dios')
})
