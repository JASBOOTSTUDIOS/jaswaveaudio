/**
 * Escenario 10: media del proyecto (U4).
 *
 * El audio importado vive dentro de `<proyecto>/media/` con ruta RELATIVA:
 * el proyecto se puede mover de carpeta (y de equipo) sin perder los clips.
 *
 * El diálogo nativo no se automatiza: la ruta se fija con `project.update { datos: { ruta } }`
 * (el bridge autenticado concede su carpeta para la sesión) y se guarda con `project.save`.
 * "Guardar como" se simula copiando el árbol `media/` y el `.jaswave`, que es exactamente
 * lo que hace `copiarMediaEntreProyectos` + `project.save`.
 */
import { expect, test } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { findTrack, newProject } from './fixtures/project'

const app = setupJasWave({ label: 'media', bridge: true })

/** WAV PCM 16 bits mono de 0,5 s (silencio). */
function wavSilencio(): Buffer {
  const muestras = 22050
  const datos = Buffer.alloc(muestras * 2)
  const cab = Buffer.alloc(44)
  cab.write('RIFF', 0, 'ascii')
  cab.writeUInt32LE(36 + datos.length, 4)
  cab.write('WAVE', 8, 'ascii')
  cab.write('fmt ', 12, 'ascii')
  cab.writeUInt32LE(16, 16)
  cab.writeUInt16LE(1, 20)
  cab.writeUInt16LE(1, 22)
  cab.writeUInt32LE(44100, 24)
  cab.writeUInt32LE(44100 * 2, 28)
  cab.writeUInt16LE(2, 32)
  cab.writeUInt16LE(16, 34)
  cab.write('data', 36, 'ascii')
  cab.writeUInt32LE(datos.length, 40)
  return Buffer.concat([cab, datos])
}

function copiarArbol(origen: string, destino: string): void {
  fs.mkdirSync(destino, { recursive: true })
  for (const entrada of fs.readdirSync(origen, { withFileTypes: true })) {
    const o = path.join(origen, entrada.name)
    const d = path.join(destino, entrada.name)
    if (entrada.isDirectory()) copiarArbol(o, d)
    else fs.copyFileSync(o, d)
  }
}

test('el audio importado viaja con el proyecto: guardar en A, "Guardar como" en B y borrar A', async () => {
  const { bridge, workDir, page } = app()
  const carpetaA = path.join(workDir, 'carpeta-A')
  const carpetaB = path.join(workDir, 'carpeta-B')
  fs.mkdirSync(path.join(carpetaA, 'media'), { recursive: true })

  const rutaA = path.join(carpetaA, 'e2e-media.jaswave')
  const rutaB = path.join(carpetaB, 'e2e-media.jaswave')

  await newProject(bridge!, 'E2E Media')
  await bridge!.run('project.update', { datos: { ruta: rutaA } })

  // El archivo importado vive en `<proyecto>/media/` (lo copia la app al importar).
  fs.writeFileSync(path.join(carpetaA, 'media', 'intro.wav'), wavSilencio())

  await bridge!.run('track.create', { nombre: 'E2E Audio', tipo: 'audio' })
  const pista = await (async () => {
    for (let i = 0; i < 40; i++) {
      const t = await findTrack(bridge!, 'E2E Audio')
      if (t) return t
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('La pista de audio no se creó')
  })()

  await bridge!.run('clip.create', {
    pistaId: pista.id,
    nombre: 'Intro',
    inicio: 0,
    duracion: 4,
    sourceId: 'media/intro.wav',
  })

  await bridge!.run('project.save', {})
  await expect.poll(() => fs.existsSync(rutaA), { message: 'existe el .jaswave en A' }).toBe(true)

  // El proyecto guarda la ruta RELATIVA y la referencia de audio.
  const guardado = JSON.parse(fs.readFileSync(rutaA, 'utf8'))
  expect(JSON.stringify(guardado)).toContain('media/intro.wav')

  // "Guardar como" en B: se copia el árbol media/ y el proyecto.
  copiarArbol(carpetaA, carpetaB)
  expect(fs.existsSync(path.join(carpetaB, 'media', 'intro.wav'))).toBe(true)

  // Se borra A: el proyecto de B ya no puede depender de ella.
  fs.rmSync(carpetaA, { recursive: true, force: true })

  await bridge!.run('project.load', { ruta: rutaB })

  // El clip conserva la ruta relativa y no hay media faltante (el archivo está en B).
  const clip = (await findTrack(bridge!, 'E2E Audio'))?.clips?.[0]
  expect(clip).toBeTruthy()
  const estado = await bridge!.state()
  const fuente = (estado.tracks ?? [])
    .flatMap((t: any) => t.clips ?? [])
    .find((c: any) => c.id === clip!.id)
  expect(fuente?.sourceRuta).toBe('media/intro.wav')
  await expect(page.getByText('Media faltante', { exact: false }).first()).toBeHidden({ timeout: 5_000 })
})

test('al abrir un proyecto sin el audio aparece el diálogo "Media faltante"', async () => {
  const { bridge, workDir, page } = app()
  const carpeta = path.join(workDir, 'carpeta-sin-media')
  fs.mkdirSync(path.join(carpeta, 'media'), { recursive: true })
  const ruta = path.join(carpeta, 'e2e-sin-media.jaswave')

  await newProject(bridge!, 'E2E Sin media')
  await bridge!.run('project.update', { datos: { ruta } })
  await bridge!.run('track.create', { nombre: 'E2E Audio 2', tipo: 'audio' })
  const pista = await (async () => {
    for (let i = 0; i < 40; i++) {
      const t = await findTrack(bridge!, 'E2E Audio 2')
      if (t) return t
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('La pista de audio no se creó')
  })()
  await bridge!.run('clip.create', {
    pistaId: pista.id,
    nombre: 'Intro',
    inicio: 0,
    duracion: 4,
    sourceId: 'media/ausente.wav',
  })
  await bridge!.run('project.save', {})

  await bridge!.run('project.load', { ruta })
  await expect(page.getByText('Media faltante', { exact: false }).first()).toBeVisible({ timeout: 30_000 })
})
