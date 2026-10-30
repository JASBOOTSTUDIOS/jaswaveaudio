/**
 * Perfiles de mezcla del productor (plan T). Viven en la carpeta de configuración del asistente
 * (`%APPDATA%\JasWave\asistente\habilidades\mezcla-perfil-<id>.md`), como el resto de habilidades: el archivo es un
 * documento Markdown con un bloque ```json que contiene el perfil (solo hacen falta `id`, `nombre` y lo que cambie;
 * `base` indica de qué perfil de serie hereda). Aparece en Ajustes → IA → Habilidades, donde se edita; el modelo de
 * mezcla también puede leerlo como habilidad.
 *
 * El perfil que se usa lo decide, por orden: el ajuste del productor (`jaswave-banda-perfil-mezcla`, un id o nombre), el
 * estilo de la hoja de ruta que emitió el planificador y, como último recurso, las palabras del pedido.
 */
import {
  PERFILES_MEZCLA,
  carpetaAsistente,
  elegirPerfilMezcla,
  escribirDocumentoAsistente,
  leerDocumentoAsistente,
  validarPerfilMezcla,
} from '@jaswave/host-sdk'
import type { PerfilElegido, PerfilMezcla } from '@jaswave/host-sdk'

export const PREFIJO_PERFIL_MEZCLA = 'mezcla-perfil-'
export const CLAVE_PERFIL_MEZCLA = 'jaswave-banda-perfil-mezcla'

/** Perfil que el productor fijó en los ajustes (id o nombre); '' = que lo decida la producción. */
export function perfilFijadoPorProductor(): string {
  try {
    return String(globalThis.localStorage?.getItem(CLAVE_PERFIL_MEZCLA) ?? '').replace(/^"|"$/g, '').trim()
  } catch {
    return ''
  }
}

export function fijarPerfilDelProductor(idONombre: string): void {
  try {
    if (idONombre.trim()) globalThis.localStorage?.setItem(CLAVE_PERFIL_MEZCLA, idONombre.trim())
    else globalThis.localStorage?.removeItem(CLAVE_PERFIL_MEZCLA)
  } catch {
    /* sin almacenamiento: el ajuste no se guarda */
  }
}

/** Extrae el JSON de un documento: el primer bloque ```json, o el primer objeto `{…}` del texto. */
export function jsonDelDocumento(cuerpo: string): unknown {
  const bloque = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(cuerpo)?.[1] ?? cuerpo.slice(cuerpo.indexOf('{'), cuerpo.lastIndexOf('}') + 1)
  return JSON.parse(bloque)
}

/** Perfiles válidos de la carpeta del asistente y los errores de los que no lo son (para avisar al productor). */
export function cargarPerfilesUsuario(): { perfiles: PerfilMezcla[]; errores: string[] } {
  const perfiles: PerfilMezcla[] = []
  const errores: string[] = []
  let archivos: Array<{ ruta: string; nombre: string; contenido: string }> = []
  try {
    archivos = carpetaAsistente.archivos().filter((a) => a.ruta.startsWith(`habilidades/${PREFIJO_PERFIL_MEZCLA}`))
  } catch {
    return { perfiles, errores }
  }
  for (const a of archivos) {
    const d = leerDocumentoAsistente(a.contenido, a.nombre)
    if (!d.activo) continue
    try {
      const v = validarPerfilMezcla(jsonDelDocumento(d.cuerpo), [...perfiles, ...PERFILES_MEZCLA])
      if (v.ok) perfiles.push(v.perfil)
      else errores.push(`${a.ruta}: ${v.errores.join(' ')}`)
    } catch (e) {
      errores.push(`${a.ruta}: JSON no válido (${e instanceof Error ? e.message : String(e)}).`)
    }
  }
  return { perfiles, errores }
}

/** Documento editable con una copia de un perfil de serie (para que el productor lo adapte). */
export function plantillaPerfilUsuario(baseId: string, id: string, nombre: string): string {
  const base = PERFILES_MEZCLA.find((p) => p.id === baseId) ?? PERFILES_MEZCLA[0]!
  const { id: _i, nombre: _n, alias: _a, ...resto } = base
  return escribirDocumentoAsistente({
    titulo: `Perfil de mezcla: ${nombre}`,
    descripcion: `Perfil de mezcla propio basado en «${base.nombre}». Cambia los números; lo que borres se hereda de la base.`,
    activo: true,
    cuerpo: ['```json', JSON.stringify({ id, nombre, base: base.id, alias: [], ...resto }, null, 2), '```'].join('\n'),
  })
}

/** Guarda (o reemplaza) un perfil del productor tras validarlo. */
export async function guardarPerfilUsuario(perfil: unknown): Promise<{ ok: true; ruta: string; perfil: PerfilMezcla } | { ok: false; errores: string[] }> {
  const v = validarPerfilMezcla(perfil)
  if (!v.ok) return v
  const ruta = `habilidades/${PREFIJO_PERFIL_MEZCLA}${v.perfil.id}.md`
  const cuerpo = ['```json', JSON.stringify(perfil, null, 2), '```'].join('\n')
  await carpetaAsistente.escribir(ruta, escribirDocumentoAsistente({ titulo: `Perfil de mezcla: ${v.perfil.nombre}`, descripcion: v.perfil.descripcion, activo: true, cuerpo }))
  return { ok: true, ruta, perfil: v.perfil }
}

/** Elige el perfil de la producción (ajuste del productor > estilo de la hoja > pedido > respaldo) incluyendo los propios. */
export function elegirPerfilDeProduccion(o: { estilo?: string; estiloHoja?: string; pedido?: string }): PerfilElegido & { avisos: string[] } {
  const { perfiles, errores } = cargarPerfilesUsuario()
  const e = elegirPerfilMezcla({ productor: perfilFijadoPorProductor() || o.estilo, estiloHoja: o.estiloHoja, pedido: o.pedido, perfiles })
  return { ...e, avisos: errores }
}
