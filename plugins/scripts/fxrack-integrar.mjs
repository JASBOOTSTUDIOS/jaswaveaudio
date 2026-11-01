// Pasos MECANICOS de la integracion del FX Rack en un plugin (ver docs/plans/F4-fxrack-integracion.md):
//   node plugins/scripts/fxrack-integrar.mjs <dir-del-plugin|nombre-corto> [--check]
//   1. manifiesto: anade (o actualiza) las 58 entradas ai.parameters del rack (ids 100..230) y la frase del rack en ai.summary.
//   2. worklet web: incrusta shared-dsp/web/fxrack.js en `entrypoints.dspWeb`, entre los marcadores `// <<fxrack` y
//      `// fxrack>>` (o en el lugar de la linea `// @@fxrack` la primera vez).
// --check: no escribe; sale con 1 si el manifiesto o el worklet no estan al dia.
// Es idempotente. NO toca C++, ui-layout.json ni CMake (ver la guia: eso se hace con el editor y `ui-layout.mjs`).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DESCRIPCION_RACK, FXR_BASE, parametrosManifiesto } from './fxrack-ids.mjs'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRASE = 'Incluye el FX Rack comun (ids 100..230, apagado por defecto): paso-altos/bajos, EQ de 6 bandas, compresor, saturacion, chorus, delay con sync, reverb y anchura; todo configurable con plugin.setParameter.'
const M_INI = '// <<fxrack', M_FIN = '// fxrack>>', M_PLACEHOLDER = '// @@fxrack'
// los marcadores son lineas completas (el texto tambien puede aparecer citado dentro de un comentario)
function posLinea(t, marca) {
  let i = t.indexOf(marca)
  while (i >= 0) {
    if ((i === 0 || t[i - 1] === '\n') && /^[ \t]*(\n|$)/.test(t.slice(i + marca.length, i + marca.length + 8))) return i
    i = t.indexOf(marca, i + 1)
  }
  return -1
}

/** Texto del bloque a incrustar (de `// <<fxrack` a `// fxrack>>` de shared-dsp/web/fxrack.js), con saltos de linea \n. */
export function bloqueFxrack() {
  const fuente = fs.readFileSync(path.join(raiz, 'shared-dsp', 'web', 'fxrack.js'), 'utf8').replace(/\r\n/g, '\n')
  const i = posLinea(fuente, M_INI), j = posLinea(fuente, M_FIN)
  if (i < 0 || j < 0) throw new Error('fxrack.js sin marcadores')
  return fuente.slice(i, j + M_FIN.length)
}

export function resolverPlugin(arg) {
  const cand = [arg, path.join(raiz, arg), path.join(raiz, `com.jaswave.plugin.${arg}`)]
  const dir = cand.find((c) => fs.existsSync(path.join(c, 'jaswave-plugin.json')))
  if (!dir) throw new Error(`plugin no encontrado: ${arg}`)
  return path.resolve(dir)
}

/** Devuelve { manifiesto, worklet } con el texto nuevo (o null si no cambia). */
export function calcular(dir) {
  const rutaMan = path.join(dir, 'jaswave-plugin.json')
  const textoMan = fs.readFileSync(rutaMan, 'utf8')
  const crlf = textoMan.includes('\r\n')
  const man = JSON.parse(textoMan)
  man.ai = man.ai ?? { summary: '', intents: [], parameters: [] }
  const propios = man.ai.parameters.filter((p) => !(p.vstParamId >= FXR_BASE && p.vstParamId < FXR_BASE + 144))
  man.ai.parameters = [...propios, ...parametrosManifiesto(FXR_BASE)]
  if (!man.ai.summary.includes('FX Rack')) {
    // ai.summary admite 1000 caracteres (esquema V5): frase completa si cabe, si no la corta
    const larga = `${man.ai.summary} ${FRASE}`.trim(), corta = `${man.ai.summary} FX Rack comun (ids 100..230, apagado).`.trim()
    man.ai.summary = larga.length <= 1000 ? larga : corta
    if (man.ai.summary.length > 1000) throw new Error('ai.summary supera 1000 caracteres: acortalo a mano antes de integrar el FX Rack')
  }
  if (man.description && !man.description.includes('Rack de mezcla comun')) man.description = `${man.description} ${DESCRIPCION_RACK}`.slice(0, 2000)
  let nuevoMan = JSON.stringify(man, null, 2) + '\n'
  if (crlf) nuevoMan = nuevoMan.replace(/\n/g, '\r\n')
  const res = { manifiesto: nuevoMan === textoMan ? null : nuevoMan, worklet: null, rutaMan, rutaWorklet: null }
  const web = man.entrypoints?.dspWeb
  if (web) {
    const ruta = path.join(dir, web)
    res.rutaWorklet = ruta
    if (fs.existsSync(ruta)) {
      const t = fs.readFileSync(ruta, 'utf8')
      const crlfW = t.includes('\r\n')
      let n = t.replace(/\r\n/g, '\n')
      const bloque = bloqueFxrack()
      const i = posLinea(n, M_INI), j = posLinea(n, M_FIN)
      const k = posLinea(n, M_PLACEHOLDER)
      if (i >= 0 && j > i) n = n.slice(0, i) + bloque + n.slice(j + M_FIN.length)
      else if (k >= 0) n = n.slice(0, k) + bloque + n.slice(k + M_PLACEHOLDER.length)
      else throw new Error(`${path.relative(raiz, ruta)}: falta el marcador "${M_PLACEHOLDER}" (o el bloque ya incrustado)`)
      if (crlfW) n = n.replace(/\n/g, '\r\n')
      res.worklet = n === t ? null : n
    }
  }
  return res
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const objetivo = args.find((a) => !a.startsWith('--'))
  if (!objetivo) { console.error('uso: node plugins/scripts/fxrack-integrar.mjs <plugin> [--check]'); process.exit(2) }
  const dir = resolverPlugin(objetivo)
  const r = calcular(dir)
  const pendientes = []
  if (r.manifiesto) pendientes.push([r.rutaMan, r.manifiesto])
  if (r.worklet) pendientes.push([r.rutaWorklet, r.worklet])
  if (check) {
    for (const [ruta] of pendientes) console.error(`desactualizado: ${path.relative(raiz, ruta)}`)
    if (pendientes.length) process.exit(1)
    console.log(`fxrack-integrar OK (${path.basename(dir)} al dia)`)
    return
  }
  for (const [ruta, texto] of pendientes) { fs.writeFileSync(ruta, texto); console.log(`actualizado: ${path.relative(raiz, ruta)}`) }
  if (!pendientes.length) console.log('sin cambios')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
