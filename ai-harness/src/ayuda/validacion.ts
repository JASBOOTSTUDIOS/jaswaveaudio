import { FUENTES_FICHA, NIVELES_FICHA, TIPOS_FICHA, type ErrorFicha, type FichaAyuda } from './tipos'

const esTexto = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const listaTextos = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** Valida una ficha desconocida; devuelve errores legibles (vacío = válida). */
export function validarFicha(f: unknown): ErrorFicha[] {
  const e: ErrorFicha[] = []
  if (!f || typeof f !== 'object' || Array.isArray(f)) return [{ id: '?', campo: '(ficha)', mensaje: 'La ficha debe ser un objeto.' }]
  const o = f as Record<string, unknown>
  const id = esTexto(o.id) ? o.id : '?'
  const err = (campo: string, mensaje: string) => e.push({ id, campo, mensaje })
  if (!esTexto(o.id)) err('id', 'Falta el id (texto no vacío).')
  else if (!/^[a-z0-9_-]+:[a-z0-9._-]+$/.test(o.id)) err('id', `El id «${o.id}» debe tener la forma tipo:nombre en minúsculas (p. ej. panel:mixer).`)
  else if (!TIPOS_FICHA.includes(o.id.split(':')[0] as never)) err('id', `El prefijo del id «${o.id}» no es un tipo válido (${TIPOS_FICHA.join(', ')}).`)
  else if (o.tipo !== undefined && o.id.split(':')[0] !== o.tipo) err('id', `El prefijo del id «${o.id}» no coincide con el tipo «${String(o.tipo)}».`)
  if (!TIPOS_FICHA.includes(o.tipo as never)) err('tipo', `Tipo «${String(o.tipo)}» no válido; usa: ${TIPOS_FICHA.join(', ')}.`)
  if (!esTexto(o.titulo)) err('titulo', 'Falta el título.')
  if (!esTexto(o.resumen)) err('resumen', 'Falta el resumen.')
  if (!NIVELES_FICHA.includes(o.nivel as never)) err('nivel', `Nivel «${String(o.nivel)}» no válido; usa: ${NIVELES_FICHA.join(', ')}.`)
  if (!FUENTES_FICHA.includes(o.fuente as never)) err('fuente', `Fuente «${String(o.fuente)}» no válida; usa: ${FUENTES_FICHA.join(', ')}.`)
  for (const campo of ['pasos', 'relacionadas', 'etiquetas'] as const)
    if (o[campo] !== undefined && !listaTextos(o[campo])) err(campo, `«${campo}» debe ser una lista de textos.`)
  if (o.comoAbrir !== undefined) {
    const a = o.comoAbrir as Record<string, unknown>
    if (!a || typeof a !== 'object' || Array.isArray(a)) err('comoAbrir', '«comoAbrir» debe ser un objeto.')
    else for (const k of ['herramienta', 'menu', 'atajo']) if (a[k] !== undefined && !esTexto(a[k])) err(`comoAbrir.${k}`, `«${k}» debe ser texto no vacío.`)
  }
  if (o.controles !== undefined) {
    if (!Array.isArray(o.controles)) err('controles', '«controles» debe ser una lista.')
    else
      o.controles.forEach((c, i) => {
        const r = (c ?? {}) as Record<string, unknown>
        if (!esTexto(r.ayuda)) err(`controles[${i}].ayuda`, 'Cada control necesita un id estable «ayuda».')
        if (!esTexto(r.etiqueta)) err(`controles[${i}].etiqueta`, 'Cada control necesita una etiqueta.')
      })
  }
  return e
}

/** Valida un conjunto: cada ficha, ids duplicados y relacionadas que no existen. */
export function validarFichas(fichas: readonly unknown[]): ErrorFicha[] {
  const e = fichas.flatMap(validarFicha)
  const vistos = new Set<string>()
  for (const f of fichas) {
    const id = (f as { id?: unknown } | null)?.id
    if (typeof id !== 'string') continue
    if (vistos.has(id)) e.push({ id, campo: 'id', mensaje: `Id duplicado «${id}».` })
    vistos.add(id)
  }
  for (const f of fichas as FichaAyuda[])
    if (Array.isArray(f?.relacionadas))
      for (const r of f.relacionadas) if (typeof r === 'string' && !vistos.has(r)) e.push({ id: f.id, campo: 'relacionadas', mensaje: `La ficha relacionada «${r}» no existe.` })
  return e
}

export const formatearErrores = (e: readonly ErrorFicha[]) => e.map((x) => `${x.id} · ${x.campo}: ${x.mensaje}`).join('\n')
