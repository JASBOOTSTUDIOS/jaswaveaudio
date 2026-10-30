/**
 * Herramientas del agente que no tocan la música: leer habilidades del usuario, aprender preferencias,
 * programar tareas y actualizar la meta activa. Se clasifican como «lectura» porque no modifican el
 * proyecto musical (están disponibles en todos los modos).
 */
import {
  RUTA_REGLAS,
  aprenderReglaOConocimiento,
  carpetaAsistente,
  describirCuando,
  escribirDocumentoAsistente,
  planificadorTareas,
  rutaAsistente,
} from '@jaswave/host-sdk'
import type { CarpetaAsistente, HerramientaAgente, LlamadaAgente, ResultadoHerramienta } from '@jaswave/host-sdk'

import { NOMBRE_CARPETA, buscarHabilidadAgente, documentosConfig, type HabilidadDisponible } from '../config-agente'

export const H_LEER_HABILIDAD = 'leer_habilidad'
export const H_APRENDER = 'aprender'
export const H_PROGRAMAR = 'programar_tarea'
export const H_META = 'actualizar_meta'
export const H_CONFIG_LISTAR = 'config_listar'
export const H_CONFIG_LEER = 'config_leer'
export const H_CONFIG_ESCRIBIR = 'config_escribir'
export const H_CONFIG_ELIMINAR = 'config_eliminar'
export const H_CONFIG_RESTAURAR = 'config_restaurar'
export const HERRAMIENTAS_CONFIG = [H_CONFIG_LISTAR, H_CONFIG_LEER, H_CONFIG_ESCRIBIR, H_CONFIG_ELIMINAR, H_CONFIG_RESTAURAR]

const obj = (props: Record<string, unknown>, req: string[]) => ({ type: 'object', properties: props, required: req })

/** «reglas» es un único archivo; el resto son carpetas con un archivo por documento. */
type DestinoConfig = CarpetaAsistente | 'reglas'
const DESTINOS: DestinoConfig[] = ['habilidades', 'prompts', 'planes', 'reglas']

/** El usuario habla de su configuración del asistente (crear, editar o borrar habilidades, prompts, planes o reglas). */
export function pideConfigurar(texto: string): boolean {
  return (
    /\b(habilidad(es)?|skills?|prompts?|plantillas?|planes|plan guardado|reglas? (globales|del asistente|para todos)|carpeta de configuraci[oó]n|configuraci[oó]n del asistente)\b/i.test(texto) &&
    /\b(cr[eé]a|nuev[oa]|a[ñn]ade|agrega|guarda|edita|modifica|cambia|actualiza|renombra|borra|elimina|quita|recupera|restaura|lista|mu[eé]strame|cu[aá]les)/i.test(texto)
  )
}

function destino(v: unknown): DestinoConfig | null {
  const s = String(v ?? '').toLowerCase()
  return (DESTINOS as string[]).includes(s) ? (s as DestinoConfig) : null
}

/** La respuesta del modelo afirma haber cambiado la configuración (para comprobarlo contra lo que se ejecutó). */
export function afirmaCambioConfig(texto: string): boolean {
  // Pretérito con tilde («guardé», «borré»): sin ella sería subjuntivo («¿quieres que la guarde?»).
  return /(?<!\p{L})(?:(?<!no )he (?:creado|guardado|borrado|eliminado|quitado|actualizado|cambiado|editado|modificado|recuperado|restaurado|renombrado)|(?:cre|guard|borr|elimin|quit|actualic|cambi|edit|modifiqu|recuper|restaur|renombr)é|(?:est[aá]|qued[oó]) (?:guardad|borrad|eliminad|cread|actualizad|recuperad)[oa])(?!\p{L})/iu.test(
    texto,
  )
}

/** El aviso fijo del modo configurar lo añade el motor; si el modelo lo copia del historial, se quita. */
export function sinAvisoModoConfigurar(texto: string): string {
  return texto.replace(/\s*Sigues en el modo configurar:[^\n]*?volver a la música\.?/g, '').trim()
}

/** Herramientas sobre la carpeta de configuración. `escribir`: además crear, editar, eliminar y recuperar. */
export function herramientasConfig(o: { escribir: boolean }): HerramientaAgente[] {
  const carpeta = { type: 'string', enum: DESTINOS, description: 'habilidades, prompts, planes o reglas (reglas = un único archivo con las reglas para todos los proyectos)' }
  const out: HerramientaAgente[] = [
    {
      nombre: H_CONFIG_LISTAR,
      descripcion: 'Lista la configuración del usuario: sus reglas y los nombres y descripciones de sus habilidades, prompts y planes guardados.',
      parametros: obj({}, []),
      clase: 'lectura',
      titulo: 'Revisando tu configuración',
      etiquetas: ['configuracion', 'habilidades', 'prompts', 'planes', 'reglas'],
    },
    {
      nombre: H_CONFIG_LEER,
      descripcion: 'Lee completo un documento de la configuración del usuario (por carpeta y nombre).',
      parametros: obj({ carpeta, nombre: { type: 'string' } }, ['carpeta']),
      clase: 'lectura',
      titulo: 'Leyendo tu configuración',
      etiquetas: ['configuracion', 'habilidad', 'prompt', 'plan', 'leer'],
    },
  ]
  if (!o.escribir) return out
  out.push(
    {
      nombre: H_CONFIG_ESCRIBIR,
      descripcion:
        'Crea o reemplaza un documento de la configuración del usuario. Para editar, lee primero el actual y envía el contenido completo ya modificado. ' +
        '`nombre`: nombre corto y claro. `descripcion`: cuándo usarlo o para qué sirve (una frase). `contenido`: pasos o instrucciones en Markdown. ' +
        'Para «reglas» solo cuenta `contenido` (todas las reglas). `activo: false` lo guarda desactivado. Si cambias el nombre de uno existente, pasa el anterior en `nombreAnterior`.',
      parametros: obj(
        {
          carpeta,
          nombre: { type: 'string' },
          nombreAnterior: { type: 'string' },
          descripcion: { type: 'string' },
          contenido: { type: 'string' },
          activo: { type: 'boolean' },
        },
        ['carpeta', 'contenido'],
      ),
      clase: 'lectura',
      titulo: 'Guardando tu configuración',
      etiquetas: ['configuracion', 'crear', 'editar', 'guardar', 'habilidad', 'prompt', 'plan', 'regla'],
    },
    {
      nombre: H_CONFIG_ELIMINAR,
      descripcion: 'Elimina un documento de la configuración del usuario (va a la papelera y se puede recuperar). Úsalo SOLO si el usuario lo pidió.',
      parametros: obj({ carpeta, nombre: { type: 'string' } }, ['carpeta']),
      clase: 'lectura',
      titulo: 'Eliminando de tu configuración',
      etiquetas: ['configuracion', 'eliminar', 'borrar', 'quitar'],
    },
    {
      nombre: H_CONFIG_RESTAURAR,
      descripcion: 'Recupera de la papelera un documento eliminado de la configuración del usuario.',
      parametros: obj({ carpeta, nombre: { type: 'string' } }, ['carpeta', 'nombre']),
      clase: 'lectura',
      titulo: 'Recuperando de tu configuración',
      etiquetas: ['configuracion', 'recuperar', 'restaurar', 'deshacer'],
    },
  )
  return out
}

async function ejecutarConfig(l: LlamadaAgente, efectos: EfectosIde): Promise<ResultadoHerramienta | null> {
  if (!HERRAMIENTAS_CONFIG.includes(l.nombre)) return null
  const a = l.argumentos ?? {}
  await carpetaAsistente.cargar()
  if (l.nombre === H_CONFIG_LISTAR) {
    const reglas = carpetaAsistente.archivo(RUTA_REGLAS)?.contenido ?? ''
    const lista = (c: CarpetaAsistente) => documentosConfig(c).map((d) => ({ nombre: d.nombre, descripcion: d.descripcion, activo: d.activa }))
    return { ok: true, resumen: 'Tu configuración', datos: { reglas: reglas.slice(0, 2000), habilidades: lista('habilidades'), prompts: lista('prompts'), planes: lista('planes') } }
  }
  const dest = destino(a.carpeta)
  if (!dest) return { ok: false, error: 'carpeta debe ser habilidades, prompts, planes o reglas' }
  const nombre = String(a.nombre ?? '').trim()
  const buscar = (n: string) => (dest === 'reglas' ? undefined : buscarHabilidadAgente(documentosConfig(dest), n))
  const etiqueta = dest === 'reglas' ? 'tus reglas' : `${NOMBRE_CARPETA[dest].singular === 'habilidad' ? 'la' : 'el'} ${NOMBRE_CARPETA[dest].singular} «${nombre}»`
  try {
    switch (l.nombre) {
      case H_CONFIG_LEER: {
        if (dest === 'reglas') return { ok: true, datos: { contenido: carpetaAsistente.archivo(RUTA_REGLAS)?.contenido ?? '' } }
        const d = buscar(nombre)
        if (!d) return { ok: false, error: `No hay ${NOMBRE_CARPETA[dest].singular} «${nombre}». Hay: ${documentosConfig(dest).map((x) => x.nombre).join(', ') || 'ninguno'}` }
        return { ok: true, resumen: d.nombre, datos: { nombre: d.nombre, descripcion: d.descripcion, activo: d.activa, contenido: d.instrucciones } }
      }
      case H_CONFIG_ESCRIBIR: {
        const contenido = String(a.contenido ?? '')
        if (dest === 'reglas') {
          await carpetaAsistente.escribir(RUTA_REGLAS, contenido.trim())
          efectos.config.push('Actualicé tus reglas')
          return { ok: true, resumen: 'Reglas guardadas', datos: { guardado: true } }
        }
        if (!nombre) return { ok: false, error: 'Falta el nombre' }
        if (!contenido.trim()) return { ok: false, error: 'Falta el contenido' }
        const previo = buscar(String(a.nombreAnterior ?? '').trim() || nombre)
        const ruta = previo?.id ?? rutaAsistente(dest, nombre)
        const texto = escribirDocumentoAsistente({
          titulo: nombre,
          descripcion: String(a.descripcion ?? previo?.descripcion ?? ''),
          activo: typeof a.activo === 'boolean' ? a.activo : (previo?.activa ?? true),
          cuerpo: contenido,
        })
        await carpetaAsistente.escribir(ruta, texto)
        efectos.config.push(`${previo ? 'Actualicé' : 'Creé'} ${etiqueta}`)
        return { ok: true, resumen: previo ? 'Actualizado' : 'Creado', datos: { guardado: true, nuevo: !previo } }
      }
      case H_CONFIG_ELIMINAR: {
        const ruta = dest === 'reglas' ? RUTA_REGLAS : buscar(nombre)?.id
        if (!ruta || !(await carpetaAsistente.eliminar(ruta))) return { ok: false, error: `No encontré ${etiqueta}` }
        efectos.config.push(`Eliminé ${etiqueta} (se puede recuperar)`)
        return { ok: true, resumen: 'Eliminado', datos: { eliminado: true, recuperable: true } }
      }
      case H_CONFIG_RESTAURAR: {
        const ruta = dest === 'reglas' ? RUTA_REGLAS : rutaAsistente(dest, nombre)
        if (!(await carpetaAsistente.restaurar(ruta))) return { ok: false, error: `No hay ${etiqueta} en la papelera` }
        efectos.config.push(`Recuperé ${etiqueta}`)
        return { ok: true, resumen: 'Recuperado', datos: { recuperado: true } }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  return null
}

/** El usuario está enseñando o fijando preferencias: solo entonces el agente puede guardar reglas. */
export function pideAprender(texto: string): boolean {
  return /\b(recuerda|aprende|apr[eé]ndete|a partir de ahora|de ahora en adelante|siempre|nunca|prefiero|no vuelvas a|guarda (esto|como regla))\b/i.test(texto)
}

export function herramientasIde(o: { habilidades: HabilidadDisponible[]; aprender: boolean; meta: boolean }): HerramientaAgente[] {
  const out: HerramientaAgente[] = []
  if (o.habilidades.length) {
    out.push({
      nombre: H_LEER_HABILIDAD,
      descripcion: 'Lee las instrucciones completas de una habilidad del usuario (por su nombre) antes de aplicarla.',
      parametros: obj({ nombre: { type: 'string', enum: o.habilidades.slice(0, 40).map((h) => h.nombre) } }, ['nombre']),
      clase: 'lectura',
      titulo: 'Leyendo una habilidad',
      etiquetas: ['habilidad', 'skill', 'instrucciones'],
    })
  }
  if (o.aprender) {
    out.push({
      nombre: H_APRENDER,
      descripcion: 'Guarda una preferencia o regla del usuario para los próximos turnos de este proyecto (una frase clara y general).',
      parametros: obj({ regla: { type: 'string' } }, ['regla']),
      clase: 'lectura',
      titulo: 'Guardando tu preferencia',
      etiquetas: ['recordar', 'regla', 'preferencia', 'aprender'],
    })
  }
  out.push({
    nombre: H_PROGRAMAR,
    descripcion:
      'Programa una tarea para más tarde o repetida. `cuando`: «en 10 minutos», «cada 30 minutos», «a las 18:30». `tarea`: qué deberás hacer entonces, autosuficiente.',
    parametros: obj({ cuando: { type: 'string' }, tarea: { type: 'string' } }, ['cuando', 'tarea']),
    clase: 'lectura',
    titulo: 'Programando una tarea',
    etiquetas: ['programar', 'recordatorio', 'despues', 'cada', 'tarea'],
  })
  if (o.meta) {
    out.push({
      nombre: H_META,
      descripcion: 'Informa del avance de la meta activa. `cumplida: true` solo cuando hayas comprobado en el proyecto que se cumple.',
      parametros: obj({ cumplida: { type: 'boolean' }, progreso: { type: 'string' } }, ['cumplida', 'progreso']),
      clase: 'lectura',
      titulo: 'Revisando la meta',
    })
  }
  return out
}

export type EfectosIde = { metaCumplida?: boolean; progresoMeta?: string; reglas: string[]; tareas: string[]; config: string[] }

export async function ejecutarHerramientaIde(
  l: LlamadaAgente,
  o: { projectId: string; habilidades: HabilidadDisponible[]; efectos: EfectosIde },
): Promise<ResultadoHerramienta | null> {
  const cfg = await ejecutarConfig(l, o.efectos)
  if (cfg) return cfg
  const a = l.argumentos ?? {}
  switch (l.nombre) {
    case H_LEER_HABILIDAD: {
      const h = buscarHabilidadAgente(o.habilidades, String(a.nombre ?? ''))
      if (!h) return { ok: false, error: `No hay ninguna habilidad «${String(a.nombre ?? '')}». Disponibles: ${o.habilidades.map((x) => x.nombre).join(', ')}` }
      return { ok: true, resumen: `Habilidad «${h.nombre}»`, datos: { nombre: h.nombre, instrucciones: h.instrucciones } }
    }
    case H_APRENDER: {
      try {
        const r = await aprenderReglaOConocimiento(o.projectId, String(a.regla ?? ''))
        if (!r.duplicada) o.efectos.reglas.push(r.regla)
        return { ok: true, resumen: r.duplicada ? 'Ya lo tenía guardado' : 'Preferencia guardada', datos: { guardada: r.regla, yaExistia: r.duplicada } }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    case H_PROGRAMAR: {
      try {
        const t = planificadorTareas.programar(o.projectId, `${String(a.cuando ?? '').trim()} ${String(a.tarea ?? '').trim()}`)
        const cuando = describirCuando(t, Date.now())
        o.efectos.tareas.push(`${t.prompt} (${cuando})`)
        return { ok: true, resumen: `Tarea programada ${cuando}`, datos: { programada: cuando } }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    case H_META: {
      o.efectos.metaCumplida = a.cumplida === true
      o.efectos.progresoMeta = String(a.progreso ?? '').slice(0, 400)
      return { ok: true, datos: { registrado: true } }
    }
    default:
      return null
  }
}
