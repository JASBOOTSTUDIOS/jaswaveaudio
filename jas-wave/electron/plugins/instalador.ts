/**
 * Instalación de plugins y módulos JasWave (D1 + X1).
 *
 * Dos orígenes, una sola instalación (`instalarDesdeZip`):
 *  - Catálogo: llega firmado (`jwc1`) por el backend; el zip descargado debe coincidir en tamaño y
 *    SHA-256 con la entrada del catálogo.
 *  - Archivo `.jwx` (como un `.vsix` de VS Code): doble clic, arrastrar o «Instalar desde archivo…».
 *    Con firma de JasWave válida (`jaswave-firma.json`) se instala sin más; sin firma solo con el
 *    «Modo desarrollador» activo y confirmación, y queda marcado como `desarrollo`.
 *
 * En ambos casos: tamaño máximo, listado previo con `tar -t` (rutas absolutas, `..` o demasiadas
 * entradas se rechazan antes de extraer), extracción en una carpeta temporal, rechazo de enlaces y de
 * cualquier entrada fuera de ella, e intercambio atómico de lo instalado. El bundle VST3 va a la carpeta
 * VST3 de usuario (lo encuentra cualquier DAW) y el paquete (manifiesto + instalacion.json con los
 * hashes de todo, incluido el bundle, y el origen) a la carpeta de paquetes.
 */

import { execFile } from 'node:child_process'
import { createHash, createPublicKey, verify } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeFileAtomic } from '../atomic-write'
import { rutaDentroDe } from './escaner'
import { ARCHIVO_FIRMA, EXTENSION_PAQUETE, verificarFirmaPaquete, type ResultadoFirma } from './firma-paquete'

export type EntradaCatalogo = { id: string; nombre: string; version: string; url: string; sha256: string; sizeBytes: number }
export type Catalogo = { generadoEn: string; paquetes: EntradaCatalogo[] }

/** De dónde salió lo instalado (se guarda en instalacion.json y lo muestra el panel de extensiones). */
export type OrigenInstalacion = 'catalogo' | 'archivo-firmado' | 'desarrollo'

export type ProgresoInstalacion = {
  id: string
  fase: 'descargando' | 'verificando' | 'instalando' | 'listo' | 'error'
  recibidos?: number
  total?: number
  mensaje?: string
}

/** Límites de un paquete: tamaño del zip y número de entradas. */
export const MAX_PAQUETE_BYTES = 300 * 1024 * 1024
export const MAX_ENTRADAS = 5000
const ID_PAQUETE = /^[a-z0-9]+(\.[a-z0-9-]+){2,}$/
const BUNDLE_VST3 = /^[A-Za-z0-9 ._&()-]+\.vst3$/i

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

function ejecutar(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => {
      if (err) reject(new Error(`${path.basename(cmd)} falló: ${String(errOut || err.message).slice(0, 300)}`))
      else resolve(String(out))
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

/** Entradas del listado de `tar -t`: ninguna absoluta, con `..` ni con unidad; como mucho MAX_ENTRADAS. */
export function validarListado(listado: string): string[] {
  const entradas = listado.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (entradas.length > MAX_ENTRADAS) throw new Error(`el paquete tiene demasiados archivos (${entradas.length})`)
  for (const e of entradas) {
    const n = e.replace(/\\/g, '/')
    if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.split('/').some((s) => s === '..')) throw new Error(`ruta no permitida en el paquete: ${e}`)
  }
  return entradas
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
  /** Claves públicas que firman paquetes `.jwx` (la de JasWave; en desarrollo, además una de pruebas). */
  clavesPublicas?: string[]
  fetch?: typeof fetch
  tar?: string
}

/** Lo que el usuario ve antes de confirmar la instalación de un archivo. */
export type InspeccionPaquete = {
  id: string
  nombre: string
  version: string
  descripcion: string
  tipo: 'modulo' | 'vst3'
  firma: ResultadoFirma['estado']
  motivoFirma?: string
  tamano: number
}

type PaqueteAbierto = {
  temporal: string
  extraido: string
  manifiesto: { id: string; version: string; name?: string; description?: string; entrypoints?: { dspDesktop?: unknown; ui?: unknown } }
  textoManifiesto: Buffer
  tipo: 'modulo' | 'vst3'
  firma: ResultadoFirma
}

const rutaTar = (o: Pick<OpcionesInstalacion, 'tar'>) => o.tar ?? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

/** Valida, lista y extrae el zip en una carpeta temporal y comprueba manifiesto y firma (no instala). */
async function abrirPaquete(zip: Buffer, o: Pick<OpcionesInstalacion, 'tar' | 'clavesPublicas'>): Promise<PaqueteAbierto> {
  if (zip.length > MAX_PAQUETE_BYTES) throw new Error(`el paquete supera ${MAX_PAQUETE_BYTES / 1024 / 1024} MB`)
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) throw new Error('el archivo no es un paquete JasWave (.jwx / zip)')
  const temporal = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-instalar-'))
  try {
    const rutaZip = path.join(temporal, 'paquete.zip')
    await fs.writeFile(rutaZip, zip)
    const tar = rutaTar(o)
    validarListado(await ejecutar(tar, ['-t', '-f', rutaZip]))
    const extraido = path.join(temporal, 'x')
    await fs.mkdir(extraido)
    await ejecutar(tar, ['-x', '-f', rutaZip, '-C', extraido])
    const archivos = await listarArchivosSeguros(extraido)
    if (archivos.length > MAX_ENTRADAS) throw new Error('el paquete tiene demasiados archivos')

    const textoManifiesto = await fs.readFile(path.join(extraido, 'jaswave-plugin.json')).catch(() => {
      throw new Error('el paquete no tiene jaswave-plugin.json')
    })
    const manifiesto = JSON.parse(textoManifiesto.toString('utf8')) as PaqueteAbierto['manifiesto']
    if (typeof manifiesto.id !== 'string' || !ID_PAQUETE.test(manifiesto.id)) throw new Error('id de paquete inválido')
    if (typeof manifiesto.version !== 'string' || !/^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(manifiesto.version)) throw new Error('versión de paquete inválida')
    const esModulo = typeof manifiesto.entrypoints?.ui === 'string' && typeof manifiesto.entrypoints?.dspDesktop !== 'string'

    // Firma: todos los archivos menos la propia firma deben estar firmados con su hash exacto
    const reales: Record<string, string> = {}
    for (const rel of archivos) if (rel !== ARCHIVO_FIRMA) reales[rel] = sha256(await fs.readFile(path.join(extraido, rel)))
    const textoFirma = archivos.includes(ARCHIVO_FIRMA) ? await fs.readFile(path.join(extraido, ARCHIVO_FIRMA), 'utf8') : null
    const firma = verificarFirmaPaquete(textoFirma, { id: manifiesto.id, version: manifiesto.version }, reales, o.clavesPublicas ?? [])
    return { temporal, extraido, manifiesto, textoManifiesto, tipo: esModulo ? 'modulo' : 'vst3', firma }
  } catch (e) {
    await fs.rm(temporal, { recursive: true, force: true })
    throw e
  }
}

function inspeccion(p: PaqueteAbierto, tamano: number): InspeccionPaquete {
  return {
    id: p.manifiesto.id,
    nombre: typeof p.manifiesto.name === 'string' ? p.manifiesto.name.slice(0, 120) : p.manifiesto.id,
    version: p.manifiesto.version,
    descripcion: typeof p.manifiesto.description === 'string' ? p.manifiesto.description.slice(0, 500) : '',
    tipo: p.tipo,
    firma: p.firma.estado,
    ...(p.firma.estado === 'invalida' ? { motivoFirma: p.firma.motivo } : {}),
    tamano,
  }
}

/** Copia lo extraído a su sitio con intercambio atómico y escribe instalacion.json. */
async function instalarExtraido(p: PaqueteAbierto, origen: OrigenInstalacion, o: OpcionesInstalacion): Promise<string> {
  const { extraido, manifiesto } = p
  const id = manifiesto.id
  o.alProgreso({ id, fase: 'instalando' })
  const dirPaquete = path.join(o.carpetaPaquetes, id)
  const base = { version: manifiesto.version, instaladoEn: new Date().toISOString(), origen }

  if (p.tipo === 'modulo') {
    // Módulo del DAW (M3): sin VST3; su código va en dist/ dentro del paquete.
    const ui = String(manifiesto.entrypoints!.ui)
    if (!ui.startsWith('dist/') || !rutaDentroDe(extraido, ui)) throw new Error('el módulo debe tener su código en dist/')
    await fs.stat(path.join(extraido, ui))
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
    await writeFileAtomic(path.join(dirPaquete, 'jaswave-plugin.json'), p.textoManifiesto)
    const archivos: Record<string, string> = { 'jaswave-plugin.json': sha256(p.textoManifiesto) }
    for (const [rel, h] of Object.entries(await hashes(destinoDist))) archivos[`dist/${rel}`] = h
    await writeFileAtomic(path.join(dirPaquete, 'instalacion.json'), JSON.stringify({ ...base, archivos }, null, 2))
    o.alProgreso({ id, fase: 'listo' })
    return dirPaquete
  }

  const entradaDsp = manifiesto.entrypoints?.dspDesktop
  const bundle = typeof entradaDsp === 'string' ? path.basename(entradaDsp) : ''
  if (!BUNDLE_VST3.test(bundle)) throw new Error('el paquete no declara un bundle VST3 válido')
  const origenBundle = path.join(extraido, 'vst3', bundle)
  await fs.stat(origenBundle)
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
  await fs.mkdir(dirPaquete, { recursive: true })
  await writeFileAtomic(path.join(dirPaquete, 'jaswave-plugin.json'), p.textoManifiesto)
  const registro = {
    ...base,
    archivos: { 'jaswave-plugin.json': sha256(p.textoManifiesto) },
    vst3: { bundle, archivos: await hashes(destinoBundle) },
  }
  await writeFileAtomic(path.join(dirPaquete, 'instalacion.json'), JSON.stringify(registro, null, 2))
  o.alProgreso({ id, fase: 'listo' })
  return destinoBundle
}

/** Instala (o actualiza) un paquete del catálogo verificado. Devuelve la ruta del bundle o del módulo. */
export async function instalarPaquete(entrada: EntradaCatalogo, o: OpcionesInstalacion): Promise<string> {
  if (!ID_PAQUETE.test(entrada.id)) throw new Error('id de paquete inválido')
  let abierto: PaqueteAbierto | null = null
  try {
    o.alProgreso({ id: entrada.id, fase: 'descargando', recibidos: 0, total: entrada.sizeBytes })
    const zip = await descargar(entrada.url, entrada.sizeBytes, (n) => o.alProgreso({ id: entrada.id, fase: 'descargando', recibidos: n, total: entrada.sizeBytes }), o.fetch)
    o.alProgreso({ id: entrada.id, fase: 'verificando' })
    if (zip.length !== entrada.sizeBytes) throw new Error('el tamaño del paquete no coincide con el catálogo')
    if (sha256(zip) !== entrada.sha256) throw new Error('el SHA-256 del paquete no coincide con el catálogo')
    abierto = await abrirPaquete(zip, o)
    if (abierto.manifiesto.id !== entrada.id || abierto.manifiesto.version !== entrada.version) throw new Error('el manifiesto no corresponde al catálogo')
    // El catálogo firmado ya garantiza el contenido; una firma de paquete presente también debe ser válida.
    if (abierto.firma.estado === 'invalida') throw new Error(`firma del paquete inválida: ${abierto.firma.motivo}`)
    return await instalarExtraido(abierto, 'catalogo', o)
  } catch (e) {
    o.alProgreso({ id: entrada.id, fase: 'error', mensaje: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    if (abierto) await fs.rm(abierto.temporal, { recursive: true, force: true })
  }
}

/** Lee un `.jwx` del disco con su límite de tamaño. */
export async function leerArchivoPaquete(ruta: string): Promise<Buffer> {
  if (typeof ruta !== 'string' || !ruta.toLowerCase().endsWith(EXTENSION_PAQUETE)) throw new Error('solo se pueden instalar archivos .jwx')
  const s = await fs.stat(ruta)
  if (!s.isFile()) throw new Error('no es un archivo')
  if (s.size > MAX_PAQUETE_BYTES) throw new Error(`el paquete supera ${MAX_PAQUETE_BYTES / 1024 / 1024} MB`)
  return fs.readFile(ruta)
}

/** Datos del paquete y estado de su firma, para pedir confirmación antes de instalar. */
export async function inspeccionarArchivo(ruta: string, o: Pick<OpcionesInstalacion, 'tar' | 'clavesPublicas'>): Promise<InspeccionPaquete> {
  const zip = await leerArchivoPaquete(ruta)
  const abierto = await abrirPaquete(zip, o)
  try {
    return inspeccion(abierto, zip.length)
  } finally {
    await fs.rm(abierto.temporal, { recursive: true, force: true })
  }
}

export type ResultadoInstalacionArchivo =
  | { ok: true; ruta: string; origen: OrigenInstalacion; paquete: InspeccionPaquete }
  | { ok: false; error: string; paquete?: InspeccionPaquete; requiereConfirmacion?: boolean }

/**
 * Instala un `.jwx`: firmado por JasWave → directo; sin firma (o con firma inválida) solo si el modo
 * desarrollador está activo y el usuario lo confirmó (`aceptarSinFirma`).
 */
export async function instalarArchivo(
  ruta: string,
  politica: { modoDesarrollador: boolean; aceptarSinFirma: boolean },
  o: OpcionesInstalacion,
): Promise<ResultadoInstalacionArchivo> {
  const zip = await leerArchivoPaquete(ruta)
  const abierto = await abrirPaquete(zip, o)
  const paquete = inspeccion(abierto, zip.length)
  try {
    let origen: OrigenInstalacion = 'archivo-firmado'
    if (abierto.firma.estado !== 'valida') {
      const motivo = abierto.firma.estado === 'ausente' ? 'el paquete no está firmado por JasWave' : `la firma no es válida (${abierto.firma.motivo})`
      if (!politica.modoDesarrollador) {
        return { ok: false, paquete, error: `${motivo}. Solo se instalan paquetes firmados; para probar uno propio activa el Modo desarrollador.` }
      }
      if (!politica.aceptarSinFirma) return { ok: false, paquete, requiereConfirmacion: true, error: motivo }
      origen = 'desarrollo'
    }
    o.alProgreso({ id: paquete.id, fase: 'verificando' })
    const destino = await instalarExtraido(abierto, origen, o)
    return { ok: true, ruta: destino, origen, paquete }
  } catch (e) {
    o.alProgreso({ id: paquete.id, fase: 'error', mensaje: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    await fs.rm(abierto.temporal, { recursive: true, force: true })
  }
}

/**
 * Desinstala un paquete de la carpeta de usuario: su carpeta y, si lo registró el instalador, su bundle
 * VST3. Nunca borra nada fuera de esas dos raíces.
 */
export async function desinstalarPaquete(id: string, o: Pick<OpcionesInstalacion, 'carpetaPaquetes' | 'carpetaVst3'>): Promise<{ bundle?: string }> {
  if (!ID_PAQUETE.test(id)) throw new Error('id de paquete inválido')
  const dirPaquete = rutaDentroDe(o.carpetaPaquetes, id)
  if (!dirPaquete) throw new Error('ruta de paquete inválida')
  let bundle: string | undefined
  try {
    const registro = JSON.parse(await fs.readFile(path.join(dirPaquete, 'instalacion.json'), 'utf8')) as { vst3?: { bundle?: unknown } }
    const b = registro.vst3?.bundle
    if (typeof b === 'string' && BUNDLE_VST3.test(b) && rutaDentroDe(o.carpetaVst3, b)) bundle = b
  } catch {
    /* sin registro: solo se quita la carpeta del paquete */
  }
  await fs.stat(dirPaquete).catch(() => {
    throw new Error('el paquete no está instalado en esta cuenta de usuario')
  })
  if (bundle) {
    const destino = path.join(o.carpetaVst3, bundle)
    // Si un DAW lo tiene cargado, Windows no deja borrarlo: se avisa y no se toca el paquete.
    const aparte = `${destino}.borrar-${process.pid}`
    try {
      await fs.rename(destino, aparte)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`no se pudo quitar ${bundle} (¿está cargado en un DAW?)`)
    }
    await fs.rm(aparte, { recursive: true, force: true })
  }
  await fs.rm(dirPaquete, { recursive: true, force: true })
  return bundle ? { bundle } : {}
}
