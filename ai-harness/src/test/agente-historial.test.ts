import { describe, expect, it } from 'vitest'
import { AVISO_HISTORIAL_ABREVIADO, compactarArgumentosHistorial, ejecutarAgente, vistaHistorial, type ChatAgente, type HerramientaAgente, type MensajeAgente } from '../agente'

const CATALOGO: HerramientaAgente[] = [{ nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: { type: 'object' }, clase: 'escritura' }]
const notas = Array.from({ length: 40 }, (_, i) => ({ pitch: 60 + i, inicio: i, duracion: 1 }))
const RESUMEN = '[lista de 40 elementos, abreviada en el historial]'

describe('historial compacto del agente', () => {
  it('resume las listas largas y conserva lo demás', () => {
    expect(compactarArgumentosHistorial({ pistaId: 'p1', notas, tags: ['a', 'b'], anidado: { lista: notas } })).toEqual({
      pistaId: 'p1',
      notas: RESUMEN,
      tags: ['a', 'b'],
      anidado: { lista: RESUMEN },
    })
  })

  it('la vista para el modelo deja completa la última llamada (su ejemplo a imitar) y abrevia las anteriores', () => {
    const mensajes: MensajeAgente[] = [
      { role: 'user', content: 'graba' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'midi.addNotes', arguments: { pistaId: 'p1', notas } }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1', name: 'midi.addNotes' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'midi.addNotes', arguments: { pistaId: 'p2', notas } }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c2', name: 'midi.addNotes' },
    ]
    const vista = vistaHistorial(mensajes, 1)
    const llamadas = vista.filter((m) => m.role === 'assistant') as Array<{ toolCalls?: Array<{ arguments: Record<string, unknown> }> }>
    expect(llamadas[0]!.toolCalls![0]!.arguments.notas).toBe(RESUMEN)
    expect(llamadas[1]!.toolCalls![0]!.arguments.notas).toHaveLength(40)
    // El historial real no cambia.
    expect((mensajes[1] as { toolCalls: Array<{ arguments: Record<string, unknown> }> }).toolCalls[0]!.arguments.notas).toHaveLength(40)
  })

  it('la herramienta recibe las notas completas; el modelo ve completas las 3 últimas llamadas, abreviadas las anteriores y un aviso', async () => {
    const historiales: MensajeAgente[][] = []
    const sistemas: string[] = []
    let vez = 0
    const chat: ChatAgente = async (o) => {
      historiales.push(o.mensajes)
      sistemas.push(o.sistema)
      vez++
      if (vez <= 4) return { ok: true, texto: '', llamadas: [{ id: `c${vez}`, nombre: 'midi.addNotes', argumentos: { pistaId: `p${vez}`, notas } }] }
      return { ok: true, texto: 'listo', llamadas: [] }
    }
    const recibidas: number[] = []
    await ejecutarAgente({
      pedido: 'graba',
      catalogo: CATALOGO,
      sistema: 'Eres test',
      chat,
      ejecutar: async (l) => {
        recibidas.push((l.argumentos.notas as unknown[]).length)
        return { ok: true }
      },
    })
    expect(recibidas).toEqual([40, 40, 40, 40])
    const asistentes = (h: MensajeAgente[]) => h.filter((m) => m.role === 'assistant') as Array<{ toolCalls?: Array<{ arguments: Record<string, unknown> }> }>
    // Cuarto paso: las tres llamadas anteriores van completas y el sistema no lleva aviso.
    expect(asistentes(historiales[3]!).every((a) => Array.isArray(a.toolCalls![0]!.arguments.notas))).toBe(true)
    expect(sistemas[3]).toBe('Eres test')
    // Quinto paso: la primera se abrevia, las tres últimas van completas y el sistema avisa de la abreviatura.
    const [a1, a2, a3, a4] = asistentes(historiales[4]!)
    expect(a1!.toolCalls![0]!.arguments.notas).toBe(RESUMEN)
    expect(a2!.toolCalls![0]!.arguments.notas).toHaveLength(40)
    expect(a3!.toolCalls![0]!.arguments.notas).toHaveLength(40)
    expect(a4!.toolCalls![0]!.arguments.notas).toHaveLength(40)
    expect(sistemas[4]).toContain(AVISO_HISTORIAL_ABREVIADO)
  })
})
