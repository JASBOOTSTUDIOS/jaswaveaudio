// Verifica que un plugin tiene integrado el FX Rack comun: los 8 bloques de parametros con los ids, nombres, rangos y
// valores por defecto ESTANDAR (plugins/shared-dsp/jw_fxrack.h), en el manifiesto, el codigo, el layout y el worklet web.
//   node plugins/scripts/fxrack-comprobar.mjs <plugin> [<plugin> ...] [--dump <ruta a <Plugin>_snapshot.exe>]
//   node plugins/scripts/fxrack-comprobar.mjs --todos [--estricto]     los 7 instrumentos (los no integrados: "pendiente")
// <plugin>: directorio, o nombre corto (p. ej. shimmer-pad). --dump compara ademas con la tabla REAL del binario
// (`<Plugin>_snapshot --dump-params`). Sale con 1 si algun plugin integrado falla (con --estricto, tambien si falta integrar).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLOQUES, FXR_BASE, FXR_RANGO, paramsEstandar } from './fxrack-ids.mjs'
import { calcular, resolverPlugin } from './fxrack-integrar.mjs'
import { validarPaginaMixFx } from './ui-layout.mjs'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INSTRUMENTOS = ['grand-piano', 'worship-drums', 'electric-bass', 'electric-guitar', 'shimmer-pad', 'strings-section', 'ambient-atmos']
const cerca = (a, b) => Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b))
const escalaManifiesto = (e) => (e.escala === 'stepped' ? 'enum' : e.escala)

/** Comprueba un plugin; devuelve { integrado, problemas, bloques: {bloque: n/total} }. */
export function comprobarPlugin(dir, opciones = {}) {
  const std = paramsEstandar()
  const problemas = []
  const nombre = path.basename(dir)
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'jaswave-plugin.json'), 'utf8'))
  const params = man.ai?.parameters ?? []
  const enRango = params.filter((p) => p.vstParamId >= FXR_BASE && p.vstParamId < FXR_BASE + FXR_RANGO)
  const codigo = leerFuentes(dir)
  const usaRegistro = /JW_FXRACK_REGISTRAR|JasWaveFx::registrarParametros/.test(codigo)
  const integrado = enRango.length > 0 || usaRegistro
  const bloques = Object.fromEntries(BLOQUES.map((b) => [b, [0, std.filter((e) => e.bloque === b).length]]))
  if (!integrado) return { integrado: false, problemas: ['sin integrar (ni parametros 100..243 en el manifiesto ni JW_FXRACK_REGISTRAR en el codigo)'], bloques }

  // 1) manifiesto: los 58 parametros con id, clave, nombre, rango y defecto estandar; nada propio dentro del rango del rack
  for (const e of std) {
    const p = params.find((q) => q.vstParamId === FXR_BASE + e.off)
    if (!p) { problemas.push(`manifiesto: falta ${e.nombre} (vstParamId ${FXR_BASE + e.off})`); continue }
    let ok = true
    const mal = (m) => { ok = false; problemas.push(`manifiesto: ${e.nombre}: ${m}`) }
    if (p.id !== e.id) mal(`id "${p.id}" debe ser "${e.id}"`)
    if (!String(p.name).startsWith(e.nombre)) mal(`nombre "${p.name}" debe empezar por "${e.nombre}"`)
    if (!cerca(p.min, e.min) || !cerca(p.max, e.max) || !cerca(p.default, e.defecto)) mal(`rango/defecto ${p.min}..${p.max}/${p.default}, estandar ${e.min}..${e.max}/${e.defecto}`)
    if (p.scale !== escalaManifiesto(e)) mal(`escala "${p.scale}", estandar "${escalaManifiesto(e)}"`)
    if ((p.unit ?? '') !== e.unidad) mal(`unidad "${p.unit}", estandar "${e.unidad}"`)
    if (e.escala === 'stepped' && JSON.stringify(p.values ?? []) !== JSON.stringify(e.opciones)) mal(`values ${JSON.stringify(p.values)}, estandar ${JSON.stringify(e.opciones)}`)
    if (ok) bloques[e.bloque][0]++
  }
  const estandarIds = new Set(std.map((e) => FXR_BASE + e.off))
  for (const p of enRango) if (!estandarIds.has(p.vstParamId)) problemas.push(`manifiesto: parametro ${p.vstParamId} ("${p.name}") dentro del rango reservado del rack sin ser estandar`)
  if (!(man.ai?.summary ?? '').includes('FX Rack')) problemas.push('manifiesto: ai.summary no menciona el FX Rack')

  // 2) codigo: registro de parametros, lectura en updateParams y pagina de la interfaz
  if (!usaRegistro) problemas.push('codigo: falta JW_FXRACK_REGISTRAR(v) en paramDefs()')
  if (!/FxParams/.test(codigo) || !/\.leer\(/.test(codigo)) problemas.push('codigo: falta FxParams::leer(...) en updateParams()')
  if (!/\.setFx\(|\.setParams\(/.test(codigo)) problemas.push('codigo: falta pasar los FxParams al motor (setFx / FxRack::setParams)')
  if (!/FxRack|\.process\(/.test(codigo) && !/setFx\(/.test(codigo)) problemas.push('codigo: falta procesar el rack (FxRack::process)')
  if (!/paginaMixFx\(/.test(codigo)) problemas.push('codigo: falta P::paginaMixFx(c) al final de build() del editor')

  // 3) ui-layout.json: pagina MIX / FX completa y valida
  const rutaLayout = path.join(dir, 'ui-layout.json')
  if (!fs.existsSync(rutaLayout)) problemas.push('falta ui-layout.json')
  else problemas.push(...validarPaginaMixFx(JSON.parse(fs.readFileSync(rutaLayout, 'utf8'))).map((m) => `layout: ${m}`))

  // 4) worklet web: copia incrustada al dia + registro
  if (man.entrypoints?.dspWeb) {
    try {
      const r = calcular(dir)
      if (r.worklet) problemas.push(`web: ${man.entrypoints.dspWeb} no esta al dia con shared-dsp/web/fxrack.js (node plugins/scripts/fxrack-integrar.mjs ${nombre})`)
      if (r.manifiesto) problemas.push(`manifiesto: no esta al dia (node plugins/scripts/fxrack-integrar.mjs ${nombre})`)
      const w = fs.readFileSync(r.rutaWorklet, 'utf8')
      if (!/fxRegistrarParametros\(\s*PARAMS\s*,\s*PARAM_IDS\s*\)/.test(w)) problemas.push('web: falta fxRegistrarParametros(PARAMS, PARAM_IDS)')
      if (!/new FxRack\(/.test(w) || !/\.fx\.process\(/.test(w)) problemas.push('web: el motor no crea/procesa el FxRack (new FxRack(sr) y this.fx.process(...))')
      if (!/FXR_BASE/.test(w) || !/\.fx\.setParam\(/.test(w)) problemas.push('web: setParam no enruta los ids >= 100 a fx.setParam')
    } catch (err) {
      problemas.push(`web: ${err.message}`)
    }
  }

  // 5) tabla real del binario (opcional)
  if (opciones.dump) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jw-fxr-')), 'params.json')
    try {
      execFileSync(opciones.dump, ['--dump-params', tmp], { stdio: 'pipe' })
      const real = JSON.parse(fs.readFileSync(tmp, 'utf8')).parameters
      for (const e of std) {
        const r = real.find((q) => q.vstParamId === FXR_BASE + e.off)
        if (!r) { problemas.push(`binario: falta el parametro ${FXR_BASE + e.off} (${e.nombre})`); continue }
        const mal = (m) => problemas.push(`binario: ${e.nombre}: ${m}`)
        if (r.name !== e.nombre) mal(`se llama "${r.name}"`)
        if (!cerca(r.min, e.min) || !cerca(r.max, e.max) || !cerca(r.default, e.defecto)) mal(`rango/defecto ${r.min}..${r.max}/${r.default}, estandar ${e.min}..${e.max}/${e.defecto}`)
        if ((r.units ?? '') !== e.unidad) mal(`unidad "${r.units}", estandar "${e.unidad}"`)
        if (e.escala === 'log' && r.map !== 'log') mal(`mapeo "${r.map}", estandar log`)
        if (e.escala === 'linear' && r.map !== 'linear') mal(`mapeo "${r.map}", estandar linear`)
        if ((e.escala === 'stepped' || e.escala === 'toggle') && (r.map !== 'stepped' || r.steps !== e.pasos)) mal(`pasos ${r.steps}, estandar ${e.pasos}`)
      }
      const ultimo = real[real.length - 1]
      if (ultimo.vstParamId !== FXR_BASE + 130) problemas.push(`binario: el bloque del rack debe ir AL FINAL de la lista (ultimo id ${ultimo.vstParamId})`)
      for (const r of real) if (r.vstParamId >= FXR_BASE && r.vstParamId < FXR_BASE + FXR_RANGO && !estandarIds.has(r.vstParamId)) problemas.push(`binario: id ${r.vstParamId} en el rango del rack sin ser estandar`)
    } catch (err) {
      problemas.push(`binario: no se pudo volcar la tabla (${err.message.split('\n')[0]})`)
    }
  }
  return { integrado: true, problemas, bloques }
}

function leerFuentes(dir) {
  const out = []
  for (const sub of ['source', 'src']) {
    const d = path.join(dir, sub)
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) if (/\.(h|hpp|cpp)$/.test(f)) out.push(fs.readFileSync(path.join(d, f), 'utf8'))
  }
  return out.join('\n')
}

function main() {
  const args = process.argv.slice(2)
  const estricto = args.includes('--estricto')
  const iDump = args.indexOf('--dump')
  const dump = iDump >= 0 ? path.resolve(args[iDump + 1]) : null
  let objetivos = args.filter((a, i) => !a.startsWith('--') && i !== iDump + 1)
  if (args.includes('--todos')) objetivos = INSTRUMENTOS
  if (!objetivos.length) { console.error('uso: node plugins/scripts/fxrack-comprobar.mjs <plugin...> [--dump <exe>] | --todos [--estricto]'); process.exit(2) }
  let fallos = 0
  for (const o of objetivos) {
    const dir = resolverPlugin(o)
    const r = comprobarPlugin(dir, { dump })
    const resumen = BLOQUES.map((b) => `${b} ${r.bloques[b][0]}/${r.bloques[b][1]}`).join(' | ')
    if (!r.integrado) {
      console.log(`${path.basename(dir)}: PENDIENTE (sin integrar)`)
      if (estricto) fallos++
      continue
    }
    console.log(`${path.basename(dir)}: ${r.problemas.length ? 'FALLA' : 'OK'}  [${resumen}]`)
    for (const p of r.problemas) console.log(`  - ${p}`)
    if (r.problemas.length) fallos++
  }
  if (fallos) { console.error(`fxrack-comprobar: ${fallos} plugin(s) con problemas`); process.exit(1) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
