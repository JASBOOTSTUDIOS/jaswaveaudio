import { describe, expect, it } from 'vitest'
import { azarDeterminista, clasificarFamiliaBanda, humanizarBanda, MAX_DESVIO_BEATS, type NotaHumanizable } from '../music/humanizar-banda'

/** Compás de batería rígido: bombo 1 y 3, caja 2 y 4, hi-hat a corcheas, todo igual. */
function compasBateria(ini: number): NotaHumanizable[] {
  const n: NotaHumanizable[] = []
  for (const p of [0, 2]) n.push({ pitch: 36, inicio: ini + p, duracion: 0.25, velocidad: 100 })
  for (const p of [1, 3]) n.push({ pitch: 38, inicio: ini + p, duracion: 0.25, velocidad: 100 })
  for (let i = 0; i < 8; i++) n.push({ pitch: 42, inicio: ini + i * 0.5, duracion: 0.25, velocidad: 80 })
  return n
}
const bateria = (compases: number) => Array.from({ length: compases }, (_, i) => compasBateria(i * 4)).flat()
/** Arpegio de guitarra: 8 corcheas por compás, todo igual. */
const guitarra = (compases: number) =>
  Array.from({ length: compases }, (_, c) => [60, 64, 67, 72, 67, 64, 67, 64].map((pitch, i) => ({ pitch, inicio: c * 4 + i * 0.5, duracion: 0.5, velocidad: 80 }))).flat()

const base = { bpm: 74, semilla: 'pista-1', numerador: 4 }
const firmaCompas = (notas: Array<{ pitch: number; inicio: number; duracion: number }>, c: number) =>
  notas
    .filter((n) => n.inicio >= c * 4 - 0.07 && n.inicio < c * 4 + 3.9)
    .map((n) => `${n.pitch}@${Math.round((n.inicio - c * 4) * 8)}/${Math.round(n.duracion * 8)}`)
    .sort()
    .join('|')

describe('humanizarBanda', () => {
  it('es determinista: misma entrada y semilla, misma salida', () => {
    const a = humanizarBanda(bateria(8), { ...base, familia: 'bateria', vistos: new Map() })
    const b = humanizarBanda(bateria(8), { ...base, familia: 'bateria', vistos: new Map() })
    expect(a.notas).toEqual(b.notas)
    const c = humanizarBanda(bateria(8), { ...base, familia: 'bateria', semilla: 'otra', vistos: new Map() })
    expect(c.notas).not.toEqual(a.notas)
  })

  it('no muta la entrada', () => {
    const entrada = bateria(4)
    const copia = JSON.parse(JSON.stringify(entrada))
    humanizarBanda(entrada, { ...base, familia: 'bateria', vistos: new Map() })
    expect(entrada).toEqual(copia)
  })

  it('el micro-timing de la batería es de pocos ms y el golpe del tiempo 1 queda casi exacto y nunca adelantado', () => {
    const orig = bateria(16)
    const { notas } = humanizarBanda(orig, { ...base, familia: 'bateria', vistos: new Map() })
    const msPorBeat = 60000 / base.bpm
    for (const n of notas) {
      if (n.origen < 0) continue
      const d = (n.inicio - orig[n.origen]!.inicio) * msPorBeat
      expect(Math.abs(d)).toBeLessThanOrEqual(10)
      if (orig[n.origen]!.inicio % 4 === 0 && (n.pitch === 36 || n.pitch === 38)) {
        expect(d).toBeGreaterThanOrEqual(-1e-6)
        expect(d).toBeLessThanOrEqual(3.001)
      }
    }
    expect(notas.some((n) => n.origen >= 0 && n.inicio !== orig[n.origen]!.inicio)).toBe(true)
  })

  it('ninguna nota se aleja de su sitio más que MAX_DESVIO_BEATS ni cruza la barra hacia atrás (a cualquier tempo)', () => {
    for (const bpm of [60, 120, 200]) {
      for (const [familia, notas] of [['guitarra', guitarra(8)], ['bateria', bateria(8)]] as const) {
        const r = humanizarBanda(notas, { ...base, bpm, familia, vistos: new Map(), modo: 'siempre' })
        for (const n of r.notas) {
          if (n.origen < 0) continue
          const o = notas[n.origen]!
          // Las variaciones de estructura mueven un ataque débil ¼ de beat; el micro-timing, como mucho MAX_DESVIO_BEATS.
          const d = Math.abs(n.inicio - o.inicio)
          expect(d <= MAX_DESVIO_BEATS + 1e-9 || Math.abs(d - 0.25) <= MAX_DESVIO_BEATS + 1e-9).toBe(true)
          if (o.inicio % 4 === 0) expect(n.inicio).toBeGreaterThanOrEqual(o.inicio - 1e-9)
        }
      }
    }
  })

  it('la velocidad deja de ser uniforme y el tiempo 1 pega más fuerte que los tiempos débiles', () => {
    const { notas } = humanizarBanda(guitarra(8), { ...base, familia: 'guitarra', vistos: new Map() })
    const vel = notas.map((n) => n.velocidad)
    expect(Math.max(...vel) - Math.min(...vel)).toBeGreaterThanOrEqual(10)
    const fuertes = notas.filter((n) => n.inicio % 4 < 0.1).map((n) => n.velocidad)
    const debiles = notas.filter((n) => Math.abs((n.inicio % 1) - 0.5) < 0.1).map((n) => n.velocidad)
    expect(fuertes.reduce((a, b) => a + b, 0) / fuertes.length).toBeGreaterThan(debiles.reduce((a, b) => a + b, 0) / debiles.length)
  })

  it('compases repetidos de batería: cada copia es distinta, hay ghost notes y fills, y el primer compás no cambia de estructura', () => {
    const entrada = bateria(16)
    const { notas, resumen } = humanizarBanda(entrada, { ...base, familia: 'bateria', vistos: new Map() })
    expect(resumen.copias).toBeGreaterThanOrEqual(14)
    expect(resumen.fills).toBeGreaterThanOrEqual(2)
    expect(resumen.fantasmas).toBeGreaterThan(0)
    expect(firmaCompas(notas, 0)).toBe(firmaCompas(entrada, 0))
    const firmas = new Set(Array.from({ length: 16 }, (_, c) => firmaCompas(notas, c)))
    expect(firmas.size).toBeGreaterThanOrEqual(10)
    // Fill en el último compás de cada 4: más golpes de caja en el último tiempo.
    const ultimoTiempo = (c: number) => notas.filter((n) => n.inicio >= c * 4 + 2.9 && n.inicio < c * 4 + 4 && n.pitch === 38).length
    expect(ultimoTiempo(3)).toBeGreaterThanOrEqual(3)
    expect(ultimoTiempo(1)).toBeLessThan(ultimoTiempo(3))
    // Los ghost notes son flojos.
    expect(notas.filter((n) => n.origen < 0 && n.velocidad < 45).length).toBeGreaterThan(0)
  })

  it('guitarra: las copias varían de estructura SIN cambiar alturas', () => {
    const entrada = guitarra(16)
    const { notas, resumen } = humanizarBanda(entrada, { ...base, familia: 'guitarra', vistos: new Map() })
    expect(resumen.variados).toBeGreaterThan(5)
    const permitidas = new Set(entrada.map((n) => n.pitch))
    for (const n of notas) expect(permitidas.has(n.pitch)).toBe(true)
    expect(notas.every((n) => n.origen >= 0)).toBe(true)
    // Nunca se pierde el ataque del primer tiempo.
    for (let c = 1; c < 16; c++) expect(notas.some((n) => n.pitch === 60 && n.inicio >= c * 4 && n.inicio < c * 4 + 0.07)).toBe(true)
    const firmas = new Set(Array.from({ length: 16 }, (_, c) => firmaCompas(notas, c)))
    expect(firmas.size).toBeGreaterThanOrEqual(8)
  })

  it('los compases protegidos (inicio de sección) solo reciben tiempo y dinámica', () => {
    const entrada = bateria(8)
    const { notas } = humanizarBanda(entrada, { ...base, familia: 'bateria', vistos: new Map(), compasesProtegidos: new Set([0, 3, 7]) })
    for (const c of [3, 7]) expect(firmaCompas(notas, c)).toBe(firmaCompas(entrada, c))
  })

  it('la memoria de la pista detecta copias entre llamadas; reescribir el mismo compás no cuenta como copia', () => {
    const vistos = new Map<string, Set<number>>()
    const a = humanizarBanda(guitarra(2), { ...base, familia: 'guitarra', vistos })
    expect(a.resumen.copias).toBe(1)
    const otra = humanizarBanda(guitarra(1), { ...base, familia: 'guitarra', vistos, inicioClip: 40 })
    expect(otra.resumen.copias).toBe(1)
    const solo = new Map<string, Set<number>>()
    humanizarBanda(guitarra(1), { ...base, familia: 'guitarra', vistos: solo })
    const reescrito = humanizarBanda(guitarra(1), { ...base, familia: 'guitarra', vistos: solo })
    expect(reescrito.resumen.copias).toBe(0)
  })

  it('las notas de un acorde se mueven juntas (el legato las sigue agrupando)', () => {
    const acordes = Array.from({ length: 8 }, (_, c) => [60, 64, 67].map((pitch) => ({ pitch, inicio: c * 4, duracion: 4, velocidad: 70 }))).flat()
    const { notas } = humanizarBanda(acordes, { ...base, familia: 'pad', vistos: new Map() })
    for (let c = 0; c < 8; c++) {
      const g = notas.filter((n) => Math.abs(n.inicio - c * 4) < 0.1)
      expect(g).toHaveLength(3)
      expect(Math.max(...g.map((n) => n.inicio)) - Math.min(...g.map((n) => n.inicio))).toBeLessThan(1 / 64)
    }
  })

  it('clasifica las familias y el azar es reproducible', () => {
    expect(clasificarFamiliaBanda('Batería')).toBe('bateria')
    expect(clasificarFamiliaBanda('Guitarra eléctrica')).toBe('guitarra')
    expect(clasificarFamiliaBanda('Pad ambiente')).toBe('pad')
    expect(clasificarFamiliaBanda('Cuerdas')).toBe('cuerdas')
    expect(clasificarFamiliaBanda('Piano')).toBe('piano')
    expect(azarDeterminista('x')()).toBe(azarDeterminista('x')())
  })
})
