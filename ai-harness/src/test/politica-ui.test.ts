import { describe, expect, it } from 'vitest'
import {
  AGENT_ACTION_CLASSES,
  AGENT_UI_ACTIONS,
  actionAlwaysNeedsConfirm,
  actionRiskLevel,
  agentActionClassOfType,
  gateAgentActionExecution,
  isMutatingAction,
  partitionActions,
  type AgentAction,
} from '../agent/action-policy'
import { MODE_CAPABILITIES, gateToolForMode, visibleInMode } from '../engine/mode-capabilities'
import { AgentToolRegistry } from '../agents/registro-herramientas-dinamico'

const A = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload }) as unknown as AgentAction
const UI = ['abrir_pantalla', 'resaltar', 'guiar_paso_a_paso']

describe('clase de acción «ui» (U-maestra F6)', () => {
  it('abrir_pantalla, resaltar y guiar_paso_a_paso son ui; consultar_ayuda es read', () => {
    for (const t of UI) expect(agentActionClassOfType(t)).toBe('ui')
    expect(agentActionClassOfType('consultar_ayuda')).toBe('read')
    expect([...AGENT_UI_ACTIONS].sort()).toEqual([...UI].sort())
  })

  it('no muta, no pide confirmación y no es peligrosa; pasa la puerta sin confirmar', () => {
    for (const t of UI) {
      const a = A(t)
      expect(isMutatingAction(a)).toBe(false)
      expect(actionAlwaysNeedsConfirm(a)).toBe(false)
      expect(actionRiskLevel(a)).toBe('read')
      expect(gateAgentActionExecution(a, { userConfirmed: false })).toMatchObject({ allow: true, cls: 'ui' })
    }
    const p = partitionActions(UI.map((t) => A(t)))
    expect(p.readonly).toHaveLength(3)
    expect(p.mutating).toHaveLength(0)
    expect(p.destructive).toHaveLength(0)
    expect(p.blocked).toHaveLength(0)
  })

  it('se permite en todos los modos (también solo lectura) y es visible', () => {
    for (const caps of Object.values(MODE_CAPABILITIES)) {
      expect(caps.allowedClasses.has('ui')).toBe(true)
      for (const t of UI) {
        expect(visibleInMode(caps, t, 'ui')).toBe(true)
        expect(gateToolForMode(caps, t, 'ui', { planApproved: false })).toEqual({ allow: true })
      }
    }
  })

  it('fail closed: una herramienta de ayuda no clasificada sigue bloqueada', () => {
    expect(agentActionClassOfType('abrir_ventana_inventada')).toBeUndefined()
    expect(gateAgentActionExecution(A('abrir_ventana_inventada'), { userConfirmed: true }).allow).toBe(false)
    expect(partitionActions([A('abrir_ventana_inventada')]).blocked).toHaveLength(1)
  })

  it('un plugin no puede declararse de clase ui ni suplantar las herramientas ui del núcleo', () => {
    const reg = new AgentToolRegistry({ esHerramientaNucleo: (n) => Object.prototype.hasOwnProperty.call(AGENT_ACTION_CLASSES, n) })
    const plugin = (name: string, actionClass: string) =>
      ({
        pluginId: 'com.jaswave.plugin.demo',
        alias: 'demo',
        permisos: { fileSystem: 'none', network: false },
        rolesAllowed: ['mezcla'],
        herramientas: [{ name, description: 'x', parameters: { type: 'object' }, actionClass }],
      }) as unknown as Parameters<AgentToolRegistry['registrar']>[0]
    expect(() => reg.registrar(plugin('plugin.demo.mostrar', 'ui'))).toThrow()
    expect(() => reg.registrar(plugin('abrir_pantalla', 'read'))).toThrow()
  })
})
