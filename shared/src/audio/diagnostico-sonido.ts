/**
 * Diagnóstico de sonido por pista: ¿cada pista con música va a sonar como debe?
 *
 * Revisa lo que el análisis de audio no siempre oye (los instrumentos VST/MIDI): pistas MIDI sin
 * instrumento, instrumentos que no cargaron o están en bypass, pistas silenciadas o tapadas por el
 * solo de otra, y faders casi a cero o muy por debajo del resto. Cada problema trae la herramienta
 * con la que se corrige, para que el agente pueda arreglarlo sin adivinar.
 *
 * El estado de carga de los VST vive en la app: se inyecta con `registrarSondaPlugins`. Sin sonda
 * (CLI, tests) se usa solo lo que dice el proyecto.
 */

import type { PluginInfo } from '../types/entidades'
import type { DAWState } from '../types/state'
import type { Track } from '../types/tracks'

/** Lo que la app sabe del instrumento que hace sonar una pista. */
export type EstadoInstrumento = {
  plugin: PluginInfo | null
  /** Motivo legible si el host no pudo cargarlo. */
  error?: string
  /** false mientras el host todavía no lo tiene listo para sonar. */
  listo?: boolean
}

export type SondaPlugins = (pista: Track) => EstadoInstrumento

let sondaActual: SondaPlugins | null = null
let instrumentosActual: (() => string[]) | null = null

/**
 * Registra (o quita) la sonda de plugins de la app. `instrumentos` lista los instrumentos instalados
 * que se pueden cargar, para que la solución diga nombres reales en vez de «busca uno».
 */
export function registrarSondaPlugins(sonda: SondaPlugins | null, instrumentos?: () => string[]): void {
  sondaActual = sonda
  instrumentosActual = sonda ? (instrumentos ?? null) : null
}

/** Instrumentos instalados (hasta 12), o [] si la app no los ha registrado. */
export function instrumentosInstalados(): string[] {
  try {
    return [...new Set(instrumentosActual?.() ?? [])].slice(0, 12)
  } catch {
    return []
  }
}

function sugerirInstrumentos(): string {
  const l = instrumentosInstalados()
  return l.length ? ` Instrumentos instalados: ${l.map((n) => `«${n}»`).join(', ')}.` : ''
}

export type TipoProblemaSonido =
  | 'sin_instrumento'
  | 'instrumento_error'
  | 'instrumento_cargando'
  | 'instrumento_bypass'
  | 'silenciada'
  | 'tapada_por_solo'
  | 'carpeta_silenciada'
  | 'volumen_muy_bajo'
  | 'volumen_desequilibrado'

/** Etapa de la producción que debe corregirlo: el músico carga instrumentos, la mezcla ajusta faders. */
export type ResponsableSonido = 'musico' | 'mezcla'

export type ProblemaSonido = {
  trackId: string
  pista: string
  tipo: TipoProblemaSonido
  severidad: 'critico' | 'aviso'
  responsable: ResponsableSonido
  mensaje: string
  /** Cómo corregirlo con las herramientas del DAW. */
  solucion: string
}

export type DiagnosticoSonido = {
  ok: boolean
  pistasRevisadas: number
  problemas: ProblemaSonido[]
  /** Instrumentos que se pueden cargar con track.addVstLayer (si la app los registró). */
  instrumentosInstalados?: string[]
}

/** Por debajo de esto (≈ −26 dB) la pista prácticamente no se oye. */
export const VOLUMEN_MINIMO = 0.05
/** Más de ≈ 18 dB por debajo de la pista más fuerte se considera desequilibrado. */
const RELACION_DESEQUILIBRIO = 0.125

const CON_MUSICA = new Set(['audio', 'midi', 'instrumento'])

const db = (v: number) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1).replace('.', ',')} dB` : '−∞ dB')

function tieneNotas(t: Track): boolean {
  return (t.clips ?? []).some((c) => c.tipo === 'midi' && (c.notas ?? []).length > 0)
}

function tieneContenido(t: Track): boolean {
  return (t.clips ?? []).length > 0
}

/** Instrumento según el proyecto, si no hay sonda de la app. */
function instrumentoSinSonda(t: Track): EstadoInstrumento {
  const propio = (t as Track & { instrumento?: PluginInfo }).instrumento
  const enCadena = (t.plugins ?? []).find((p) => !p.bypass && (p.tipo === 'instrumento' || p.categoria === 'instrumento' || p.categoria === 'synth'))
  const plugin = enCadena ?? (propio && !propio.bypass ? propio : null)
  return { plugin, error: plugin?.estado === 'error' ? 'El instrumento no se pudo cargar.' : undefined }
}

function instrumentoEnBypass(t: Track): PluginInfo | null {
  const propio = (t as Track & { instrumento?: PluginInfo }).instrumento
  const todos = [...(propio ? [propio] : []), ...(t.plugins ?? [])]
  return todos.find((p) => p.bypass && (p.tipo === 'instrumento' || p.categoria === 'instrumento' || p.categoria === 'synth')) ?? null
}

/**
 * Revisa las pistas con partes grabadas y devuelve los problemas que impiden que suenen bien.
 * `pistas` limita la revisión a esos ids.
 */
export function diagnosticarSonidoPistas(
  estado: DAWState,
  opts: { sonda?: SondaPlugins | null; pistas?: string[] } = {},
): DiagnosticoSonido {
  const sonda = opts.sonda === undefined ? sondaActual : opts.sonda
  const todas = estado.project?.tracks ?? []
  const porId = new Map(todas.map((t) => [t.id, t]))
  const haySolo = todas.some((t) => t.soloActiva)
  const revisar = todas.filter((t) => CON_MUSICA.has(t.tipo) && tieneContenido(t) && (!opts.pistas?.length || opts.pistas.includes(t.id)))
  const problemas: ProblemaSonido[] = []
  const add = (t: Track, p: Omit<ProblemaSonido, 'trackId' | 'pista'>) => problemas.push({ trackId: t.id, pista: t.nombre, ...p })

  for (const t of revisar) {
    if (t.tipo !== 'audio' && tieneNotas(t)) {
      const inst = sonda ? sonda(t) : instrumentoSinSonda(t)
      if (!inst.plugin) {
        const apagado = instrumentoEnBypass(t)
        if (apagado) {
          add(t, {
            tipo: 'instrumento_bypass',
            severidad: 'critico',
            responsable: 'musico',
            mensaje: `«${t.nombre}» tiene notas pero su instrumento «${apagado.nombre}» está desactivado (bypass): no suena.`,
            solucion: `Activa el instrumento: plugin.bypass con trackId "${t.id}", pluginInstanceId "${apagado.id}" y bypass false.`,
          })
        } else {
          add(t, {
            tipo: 'sin_instrumento',
            severidad: 'critico',
            responsable: 'musico',
            mensaje: `«${t.nombre}» tiene notas MIDI pero ningún instrumento cargado: no suena.`,
            solucion: `Carga un instrumento VST3 adecuado: track.addVstLayer con trackId "${t.id}" y nombre = el del instrumento.${sugerirInstrumentos()}`,
          })
        }
      } else if (inst.error) {
        add(t, {
          tipo: 'instrumento_error',
          severidad: 'critico',
          responsable: 'musico',
          mensaje: `El instrumento «${inst.plugin.nombre}» de «${t.nombre}» no cargó: ${inst.error}`,
          solucion: `Carga otro instrumento VST3 con track.addVstLayer en trackId "${t.id}" (pasa a ser el que suena). Quitar el que falla (plugin.remove, pluginInstanceId "${inst.plugin.id}") pide confirmación al usuario.${sugerirInstrumentos()}`,
        })
      } else if (inst.listo === false) {
        add(t, {
          tipo: 'instrumento_cargando',
          severidad: 'aviso',
          responsable: 'musico',
          mensaje: `El instrumento «${inst.plugin.nombre}» de «${t.nombre}» todavía se está cargando.`,
          solucion: 'Espera unos segundos y vuelve a revisar; si sigue igual, cámbialo por otro VST3.',
        })
      }
    }

    if (t.silenciada) {
      add(t, {
        tipo: 'silenciada',
        severidad: 'critico',
        responsable: 'mezcla',
        mensaje: `«${t.nombre}» está silenciada (mute).`,
        solucion: `Quita el mute: track.update con trackId "${t.id}" y datos { "silenciada": false }.`,
      })
    } else if (haySolo && !t.soloActiva && !t.soloSeguro) {
      add(t, {
        tipo: 'tapada_por_solo',
        severidad: 'critico',
        responsable: 'mezcla',
        mensaje: `«${t.nombre}» no se oye porque otra pista está en solo.`,
        solucion: 'Quita el solo de las demás pistas: track.update con datos { "soloActiva": false } en cada una.',
      })
    }

    let padre = t.padreId ? porId.get(t.padreId) : undefined
    for (let i = 0; padre && i < 16; i++, padre = padre.padreId ? porId.get(padre.padreId) : undefined) {
      if (padre.silenciada) {
        add(t, {
          tipo: 'carpeta_silenciada',
          severidad: 'critico',
          responsable: 'mezcla',
          mensaje: `«${t.nombre}» está dentro de la carpeta «${padre.nombre}», que está silenciada.`,
          solucion: `Quita el mute de la carpeta: track.update con trackId "${padre.id}" y datos { "silenciada": false }.`,
        })
        break
      }
    }
  }

  const volumenes = revisar.map((t) => (Number.isFinite(t.volumen) ? t.volumen : 1))
  const maximo = Math.max(0, ...volumenes)
  revisar.forEach((t, i) => {
    const v = volumenes[i]!
    if (v < VOLUMEN_MINIMO) {
      add(t, {
        tipo: 'volumen_muy_bajo',
        severidad: 'critico',
        responsable: 'mezcla',
        mensaje: `El fader de «${t.nombre}» está casi a cero (${db(v)}): apenas se oye.`,
        solucion: `Sube el volumen: track.update con trackId "${t.id}" y datos { "volumen": 0.7 } (lineal, 1 = 0 dB).`,
      })
    } else if (revisar.length > 1 && v < maximo * RELACION_DESEQUILIBRIO) {
      add(t, {
        tipo: 'volumen_desequilibrado',
        severidad: 'aviso',
        responsable: 'mezcla',
        mensaje: `«${t.nombre}» está muy por debajo del resto (${db(v)} frente a ${db(maximo)}).`,
        solucion: `Equilibra el fader: track.update con trackId "${t.id}" y datos { "volumen": … } más cerca del resto.`,
      })
    }
  })

  const instalados = instrumentosInstalados()
  return {
    ok: !problemas.some((p) => p.severidad === 'critico'),
    pistasRevisadas: revisar.length,
    problemas,
    ...(instalados.length ? { instrumentosInstalados: instalados } : {}),
  }
}
