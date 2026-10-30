import { describe, expect, it } from 'vitest'
import { asignarPistasHuerfanas, separarPistasExtra, ejecutarProduccion, familiaDePista, H_ENCARGOS, H_HOJA, H_VEREDICTO, pistasHuerfanas, type ChatAgente, type EventoProduccion, type HerramientaAgente, type ParticipanteProduccion, type RespuestaModelo } from '../agente'

const musicos: ParticipanteProduccion[] = [
  { id: 'bateria', nombre: 'Baterista', descripcion: 'batería y percusión', instrucciones: '', rol: 'musico' },
  { id: 'bajista', nombre: 'Bajista', descripcion: 'bajo', instrucciones: '', rol: 'musico' },
  { id: 'pianista', nombre: 'Pianista', descripcion: 'piano y teclados', instrucciones: '', rol: 'musico' },
  { id: 'guitarrista', nombre: 'Guitarrista', descripcion: 'guitarras', instrucciones: '', rol: 'musico' },
  { id: 'sintes', nombre: 'Diseñador de Sintes', descripcion: 'pads, leads, atmósferas', instrucciones: '', rol: 'musico' },
]

describe('dueño de cada pista (plan S)', () => {
  it('reconoce la familia del instrumento por el nombre', () => {
    expect(familiaDePista({ id: 'a', nombre: 'Cuerdas' })).toBe('cuerdas')
    expect(familiaDePista({ id: 'a', nombre: 'Pad ambiente' })).toBe('pad')
    expect(familiaDePista({ id: 'a', nombre: 'Guitarra eléctrica' })).toBe('guitarra')
    expect(familiaDePista({ id: 'a', nombre: 'Batería' })).toBe('bateria')
    expect(familiaDePista({ id: 'a', nombre: 'Misterio' })).toBeNull()
  })

  it('las pistas con encargo (por campo, id o nombre entre comillas) no son huérfanas', () => {
    const pistas = [
      { id: 'trk1', nombre: 'Batería' },
      { id: 'trk2', nombre: 'Bajo' },
      { id: 'trk3', nombre: 'Cuerdas' },
      { id: 'trk4', nombre: 'Piano' },
    ]
    const encargos = [
      { participante: 'bateria', encargo: 'toca', pista: 'trk1' },
      { participante: 'bajista', encargo: 'en «Bajo»' },
      { participante: 'pianista', encargo: 'lleva también la pista trk4' },
    ]
    expect(pistasHuerfanas(pistas, encargos).map((p) => p.nombre)).toEqual(['Cuerdas'])
  })

  it('cuerdas sin arreglista van al pianista (se amplía su encargo y queda como pista extra)', () => {
    const r = asignarPistasHuerfanas(
      [
        { participante: 'bateria', encargo: 'x', pista: 'trk1' },
        { participante: 'pianista', encargo: 'piano', pista: 'trk4' },
      ],
      musicos,
      [{ id: 'trk1', nombre: 'Batería' }, { id: 'trk3', nombre: 'Cuerdas' }, { id: 'trk4', nombre: 'Piano' }],
      'canción worship',
    )
    expect(r.asignaciones).toEqual([{ pista: 'trk3', nombre: 'Cuerdas', participante: 'pianista', nuevo: false }])
    const piano = r.encargos.find((e) => e.participante === 'pianista')!
    expect(piano.pista).toBe('trk4')
    expect(piano.pistasExtra).toEqual(['trk3'])
    expect(piano.encargo).toMatch(/Toca en TODA la canción/)
  })

  it('las pistas extra se reparten en un turno propio por pista, con su texto y sin perder el encargo original', () => {
    const r = asignarPistasHuerfanas(
      [
        { participante: 'bateria', encargo: 'x', pista: 'trk1' },
        { participante: 'pianista', encargo: 'piano', pista: 'trk4' },
      ],
      musicos,
      [{ id: 'trk1', nombre: 'Batería' }, { id: 'trk3', nombre: 'Cuerdas' }, { id: 'trk4', nombre: 'Piano' }],
      'canción worship',
    )
    const turnos = separarPistasExtra(r.encargos)
    expect(turnos).toHaveLength(3)
    const piano = turnos.find((e) => e.participante === 'pianista' && e.pista === 'trk4')!
    expect(piano.encargo).toBe('piano')
    expect(piano.pistasExtra).toBeUndefined()
    const cuerdas = turnos.find((e) => e.participante === 'pianista' && e.pista === 'trk3')!
    expect(cuerdas.encargo).toMatch(/Cuerdas/)
    expect(cuerdas.encargo).not.toMatch(/Además llevas otra pista/)
    // Sin pistas extra, los encargos pasan tal cual.
    expect(separarPistasExtra([{ participante: 'bateria', encargo: 'x', pista: 'trk1' }])).toEqual([{ participante: 'bateria', encargo: 'x', pista: 'trk1' }])
  })

  it('un músico sin encargo recibe uno nuevo; sin afinidad gana quien tiene menos pistas', () => {
    const r = asignarPistasHuerfanas([{ participante: 'bateria', encargo: 'x', pista: 'trk1' }], musicos, [{ id: 'trk1', nombre: 'Batería' }, { id: 'trk5', nombre: 'Guitarra' }, { id: 'trk6', nombre: 'Misterio' }], 'rock')
    expect(r.encargos.find((e) => e.participante === 'guitarrista')?.pista).toBe('trk5')
    const mis = r.asignaciones.find((a) => a.pista === 'trk6')!
    expect(mis.participante).not.toBe('bateria')
  })
})

const CATALOGO: HerramientaAgente[] = [{ nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: { type: 'object' }, clase: 'escritura' }]
let n = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `${nombre}-${++n}`, nombre, argumentos })

describe('producción: pistas huérfanas', () => {
  it('asigna la pista sin encargo, rescata la vacía una vez y lo deja en el resumen', async () => {
    const equipo: ParticipanteProduccion[] = [
      { id: 'plan', nombre: 'Planificador', descripcion: 'plan', instrucciones: '', rol: 'planificador' },
      { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
      { id: 'pianista', nombre: 'Pianista', descripcion: 'piano y teclados', instrucciones: '', rol: 'musico' },
      { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
    ]
    const pedidosPianista: string[] = []
    const chat: ChatAgente = async (o) => {
      const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
      if (o.mensajes[o.mensajes.length - 1]?.role === 'tool') return { ok: true, texto: `${rol} terminó`, llamadas: [] } as RespuestaModelo
      if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'A'] }] })] }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'pianista', encargo: 'piano', pista: 'trk4' }] })] }
      if (rol === 'Pianista') {
        pedidosPianista.push(String(o.mensajes[0]?.content ?? ''))
        return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return { ok: true, texto: 'ok', llamadas: [] }
    }
    const eventos: EventoProduccion[] = []
    const r = await ejecutarProduccion({
      pedido: 'canción worship',
      catalogo: CATALOGO,
      participantes: equipo,
      chat,
      ejecutar: async () => ({ ok: true }),
      pistas: () => [
        { id: 'trk4', nombre: 'Piano', notas: 40 },
        { id: 'trk3', nombre: 'Cuerdas', notas: 0 },
      ],
      onEvento: (e) => eventos.push(e),
    })
        const asign = eventos.filter((e) => e.tipo === 'pistas_asignadas').flatMap((e) => (e.tipo === 'pistas_asignadas' ? e.asignaciones : []))
    expect(asign.map((a) => `${a.nombre}:${a.rescate ? 'rescate' : 'asignada'}`)).toEqual(['Cuerdas:asignada', 'Cuerdas:rescate'])
    expect(r.encargos.find((e) => e.participante === 'pianista')?.pistasExtra).toEqual(['trk3'])
    expect(pedidosPianista.some((p) => /sigue VACÍA/.test(p))).toBe(true)
    expect(r.texto).toMatch(/«Cuerdas» → Pianista/)
  })
})
