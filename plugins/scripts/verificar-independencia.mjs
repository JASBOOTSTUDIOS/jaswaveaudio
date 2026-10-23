/**
 * Comprueba que los módulos instalables y el DAW están separados:
 *  - el código de producción de un módulo (plugins/com.jaswave.modulo.*\/src) solo importa paquetes npm,
 *    @jaswave/host-sdk y sus propios archivos (nada de jas-wave/, shared/, ai-harness/ ni de otro módulo);
 *  - el DAW (jas-wave/, sin node_modules ni builds) no importa nada de plugins/com.jaswave.modulo.*;
 *  - el SDK no importa código del DAW salvo sus pruebas de contrato (pruebas/) y los tipos generados.
 * Sale con código 1 si encuentra violaciones.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PLUGINS = path.join(REPO, 'plugins')
const IGNORAR = new Set(['node_modules', 'dist', 'dist-web', 'build', 'release', 'tipos-host', '.git'])
const RE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function archivos(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(d.name)) continue
    const p = path.join(dir, d.name)
    if (d.isDirectory()) out.push(...archivos(p))
    else if (/\.(ts|tsx|js|mjs|cjs|css)$/.test(d.name) && !d.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function importsDe(f) {
  const s = fs.readFileSync(f, 'utf8')
  const out = []
  if (f.endsWith('.css')) {
    for (const m of s.matchAll(/@(?:import|source)\s+['"]([^'"]+)['"]/g)) out.push(m[1])
    return out
  }
  for (const m of s.matchAll(RE_IMPORT)) out.push(m[1] ?? m[2])
  return out
}

const dentro = (p, dir) => path.resolve(p).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep)
const violaciones = []
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/')

// 1) Módulos
const modulos = fs.readdirSync(PLUGINS, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('com.jaswave.modulo.'))
for (const m of modulos) {
  const raiz = path.join(PLUGINS, m.name)
  for (const f of archivos(path.join(raiz, 'src'))) {
    for (const esp of importsDe(f)) {
      if (esp === '@jaswave/host-sdk' || esp === 'tailwindcss/theme' || esp === 'tailwindcss/utilities') continue
      if (esp.startsWith('@/') || esp.startsWith('@jaswave/')) {
        violaciones.push(`${rel(f)} importa ${esp} (solo se permite @jaswave/host-sdk)`)
        continue
      }
      if (esp.startsWith('.')) {
        const destino = path.resolve(path.dirname(f), esp)
        // El CSS del módulo puede importar el tema del SDK.
        if (f.endsWith('.css') && dentro(destino, path.join(PLUGINS, 'sdk', 'host-sdk', 'src'))) continue
        if (!dentro(destino, raiz)) violaciones.push(`${rel(f)} importa ${esp} fuera de su paquete`)
      }
    }
  }
}

// 2) El DAW no conoce el código de los módulos
for (const f of archivos(path.join(REPO, 'jas-wave'))) {
  for (const esp of importsDe(f)) {
    if (/com\.jaswave\.modulo\./.test(esp)) violaciones.push(`${rel(f)} importa código de un módulo (${esp})`)
  }
}

// 3) El SDK (fuera de pruebas/) no importa el DAW
for (const f of archivos(path.join(PLUGINS, 'sdk', 'host-sdk', 'src'))) {
  for (const esp of importsDe(f)) {
    if (!esp.startsWith('.')) continue
    const destino = path.resolve(path.dirname(f), esp)
    if (!dentro(destino, path.join(PLUGINS, 'sdk', 'host-sdk'))) violaciones.push(`${rel(f)} importa ${esp} fuera del SDK`)
  }
}

if (violaciones.length) {
  console.error(`Independencia de módulos: ${violaciones.length} violaciones`)
  for (const v of violaciones) console.error('  - ' + v)
  process.exit(1)
}
console.log(`Independencia de módulos OK (${modulos.length} módulos)`)
