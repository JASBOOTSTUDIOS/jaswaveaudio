// Layout de los editores VST (V3): fuente única de la réplica web (V4) y comprobación de que los 7
// comparten la misma plantilla.
//   node plugins/scripts/ui-layout.mjs [--build plugins/build] [--config Release]   regenera <plugin>/ui-layout.json
//   node plugins/scripts/ui-layout.mjs --check     compara con lo que vuelca el binario (falla si difiere)
//   node plugins/scripts/ui-layout.mjs --validar   solo valida los ui-layout.json versionados (sin compilar; CI)
//   node plugins/scripts/ui-layout.mjs --capturas  además renderiza los 7 editores × 5 estados en docs/capturas
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] ? args[i + 1] : d }
const build = path.resolve(opt('build', path.join(root, 'build')))
const config = opt('config', 'Release')
const check = args.includes('--check')
const soloValidar = args.includes('--validar')
const capturas = args.includes('--capturas')

export const PLUGINS = [
  { dir: 'com.jaswave.plugin.param-eq', target: 'JasWaveParamEq', corto: 'param-eq' },
  { dir: 'com.jaswave.plugin.bus-compressor', target: 'JasWaveBusCompressor', corto: 'bus-compressor' },
  { dir: 'com.jaswave.plugin.truepeak-limiter', target: 'JasWaveTruePeakLimiter', corto: 'truepeak-limiter' },
  { dir: 'com.jaswave.plugin.smart-deesser', target: 'JasWaveSmartDeEsser', corto: 'smart-deesser' },
  { dir: 'com.jaswave.plugin.utility-tool', target: 'JasWaveUtility', corto: 'utility-tool' },
  { dir: 'com.jaswave.plugin.piano-synth', target: 'JasWavePiano', corto: 'piano-synth' },
  { dir: 'com.jaswave.plugin.roles-vst', target: 'JasWaveRoles', corto: 'roles-vst' },
]
const VISUALIZADORES = new Set(['espectro-dual', 'espectro-instrumento', 'vectorscopio'])

const dentro = (r, z, tol = 0.5) => r[0] >= z[0] - tol && r[1] >= z[1] - tol && r[2] <= z[2] + tol && r[3] <= z[3] + tol
const solape = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))

/** Comprueba un layout y devuelve la lista de problemas (vacía si es coherente con la plantilla). */
export function validarLayout(l, referencia) {
  const p = []
  const id = l.productId
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
  for (const p of PLUGINS) {
    const versionado = path.join(root, p.dir, 'ui-layout.json')
    if (soloValidar) {
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
  for (const l of layouts) {
    for (const e of validarLayout(l, layouts[0])) { console.error('  - ' + e); fallos++ }
  }
  // Copia para la réplica web (módulo independiente: no puede importar fuera de su paquete)
  if (layouts.length === PLUGINS.length) fallos += generarParaModulo(layouts, check || soloValidar)
  fs.rmSync(tmp, { recursive: true, force: true })
  if (fallos) { console.error(`ui-layout: ${fallos} problemas`); process.exit(1) }
  console.log(`ui-layout OK (${layouts.length} editores con la misma plantilla)`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
