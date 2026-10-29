import { describe, expect, it } from 'vitest'
import {
  ejecutarProduccion,
  H_ACORDAR,
  H_DEVOLVER,
  H_ENCARGOS,
  H_PROPONER,
  H_HOJA,
  H_VEREDICTO,
  hojaComoTexto,
  normalizarHoja,
  resolverMusico,
  type ChatAgente,
  type EventoProduccion,
  type HerramientaAgente,
  type ParticipanteProduccion,
  type RespuestaModelo,
} from '../agente'

const CATALOGO: HerramientaAgente[] = [
  { nombre: 'project.getSummary', descripcion: 'Resumen del proyecto', parametros: { type: 'object' }, clase: 'lectura' },
  { nombre: 'project.setBpm', descripcion: 'Cambia el tempo', parametros: { type: 'object' }, clase: 'escritura' },
  { nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: { type: 'object' }, clase: 'escritura' },
  { nombre: 'mix.setVolume', descripcion: 'Volumen de pista', parametros: { type: 'object' }, clase: 'escritura' },
  { nombre: 'master.setChain', descripcion: 'Cadena del máster', parametros: { type: 'object' }, clase: 'escritura' },
]

const EQUIPO: ParticipanteProduccion[] = [
  { id: 'plan', nombre: 'Planificador', descripcion: 'plan', instrucciones: '', rol: 'planificador' },
  { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
  { id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', rol: 'musico', herramientas: ['midi.addNotes'] },
  { id: 'baj', nombre: 'Bajo', descripcion: 'bajo', instrucciones: '', rol: 'musico' },
  { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
  { id: 'mix', nombre: 'Mezcla', descripcion: 'mezcla', instrucciones: '', rol: 'mezcla' },
  { id: 'mas', nombre: 'Máster', descripcion: 'máster', instrucciones: '', rol: 'master' },
]

describe('a quién va cada encargo', () => {
  const musicos: ParticipanteProduccion[] = [
    { id: 'pianista', nombre: 'Pianista', descripcion: '', instrucciones: '', rol: 'musico' },
    { id: 'baterista', nombre: 'Baterista / Percusión', descripcion: '', instrucciones: '', rol: 'musico' },
    { id: 'sintetizador', nombre: 'Diseñador de Sintes / Leads', descripcion: '', instrucciones: '', rol: 'musico' },
    { id: 'bajista', nombre: 'Bajista', descripcion: '', instrucciones: '', rol: 'musico' },
  ]
  it('acepta el id, el nombre, mayúsculas, acentos y partes del nombre (el modelo no copia los ids tal cual)', () => {
    expect(resolverMusico('pianista', musicos)?.id).toBe('pianista')
    expect(resolverMusico('Pianista', musicos)?.id).toBe('pianista')
    expect(resolverMusico('Baterista / Percusión', musicos)?.id).toBe('baterista')
    expect(resolverMusico('el baterista', musicos)?.id).toBe('baterista')
    expect(resolverMusico('percusion', musicos)?.id).toBe('baterista')
    expect(resolverMusico('Diseñador de Sintes', musicos)?.id).toBe('sintetizador')
    expect(resolverMusico('sintes', musicos)?.id).toBe('sintetizador')
    expect(resolverMusico('Bajista (bajo eléctrico)', musicos)?.id).toBe('bajista')
    expect(resolverMusico('cuerdas', musicos)).toBeUndefined()
    expect(resolverMusico('', musicos)).toBeUndefined()
  })
})

let n = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `${nombre}-${++n}`, nombre, argumentos })
const hecho = (texto: string): RespuestaModelo => ({ ok: true, texto, llamadas: [] })

type Guion = (rol: string, o: Parameters<ChatAgente>[0], vez: number) => RespuestaModelo

/** Modelo que responde según el agente (las etapas paralelas no tienen un orden fijo). */
function modelo(g: Guion) {
  const veces = new Map<string, number>()
  const herramientasVistas = new Map<string, string[]>()
  const chat: ChatAgente = async (o) => {
    const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
    const ultimo = o.mensajes[o.mensajes.length - 1]
    // Tras un resultado de herramienta, el agente termina.
    if (ultimo?.role === 'tool') return hecho(`${rol} terminó`)
    const vez = (veces.get(rol) ?? 0) + 1
    veces.set(rol, vez)
    // Las herramientas de la primera intervención (la de su oficio; en el ensayo solo lee).
    if (!herramientasVistas.has(rol)) herramientasVistas.set(rol, o.herramientas.map((h) => h.name))
    return g(rol, o, vez)
  }
  return { chat, veces, herramientasVistas }
}

describe('hoja de ruta', () => {
  it('calcula el beat de cada sección y completa un acorde por compás', () => {
    const h = normalizarHoja({
      tonalidad: 'Re mayor',
      bpm: 74,
      numerador: 4,
      secciones: [
        { nombre: 'Intro', compases: 4, acordes: ['D', 'A'] },
        { nombre: 'Verso', compases: 8, acordes: ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A', 'sobra'] },
        { nombre: 'Mala', compases: 0, acordes: ['D'] },
      ],
    })!
    expect(h.secciones.map((s) => s.acordes.length)).toEqual([4, 8])
    expect(h.secciones[0]!.acordes).toEqual(['D', 'A', 'A', 'A'])
    const t = hojaComoTexto(h)
    expect(t).toMatch(/Intro: compases 1–4, beat inicio 0, 16 beats/)
    expect(t).toMatch(/Verso: compases 5–12, beat inicio 16, 32 beats/)
    expect(t).toMatch(/Final de la canción: beat 48/)
    expect(normalizarHoja({ tonalidad: 'Do', numerador: 4, secciones: [] })).toBeNull()
  })

  it('la hoja del planificador llega a todos los músicos', async () => {
    const sistemas: string[] = []
    const { chat } = modelo((rol, o) => {
      sistemas.push(o.sistema)
      if (rol === 'Planificador')
        return { ok: true, texto: '', llamadas: [ll(H_HOJA, { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Coro', compases: 2, acordes: ['G', 'A'] }] })] }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    const r = await ejecutarProduccion({ pedido: 'coro', catalogo: CATALOGO, participantes: EQUIPO, chat, ejecutar: async () => ({ ok: true }) })
    expect(r.plan).toMatch(/HOJA DE RUTA/)
    expect(sistemas.find((s) => s.startsWith('Eres Batería'))).toMatch(/Coro: compases 1–2, beat inicio 0, 8 beats.*G \| A/)
  })
})

describe('oleadas de músicos', () => {
  it('la base rítmica graba primero y los demás reciben lo que ya tocan', async () => {
    const orden: string[] = []
    const pedidos = new Map<string, string>()
    const equipo: ParticipanteProduccion[] = [
      ...EQUIPO.filter((p) => p.rol !== 'musico'),
      { id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', rol: 'musico' },
      { id: 'pia', nombre: 'Pianista', descripcion: 'piano', instrucciones: '', rol: 'musico' },
    ]
    const { chat } = modelo((rol, o) => {
      if (rol === 'Batería' || rol === 'Pianista') {
        orden.push(rol)
        if (!pedidos.has(rol)) pedidos.set(rol, String(o.mensajes[0]?.content ?? ''))
        return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'pia', encargo: 'piano' }, { musico: 'bat', encargo: 'batería' }] })] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    let grabado = ''
    await ejecutarProduccion({
      pedido: 'balada',
      catalogo: CATALOGO,
      participantes: equipo,
      chat,
      ejecutar: async (_l, _h, ctx) => {
        if (ctx.agente === 'bat') grabado = '«Batería»: bombo en 1 y 3'
        return { ok: true }
      },
      partes: () => grabado,
    })
    expect(orden.slice(0, 2)).toEqual(['Batería', 'Pianista'])
    expect(pedidos.get('Pianista')).toMatch(/Lo que ya tocan los demás[\s\S]*bombo en 1 y 3/)
    expect(pedidos.get('Batería')).not.toMatch(/Lo que ya tocan/)
  })
})

describe('arreglista (coherencia)', () => {
  const hojaDelPlan = () => ({ ok: true, texto: '', llamadas: [ll(H_HOJA, { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Coro', compases: 2, acordes: ['G', 'A'] }] })] })

  it('tras grabar mide la coherencia, el arreglista corrige lo señalado y se vuelve a medir', async () => {
    const pedidos: string[] = []
    const { chat } = modelo((rol, o) => {
      if (rol === 'Planificador') return hojaDelPlan()
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] }
      if (rol === 'Batería') return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      if (rol === 'Arreglista') {
        pedidos.push(String(o.mensajes[0]?.content ?? ''))
        return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    const hojas: string[] = []
    let medidas = 0
    const eventos: EventoProduccion[] = []
    const r = await ejecutarProduccion({
      pedido: 'coro',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'),
      chat,
      ejecutar: async () => ({ ok: true }),
      coherencia: (h) => {
        hojas.push(h.tonalidad)
        return ++medidas === 1 ? { ok: false, detalles: ['«Batería»: deja de sonar en el compás 1'] } : { ok: true, detalles: [] }
      },
      onEvento: (e) => eventos.push(e),
    })
    expect(medidas).toBe(2)
    expect(hojas).toEqual(['Re mayor', 'Re mayor'])
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0]).toMatch(/«Batería»: deja de sonar en el compás 1/)
    const etapas = eventos.filter((e) => e.tipo === 'etapa' && e.fase === 'inicio').map((e) => (e as { etapa: string }).etapa)
    expect(etapas.slice(0, 5)).toEqual(['plan', 'direccion', 'musicos', 'coherencia', 'qa_musicos'])
    expect(r.etapas.find((e) => e.etapa === 'coherencia')).toMatchObject({ ok: true, rondas: 1 })
    expect(r.texto).toMatch(/Coherencia: aprobada \(1 corrección\)/)
  })

  it('si todo encaja no llama al arreglista; sin hoja no mide', async () => {
    let arreglista = 0
    const g = (conHoja: boolean) =>
      modelo((rol) => {
        if (rol === 'Planificador') return conHoja ? hojaDelPlan() : hecho('plan')
        if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] }
        if (rol === 'Arreglista') arreglista++
        if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
        return hecho('ok')
      }).chat
    let medidas = 0
    const base = { pedido: 'coro', catalogo: CATALOGO, participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'), ejecutar: async () => ({ ok: true }), coherencia: () => (medidas++, { ok: true, detalles: [] }) }
    await ejecutarProduccion({ ...base, chat: g(true) })
    expect(medidas).toBe(1)
    await ejecutarProduccion({ ...base, chat: g(false) })
    expect(medidas).toBe(1)
    expect(arreglista).toBe(0)
  })
})

describe('ensayo (la banda se pone de acuerdo)', () => {
  const dosEncargos = () => ({ ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería: bombo en 1 y 3' }, { musico: 'baj', encargo: 'bajo en negras' }] })] })
  const okQA = () => ({ ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] })

  it('cada músico escucha a los demás y propone; el director acuerda y solo el afectado vuelve a tocar lo acordado', async () => {
    const pedidos = new Map<string, string[]>()
    const anota = (rol: string, o: Parameters<ChatAgente>[0]) => pedidos.set(rol, [...(pedidos.get(rol) ?? []), String(o.mensajes[0]?.content ?? '')])
    let herramientasEnsayoBajo: string[] = []
    const { chat } = modelo((rol, o) => {
      anota(rol, o)
      const pedido = String(o.mensajes[0]?.content ?? '')
      if (rol === 'Bajo' && /Ensayo de la banda\. Escucha/.test(pedido)) herramientasEnsayoBajo = o.herramientas.map((h) => h.name)
      if (rol === 'Director') {
        if (/Ensayo de la banda/.test(pedido)) return { ok: true, texto: '', llamadas: [ll(H_ACORDAR, { ajustes: [{ musico: 'baj', ajuste: 'Sube una octava en el coro' }], nota: 'El bajo pisaba a la batería.' })] }
        return dosEncargos()
      }
      if (rol === 'Batería') {
        if (/Ensayo de la banda\. Escucha/.test(pedido)) return { ok: true, texto: '', llamadas: [ll(H_PROPONER, { conforme: true, propuestas: [{ para: 'baj', ajuste: 'Sube una octava en el coro' }] })] }
        return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      }
      if (rol === 'Bajo') {
        if (/Ensayo de la banda\. Escucha/.test(pedido)) return { ok: true, texto: '', llamadas: [ll(H_PROPONER, { conforme: true, propuestas: [] })] }
        return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      }
      if (rol === 'QA') return okQA()
      return hecho('ok')
    })
    const eventos: EventoProduccion[] = []
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'),
      chat,
      ejecutar: async () => ({ ok: true }),
      partes: () => '«Batería»: bombo en 1 y 3',
      onEvento: (e) => eventos.push(e),
    })
    // Acuerdo previo: cada músico conoce el reparto de los demás.
    expect(pedidos.get('Batería')?.[0]).toMatch(/Reparto de la banda[\s\S]*Bajo: bajo en negras/)
    expect(pedidos.get('Batería')?.[0]).not.toMatch(/Batería: batería/)
    // Ensayo: los dos opinan (solo lectura), el director acuerda y solo el bajo vuelve a tocar.
    expect(pedidos.get('Batería')).toHaveLength(2)
    expect(pedidos.get('Bajo')).toHaveLength(3)
    expect(pedidos.get('Bajo')?.[1]).toMatch(/Ensayo de la banda\. Escucha[\s\S]*bombo en 1 y 3/)
    expect(pedidos.get('Bajo')?.[2]).toMatch(/se acordó que ajustes tu parte así: Sube una octava en el coro[\s\S]*El bajo pisaba a la batería/)
    expect(pedidos.get('Director')?.[1]).toMatch(/Conformes con su parte: Bajo\.[\s\S]*Batería propone a Bajo: Sube una octava/)
    expect(herramientasEnsayoBajo).toContain(H_PROPONER)
    expect(herramientasEnsayoBajo).not.toContain('midi.addNotes')
    const ens = eventos.find((e) => e.tipo === 'ensayo') as Extract<EventoProduccion, { tipo: 'ensayo' }>
    expect(ens).toMatchObject({ ronda: 1, conformes: ['baj'], propuestas: [{ de: 'bat', para: 'baj', ajuste: 'Sube una octava en el coro' }], acordados: [{ musico: 'baj', ajuste: 'Sube una octava en el coro' }], nota: 'El bajo pisaba a la batería.' })
    const etapas = eventos.filter((e) => e.tipo === 'etapa' && e.fase === 'inicio').map((e) => (e as { etapa: string }).etapa)
    expect(etapas).toEqual(['plan', 'direccion', 'musicos', 'ensayo', 'qa_musicos'])
    expect(r.etapas.find((e) => e.etapa === 'ensayo')).toMatchObject({ ok: true, rondas: 1 })
    expect(r.texto).toMatch(/Ensayo: aprobada \(1 corrección\)/)
    expect(r.estado).toBe('completado')
  })

  it('si todos están conformes nadie regraba; sin director se acuerda lo propuesto a otros; con un solo músico no hay ensayo', async () => {
    const veces = new Map<string, number>()
    const guion =
      (conforme: boolean) =>
      (rol: string, o: Parameters<ChatAgente>[0]): RespuestaModelo => {
        veces.set(rol, (veces.get(rol) ?? 0) + 1)
        const pedido = String(o.mensajes[0]?.content ?? '')
        if (rol === 'Director') return dosEncargos()
        if (rol === 'Batería' || rol === 'Bajo') {
          if (/Ensayo de la banda\. Escucha/.test(pedido)) {
            return conforme || rol === 'Bajo'
              ? { ok: true, texto: '', llamadas: [ll(H_PROPONER, { conforme: true })] }
              : { ok: true, texto: '', llamadas: [ll(H_PROPONER, { conforme: false, propuestas: [{ para: 'baj', ajuste: 'Menos notas en el verso' }, { para: 'yo', ajuste: 'Platos en el coro' }] })] }
          }
          return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
        }
        if (rol === 'QA') return okQA()
        return hecho('ok')
      }
    const base = { pedido: 'tema', catalogo: CATALOGO, ejecutar: async () => ({ ok: true }) }
    const equipo = EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master')

    // Todos conformes: una sola ronda de opinión y nadie vuelve a tocar.
    let r = await ejecutarProduccion({ ...base, participantes: equipo, chat: modelo(guion(true)).chat })
    expect(veces.get('Batería')).toBe(2)
    expect(veces.get('Bajo')).toBe(2)
    expect(veces.get('Director')).toBe(1)
    expect(r.etapas.find((e) => e.etapa === 'ensayo')).toMatchObject({ ok: true, rondas: 0, resumen: 'La banda está de acuerdo: cada parte encaja con las demás.' })
    expect(r.texto).toMatch(/Ensayo: aprobada\./)

    // Sin director: lo que la batería propone para el bajo y para sí misma se acuerda tal cual.
    veces.clear()
    const eventos: EventoProduccion[] = []
    r = await ejecutarProduccion({ ...base, participantes: equipo.filter((p) => p.rol !== 'director'), chat: modelo(guion(false)).chat, onEvento: (e) => eventos.push(e) })
    const ens = eventos.find((e) => e.tipo === 'ensayo') as Extract<EventoProduccion, { tipo: 'ensayo' }>
    expect(ens.acordados).toEqual([
      { musico: 'baj', ajuste: 'Menos notas en el verso (lo pide Batería)' },
      { musico: 'bat', ajuste: 'Platos en el coro (lo pide Batería)' },
    ])
    expect(veces.get('Batería')).toBe(3)
    expect(veces.get('Bajo')).toBe(3)

    // Un solo músico: no hay con quién ensayar; y se puede desactivar.
    veces.clear()
    const unMusico = equipo.filter((p) => p.id !== 'baj')
    r = await ejecutarProduccion({ ...base, participantes: unMusico, chat: modelo(guion(false)).chat })
    expect(veces.get('Batería')).toBe(1)
    expect(r.etapas.some((e) => e.etapa === 'ensayo')).toBe(false)
    veces.clear()
    r = await ejecutarProduccion({ ...base, participantes: equipo, chat: modelo(guion(false)).chat, ensayo: false })
    expect(veces.get('Batería')).toBe(1)
    expect(r.etapas.some((e) => e.etapa === 'ensayo')).toBe(false)
  })
})

describe('cada agente es un filtro (devolver_trabajo)', () => {
  const hoja = () => ({ ok: true, texto: '', llamadas: [ll(H_HOJA, { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Coro', compases: 2, acordes: ['G', 'A'] }] })] })
  const encargoBat = () => ({ ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] })
  const okQA = () => ({ ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] })

  it('la mezcla devuelve una parte al músico: se regraba, se remide la coherencia y la mezcla retoma', async () => {
    const pedidosBat: string[] = []
    const pedidosMix: string[] = []
    const { chat } = modelo((rol, o) => {
      const pedido = String(o.mensajes[0]?.content ?? '')
      if (rol === 'Planificador') return hoja()
      if (rol === 'Director') return encargoBat()
      if (rol === 'Batería') {
        pedidosBat.push(pedido)
        return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      }
      if (rol === 'Mezcla') {
        pedidosMix.push(pedido)
        return pedidosMix.length === 1
          ? { ok: true, texto: '', llamadas: [ll(H_DEVOLVER, { destino: 'musicos', musico: 'bat', problema: 'La batería se para en el coro' }), ll('mix.setVolume')] }
          : hecho('Mezcla lista.')
      }
      if (rol === 'QA') return okQA()
      return hecho('ok')
    })
    let coherencias = 0
    const eventos: EventoProduccion[] = []
    const r = await ejecutarProduccion({
      pedido: 'coro',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.rol !== 'master'),
      chat,
      ejecutar: async () => ({ ok: true }),
      coherencia: () => (coherencias++, { ok: true, detalles: [] }),
      onEvento: (e) => eventos.push(e),
    })
    expect(pedidosBat).toHaveLength(2)
    expect(pedidosBat[1]).toMatch(/Te devuelven tu parte desde mezcla: La batería se para en el coro/)
    expect(pedidosMix).toHaveLength(2)
    expect(pedidosMix[1]).toMatch(/ya se atendió \(el músico corrigió su parte; la coherencia se volvió a medir\)/)
    expect(coherencias).toBe(2)
    const dev = eventos.find((e) => e.tipo === 'devolucion') as Extract<EventoProduccion, { tipo: 'devolucion' }> | undefined
    expect(dev?.devolucion).toEqual({ destino: 'musicos', musico: 'bat', problema: 'La batería se para en el coro' })
    expect(r.estado).toBe('completado')
  })

  it('una segunda devolución en la misma etapa se rechaza; el máster puede devolver a la mezcla', async () => {
    let mix = 0
    let mas = 0
    const { chat } = modelo((rol) => {
      if (rol === 'Planificador') return hoja()
      if (rol === 'Director') return encargoBat()
      if (rol === 'Batería') return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      if (rol === 'Mezcla') return ++mix === 1 ? { ok: true, texto: '', llamadas: [ll('mix.setVolume')] } : hecho('Mezcla retocada.')
      if (rol === 'Máster') {
        mas++
        if (mas <= 2) return { ok: true, texto: '', llamadas: [ll(H_DEVOLVER, { destino: 'mezcla', problema: `Demasiado bajo el bombo (${mas})` })] }
        return hecho('Máster listo.')
      }
      if (rol === 'QA') return okQA()
      return hecho('ok')
    })
    const r = await ejecutarProduccion({ pedido: 'coro', catalogo: CATALOGO, participantes: EQUIPO, chat, ejecutar: async () => ({ ok: true }), coherencia: () => ({ ok: true, detalles: [] }) })
    const devoluciones = r.llamadas.filter((l) => l.nombre === H_DEVOLVER)
    expect(devoluciones.map((l) => l.ok)).toEqual([true, false])
    expect(mix).toBe(2)
    expect(r.estado).toBe('completado')
  })
})

describe('producción por etapas', () => {
  it('recorre plan → director → músicos en paralelo → QA → mezcla → QA → máster → QA', async () => {
    const ejecutadas: Array<{ agente: string; nombre: string }> = []
    const { chat, herramientasVistas } = modelo((rol) => {
      if (rol === 'Planificador') return hecho('Forma: verso y coro, 72 BPM, Re mayor.')
      if (rol === 'Director')
        return {
          ok: true,
          texto: '',
          llamadas: [
            ll('project.setBpm', { bpm: 72 }),
            ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería suave' }, { musico: 'baj', encargo: 'bajo en negras' }] }),
          ],
        }
      if (rol === 'Batería' || rol === 'Bajo') return { ok: true, texto: '', llamadas: [ll('midi.addNotes', { quien: rol })] }
      if (rol === 'Mezcla') return { ok: true, texto: '', llamadas: [ll('mix.setVolume')] }
      if (rol === 'Máster') return { ok: true, texto: '', llamadas: [ll('master.setChain')] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    const eventos: EventoProduccion[] = []
    const r = await ejecutarProduccion({
      pedido: 'una balada',
      catalogo: CATALOGO,
      participantes: EQUIPO,
      chat,
      ejecutar: async (l, _h, ctx) => {
        ejecutadas.push({ agente: ctx.agente, nombre: l.nombre })
        return { ok: true }
      },
      onEvento: (e) => eventos.push(e),
    })
    expect(r.estado).toBe('completado')
    expect(r.plan).toMatch(/Re mayor/)
    expect(r.encargos.map((e) => e.participante)).toEqual(['bat', 'baj'])
    expect(ejecutadas.filter((e) => e.nombre === 'midi.addNotes').map((e) => e.agente).sort()).toEqual(['baj', 'bat'])
    expect(ejecutadas.map((e) => e.nombre)).toContain('master.setChain')
    // Un músico con herramientas limitadas solo ve las suyas (además de las de coordinación).
    expect(herramientasVistas.get('Batería')).toContain('midi.addNotes')
    expect(herramientasVistas.get('Batería')).not.toContain('mix.setVolume')
    // El QA no puede editar.
    expect(herramientasVistas.get('QA')).not.toContain('midi.addNotes')
    const etapas = eventos.filter((e) => e.tipo === 'etapa' && e.fase === 'inicio').map((e) => (e as { etapa: string }).etapa)
    expect(etapas).toEqual(['plan', 'direccion', 'musicos', 'ensayo', 'qa_musicos', 'mezcla', 'qa_mezcla', 'master', 'qa_master'])
    expect(r.texto).not.toMatch(/midi\.|_calidad|\{/)
  })

  it('el QA devuelve problemas al músico responsable y se corrige en otra ronda', async () => {
    let revisiones = 0
    const pedidosBateria: string[] = []
    const { chat } = modelo((rol, o) => {
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }, { musico: 'baj', encargo: 'bajo' }] })] }
      if (rol === 'Batería') {
        pedidosBateria.push(o.mensajes.find((m) => m.role === 'user')?.content ?? '')
        return hecho('ok')
      }
      if (rol === 'QA') {
        revisiones++
        return revisiones === 1
          ? { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: false, resumen: 'Falta variación', problemas: [{ quien: 'bat', problema: 'el coro no tiene platos' }] })] }
          : { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Ahora sí.' })] }
      }
      return hecho('ok')
    })
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'),
      chat,
      ejecutar: async () => ({ ok: true }),
    })
    expect(pedidosBateria).toHaveLength(2)
    expect(pedidosBateria[1]).toMatch(/platos/)
    expect(r.etapas.find((e) => e.etapa === 'qa_musicos')).toMatchObject({ ok: true, rondas: 1 })
    expect(r.estado).toBe('completado')
  })

  it('si ningún músico graba nada y la revisión no lo aprueba, no sigue con mezcla ni máster', async () => {
    const roles: string[] = []
    const { chat } = modelo((rol) => {
      roles.push(rol)
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: false, resumen: 'No hay partes.', problemas: [{ quien: 'bat', problema: 'la pista está vacía' }] })] }
      return hecho('ok')
    })
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO,
      chat,
      ejecutar: async () => ({ ok: true }),
      medir: async (e) => (e === 'musicos' ? { ok: false, detalles: ['La pista «Batería» no tiene ninguna parte grabada.'] } : null),
    })
    expect(r.estado).toBe('fallo')
    expect(r.texto).toMatch(/no consiguieron grabar/)
    expect(roles).not.toContain('Mezcla')
    expect(roles).not.toContain('Máster')
  })

  it('cada rol ve desde el principio sus herramientas de oficio', async () => {
    const { chat, herramientasVistas } = modelo((rol) => {
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'baj', encargo: 'graba el bajo' }] })] }
      if (rol === 'Bajo') return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      base: ['project.getSummary'],
      participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'),
      chat,
      ejecutar: async () => ({ ok: true }),
      herramientasPorRol: { musico: ['midi.addNotes'], director: ['project.setBpm'] },
    })
    expect(herramientasVistas.get('Bajo')).toEqual(expect.arrayContaining(['midi.addNotes', 'project.getSummary']))
    expect(herramientasVistas.get('Director')).toContain('project.setBpm')
  })

  it('la medición del host manda sobre el veredicto y las rondas tienen tope', async () => {
    let correccionesMaster = 0
    const { chat } = modelo((rol, o) => {
      if (rol === 'Máster') {
        if (o.mensajes.some((m) => m.role === 'user' && /Corrige/.test(m.content))) correccionesMaster++
        return hecho('ok')
      }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Me parece bien.' })] }
      return hecho('ok')
    })
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.rol !== 'musico'),
      chat,
      ejecutar: async () => ({ ok: true }),
      medir: async (etapa) => (etapa === 'master' ? { ok: false, detalles: ['Pico de −0,2 dBTP (objetivo −1)'] } : { ok: true, detalles: [] }),
      maxRondasQA: 2,
    })
    expect(correccionesMaster).toBe(2)
    expect(r.etapas.find((e) => e.etapa === 'qa_master')).toMatchObject({ ok: false, rondas: 2 })
    expect(r.estado).toBe('con_avisos')
    expect(r.texto).toMatch(/avisos/)
  })

  it('propiedad de pista: un músico solo escribe en la pista de su encargo (o en la que creó él)', async () => {
    const { chat } = modelo((rol) => {
      if (rol === 'Director')
        return {
          ok: true,
          texto: '',
          llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', pista: 't-bat', encargo: 'batería' }, { musico: 'baj', pista: '"Bajo eléctrico"', encargo: 'bajo' }] })],
        }
      if (rol === 'Batería')
        return {
          ok: true,
          texto: '',
          llamadas: [
            ll('midi.addNotes', { pistaId: 't-baj', quien: 'bat' }), // pista de otro → rechazada
            ll('midi.addNotes', { pistaId: 't-bat', quien: 'bat' }), // la suya
          ],
        }
      if (rol === 'Bajo')
        return {
          ok: true,
          texto: '',
          llamadas: [
            ll('midi.addNotes', { pistaId: 't-baj' }), // por nombre resuelto → la suya
            ll('project.getSummary', { trackId: 't-bat' }), // leer la de otro sí se puede
            ll('mix.setVolume', { trackId: 'master' }), // el máster tampoco es suyo
            ll('track.create', { nombre: 'Bajo doblado' }), // crea otra: también suya
            ll('midi.addNotes', { pistaId: 't-nueva' }),
          ],
        }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    const ejecutadas: Array<{ agente: string; nombre: string; pista: unknown }> = []
    const pistas = [
      { id: 't-bat', nombre: 'Batería' },
      { id: 't-baj', nombre: 'Bajo eléctrico' },
      { id: 't-nueva', nombre: 'Bajo doblado' },
    ]
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO.concat([{ nombre: 'track.create', descripcion: 'Crea pista', parametros: { type: 'object' }, clase: 'escritura' }]),
      participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'),
      chat,
      ensayo: false,
      resolverPista: (ref) => pistas.find((p) => p.id === ref || p.nombre.toLowerCase() === ref.toLowerCase()) ?? null,
      ejecutar: async (l, _h, ctx) => {
        ejecutadas.push({ agente: ctx.agente, nombre: l.nombre, pista: l.argumentos.pistaId ?? l.argumentos.trackId })
        return l.nombre === 'track.create' ? { ok: true, datos: { id: 't-nueva', nombre: 'Bajo doblado' } } : { ok: true }
      },
    })
    expect(r.encargos.find((e) => e.participante === 'baj')?.pista).toBe('Bajo eléctrico')
    const escrituras = ejecutadas.filter((e) => e.nombre === 'midi.addNotes' || e.nombre === 'mix.setVolume')
    // Batería y bajo graban en paralelo (misma oleada): el orden entre ellos no es fijo.
    expect(escrituras.map((e) => `${e.agente}:${e.pista}`).sort()).toEqual(['baj:t-baj', 'baj:t-nueva', 'bat:t-bat'])
    // La lectura en la pista ajena sí pasó.
    expect(ejecutadas.some((e) => e.nombre === 'project.getSummary' && e.pista === 't-bat')).toBe(true)
    const vetadas = r.llamadas.filter((l) => !l.ok && /no es la tuya|no es una pista de músico/.test(l.error ?? ''))
    expect(vetadas.map((l) => `${l.agente}:${l.nombre}`).sort()).toEqual(['baj:mix.setVolume', 'bat:midi.addNotes'])
    expect(vetadas.find((l) => l.agente === 'bat')!.error).toMatch(/es de Bajo.*«Batería» = "t-bat"/)
    expect(vetadas.find((l) => l.agente === 'baj')!.error).toMatch(/«master» no es una pista de músico.*«Bajo eléctrico» = "t-baj"/)
  })

  it('una pista que el director creó y no repartió la puede llenar cualquier músico (antes quedaba vacía)', async () => {
    const { chat } = modelo((rol) => {
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería', pista: 't-bat' }, { musico: 'baj', encargo: 'bajo', pista: 't-baj' }] })] }
      // El bajista también graba en «Cuerdas» (sin encargo) y prueba en «Batería» (del baterista).
      if (rol === 'Bajo') return { ok: true, texto: '', llamadas: [ll('midi.addNotes', { pistaId: 't-baj' }), ll('midi.addNotes', { pistaId: 't-cuerdas' }), ll('midi.addNotes', { pistaId: 't-bat' })] }
      if (rol === 'Batería') return { ok: true, texto: '', llamadas: [ll('midi.addNotes', { pistaId: 't-bat' })] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    const pistas = [
      { id: 't-bat', nombre: 'Batería' },
      { id: 't-baj', nombre: 'Bajo eléctrico' },
      { id: 't-cuerdas', nombre: 'Cuerdas' },
    ]
    const escritas: string[] = []
    const r = await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.rol !== 'mezcla' && p.rol !== 'master'),
      chat,
      ensayo: false,
      resolverPista: (ref) => pistas.find((p) => p.id === ref || p.nombre.toLowerCase() === ref.toLowerCase()) ?? null,
      ejecutar: async (l, _h, ctx) => {
        if (l.nombre === 'midi.addNotes') escritas.push(`${ctx.agente}:${String(l.argumentos.pistaId)}`)
        return { ok: true }
      },
    })
    expect(escritas.sort()).toEqual(['baj:t-baj', 'baj:t-cuerdas', 'bat:t-bat'])
    const vetadas = r.llamadas.filter((l) => !l.ok && /no es la tuya/.test(l.error ?? ''))
    expect(vetadas.map((l) => `${l.agente}:${String(l.argumentos.pistaId)}`)).toEqual(['baj:t-bat'])
    expect(vetadas[0]!.error).toMatch(/es de Batería/)
  })

  it('si el director no reparte, cada músico recibe un encargo; y se puede cancelar', async () => {
    const ac = new AbortController()
    const { chat, veces } = modelo((rol) => {
      if (rol === 'Batería') ac.abort()
      return hecho('ok')
    })
    const r = await ejecutarProduccion({ pedido: 'tema', catalogo: CATALOGO, participantes: EQUIPO, chat, ejecutar: async () => ({ ok: true }), signal: ac.signal })
    expect(r.encargos.map((e) => e.participante)).toEqual(['bat', 'baj'])
    expect(r.estado).toBe('cancelado')
    expect(veces.get('Mezcla')).toBeUndefined()
  })
})

describe('indicaciones del usuario durante la producción', () => {
  it('el músico en turno la recibe entre dos pasos, los siguientes la ven en su contexto y una dirigida solo la ve su destinatario', async () => {
    const equipo = EQUIPO.filter((p) => p.id !== 'baj')
    let pendientes: Array<string | { texto: string; para?: string }> = []
    const sistemas = new Map<string, string>()
    const recibidoPorBateria: string[] = []
    const eventos: EventoProduccion[] = []
    const { chat } = modelo((rol, o, vez) => {
      if (!sistemas.has(rol)) sistemas.set(rol, o.sistema)
      if (rol === 'Director') {
        // El usuario escribe mientras el director reparte: la batería, que empieza después, lo ve en su contexto.
        pendientes.push('Nota A: la canción va en 6/8')
        return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', encargo: 'batería' }] })] }
      }
      if (rol === 'Batería') {
        if (vez === 1) {
          // Mientras la batería trabaja llegan una nota para todos y otra solo para la mezcla.
          pendientes.push('Nota B: el bombo suena tarde', { texto: 'Nota C: súbeme la voz', para: 'mix' })
          return { ok: true, texto: '', llamadas: [ll('midi.addNotes')] }
        }
        recibidoPorBateria.push(String(o.mensajes[o.mensajes.length - 1]?.content ?? ''))
        return hecho('Batería terminó')
      }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
      return hecho('ok')
    })
    const r = await ejecutarProduccion({
      pedido: 'balada',
      catalogo: CATALOGO,
      participantes: equipo,
      chat,
      ejecutar: async () => ({ ok: true }),
      notasUsuario: () => {
        const p = pendientes
        pendientes = []
        return p
      },
      onEvento: (e) => eventos.push(e),
    })
    expect(r.estado).toBe('completado')
    // La batería empezó con la nota A en su contexto y recibió la B en mitad de su trabajo (no la C, que no era para ella).
    expect(sistemas.get('Batería')).toMatch(/Indicaciones del usuario durante esta producción[\s\S]*- Nota A/)
    expect(recibidoPorBateria).toHaveLength(1)
    expect(recibidoPorBateria[0]).toMatch(/Indicaciones del usuario mientras trabajas[\s\S]*- Nota B/)
    expect(recibidoPorBateria[0]).not.toMatch(/Nota C/)
    // Los que vienen después ven A y B; la C solo la mezcla.
    expect(sistemas.get('QA')).toMatch(/- Nota A[\s\S]*- Nota B/)
    expect(sistemas.get('QA')).not.toMatch(/Nota C/)
    expect(sistemas.get('Mezcla')).toMatch(/- Nota C/)
    const notas = eventos.filter((e): e is Extract<EventoProduccion, { tipo: 'nota' }> => e.tipo === 'nota')
    expect(notas.map((e) => `${e.participante.id}:${e.texto.slice(0, 6)}`)).toContain('bat:Nota B')
    expect(notas.some((e) => e.participante.id === 'bat' && e.texto.startsWith('Nota C'))).toBe(false)
  })
})
