import { describe, expect, it } from 'vitest'
import {
  ejecutarProduccion,
  H_ENCARGOS,
  H_HOJA,
  H_VEREDICTO,
  MAX_PETICIONES_RONDA_QA,
  PASOS_AFINAR_MEZCLA,
  normalizarHoja,
  resolverAhorro,
  type ChatAgente,
  type ConfigProduccion,
  type EventoProduccion,
  type HerramientaAgente,
  type ParticipanteProduccion,
  type RespuestaModelo,
} from '../agente'

const par = { type: 'object' }
const CATALOGO: HerramientaAgente[] = [
  { nombre: 'project.getSummary', descripcion: 'Resumen del proyecto', parametros: par, clase: 'lectura' },
  { nombre: 'midi.notes.get', descripcion: 'Lee notas', parametros: par, clase: 'lectura' },
  { nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: par, clase: 'escritura' },
  { nombre: 'mix.setVolume', descripcion: 'Volumen de pista', parametros: par, clase: 'escritura' },
]
const EQUIPO: ParticipanteProduccion[] = [
  { id: 'plan', nombre: 'Planificador', descripcion: 'plan', instrucciones: '', rol: 'planificador' },
  { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
  { id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', rol: 'musico' },
  { id: 'pia', nombre: 'Piano', descripcion: 'piano', instrucciones: '', rol: 'musico' },
  { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
  { id: 'mix', nombre: 'Mezcla', descripcion: 'mezcla', instrucciones: '', rol: 'mezcla' },
  { id: 'mas', nombre: 'Máster', descripcion: 'máster', instrucciones: '', rol: 'master' },
]
const HOJA = { tonalidad: 'Re mayor', numerador: 4, estilo: 'balada íntima', secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'G'] }] }

let n = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `${nombre}-${++n}`, nombre, argumentos })
const hecho = (t: string): RespuestaModelo => ({ ok: true, texto: t, llamadas: [] })

type Guion = (rol: string, o: Parameters<ChatAgente>[0]) => RespuestaModelo | undefined
async function producir(extra: Partial<ConfigProduccion> & { equipo?: ParticipanteProduccion[]; guion?: Guion } = {}) {
  const { guion, equipo = EQUIPO, ...resto } = extra
  const peticiones: Array<{ rol: string; pedido: string }> = []
  const eventos: EventoProduccion[] = []
  const orden: string[] = []
  const chat: ChatAgente = async (o) => {
    const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
    const primero = o.mensajes[0]
    peticiones.push({ rol, pedido: typeof primero?.content === 'string' ? primero.content : '' })
    const propia = guion?.(rol, o)
    if (propia) return propia
    const ultimo = o.mensajes[o.mensajes.length - 1]
    if (ultimo?.role === 'tool') return hecho(`${rol} terminó`)
    if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
    if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', pista: 'p1', encargo: 'batería' }, { musico: 'pia', pista: 'p2', encargo: 'piano' }] })] }
    if (rol === 'Batería' || rol === 'Piano') return { ok: true, texto: '', llamadas: [ll('midi.addNotes', { pistaId: rol === 'Batería' ? 'p1' : 'p2', n: ++n })] }
    if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'bien' })] }
    if (rol === 'Mezcla' || rol === 'Máster') return { ok: true, texto: '', llamadas: [ll('mix.setVolume', { pistaId: 'p1', n: ++n })] }
    return hecho('listo')
  }
  const r = await ejecutarProduccion({
    pedido: 'tema',
    catalogo: CATALOGO,
    base: ['project.getSummary'],
    participantes: equipo,
    chat,
    ejecutar: async (l) => {
      orden.push(l.nombre)
      return { ok: true }
    },
    onEvento: (e) => {
      eventos.push(e)
      if (e.tipo === 'mezcla_inicial') orden.push('MEZCLA_INICIAL')
      if (e.tipo === 'etapa' && e.fase === 'inicio') orden.push(`etapa:${e.etapa}`)
    },
    ...resto,
  })
  return { r, peticiones, eventos, orden }
}

describe('hoja de ruta con estilo', () => {
  it('el planificador puede emitir el estilo y se conserva', () => {
    const h = normalizarHoja({ tonalidad: 'D', numerador: 4, estilo: ' rock ', secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D'] }] })
    expect(h?.estilo).toBe('rock')
    expect(normalizarHoja({ tonalidad: 'D', numerador: 4, secciones: [{ nombre: 'V', compases: 1, acordes: ['D'] }] })?.estilo).toBeUndefined()
  })
})

describe('mezcla inicial determinista (plan T)', () => {
  it('se aplica antes de la mezcla del modelo, recibe el estilo y el modelo recibe el perfil como guion y solo afina', async () => {
    const llamadas: Array<{ hoja: unknown; ctx: { estilo?: string; pedido: string } }> = []
    const { r, peticiones, eventos, orden } = await producir({
      estilo: 'jazz',
      mezclaInicial: async (hoja, ctx) => {
        llamadas.push({ hoja, ctx })
        return { ok: true, aplicada: true, resumen: 'Mezcla inicial determinista: 2 pistas, 9 cambios.', perfil: 'Balada', guion: 'Perfil «Balada»: íntima, coro 5 dB sobre el verso.' }
      },
      guion: (rol) => (rol === 'Mezcla' ? { ok: true, texto: '', llamadas: [ll('mix.setVolume', { pistaId: 'p1', n: ++n })] } : undefined),
    })
    expect(llamadas).toHaveLength(1)
    expect((llamadas[0]!.hoja as { estilo: string }).estilo).toBe('balada íntima')
    expect(llamadas[0]!.ctx.estilo).toBe('jazz')
    expect(eventos.find((e) => e.tipo === 'mezcla_inicial')).toMatchObject({ ok: true, aplicada: true, perfil: 'Balada' })
    expect(orden.indexOf('MEZCLA_INICIAL')).toBeGreaterThanOrEqual(0)
    expect(orden.indexOf('MEZCLA_INICIAL')).toBeLessThan(orden.indexOf('etapa:mezcla'))
    const pedidoMezcla = peticiones.find((p) => p.rol === 'Mezcla')!.pedido
    expect(pedidoMezcla).toMatch(/YA está aplicada/)
    expect(pedidoMezcla).toMatch(/perfil de estilo «Balada»/)
    expect(pedidoMezcla).toMatch(/coro 5 dB sobre el verso/)
    expect(pedidoMezcla).toMatch(/Tus decisiones mandan/)
    expect(peticiones.filter((p) => p.rol === 'Mezcla' && /YA está aplicada/.test(p.pedido)).length).toBeLessThanOrEqual(PASOS_AFINAR_MEZCLA)
    expect(r.texto).toMatch(/Mezcla inicial \(sin modelo\): Mezcla inicial determinista/)
  })

  it('si falla o lanza, la producción sigue y el modelo hace la mezcla completa', async () => {
    const { r, peticiones, eventos } = await producir({
      mezclaInicial: async () => {
        throw new Error('sin audio')
      },
    })
    expect(eventos.find((e) => e.tipo === 'mezcla_inicial')).toMatchObject({ ok: false, aplicada: false })
    expect(peticiones.find((p) => p.rol === 'Mezcla')!.pedido).toMatch(/Mezcla la canción según el plan/)
    expect(['completado', 'con_avisos']).toContain(r.estado)
  })

  it('se aplica aunque no haya participante de mezcla', async () => {
    let veces = 0
    await producir({
      equipo: EQUIPO.filter((p) => p.rol !== 'mezcla'),
      mezclaInicial: async () => {
        veces++
        return { ok: true, aplicada: true, resumen: 'hecha' }
      },
    })
    expect(veces).toBe(1)
  })

  it('si el modelo de máster no termina, el máster mínimo determinista se aplica', async () => {
    let minimos = 0
    await producir({
      mezclaInicial: async () => ({ ok: true, aplicada: true, resumen: 'hecha' }),
      masterMinimo: async () => {
        minimos++
        return { ok: true, resumen: '−14 LUFS y −1 dBTP' }
      },
      guion: (rol) => (rol === 'Máster' ? { ok: false, texto: '', llamadas: [], error: 'modelo caído' } : undefined),
    })
    expect(minimos).toBe(1)
  })
})

describe('revisión de partes del QA acotada (plan T)', () => {
  const medirConProblemaUnaVez = () => async (etapa: string) => (etapa === 'musicos' ? { ok: false, detalles: ['La pista «Piano» no tiene ninguna parte grabada.'] } : null)

  it('con problemas concretos medidos por el host no se llama al modelo QA', async () => {
    const { peticiones } = await producir({ medir: medirConProblemaUnaVez() })
    expect(peticiones.filter((p) => p.rol === 'QA' && /partes grabadas/.test(p.pedido))).toHaveLength(0)
    expect(peticiones.some((p) => /no tiene ninguna parte grabada/.test(p.pedido))).toBe(true)
  })

  it('con el ahorro apagado el modelo QA sí revisa', async () => {
    const { peticiones } = await producir({ ahorro: { qaSoloMedicion: false }, medir: medirConProblemaUnaVez() })
    expect(peticiones.filter((p) => p.rol === 'QA' && /partes grabadas/.test(p.pedido)).length).toBeGreaterThan(0)
  })

  it('tope de peticiones por ronda: las correcciones no pasan del tope', async () => {
    const TOPE = 14
    const { r } = await producir({
      maxPeticionesRondaQA: TOPE,
      maxRondasQA: 2,
      guion: (rol) =>
        rol === 'QA'
          ? { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: false, resumen: 'mal', problemas: [{ problema: 'sin dinámica', quien: 'bat' }] })] }
          : rol === 'Batería' || rol === 'Piano'
            ? { ok: true, texto: '', llamadas: [ll('midi.addNotes', { pistaId: 'p1', n: ++n })] }
            : undefined,
    })
    const qa = r.tiempos!.etapas.qa_musicos
    expect(qa).toBeDefined()
    expect(qa!.peticiones).toBeLessThanOrEqual(TOPE * 5 + 5)
  })

  it('una lectura del QA ya hecha no se repite si nada se escribió', async () => {
    let lecturas = 0
    let qaVez = 0
    await producir({
      maxRondasQA: 2,
      ejecutar: async (l) => {
        if (l.nombre === 'midi.notes.get') lecturas++
        return { ok: true }
      },
      guion: (rol) => {
        if (rol === 'Batería' || rol === 'Piano') return hecho('sin cambios')
        if (rol !== 'QA') return undefined
        qaVez++
        return { ok: true, texto: '', llamadas: [ll('midi.notes.get', { pistaId: 'p1' }), ll(H_VEREDICTO, { aprobado: false, resumen: 'mal', problemas: [{ problema: 'x', quien: 'bat' }] })] }
      },
    })
    expect(qaVez).toBeGreaterThanOrEqual(2)
    expect(lecturas).toBeLessThan(qaVez)
  })

  it('valores por defecto', () => {
    expect(MAX_PETICIONES_RONDA_QA).toBe(40)
    expect(resolverAhorro()).toMatchObject({ qaSoloMedicion: true, topeRondaQA: true, lecturasUnicas: true })
    expect(resolverAhorro(false)).toMatchObject({ qaSoloMedicion: false, topeRondaQA: false, lecturasUnicas: false })
  })
})
