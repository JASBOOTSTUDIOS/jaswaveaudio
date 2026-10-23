/**
 * Empaqueta los plugins VST3 y los módulos del DAW de plugins/ para la entrega bajo demanda (D1/M3).
 *
 *   node native/scripts/package-plugins.mjs [--config Release] [--base-url <url>] [--salida <dir>]
 *
 * Por cada plugins/com.jaswave.plugin.* genera <salida>/<id>-<version>.zip con:
 *   jaswave-plugin.json
 *   vst3/<Bundle>.vst3/...     (desde plugins/build/VST3/<Config>, compilar antes con build-plugins.mjs)
 * Por cada plugins/com.jaswave.modulo.* (compilar antes con `npm run build:modulos`):
 *   jaswave-plugin.json
 *   dist/...                   (código ESM del módulo + estilos)
 * y <salida>/catalogo.json con { id, nombre, version, url, sha256, sizeBytes, categoria, plataformas,
 * descripcion, ui?, uiEstilos? } por paquete. Los módulos con plataforma web dejan además sus archivos en
 * <salida>/web/<id>/<version>/ para publicarlos en el backend (plugins/scripts/publicar-modulos-web.mjs).
 *
 * No publica nada: subir los zip a GitHub Releases y registrar el catálogo en el backend son pasos
 * explícitos (ver instrucciones que imprime al final).
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre)
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto
}
const config = opcion('--config', 'Release')
const salida = path.resolve(opcion('--salida', path.join(raiz, 'plugins', 'dist')))
const baseUrl = opcion('--base-url', '').replace(/\/+$/, '')
const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
const carpetaBundles = path.join(raiz, 'plugins', 'build', 'VST3', config)

if (process.platform !== 'win32') {
  console.error('[package-plugins] los paquetes de VST3 JasWave se generan en Windows.')
  process.exit(1)
}

const sha256 = (ruta) => createHash('sha256').update(fs.readFileSync(ruta)).digest('hex')

function copiarDirectorio(origen, destino) {
  fs.mkdirSync(destino, { recursive: true })
  for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
    const a = path.join(origen, e.name)
    const b = path.join(destino, e.name)
    if (e.isDirectory()) copiarDirectorio(a, b)
    else if (e.isFile()) fs.copyFileSync(a, b)
  }
}

fs.mkdirSync(salida, { recursive: true })
const catalogo = []
const problemas = []

for (const nombre of fs.readdirSync(path.join(raiz, 'plugins')).sort()) {
  const dir = path.join(raiz, 'plugins', nombre)
  const rutaManifiesto = path.join(dir, 'jaswave-plugin.json')
  const esModulo = nombre.startsWith('com.jaswave.modulo.')
  if ((!nombre.startsWith('com.jaswave.plugin.') && !esModulo) || !fs.existsSync(rutaManifiesto)) continue
  const manifiesto = JSON.parse(fs.readFileSync(rutaManifiesto, 'utf8'))
  const comunes = {
    categoria: manifiesto.category,
    plataformas: manifiesto.targetPlatforms,
    descripcion: (manifiesto.description ?? '').slice(0, 2000),
  }
  if (esModulo) {
    const ui = manifiesto.entrypoints?.ui
    const dist = path.join(dir, 'dist')
    if (!ui || !fs.existsSync(path.join(dir, ui))) {
      problemas.push(`${nombre}: falta ${ui ?? 'entrypoints.ui'} (ejecuta npm run build:modulos)`)
      continue
    }
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `jw-pkg-${manifiesto.id}-`))
    try {
      fs.copyFileSync(rutaManifiesto, path.join(staging, 'jaswave-plugin.json'))
      copiarDirectorio(dist, path.join(staging, 'dist'))
      const archivo = `${manifiesto.id}-${manifiesto.version}.zip`
      const destino = path.join(salida, archivo)
      fs.rmSync(destino, { force: true })
      execFileSync(tar, ['-a', '-c', '-f', destino, '-C', staging, 'jaswave-plugin.json', 'dist'], { stdio: 'inherit' })
      const tamano = fs.statSync(destino).size
      catalogo.push({
        id: manifiesto.id,
        nombre: manifiesto.name,
        version: manifiesto.version,
        url: baseUrl ? `${baseUrl}/${archivo}` : archivo,
        sha256: sha256(destino),
        sizeBytes: tamano,
        ...comunes,
        ui,
        ...(manifiesto.entrypoints?.uiEstilos ? { uiEstilos: manifiesto.entrypoints.uiEstilos } : {}),
      })
      if (manifiesto.targetPlatforms?.includes('web')) {
        const web = path.join(salida, 'web', manifiesto.id, manifiesto.version)
        fs.rmSync(web, { recursive: true, force: true })
        copiarDirectorio(dist, path.join(web, 'dist'))
      }
      console.log(`[package-plugins] ${archivo}  ${(tamano / 1024).toFixed(0)} KB (módulo)`)
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
    continue
  }
  const entrada = manifiesto.entrypoints?.dspDesktop
  if (!entrada) {
    problemas.push(`${nombre}: sin entrypoints.dspDesktop`)
    continue
  }
  const bundle = path.basename(entrada)
  const origenBundle = path.join(carpetaBundles, bundle)
  if (!fs.existsSync(origenBundle)) {
    problemas.push(`${nombre}: falta ${origenBundle} (ejecuta node native/scripts/build-plugins.mjs)`)
    continue
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), `jw-pkg-${manifiesto.id}-`))
  try {
    fs.copyFileSync(rutaManifiesto, path.join(staging, 'jaswave-plugin.json'))
    copiarDirectorio(origenBundle, path.join(staging, 'vst3', bundle))
    const archivo = `${manifiesto.id}-${manifiesto.version}.zip`
    const destino = path.join(salida, archivo)
    fs.rmSync(destino, { force: true })
    // bsdtar de Windows: -a elige el formato por la extensión (.zip).
    execFileSync(tar, ['-a', '-c', '-f', destino, '-C', staging, 'jaswave-plugin.json', 'vst3'], { stdio: 'inherit' })
    const tamano = fs.statSync(destino).size
    catalogo.push({
      id: manifiesto.id,
      nombre: manifiesto.name,
      version: manifiesto.version,
      url: baseUrl ? `${baseUrl}/${archivo}` : archivo,
      sha256: sha256(destino),
      sizeBytes: tamano,
      ...comunes,
    })
    console.log(`[package-plugins] ${archivo}  ${(tamano / 1024).toFixed(0)} KB`)
  } finally {
    fs.rmSync(staging, { recursive: true, force: true })
  }
}

fs.writeFileSync(path.join(salida, 'catalogo.json'), JSON.stringify({ paquetes: catalogo }, null, 2) + '\n')
console.log(`[package-plugins] ${catalogo.length} paquetes → ${salida}`)
for (const p of problemas) console.warn(`[package-plugins] AVISO ${p}`)
if (!baseUrl) {
  console.log('[package-plugins] Sin --base-url: las URL del catálogo son relativas (solo para pruebas locales).')
}
console.log(
  [
    '',
    'Publicación (pasos explícitos, no automáticos):',
    `  1. gh release create plugins-<version> ${path.join(salida, '*.zip')} --draft   # o gh release upload`,
    '  2. Regenera el catálogo con --base-url https://github.com/<org>/<repo>/releases/download/plugins-<version>',
    '  3. POST <backend>/catalogo con el contenido de catalogo.json (token de administrador)',
    '  4. Módulos web: node plugins/scripts/publicar-modulos-web.mjs --api <backend> (token de administrador)',
  ].join('\n'),
)
if (problemas.length) process.exit(1)
