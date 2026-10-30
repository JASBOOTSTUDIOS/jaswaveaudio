/**
 * Registro dinámico de herramientas de agentes (P2).
 *
 * Las herramientas del núcleo siguen definidas de forma estática (`AGENT_ACTION_CLASSES`). Los plugins
 * activos aportan herramientas adicionales en tiempo de ejecución; este registro las valida y las
 * expone al motor y a la política de acciones. Reglas (fail closed):
 *   - cada herramienta declara su clase de acción; sin clase válida se rechaza;
 *   - la clase efectiva nunca es menor que la que exigen los permisos del plugin
 *     (disco o red ⇒ al menos `system`);
 *   - no puede suplantar una herramienta del núcleo ni de otro plugin;
 *   - su nombre va bajo el espacio del plugin (`plugin.<alias>.<accion>`).
 */

import type { AgentActionClass } from '../agent/action-policy'
import type { EngineAgentRole, EngineToolSchema } from '../engine/engine-types'

export type PermisosPlugin = {
  fileSystem: 'none' | 'read-project-stems' | 'read-write-project'
  network: boolean
}

export type HerramientaPlugin = {
  /** Nombre completo, p. ej. `plugin.param-eq.sugerirCorte`. */
  name: string
  description: string
  parameters: Record<string, unknown>
  actionClass: AgentActionClass
}

export type RegistroPlugin = {
  /** Id del plugin (manifiesto `id`). */
  pluginId: string
  /** Alias corto usado en los nombres de herramienta (`plugin.<alias>.…`). */
  alias: string
  permisos: PermisosPlugin
  /** Roles que pueden usar sus herramientas; vacío ⇒ ninguno. */
  rolesAllowed: readonly EngineAgentRole[]
  herramientas: readonly HerramientaPlugin[]
}

export type HerramientaRegistrada = HerramientaPlugin & {
  pluginId: string
  rolesAllowed: readonly EngineAgentRole[]
}

export class ErrorRegistroHerramientas extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErrorRegistroHerramientas'
  }
}

const ORDEN_CLASES: Record<AgentActionClass, number> = { read: 0, write: 1, destructive: 2, system: 3 }
const CLASES_VALIDAS = new Set<string>(Object.keys(ORDEN_CLASES))
const NOMBRE_HERRAMIENTA = /^plugin\.[a-z0-9-]{2,40}\.[a-zA-Z][a-zA-Z0-9]{1,60}$/

export function claseMinimaPorPermisos(p: PermisosPlugin): AgentActionClass {
  return p.network || p.fileSystem !== 'none' ? 'system' : 'read'
}

function maxClase(a: AgentActionClass, b: AgentActionClass): AgentActionClass {
  return ORDEN_CLASES[a] >= ORDEN_CLASES[b] ? a : b
}

export type OpcionesRegistro = {
  /** Comprueba si un nombre pertenece al núcleo (no se puede suplantar). */
  esHerramientaNucleo: (nombre: string) => boolean
}

export class AgentToolRegistry {
  private readonly porPlugin = new Map<string, HerramientaRegistrada[]>()
  private readonly porNombre = new Map<string, HerramientaRegistrada>()
  private readonly listeners = new Set<() => void>()
  private versionActual = 0

  constructor(private readonly opciones: OpcionesRegistro) {}

  /** Cambia en cada alta/baja: el host lo usa para reensamblar prompts y esquemas. */
  get version(): number {
    return this.versionActual
  }

  /** Registra (o reemplaza) todas las herramientas de un plugin. Valida todo antes de aplicar nada. */
  registrar(plugin: RegistroPlugin): HerramientaRegistrada[] {
    const minima = claseMinimaPorPermisos(plugin.permisos)
    const nuevas: HerramientaRegistrada[] = []
    const vistos = new Set<string>()
    for (const h of plugin.herramientas) {
      if (!NOMBRE_HERRAMIENTA.test(h.name) || !h.name.startsWith(`plugin.${plugin.alias}.`)) {
        throw new ErrorRegistroHerramientas(`${plugin.pluginId}: nombre de herramienta inválido "${h.name}" (se espera plugin.${plugin.alias}.<accion>)`)
      }
      if (!CLASES_VALIDAS.has(h.actionClass)) {
        throw new ErrorRegistroHerramientas(`${plugin.pluginId}: "${h.name}" sin clase de acción válida`)
      }
      if (this.opciones.esHerramientaNucleo(h.name)) {
        throw new ErrorRegistroHerramientas(`${plugin.pluginId}: "${h.name}" suplanta una herramienta del núcleo`)
      }
      const ajena = this.porNombre.get(h.name)
      if (ajena && ajena.pluginId !== plugin.pluginId) {
        throw new ErrorRegistroHerramientas(`${plugin.pluginId}: "${h.name}" ya pertenece a ${ajena.pluginId}`)
      }
      if (vistos.has(h.name)) throw new ErrorRegistroHerramientas(`${plugin.pluginId}: "${h.name}" duplicada`)
      vistos.add(h.name)
      nuevas.push({
        ...h,
        actionClass: maxClase(h.actionClass, minima),
        pluginId: plugin.pluginId,
        rolesAllowed: [...plugin.rolesAllowed],
      })
    }
    this.quitarSinNotificar(plugin.pluginId)
    this.porPlugin.set(plugin.pluginId, nuevas)
    for (const h of nuevas) this.porNombre.set(h.name, h)
    this.cambio()
    return nuevas
  }

  /** Da de baja las herramientas de un plugin (desactivado, en cuarentena o desinstalado). */
  quitar(pluginId: string): void {
    if (this.quitarSinNotificar(pluginId)) this.cambio()
  }

  claseDe(nombre: string): AgentActionClass | undefined {
    return this.porNombre.get(nombre)?.actionClass
  }

  obtener(nombre: string): HerramientaRegistrada | undefined {
    return this.porNombre.get(nombre)
  }

  /** Esquemas visibles para un rol (`coproductor` ve todo lo que tenga algún rol permitido). */
  listar(role?: EngineAgentRole): EngineToolSchema[] {
    const out: EngineToolSchema[] = []
    for (const h of this.porNombre.values()) {
      if (role && role !== 'coproductor' && !h.rolesAllowed.includes(role)) continue
      if (h.rolesAllowed.length === 0) continue
      out.push({ name: h.name, description: h.description, parameters: h.parameters })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Sección del system prompt con las herramientas de plugins activas para el rol. */
  seccionPrompt(role?: EngineAgentRole): string {
    const tools = this.listar(role)
    if (tools.length === 0) return ''
    const lineas = tools.map((t) => `- ${t.name} (${this.claseDe(t.name)}): ${t.description}`)
    return ['## Herramientas de plugins activos', ...lineas].join('\n')
  }

  suscribir(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private quitarSinNotificar(pluginId: string): boolean {
    const previas = this.porPlugin.get(pluginId)
    if (!previas) return false
    for (const h of previas) this.porNombre.delete(h.name)
    this.porPlugin.delete(pluginId)
    return true
  }

  private cambio(): void {
    this.versionActual++
    for (const l of this.listeners) {
      try {
        l()
      } catch {
        // un listener defectuoso no impide el registro
      }
    }
  }
}
