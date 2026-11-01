/**
 * Propuestas de grooves al catálogo (renderer). Nada sale del equipo sin permiso del usuario: ni el interruptor
 * «Compartir mis grooves…» (apagado por defecto) ni el botón «Proponer al catálogo» envían algo sin que el usuario
 * haya aceptado el texto de consentimiento. Antes de enviar se compara por contenido MIDI (huella y similitud de
 * `shared/src/grooves/similitud`) con lo que ya hay en la biblioteca local para avisar de duplicados.
 */

import {
  UMBRALES_SIMILITUD,
  buscarSimilares,
  crearHuella,
  type EntradaGroove,
  type Huella,
  type NivelSimilitud,
} from '../../../../shared/src/grooves'
import { configBackend } from '../backend/config'
import { tokenSesion } from '../backend/sesion'
import { apiGrooves, notasDeGroove } from './cliente'

/** Versión y texto que ve el usuario; el servidor guarda la versión aceptada junto a cada propuesta. */
export const VERSION_CONSENTIMIENTO = '2026-10-29'
export const TEXTO_CONSENTIMIENTO = 'Al compartirlo, autorizas a JasWave a incluirlo en el catálogo bajo licencia CC0.'
export const TEXTO_INTERRUPTOR = 'Compartir mis grooves con JasWave para mejorar el catálogo'

const cacheHuellas = new Map<string, Huella>()

export async function huellaDeGroove(g: Pick<EntradaGroove, 'ruta' | 'sha256' | 'compas'>): Promise<Huella> {
  const clave = `${g.sha256}|${g.compas.numerador}/${g.compas.denominador}`
  const hit = cacheHuellas.get(clave)
  if (hit) return hit
  const h = crearHuella(await notasDeGroove(g), g.compas)
  if (cacheHuellas.size > 2000) cacheHuellas.clear()
  cacheHuellas.set(clave, h)
  return h
}

export type ParecidoLocal = { groove: EntradaGroove; puntuacion: number; nivel: NivelSimilitud; identica: boolean }

/** Grooves de la biblioteca local (del catálogo o de otros del usuario) parecidos a `g` por contenido. */
export async function parecidosLocales(g: EntradaGroove, lista: readonly EntradaGroove[], minimo: number = UMBRALES_SIMILITUD.similar): Promise<ParecidoLocal[]> {
  const mia = await huellaDeGroove(g)
  const candidatos: Array<{ item: EntradaGroove; huella: Huella }> = []
  for (const o of lista) {
    if (o.id === g.id || o.sha256 === g.sha256) continue
    try {
      candidatos.push({ item: o, huella: await huellaDeGroove(o) })
    } catch {
      /* un .mid ilegible no impide comparar con el resto */
    }
  }
  return buscarSimilares(mia, candidatos, { minimo, max: 5 }).map((c) => ({ groove: c.item, puntuacion: c.puntuacion, nivel: c.nivel, identica: c.identica }))
}

const metaDe = (g: EntradaGroove) => ({
  nombre: g.nombre,
  estilo: g.subestilo ? `${g.estilo}/${g.subestilo}` : g.estilo,
  tipo: g.tipo,
  compas: `${g.compas.numerador}/${g.compas.denominador}`,
  tempo: g.tempo,
  compases: g.compases,
  intensidad: g.intensidad,
  etiquetas: g.etiquetas,
  ...(g.autor ? { autor: g.autor } : {}),
})

/** Envía la propuesta de un groove del usuario. El llamador ya obtuvo el permiso del usuario. */
export async function enviarPropuestaDeGroove(g: EntradaGroove): Promise<{ ok: boolean; mensaje: string }> {
  const api = apiGrooves()
  const token = await tokenSesion()
  if (!api || !token) return { ok: false, mensaje: 'Inicia sesión para proponer grooves al catálogo.' }
  const r = await api.proponer(configBackend().apiUrl, token, g.ruta, metaDe(g), { aceptado: true, version: VERSION_CONSENTIMIENTO })
  return { ok: r.ok, mensaje: r.ok ? (r.mensaje ?? 'Propuesta enviada.') : (r.error ?? 'No se pudo enviar la propuesta.') }
}

/**
 * Con «Compartir» activado: propone los grooves del usuario que aún no se propusieron y que no se parecen (≥ «muy
 * similar») a nada de la biblioteca, de a pocos por vez. Devuelve cuántos envió.
 */
export async function proponerPendientes(lista: readonly EntradaGroove[], yaPropuestos: readonly string[], maximo = 10): Promise<number> {
  const hechos = new Set(yaPropuestos)
  let enviados = 0
  for (const g of lista) {
    if (enviados >= maximo) break
    if (g.origen !== 'usuario' || hechos.has(g.sha256)) continue
    try {
      const parecidos = await parecidosLocales(g, lista, UMBRALES_SIMILITUD.muySimilar)
      if (parecidos.length) continue
      const r = await enviarPropuestaDeGroove(g)
      if (!r.ok) break // sin sesión o sin conexión: se intentará en la próxima sincronización
      enviados++
    } catch {
      /* se reintenta luego */
    }
  }
  return enviados
}
