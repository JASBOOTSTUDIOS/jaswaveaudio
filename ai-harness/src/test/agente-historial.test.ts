import { describe, expect, it } from 'vitest'
import { compactarArgumentosHistorial, ejecutarAgente, type ChatAgente, type HerramientaAgente, type MensajeAgente } from '../agente'

const CATALOGO: HerramientaAgente[] = [{ nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: { type: 'object' }, clase: 'escritura' }]
const notas = Array.from({ length: 40 }, (_, i) => ({ pitch: 60 + i, inicio: i, duracion: 1 }))

describe('historial compacto del agente', () => {
  it('resume las listas largas y conserva lo demás', () => {
    expect(compactarArgumentosHistorial({ pistaId: 'p1', notas, tags: ['a', 'b'], anidado: { lista: notas } })).toEqual({
      pistaId: 'p1',
      notas: '[40 elementos]',
      tags: ['a', 'b'],
      anidado: { lista: '[40 elementos]' },
    })
  })

  it('la herramienta recibe las notas completas; el historial del modelo, el resumen', async () => {
    const historiales: MensajeAgente[][] = []
    let vez = 0
    const chat: ChatAgente = async (o) => {
      historiales.push(o.mensajes)
      return ++vez === 1 ? { ok: true, texto: '', llamadas: [{ id: 'c1', nombre: 'midi.addNotes', argumentos: { pistaId: 'p1', notas } }] } : { ok: true, texto: 'listo', llamadas: [] }
    }
    let recibidas = 0
    await ejecutarAgente({
      pedido: 'graba',
      catalogo: CATALOGO,
      sistema: 'Eres test',
      chat,
      ejecutar: async (l) => {
        recibidas = (l.argumentos.notas as unknown[]).length
        return { ok: true }
      },
    })
    expect(recibidas).toBe(40)
    const asistente = historiales[1]!.find((m) => m.role === 'assistant') as { toolCalls?: Array<{ arguments: Record<string, unknown> }> }
    expect(asistente.toolCalls?.[0]?.arguments.notas).toBe('[40 elementos]')
  })
})
