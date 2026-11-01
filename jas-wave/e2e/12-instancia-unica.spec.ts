/**
 * Escenario 12 (U7): instancia única y apertura de proyectos.
 *
 * Al lanzar una segunda JasWave con un `.jaswave`, la segunda instancia se cierra
 * y la principal abre el proyecto (sin abrir otra ventana).
 */
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { setupJasWave } from './fixtures/harness'
import { newProject } from './fixtures/project'
import { launchTarget, resolveExecutable, sleep } from './fixtures/app'

const app = setupJasWave({ label: 'u7', bridge: true })

test('la segunda instancia cede el foco y la principal abre el proyecto', async () => {
  const { bridge, browser, userData, workDir } = app()

  // Un proyecto guardado en disco, con nombre reconocible.
  const projDir = path.join(workDir, 'proyectos')
  fs.mkdirSync(projDir, { recursive: true })
  const ruta = path.join(projDir, 'segunda.jaswave')

  await newProject(bridge!, 'Proyecto Para La Segunda')
  await bridge!.run('project.setBpm', { bpm: 111 })
  await bridge!.run('project.update', { datos: { ruta } })
  await bridge!.run('project.save', {})
  await expect.poll(() => fs.existsSync(ruta), { message: 'existe el .jaswave' }).toBe(true)

  // Proyecto limpio en la principal: no hay nada que confirmar.
  await newProject(bridge!, 'Proyecto Actual')
  const paginasAntes = browser.contexts().flatMap((c) => c.pages()).length

  // Segunda instancia: mismo userData (mismo lock) y el proyecto en los argumentos.
  const { exe, args, cwd } = resolveExecutable(launchTarget())
  const salida = await new Promise<string>((resolve) => {
    let out = ''
    const proc = spawn(exe, [...args, `--user-data-dir=${userData}`, ruta], {
      cwd,
      env: { ...process.env, JASWAVE_AGENT_BRIDGE: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    })
    const append = (d: Buffer) => {
      out = (out + d.toString()).slice(-20_000)
    }
    proc.stdout?.on('data', append)
    proc.stderr?.on('data', append)
    const timer = setTimeout(() => {
      proc.kill()
      resolve(out + '\n[timeout: la segunda instancia no terminó]')
    }, 60_000)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      resolve(out + `\n[código de salida: ${code}]`)
    })
  })

  // La segunda instancia se cierra por sí sola (cede el foco).
  expect(salida, 'la segunda instancia termina sola').toContain('[código de salida: 0]')

  // La principal recibe el evento "second-instance" (queda en su log).
  const logFile = path.join(userData, 'logs', 'jaswave.log')
  await expect
    .poll(
      () => {
        try {
          return fs.readFileSync(logFile, 'utf8')
        } catch {
          return ''
        }
      },
      { timeout: 30_000, message: 'la principal registra la segunda instancia' },
    )
    .toContain('Segunda instancia detectada')

  // La principal abre el proyecto recibido.
  await expect
    .poll(async () => (await bridge!.state()).nombre, { timeout: 60_000, message: salida.slice(-500) })
    .toBe('Proyecto Para La Segunda')

  // No se abre ninguna ventana nueva.
  await sleep(1000)
  const paginasDespues = browser.contexts().flatMap((c) => c.pages()).length
  expect(paginasDespues, 'no se abre una segunda ventana').toBe(paginasAntes)
})
