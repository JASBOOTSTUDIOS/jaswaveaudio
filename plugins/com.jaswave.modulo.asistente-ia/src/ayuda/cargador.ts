/**
 * Carga la base de ayuda: fichas generadas del código (JSON versionado) + fichas curadas.
 * Las curadas ganan a las generadas con el mismo id. Sin dependencias de UI.
 */
import { crearIndiceAyuda, formatearErrores, validarFichas, type FichaAyuda, type IndiceAyuda } from '@jaswave/host-sdk'
import generada from './generada/ayuda.generada.json'
import { FICHAS_CURADAS } from './curado'

export type ErrorCargaAyuda = ReturnType<typeof validarFichas>
export type BaseAyuda = { fichas: FichaAyuda[]; indice: IndiceAyuda; errores: ErrorCargaAyuda }

/** Fusiona por id (la curada reemplaza a la generada) y ordena por id, de forma determinista. */
export function fusionarFichas(generadas: readonly FichaAyuda[], curadas: readonly FichaAyuda[]): FichaAyuda[] {
  const porId = new Map<string, FichaAyuda>()
  for (const f of generadas) porId.set(f.id, f)
  for (const f of curadas) porId.set(f.id, f)
  return [...porId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function fichasGeneradas(): FichaAyuda[] {
  return (generada as unknown as { fichas: FichaAyuda[] }).fichas
}

export function construirBaseAyuda(
  generadas: readonly FichaAyuda[] = fichasGeneradas(),
  curadas: readonly FichaAyuda[] = FICHAS_CURADAS,
): BaseAyuda {
  const fichas = fusionarFichas(generadas, curadas)
  const errores = validarFichas(fichas)
  return { fichas, indice: crearIndiceAyuda(fichas), errores }
}

let cache: BaseAyuda | null = null

/** Base de ayuda del módulo (memoizada). Lanza si alguna ficha no valida: es un error de datos, no de uso. */
export function cargarAyuda(): BaseAyuda {
  if (!cache) {
    const b = construirBaseAyuda()
    if (b.errores.length) throw new Error(`Base de ayuda inválida:\n${formatearErrores(b.errores)}`)
    cache = b
  }
  return cache
}
