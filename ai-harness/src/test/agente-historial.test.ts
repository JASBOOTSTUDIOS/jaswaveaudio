import { describe, expect, it } from 'vitest'
import { compactarArgumentosHistorial, ejecutarAgente, vistaHistorial, type ChatAgente, type HerramientaAgente, type MensajeAgente } from '../agente'

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
    const vista = vistaHistorial(mensajes)
    const llamadas = vista.filter((m) => m.role === 'assistant') as Array<{ toolCalls?: Array<{ arguments: Record<string, unknown> }> }>
    expect(llamadas[0]!.toolCalls![0]!.arguments.notas).toBe(RESUMEN)
    expect(llamadas[1]!.toolCalls![0]!.arguments.notas).toHaveLength(40)
    // El historial real no cambia.
    expect((mensajes[1] as { toolCalls: Array<{ arguments: Record<string, unknown> }> }).toolCalls[0]!.arguments.notas).toHaveLength(40)
  })

  it('la herramienta recibe las notas completas; el modelo ve completa la última llamada y abreviadas las anteriores', async () => {
    const historiales: MensajeAgente[][] = []
    let vez = 0
    const chat: ChatAgente = async (o) => {
      historiales.push(o.mensajes)
      vez++
      if (vez <= 2) return { ok: true, texto: '', llamadas: [{ id: `c${vez}`, nombre: 'midi.addNotes', argumentos: { pistaId: `p${vez}`, notas } }] }
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
    expect(recibidas).toEqual([40, 40])
    const asistentes = (h: MensajeAgente[]) => h.filter((m) => m.role === 'assistant') as Array<{ toolCalls?: Array<{ arguments: Record<string, unknown> }> }>
    // Segundo paso: la única llamada anterior va completa (es la última).
    expect(asistentes(historiales[1]!)[0]!.toolCalls![0]!.arguments.notas).toHaveLength(40)
    // Tercer paso: la primera se abrevia y la segunda (la última) va completa.
    const [a1, a2] = asistentes(historiales[2]!)
    expect(a1!.toolCalls![0]!.arguments.notas).toBe(RESUMEN)
    expect(a2!.toolCalls![0]!.arguments.notas).toHaveLength(40)
  })
})
