import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HABILIDADES, elegirHabilidad } from '@jaswave/ai-harness'
import type { HerramientaCatalogo } from '@jaswave/host-sdk'
import { crearEstadoInicial } from '../../../shared/src/index'
import {
  catalogoHerramientasAgente,
  compilarHabilidadConModelo,
  habilidadesDeEspecialistas,
  instruccionesHabilidadesEspecialista,
} from '../src/motor/especialistas-habilidades'
import { normalizarEspecialista, type EspecialistaConfig } from '../src/motor/especialistas-storage'

const PEDIDO =
  'Analiza con precisión las grabaciones MIDI de mis interpretaciones, incluyendo los micro-tiempos y la microdinámica de cada nota individual dentro de arpegios y acordes. Identifica las variaciones de velocidad, el ataque y los matices de estilo. Aplica estos patrones para generar nuevas melodías en Jaswave que repliquen exactamente mi toque natural para cada instrumento.'

const CATALOGO: HerramientaCatalogo[] = [
  { type: 'analysis.touch', description: 'Mide micro-tiempos y dinámica de cada nota.' },
  { type: 'style.touch.learn', description: 'Aprende un perfil de toque.' },
  { type: 'style.touch.apply', description: 'Aplica un perfil de toque.' },
  { type: 'project.setBpm', description: 'Cambia el tempo.' },
]

const base: EspecialistaConfig = { id: 'pianista-yo', nombre: 'Mi Pianista', role: 'musico', skills: [], activo: true }

describe('habilidades de especialistas', () => {
  it('compila con un modelo malo sin herramientas inventadas y en orden', async () => {
    const r = await compilarHabilidadConModelo(PEDIDO, {
      catalogo: CATALOGO,
      chat: async () => '{"pasos":[{"herramienta":"ai.cloneTouch"},{"herramienta":"style.touch.apply","payload":{}}]}',
    })
    assert.deepEqual(r.procedimiento?.pasos.map((p) => p.herramienta), ['analysis.touch', 'style.touch.learn', 'style.touch.apply'])
  })

  it('habilidadesDeEspecialistas: sólo activos, compatibles con datos viejos y elegibles', async () => {
    const { procedimiento } = await compilarHabilidadConModelo(PEDIDO, { catalogo: CATALOGO, chat: async () => null })
    assert.ok(procedimiento)
    const viejo = normalizarEspecialista({ id: 'viejo', nombre: 'Viejo', role: 'musico', activo: true })
    assert.ok(viejo)
    assert.deepEqual(viejo.skills, [])
    const lista: EspecialistaConfig[] = [
      { ...base, procedimientos: [procedimiento] },
      { ...base, id: 'apagado', activo: false, procedimientos: [procedimiento] },
      viejo,
    ]
    const habs = habilidadesDeEspecialistas(lista, CATALOGO)
    assert.equal(habs.length, 1)
    assert.match(habs[0]!.id, /^pianista-yo:usuario\./)
    const st = crearEstadoInicial()
    assert.equal(elegirHabilidad({ userText: PEDIDO, state: st }, [...HABILIDADES, ...habs])?.id, habs[0]!.id)
    assert.match(instruccionesHabilidadesEspecialista(lista[0]!), /1\. analysis\.touch/)
    assert.equal(instruccionesHabilidadesEspecialista(viejo), '')
  })

  it('catálogo real del agente no está vacío', () => {
    const cat = catalogoHerramientasAgente()
    assert.ok(cat.length > 30)
    assert.ok(cat.every((h) => typeof h.type === 'string' && typeof h.description === 'string'))
  })
})
