/**
 * Instalación bajo demanda de plugins JasWave (D1).
 *
 * 1. El catálogo llega firmado (`jwc1`) por el backend; se verifica con la clave pública incrustada.
 * 2. Se descarga el zip del paquete y se comprueban tamaño y SHA-256 del catálogo.
 * 3. Se extrae con tar.exe de Windows en una carpeta temporal y se rechaza cualquier entrada fuera de
 *    ella o que no sea archivo/carpeta normal.
 * 4. El bundle VST3 se instala en la carpeta VST3 de usuario (lo encuentra cualquier DAW) y el paquete
 *    (manifiesto + instalacion.json con los hashes de todo, incluido el bundle) en la de paquetes.
 */

import { execFile } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeFileAtomic } from '../atomic-write'
import { rutaDentroDe } from './escaner'

export type EntradaCatalogo = { id: string; nombre: string; version: string; url: string; sha256: string; sizeBytes: number }
export type Catalogo = { generadoEn: string; paquetes: EntradaCatalogo[] }

export type ProgresoInstalacion = {
  id: string
  fase: 'descargando' | 'verificando' | 'instalando' | 'listo' | 'error'
  recibidos?: number
  total?: number
  mensaje?: string
}

/** Verifica `jwc1.<payload>.<firma>` y devuelve el catálogo; lanza si la firma no es válida. */
export function verificarCatalogo(token: string, clavePublicaPem: string): Catalogo {
  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'jwc1') throw new Error('catálogo con formato inválido')
  const [, payload, firma] = partes as [string, string, string]
  const ok = verify(null, Buffer.from(`jwc1.${payload}`), createPublicKey(clavePublicaPem), Buffer.from(firma, 'base64url'))
  if (!ok) throw new Error('la firma del catálogo no es válida')
  const catalogo = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Catalogo
  if (!Array.isArray(catalogo.paquetes)) throw new Error('catálogo sin paquetes')
  return catalogo
}

export async function obtenerCatalogo(apiBase: string, clavePublicaPem: string, f: typeof fetch = fetch): Promise<Catalogo> {
  const r = await f(`${apiBase.replace(/\/+$/, '')}/catalogo`, { cache: 'no-store' })
  if (!r.ok) throw new Error(`el servidor respondió ${r.status} al pedir el catálogo`)
  const cuerpo = (await r.json()) as { token?: unknown }
  if (typeof cuerpo.token !== 'string') throw new Error('respuesta de catálogo sin firma')
  return verificarCatalogo(cuerpo.token, clavePublicaPem)
}

/** Descarga con progreso y límite de tamaño (el del catálogo). */
export async function descargar(
  url: string,
  tamanoEsperado: number,
  alProgreso: (recibidos: number) => void,
  f: typeof fetch = fetch,
): Promise<Buffer> {
  const r = await f(url)
  if (!r.ok || !r.body) throw new Error(`descarga fallida (${r.status})`)
  const trozos: Buffer[] = []
  let recibidos = 0
  const lector = r.body.getReader()
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    recibidos += value.byteLength
    if (recibidos > tamanoEsperado) {
      await lector.cancel()
      throw new Error('el paquete descargado es mayor que el anunciado')
    }
    trozos.push(Buffer.from(value))
    alProgreso(recibidos)
  }
  return Buffer.concat(trozos)
}

function ejecutar(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 120_000 }, (err, _out, errOut) => {
      if (err) reject(new Error(`${path.basename(cmd)} falló: ${String(errOut || err.message).slice(0, 300)}`))
      else resolve()
    })
  })
}

/** Recorre `dir` y devuelve rutas relativas de archivos; rechaza enlaces y rutas fuera de `dir`. */
export async function listarArchivosSeguros(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name)
    const rel = path.relative(base, ruta)
    if (!rutaDentroDe(base, rel)) throw new Error(`entrada fuera del paquete: ${rel}`)
    if (e.isSymbolicLink()) throw new Error(`el paquete contiene un enlace: ${rel}`)
    if (e.isDirectory()) out.push(...(await listarArchivosSeguros(ruta, base)))
    else if (e.isFile()) out.push(rel.split(path.sep).join('/'))
    else throw new Error(`entrada no permitida: ${rel}`)
  }
  return out
}

const sha256 = (datos: Buffer) => createHash('sha256').update(datos).digest('hex')

async function hashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const rel of await listarArchivosSeguros(dir)) out[rel] = sha256(await fs.readFile(path.join(dir, rel)))
  return out
}

async function copiarDirectorio(origen: string, destino: string): Promise<void> {
  await fs.mkdir(destino, { recursive: true })
  for (const e of await fs.readdir(origen, { withFileTypes: true })) {
    const a = path.join(origen, e.name)
    const b = path.join(destino, e.name)
    if (e.isDirectory()) await copiarDirectorio(a, b)
    else await fs.copyFile(a, b)
  }
}

export type OpcionesInstalacion = {
  /** %LOCALAPPDATA%\JasWave\plugins */
  carpetaPaquetes: string
  /** %LOCALAPPDATA%\Programs\Common\VST3\JasWave */
  carpetaVst3: string
  alProgreso: (p: ProgresoInstalacion) => void
  fetch?: typeof fetch
  tar?: string
}

/** Instala (o actualiza) un paquete del catálogo verificado. Devuelve la ruta del bundle instalado. */
export async function instalarPaquete(entrada: EntradaCatalogo, o: OpcionesInstalacion): Promise<string> {
  if (!/^[a-z0-9]+(\.[a-z0-9-]+){2,}$/.test(entrada.id)) throw new Error('id de paquete inválido')
  const tar = o.tar ?? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-instalar-'))
  try {
    o.alProgreso({ id: entrada.id, fase: 'descargando', recibidos: 0, total: entrada.sizeBytes })
    const zip = await descargar(entrada.url, entrada.sizeBytes, (n) => o.alProgreso({ id: entrada.id, fase: 'descargando', recibidos: n, total: entrada.sizeBytes }), o.fetch)

    o.alProgreso({ id: entrada.id, fase: 'verificando' })
    if (zip.length !== entrada.sizeBytes) throw new Error('el tamaño del paquete no coincide con el catálogo')
    if (sha256(zip) !== entrada.sha256) throw new Error('el SHA-256 del paquete no coincide con el catálogo')
    const rutaZip = path.join(temporal, 'paquete.zip')
    await fs.writeFile(rutaZip, zip)
    const extraido = path.join(temporal, 'x')
    await fs.mkdir(extraido)
    await ejecutar(tar, ['-x', '-f', rutaZip, '-C', extraido])
    await listarArchivosSeguros(extraido)

    const manifiesto = JSON.parse(await fs.readFile(path.join(extraido, 'jaswave-plugin.json'), 'utf8')) as {
      id?: unknown
      version?: unknown
      entrypoints?: { dspDesktop?: unknown; ui?: unknown }
    }
    if (manifiesto.id !== entrada.id || manifiesto.version !== entrada.version) throw new Error('el manifiesto no corresponde al catálogo')
    const entradaDsp = manifiesto.entrypoints?.dspDesktop
    // Módulo del DAW (M3): sin VST3; su código va en dist/ dentro del paquete.
    const esModulo = typeof manifiesto.entrypoints?.ui === 'string'
    if (esModulo && typeof entradaDsp !== 'string') {
      const ui = String(manifiesto.entrypoints!.ui)
      if (!ui.startsWith('dist/') || !rutaDentroDe(extraido, ui)) throw new Error('el módulo debe tener su código en dist/')
      await fs.stat(path.join(extraido, ui))
      o.alProgreso({ id: entrada.id, fase: 'instalando' })
      const dirPaquete = path.join(o.carpetaPaquetes, entrada.id)
      await fs.mkdir(dirPaquete, { recursive: true })
      // dist/ se intercambia entero: nunca quedan archivos de dos versiones mezclados.
      const destinoDist = path.join(dirPaquete, 'dist')
      const nuevoDist = `${destinoDist}.nuevo-${process.pid}`
      const viejoDist = `${destinoDist}.viejo-${process.pid}`
      await fs.rm(nuevoDist, { recursive: true, force: true })
      await copiarDirectorio(path.join(extraido, 'dist'), nuevoDist)
      await fs.rename(destinoDist, viejoDist).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
      })
      await fs.rename(nuevoDist, destinoDist)
      await fs.rm(viejoDist, { recursive: true, force: true })
      const textoManifiesto = await fs.readFile(path.join(extraido, 'jaswave-plugin.json'))
      await writeFileAtomic(path.join(dirPaquete, 'jaswave-plugin.json'), textoManifiesto)
      const archivos: Record<string, string> = { 'jaswave-plugin.json': sha256(textoManifiesto) }
      for (const [rel, h] of Object.entries(await hashes(destinoDist))) archivos[`dist/${rel}`] = h
      await writeFileAtomic(
        path.join(dirPaquete, 'instalacion.json'),
        JSON.stringify({ version: entrada.version, instaladoEn: new Date().toISOString(), archivos }, null, 2),
      )
      o.alProgreso({ id: entrada.id, fase: 'listo' })
      return dirPaquete
    }
    const bundle = typeof entradaDsp === 'string' ? path.basename(entradaDsp) : ''
    if (!/^[A-Za-z0-9 ._&()-]+\.vst3$/i.test(bundle)) throw new Error('el paquete no declara un bundle VST3 válido')
    const origenBundle = path.join(extraido, 'vst3', bundle)
    await fs.stat(origenBundle)

    o.alProgreso({ id: entrada.id, fase: 'instalando' })
    // Bundle: se copia junto al destino y se intercambia (si el DAW lo tiene cargado, Windows lo bloquea).
    await fs.mkdir(o.carpetaVst3, { recursive: true })
    const destinoBundle = path.join(o.carpetaVst3, bundle)
    const nuevo = `${destinoBundle}.nuevo-${process.pid}`
    await fs.rm(nuevo, { recursive: true, force: true })
    await copiarDirectorio(origenBundle, nuevo)
    const viejo = `${destinoBundle}.viejo-${process.pid}`
    try {
      await fs.rename(destinoBundle, viejo).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
      })
      await fs.rename(nuevo, destinoBundle)
    } catch (e) {
      await fs.rm(nuevo, { recursive: true, force: true })
      throw new Error(`no se pudo reemplazar ${bundle} (¿está cargado en un DAW?): ${(e as Error).message}`)
    }
    await fs.rm(viejo, { recursive: true, force: true })

    // Paquete: manifiesto + registro de integridad (incluye los archivos del bundle instalado).
    const dirPaquete = path.join(o.carpetaPaquetes, entrada.id)
    await fs.mkdir(dirPaquete, { recursive: true })
    const textoManifiesto = await fs.readFile(path.join(extraido, 'jaswave-plugin.json'))
    await writeFileAtomic(path.join(dirPaquete, 'jaswave-plugin.json'), textoManifiesto)
    const registro = {
      version: entrada.version,
      instaladoEn: new Date().toISOString(),
      archivos: { 'jaswave-plugin.json': sha256(textoManifiesto) },
      vst3: { bundle, archivos: await hashes(destinoBundle) },
    }
    await writeFileAtomic(path.join(dirPaquete, 'instalacion.json'), JSON.stringify(registro, null, 2))
    o.alProgreso({ id: entrada.id, fase: 'listo' })
    return destinoBundle
  } catch (e) {
    o.alProgreso({ id: entrada.id, fase: 'error', mensaje: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    await fs.rm(temporal, { recursive: true, force: true })
  }
}
