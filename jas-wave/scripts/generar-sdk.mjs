/**
 * Genera la parte "API del DAW" de @jaswave/host-sdk a partir de src/modulos/api-host.ts:
 *  - plugins/sdk/host-sdk/tipos-host/: declaraciones (.d.ts) del host, con alias reescritos a rutas relativas.
 *  - plugins/sdk/host-sdk/src/host-api.generated.ts: un export por cada valor (resuelto en el runtime del
 *    host) y los tipos re-exportados.
 *
 * Uso: node scripts/generar-sdk.mjs [--comprobar]   (--comprobar falla si el archivo generado cambió)
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const JW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO = path.resolve(JW, '..')
const SDK = path.join(REPO, 'plugins', 'sdk', 'host-sdk')
const TIPOS = path.join(SDK, 'tipos-host')
const ENTRADA = path.join(JW, 'src', 'modulos', 'api-host.ts')
const GENERADO = path.join(SDK, 'src', 'host-api.generated.ts')
const comprobar = process.argv.includes('--comprobar')

const cfg = ts.getParsedCommandLineOfConfigFile(path.join(JW, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => console.error(d) })
const opciones = {
  ...cfg.options,
  noEmit: false,
  declaration: true,
  emitDeclarationOnly: true,
  declarationDir: TIPOS,
  rootDir: REPO,
  incremental: false,
  composite: false,
  allowJs: false,
  tsBuildInfoFile: undefined,
}
const programa = ts.createProgram([ENTRADA], opciones)

// 1) Nombres exportados (valores y tipos)
const checker = programa.getTypeChecker()
const fuente = programa.getSourceFile(ENTRADA)
const simbolo = checker.getSymbolAtLocation(fuente)
const valores = []
const tipos = []
for (const e of checker.getExportsOfModule(simbolo)) {
  const real = e.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(e) : e
  if (real.flags & ts.SymbolFlags.Value) valores.push(e.name)
  else tipos.push(e.name)
}
valores.sort()
tipos.sort()

const rel = './' + path.relative(path.dirname(GENERADO), path.join(TIPOS, 'jas-wave', 'src', 'modulos', 'api-host')).split(path.sep).join('/')
const texto = [
  '// Generado por jas-wave/scripts/generar-sdk.mjs a partir de jas-wave/src/modulos/api-host.ts — no editar.',
  '/* eslint-disable */',
  `import type * as H from '${rel}'`,
  "import { api } from './runtime'",
  '',
  ...valores.map((n) => `export const ${n}: typeof H.${n} = api('${n}')`),
  '',
  tipos.length ? `export type { ${tipos.join(', ')} } from '${rel}'` : '',
  '',
].join('\n')

if (comprobar) {
  const actual = fs.existsSync(GENERADO) ? fs.readFileSync(GENERADO, 'utf8').replace(/\r\n/g, '\n') : ''
  if (actual !== texto) {
    console.error('host-api.generated.ts no está al día: ejecuta `npm run sdk:generar` en jas-wave.')
    process.exit(1)
  }
} else {
  fs.writeFileSync(GENERADO, texto)
}

// 2) Declaraciones del host
fs.rmSync(TIPOS, { recursive: true, force: true })
const r = programa.emit(undefined, undefined, undefined, true)
const errores = r.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)
if (errores.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(errores, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => JW, getNewLine: () => '\n' }))
  process.exit(1)
}

// Alias del host → rutas relativas dentro de tipos-host
const alias = [
  [/^@\//, path.join(TIPOS, 'jas-wave') + path.sep],
  [/^@jaswave\/ai-harness$/, path.join(TIPOS, 'ai-harness', 'src', 'index')],
  [/^@jaswave\/shared$/, path.join(TIPOS, 'shared', 'src', 'index')],
  [/^@jaswave\/host-sdk\//, path.join(SDK, 'src') + path.sep],
]
let reescritos = 0
function recorrer(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) recorrer(p)
    else if (d.name.endsWith('.d.ts')) {
      const s = fs.readFileSync(p, 'utf8')
      const n = s.replace(/(from\s+|import\()(['"])([^'"]+)\2/g, (m, pre, q, esp) => {
        for (const [re, destino] of alias) {
          if (re.test(esp)) {
            reescritos++
            let rel2 = path.relative(path.dirname(p), esp.replace(re, destino)).split(path.sep).join('/')
            if (!rel2.startsWith('.')) rel2 = './' + rel2
            return `${pre}${q}${rel2}${q}`
          }
        }
        return m
      })
      if (n !== s) fs.writeFileSync(p, n)
    }
  }
}
recorrer(TIPOS)
const total = (function contar(d) {
  return fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? contar(path.join(d, e.name)) : 1), 0)
})(TIPOS)
console.log(`SDK: ${valores.length} valores, ${tipos.length} tipos · ${total} declaraciones · ${reescritos} alias reescritos`)
