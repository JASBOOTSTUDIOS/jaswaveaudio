import { describe, expect, it } from 'vitest'
import {
  acuseEscritura,
  compactarResultado,
  ejecutarProduccion,
  H_ENCARGOS,
  H_HOJA,
  H_VEREDICTO,
  resolverAhorro,
  vistaHistorial,
  type ChatAgente,
  type HerramientaAgente,
  type MensajeAgente,
  type ParticipanteProduccion,
  type RespuestaModelo,
} from '../agente'

const par = { type: 'object' }
const CATALOGO: HerramientaAgente[] = [
  { nombre: 'project.getSummary', descripcion: 'Resumen del proyecto', parametros: par, clase: 'lectura' },
  { nombre: 'midi.clip.create', descripcion: 'Crea un clip con notas', parametros: par, clase: 'escritura' },
  { nombre: 'midi.notes.get', descripcion: 'Lee notas', parametros: par, clase: 'lectura' },
  { nombre: 'mix.eq', descripcion: 'Ecualiza una pista de piano con notas', parametros: par, clase: 'escritura' },
  { nombre: 'export.render', descripcion: 'Exporta la canción de piano', parametros: par, clase: 'escritura' },
]
const EQUIPO: ParticipanteProduccion[] = [
  { id: 'plan', nombre: 'Planificador', descripcion: 'plan', instrucciones: '', rol: 'planificador' },
  { id: 'dir', nombre: 'Director', descripcion: 'dirige', instrucciones: '', rol: 'director' },
  { id: 'pia', nombre: 'Pianista', descripcion: 'piano', instrucciones: '', rol: 'musico' },
  { id: 'baj', nombre: 'Bajista', descripcion: 'bajo', instrucciones: '', rol: 'musico' },
  { id: 'qa', nombre: 'QA', descripcion: 'calidad', instrucciones: '', rol: 'qa' },
  { id: 'mix', nombre: 'Mezcla', descripcion: 'mezcla', instrucciones: '', rol: 'mezcla' },
]
const HOJA = { tonalidad: 'Re mayor', numerador: 4, secciones: [{ nombre: 'Verso', compases: 2, acordes: ['D', 'G'] }, { nombre: 'Coro', compases: 2, acordes: ['Bm', 'A'] }] }

let n = 0
const ll = (nombre: string, argumentos: Record<string, unknown> = {}) => ({ id: `${nombre}-${++n}`, nombre, argumentos })

type Reg = { llamadasPorRol: Map<string, number>; herramientas: Map<string, string[]>; pedidos: Map<string, string> }
function modelo(reg: Reg): ChatAgente {
  return async (o) => {
    const rol = /^Eres (\S+)/.exec(o.sistema)?.[1] ?? '?'
    reg.llamadasPorRol.set(rol, (reg.llamadasPorRol.get(rol) ?? 0) + 1)
    if (!reg.herramientas.has(rol)) reg.herramientas.set(rol, o.herramientas.map((h) => h.name))
    const primero = o.mensajes[0]
    if (primero?.role === 'user' && !reg.pedidos.has(rol)) reg.pedidos.set(rol, primero.content)
    const ultimo = o.mensajes[o.mensajes.length - 1]
    const hecho = (t: string): RespuestaModelo => ({ ok: true, texto: t, llamadas: [] })
    if (ultimo?.role === 'tool') return hecho(`${rol} terminó`)
    if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
    if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'pia', pista: 'p1', encargo: 'piano' }, { musico: 'baj', pista: 'p2', encargo: 'bajo' }] })] }
    if (rol === 'Pianista' || rol === 'Bajista') return { ok: true, texto: '', llamadas: [ll('midi.clip.create', { pistaId: rol === 'Pianista' ? 'p1' : 'p2', notas: [{ pitch: 60, inicio: 0, duracion: 1 }] })] }
    if (rol === 'QA') return { ok: true, texto: '', llamadas: [ll(H_VEREDICTO, { aprobado: true, resumen: 'bien' })] }
    return hecho('listo')
  }
}

async function correr(extra: Record<string, unknown>) {
  const reg: Reg = { llamadasPorRol: new Map(), herramientas: new Map(), pedidos: new Map() }
  const r = await ejecutarProduccion({
    pedido: 'canción',
    catalogo: CATALOGO,
    participantes: EQUIPO,
    chat: modelo(reg),
    ejecutar: async () => ({ ok: true, datos: { clipId: 'c1', eco: 'x'.repeat(500) }, resumen: 'ok' }),
    herramientasPorRol: { musico: ['midi.clip.create', 'midi.notes.get'] },
    ...extra,
  } as never)
  return { reg, r }
}

describe('ahorro de tokens en la producción', () => {
  it('resolverAhorro: todo activo por defecto, false lo apaga, un objeto afina', () => {
    expect(Object.values(resolverAhorro()).every(Boolean)).toBe(true)
    expect(Object.values(resolverAhorro(false)).some(Boolean)).toBe(false)
    expect(resolverAhorro({ ensayoLimpio: false }).ensayoLimpio).toBe(false)
    expect(resolverAhorro({ ensayoLimpio: false }).qaMedible).toBe(true)
  })

  it('el músico ve solo sus herramientas de oficio y las base, no las que el pedido sugiere', async () => {
    const con = await correr({ base: ['project.getSummary'] })
    const sin = await correr({ base: ['project.getSummary'], ahorro: false })
    const h = con.reg.herramientas.get('Pianista')!
    expect(h).toContain('midi.clip.create')
    expect(h).not.toContain('mix.eq')
    expect(h).not.toContain('export.render')
    expect(sin.reg.herramientas.get('Pianista')!.length).toBeGreaterThan(h.length)
  })

  it('ensayo: se omite si la coherencia ya aprueba y se hace si hay problemas', async () => {
    const grabado = { coherencia: async () => ({ ok: true, detalles: [] }) }
    const limpio = await correr({ ...grabado })
    expect(limpio.r.etapas.some((e) => e.etapa === 'ensayo')).toBe(false)
    const sucio = await correr({ coherencia: async () => ({ ok: false, detalles: ['«Piano»: algo'] }) })
    expect(sucio.r.etapas.some((e) => e.etapa === 'ensayo')).toBe(true)
    const apagado = await correr({ ...grabado, ahorro: false })
    expect(apagado.r.etapas.some((e) => e.etapa === 'ensayo')).toBe(true)
  })

  it('QA de la mezcla: con la medición aprobada no se llama al modelo; con la medición fuera de objetivo sí', async () => {
    const ok = await correr({ medir: async () => ({ ok: true, detalles: ['-14 LUFS'] }) })
    const apagado = await correr({ medir: async () => ({ ok: true, detalles: ['-14 LUFS'] }), ahorro: false })
    expect(ok.reg.llamadasPorRol.get('QA') ?? 0).toBeLessThan(apagado.reg.llamadasPorRol.get('QA') ?? 0)
    expect(ok.r.etapas.find((e) => e.etapa === 'qa_mezcla')?.ok).toBe(true)
    const mal = await correr({ medir: async (e: string) => (e === 'mezcla' ? { ok: false, detalles: ['satura'] } : { ok: true, detalles: [] }) })
    expect(mal.reg.llamadasPorRol.get('QA')!).toBeGreaterThan(ok.reg.llamadasPorRol.get('QA') ?? 0)
  })

  it('diagnóstico: el resultado de la escritura del músico lo incluye', async () => {
    const vistos: string[] = []
    const chat: ChatAgente = async (o) => {
      const rol = /^Eres (\S+)/.exec(o.sistema)?.[1]
      const ultimo = o.mensajes[o.mensajes.length - 1]
      if (ultimo?.role === 'tool') {
        if (rol === 'Pianista') vistos.push(ultimo.content)
        return { ok: true, texto: 'listo', llamadas: [] }
      }
      if (rol === 'Planificador') return { ok: true, texto: '', llamadas: [ll(H_HOJA, HOJA)] }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: [{ musico: 'pia', pista: 'p1', encargo: 'piano' }] })] }
      if (rol === 'Pianista') return { ok: true, texto: '', llamadas: [ll('midi.clip.create', { pistaId: 'p1', notas: [] })] }
      return { ok: true, texto: 'listo', llamadas: [] }
    }
    const base = { pedido: 'x', catalogo: CATALOGO, participantes: EQUIPO.slice(0, 3), chat, ejecutar: async () => ({ ok: true, datos: { clipId: 'c1' } }), diagnostico: () => 'Faltan secciones: Coro.' }
    await ejecutarProduccion(base as never)
    expect(vistos.join('')).toContain('Faltan secciones: Coro.')
    vistos.length = 0
    await ejecutarProduccion({ ...base, ahorro: false } as never)
    expect(vistos.join('')).not.toContain('Faltan secciones')
  })

  it('guía de armonía: va en el encargo del músico y alDefinirHoja recibe la hoja', async () => {
    let hojaVista = ''
    const { reg } = await correr({ alDefinirHoja: (h: { tonalidad: string }) => (hojaVista = h.tonalidad), guiaArmonia: () => 'ARMONÍA: D = re fa# la' })
    expect(hojaVista).toBe('Re mayor')
    expect(reg.pedidos.get('Pianista')).toContain('ARMONÍA: D = re fa# la')
  })

  it('una banda de 11 músicos recibe 11 encargos (antes se cortaba en 8)', async () => {
    const musicos: ParticipanteProduccion[] = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, nombre: `Musico${i}`, descripcion: 'x', instrucciones: '', rol: 'musico' as const }))
    const chat: ChatAgente = async (o) => {
      const rol = /^Eres (\S+)/.exec(o.sistema)?.[1]
      if (o.mensajes[o.mensajes.length - 1]?.role === 'tool') return { ok: true, texto: 'ok', llamadas: [] }
      if (rol === 'Director') return { ok: true, texto: '', llamadas: [ll(H_ENCARGOS, { encargos: musicos.map((m) => ({ musico: m.id, encargo: 'toca' })) })] }
      return { ok: true, texto: 'ok', llamadas: [] }
    }
    const r = await ejecutarProduccion({ pedido: 'x', catalogo: CATALOGO, participantes: [{ id: 'd', nombre: 'Director', descripcion: '', instrucciones: '', rol: 'director' }, ...musicos], chat, ejecutar: async () => ({ ok: true }) })
    expect(r.encargos).toHaveLength(11)
  })
})

describe('historial y resultados compactos', () => {
  it('acuseEscritura conserva ids y avisos y descarta el eco', () => {
    expect(acuseEscritura({ clipId: 'c1', nombre: 'A', tipo: 'midi', notas: [1, 2], diagnostico: 'ok', avisos: ['x'] })).toEqual({ clipId: 'c1', nombre: 'A', diagnostico: 'ok', avisos: ['x'] })
    const s = compactarResultado({ ok: true, datos: { trackId: 't1', eco: 'x'.repeat(900) } }, 1800, 'escritura', true)
    expect(s).toBe('{"ok":true,"datos":{"trackId":"t1"}}')
    // sin acuse (comportamiento anterior) el eco se conserva
    expect(compactarResultado({ ok: true, datos: { trackId: 't1', eco: 'abc' } }, 1800, 'escritura')).toContain('abc')
  })

  it('vistaHistorial recorta los resultados antiguos y deja completos los recientes', () => {
    const grande = JSON.stringify({ ok: true, datos: 'n'.repeat(1500) })
    const m: MensajeAgente[] = [{ role: 'user', content: 'pedido' }]
    for (let i = 0; i < 9; i++) {
      m.push({ role: 'assistant', content: '', toolCalls: [{ id: `a${i}`, name: 'midi.notes.get', arguments: {} }] })
      m.push({ role: 'tool', content: grande, toolCallId: `a${i}`, name: 'midi.notes.get' })
    }
    const v = vistaHistorial(m, 3, true)
    const tools = v.filter((x) => x.role === 'tool').map((x) => x.content.length)
    expect(tools.slice(-6).every((l) => l === grande.length)).toBe(true)
    expect(tools.slice(0, 3).every((l) => l < 600)).toBe(true)
    expect(vistaHistorial(m, 3, false).filter((x) => x.role === 'tool').every((x) => x.content.length === grande.length)).toBe(true)
  })
})
