import { describe, expect, it } from 'vitest'
import { crearEstadoInicial } from '../state/estado-inicial'
import { planificarPaquete } from '../project/paquete'

function proyecto() {
  const base = crearEstadoInicial().project
  const audio = (id: string, ruta: string) => ({ id, tipo: 'audio', inicio: 0, duracion: 4, source: { ruta } })
  return {
    ...base,
    nombre: 'Mi canción',
    ruta: 'D:/Proyectos/mi.jaswave',
    tracks: [
      { ...(base.tracks[0] ?? {}), id: 'a', nombre: 'Voz', clips: [audio('c1', 'media/voz.wav'), audio('c2', 'E:/samples/voz.wav')] },
      { ...(base.tracks[0] ?? {}), id: 'b', nombre: 'Coros', clips: [audio('c3', 'media/voz.wav'), audio('c4', 'media/perdido.wav'), { id: 'm', tipo: 'midi', inicio: 0, duracion: 4 }] },
    ],
  } as unknown as ReturnType<typeof crearEstadoInicial>['project']
}

describe('planificarPaquete', () => {
  const resolver = (ruta: string) =>
    ruta === 'media/perdido.wav' ? null : ruta.startsWith('media/') ? `D:/Proyectos/${ruta}` : ruta

  it('reescribe rutas a media/, comparte copias y renombra choques', () => {
    const plan = planificarPaquete(proyecto(), resolver)
    expect(plan.archivos).toEqual([
      { origen: 'D:/Proyectos/media/voz.wav', destino: 'media/voz.wav' },
      { origen: 'E:/samples/voz.wav', destino: 'media/voz (2).wav' },
    ])
    expect(plan.faltantes).toEqual(['media/perdido.wav'])
    const archivo = JSON.parse(plan.json)
    const rutas = archivo.project.tracks.flatMap((t: { clips: Array<{ source?: { ruta: string } }> }) =>
      t.clips.map((c) => c.source?.ruta),
    )
    expect(rutas).toEqual(['media/voz.wav', 'media/voz (2).wav', 'media/voz.wav', 'media/perdido.wav', undefined])
    expect(archivo.project.ruta).toBeUndefined()
    expect(plan.nombreProyecto).toBe('Mi canción')
  })

  it('el JSON tiene el formato de Guardar (version, project, audioReferences)', () => {
    const archivo = JSON.parse(planificarPaquete(proyecto(), resolver).json)
    expect(typeof archivo.version).toBe('number')
    expect(Object.keys(archivo.audioReferences).length).toBeGreaterThan(0)
  })
})
