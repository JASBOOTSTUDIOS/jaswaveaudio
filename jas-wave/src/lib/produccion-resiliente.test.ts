import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsearDiario, reconstruirEstado } from '@jaswave/ai-harness'
import {
  DiarioProduccion,
  buscarProduccionInterrumpida,
  descartarProduccion,
  guardarPuntoProyecto,
  idSeguro,
  instalarAvisosProduccion,
  restaurarUltimoPunto,
  type PuertoProducciones,
} from './produccion-resiliente'

/** Puerto en memoria con la misma forma que `window.electron.producciones`. */
function puertoMemoria() {
  const diarios = new Map<string, string>()
  const puntos = new Map<string, string>()
  let avisoCb: ((a: { tipo: 'emergencia' | 'memoria'; [k: string]: unknown }) => void) | null = null
  const puerto: PuertoProducciones = {
    iniciar: async () => ({ ok: true }),
    anexar: async (p, r, t) => (diarios.set(`${p}/${r}`, (diarios.get(`${p}/${r}`) ?? '') + t), { ok: true, escrito: true }),
    listar: async (p) => ({
      ok: true,
      producciones: [...diarios.keys()].filter((k) => k.startsWith(`${p}/`)).map((k, i) => ({ runId: k.split('/')[1]!, modificado: i, bytes: 1 })).reverse(),
    }),
    leer: async (p, r) => ({ ok: true, texto: diarios.get(`${p}/${r}`) ?? null }),
    puntoGuardar: async (p, json, que) => (puntos.set(p, json), { ok: true, huella: `h-${que}`, archivo: 'punto-1.json', seq: 1 }),
    puntoCargar: async (p) => ({ ok: true, punto: puntos.has(p) ? { proyecto: puntos.get(p)!, cabecera: { seq: 1, t: 1, que: 'musico:bat', huella: 'h' }, usoCopiaAnterior: false, descartadas: 0 } : null }),
    puntoInfo: async (p) => ({ ok: true, cabecera: puntos.has(p) ? { seq: 1, t: 1, que: 'x', huella: 'h' } : null }),
    candadoTomar: async () => ({ ok: true, testigo: 't' }),
    candadoSoltar: async () => ({ ok: true, soltado: true }),
    onAviso: (cb) => ((avisoCb = cb), () => (avisoCb = null)),
  }
  return { puerto, diarios, puntos, avisar: (a: { tipo: 'emergencia' | 'memoria'; [k: string]: unknown }) => avisoCb?.(a) }
}

const tienda = (project: unknown) => {
  let estado = { project } as { project: any }
  return { obtenerEstado: () => estado as never, establecerEstado: (f: (s: any) => any) => ((estado = f(estado)), estado as never), actual: () => estado }
}

describe('diario de producción (renderer)', () => {
  it('escribe inicio, eventos (sin el detalle de los agentes), estado y señal de vida, en orden', async () => {
    const m = puertoMemoria()
    let tic: (() => void) | null = null
    let ahora = 1000
    const d = new DiarioProduccion(m.puerto, 'p1', 'r1', { reloj: () => ahora, intervaloVidaMs: 15_000, setIntervalo: (fn) => ((tic = fn), 1), clearIntervalo: () => (tic = null) })
    await d.iniciar({ pedido: 'una canción', participantes: [{ id: 'bat', nombre: 'Batería', rol: 'musico' }] })
    d.estado('en_curso', 'inicio')
    d.evento({ tipo: 'etapa', etapa: 'musicos', fase: 'inicio' })
    d.evento({ tipo: 'agente', etapa: 'musicos', participante: { id: 'bat', nombre: 'B', rol: 'musico' }, evento: { tipo: 'herramienta', fase: 'inicio', nombre: 'x', titulo: 'x' } as never })
    d.evento({ tipo: 'medicion', etapa: 'mezcla', ms: 5, ok: true }, 'rev7:abc')
    ahora = 16_000
    tic!()
    d.estado('pausada_red', 'sin conexión')
    await d.cerrar('interrumpida', 'prueba')
    const { registros } = parsearDiario(m.diarios.get('p1/r1')!)
    assert.deepEqual(registros.map((r) => r.k), ['inicio', 'estado', 'evento', 'evento', 'vida', 'estado', 'estado'])
    assert.equal((registros[3] as { huella?: string }).huella, 'rev7:abc')
    assert.equal((registros[4] as { etapa?: string }).etapa, 'musicos')
    assert.equal(registros[4]!.t, 16_000)
    assert.equal(reconstruirEstado(registros)!.estado, 'interrumpida')
    assert.equal(tic, null, 'la señal de vida se detiene al cerrar')
  })

  it('encuentra la producción interrumpida y sabe qué estaba hecho; descartarla la oculta', async () => {
    const m = puertoMemoria()
    const d = new DiarioProduccion(m.puerto, 'p1', 'r1', { reloj: () => 1000, setIntervalo: () => 1, clearIntervalo: () => undefined })
    await d.iniciar({ pedido: 'balada', participantes: [] })
    d.evento({ tipo: 'plan_definido', plan: 'plan', hoja: { tonalidad: 'Re', numerador: 4, secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'A'] }] } as never })
    d.evento({ tipo: 'etapa', etapa: 'direccion', fase: 'inicio' })
    d.evento({ tipo: 'encargos', encargos: [{ participante: 'bat', encargo: 'x' }] })
    d.evento({ tipo: 'etapa', etapa: 'musicos', fase: 'inicio' })
    d.evento({ tipo: 'musico', participante: 'bat', ok: true })
    await d.control('musico:bat', 'h', 'punto-1.json')
    m.puntos.set('p1', '{}')
    // El proceso muere aquí: no hay `cerrar`. Una cola pendiente se vacía con un cierre de escritura nulo.
    await new Promise((r) => setTimeout(r, 0))
    const reciente = await buscarProduccionInterrumpida(m.puerto, 'p1', 1000 + 30_000)
    assert.equal(reciente, null, 'con señal de vida reciente sigue «en curso»')
    const r = await buscarProduccionInterrumpida(m.puerto, 'p1', 1000 + 200_000)
    assert.ok(r)
    assert.match(r!.texto, /se interrumpió en la grabación hace 3 min/)
    assert.match(r!.texto, /1 de 1 músicos terminaron su parte/)
    assert.equal(r!.hayPunto, true)
    await descartarProduccion(m.puerto, 'p1', 'r1')
    assert.equal(await buscarProduccionInterrumpida(m.puerto, 'p1', 1000 + 200_000), null)
  })

  it('una producción completada o sin plan no se ofrece', async () => {
    const m = puertoMemoria()
    const d = new DiarioProduccion(m.puerto, 'p1', 'r2', { reloj: () => 1, setIntervalo: () => 1, clearIntervalo: () => undefined })
    await d.iniciar({ pedido: 'x', participantes: [] })
    await d.cerrar('completada')
    assert.equal(await buscarProduccionInterrumpida(m.puerto, 'p1', 1e9), null)
    const e = new DiarioProduccion(m.puerto, 'p2', 'r3', { reloj: () => 1, setIntervalo: () => 1, clearIntervalo: () => undefined })
    await e.iniciar({ pedido: 'x', participantes: [] })
    assert.equal(await buscarProduccionInterrumpida(m.puerto, 'p2', 1e9), null, 'sin hoja de ruta no hay nada que reanudar')
    assert.equal(await buscarProduccionInterrumpida(null, 'p1'), null, 'sin Electron no hay diario')
  })
})

describe('puntos de control (renderer)', () => {
  it('guarda el proyecto aunque no tenga ruta y lo restaura', async () => {
    const m = puertoMemoria()
    const t = tienda({ id: 'sin guardar #1', nombre: 'Demo', tracks: [{ id: 'a' }], modificado: false })
    const g = await guardarPuntoProyecto(m.puerto, t, 'etapa:plan')
    assert.equal(g?.huella, 'h-etapa:plan')
    assert.ok(m.puntos.has('sin guardar #1') === false, 'el id se sanea antes de llegar al disco')
    assert.ok(m.puntos.has(idSeguro('sin guardar #1')))
    t.establecerEstado((s) => ({ ...s, project: { ...s.project, tracks: [] } }))
    const r = await restaurarUltimoPunto(m.puerto, t, idSeguro('sin guardar #1'))
    assert.equal(r.ok, true)
    assert.equal(t.actual().project.tracks.length, 1)
    assert.equal(t.actual().project.modificado, true)
    assert.equal((await restaurarUltimoPunto(m.puerto, t, 'otro')).ok, false)
    assert.equal(await guardarPuntoProyecto(null, t, 'x'), null)
  })

  it('ante un aviso de cierre o de poca memoria guarda una copia extra; solo el de memoria se muestra', async () => {
    const m = puertoMemoria()
    const t = tienda({ id: 'p1', nombre: 'Demo', tracks: [] })
    const avisos: string[] = []
    const baja = instalarAvisosProduccion(m.puerto, t, (a) => avisos.push(a.texto ?? ''))
    m.avisar({ tipo: 'emergencia', motivo: 'apagado' })
    m.avisar({ tipo: 'memoria', nivel: 'alta', texto: 'Al ordenador le queda poca memoria.' })
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(avisos, ['Al ordenador le queda poca memoria.'])
    assert.ok(m.puntos.has('p1'))
    baja()
  })
})
