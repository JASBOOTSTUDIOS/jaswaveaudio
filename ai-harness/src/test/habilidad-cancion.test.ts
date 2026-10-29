import { describe, expect, it } from 'vitest'
import type { DAWState } from '@jaswave/shared'
import { crearEstadoInicial } from '../../../shared/src/state/estado-inicial'
import {
  coincideCompletarCancion,
  elegirHabilidad,
  extraerJson,
  habilidadCompletarCancion,
  resumirProyectoParaCancion,
} from '../skills'

function estadoConIntro(compases: number): DAWState {
  const st = crearEstadoInicial()
  st.project.bpm = { ...st.project.bpm, valor: 72 }
  st.project.metadata = {
    ...st.project.metadata,
    customData: { ...(st.project.metadata?.customData ?? {}), 'jaswave.tonalidad': { enabled: true, label: 'D mayor', root: 62, mode: 'major' } },
  }
  st.project.tracks = [
    ...st.project.tracks,
    {
      id: 'p1',
      nombre: 'Piano',
      tipo: 'instrumento',
      clips: [{ id: 'c1', inicio: 0, duracion: compases * 4, notas: [{ id: 'n', pitch: 62, velocidad: 80, inicio: 0, duracion: 1 }] }],
    } as never,
  ]
  return st
}

describe('habilidad completar canción — detección', () => {
  it('reconoce pedidos de canción completa', () => {
    expect(coincideCompletarCancion('Jas, completa la canción con bajo, batería y pad')).toBeGreaterThanOrEqual(0.9)
    expect(coincideCompletarCancion('haz una canción worship moderna completa')).toBeGreaterThanOrEqual(0.8)
    expect(coincideCompletarCancion('agrega bajo, batería y guitarra')).toBeGreaterThanOrEqual(0.6)
  })
  it('no se activa en preguntas, ediciones ni pedidos puntuales', () => {
    expect(coincideCompletarCancion('¿qué opinas de la mezcla?')).toBe(0)
    expect(coincideCompletarCancion('cambia el bpm a 90')).toBe(0)
    expect(coincideCompletarCancion('crea una melodía en el clip')).toBe(0)
    expect(coincideCompletarCancion('ok')).toBe(0)
  })
  it('elegirHabilidad devuelve la habilidad o null', () => {
    const st = crearEstadoInicial()
    expect(elegirHabilidad({ userText: 'termina el tema', state: st })?.id).toBe('cancion.completa')
    expect(elegirHabilidad({ userText: 'sube el volumen del piano', state: st })).toBeNull()
  })
})

describe('habilidad completar canción — brief', () => {
  it('extraerJson tolera prosa, fences y comas finales', () => {
    expect(extraerJson('Claro:\n```json\n{"a":1,"b":[1,2,],}\n```')).toEqual({ a: 1, b: [1, 2] })
    expect(extraerJson('sin json')).toBeNull()
  })

  it('recupera un brief truncado por el tope de tokens del proveedor (respuesta real de openrouter/free)', () => {
    const truncado =
      '{ "titulo": "Continuación Worship Moderna", "estilo": "ballad", "bpm": 72, "roles": ["piano", "pad", "cuerdas", "bajo", "bateria"], ' +
      '"secciones": [ { "tipo": "verso", "compases": 8, "progresion": ["ii9", "V13sus4", "vi9", "Imaj9", "IV11", "ii11", "V13sus4", "Imaj9"], "intensidad": 0.4 }, ' +
      '{ "tipo": "coro", "compases": 8, "progresion": ["IVmaj9", "V13sus4", "Imaj9", "vi9", "i'
    const j = extraerJson(truncado) as { secciones: Array<{ tipo: string; progresion: string[] }> }
    expect(j.secciones).toHaveLength(2)
    expect(j.secciones[1]!.progresion).toEqual(['IVmaj9', 'V13sus4', 'Imaj9', 'vi9'])
    const plan = habilidadCompletarCancion.planificar({ userText: 'añade una estrofa y un coro', state: estadoConIntro(4), semilla: 1 }, truncado)
    expect(plan.creativoDelModelo).toBe(true)
    const secs = (plan.acciones[0]!.payload as { secciones: Array<{ progresion?: string[] }> }).secciones
    expect(secs[0]!.progresion).toEqual(['ii9', 'V13sus4', 'vi9', 'Imaj9', 'IV11', 'ii11', 'V13sus4', 'Imaj9'])
  })

  it('continúa tras la intro del usuario respetando tonalidad y tempo', () => {
    const st = estadoConIntro(4)
    const r = resumirProyectoParaCancion(st)
    expect(r.inicioBeat).toBe(16)
    expect(r.compasInicio).toBe(5)
    expect(r.tonalidad).toEqual({ raiz: 'D', escala: 'mayor' })

    const msgs = habilidadCompletarCancion.mensajesBrief({ userText: 'completa la canción', state: st })
    expect(msgs[1]!.content).toContain('compás 5')
    expect(msgs[1]!.content).toContain('IV=G')

    const respuesta = JSON.stringify({
      titulo: 'Gracia que Florece',
      idea: 'del susurro al himno',
      estilo: 'anthem',
      bpm: 128,
      tonalidad: 'E',
      roles: ['piano', 'pad', 'guitarra'],
      secciones: [
        { tipo: 'intro', compases: 4, progresion: ['I', 'IV'] },
        { tipo: 'verso', compases: 8, progresion: ['Isus2', 'V/3', 'vi7', 'IVadd9'], intensidad: 0.4 },
        { tipo: 'coro', compases: 8, progresion: ['IV', 'I/3', 'bVII', 'Vsus4'], intensidad: 0.8 },
        { tipo: 'puente', compases: 8, progresion: ['vi7', 'IVmaj7'], intensidad: 0.35 },
        { tipo: 'coroFinal', compases: 8, intensidad: 1 },
      ],
    })
    const plan = habilidadCompletarCancion.planificar({ userText: 'completa la canción', state: st, semilla: 7 }, respuesta)
    expect(plan.creativoDelModelo).toBe(true)
    const p = plan.acciones[0]!.payload as Record<string, unknown>
    expect(plan.acciones[0]!.type).toBe('daw.composeWorship')
    expect(p.inicioBeat).toBe(16)
    expect(p.bpm).toBe(72) // no cambia el tempo del usuario
    expect(p.tonalidad).toBe('D')
    expect(p.ajustarProyecto).toBe(false)
    const secs = p.secciones as Array<{ tipo: string; progresion?: string[] }>
    expect(secs[0]!.tipo).toBe('verso') // intro omitida: ya existe
    expect(secs[1]!.progresion).toEqual(['IV', 'I/3', 'Vsus4']) // bVII descartado (no diatónico)
    expect(p.roles).toEqual(expect.arrayContaining(['bajo', 'bateria', 'piano']))
    expect(plan.decisiones.join('\n')).toContain('bVII')
  })

  it('sin tonalidad fijada la infiere de las notas (intro Fmaj9–Am9–Dm11–G13sus → Do mayor)', () => {
    const st = crearEstadoInicial()
    const acordes = [
      [41, 57, 60, 64, 67], // Fmaj9
      [45, 55, 60, 64, 71], // Am9
      [38, 53, 60, 64, 67], // Dm11
      [43, 53, 57, 60, 64], // G13sus
    ]
    const notas = acordes.flatMap((ps, i) => ps.map((pitch, k) => ({ id: `n${i}-${k}`, pitch, velocidad: 70, inicio: i * 4, duracion: 4 })))
    st.project.tracks = [...st.project.tracks, { id: 'p', nombre: 'Piano', tipo: 'instrumento', clips: [{ id: 'c', inicio: 0, duracion: 16, notas }] } as never]
    expect(resumirProyectoParaCancion(st).tonalidad).toEqual({ raiz: 'C', escala: 'mayor' })
    const user = habilidadCompletarCancion.mensajesBrief({ userText: 'completa la canción', state: st })[1]!.content
    expect(user).toContain('IVmaj9=Fmaj9')
    expect(user).toContain('V13sus4=G13sus4')
  })

  it('tolera briefs descuidados de modelos pequeños (claves, mayúsculas, sinónimos, progresión en texto)', () => {
    const st = estadoConIntro(4)
    const respuesta = `Aquí tienes el arreglo:
{"Titulo":"Luz","estilo":"Balada","instrumentos":["Piano","Bass","Batería","Strings"],
 "estructura":[{"seccion":"Verso 1","barras":8,"acordes":"Isus2 - V/3 - vi7 - IVmaj9","energia":0.4},
  {"seccion":"Pre-Coro","barras":4,"acordes":["ii11","V13sus4"]},
  {"seccion":"Chorus","barras":8,"acordes":"IV | I/3 | V | vi9","energia":0.8},
  {"seccion":"Coro Final","barras":8,"energia":1}]}`
    const plan = habilidadCompletarCancion.planificar({ userText: 'completa la canción', state: st, semilla: 2 }, respuesta)
    expect(plan.creativoDelModelo).toBe(true)
    const p = plan.acciones[0]!.payload as { secciones: Array<{ tipo: string; progresion?: string[]; intensidad?: number }>; roles: string[]; estilo: string }
    expect(p.secciones.map((s) => s.tipo)).toEqual(['verso', 'precoro', 'coro', 'coroFinal'])
    expect(p.secciones[0]!.progresion).toEqual(['Isus2', 'V/3', 'vi7', 'IVmaj9'])
    expect(p.secciones[2]!.progresion).toEqual(['IV', 'I/3', 'V', 'vi9'])
    expect(p.roles).toEqual(expect.arrayContaining(['piano', 'bajo', 'bateria', 'cuerdas']))
    expect(p.estilo).toBe('ballad')
  })

  it('sin respuesta del modelo produce igualmente una canción completa variada por semilla', () => {
    const st = crearEstadoInicial()
    const a = habilidadCompletarCancion.planificar({ userText: 'haz una canción', state: st, semilla: 0 }, null)
    const b = habilidadCompletarCancion.planificar({ userText: 'haz una canción', state: st, semilla: 1 }, 'no sé')
    expect(a.creativoDelModelo).toBe(false)
    const sa = (a.acciones[0]!.payload as { secciones: unknown[] }).secciones
    const sb = (b.acciones[0]!.payload as { secciones: unknown[] }).secciones
    expect(sa.length).toBeGreaterThanOrEqual(7)
    expect(JSON.stringify(sa)).not.toBe(JSON.stringify(sb))
    expect((a.acciones[0]!.payload as { ajustarProyecto: boolean }).ajustarProyecto).toBe(true)
  })
})
