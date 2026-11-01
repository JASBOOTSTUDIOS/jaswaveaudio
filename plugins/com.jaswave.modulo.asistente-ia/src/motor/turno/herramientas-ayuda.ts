/**
 * Herramientas del agente de la «maestra del DAW» (U-maestra F6): consultar la ayuda y MOSTRAR en la interfaz.
 *
 *   consultar_ayuda(consulta, tipo?)      lectura: busca en las fichas (F1/F2).
 *   abrir_pantalla(id)                    ui: abre un panel o diálogo (F4 `abrirPantalla`).
 *   resaltar(id, texto)                   ui: halo + globo sobre un control con id de ayuda REGISTRADO.
 *   guiar_paso_a_paso(pasos[])            ui: cola de hasta 20 pasos con condición `hastaQue` cerrada.
 *
 * ── CÓMO ENGANCHARLAS (F7, en `turno-agente.ts`; este archivo NO toca turno-agente.ts) ─────────────────────
 *  1. Catálogo: añadir `...herramientasAyuda()` a la lista de herramientas del agente (donde se arma el catálogo,
 *     cuando hay intención de enseñanza o siempre; llevan `clase: 'lectura'` en el sentido del bucle del agente,
 *     es decir «no modifican el proyecto»: están disponibles en todos los modos y no piden confirmación).
 *  2. Ejecución: en `ejecutar(l, h)` de `turno-agente.ts`, justo DESPUÉS de `ejecutarHerramientaIde(...)` y ANTES de
 *     `const a = accion(l)` / `executeTools`, añadir:
 *         const ayuda = esHerramientaAyuda(l.nombre) ? await ejecutarHerramientaAyuda(l) : null
 *         if (ayuda) return ayuda
 *     Así NUNCA llegan al ejecutor de comandos (`ctx.executeTools` / `tienda.executor.execute`): no mutan el
 *     proyecto, no escriben undo ni auditoría de proyecto.
 *  3. Registro (una vez, al activar el módulo o en la primera llamada; es idempotente): `registrarAyudaEnHost()`.
 *     `ejecutarHerramientaAyuda` ya lo llama de forma perezosa, pero conviene llamarlo al activar el módulo para que
 *     los predicados de estado existan antes de la primera guía.
 *  4. Política: los nombres están clasificados en `AGENT_ACTION_CLASSES` (ai-harness): `consultar_ayuda` = read,
 *     `abrir_pantalla`/`resaltar`/`guiar_paso_a_paso` = ui (se permite en todos los modos, sin confirmación).
 *     Si el motor clasifica por esa tabla (`agentActionClassOfType`), no hace falta nada más.
 *  5. Límite de aperturas por turno (plan §3.1: 3): lo aplica quien llame con `contarAperturas` (ver abajo) o F7.
 *
 * ── Seguridad ────────────────────────────────────────────────────────────────────────────────────────────────
 *  - El modelo NUNCA decide selectores CSS: solo ids lógicos (`[a-z0-9][a-z0-9:._-]{0,63}`). `resaltar` y los pasos
 *    solo aceptan ids que el host tenga REGISTRADOS (paneles de serie + controles con `ayuda` de las fichas).
 *  - Los textos de las fichas son datos no confiables: de ellas solo se toman ids (validados por el host) y
 *    nunca se ejecutan ni se interpretan como instrucciones.
 *  - Ninguna de estas herramientas hace clic ni escribe por el usuario.
 */
import {
  getSharedStore,
  iniciarGuia,
  listarIdsAyuda,
  listarPantallasAbribles,
  abrirPantalla,
  registrarIdsAyuda,
  registrarPredicadoEstado,
  resaltarElemento,
} from '@jaswave/host-sdk'
import {
  H_CONSULTAR_AYUDA,
  ejecutarConsultarAyuda,
  herramientaConsultarAyuda,
} from '@jaswave/host-sdk'
import type { FichaAyuda, HerramientaAgente, IndiceAyuda, LlamadaAgente, ResultadoHerramienta } from '@jaswave/host-sdk'

import { cargarAyuda } from '../../ayuda/cargador'
import { estilosDelUsuario } from '../habilidades-agentes'

export const H_ABRIR_PANTALLA = 'abrir_pantalla'
export const H_RESALTAR = 'resaltar'
export const H_GUIAR_PASO_A_PASO = 'guiar_paso_a_paso'

/** Nombres de las herramientas de ayuda (la consulta es lectura; las otras tres son de solo interfaz). */
export const HERRAMIENTAS_AYUDA: readonly string[] = [H_CONSULTAR_AYUDA, H_ABRIR_PANTALLA, H_RESALTAR, H_GUIAR_PASO_A_PASO]
export const HERRAMIENTAS_AYUDA_UI: readonly string[] = [H_ABRIR_PANTALLA, H_RESALTAR, H_GUIAR_PASO_A_PASO]

export const MAX_TEXTO_AYUDA = 140
export const MAX_PASOS_GUIA = 20
export const MAX_APERTURAS_POR_TURNO = 3

const RE_ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/

export const esHerramientaAyuda = (nombre: string): boolean => HERRAMIENTAS_AYUDA.includes(nombre)

// ─── Predicados de estado (catálogo CERRADO, solo lectura) ───────────────────────────────────────────────────

/** Lo mínimo que se lee del estado del DAW (estructural: no depende de la forma completa de DAWState). */
export type EstadoLecturaGuia = {
  project?: { tracks?: ReadonlyArray<{ tipo?: string; armada?: boolean; clips?: ReadonlyArray<{ tipo?: string; notas?: readonly unknown[] }> }> }
  transport?: { reproduciendo?: boolean; grabacion?: string }
}

export type ContextoPredicados = {
  estado: () => EstadoLecturaGuia
  /** Número de estilos del usuario guardados (skills de estilo). */
  estilosGuardados: () => number
}

const pistas = (e: EstadoLecturaGuia) => e.project?.tracks ?? []
const esPistaMidi = (t: { tipo?: string }) => t.tipo === 'midi' || t.tipo === 'instrumento'

/** Nombre → descripción corta (la que ve el modelo) y lectura. Añadir uno exige añadirlo aquí Y probarlo. */
export const PREDICADOS_GUIA: Readonly<Record<string, { descripcion: string; evaluar: (c: ContextoPredicados) => boolean }>> = Object.freeze({
  'hay-pistas': { descripcion: 'el proyecto tiene al menos una pista', evaluar: (c) => pistas(c.estado()).length > 0 },
  'hay-pista-midi-armada': {
    descripcion: 'hay una pista MIDI o de instrumento armada para grabar',
    evaluar: (c) => pistas(c.estado()).some((t) => esPistaMidi(t) && t.armada === true),
  },
  'hay-clip-en-pista': { descripcion: 'alguna pista tiene al menos un clip', evaluar: (c) => pistas(c.estado()).some((t) => (t.clips?.length ?? 0) > 0) },
  'hay-clip-midi-con-notas': {
    descripcion: 'hay un clip MIDI con notas',
    evaluar: (c) => pistas(c.estado()).some((t) => (t.clips ?? []).some((k) => k.tipo === 'midi' && (k.notas?.length ?? 0) > 0)),
  },
  grabando: { descripcion: 'el transporte está grabando', evaluar: (c) => c.estado().transport?.grabacion === 'grabando' },
  reproduciendo: { descripcion: 'el transporte está reproduciendo', evaluar: (c) => c.estado().transport?.reproduciendo === true },
  'hay-estilo-guardado': { descripcion: 'el usuario ya guardó un estilo («Mi estilo»)', evaluar: (c) => c.estilosGuardados() > 0 },
})

export const NOMBRES_PREDICADOS: readonly string[] = Object.freeze(Object.keys(PREDICADOS_GUIA))

// ─── Dependencias inyectables (en producción, el SDK del host) ────────────────────────────────────────────────

export type DepsAyuda = {
  fichas: () => { fichas: readonly FichaAyuda[]; indice: IndiceAyuda }
  abrirPantalla: (id: string) => { abierto: boolean; motivo: string }
  pantallasAbribles: () => string[]
  idsRegistrados: () => string[]
  resaltar: (p: { id: string; texto: string }) => { ok: true } | { ok: false; motivo: string }
  iniciarGuia: (pasos: PasoEntrante[]) => { ok: true } | { ok: false; motivo: string }
  registrarIds: (ids: Array<string | { id: string; toolViewport?: string }>) => { registrados: string[]; rechazados: string[] }
  registrarPredicado: (nombre: string, fn: () => boolean) => void
  predicados: ContextoPredicados
}

type PasoEntrante = { texto: string; abrir?: string; resaltar?: string; hastaQue?: Record<string, unknown> }

export function depsPorDefecto(): DepsAyuda {
  return {
    fichas: () => cargarAyuda(),
    abrirPantalla: (id) => abrirPantalla(id),
    pantallasAbribles: () => listarPantallasAbribles(),
    idsRegistrados: () => listarIdsAyuda(),
    resaltar: (p) => resaltarElemento(p),
    iniciarGuia: (pasos) => iniciarGuia(pasos as Parameters<typeof iniciarGuia>[0]),
    registrarIds: (ids) => registrarIdsAyuda(ids),
    registrarPredicado: (n, f) => registrarPredicadoEstado(n, f),
    predicados: {
      estado: () => getSharedStore().obtenerEstado() as unknown as EstadoLecturaGuia,
      estilosGuardados: () => estilosDelUsuario().length,
    },
  }
}

/**
 * Registra en el host los ids de ayuda de las fichas (controles con `ayuda`) y el catálogo cerrado de predicados.
 * Idempotente. Devuelve lo registrado y lo rechazado (ids con forma inválida: se ignoran, nunca se usan).
 */
export function registrarAyudaEnHost(deps: DepsAyuda = depsPorDefecto()): { ids: string[]; rechazados: string[]; predicados: string[] } {
  const entradas: Array<{ id: string; toolViewport?: string }> = []
  for (const f of deps.fichas().fichas) {
    const tv = f.comoAbrir?.herramienta
    for (const c of f.controles ?? []) {
      if (typeof c.ayuda === 'string') entradas.push({ id: c.ayuda, ...(tv && RE_ID.test(tv) ? { toolViewport: tv } : {}) })
    }
  }
  const r = deps.registrarIds(entradas)
  for (const [nombre, p] of Object.entries(PREDICADOS_GUIA)) deps.registrarPredicado(nombre, () => p.evaluar(deps.predicados))
  return { ids: r.registrados, rechazados: r.rechazados, predicados: [...NOMBRES_PREDICADOS] }
}

let registrado = false
function asegurarRegistro(deps: DepsAyuda, esPorDefecto: boolean): void {
  if (esPorDefecto && registrado) return
  try {
    registrarAyudaEnHost(deps)
    if (esPorDefecto) registrado = true
  } catch {
    /* el registro es una ayuda; si el host aún no lo ofrece, las validaciones siguientes lo dirán */
  }
}

// ─── Definiciones ────────────────────────────────────────────────────────────────────────────────────────────

const ID_PROP = { type: 'string', pattern: '^[a-z0-9][a-z0-9:._-]{0,63}$', maxLength: 64 }

/** Las 4 herramientas. Se enchufan en el catálogo del agente (ver cabecera). */
export function herramientasAyuda(): HerramientaAgente[] {
  const predicados = NOMBRES_PREDICADOS.map((n) => `${n} (${PREDICADOS_GUIA[n]!.descripcion})`).join('; ')
  return [
    herramientaConsultarAyuda(),
    {
      nombre: H_ABRIR_PANTALLA,
      descripcion:
        'Abre un panel o diálogo del DAW por su id (p. ej. «mixer», «piano-roll», «panel:library», «dlg.exportar-bounce»). Solo cambia la interfaz; no modifica el proyecto. Úsala solo cuando el usuario lo pidió o aceptó que se la muestres. Si el id no existe, responde con ids parecidos: usa uno de esos, no inventes ids.',
      parametros: { type: 'object', properties: { id: { ...ID_PROP, description: 'Id de la pantalla (id de una ficha de ayuda o id de panel/diálogo).' } }, required: ['id'], additionalProperties: false },
      clase: 'lectura',
      titulo: 'Abriendo una pantalla',
      etiquetas: ['abrir', 'mostrar', 'pantalla', 'panel', 'donde esta', 'ir a'],
    },
    {
      nombre: H_RESALTAR,
      descripcion: `Señala un control de la interfaz con un halo y un globo de texto (≤ ${MAX_TEXTO_AYUDA} caracteres, p. ej. «Aquí armas la pista»). Solo acepta ids de ayuda registrados (los «ayuda» de los controles que devuelve consultar_ayuda). Nunca uses selectores CSS ni nombres inventados. No hace clic por el usuario.`,
      parametros: {
        type: 'object',
        properties: {
          id: { ...ID_PROP, description: 'Id de ayuda del control o panel (el campo «ayuda» de una ficha, o el id de un panel).' },
          texto: { type: 'string', minLength: 1, maxLength: MAX_TEXTO_AYUDA, description: 'Qué hace ese control, en una frase corta.' },
        },
        required: ['id', 'texto'],
        additionalProperties: false,
      },
      clase: 'lectura',
      titulo: 'Señalando un control',
      etiquetas: ['resaltar', 'señalar', 'indicar', 'donde esta', 'mostrar'],
    },
    {
      nombre: H_GUIAR_PASO_A_PASO,
      descripcion: `Guía al usuario paso a paso por la interfaz (hasta ${MAX_PASOS_GUIA} pasos). Cada paso muestra un texto y, opcionalmente, abre una pantalla y resalta un control; avanza cuando se cumple «hastaQue» o el usuario pulsa Siguiente. hastaQue.tipo: «manual» (el usuario pulsa Siguiente), «tool-abierta» (id = panel que debe abrirse), «clic» (id = control con id de ayuda que debe pulsar) o «estado» (id = uno de: ${predicados}). Solo cambia la interfaz; la guía nunca graba, crea ni guarda nada por el usuario.`,
      parametros: {
        type: 'object',
        properties: {
          pasos: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_PASOS_GUIA,
            items: {
              type: 'object',
              properties: {
                texto: { type: 'string', minLength: 1, maxLength: MAX_TEXTO_AYUDA, description: 'Lo que el usuario debe hacer o ver en este paso.' },
                abrir: { ...ID_PROP, description: 'Id de pantalla a abrir en este paso (opcional).' },
                resaltar: { ...ID_PROP, description: 'Id de ayuda del control a resaltar (opcional).' },
                hastaQue: {
                  type: 'object',
                  properties: { tipo: { type: 'string', enum: ['manual', 'tool-abierta', 'clic', 'estado'] }, id: { ...ID_PROP, description: 'Requerido salvo en «manual».' } },
                  required: ['tipo'],
                  additionalProperties: false,
                },
              },
              required: ['texto'],
              additionalProperties: false,
            },
          },
        },
        required: ['pasos'],
        additionalProperties: false,
      },
      clase: 'lectura',
      titulo: 'Preparando la guía',
      etiquetas: ['guiar', 'paso a paso', 'tutorial', 'ensenar', 'leccion', 'recorrido'],
    },
  ]
}

// ─── Ejecución ───────────────────────────────────────────────────────────────────────────────────────────────

const texto1 = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const idValido = (v: unknown): v is string => typeof v === 'string' && RE_ID.test(v)
const corto = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Ids parecidos (prefijo, subcadena o palabras en común) entre las pantallas abribles y los ids de las fichas. */
export function idsParecidos(id: string, candidatos: Iterable<string>, max = 5): string[] {
  const q = id.toLowerCase().replace(/^(panel|dialogo|pantalla|dlg)[:.]/, '')
  const palabras = q.split(/[^a-z0-9]+/).filter((p) => p.length > 1)
  const puntuados: Array<[string, number]> = []
  for (const c of new Set(candidatos)) {
    const k = c.toLowerCase().replace(/^(panel|dialogo|pantalla|dlg)[:.]/, '')
    let p = 0
    if (k === q) p += 10
    if (q.length > 1 && (k.includes(q) || q.includes(k))) p += 5
    for (const w of palabras) if (k.includes(w)) p += 2
    if (p > 0) puntuados.push([c, p])
  }
  return puntuados.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(([c]) => c)
}

function resolverAbrible(id: string, deps: DepsAyuda, fichas: readonly FichaAyuda[]): string | null {
  const abribles = new Set(deps.pantallasAbribles())
  const sinPrefijo = id.startsWith('panel:') ? id.slice(6) : id
  if (abribles.has(sinPrefijo)) return sinPrefijo
  const ficha = fichas.find((f) => f.id === id)
  const h = ficha?.comoAbrir?.herramienta
  if (h && abribles.has(h)) return h
  return null
}

function abrir(l: LlamadaAgente, deps: DepsAyuda): ResultadoHerramienta {
  const id = l.argumentos.id
  if (!idValido(id)) return { ok: false, error: 'Falta «id» o no es válido: usa el id de una pantalla (p. ej. «mixer»), no un selector.' }
  const { fichas } = deps.fichas()
  const destino = resolverAbrible(id, deps, fichas)
  if (!destino) {
    const ficha = fichas.find((f) => f.id === id)
    if (ficha) {
      const donde = ficha.comoAbrir?.menu ?? ficha.comoAbrir?.atajo
      return {
        ok: true,
        resumen: 'No se puede abrir por código',
        datos: {
          abierto: false,
          motivo: `No puedo abrir «${corto(ficha.titulo)}» por código${donde ? `; está en ${corto(donde, 120)}` : ''}. Dile dónde está y, si hay un control con id de ayuda, ofrécele resaltarlo.`,
        },
      }
    }
    const parecidos = idsParecidos(id, [...deps.pantallasAbribles(), ...fichas.map((f) => f.id)])
    return {
      ok: false,
      error: `No existe la pantalla «${corto(id)}». ${parecidos.length ? `Ids parecidos: ${parecidos.join(', ')}.` : 'Consulta la ayuda para encontrar el id.'}`,
      datos: { abierto: false, motivo: 'id desconocido', parecidos },
    }
  }
  const r = deps.abrirPantalla(destino)
  return { ok: r.abierto, resumen: r.abierto ? `Abierto: ${destino}` : 'No se abrió', datos: { abierto: r.abierto, motivo: r.motivo, id: destino }, ...(r.abierto ? {} : { error: r.motivo }) }
}

function resaltar(l: LlamadaAgente, deps: DepsAyuda): ResultadoHerramienta {
  const id = l.argumentos.id
  const texto = texto1(l.argumentos.texto)
  if (!idValido(id)) return { ok: false, error: 'El «id» no es un id de ayuda válido. No se aceptan selectores CSS: usa el campo «ayuda» de una ficha.' }
  if (!texto) return { ok: false, error: 'Falta «texto»: una frase corta que diga qué hace el control.' }
  if (texto.length > MAX_TEXTO_AYUDA) return { ok: false, error: `«texto» tiene ${texto.length} caracteres; el máximo es ${MAX_TEXTO_AYUDA}. Acórtalo.` }
  if (!deps.idsRegistrados().includes(id)) {
    const parecidos = idsParecidos(id, deps.idsRegistrados())
    return { ok: false, error: `El id «${corto(id)}» no está registrado para resaltar. ${parecidos.length ? `Ids parecidos: ${parecidos.join(', ')}.` : 'Usa los ids «ayuda» de consultar_ayuda.'}`, datos: { parecidos } }
  }
  const r = deps.resaltar({ id, texto })
  return r.ok ? { ok: true, resumen: 'Control señalado', datos: { resaltado: id } } : { ok: false, error: r.motivo }
}

/** Convierte el `hastaQue` simple del modelo (o el nativo de F4) a la forma cerrada de F4. */
function normalizarHastaQue(h: unknown): { valor?: Record<string, unknown>; error?: string } {
  if (h === undefined || h === null) return {}
  if (typeof h !== 'object' || Array.isArray(h)) return { error: 'hastaQue inválido' }
  const o = h as Record<string, unknown>
  if ('tipo' in o) {
    const extra = Object.keys(o).filter((k) => k !== 'tipo' && k !== 'id')
    if (extra.length) return { error: 'hastaQue inválido' }
    if (o.tipo === 'manual') return { valor: { manual: true } }
    if (!idValido(o.id)) return { error: `hastaQue «${String(o.tipo)}» necesita un «id» válido` }
    if (o.tipo === 'tool-abierta') return { valor: { evento: 'tool-abierta', id: o.id } }
    if (o.tipo === 'clic') return { valor: { clic: o.id } }
    if (o.tipo === 'estado') return { valor: { estado: o.id } }
    return { error: 'hastaQue.tipo debe ser manual, tool-abierta, clic o estado' }
  }
  return { valor: o } // forma nativa de F4: iniciarGuia la valida (claves cerradas)
}

function guiar(l: LlamadaAgente, deps: DepsAyuda): ResultadoHerramienta {
  const pasosIn = l.argumentos.pasos
  if (!Array.isArray(pasosIn) || pasosIn.length === 0) return { ok: false, error: 'Falta «pasos»: una lista con al menos un paso.' }
  if (pasosIn.length > MAX_PASOS_GUIA) return { ok: false, error: `Demasiados pasos (${pasosIn.length}); el máximo es ${MAX_PASOS_GUIA}.` }
  const { fichas } = deps.fichas()
  const registrados = new Set(deps.idsRegistrados())
  const pasos: PasoEntrante[] = []
  for (let i = 0; i < pasosIn.length; i++) {
    const p = pasosIn[i] as Record<string, unknown> | null
    const n = i + 1
    if (!p || typeof p !== 'object') return { ok: false, error: `Paso ${n}: formato inválido.` }
    const extra = Object.keys(p).filter((k) => !['texto', 'abrir', 'resaltar', 'hastaQue'].includes(k))
    if (extra.length) return { ok: false, error: `Paso ${n}: campos no permitidos (${extra.slice(0, 3).join(', ')}).` }
    const texto = texto1(p.texto)
    if (!texto) return { ok: false, error: `Paso ${n}: falta «texto».` }
    if (texto.length > MAX_TEXTO_AYUDA) return { ok: false, error: `Paso ${n}: «texto» supera ${MAX_TEXTO_AYUDA} caracteres.` }
    const paso: PasoEntrante = { texto }
    if (p.abrir !== undefined) {
      if (!idValido(p.abrir)) return { ok: false, error: `Paso ${n}: «abrir» no es un id válido.` }
      const destino = resolverAbrible(p.abrir, deps, fichas)
      if (!destino) return { ok: false, error: `Paso ${n}: no se puede abrir «${corto(p.abrir)}». Ids parecidos: ${idsParecidos(p.abrir, deps.pantallasAbribles()).join(', ') || 'ninguno'}.` }
      paso.abrir = destino
    }
    if (p.resaltar !== undefined) {
      if (!idValido(p.resaltar) || !registrados.has(p.resaltar)) return { ok: false, error: `Paso ${n}: «resaltar» no es un id de ayuda registrado (no uses selectores).` }
      paso.resaltar = p.resaltar
    }
    const h = normalizarHastaQue(p.hastaQue)
    if (h.error) return { ok: false, error: `Paso ${n}: ${h.error}.` }
    if (h.valor) paso.hastaQue = h.valor
    pasos.push(paso)
  }
  const r = deps.iniciarGuia(pasos)
  return r.ok ? { ok: true, resumen: `Guía de ${pasos.length} paso(s)`, datos: { pasos: pasos.length, aviso: 'La guía ya se muestra al usuario; avanza con sus acciones o con Siguiente. No hagas nada por él.' } } : { ok: false, error: r.motivo }
}

/**
 * Cuenta aperturas (`abrir_pantalla` exitosas) de un turno y rechaza a partir de `max`. F7 lo usa envolviendo
 * `ejecutarHerramientaAyuda` con un contador por turno.
 */
export function contarAperturas(max = MAX_APERTURAS_POR_TURNO): (l: LlamadaAgente, r: ResultadoHerramienta) => ResultadoHerramienta | null {
  let n = 0
  return (l, r) => {
    if (l.nombre !== H_ABRIR_PANTALLA || !r.ok) return null
    n++
    return n > max ? { ok: false, error: `Límite de ${max} pantallas abiertas por turno. Pregunta al usuario antes de abrir más.` } : null
  }
}

/**
 * Ejecuta una llamada a las herramientas de ayuda. Devuelve `null` si no es una herramienta de ayuda (para que el
 * llamador siga con su ruta normal). NUNCA llama al ejecutor de comandos del proyecto.
 */
export async function ejecutarHerramientaAyuda(l: LlamadaAgente, deps?: DepsAyuda): Promise<ResultadoHerramienta | null> {
  if (!esHerramientaAyuda(l.nombre)) return null
  const d = deps ?? depsPorDefecto()
  asegurarRegistro(d, deps === undefined)
  const args = l.argumentos && typeof l.argumentos === 'object' ? l.argumentos : {}
  const llamada = { ...l, argumentos: args }
  try {
    switch (l.nombre) {
      case H_CONSULTAR_AYUDA:
        return ejecutarConsultarAyuda(llamada, d.fichas().indice)
      case H_ABRIR_PANTALLA:
        return abrir(llamada, d)
      case H_RESALTAR:
        return resaltar(llamada, d)
      default:
        return guiar(llamada, d)
    }
  } catch (e) {
    return { ok: false, error: `No se pudo completar la acción de ayuda: ${e instanceof Error ? e.message : String(e)}` }
  }
}

