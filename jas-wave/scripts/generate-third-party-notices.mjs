#!/usr/bin/env node
/**
 * Regenera la sección npm de THIRD_PARTY_NOTICES.md (raíz del repo).
 *
 * Lee `license` y los archivos LICENSE/COPYING de cada paquete que Vite empaqueta
 * en el renderer (y de sus dependencias transitivas) desde jas-wave/node_modules.
 * Solo reemplaza el bloque entre los marcadores BEGIN/END; el resto del archivo
 * (componentes nativos, Electron, fuentes) se mantiene a mano.
 *
 * Uso:
 *   node scripts/generate-third-party-notices.mjs            # escribe el archivo
 *   node scripts/generate-third-party-notices.mjs --check    # exit 1 si está desactualizado
 *   node scripts/generate-third-party-notices.mjs --node-modules <dir>
 *
 * Sin dependencias: solo Node (>= 22).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const repoRoot = path.resolve(appDir, '..')
const noticesPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md')

const BEGIN = '<!-- BEGIN GENERATED: npm (jas-wave/scripts/generate-third-party-notices.mjs) -->'
const END = '<!-- END GENERATED: npm -->'

/**
 * Paquetes que el renderer importa en tiempo de ejecución (Vite los empaqueta).
 * Están en devDependencies a propósito: no se copian al asar. Si se añade una
 * dependencia de UI nueva, agregarla aquí y ejecutar `npm run notices`.
 */
const BUNDLED_ROOTS = [
  '@base-ui/react',
  '@fontsource-variable/inter',
  '@fontsource-variable/jetbrains-mono',
  'class-variance-authority',
  // Dependencia de runtime del proceso main ("dependencies": va en el asar con sus transitivas).
  'electron-updater',
  'clsx',
  'lucide-react',
  'react',
  'react-dom',
  'react-resizable-panels',
  'tailwind-merge',
  'tw-animate-css',
]

const LICENSE_FILE_RE = /^(licen[cs]e|copying|unlicense)(\.|-|$)/i

function parseArgs(argv) {
  const out = { check: false, nodeModules: path.join(appDir, 'node_modules') }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') out.check = true
    else if (a === '--node-modules') out.nodeModules = path.resolve(argv[++i] ?? '')
    else {
      console.error(`Argumento desconocido: ${a}`)
      process.exit(2)
    }
  }
  return out
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Resuelve `dep` como lo haría Node: node_modules anidados hacia arriba hasta la raíz. */
function resolvePackageDir(dep, fromDir, rootNodeModules) {
  let dir = fromDir
  const stop = path.dirname(rootNodeModules)
  for (;;) {
    const candidate = path.join(dir, 'node_modules', dep)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    if (path.resolve(dir) === path.resolve(stop)) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function licenseName(pkg) {
  const l = pkg.license ?? pkg.licenses
  if (!l) return 'Desconocida'
  if (typeof l === 'string') return l
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x.type)).join(' OR ')
  if (typeof l === 'object' && l.type) return l.type
  return 'Desconocida'
}

function repoUrl(pkg) {
  const r = pkg.repository
  let url = typeof r === 'string' ? r : r?.url
  if (!url) return pkg.homepage ?? ''
  url = url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  if (url.startsWith('github:')) url = `https://github.com/${url.slice(7)}`
  return url
}

function readLicenseText(pkgDir) {
  let entries
  try {
    entries = fs.readdirSync(pkgDir, { withFileTypes: true })
  } catch {
    return null
  }
  const files = entries
    .filter((e) => e.isFile() && LICENSE_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort()
  if (files.length === 0) return null
  return files
    .map((f) => fs.readFileSync(path.join(pkgDir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n')
}

function collect(rootNodeModules) {
  const seen = new Map() // name@version -> info
  const missing = []
  const queue = BUNDLED_ROOTS.map((name) => ({ name, from: path.dirname(rootNodeModules) }))
  while (queue.length) {
    const { name, from } = queue.shift()
    const dir = resolvePackageDir(name, from, rootNodeModules)
    if (!dir) {
      missing.push(name)
      continue
    }
    const pkg = readJson(path.join(dir, 'package.json'))
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) continue
    if (pkg.name?.startsWith('@jaswave/')) continue
    const text = readLicenseText(dir)
    let license = licenseName(pkg)
    // Algunos paquetes no declaran `license` pero sí traen el archivo.
    if (license === 'Desconocida' && text && /\bMIT License\b/i.test(text)) license = 'MIT'
    seen.set(key, { name: pkg.name, version: pkg.version, license, url: repoUrl(pkg), text })
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) }
    for (const dep of Object.keys(deps)) queue.push({ name: dep, from: dir })
  }
  const list = [...seen.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  )
  return { list, missing }
}

function render(list) {
  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `Paquetes npm incluidos en el bundle del renderer y sus dependencias transitivas (${list.length} paquetes).`,
  )
  lines.push('No editar a mano: ejecutar `npm run notices` en `jas-wave/`.')
  lines.push('')
  lines.push('| Paquete | Versión | Licencia |')
  lines.push('|---|---|---|')
  for (const p of list) {
    const name = p.url ? `[${p.name}](${p.url})` : p.name
    lines.push(`| ${name} | ${p.version} | ${p.license.replace(/\|/g, '\\|')} |`)
  }
  lines.push('')
  lines.push('### Textos de licencia (npm)')
  lines.push('')
  for (const p of list) {
    lines.push('<details>')
    lines.push(`<summary>${p.name}@${p.version} — ${p.license}</summary>`)
    lines.push('')
    if (p.text) {
      lines.push('~~~~text')
      lines.push(p.text.replace(/^~~~~/gm, ' ~~~~'))
      lines.push('~~~~')
    } else {
      lines.push(
        `_El paquete no incluye archivo de licencia; declara \`${p.license}\` en su package.json._`,
      )
    }
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }
  lines.push(END)
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(args.nodeModules)) {
    console.error(`No existe ${args.nodeModules}. Ejecuta npm install en jas-wave/ primero.`)
    process.exit(2)
  }
  const { list, missing } = collect(args.nodeModules)
  if (missing.length) {
    console.error(`Paquetes no encontrados en node_modules: ${[...new Set(missing)].join(', ')}`)
    process.exit(2)
  }
  const current = fs.readFileSync(noticesPath, 'utf8').replace(/\r\n/g, '\n')
  const start = current.indexOf(BEGIN)
  const end = current.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    console.error(`THIRD_PARTY_NOTICES.md no contiene los marcadores:\n${BEGIN}\n${END}`)
    process.exit(2)
  }
  const next = current.slice(0, start) + render(list) + current.slice(end + END.length)
  if (args.check) {
    if (next !== current) {
      console.error('THIRD_PARTY_NOTICES.md está desactualizado. Ejecuta `npm run notices` en jas-wave/.')
      process.exit(1)
    }
    console.log(`THIRD_PARTY_NOTICES.md al día (${list.length} paquetes npm).`)
    return
  }
  fs.writeFileSync(noticesPath, next, 'utf8')
  const unknown = list.filter((p) => p.license === 'Desconocida' || !p.text)
  console.log(`THIRD_PARTY_NOTICES.md actualizado: ${list.length} paquetes npm.`)
  if (unknown.length) {
    console.log(
      `Revisar a mano (sin licencia declarada o sin archivo): ${unknown.map((p) => `${p.name}@${p.version}`).join(', ')}`,
    )
  }
}

main()
