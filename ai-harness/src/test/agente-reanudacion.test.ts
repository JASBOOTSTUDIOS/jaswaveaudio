import { describe, expect, it } from 'vitest'
import {
  debeRegistrarse,
  ejecutarProduccion,
  esperarConexion,
  estadoEfectivo,
  H_ENCARGOS,
  H_HOJA,
  H_VEREDICTO,
  parsearDiario,
  reconstruirEstado,
  serializarRegistro,
  textoInterrupcion,
  UMBRAL_INTERRUMPIDA_MS,
  type ChatAgente,
  type EstadoProduccionGuardado,
  type EventoProduccion,
  type HerramientaAgente,
  type ParticipanteProduccion,
  type RegistroDiario,
  type RespuestaModelo,
} from '../agente'

const CATALOGO: HerramientaAgente[] = [
  { nombre: 'midi.addNotes', descripcion: 'Escribe notas', parametros: { type: 'object' }, clase: 'escritura' },
  { nombre: 'master.limit', descripcion: 'Limitador', parametros: { type: 'object' }, clase: 'escritura' },
]
const EQUIPO: ParticipanteProduccion[] = [
  { id: 'plan', nombre: 'Planificador', descripcion: 'plan', instrucciones: '', rol: 'planificador' },
  { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
  { id: 'bat', nombre: 'Batería', descripcion: 'batería', instrucciones: '', rol: 'musico' },
  { id: 'baj', nombre: 'Bajo', descripcion: 'bajo', instrucciones: '', rol: 'musico' },
  { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
  { id: 'mix', nombre: 'Mezcla', descripcion: 'mezcla', instrucciones: '', rol: 'mezcla' },
  { id: 'mas', nombre: 'Máster', descripcion: 'máster', instrucciones: '', rol: 'master' },
]
const HOJA = { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'A'] }, { nombre: 'Coro', compases: 2, acordes: ['G', 'A'] }] }
const PISTA: Record<string, string> = { Batería: 'bat', Bajo: 'baj' }

type Proyecto = { clips: Record<string, string[]> }

/** Una producción completa con modelo guionizado, proyecto en memoria y diario en memoria. */
function simulacion(o: { reanudar?: EstadoProduccionGuardado; proyecto?: Proyecto; caerEn?: (e: EventoProduccion | { punto: string }) => boolean } = {}) {
  let n = 0
  const proyecto: Proyecto = o.proyecto ? structuredClone(o.proyecto) : { clips: {} }
  const diario: RegistroDiario[] = []
  diario.push({ v: 1, t: Date.now(), k: 'inicio', runId: `run-${Math.random()}`, proyectoId: 'p1', pedido: 'canción de prueba', participantes: [] })
  const puntos: Array<{ que: string; proyecto: Proyecto }> = []
  const peticiones: string[] = []
  const escrituras: string[] = []
  const control = new AbortController()
  let congelado = false
  const caer = (x: EventoProduccion | { punto: string }) => {
    if (!congelado && o.caerEn?.(x)) {
      congelado = true
      control.abort()
    }
  }
  const chat: ChatAgente = async (p) => {
    const rol = /^Eres (\S+)/.exec(p.sistema)?.[1] ?? '?'
    peticiones.push(rol)
    const ultimo = p.mensajes[p.mensajes.length - 1]
    if (ultimo?.role === 'tool') return { ok: true, texto: `${rol} terminó`, llamadas: [] }
    const ll = (nombre: string, argumentos: Record<string, unknown>) => ({ id: `${nombre}-${++n}`, nombre, argumentos })
    if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
    if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', pista: 'bat', encargo: 'batería' }, { musico: 'baj', pista: 'baj', encargo: 'bajo' }] })] }
    if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'Bien.' })] }
    if (rol === 'Batería' || rol === 'Bajo') return { ok: true, texto: '', llamadas: HOJA.secciones.map((s) => ll('midi.addNotes', { pista: PISTA[rol], seccion: s.nombre })) }
    return { ok: true, texto: `${rol} ok`, llamadas: [] }
  }
  const promesa = ejecutarProduccion({
    pedido: 'canción de prueba',
    catalogo: CATALOGO,
    participantes: EQUIPO,
    chat,
    ejecutar: async (l) => {
      if (l.nombre === 'midi.addNotes') {
        const pista = String(l.argumentos.pista)
        const sec = String(l.argumentos.seccion)
        escrituras.push(`${pista}:${sec}`)
        // Idempotente, como `midi.clip.create` sobre un tramo ocupado: reescribe, no duplica.
        const lista = (proyecto.clips[pista] ??= [])
        if (!lista.includes(sec)) lista.push(sec)
      }
      return { ok: true }
    },
    completitud: (e, hoja) => {
      const hay = proyecto.clips[e.pista ?? ''] ?? []
      const falta = hoja.secciones.filter((s) => !hay.includes(s.nombre)).map((s) => s.nombre)
      return falta.length ? `en «${e.pista}» no hay notas en: ${falta.join(', ')}` : null
    },
    coherencia: () => ({ ok: true, detalles: ['todo encaja'] }),
    medir: async () => ({ ok: true, detalles: ['bien'] }),
    reanudar: o.reanudar,
    alPuntoDeControl: (que) => {
      if (congelado) return
      puntos.push({ que, proyecto: structuredClone(proyecto) })
      diario.push({ v: 1, t: Date.now(), k: 'control', que, huella: `h${puntos.length}` })
      caer({ punto: que })
    },
    onEvento: (e) => {
      if (congelado) return
      caer(e)
      if (congelado) return
      if (debeRegistrarse(e)) diario.push({ v: 1, t: Date.now(), k: 'evento', e })
    },
    signal: control.signal,
  })
  return { promesa, proyecto, diario, puntos, peticiones, escrituras }
}

const sinTiempos = (x: string[]) => x.filter((r) => r !== '?')

describe('diario: formato y reconstrucción', () => {
  it('tolera una última línea truncada y una línea dañada en medio', () => {
    const l1 = serializarRegistro({ k: 'inicio', runId: 'r1', proyectoId: 'p', pedido: 'x', participantes: [] }, 1000)
    const l2 = serializarRegistro({ k: 'vida', etapa: 'plan' }, 2000)
    const l3 = serializarRegistro({ k: 'estado', estado: 'completada' }, 3000)
    const texto = l1 + l2 + '{basura\n' + l3 + l3.slice(0, 15)
    const r = parsearDiario(texto)
    expect(r.registros.map((x) => x.k)).toEqual(['inicio', 'vida', 'estado'])
    expect(r.truncada).toBe(true)
    expect(r.dañadas).toBe(1)
    expect(reconstruirEstado(r)?.estado).toBe('completada')
  })

  it('«en curso» sin señal de vida durante más de 90 s es una producción interrumpida', () => {
    const regs = parsearDiario(serializarRegistro({ k: 'inicio', runId: 'r1', proyectoId: 'p', pedido: 'x', participantes: [] }, 1000) + serializarRegistro({ k: 'vida', etapa: 'musicos' }, 5000)).registros
    const res = reconstruirEstado(regs)!
    expect(estadoEfectivo(res, 5000 + 30_000)).toBe('en_curso')
    expect(estadoEfectivo(res, 5000 + UMBRAL_INTERRUMPIDA_MS + 1)).toBe('interrumpida')
    expect(textoInterrupcion(res, 5000 + 120_000)).toMatch(/se interrumpió en la grabación hace 2 min/)
  })
})

describe('caída y reanudación', () => {
  it('una producción sin interrupción deja a cada músico con sus dos secciones, sin duplicados', async () => {
    const s = simulacion()
    const r = await s.promesa
    expect(r.estado).toBe('completado')
    expect(s.proyecto.clips).toEqual({ bat: ['Verso', 'Coro'], baj: ['Verso', 'Coro'] })
    expect(s.escrituras).toHaveLength(4)
    const res = reconstruirEstado(s.diario)!
    expect(res.guardado.musicosTerminados.sort()).toEqual(['baj', 'bat'])
    expect(res.guardado.etapasCompletas).toEqual(expect.arrayContaining(['plan', 'direccion', 'musicos', 'qa_musicos', 'mezcla', 'qa_mezcla', 'master', 'qa_master']))
  })

  it('cae tras CADA punto de control y tras el inicio de CADA etapa: al reanudar queda igual que sin interrupción', async () => {
    const ref = simulacion()
    const rRef = await ref.promesa
    const claves = ref.puntos.map((p) => p.que)
    expect(claves).toEqual(expect.arrayContaining(['etapa:plan', 'etapa:direccion', 'musico:bat', 'musico:baj', 'etapa:musicos', 'etapa:mezcla', 'etapa:master', 'etapa:qa_master']))

    const escenarios: Array<{ nombre: string; caerEn: (x: EventoProduccion | { punto: string }) => boolean }> = [
      ...claves.map((k) => ({ nombre: `tras ${k}`, caerEn: (x: EventoProduccion | { punto: string }) => 'punto' in x && x.punto === k })),
      ...(['plan', 'direccion', 'musicos', 'mezcla', 'master'] as const).map((et) => ({
        nombre: `al empezar ${et}`,
        caerEn: (x: EventoProduccion | { punto: string }) => 'tipo' in x && x.tipo === 'etapa' && x.fase === 'inicio' && x.etapa === et,
      })),
    ]
    for (const esc of escenarios) {
      const a = simulacion({ caerEn: esc.caerEn })
      await a.promesa
      const res = reconstruirEstado(a.diario)
      // Si cae antes de definirse nada, no hay nada que reanudar: se empieza de cero.
      const ultimo = a.puntos[a.puntos.length - 1]
      const b = simulacion({ reanudar: res?.guardado.hoja ? res.guardado : undefined, proyecto: ultimo?.proyecto })
      const rB = await b.promesa
      expect(rB.estado, esc.nombre).toBe(rRef.estado)
      expect(b.proyecto.clips, esc.nombre).toEqual(ref.proyecto.clips)
      expect(rB.etapas.map((e) => e.etapa).sort(), esc.nombre).toEqual(rRef.etapas.map((e) => e.etapa).sort())
      // Sin duplicados: ninguna sección queda repetida en una pista.
      for (const lista of Object.values(b.proyecto.clips)) expect(new Set(lista).size).toBe(lista.length)
      // No se repite lo ya hecho: lo que estaba completo no vuelve a pasar por el modelo.
      const hechas = res?.guardado.etapasCompletas ?? []
      if (hechas.includes('plan')) expect(b.peticiones, esc.nombre).not.toContain('Planificador')
      if (hechas.includes('direccion')) expect(b.peticiones, esc.nombre).not.toContain('Director')
      if (hechas.includes('musicos')) expect(sinTiempos(b.peticiones.filter((r) => r === 'Batería' || r === 'Bajo')), esc.nombre).toHaveLength(0)
      // Un músico que ya estaba completo en el último punto de control no escribe de nuevo.
      for (const [pista, lista] of Object.entries(ultimo?.proyecto.clips ?? {})) {
        if (lista.length === HOJA.secciones.length) expect(b.escrituras.filter((w) => w.startsWith(`${pista}:`)), `${esc.nombre} ${pista}`).toHaveLength(0)
      }
    }
  })

  it('el estado restaurado del diario conserva hoja, encargos, informes y músicos terminados', async () => {
    const a = simulacion({ caerEn: (x) => 'punto' in x && x.punto === 'musico:bat' })
    await a.promesa
    const g = reconstruirEstado(a.diario)!.guardado
    expect(g.hoja?.secciones).toHaveLength(2)
    expect(g.encargos.map((e) => e.participante).sort()).toEqual(['baj', 'bat'])
    expect(g.musicosTerminados).toEqual(['bat'])
    expect(g.etapasCompletas).toEqual(expect.arrayContaining(['plan', 'direccion']))
    expect(g.etapasCompletas).not.toContain('musicos')
  })

  it('el diario de la producción reanudada es autosuficiente (se puede reanudar otra vez)', async () => {
    const a = simulacion({ caerEn: (x) => 'punto' in x && x.punto === 'etapa:direccion' })
    await a.promesa
    const g1 = reconstruirEstado(a.diario)!.guardado
    const b = simulacion({ reanudar: g1, proyecto: a.puntos[a.puntos.length - 1]!.proyecto, caerEn: (x) => 'punto' in x && x.punto === 'musico:baj' })
    await b.promesa
    const g2 = reconstruirEstado(b.diario)!.guardado
    expect(g2.hoja).not.toBeNull()
    expect(g2.etapasCompletas).toEqual(expect.arrayContaining(['plan', 'direccion']))
    const c = simulacion({ reanudar: g2, proyecto: b.puntos[b.puntos.length - 1]!.proyecto })
    expect((await c.promesa).estado).toBe('completado')
    expect(c.proyecto.clips).toEqual({ bat: ['Verso', 'Coro'], baj: ['Verso', 'Coro'] })
  })
})

describe('límite de tiempo: máster mínimo determinista', () => {
  it('pasado el límite se aplica siempre el máster mínimo (sin modelo) y se informa', async () => {
    let t = 0
    let aplicado = 0
    const peticiones: string[] = []
    const chat: ChatAgente = async (p) => {
      const rol = /^Eres (\S+)/.exec(p.sistema)?.[1] ?? '?'
      peticiones.push(rol)
      if (p.mensajes[p.mensajes.length - 1]?.role === 'tool') return { ok: true, texto: 'ok', llamadas: [] }
      if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [{ id: 'h1', nombre: H_HOJA, argumentos: HOJA }] }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [{ id: 'e1', nombre: H_ENCARGOS, argumentos: { encargos: [{ musico: 'bat', pista: 'bat', encargo: 'batería' }] } }] }
      if (rol === 'QA') return { ok: true, texto: '', llamadas: [{ id: 'q1', nombre: H_VEREDICTO, argumentos: { aprobado: true, resumen: 'Bien.' } }] }
      if (rol === 'Batería') {
        t = 60 * 60_000 // la grabación se pasa del límite
        return { ok: true, texto: 'ok', llamadas: [] }
      }
      return { ok: true, texto: 'ok', llamadas: [] }
    }
    const eventos: EventoProduccion[] = []
    const r = await ejecutarProduccion({
      pedido: 'x',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => p.id !== 'baj'),
      chat,
      ejecutar: async () => ({ ok: true }),
      reloj: () => t,
      masterMinimo: async () => ((aplicado++, { ok: true, resumen: 'pico −1,0 dBTP, −14,0 LUFS' })),
      onEvento: (e) => eventos.push(e),
    })
    expect(aplicado).toBe(1)
    expect(peticiones).not.toContain('Máster')
    expect(peticiones).not.toContain('Mezcla')
    expect(r.texto).toMatch(/máster mínimo automático[\s\S]*−14,0 LUFS/)
    expect(r.etapas.find((e) => e.etapa === 'master')?.resumen).toMatch(/Máster mínimo/)
    expect(eventos.some((e) => e.tipo === 'master_minimo' && e.ok)).toBe(true)
  })
})

describe('pausa por falta de red', () => {
  it('espera sin gastar reintentos y continúa sola al volver la conexión', async () => {
    let enLinea = false
    let sondeos = 0
    const avisos: string[] = []
    const ok = await esperarConexion({
      enLinea: () => enLinea,
      sondear: async () => (++sondeos, true),
      intervaloMs: 10_000,
      dormir: async () => {
        // Cada «espera» de 10 s simulada; a la tercera vuelve internet.
        avisos.push('espera')
        if (avisos.length === 3) enLinea = true
      },
      alPausar: () => avisos.push('pausa'),
      alReanudar: () => avisos.push('reanuda'),
    })
    expect(ok).toBe(true)
    expect(avisos).toEqual(['pausa', 'espera', 'espera', 'reanuda'])
    expect(sondeos).toBe(1)
  })

  it('el usuario puede detener la espera', async () => {
    const c = new AbortController()
    const ok = await esperarConexion({
      enLinea: () => false,
      sondear: async () => false,
      signal: c.signal,
      dormir: async () => c.abort(),
    })
    expect(ok).toBe(false)
  })

  it('un sondeo que falla (backend caído) mantiene la pausa', async () => {
    let n = 0
    const ok = await esperarConexion({ enLinea: () => true, sondear: async () => (++n >= 3 ? true : Promise.reject(new Error('sin red'))), dormir: async () => undefined })
    expect(ok).toBe(true)
    expect(n).toBe(3)
  })
})

// Referencia para evitar avisos de importación no usada en algunos entornos.
export type _R = RespuestaModelo
