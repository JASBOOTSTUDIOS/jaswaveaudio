/**
 * Plan S: coordinación vertical aplicada al proyecto (reescritura de clips) con coherencia en verde.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coordinarBanda, planCoordinacion } from '../src/motor/turno/coordinar-banda'
import { analizarCoherencia, type HojaCoherencia } from '../src/motor/turno/coherencia-banda'

const hoja: HojaCoherencia = {
  tonalidad: 'Re mayor',
  numerador: 4,
  secciones: [{ nombre: 'Verso', compases: 8, acordes: ['Bm7', 'A/C#', 'Gmaj7', 'A'] }],
}
type N = { id: string; pitch: number; inicio: number; duracion: number; velocidad: number }
let n = 0
const nota = (pitch: number, inicio: number, duracion: number): N => ({ id: `n${++n}`, pitch, inicio, duracion, velocidad: 80 })
const pista = (id: string, nombre: string, notas: N[]) => ({ id, nombre, tipo: 'instrumento', plugins: [], clips: [{ id: `${id}-c`, nombre: 'x', inicio: 0, duracion: 32, notas }] })

function proyecto() {
  const pad: N[] = []
  const piano: N[] = []
  const bajo: N[] = []
  for (let c = 0; c < 8; c++) {
    if (c % 2 === 0) pad.push(nota(62, c * 4, 8))
    piano.push(nota(c % 4 === 2 ? 71 : 73, c * 4, 4))
    bajo.push(nota(c % 4 === 1 ? 44 : [47, 0, 43, 45][c % 4]!, c * 4, 4))
  }
  return { project: { bpm: 74, timeSignature: { numerador: 4 }, tracks: [pista('pad', 'Pad ambiente', pad), pista('piano', 'Piano', piano), pista('bajo', 'Bajo', bajo)] } }
}

describe('coordinación vertical del proyecto', () => {
  it('planifica reescrituras de los clips afectados conservando ids y velocidades, y baja los choques', () => {
    const st = proyecto()
    const { escrituras, resumen } = planCoordinacion(st, hoja)
    assert.ok(resumen && resumen.porcentajeAntes > 25 && resumen.porcentajeDespues < 8, JSON.stringify(resumen))
    assert.ok(escrituras.length >= 2)
    const pad = escrituras.find((e) => e.pistaId === 'pad')!
    assert.ok(pad.notas.every((x) => typeof x.id === 'string' && x.velocidad === 60 + 20))
    // El piano (prioridad mayor) no se reescribe
    assert.ok(!escrituras.some((e) => e.pistaId === 'piano'))
  })

  it('coordinarBanda ejecuta midi.notes.set por clip y devuelve el resumen', async () => {
    const llamadas: string[] = []
    const t = await coordinarBanda(proyecto(), hoja, async (nombre, args) => {
      llamadas.push(`${nombre}:${String(args.pistaId)}`)
      return true
    })
    assert.match(t ?? '', /Coordinación de voces: choques entre pistas en \d+(\.\d+)? % de los tiempos → [0-7](\.\d)? %/)
    assert.ok(llamadas.every((l) => l.startsWith('midi.notes.set:')))
  })

  it('tras coordinar, analizarCoherencia no añade avisos de armonía (bajo en la barra, notas del acorde)', () => {
    const st = proyecto()
    const { escrituras } = planCoordinacion(st, hoja)
    for (const e of escrituras) {
      const t = st.project.tracks.find((x) => x.id === e.pistaId)!
      ;(t.clips[0] as { notas: unknown[] }).notas = e.notas
    }
    const m = analizarCoherencia(st as never, hoja)
    assert.ok(!m.detalles.some((d) => /Bajo.*no toca la fundamental|fuera de Re mayor|primer tiempo suenan notas/.test(d)), m.detalles.join(' | '))
  })
})
