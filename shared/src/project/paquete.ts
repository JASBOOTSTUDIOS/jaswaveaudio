/**
 * «Exportar proyecto empaquetado» (G2): `.jaswave.zip` con el proyecto y todo el audio que usa,
 * para abrirlo en otro equipo o carpeta sin «media faltante».
 *
 * Cada clip de audio pasa a apuntar a `media/<archivo>` dentro del paquete (rutas absolutas y
 * relativas por igual); dos clips del mismo archivo comparten una sola copia y dos archivos con
 * el mismo nombre se renombran (`voz.wav`, `voz (2).wav`).
 */

import type { ProjectState } from '../types/proyecto'
import { proyectoParaGuardar } from './ciclo-vida'

export type ArchivoPaquete = { origen: string; destino: string }
export type PlanPaquete = {
  /** Proyecto con las rutas reescritas, listo para `JSON.stringify` (mismo formato que Guardar). */
  json: string
  nombreProyecto: string
  archivos: ArchivoPaquete[]
  /** Rutas que no se pudieron resolver a un archivo (el paquete se crea igual y se avisa). */
  faltantes: string[]
}

function nombreSeguro(nombre: string): string {
  const sinControl = [...nombre].map((c) => (c.charCodeAt(0) < 32 ? '_' : c)).join('')
  const limpio = sinControl.replace(/[\\/:*?"<>|]/g, '_').trim()
  return limpio || 'audio'
}

function partirExt(nombre: string): [string, string] {
  const i = nombre.lastIndexOf('.')
  return i > 0 ? [nombre.slice(0, i), nombre.slice(i)] : [nombre, '']
}

/**
 * @param resolver ruta del clip → ruta absoluta en disco (o null si no se encuentra).
 */
export function planificarPaquete(proyecto: ProjectState, resolver: (ruta: string) => string | null): PlanPaquete {
  const porOrigen = new Map<string, string>()
  const usados = new Set<string>()
  const archivos: ArchivoPaquete[] = []
  const faltantes: string[] = []
  const destinoPara = (origen: string): string => {
    const clave = origen.replace(/\\/g, '/').toLowerCase()
    const previo = porOrigen.get(clave)
    if (previo) return previo
    const [base, ext] = partirExt(nombreSeguro(origen.split(/[\\/]/).pop() ?? 'audio'))
    let nombre = `${base}${ext}`
    for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${base} (${n})${ext}`
    usados.add(nombre.toLowerCase())
    const destino = `media/${nombre}`
    porOrigen.set(clave, destino)
    archivos.push({ origen, destino })
    return destino
  }

  const tracks = (proyecto.tracks ?? []).map((t) => ({
    ...t,
    clips: (t.clips ?? []).map((c) => {
      const clip = c as { tipo?: string; source?: { ruta?: string } }
      const ruta = clip.tipo === 'audio' ? clip.source?.ruta : undefined
      if (!ruta) return c
      const abs = resolver(ruta)
      if (!abs) {
        faltantes.push(ruta)
        return c
      }
      return { ...c, source: { ...clip.source, ruta: destinoPara(abs) } } as typeof c
    }),
  })) as ProjectState['tracks']

  const nombreProyecto = nombreSeguro(proyecto.nombre || 'Proyecto')
  const empaquetado: ProjectState = {
    ...proyecto,
    tracks,
    // El paquete se abre desde donde se extraiga: la ruta vieja no sirve.
    ruta: undefined,
    modificado: false,
  }
  return {
    json: JSON.stringify(proyectoParaGuardar(empaquetado)),
    nombreProyecto,
    archivos,
    faltantes: [...new Set(faltantes)],
  }
}
