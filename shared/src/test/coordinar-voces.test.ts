import { describe, expect, it } from 'vitest'
import { coordinarVoces, medirChoques, type AcordeVertical, type NotaVertical, type PistaVertical } from '../music/coordinar-voces'

const ac = (raiz: number, notas: number[], bajo = raiz): AcordeVertical => ({ raiz, notas: new Set(notas), bajo })
// Bm7 | A/C# | Gmaj7 | A  (cada acorde, un compás; 4 vueltas = 16 compases)
const BM7 = ac(11, [11, 2, 6, 9])
const A_C = ac(9, [9, 1, 4], 1)
const GM7 = ac(7, [7, 11, 2, 6])
const A = ac(9, [9, 1, 4])
const VUELTA = [BM7, A_C, GM7, A]
const acordes = Array.from({ length: 16 }, (_, i) => VUELTA[i % 4]!)
const escala = new Set([2, 4, 6, 7, 9, 11, 1]) // Re mayor

/** Canción sintética como la medida: cada nota es válida sola, pero juntas rozan. */
function cancion(): Array<PistaVertical> {
  const pad: NotaVertical[] = []
  const piano: NotaVertical[] = []
  const guitarra: NotaVertical[] = []
  const bajo: NotaVertical[] = []
  for (let c = 0; c < 16; c++) {
    const t = c * 4
    // Pad: un re sostenido 2 compases seguidos (no cambia con el acorde)
    if (c % 2 === 0) pad.push({ pitch: 62, inicio: t, duracion: 8, velocidad: 60 })
    // Piano: do♯ (9.ª de Bm7, 3.ª de A) arriba; Gmaj7: si
    piano.push({ pitch: c % 4 === 2 ? 71 : 73, inicio: t, duracion: 4, velocidad: 80 })
    // Guitarra: sol sobre Gmaj7, y notas del acorde en el resto
    guitarra.push({ pitch: c % 4 === 2 ? 67 : c % 4 === 0 ? 66 : 69, inicio: t, duracion: 4, velocidad: 80 })
    // Bajo: sol♯ sobre A/C#, fundamental en el resto
    bajo.push({ pitch: c % 4 === 1 ? 44 : [47, 0, 43, 45][c % 4]!, inicio: t, duracion: 2, velocidad: 90 })
    bajo.push({ pitch: c % 4 === 1 ? 44 : [47, 0, 43, 45][c % 4]!, inicio: t + 2, duracion: 2, velocidad: 90 })
  }
  return [
    { id: 'pad', familia: 'pad', notas: pad },
    { id: 'piano', familia: 'piano', notas: piano },
    { id: 'guitarra', familia: 'guitarra', notas: guitarra },
    { id: 'bajo', familia: 'bajo', notas: bajo },
  ]
}

const ejecutar = (p: PistaVertical[]) => coordinarVoces(p, { acordes, escala, numerador: 4, bpm: 74 })

describe('coordinarVoces', () => {
  it('la canción sintética tiene muchos choques entre pistas y tras coordinar quedan < 8 %', () => {
    const r = ejecutar(cancion())
    expect(r.resumen.porcentajeAntes).toBeGreaterThanOrEqual(25)
    expect(r.resumen.porcentajeDespues).toBeLessThan(8)
    expect(medirChoques(cancion()).choques).toBe(r.resumen.choquesAntes)
  })

  it('el bajo toca el bajo de la barra en el primer tiempo', () => {
    const r = ejecutar(cancion())
    const bajo = r.pistas.find((p) => p.id === 'bajo')!.notas
    for (const n of bajo) {
      const c = Math.floor(n.nota.inicio / 4)
      if (n.nota.inicio % 4 === 0) expect(n.nota.pitch % 12).toBe(acordes[c]!.bajo)
    }
    expect(r.resumen.bajoCorregido).toBeGreaterThan(0)
  })

  it('el pad cambia con el acorde: sus notas son del acorde y no sostiene la nota vieja tras el cambio', () => {
    const r = ejecutar(cancion())
    const pad = r.pistas.find((p) => p.id === 'pad')!.notas
    for (const n of pad) {
      const c = Math.floor(n.nota.inicio / 4)
      const a = acordes[c]!
      const clases = new Set([...a.notas, a.bajo, a.raiz, (a.raiz + 2) % 12, (a.raiz + 9) % 12])
      expect(clases.has(n.nota.pitch % 12)).toBe(true)
      const cambio = (c + 1) * 4
      // si el siguiente compás no contiene la nota, no se sostiene más allá del cambio + solape de legato (1 s ≈ 1,23 beats)
      const sig = acordes[c + 1]
      if (n.nota.inicio + n.nota.duracion > cambio + 1e-6 && sig) {
        const sigClases = new Set([...sig.notas, sig.bajo, sig.raiz, (sig.raiz + 2) % 12, (sig.raiz + 9) % 12])
        if (!sigClases.has(n.nota.pitch % 12)) expect(n.nota.inicio + n.nota.duracion).toBeLessThanOrEqual(cambio + 1.24)
      }
    }
  })

  it('nunca añade notas ni toca las de mayor prioridad, y todas las alturas siguen siendo del acorde (o color)', () => {
    const entrada = cancion()
    const r = ejecutar(entrada)
    for (const p of r.pistas) {
      const orig = entrada.find((x) => x.id === p.id)!
      expect(p.notas.length + p.quitadas.length).toBe(orig.notas.length)
    }
    // El piano (prioridad > pad) y la guitarra no cambian de altura en esta canción
    expect(r.pistas.find((x) => x.id === 'piano')!.notas.every((n) => !n.cambiada)).toBe(true)
    for (const p of r.pistas.filter((x) => x.id !== 'bajo')) {
      for (const n of p.notas.filter((x) => x.cambiada)) {
        const a = acordes[Math.floor(n.nota.inicio / 4)]!
        const permitidas = new Set([...a.notas, a.bajo, a.raiz, (a.raiz + 2) % 12, (a.raiz + 9) % 12])
        expect(permitidas.has(n.nota.pitch % 12)).toBe(true)
      }
    }
  })

  it('no muta la entrada y es determinista', () => {
    const e = cancion()
    const copia = JSON.stringify(e)
    const a = ejecutar(e)
    expect(JSON.stringify(e)).toBe(copia)
    expect(JSON.stringify(ejecutar(cancion()))).toBe(JSON.stringify(a))
  })

  it('una canción sin choques no cambia', () => {
    const limpia: PistaVertical[] = [
      { id: 'piano', familia: 'piano', notas: [{ pitch: 64, inicio: 0, duracion: 4 }] },
      { id: 'pad', familia: 'pad', notas: [{ pitch: 59, inicio: 0, duracion: 4 }] },
    ]
    const r = coordinarVoces(limpia, { acordes: [BM7], escala, bpm: 74 })
    expect(r.pistas.every((p) => p.notas.every((n) => !n.cambiada))).toBe(true)
    expect(r.resumen.porcentajeDespues).toBe(0)
  })
})
