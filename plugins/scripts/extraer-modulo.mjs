/**
 * Extrae archivos del DAW (jas-wave/) a un paquete de módulo (plugins/<id>/src/) y reescribe sus imports:
 *  - a otro archivo que también se mueve → ruta relativa dentro del módulo;
 *  - a cualquier otro código del DAW, de shared/ o de @jaswave/ai-harness → `@jaswave/host-sdk`
 *    (y añade esos nombres a jas-wave/src/modulos/api-host.ts, la API pública del host);
 *  - paquetes npm (react, lucide-react…) → sin cambios.
 *
 * Uso: node plugins/scripts/extraer-modulo.mjs <plan.json> [--seco]
 *   plan.json: { "modulo": "plugins/com.jaswave.modulo.x", "archivos": { "<ruta en jas-wave>": "<ruta en src/>" } }
 * Las rutas del plan son relativas a la raíz del repositorio / a src del módulo. Los archivos se mueven con git mv.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const JW = path.join(REPO, 'jas-wave')
const API_HOST = path.join(JW, 'src', 'modulos', 'api-host.ts')
const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const seco = process.argv.includes('--seco')
const MOD = path.resolve(REPO, plan.modulo)
const EXT = ['.ts', '.tsx', '.js', '.mjs']

const norm = (p) => path.resolve(p).toLowerCase()
/** origen absoluto → destino absoluto */
const mover = new Map(Object.entries(plan.archivos).map(([o, d]) => [norm(path.join(REPO, o)), path.join(MOD, 'src', d)]))
/** origen absoluto → paquete del workspace que lo contendrá (p. ej. @jaswave/ui-markdown) */
const paquetes = new Map(Object.entries(plan.paquetes ?? {}).map(([o, p]) => [norm(path.join(REPO, o)), p]))

function resolver(desdeOrigen, esp) {
  let base
  if (esp.startsWith('@/')) base = path.join(JW, esp.slice(2))
  else if (esp === '@jaswave/ai-harness') return { tipo: 'harness' }
  else if (esp === '@jaswave/shared') base = path.join(REPO, 'shared', 'src', 'index')
  else if (esp.startsWith('.')) base = path.resolve(path.dirname(desdeOrigen), esp)
  else return { tipo: 'npm' }
  base = base.split('?')[0]
  for (const c of [base, ...EXT.map((e) => base + e), ...EXT.map((e) => path.join(base, 'index' + e))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { tipo: 'archivo', ruta: c }
  }
  return { tipo: 'desconocido', esp }
}

/** nombres que el módulo pide al host: archivoHost → { valores:Set, tipos:Set } */
const pedidos = new Map()
const problemas = []
function pedir(rutaHost, nombre, soloTipo) {
  const k = rutaHost
  const e = pedidos.get(k) ?? { valores: new Set(), tipos: new Set() }
  ;(soloTipo ? e.tipos : e.valores).add(nombre)
  pedidos.set(k, e)
}

function relDesde(destinoArchivo, destinoObjetivo) {
  let r = path.relative(path.dirname(destinoArchivo), destinoObjetivo).split(path.sep).join('/').replace(/\.(tsx?|mjs|js)$/, '')
  if (!r.startsWith('.')) r = './' + r
  return r
}

function parsearNombres(lista) {
  // "a, type B, c as d" → [{nombre:'a', alias, tipo}]
  return lista
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const tipo = x.startsWith('type ')
      const limpio = tipo ? x.slice(5).trim() : x
      const [nombre, alias] = limpio.split(/\s+as\s+/)
      return { nombre: nombre.trim(), alias: alias?.trim(), tipo }
    })
}

function reescribir(origen, destino, texto) {
  const crlf = texto.includes('\r\n')
  let s = texto.replace(/\r\n/g, '\n')
  const hostValores = []
  const hostTipos = []

  // import/export estáticos (multilínea)
  s = s.replace(/(^|\n)(\s*)(import|export)(\s+type)?\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\6;?/g, (m, nl, ind, kw, tipoKw, cuerpo, q, esp) => {
    const r = resolver(origen, esp)
    if (r.tipo === 'npm') return m
    if (r.tipo === 'archivo' && mover.has(norm(r.ruta))) return `${nl}${ind}${kw}${tipoKw ?? ''} ${cuerpo} from ${q}${relDesde(destino, mover.get(norm(r.ruta)))}${q}`
    if (r.tipo === 'archivo' && paquetes.has(norm(r.ruta))) return `${nl}${ind}${kw}${tipoKw ?? ''} ${cuerpo} from ${q}${paquetes.get(norm(r.ruta))}${q}`
    if (r.tipo === 'desconocido') {
      problemas.push(`${path.relative(REPO, origen)}: no se resuelve ${esp}`)
      return m
    }
    const soloTipo = Boolean(tipoKw)
    const llaves = cuerpo.match(/^\{([\s\S]*)\}$/)
    if (!llaves) {
      problemas.push(`${path.relative(REPO, origen)}: import no soportado hacia el host (${cuerpo.trim()} from ${esp})`)
      return m
    }
    const objetivo = r.tipo === 'harness' ? '@jaswave/ai-harness' : r.ruta
    if (kw === 'export') {
      // Re-exportación de algo del host: se re-exporta desde el SDK.
      for (const n of parsearNombres(llaves[1])) pedir(objetivo, n.nombre, soloTipo || n.tipo)
      return `${nl}${ind}export${tipoKw ?? ''} {${llaves[1]}} from ${q}@jaswave/host-sdk${q}`
    }
    for (const n of parsearNombres(llaves[1])) {
      pedir(objetivo, n.nombre, soloTipo || n.tipo)
      const txt = n.alias ? `${n.nombre} as ${n.alias}` : n.nombre
      ;(soloTipo || n.tipo ? hostTipos : hostValores).push(txt)
    }
    return nl
  })

  // import() dinámicos hacia el host: const { a, b } = await import('x')
  s = s.replace(/import\(\s*(['"])([^'"]+)\1\s*\)/g, (m, q, esp, desplazamiento) => {
    const r = resolver(origen, esp)
    if (r.tipo === 'npm') return m
    if (r.tipo === 'archivo' && mover.has(norm(r.ruta))) return `import(${q}${relDesde(destino, mover.get(norm(r.ruta)))}${q})`
    if (r.tipo === 'archivo' && paquetes.has(norm(r.ruta))) return `import(${q}${paquetes.get(norm(r.ruta))}${q})`
    if (r.tipo === 'desconocido') {
      problemas.push(`${path.relative(REPO, origen)}: no se resuelve import(${esp})`)
      return m
    }
    // Nombres desestructurados justo antes
    // Posición real de esta coincidencia (puede haber varios import() iguales en el archivo).
    const i = desplazamiento
    const antes = s.slice(0, i)
    const despues = s.slice(i + m.length, i + m.length + 200)
    // `const { a } = await import(x)` o `import(x).then(({ a }) => …)`
    const d = antes.match(/\{([^{}]*)\}\s*=\s*await\s*$/) ?? despues.match(/^\s*\.then\(\s*\(\s*\{([^{}]*)\}\s*\)\s*=>/)
    const objetivoDin = r.tipo === 'harness' ? '@jaswave/ai-harness' : r.ruta
    // `import('x').Tipo` (posición de tipo) o `(await import('x')).valor`
    const tipoInline = despues.match(/^\.(\w+)/)
    const valorAwait = /\(\s*await\s*$/.test(antes) ? despues.match(/^\s*\)\s*\.(\w+)/) : null
    if (d) for (const n of parsearNombres(d[1].replace(/:\s*\w+/g, ''))) pedir(objetivoDin, n.nombre, false)
    else if (tipoInline) pedir(objetivoDin, tipoInline[1], true)
    else if (valorAwait) pedir(objetivoDin, valorAwait[1], false)
    else problemas.push(`${path.relative(REPO, origen)}: import() dinámico del host sin desestructurar (${esp})`)
    return `import(${q}@jaswave/host-sdk${q})`
  })

  const lineas = []
  const uniq = (a) => [...new Set(a)].sort()
  if (hostValores.length) lineas.push(`import { ${uniq(hostValores).join(', ')} } from '@jaswave/host-sdk'`)
  if (hostTipos.length) lineas.push(`import type { ${uniq(hostTipos).join(', ')} } from '@jaswave/host-sdk'`)
  if (lineas.length) {
    // Tras el último import que quede (o al principio, después del comentario de cabecera).
    const re = /\n(?:import|export)\s[\s\S]*?from\s+['"][^'"]+['"];?(?=\n)/g
    let ultimo = -1
    for (let m; (m = re.exec(s)); ) ultimo = m.index + m[0].length
    if (ultimo < 0) {
      const cab = s.match(/^\/\*\*[\s\S]*?\*\/\n/)
      ultimo = cab ? cab[0].length - 1 : 0
    }
    s = s.slice(0, ultimo) + '\n' + lineas.join('\n') + s.slice(ultimo)
  }
  s = s.replace(/\n{3,}/g, '\n\n')
  return crlf ? s.replace(/\n/g, '\r\n') : s
}

// 1) Reescribir todo contra el árbol original y después mover (si no, un archivo ya movido no se resuelve)
const reescritos = Object.entries(plan.archivos).map(([o, d]) => {
  const origen = path.join(REPO, o)
  const destino = path.join(MOD, 'src', d)
  return { origen, destino, nuevo: reescribir(origen, destino, fs.readFileSync(origen, 'utf8')) }
})
if (!seco) {
  for (const { origen, destino, nuevo } of reescritos) {
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    execFileSync('git', ['mv', origen, destino], { cwd: REPO })
    fs.writeFileSync(destino, nuevo)
  }
}

// 2) API del host: añadir lo que falte
const api = fs.existsSync(API_HOST) ? fs.readFileSync(API_HOST, 'utf8') : ''
const yaExportados = new Set([...api.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap((m) => parsearNombres(m[1]).map((n) => n.alias ?? n.nombre)))
const nuevas = []
const origenDe = new Map()
for (const [objetivo, { valores, tipos }] of pedidos) {
  for (const n of [...valores, ...tipos]) {
    const previo = origenDe.get(n)
    if (previo && previo !== objetivo) problemas.push(`«${n}» llega de dos orígenes (${path.relative(REPO, previo)} y ${path.relative(REPO, objetivo)}): se exporta el primero; comprueba que son equivalentes`)
    else origenDe.set(n, objetivo)
  }
}
for (const [objetivo, { valores, tipos }] of [...pedidos].sort((a, b) => a[0].localeCompare(b[0]))) {
  const desde = objetivo === '@jaswave/ai-harness' ? '@jaswave/ai-harness' : relDesde(API_HOST, objetivo).replace(/^\.\/\.\.\//, '../')
  const v = [...valores].filter((n) => !yaExportados.has(n))
  const t = [...tipos].filter((n) => !yaExportados.has(n) && !valores.has(n))
  v.forEach((n) => yaExportados.add(n))
  t.forEach((n) => yaExportados.add(n))
  if (v.length) nuevas.push(`export { ${v.sort().join(', ')} } from '${desde}'`)
  if (t.length) nuevas.push(`export type { ${t.sort().join(', ')} } from '${desde}'`)
}
if (nuevas.length && !seco) {
  fs.writeFileSync(API_HOST, api.replace(/\s*$/, '\n') + `\n// Añadido al extraer ${path.basename(MOD)}\n` + nuevas.join('\n') + '\n')
}
console.log(`${Object.keys(plan.archivos).length} archivos · ${nuevas.length} líneas nuevas en api-host.ts${seco ? ' (seco)' : ''}`)
if (seco) console.log(nuevas.join('\n'))
if (problemas.length) {
  console.log('\nRevisar a mano:')
  for (const p of [...new Set(problemas)]) console.log('  - ' + p)
}
