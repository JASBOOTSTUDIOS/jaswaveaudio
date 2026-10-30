/**
 * Generador de fichas de ayuda desde el código (U-maestra F2).
 *
 *   npm run ayuda:generar     -> escribe el JSON versionado
 *   npm run ayuda:comprobar   -> falla si el JSON versionado no coincide con lo que se generaría
 *
 * Se ejecuta con tsx (importa TOOL_CATALOG, abrir-pantalla y el catálogo de acciones, que son .ts).
 * Fuentes REALES: TOOL_CATALOG (núcleo), `herramientas: [...]` de cada módulo (se leen del código fuente, porque se
 * registran en tiempo de ejecución), ids de abrir-pantalla.ts, menús de app-menu-bar.tsx, manifiestos
 * jaswave-plugin.json de plugins/com.jaswave.plugin.* y shared/src/actions/catalog.ts.
 * Los textos de manifiestos de terceros se tratan como DATOS: se normalizan y se acotan, nunca se interpretan.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_CATALOG } from '../src/workspace/types.ts'
import { listarPantallasAbribles, resolverPantalla } from '../src/lib/abrir-pantalla.ts'
import { ACTION_CATALOG } from '../../shared/src/actions/catalog.ts'
import { validarFichas, formatearErrores } from '../../ai-harness/src/ayuda/validacion.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const RAIZ = resolve(AQUI, '..', '..')
export const RUTA_SALIDA = join(RAIZ, 'plugins', 'com.jaswave.modulo.asistente-ia', 'src', 'ayuda', 'generada', 'ayuda.generada.json')
export const COMANDO_REGENERAR = 'npm run ayuda:generar  (desde jas-wave/)'
const MAX_TEXTO = 400
const SIN_DESCRIPCION = 'sin descripción'

const leer = (ruta) => readFileSync(ruta, 'utf8').replace(/\r\n/g, '\n')

/** Texto de origen externo: sin caracteres de control, espacios colapsados y longitud acotada. */
export function limpiarTexto(t) {
  if (typeof t !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  const s = t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > MAX_TEXTO ? `${s.slice(0, MAX_TEXTO - 1).trimEnd()}…` : s
}

const ZONAS = { left: 'izquierda', right: 'derecha', center: 'centro', bottom: 'inferior' }

function carpetas(prefijo) {
  const dir = join(RAIZ, 'plugins')
  return readdirSync(dir)
    .filter((n) => n.startsWith(prefijo) && statSync(join(dir, n)).isDirectory())
    .sort()
}

function archivosSrc(dir, acum = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivosSrc(p, acum)
    else if (/\.(ts|tsx)$/.test(n)) acum.push(p)
  }
  return acum
}

const RE_CADENA = (clave) =>
  new RegExp(`\\b${clave}\\s*:\\s*(?:'((?:\\\\.|[^'\\\\])*)'|"((?:\\\\.|[^"\\\\])*)"|([A-Za-z_]\\w*))`)

function campo(cuerpo, clave) {
  const m = RE_CADENA(clave).exec(cuerpo)
  if (!m) return null
  if (m[1] !== undefined) return { valor: m[1].replace(/\\'/g, "'") }
  if (m[2] !== undefined) return { valor: m[2].replace(/\\"/g, '"') }
  return { ident: m[3] }
}

function resolverIdent(ident, archivos) {
  const re = new RegExp(`\\bconst\\s+${ident}\\s*=\\s*'([^']*)'`)
  for (const a of archivos) {
    const m = re.exec(leer(a))
    if (m) return m[1]
  }
  throw new Error(`No pude resolver la constante «${ident}» de una herramienta de módulo.`)
}

/** Extrae el literal `herramientas: [ {...}, ... ]` de un módulo. */
export function extraerHerramientasModulo(codigo, archivosModulo) {
  const ini = codigo.indexOf('herramientas: [')
  if (ini < 0) return []
  let i = ini + 'herramientas: ['.length
  let prof = 1
  let comilla = null
  const desde = i
  for (; i < codigo.length && prof > 0; i++) {
    const c = codigo[i]
    if (comilla) {
      if (c === '\\') i++
      else if (c === comilla) comilla = null
    } else if (c === "'" || c === '"' || c === '`') comilla = c
    else if (c === '[') prof++
    else if (c === ']') prof--
  }
  const bloque = codigo.slice(desde, i - 1)
  const res = []
  for (const m of bloque.matchAll(/\{([^{}]*)\}/g)) {
    const cuerpo = m[1]
    const id = campo(cuerpo, 'id')
    if (!id) continue
    const idv = id.ident ? resolverIdent(id.ident, archivosModulo) : id.valor
    const t = campo(cuerpo, 'titulo')
    const d = campo(cuerpo, 'descripcion')
    const z = campo(cuerpo, 'zona')
    res.push({
      id: idv,
      titulo: t?.valor ?? '',
      descripcion: d?.valor ?? '',
      zona: z?.valor ?? '',
      bajoDemanda: /\bbajoDemanda\s*:\s*true\b/.test(cuerpo),
    })
  }
  return res
}

/** Herramientas aportadas por módulos (leídas del código fuente de cada módulo). */
export function leerHerramientasModulos() {
  const res = []
  for (const carpeta of carpetas('com.jaswave.modulo.')) {
    const base = join(RAIZ, 'plugins', carpeta)
    const man = join(base, 'jaswave-plugin.json')
    const index = join(base, 'src', 'index.tsx')
    if (!existsSync(index)) continue
    const nombreModulo = existsSync(man) ? limpiarTexto(JSON.parse(leer(man)).name) : carpeta
    const archivos = archivosSrc(join(base, 'src'))
    for (const h of extraerHerramientasModulo(leer(index), archivos)) res.push({ ...h, modulo: carpeta, nombreModulo })
  }
  return res
}

/** Herramientas del núcleo: TOOL_CATALOG real (antes de que ningún módulo registre las suyas). */
export function leerHerramientasNucleo() {
  return Object.values(TOOL_CATALOG)
    .filter((d) => !d.moduloId)
    .map((d) => ({
      id: d.id,
      titulo: d.title,
      descripcion: d.description,
      zona: d.defaultZone,
      bajoDemanda: !!d.bajoDemanda,
    }))
}

/** Menús de app-menu-bar.tsx: id de acción -> { ruta «Menú > Opción», atajo }. */
export function leerMenus() {
  const codigo = leer(join(RAIZ, 'jas-wave', 'components', 'app-menu-bar.tsx'))
  const ini = codigo.indexOf('const MENUS')
  const fin = codigo.indexOf('function dispatchMenuAction')
  if (ini < 0 || fin < 0) throw new Error('No encuentro MENUS en app-menu-bar.tsx; actualiza el generador.')
  const t = codigo.slice(ini, fin)
  const grupos = [...t.matchAll(/\{\s*id:\s*'(\w+)',\s*label:\s*'([^']+)',\s*items:\s*\[/g)].map((m) => ({ pos: m.index, etiqueta: m[2] }))
  const res = {}
  for (const m of t.matchAll(/\{\s*type:\s*'action',\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'(?:,\s*shortcut:\s*'([^']+)')?/g)) {
    const g = [...grupos].reverse().find((x) => x.pos < m.index)
    res[m[1]] = { ruta: `${g ? `${g.etiqueta} > ` : ''}${m[2]}`, etiqueta: m[2], atajo: m[3] ?? null }
  }
  return res
}

/** Manifiestos de plugins JasWave (solo carpetas com.jaswave.plugin.* que tengan manifiesto). */
export function leerPlugins() {
  const res = []
  for (const carpeta of carpetas('com.jaswave.plugin.')) {
    const man = join(RAIZ, 'plugins', carpeta, 'jaswave-plugin.json')
    if (!existsSync(man)) continue
    const j = JSON.parse(leer(man))
    const ai = j.ai && typeof j.ai === 'object' ? j.ai : {}
    const params = Array.isArray(ai.parameters) ? ai.parameters : []
    res.push({
      carpeta,
      nombre: carpeta.slice('com.jaswave.plugin.'.length),
      titulo: limpiarTexto(j.name),
      categoria: limpiarTexto(j.category),
      resumen: limpiarTexto(ai.summary),
      descripcion: limpiarTexto(j.description),
      intents: (Array.isArray(ai.intents) ? ai.intents : []).map(limpiarTexto).filter(Boolean),
      numParametros: params.length,
      parametrosBasicos: params.filter((p) => p && p.basico === true).map((p) => limpiarTexto(p.name)).filter(Boolean),
    })
  }
  return res
}

export function leerAcciones() {
  return ACTION_CATALOG.map((a) => ({
    id: a.id,
    nombre: a.name,
    descripcion: a.description,
    categoria: a.category,
    contexto: a.context,
    alias: a.aliases ? [...a.aliases] : [],
    atajos: a.defaultShortcuts ? [...a.defaultShortcuts] : [],
  }))
}

const humanizar = (id) => {
  const s = id.replace(/^dlg\./, '').replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Construye todas las fichas a partir de las fuentes. Pura y determinista. */
export function construirFichas(fuentes) {
  const abribles = new Set(fuentes.abribles)
  const fichas = []
  const vistos = new Map()
  const poner = (f) => {
    if (vistos.has(f.id)) throw new Error(`Id de ficha duplicado al generar: ${f.id} (${vistos.get(f.id)} y ${f.origen ?? '?'})`)
    vistos.set(f.id, f.origen ?? '?')
    delete f.origen
    fichas.push(f)
  }

  // Paneles: núcleo + módulos.
  const herramientas = [
    ...fuentes.nucleo.map((h) => ({ ...h, aporta: null })),
    ...fuentes.modulos.map((h) => ({ ...h, aporta: h.nombreModulo })),
  ]
  for (const h of herramientas) {
    const desc = limpiarTexto(h.descripcion)
    const zona = ZONAS[h.zona]
    const partes = [desc ? `${desc}.`.replace(/\.\.$/, '.') : `Panel «${limpiarTexto(h.titulo) || h.id}» (${SIN_DESCRIPCION} en el código).`]
    if (zona) partes.push(`Zona por defecto: ${zona}.`)
    if (h.bajoDemanda) partes.push('No se coloca solo: aparece cuando se abre.')
    if (h.aporta) partes.push(`Lo aporta el módulo «${h.aporta}».`)
    const ficha = {
      id: `panel:${h.id}`,
      tipo: 'panel',
      titulo: limpiarTexto(h.titulo) || h.id,
      resumen: partes.join(' '),
      nivel: 'principiante',
      etiquetas: [h.id],
      fuente: 'generada',
      origen: 'panel',
    }
    if (abribles.has(h.id)) ficha.comoAbrir = { herramienta: h.id }
    poner(ficha)
  }

  // Pantallas (diálogos abribles).
  for (const id of fuentes.abribles.filter((x) => x.startsWith('dlg.'))) {
    const via = fuentes.vias[id]
    const nombre = id.slice(4)
    const menu = via?.via === 'M' ? fuentes.menus[via.menuId] : null
    const ficha = {
      id: `pantalla:${nombre}`,
      tipo: 'pantalla',
      titulo: menu ? menu.etiqueta : humanizar(id),
      resumen: menu
        ? `Diálogo que se abre desde el menú «${menu.ruta}».`
        : `Diálogo «${nombre}» (${SIN_DESCRIPCION} en el código).`,
      nivel: 'principiante',
      comoAbrir: { herramienta: id, ...(menu ? { menu: menu.ruta } : {}), ...(menu?.atajo ? { atajo: menu.atajo } : {}) },
      etiquetas: [id],
      fuente: 'generada',
      origen: 'pantalla',
    }
    poner(ficha)
  }

  // Plugins.
  for (const p of fuentes.plugins) {
    const base = p.resumen || p.descripcion || `Plugin «${p.titulo || p.nombre}» (${SIN_DESCRIPCION} en su manifiesto).`
    const extra = []
    if (p.categoria) extra.push(`Categoría: ${p.categoria}.`)
    if (p.numParametros) {
      const basicos = p.parametrosBasicos.slice(0, 5)
      extra.push(`${p.numParametros} parámetros${basicos.length ? ` (básicos: ${basicos.join(', ')}${p.parametrosBasicos.length > 5 ? ', …' : ''})` : ''}.`)
    }
    poner({
      id: `plugin:${p.nombre}`,
      tipo: 'plugin',
      titulo: p.titulo || p.nombre,
      resumen: [base, ...extra].join(' '),
      nivel: 'intermedio',
      etiquetas: [...new Set([p.nombre, ...p.intents, ...(p.categoria ? [p.categoria] : [])])],
      fuente: 'generada',
      origen: 'plugin',
    })
  }

  // Acciones del DAW (catálogo de acciones con atajos).
  for (const a of fuentes.acciones) {
    const desc = limpiarTexto(a.descripcion)
    const resumen = [
      desc ? `${desc}.`.replace(/\.\.$/, '.') : `Acción «${a.nombre}» (${SIN_DESCRIPCION} en el catálogo).`,
      `Categoría: ${a.categoria}.`,
    ].join(' ')
    const ficha = {
      id: `herramienta:${a.id.toLowerCase()}`,
      tipo: 'herramienta',
      titulo: a.nombre,
      resumen,
      nivel: 'intermedio',
      etiquetas: [a.id, ...a.alias],
      fuente: 'generada',
      origen: `accion:${a.id}`,
    }
    if (a.atajos.length) ficha.comoAbrir = { atajo: a.atajos.join(' / ') }
    poner(ficha)
  }

  return fichas.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}

export function leerFuentes() {
  const abribles = listarPantallasAbribles()
  const vias = {}
  for (const id of abribles) vias[id] = resolverPantalla(id)
  return {
    nucleo: leerHerramientasNucleo(),
    modulos: leerHerramientasModulos(),
    abribles,
    vias,
    menus: leerMenus(),
    plugins: leerPlugins(),
    acciones: leerAcciones(),
  }
}

/** Genera el documento completo (cabecera, huella y fichas). */
export function generarAyuda(fuentes = leerFuentes()) {
  const fichas = construirFichas(fuentes)
  const errores = validarFichas(fichas)
  if (errores.length) throw new Error(`Las fichas generadas no son válidas:\n${formatearErrores(errores)}`)
  const huella = createHash('sha256').update(JSON.stringify(fuentes)).digest('hex')
  const cuenta = (t) => fichas.filter((f) => f.tipo === t).length
  return {
    _aviso: `GENERADO por jas-wave/scripts/generar-ayuda.mjs. NO EDITAR A MANO. Regenerar con: ${COMANDO_REGENERAR}. Las fichas curadas viven en src/ayuda/curado/ y ganan a estas con el mismo id.`,
    huellaFuentes: huella,
    fuentes: {
      herramientasNucleo: fuentes.nucleo.length,
      herramientasModulos: fuentes.modulos.length,
      pantallasAbribles: fuentes.abribles.length,
      plugins: fuentes.plugins.length,
      acciones: fuentes.acciones.length,
    },
    totales: { panel: cuenta('panel'), pantalla: cuenta('pantalla'), plugin: cuenta('plugin'), herramienta: cuenta('herramienta') },
    fichas,
  }
}

export const serializar = (doc) => `${JSON.stringify(doc, null, 2)}\n`

function main() {
  const comprobar = process.argv.includes('--comprobar')
  const texto = serializar(generarAyuda())
  if (comprobar) {
    const actual = existsSync(RUTA_SALIDA) ? readFileSync(RUTA_SALIDA, 'utf8').replace(/\r\n/g, '\n') : null
    if (actual !== texto) {
      console.error(`El JSON de ayuda versionado NO coincide con las fuentes actuales (${RUTA_SALIDA}).\nRegenera con: ${COMANDO_REGENERAR}`)
      process.exit(1)
    }
    console.log('Ayuda generada al día.')
    return
  }
  mkdirSync(dirname(RUTA_SALIDA), { recursive: true })
  writeFileSync(RUTA_SALIDA, texto, 'utf8')
  console.log(`Escrito ${RUTA_SALIDA}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
