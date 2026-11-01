import { describe, expect, it } from 'vitest'
import {
  crearCronometro,
  ejecutarProduccion,
  formatearDuracion,
  H_ENCARGOS,
  H_HOJA,
  H_PROPONER,
  H_VEREDICTO,
  resumenTiempos,
  type ChatAgente,
  type ConfigProduccion,
  type EventoProduccion,
  type HerramientaAgente,
  type MedicionQA,
  type ParticipanteProduccion,
  type RespuestaModelo,
} from '../agente'

const par = { type: 'object' }
const CATALOGO: HerramientaAgente[] = [
  { nombre: 'project.getSummary', descripcion: 'Resumen del proyecto', parametros: par, clase: 'lectura' },
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
const HOJA = { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'G'] }] }
const MIN = 60_000

let n = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `${nombre}-${++n}`, nombre, argumentos })
const hecho = (t: string): RespuestaModelo => ({ ok: true, texto: t, llamadas: [] })

/**
 * Producción con reloj falso: cada petición al modelo cuesta `costeMs` de reloj. El «modelo» es un guion:
 * planifica, reparte, escribe, y en el ensayo opina; registra quién pidió qué.
 */
type Guion = (rol: string, o: Parameters<ChatAgente>[0], avanzar: (ms: number) => void) => Promise<RespuestaModelo> | RespuestaModelo | undefined
async function producir(extra: Partial<ConfigProduccion> & { costeMs?: number; guion?: Guion } = {}) {
  let t = 0
  const { costeMs = MIN, guion, ...resto } = extra
  const peticiones: string[] = []
  const eventos: EventoProduccion[] = []
  const chat: ChatAgente = async (o) => {
    t += costeMs
    const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
    const herr = o.herramientas.map((h) => h.name)
    const ultimo = o.mensajes[o.mensajes.length - 1]
    peticiones.push(herr.includes(H_PROPONER) ? `${rol}:ensayo` : rol)
    const propia = guion?.(rol, o, (ms) => (t += ms))
    if (propia) return propia
    if (ultimo?.role === 'tool') return hecho(`${rol} terminó`)
    if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
    if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', pista: 'p1', encargo: 'batería' }, { musico: 'pia', pista: 'p2', encargo: 'piano' }] })] }
    if (herr.includes(H_PROPONER)) return { ok: true, texto: '', llamadas: [ll(H_PROPONER, { conforme: true })] }
    if (rol === 'Batería' || rol === 'Piano') return { ok: true, texto: '', llamadas: [ll('midi.addNotes', { pistaId: rol === 'Batería' ? 'p1' : 'p2', n: ++n })] }
    if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'bien' })] }
    if (rol === 'Mezcla' || rol === 'Máster') return { ok: true, texto: '', llamadas: [ll('mix.setVolume', { pistaId: 'p1', n: ++n })] }
    return hecho('listo')
  }
  const r = await ejecutarProduccion({
    pedido: 'tema',
    catalogo: CATALOGO,
    base: ['project.getSummary'],
    participantes: EQUIPO,
    chat,
    ejecutar: async () => ({ ok: true }),
    reloj: () => t,
    onEvento: (e) => eventos.push(e),
    ...resto,
  })
  return { r, peticiones, eventos, ahora: () => t }
}

const cuenta = (xs: string[], x: string) => xs.filter((y) => y === x).length

describe('cronómetro', () => {
  it('cuenta tiempo y peticiones por etapa y descuenta lo anidado', async () => {
    let t = 0
    const c = crearCronometro(() => t)
    await c.medir('qa_musicos', async () => {
      c.peticion()
      t += 10_000
      await c.medir('coherencia', async () => {
        c.peticion()
        c.peticion()
        t += 30_000
      })
      t += 5_000
    })
    const x = c.instantanea(MIN, 2 * MIN)
    expect(x.etapas.qa_musicos).toEqual({ ms: 15_000, peticiones: 1 })
    expect(x.etapas.coherencia).toEqual({ ms: 30_000, peticiones: 2 })
    expect(x.totalMs).toBe(45_000)
    expect(x.peticiones).toBe(3)
  })

  it('da formato legible', () => {
    expect(formatearDuracion(40_000)).toBe('40 s')
    expect(formatearDuracion(6 * MIN)).toBe('6 min')
    expect(formatearDuracion(90_000)).toBe('1 min 30 s')
    const c = crearCronometro(() => 0)
    expect(resumenTiempos(c.instantanea(MIN, MIN))).toMatch(/^Tiempos:.*total 0 s/)
  })
})

describe('tiempos de la producción', () => {
  it('emite tiempo por etapa, mediciones y el total, y los resume en el texto', async () => {
    const { r, eventos } = await producir({
      presupuestoMs: Infinity,
      limiteMs: Infinity,
      medir: async () => ({ ok: true, detalles: ['Volumen general −14,0 LUFS.'] }),
    })
    expect(r.tiempos).toBeDefined()
    const t = r.tiempos!
    expect(t.etapas.plan?.peticiones).toBeGreaterThanOrEqual(2)
    expect(t.etapas.direccion?.peticiones).toBeGreaterThanOrEqual(2)
    expect(t.etapas.musicos?.peticiones).toBeGreaterThanOrEqual(4)
    expect(t.etapas.musicos!.ms).toBeGreaterThan(0)
    expect(t.peticiones).toBe(Object.values(t.etapas).reduce((s, e) => s + e!.peticiones, 0))
    expect(t.mediciones.map((m) => m.etapa)).toEqual(expect.arrayContaining(['musicos', 'mezcla', 'master']))
    expect(eventos.some((e) => e.tipo === 'tiempo' && e.etapa === 'plan')).toBe(true)
    expect(eventos.filter((e) => e.tipo === 'medicion').length).toBe(t.mediciones.length)
    expect(eventos[eventos.length - 1]).toMatchObject({ tipo: 'tiempos' })
    expect(r.texto).toMatch(/Tiempos: plan .* · músicos .* · .*total .* min/)
  })
})

describe('presupuesto de tiempo y degradación ordenada', () => {
  const coherenciaOk = (): MedicionQA => ({ ok: true, detalles: [] })

  it('con tiempo de sobra hace el ensayo y no omite nada', async () => {
    const { r, peticiones } = await producir({ presupuestoMs: Infinity, limiteMs: Infinity, ahorro: { ensayoLimpio: false } })
    expect(cuenta(peticiones, 'Batería:ensayo')).toBeGreaterThan(0)
    expect(r.tiempos!.omitidos).toEqual([])
    expect(r.texto).not.toMatch(/omiti/)
  })

  it('al superar el presupuesto omite el ensayo y lo dice en el resumen', async () => {
    const { r, peticiones, eventos } = await producir({ presupuestoMs: 5 * MIN, limiteMs: Infinity, ahorro: { ensayoLimpio: false } })
    expect(peticiones.some((p) => p.endsWith(':ensayo'))).toBe(false)
    expect(r.tiempos!.omitidos.map((o) => o.que)).toContain('ensayo')
    expect(r.texto).toMatch(/se omitió el ensayo por tiempo/)
    expect(eventos.some((e) => e.tipo === 'omitido' && e.que === 'ensayo' && e.motivo === 'presupuesto')).toBe(true)
    // La grabación no se saltó.
    expect(cuenta(peticiones, 'Piano')).toBeGreaterThanOrEqual(2)
  })

  it('degrada en orden: ensayo, revisión de partes, 2.ª ronda del arreglista, revisión de la mezcla', async () => {
    let coherenciaLlamadas = 0
    const { r, peticiones } = await producir({
      // Ventana 5–15 min: ensayo y revisión de partes a los 5, 2.ª ronda del arreglista a los 7, revisión de la mezcla a los 11.
      presupuestoMs: 5 * MIN,
      limiteMs: 15 * MIN,
      ahorro: { ensayoLimpio: false, qaMedible: false, qaPartesLimpias: false },
      // Siempre falla pero cambia (hay progreso): sin presupuesto habría 2 rondas; con él, 1.
      coherencia: () => ({ ok: false, detalles: [`compás ${++coherenciaLlamadas}: nota fuera`] }),
      medir: async () => ({ ok: true, detalles: ['bien'] }),
    })
    const omitidos = r.tiempos!.omitidos.map((o) => o.que)
    expect(omitidos).toEqual(['ensayo', 'rondas del arreglista', 'qa_musicos', 'qa_mezcla'])
    // Una sola ronda del arreglista (1 petición) en vez de dos.
    expect(peticiones.filter((p) => p.startsWith('Arreglista')).length).toBe(1)
    // El QA por modelo no corrió.
    expect(peticiones.includes('QA')).toBe(false)
  })

  it('al superar el límite entrega con lo que hay: sin mezcla ni máster, pero con la medición final', async () => {
    const medidas: string[] = []
    const { r, peticiones } = await producir({
      presupuestoMs: 3 * MIN,
      limiteMs: 6 * MIN,
      medir: async (etapa) => {
        medidas.push(etapa)
        return { ok: true, detalles: ['Volumen final −14,2 LUFS (objetivo −14).'] }
      },
    })
    expect(cuenta(peticiones, 'Mezcla') + cuenta(peticiones, 'Máster')).toBe(0)
    expect(r.tiempos!.omitidos.map((o) => o.que)).toEqual(expect.arrayContaining(['mezcla', 'master']))
    expect(medidas).toContain('master')
    expect(r.estado).toBe('con_avisos')
    expect(r.texto).toMatch(/límite superado/)
    expect(r.texto).toMatch(/se omitió la mezcla por superar el límite de tiempo/)
    expect(r.etapas.find((e) => e.etapa === 'qa_master')?.resumen).toMatch(/Medición final/)
    // Las partes de los músicos se grabaron enteras.
    expect(cuenta(peticiones, 'Batería')).toBeGreaterThanOrEqual(2)
    expect(cuenta(peticiones, 'Piano')).toBeGreaterThanOrEqual(2)
    expect(r.estado).not.toBe('fallo')
  })

  it('el reloj no avanza sin peticiones: con el tiempo por defecto una producción rápida no omite nada', async () => {
    const { r } = await producir({ costeMs: 1, coherencia: coherenciaOk })
    expect(r.tiempos!.omitidos).toEqual([])
  })
})

describe('bucles sin progreso', () => {
  it('corta las rondas del arreglista si la medición no cambia tras corregir', async () => {
    const { r, peticiones, eventos } = await producir({
      presupuestoMs: Infinity,
      limiteMs: Infinity,
      ahorro: { ensayoLimpio: false },
      ensayo: false,
      coherencia: () => ({ ok: false, detalles: ['compás 3 (Bm): do no pertenece'] }),
    })
    // Una ronda y no dos.
    expect(peticiones.filter((p) => p.startsWith('Arreglista')).length).toBe(1)
    expect(r.tiempos!.omitidos).toContainEqual(expect.objectContaining({ que: 'rondas del arreglista', motivo: 'sin_progreso' }))
    expect(eventos.some((e) => e.tipo === 'omitido' && e.motivo === 'sin_progreso')).toBe(true)
  })

  it('con progreso sí usa las dos rondas del arreglista', async () => {
    let k = 0
    const { peticiones } = await producir({
      presupuestoMs: Infinity,
      limiteMs: Infinity,
      ensayo: false,
      coherencia: () => ({ ok: false, detalles: [`compás ${++k}: nota fuera`] }),
    })
    expect(peticiones.filter((p) => p.startsWith('Arreglista')).length).toBe(2)
  })

  it('corta la corrección del máster si la medición y el veredicto no cambian', async () => {
    const { r, peticiones } = await producir({
      presupuestoMs: Infinity,
      limiteMs: Infinity,
      ensayo: false,
      maxRondasQA: 3,
      medir: async (etapa) => (etapa === 'master' ? { ok: false, detalles: ['Pico de −0,2 dBTP (objetivo −1)'] } : { ok: true, detalles: [] }),
    })
    // Pasada inicial (2) + una corrección (2); sin el corte serían tres correcciones.
    expect(peticiones.filter((p) => p === 'Máster').length).toBe(4)
    expect(r.etapas.find((e) => e.etapa === 'qa_master')).toMatchObject({ ok: false, rondas: 1 })
    expect(r.tiempos!.omitidos).toContainEqual(expect.objectContaining({ que: 'qa_master', motivo: 'sin_progreso' }))
  })
})

describe('segunda oleada', () => {
  async function conReintentoDeBase(solapar: boolean) {
    let faltaBateria = true
    let restoVisto: () => void = () => undefined
    const visto = new Promise<void>((ok) => (restoVisto = ok))
    let bloqueada = false
    const eventos: string[] = []
    const base = (rol: string) => rol
    const chat: ChatAgente = async (o) => {
      const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
      const ultimo = o.mensajes[o.mensajes.length - 1]
      if (rol === 'Piano') restoVisto()
      if (rol === 'Batería' && o.mensajes[0]?.content.includes('INCOMPLETA')) {
        // Reintento de la base: si el piano no ha empezado aún, esperaría para siempre salvo el temporizador.
        const gano = await Promise.race([visto.then(() => 'piano'), new Promise<string>((ok) => setTimeout(() => ok('tiempo'), 80))])
        if (gano === 'tiempo') bloqueada = true
        eventos.push(`reintento-base-tras-${gano}`)
      }
      if (ultimo?.role === 'tool') return hecho(`${base(rol)} terminó`)
      if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'bat', pista: 'p1', encargo: 'batería' }, { musico: 'pia', pista: 'p2', encargo: 'piano' }] })] }
      if (rol === 'Batería' || rol === 'Piano') return { ok: true, texto: '', llamadas: [ll('midi.addNotes', { pistaId: rol === 'Batería' ? 'p1' : 'p2', n: ++n })] }
      return hecho('ok')
    }
    await ejecutarProduccion({
      pedido: 'tema',
      catalogo: CATALOGO,
      participantes: EQUIPO.filter((p) => ['planificador', 'director', 'musico'].includes(p.rol)),
      chat,
      ejecutar: async () => ({ ok: true }),
      ensayo: false,
      solaparOleadas: solapar,
      completitud: (e) => {
        if (e.participante === 'bat' && faltaBateria) {
          faltaBateria = false
          return 'te falta el Coro'
        }
        return null
      },
    })
    return { bloqueada, eventos }
  }

  it('arranca la segunda oleada sin esperar a los reintentos de la base', async () => {
    const r = await conReintentoDeBase(true)
    expect(new Set(r.eventos)).toEqual(new Set(['reintento-base-tras-piano']))
    expect(r.bloqueada).toBe(false)
  })

  it('con solaparOleadas: false espera a la base entera (comportamiento anterior)', async () => {
    const r = await conReintentoDeBase(false)
    expect(r.bloqueada).toBe(true)
  })
})

describe('tope de reloj por agente', () => {
  const colgado = () => new Promise<RespuestaModelo>(() => undefined)
  const vigila = { vigilanciaMs: 5 }

  it('corta al QA que no responde: cae a la medición del host y lo cuenta en el resumen', async () => {
    const { r, peticiones } = await producir({
      ...vigila,
      presupuestoMs: Infinity,
      limiteMs: Infinity,
      ensayo: false,
      ahorro: { qaMedible: false, qaPartesLimpias: false },
      medir: async () => ({ ok: true, detalles: ['Volumen general −14,0 LUFS.'] }),
      guion: (rol, _o, avanzar) => {
        if (rol !== 'QA') return undefined
        avanzar(4 * MIN) // más que su tope de 3 min
        return colgado()
      },
    })
    expect(peticiones.filter((p) => p === 'QA').length).toBeGreaterThan(0)
    expect(r.tiempos!.omitidos.some((o) => o.motivo === 'tope_agente' && /QA/.test(o.texto))).toBe(true)
    expect(r.texto).toMatch(/QA .*cortado por tiempo/)
    // Siguió con mezcla y máster y la medición del host manda.
    expect(r.etapas.find((e) => e.etapa === 'qa_master')?.ok).toBe(true)
    expect(r.estado).not.toBe('fallo')
  })

  it('el límite global corta al agente en curso y pasa a la entrega', async () => {
    const medidas: string[] = []
    const { r, peticiones } = await producir({
      ...vigila,
      presupuestoMs: 10 * MIN,
      limiteMs: 20 * MIN,
      topesAgenteMs: { mezcla: Infinity },
      medir: async (e) => (medidas.push(e), { ok: true, detalles: ['bien'] }),
      guion: (rol, _o, avanzar) => {
        if (rol !== 'Mezcla') return undefined
        avanzar(30 * MIN)
        return colgado()
      },
    })
    expect(peticiones.filter((p) => p === 'Mezcla').length).toBe(1)
    expect(r.tiempos!.omitidos).toContainEqual(expect.objectContaining({ motivo: 'limite', que: expect.stringContaining('mezcla/mix') }))
    // El máster ya no corre (pasado el límite) pero se mide al final.
    expect(peticiones.includes('Máster')).toBe(false)
    expect(medidas).toContain('master')
    expect(r.estado).toBe('con_avisos')
  })

  it('un músico no se corta por el límite global, solo por su propio tope', async () => {
    const { r, peticiones } = await producir({
      ...vigila,
      presupuestoMs: Infinity,
      limiteMs: 1 * MIN,
      costeMs: 2 * MIN,
    })
    expect(cuenta(peticiones, 'Piano')).toBeGreaterThanOrEqual(2)
    expect(r.tiempos!.omitidos.some((o) => /^musico/.test(o.que))).toBe(false)
  })
})

describe('tope de análisis seguidos del QA', () => {
  it('tras 4 mediciones sin escribir, la herramienta responde con la última y pide el veredicto', async () => {
    let paso = 0
    let reales = 0
    const avisos: string[] = []
    const { r } = await producir({
      presupuestoMs: Infinity,
      limiteMs: Infinity,
      ensayo: false,
      ahorro: { qaMedible: false, qaPartesLimpias: false },
      medir: async () => ({ ok: true, detalles: [] }),
      catalogo: [...CATALOGO, { nombre: 'analysis.mix', descripcion: 'Mide la mezcla', parametros: par, clase: 'lectura' }],
      herramientasPorRol: { qa: ['analysis.mix'] },
      ejecutar: async (l) => (l.nombre === 'analysis.mix' ? (reales++, { ok: true, datos: { lufs: -14 - reales } }) : { ok: true }),
      guion: (rol, o) => {
        if (rol !== 'QA') return undefined
        for (const m of o.mensajes) if (m.role === 'tool' && /Ya mediste/.test(m.content) && !avisos.includes(m.content)) avisos.push(m.content)
        paso++
        return paso <= 6
          ? { ok: true, texto: '', llamadas: [ll('analysis.mix', { vuelta: paso })] }
          : { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'bien' })] }
      },
    })
    expect(reales).toBe(4)
    expect(avisos.length).toBeGreaterThan(0)
    expect(avisos[0]).toMatch(/lufs/)
    expect(r.etapas.some((e) => e.etapa === 'qa_musicos')).toBe(true)
  })
})
