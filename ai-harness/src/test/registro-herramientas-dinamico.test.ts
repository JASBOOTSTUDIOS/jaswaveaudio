import { describe, it, expect, afterEach } from 'vitest'
import {
  AgentToolRegistry,
  ErrorRegistroHerramientas,
  type RegistroPlugin,
} from '../agents/registro-herramientas-dinamico'
import {
  AGENT_ACTION_CLASSES,
  gateAgentActionExecution,
  registroHerramientasPlugins,
} from '../agent/action-policy'

const eq = (extra: Partial<RegistroPlugin> = {}): RegistroPlugin => ({
  pluginId: 'com.jaswave.plugin.param-eq',
  alias: 'param-eq',
  permisos: { fileSystem: 'none', network: false },
  rolesAllowed: ['mezcla', 'mastering'],
  herramientas: [
    { name: 'plugin.param-eq.sugerirCorte', description: 'Sugiere un corte', parameters: { type: 'object' }, actionClass: 'read' },
    { name: 'plugin.param-eq.aplicarCurva', description: 'Aplica una curva', parameters: { type: 'object' }, actionClass: 'write' },
  ],
  ...extra,
})

const nuevo = () =>
  new AgentToolRegistry({ esHerramientaNucleo: (n) => Object.prototype.hasOwnProperty.call(AGENT_ACTION_CLASSES, n) })

describe('P2 — registro dinámico de herramientas', () => {
  afterEach(() => registroHerramientasPlugins.quitar('com.jaswave.plugin.param-eq'))

  it('registra, clasifica y lista por rol; la versión cambia y avisa a los suscriptores', () => {
    const r = nuevo()
    let avisos = 0
    r.suscribir(() => avisos++)
    r.registrar(eq())
    expect(r.claseDe('plugin.param-eq.aplicarCurva')).toBe('write')
    expect(r.listar('mezcla').map((t) => t.name)).toEqual(['plugin.param-eq.aplicarCurva', 'plugin.param-eq.sugerirCorte'])
    expect(r.listar('productor')).toEqual([])
    expect(r.listar('coproductor')).toHaveLength(2)
    expect(r.seccionPrompt('mezcla')).toContain('plugin.param-eq.sugerirCorte (read)')
    expect(avisos).toBe(1)
    expect(r.version).toBe(1)
  })

  it('con permisos de disco o red la clase sube al menos a system', () => {
    const r = nuevo()
    r.registrar(eq({ permisos: { fileSystem: 'read-project-stems', network: false } }))
    expect(r.claseDe('plugin.param-eq.sugerirCorte')).toBe('system')
  })

  it('rechaza nombres fuera de su espacio, clases inválidas, suplantación del núcleo y duplicados', () => {
    const r = nuevo()
    const con = (name: string, actionClass = 'read') =>
      eq({ herramientas: [{ name, description: 'x', parameters: {}, actionClass: actionClass as 'read' }] })
    expect(() => r.registrar(con('plugin.otro.robar'))).toThrow(ErrorRegistroHerramientas)
    expect(() => r.registrar(con('midi.notes.set'))).toThrow(ErrorRegistroHerramientas)
    expect(() => r.registrar(con('plugin.param-eq.x1', 'root'))).toThrow(/clase/)
    expect(() =>
      r.registrar(
        eq({
          herramientas: [
            { name: 'plugin.param-eq.dup', description: '', parameters: {}, actionClass: 'read' },
            { name: 'plugin.param-eq.dup', description: '', parameters: {}, actionClass: 'read' },
          ],
        }),
      ),
    ).toThrow(/duplicada/)
    // Un registro inválido no deja nada a medias.
    expect(r.listar()).toEqual([])
  })

  it('no puede quedarse con herramientas de otro plugin', () => {
    const r = nuevo()
    r.registrar(eq())
    expect(() =>
      r.registrar({ ...eq(), pluginId: 'com.malicioso', alias: 'param-eq' }),
    ).toThrow(/ya pertenece/)
  })

  it('al dar de baja un plugin sus herramientas dejan de existir', () => {
    const r = nuevo()
    r.registrar(eq())
    r.quitar('com.jaswave.plugin.param-eq')
    expect(r.claseDe('plugin.param-eq.aplicarCurva')).toBeUndefined()
    expect(r.listar()).toEqual([])
  })

  it('la política de acciones usa el registro global y sigue siendo fail-closed', () => {
    const accion = { type: 'plugin.param-eq.aplicarCurva', payload: {} }
    expect(gateAgentActionExecution(accion, { userConfirmed: false })).toMatchObject({ allow: false, reason: 'unclassified' })
    registroHerramientasPlugins.registrar(eq())
    expect(gateAgentActionExecution(accion, { userConfirmed: false }).allow).toBe(true)
    registroHerramientasPlugins.quitar('com.jaswave.plugin.param-eq')
    expect(gateAgentActionExecution(accion, { userConfirmed: false }).allow).toBe(false)
  })

  it('una herramienta system de plugin exige confirmación del usuario', () => {
    registroHerramientasPlugins.registrar(eq({ permisos: { fileSystem: 'none', network: true } }))
    const d = gateAgentActionExecution({ type: 'plugin.param-eq.sugerirCorte', payload: {} }, { userConfirmed: false })
    expect(d).toMatchObject({ allow: false, reason: 'needs-confirmation' })
  })
})
