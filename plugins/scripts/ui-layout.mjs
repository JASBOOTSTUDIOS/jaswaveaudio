// Layout de los editores VST (V3): fuente única de la réplica web (V4) y comprobación de que los 13
// comparten la misma plantilla.
//   node plugins/scripts/ui-layout.mjs [--build plugins/build] [--config Release]   regenera <plugin>/ui-layout.json
//   node plugins/scripts/ui-layout.mjs --check     compara con lo que vuelca el binario (falla si difiere)
//   node plugins/scripts/ui-layout.mjs --validar   solo valida los ui-layout.json versionados (sin compilar; CI)
//   node plugins/scripts/ui-layout.mjs --capturas  además renderiza los 7 editores × 5 estados en docs/capturas
//   node plugins/scripts/ui-layout.mjs --solo-web  regenera SOLO la copia de la réplica web (layouts.json) desde los ui-layout.json versionados
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paramsEstandar } from './fxrack-ids.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const build = path.resolve(opt('build', path.join(root, 'build')))
const config = opt('config', 'Release')
const check = args.includes('--check')
const soloValidar = args.includes('--validar')
const capturas = args.includes('--capturas')
const soloWeb = args.includes('--solo-web')
// --only <nombre corto|target>: regenera solo ese ui-layout.json (plugin compilado por separado); la plantilla
// se valida contra el ui-layout.json versionado del primer plugin y la copia del módulo web no se toca.
const only = opt('only', '')

export const PLUGINS = [
  { dir: 'com.jaswave.plugin.param-eq', target: 'JasWaveParamEq', corto: 'param-eq' },
  { dir: 'com.jaswave.plugin.bus-compressor', target: 'JasWaveBusCompressor', corto: 'bus-compressor' },
  { dir: 'com.jaswave.plugin.truepeak-limiter', target: 'JasWaveTruePeakLimiter', corto: 'truepeak-limiter' },
  { dir: 'com.jaswave.plugin.smart-deesser', target: 'JasWaveSmartDeEsser', corto: 'smart-deesser' },
  { dir: 'com.jaswave.plugin.utility-tool', target: 'JasWaveUtility', corto: 'utility-tool' },
  { dir: 'com.jaswave.plugin.pedal-fix', target: 'JasWavePedalFix', corto: 'pedal-fix' },
  { dir: 'com.jaswave.plugin.piano-synth', target: 'JasWavePiano', corto: 'piano-synth' },
  { dir: 'com.jaswave.plugin.roles-vst', target: 'JasWaveRoles', corto: 'roles-vst' },
  { dir: 'com.jaswave.plugin.grand-piano', target: 'JasWaveGrandPiano', corto: 'grand-piano' },
  { dir: 'com.jaswave.plugin.worship-drums', target: 'JasWaveWorshipDrums', corto: 'worship-drums' },
  { dir: 'com.jaswave.plugin.electric-bass', target: 'JasWaveElectricBass', corto: 'electric-bass' },
  { dir: 'com.jaswave.plugin.electric-guitar', target: 'JasWaveElectricGuitar', corto: 'electric-guitar' },
  { dir: 'com.jaswave.plugin.shimmer-pad', target: 'JasWaveShimmerPad', corto: 'shimmer-pad' },
  { dir: 'com.jaswave.plugin.strings-section', target: 'JasWaveStringsSection', corto: 'strings-section' },
  { dir: 'com.jaswave.plugin.ambient-atmos', target: 'JasWaveAmbientAtmos', corto: 'ambient-atmos' },
  { dir: 'com.jaswave.plugin.vocal-tune', target: 'JasWaveVocalTune', corto: 'vocal-tune' },
]
const VISUALIZADORES = new Set(['espectro-dual', 'espectro-instrumento', 'vectorscopio', 'curva-tono'])

const dentro = (r, z, tol = 0.5) => r[0] >= z[0] - tol && r[1] >= z[1] - tol && r[2] <= z[2] + tol && r[3] <= z[3] + tol
const solape = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))

/**
 * Página «MIX / FX» (FX Rack, jw_fxrack_page.h): debe exponer los 58 parámetros estándar con sus ids, nombres, rangos y
 * valores por defecto, y sus widgets deben caber en la pantalla sin solaparse.
 */
export function validarPaginaMixFx(l) {
  const p = []
  const id = l.productId
  const pag = l.widgets.filter((w) => w.pagina === 1)
  const unico = (tipo, lista) => { if (lista.length !== 1) p.push(`${id}: debe haber exactamente un widget "${tipo}" (hay ${lista.length})`) }
  const eq = pag.filter((w) => w.tipo === 'mixfx-eq')
  unico('mixfx-eq', eq)
  unico('mixfx-gr', pag.filter((w) => w.tipo === 'mixfx-gr'))
  unico('reset-fx', pag.filter((w) => w.tipo === 'reset-fx'))
  const botonPagina = l.widgets.filter((w) => w.tipo === 'pagina' && w.paginaDestino === 1)
  unico('pagina (botón de cabecera)', botonPagina)
  if (botonPagina[0] && botonPagina[0].paginaDestino !== 1) p.push(`${id}: el botón de cabecera debe abrir la página 1`)
  if (eq.length !== 1) return p
  const base = eq[0].base
  if (base !== 100) p.push(`${id}: la base del rack debe ser 100 (FXR_BASE), no ${base}`)
  // parámetros alcanzables desde la página (perillas, interruptores, desplegables, secciones y las 6 bandas de la gráfica)
  const defs = new Map()
  for (const w of pag) if (w.param !== undefined && w.min !== undefined) defs.set(w.param, w)
  for (const b of eq[0].bandas ?? []) for (const k of ['freq', 'gain', 'q']) defs.set(b[k].param, b[k])
  if ((eq[0].bandas ?? []).length !== 6) p.push(`${id}: la gráfica del EQ debe declarar 6 bandas`)
  const cerca = (a, b) => Math.abs(a - b) < 1e-9
  for (const e of paramsEstandar()) {
    const d = defs.get(base + e.off)
    if (!d) { p.push(`${id}: la página MIX / FX no expone "${e.nombre}" (id ${base + e.off})`); continue }
    if (d.nombre !== e.nombre) p.push(`${id}: id ${base + e.off} se llama "${d.nombre}", debe ser "${e.nombre}"`)
    if (!cerca(d.min, e.min) || !cerca(d.max, e.max) || !cerca(d.defecto, e.defecto)) p.push(`${id}: "${e.nombre}" tiene rango/defecto ${d.min}..${d.max}/${d.defecto}, estándar ${e.min}..${e.max}/${e.defecto}`)
  }
  for (const [pid, d] of defs) if (pid < base || pid >= base + 144) p.push(`${id}: parámetro ${pid} ("${d.nombre}") fuera del rango del rack`)
  // todas las secciones de bloque llevan su píldora On; ningún widget de la página sale de la pantalla ni se solapa con otro
  const z = l.zonas.pantalla
  const ctrl = pag.filter((w) => !['section', 'mixfx-eq', 'mixfx-gr'].includes(w.tipo))
  for (const w of pag) if (!dentro(w.rect, [z[0], 92, z[2], z[3]])) p.push(`${id}: "${w.etiqueta || w.tipo}" (página MIX / FX) fuera de la pantalla`)
  for (let i = 0; i < ctrl.length; i++)
    for (let j = i + 1; j < ctrl.length; j++) {
      const a = ctrl[i], b = ctrl[j]
      if (solape(a.rect, b.rect) > 6 * Math.min(a.rect[2] - a.rect[0], b.rect[2] - b.rect[0])) p.push(`${id}: "${a.etiqueta}" se solapa con "${b.etiqueta}" (página MIX / FX)`)
    }
  return p
}

/**
 * Página automática «PARÁMETROS» (pagina 2): un botón de página que la abre y una rejilla dentro de la pantalla, sin
 * solapes. Junto con los widgets del editor y `parametrosCubiertos`, todos los parámetros editables del manifiesto
 * deben quedar expuestos en el modo Avanzado (100 %).
 */
export function validarPaginaParametros(l, manifiesto) {
  const p = []
  const id = l.productId
  const pag = l.widgets.filter((w) => w.pagina === 2)
  const botones = l.widgets.filter((w) => w.tipo === 'pagina' && w.paginaDestino === 2)
  if (pag.length && botones.length !== 1) p.push(`${id}: la página PARÁMETROS necesita exactamente un botón (hay ${botones.length})`)
  if (!pag.length && botones.length) p.push(`${id}: botón de PARÁMETROS sin página`)
  const z = l.zonas.pantalla
  const ctrl = pag.filter((w) => w.tipo !== 'section')
  for (const w of pag) if (!dentro(w.rect, [z[0], 92, z[2], z[3]])) p.push(`${id}: "${w.etiqueta || w.tipo}" (página PARÁMETROS) fuera de la pantalla`)
  for (let i = 0; i < ctrl.length; i++)
    for (let j = i + 1; j < ctrl.length; j++)
      if (solape(ctrl[i].rect, ctrl[j].rect) > 6 * Math.min(ctrl[i].rect[2] - ctrl[i].rect[0], ctrl[j].rect[2] - ctrl[j].rect[0]))
        p.push(`${id}: "${ctrl[i].etiqueta}" se solapa con "${ctrl[j].etiqueta}" (página PARÁMETROS)`)
  if (manifiesto) {
    const expuestos = new Set([...(l.parametrosCubiertos ?? []), ...l.widgets.filter((w) => w.param !== undefined).map((w) => w.param)])
    if (l.modoParam !== null && l.modoParam !== undefined) expuestos.add(l.modoParam)
    for (const w of l.widgets) for (const b of w.bandas ?? []) for (const k of ['freq', 'gain', 'q']) if (b[k]?.param !== undefined) expuestos.add(b[k].param)
    for (const q of manifiesto.ai?.parameters ?? []) {
      if (q.readOnly) continue
      if (!expuestos.has(q.vstParamId)) p.push(`${id}: el parámetro ${q.vstParamId} ("${q.name}") no se expone en el editor (modo Avanzado)`)
    }
  }
  return p
}

/**
 * Modo Básico: los widgets con `basico` se colocan en `rectBasico` (si se recolocan) y deben seguir dentro de su
 * zona y sin solaparse; el selector BÁSICO | AVANZADO está en la cabecera.
 */
export function validarModoBasico(l) {
  const p = []
  const id = l.productId
  const z = l.zonas
  const selector = l.widgets.filter((w) => w.tipo === 'modo')
  if (selector.length !== 1) p.push(`${id}: debe haber exactamente un selector BÁSICO | AVANZADO (hay ${selector.length})`)
  const base = l.widgets.filter((w) => !w.pagina && w.basico !== false).map((w) => ({ ...w, rect: w.rectBasico ?? w.rect }))
  if (!base.some((w) => w.param !== undefined && w.tipo !== 'section')) p.push(`${id}: el modo Básico no muestra ningún control`)
  const cabecera = [z.pantalla[0], z.pantalla[1], z.pantalla[2], z.visualizador[1]]
  const ctrl = base.filter((w) => w.tipo !== 'section')
  for (const w of ctrl) if (!dentro(w.rect, z.controles) && !dentro(w.rect, z.salida) && !dentro(w.rect, cabecera)) p.push(`${id}: "${w.etiqueta}" (${w.tipo}) sale de su zona en el modo Básico`)
  for (let i = 0; i < ctrl.length; i++)
    for (let j = i + 1; j < ctrl.length; j++)
      if (solape(ctrl[i].rect, ctrl[j].rect) > 6 * Math.min(ctrl[i].rect[2] - ctrl[i].rect[0], ctrl[j].rect[2] - ctrl[j].rect[0]))
        p.push(`${id}: "${ctrl[i].etiqueta}" se solapa con "${ctrl[j].etiqueta}" en el modo Básico`)
  return p
}

/** Comprueba un layout y devuelve la lista de problemas (vacía si es coherente con la plantilla). */
export function validarLayout(l, referencia, manifiesto) {
  const p = []
  const id = l.productId
  // los widgets de páginas extra (MIX / FX, PARÁMETROS) se validan aparte: la plantilla estándar solo describe el editor base
  const todos = l.widgets
  p.push(...validarModoBasico(l))
  p.push(...validarPaginaParametros(l, manifiesto))
  l = { ...l, widgets: todos.filter((w) => !w.pagina) }
  if (todos.some((w) => w.pagina === 1)) p.push(...validarPaginaMixFx({ ...l, widgets: todos }))
  if (!VISUALIZADORES.has(l.visualizador)) p.push(`${id}: visualizador desconocido "${l.visualizador}"`)
  if (!/^#[0-9A-F]{6}$/.test(l.acento)) p.push(`${id}: acento inválido`)
  if (referencia && JSON.stringify(l.zonas) !== JSON.stringify(referencia.zonas)) p.push(`${id}: las zonas no coinciden con ${referencia.productId}`)
  if (l.escalas?.caidaDbS !== 14 || l.escalas?.dbfs?.[0] !== -120 || l.escalas?.dbfs?.[1] !== 0) p.push(`${id}: escalas distintas de las de V3`)
  const z = l.zonas
  const secciones = l.widgets.filter((w) => w.tipo === 'section')
  const controles = secciones.filter((w) => JSON.stringify(w.rect) === JSON.stringify(z.controles))
  const salida = secciones.filter((w) => JSON.stringify(w.rect) === JSON.stringify(z.salida))
  if (controles.length !== 1) p.push(`${id}: debe haber exactamente una sección de controles en la zona estándar`)
  if (salida.length !== 1) p.push(`${id}: debe haber exactamente una sección SALIDA en la zona estándar`)
  if (secciones.length !== 2) p.push(`${id}: secciones fuera de la plantilla (${secciones.length})`)
  // fader (o medidor en su hueco) en la posición estándar
  const enFader = l.widgets.filter((w) => (w.tipo === 'fader' && JSON.stringify(w.rect) === JSON.stringify(z.fader)) ||
    (w.tipo === 'meter' && dentro(w.rect, z.fader, 1) && Math.abs((w.rect[0] + w.rect[2]) / 2 - (z.fader[0] + z.fader[2]) / 2) < 1))
  if (enFader.length !== 1) p.push(`${id}: el hueco del fader de SALIDA debe tener un fader o un medidor`)
  if (l.widgets.some((w) => w.tipo === 'fader' && JSON.stringify(w.rect) !== JSON.stringify(z.fader))) p.push(`${id}: fader fuera de su sitio`)
  // medidores IN/OUT estéreo en la misma x
  const est = l.widgets.filter((w) => w.tipo === 'meter' && w.rect[0] >= z.medidores.x - 0.5 && w.rect[1] === z.medidores.arriba && w.rect[3] === z.medidores.abajo)
  if (est.length !== 4 || Math.min(...est.map((w) => w.rect[0])) !== z.medidores.x) p.push(`${id}: faltan los 4 medidores IN/OUT en x=${z.medidores.x}`)
  // bypass: si el plugin lo tiene, es la píldora de SALIDA
  const bypass = l.widgets.find((w) => w.param !== undefined && /bypass/i.test(w.nombre ?? '') && w.tipo !== 'section')
  if (bypass) p.push(`${id}: el bypass debe ir en la píldora de SALIDA, no como control suelto`)
  // todo control dentro de su zona y sin solaparse con otro de la misma zona
  const cabecera = [z.pantalla[0], z.pantalla[1], z.pantalla[2], z.visualizador[1]]
  const controlesW = l.widgets.filter((w) => w.tipo !== 'section')
  for (const w of controlesW) {
    if (!dentro(w.rect, z.controles) && !dentro(w.rect, z.salida) && !dentro(w.rect, cabecera)) p.push(`${id}: "${w.etiqueta}" (${w.tipo}) fuera de las zonas estándar`)
  }
  for (let i = 0; i < controlesW.length; i++)
    for (let j = i + 1; j < controlesW.length; j++) {
      const a = controlesW[i], b = controlesW[j]
      // las perillas incluyen su etiqueta: se toleran 6 px de roce vertical
      if (solape(a.rect, b.rect) > 6 * Math.min(a.rect[2] - a.rect[0], b.rect[2] - b.rect[0])) p.push(`${id}: "${a.etiqueta}" se solapa con "${b.etiqueta}"`)
    }
  return p
}

const MODULO_WEB = path.join(root, 'com.jaswave.modulo.editores-vst', 'src', 'generado')

/** Escribe (o comprueba) los layouts con el nombre de cada plugin y el isotipo para el módulo web. */
function generarParaModulo(layouts, soloComprobar) {
  if (!fs.existsSync(path.dirname(MODULO_WEB))) return 0
  const nombres = Object.fromEntries(
    PLUGINS.map((p) => [JSON.parse(fs.readFileSync(path.join(root, p.dir, 'jaswave-plugin.json'), 'utf8')).id, JSON.parse(fs.readFileSync(path.join(root, p.dir, 'jaswave-plugin.json'), 'utf8')).name]),
  )
  const archivos = {
    'layouts.json': JSON.stringify(layouts.map((layout) => ({ nombre: nombres[layout.productId], layout })), null, 2) + '\n',
    'isotipo.ts':
      '// Generado por plugins/scripts/ui-layout.mjs desde plugins/shared-ui/recursos/jaswave-isotipo.png (no editar)\n' +
      `export const ISOTIPO = 'data:image/png;base64,${fs.readFileSync(path.join(root, 'shared-ui', 'recursos', 'jaswave-isotipo.png')).toString('base64')}'\n`,
  }
  let fallos = 0
  fs.mkdirSync(MODULO_WEB, { recursive: true })
  for (const [nombre, texto] of Object.entries(archivos)) {
    const ruta = path.join(MODULO_WEB, nombre)
    if (soloComprobar) {
      if (!fs.existsSync(ruta) || fs.readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n') !== texto) {
        console.error(`${path.relative(root, ruta)} no está al día (ejecuta node plugins/scripts/ui-layout.mjs)`)
        fallos++
      }
    } else fs.writeFileSync(ruta, texto)
  }
  return fallos
}

function volcar(p, destino) {
  const exe = path.join(build, 'tools', config, `${p.target}_snapshot.exe`)
  if (!fs.existsSync(exe)) { console.error(`falta ${exe}: compila los plugins (cmake --build plugins/build --config ${config})`); process.exit(2) }
  execFileSync(exe, ['--dump-layout', destino], { stdio: 'pipe' })
  return JSON.parse(fs.readFileSync(destino, 'utf8'))
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-layout-'))
  const layouts = []
  let fallos = 0
  const seleccion = only ? PLUGINS.filter((p) => p.corto === only || p.target === only) : PLUGINS
  if (!seleccion.length) { console.error(`--only ${only}: ningún plugin con ese nombre`); process.exit(2) }
  const referenciaVersionada = path.join(root, PLUGINS[0].dir, 'ui-layout.json')
  const referencia = only && fs.existsSync(referenciaVersionada) ? JSON.parse(fs.readFileSync(referenciaVersionada, 'utf8')) : null
  for (const p of seleccion) {
    const versionado = path.join(root, p.dir, 'ui-layout.json')
    if (soloValidar || soloWeb) {
      if (!fs.existsSync(versionado)) { console.error(`falta ${path.relative(root, versionado)}`); fallos++; continue }
      layouts.push(JSON.parse(fs.readFileSync(versionado, 'utf8')))
      continue
    }
    const l = volcar(p, path.join(tmp, `${p.target}.json`))
    const texto = JSON.stringify(l, null, 2) + '\n'
    if (check) {
      if (!fs.existsSync(versionado) || fs.readFileSync(versionado, 'utf8').replace(/\r\n/g, '\n') !== texto) {
        console.error(`${p.dir}/ui-layout.json no coincide con el editor compilado (ejecuta node plugins/scripts/ui-layout.mjs)`)
        fallos++
      }
    } else fs.writeFileSync(versionado, texto)
    layouts.push(l)
    if (capturas) {
      const out = path.join(root, 'docs', 'capturas')
      const exe = path.join(build, 'tools', config, `${p.target}_snapshot.exe`)
      const salida = execFileSync(exe, ['--out', out, '--name', p.corto], { encoding: 'utf8' })
      process.stdout.write(salida)
    }
  }
  for (const [i, l] of layouts.entries()) {
    const manifiesto = JSON.parse(fs.readFileSync(path.join(root, seleccion[i].dir, 'jaswave-plugin.json'), 'utf8'))
    for (const e of validarLayout(l, referencia ?? layouts[0], manifiesto)) { console.error('  - ' + e); fallos++ }
  }
  // Copia para la réplica web (módulo independiente: no puede importar fuera de su paquete)
  if (layouts.length === PLUGINS.length) fallos += generarParaModulo(layouts, (check || soloValidar) && !soloWeb)
  fs.rmSync(tmp, { recursive: true, force: true })
  if (fallos) { console.error(`ui-layout: ${fallos} problemas`); process.exit(1) }
  console.log(`ui-layout OK (${layouts.length} editores con la misma plantilla)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
