import { describe, expect, it } from 'vitest'
import type { DAWState } from '@jaswave/shared'
import { crearEstadoInicial } from '../../../shared/src/state/estado-inicial'
import {
  HABILIDADES,
  compilarHabilidad,
  compilarHabilidadLocal,
  elegirHabilidad,
  habilidadDesdeProcedimiento,
  mensajesCompilarHabilidad,
  validarProcedimiento,
  type HerramientaCatalogo,
  type ProcedimientoHabilidad,
} from '../skills'

const PEDIDO =
  'Analiza con precisión las grabaciones MIDI de mis interpretaciones, incluyendo los micro-tiempos y la microdinámica de cada nota individual dentro de arpegios y acordes. Identifica las variaciones de velocidad, el ataque y los matices de estilo. Aplica estos patrones para generar nuevas melodías en Jaswave que repliquen exactamente mi toque natural para cada instrumento.'

const CATALOGO: HerramientaCatalogo[] = [
  { type: 'analysis.touch', description: 'Lectura: mide micro-tiempos, velocity, ataque y articulación de cada nota de clips MIDI.' },
  { type: 'style.touch.learn', description: 'Aprende un perfil de toque (micro-timing y dinámica) desde clips MIDI y lo guarda por nombre/instrumento.' },
  { type: 'style.touch.apply', description: 'Aplica un perfil de toque guardado a una pista o clip.' },
  { type: 'style.touch.list', description: 'Lista los perfiles de toque guardados.' },
  { type: 'project.setBpm', description: 'Cambia el tempo del proyecto (BPM).' },
  { type: 'midi.quantize', description: 'Cuantiza las notas de un clip MIDI a la rejilla.' },
  { type: 'track.delete', description: 'Borra una pista.' },
]

const ORDEN_TOQUE = ['analysis.touch', 'style.touch.learn', 'style.touch.apply']

function tiposDe(p: ProcedimientoHabilidad | null): string[] {
  return (p?.pasos ?? []).map((x) => x.herramienta)
}

function notas(n: number, base = 60) {
  return Array.from({ length: n }, (_, i) => ({ id: `n${base}-${i}`, pitch: base + (i % 5), velocidad: 70 + i, inicio: i * 0.5, duracion: 0.4 }))
}

function estadoBanda(opts: { seleccion?: string; clipSel?: string } = {}): DAWState {
  const st = crearEstadoInicial()
  st.project.tracks = [
    ...st.project.tracks,
    { id: 'tp', nombre: 'Piano', tipo: 'instrumento', clips: [{ id: 'cp1', tipo: 'midi', inicio: 0, duracion: 16, notas: notas(24) }] } as never,
    { id: 'tb', nombre: 'Bajo', tipo: 'instrumento', clips: [{ id: 'cb1', tipo: 'midi', inicio: 0, duracion: 16, notas: notas(12, 40) }] } as never,
    { id: 'tm', nombre: 'Melodía nueva piano', tipo: 'instrumento', clips: [{ id: 'cm1', tipo: 'midi', inicio: 16, duracion: 8, notas: notas(8, 72) }] } as never,
  ]
  st.selection = { ...st.selection, idsPistas: opts.seleccion ? [opts.seleccion] : [], idsClips: opts.clipSel ? [opts.clipSel] : [] }
  return st
}

describe('habilidad personalizada — compilación', () => {
  it('compilador local: el pedido literal → analizar → aprender por instrumento → aplicar', () => {
    const { procedimiento } = compilarHabilidadLocal(PEDIDO, CATALOGO)
    expect(tiposDe(procedimiento)).toEqual(ORDEN_TOQUE)
    expect(procedimiento!.pasos[0]!.repetir).toBe('porPistaMidi')
    expect(procedimiento!.pasos[1]!.repetir).toBe('porPistaMidi')
    expect(procedimiento!.pasos[1]!.payload.instrumento).toBe('{{instrumento}}')
    expect(procedimiento!.version).toBe(1)
    expect(procedimiento!.instruccionesModelo).toMatch(/^.*\n1\. analysis\.touch/m)
    // Serializable.
    expect(JSON.parse(JSON.stringify(procedimiento))).toEqual(procedimiento)
  })

  it('respuesta buena del modelo: se respeta', () => {
    const resp = JSON.stringify({
      nombre: 'Mi toque',
      objetivo: 'Replicar mi forma de tocar',
      disparadores: ['mi toque', 'toca como yo', 'micro-tiempos'],
      pasos: [
        { herramienta: 'analysis.touch', payload: { trackId: '{trackId}', clipIds: '{{clipIds}}' }, motivo: 'medir', repetir: 'porPistaMidi' },
        { herramienta: 'style.touch.learn', payload: { trackId: '{{trackId}}', nombre: 'Toque {{instrumento}}', instrumento: '{{instrumento}}' }, motivo: 'aprender', repetir: 'porPistaMidi' },
        { herramienta: 'style.touch.apply', payload: { nombre: 'Toque {{instrumento}}', trackId: '{{trackId}}', intensidad: '{{intensidad}}' }, motivo: 'aplicar', pista: '{{pista:destino}}' },
      ],
      variables: [{ nombre: 'intensidad', descripcion: 'cuánto', tipo: 'numero', min: 0, max: 1, porDefecto: 0.9 }],
      criteriosExito: ['suena como yo'],
      instruccionesModelo: '1. Elige destino. 2. Intensidad alta.',
    })
    const r = compilarHabilidad(PEDIDO, CATALOGO, '```json\n' + resp + '\n```')
    expect(r.origen).toBe('modelo')
    expect(tiposDe(r.procedimiento)).toEqual(ORDEN_TOQUE)
    // {trackId} se normaliza a {{trackId}}; destino se declara como variable de pista.
    expect(r.procedimiento!.pasos[0]!.payload.trackId).toBe('{{trackId}}')
    expect(r.procedimiento!.variables?.find((v) => v.nombre === 'destino')?.tipo).toBe('pista')
  })

  it('respuesta mala del modelo (herramientas inventadas, pasos sueltos): sin inventos y con la receta completa', () => {
    const mala = `Claro, aquí tienes:
{"nombre":"Clonar toque","pasos":[
  {"tool":"midi.analyzeMicrotiming","args":{"track":"Piano"}},
  {"herramienta":"ai.cloneHumanTouch","payload":{}},
  {"herramienta":"style.touch.apply","payload":{"trackId":"t-123"}},
  {"herramienta":"track.delete","payload":{"trackId":"{{trackId}}"}},
],}`
    const r = compilarHabilidad(PEDIDO, CATALOGO, mala)
    expect(tiposDe(r.procedimiento)).toEqual(ORDEN_TOQUE)
    const todas = [...tiposDe(r.procedimiento), ...r.procedimiento!.herramientasPermitidas]
    expect(todas.every((t) => CATALOGO.some((c) => c.type === t))).toBe(true)
    expect(todas).not.toContain('track.delete')
    expect(r.avisos.join(' ')).toMatch(/midi\.analyzeMicrotiming/)
    expect(r.origen).toBe('mixto')
  })

  it('respuesta ilegible o nula → compilador local', () => {
    expect(tiposDe(compilarHabilidad(PEDIDO, CATALOGO, 'no sé hacerlo').procedimiento)).toEqual(ORDEN_TOQUE)
    expect(tiposDe(compilarHabilidad(PEDIDO, CATALOGO, null).procedimiento)).toEqual(ORDEN_TOQUE)
  })

  it('validarProcedimiento descarta inexistentes, destructivas y no permitidas', () => {
    const { procedimiento, avisos } = validarProcedimiento(
      { nombre: 'x', pasos: [{ herramienta: 'track.delete', payload: {} }, { herramienta: 'inventada.x' }, { herramienta: 'MIDI.QUANTIZE', payload: { clipId: '{{clipId}}' } }, { herramienta: 'project.setBpm', payload: { bpm: 90 } }] },
      CATALOGO,
      { permitidas: ['midi.quantize', 'track.delete'] },
    )
    expect(tiposDe(procedimiento)).toEqual(['midi.quantize'])
    expect(avisos.length).toBeGreaterThanOrEqual(3)
    expect(validarProcedimiento({ pasos: [] }, CATALOGO).procedimiento).toBeNull()
    expect(validarProcedimiento('basura', CATALOGO).procedimiento).toBeNull()
  })

  it('compilador local sin herramientas de toque en el catálogo no las inventa', () => {
    const sinToque = CATALOGO.filter((c) => !c.type.includes('touch'))
    const { procedimiento } = compilarHabilidadLocal(PEDIDO, sinToque)
    expect(tiposDe(procedimiento).some((t) => t.includes('touch'))).toBe(false)
  })

  it('mensajes de compilación: una llamada, lista acotada del catálogo, JSON', () => {
    const grande = [...CATALOGO, ...Array.from({ length: 120 }, (_, i) => ({ type: `misc.tool${i}`, description: 'otra cosa' }))]
    const m = mensajesCompilarHabilidad(PEDIDO, grande)
    expect(m).toHaveLength(2)
    expect(m[0]!.content).toMatch(/SOLO con un objeto JSON/)
    expect(m[1]!.content).toContain('style.touch.learn')
    expect(m[1]!.content.split('\n- ').length).toBeLessThanOrEqual(42)
  })
})

describe('habilidad personalizada — ejecución', () => {
  const proc = compilarHabilidadLocal(PEDIDO, CATALOGO).procedimiento!
  const hab = habilidadDesdeProcedimiento(proc)

  it('coincide con el pedido y no con otros; convive con las habilidades de serie', () => {
    const st = estadoBanda()
    expect(hab.coincide({ userText: PEDIDO, state: st })).toBeGreaterThanOrEqual(0.6)
    expect(hab.coincide({ userText: 'aplica mi toque a la melodía nueva', state: st })).toBeGreaterThanOrEqual(0.6)
    expect(hab.coincide({ userText: 'sube el volumen del piano', state: st })).toBeLessThan(0.6)
    expect(elegirHabilidad({ userText: PEDIDO, state: st }, [...HABILIDADES, hab])?.id).toBe(proc.id)
    expect(elegirHabilidad({ userText: 'completa la canción con bajo y batería', state: st }, [...HABILIDADES, hab])?.id).toBe('cancion.completa')
  })

  it('el brief sólo pide los huecos variables y lista pistas reales', () => {
    const [sys, user] = hab.mensajesBrief({ userText: PEDIDO, state: estadoBanda() })
    expect(sys!.content).toMatch(/SOLO/)
    expect(user!.content).toContain('"Piano"')
    expect(user!.content).toContain('"destino"')
    expect(user!.content).toContain('"intensidad"')
  })

  it('planificar con brief del modelo: perfil por instrumento y aplicación al destino', () => {
    const plan = hab.planificar({ userText: PEDIDO, state: estadoBanda() }, '{"pista":null,"destino":"Melodía nueva piano","intensidad":1.4}')
    expect(plan.preguntas).toBeUndefined()
    const tipos = plan.acciones.map((a) => a.type)
    expect(tipos).toEqual(['analysis.touch', 'analysis.touch', 'style.touch.learn', 'style.touch.learn', 'style.touch.apply'])
    const learns = plan.acciones.filter((a) => a.type === 'style.touch.learn')
    expect(learns.map((a) => a.payload!.instrumento)).toEqual(['piano', 'bajo'])
    expect(learns[0]!.payload).toMatchObject({ trackId: 'tp', clipIds: ['cp1'], nombre: 'Mi toque · piano' })
    const apply = plan.acciones[plan.acciones.length - 1]!
    expect(apply.payload).toEqual({ nombre: 'Mi toque · piano', trackId: 'tm', clipId: 'cm1', intensidad: 1 })
    expect(plan.creativoDelModelo).toBe(true)
  })

  it('sin modelo usa la selección como destino', () => {
    const plan = hab.planificar({ userText: PEDIDO, state: estadoBanda({ seleccion: 'tm', clipSel: 'cm1' }) }, null)
    expect(plan.acciones[plan.acciones.length - 1]!.payload).toMatchObject({ trackId: 'tm', clipId: 'cm1', intensidad: 1 })
    expect(plan.creativoDelModelo).toBe(false)
  })

  it('pista inventada por el modelo o destino desconocido → pregunta, no inventa', () => {
    const plan = hab.planificar({ userText: PEDIDO, state: estadoBanda() }, '{"destino":"Violín fantasma"}')
    expect(plan.acciones).toEqual([])
    expect(plan.preguntas?.[0]).toMatch(/destino/)
  })

  it('proyecto sin grabaciones MIDI → pregunta', () => {
    const plan = hab.planificar({ userText: PEDIDO, state: crearEstadoInicial() }, null)
    expect(plan.acciones).toEqual([])
    expect(plan.preguntas?.join(' ')).toMatch(/MIDI/)
  })
})
