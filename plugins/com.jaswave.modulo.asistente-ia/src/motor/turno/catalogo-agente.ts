/**
 * Catálogo del agente: herramientas del DAW (comandos + catálogo del agente + plugins activos) con su
 * clase de riesgo y un título legible, más las habilidades ejecutables expuestas como herramientas.
 */
import { HABILIDADES, agentActionClassOfType, registroHerramientasPlugins } from '@jaswave/host-sdk'
import type { ClaseHerramienta, Habilidad, HerramientaAgente, PerfilSubagente } from '@jaswave/host-sdk'

import { allAgentToolSchemas } from '../agent-tool-schemas'
import { tituloHerramientaParaUsuario } from '../describe-action'
import { habilidadesDeEspecialistas, instruccionesHabilidadesEspecialista } from '../especialistas-habilidades'
import { cargarEspecialistas } from '../especialistas-storage'
import { habilidadesDelEspecialista } from '../habilidades-agentes'

/** Consultas básicas que el agente tiene siempre a mano. */
export const HERRAMIENTAS_BASE = ['project.getSummary', 'track.list', 'selection.get', 'midi.getClipSummary', 'analysis.trackSound']

/**
 * Calculan propuestas internas del flujo antiguo; el agente no las necesita. `midi.notes.compare` compara
 * con el markdown del clip, que la banda nunca escribe: el arreglista lo llamaba cinco veces por sección.
 */
const EXCLUIDAS = /^fallback\.|^midi\.notes\.compare$/

export const PREFIJO_HABILIDAD = 'habilidad_'

function claseDe(tipo: string): ClaseHerramienta | null {
  const c = agentActionClassOfType(tipo)
  if (c === 'read') return 'lectura'
  if (c === 'write') return 'escritura'
  if (c === 'destructive' || c === 'system') return 'destructiva'
  return null
}

export function nombreHerramientaHabilidad(h: Habilidad): string {
  return `${PREFIJO_HABILIDAD}${h.id.replace(/[^a-zA-Z0-9_-]+/g, '_')}`.slice(0, 64)
}

export function habilidadesDisponibles(): Habilidad[] {
  return [...HABILIDADES, ...habilidadesDeEspecialistas()]
}

export function catalogoAgente(o: { rol: string; habilidades: Habilidad[] }): HerramientaAgente[] {
  const out: HerramientaAgente[] = []
  const vistos = new Set<string>()
  const herramientas = [...allAgentToolSchemas(), ...registroHerramientasPlugins.listar(o.rol as never)]
  for (const t of herramientas) {
    if (vistos.has(t.name) || EXCLUIDAS.test(t.name)) continue
    const clase = claseDe(t.name)
    if (!clase) continue
    vistos.add(t.name)
    out.push({
      nombre: t.name,
      descripcion: t.description,
      parametros: (t.parameters as Record<string, unknown>) ?? { type: 'object', properties: {} },
      clase,
      titulo: tituloHerramientaParaUsuario(t.name, clase),
    })
  }
  for (const h of o.habilidades) {
    const nombre = nombreHerramientaHabilidad(h)
    if (vistos.has(nombre)) continue
    vistos.add(nombre)
    out.push({
      nombre,
      descripcion: `Habilidad «${h.nombre}»: ${h.descripcion} Hace el trabajo completo de una vez; pásale el pedido con todos los detalles musicales.`,
      parametros: {
        type: 'object',
        properties: { pedido: { type: 'string', description: 'Qué quieres conseguir, con estilo, tonalidad, secciones o pistas si los sabes.' } },
        required: ['pedido'],
      },
      clase: 'escritura',
      titulo: h.nombre,
      etiquetas: [h.nombre, 'habilidad'],
    })
  }
  return out
}

/** Grupos de herramientas que el usuario puede permitir a cada especialista (las consultas van siempre). */
export const GRUPOS_HERRAMIENTAS: ReadonlyArray<{ id: string; titulo: string; prefijos: string[] }> = [
  { id: 'notas', titulo: 'Notas, clips y arreglo', prefijos: ['midi.', 'clip.', 'score.', 'style.', 'pattern.'] },
  { id: 'pistas', titulo: 'Pistas e instrumentos', prefijos: ['track.', 'pista.', 'plugin.', 'library.', 'instrument.'] },
  { id: 'mezcla', titulo: 'Mezcla, efectos y master', prefijos: ['mix.', 'mixer.', 'master.', 'fx.', 'send.', 'audio.'] },
  { id: 'proyecto', titulo: 'Tempo, compás y transporte', prefijos: ['project.', 'transport.', 'selection.', 'session.', 'marker.'] },
  { id: 'documentos', titulo: 'Plan y notas del proyecto', prefijos: ['doc.', 'plan.'] },
  { id: 'exportar', titulo: 'Exportar y renderizar', prefijos: ['export.', 'render.'] },
]

/** Herramientas permitidas por los grupos elegidos (más todas las de consulta); undefined = sin límite. */
export function herramientasDeGrupos(grupos: string[] | undefined, catalogo: HerramientaAgente[]): string[] | undefined {
  if (!grupos?.length) return undefined
  const prefijos = GRUPOS_HERRAMIENTAS.filter((g) => grupos.includes(g.id)).flatMap((g) => g.prefijos)
  return catalogo.filter((h) => h.clase === 'lectura' || prefijos.some((p) => h.nombre.startsWith(p))).map((h) => h.nombre)
}

/** Especialistas activos como subagentes (los roles de coordinación los asume el agente principal). */
export function perfilesSubagentes(catalogo: HerramientaAgente[] = []): PerfilSubagente[] {
  return cargarEspecialistas()
    .filter((e) => e.activo && e.role !== 'planificador' && e.role !== 'director')
    .map((e) => ({
      id: e.id,
      nombre: e.nombre,
      descripcion: (e.descripcion || e.skills.join(', ') || e.nombre).slice(0, 180),
      instrucciones: [e.instruccionesPersonalizadas, instruccionesHabilidadesEspecialista(e)].filter(Boolean).join('\n\n'),
      herramientas: herramientasDeGrupos(e.herramientasPermitidas, catalogo),
      habilidades: habilidadesDelEspecialista(e),
    }))
    .slice(0, 12)
}
