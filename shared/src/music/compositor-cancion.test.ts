import { describe, it, expect } from 'vitest'
import type { NotaMelodiaMidi } from '../audio/pitch-tracking'
import {
  ajustarAEscala, moverGrados, siguientePreguntaEntrevista, aplicarRespuestaEntrevista, ajustarMelodiaVoz, SLIDERS_POR_DEFECTO,
  alinearLetraANotas, armonizarDiatonico, construirPromptArmonizacion, leerArmonizacionLLM, armonizar, planVolcadoMultipista,
  NOMBRE_PISTA_REFERENCIA, type FichaCancion,
} from './compositor-cancion'

const nota = (i: number, beat: number, pitch: number, dur = 0.5, confianza = 0.9): NotaMelodiaMidi => ({
  id: `n${i}`, tiempoSeg: beat * 0.5, beat, pitch, notaNombre: 'x', velocidad: 90, duracionSeg: dur * 0.5, duracionBeats: dur, confianza,
})

describe('tonalidad', () => {
  it('ajusta a la escala y mueve grados diatónicos', () => {
    expect(ajustarAEscala(61, 0, 'mayor')).toBe(60)
    expect(ajustarAEscala(63, 0, 'mayor')).toBe(62)
    expect(moverGrados(60, 2, 0, 'mayor')).toBe(64)
    expect(moverGrados(64, -2, 0, 'mayor')).toBe(60)
    expect(moverGrados(60, -4, 0, 'mayor')).toBe(53)
  })
})

describe('entrevista', () => {
  it('pregunta en orden y valida respuestas', () => {
    let f: FichaCancion = {}
    expect(siguientePreguntaEntrevista(f)?.campo).toBe('genero')
    const pasos: Array<[Parameters<typeof aplicarRespuestaEntrevista>[1], string]> = [
      ['genero', 'worship'], ['vozBancoId', 'mi-voz'], ['modo', 'quiero cantarla yo'], ['tonica', 'bb'], ['escala', 'menor'], ['bpm', '72 bpm'], ['letra', 'Grande eres tú\nMi Dios'], ['conCoros', 'sí'],
    ]
    for (const [c, r] of pasos) {
      const x = aplicarRespuestaEntrevista(f, c, r)
      expect(x.ok).toBe(true)
      if (x.ok) f = x.ficha
    }
    expect(f).toMatchObject({ modo: 'cantada', tonica: 'A#', escala: 'menor', bpm: 72, conCoros: true })
    expect(siguientePreguntaEntrevista(f)).toBeNull()
    expect(aplicarRespuestaEntrevista(f, 'bpm', '999').ok).toBe(false)
    expect(aplicarRespuestaEntrevista(f, 'tonica', 'zzz').ok).toBe(false)
  })
})

describe('sliders de voz a melodía', () => {
  const crudas = [nota(1, 0.07, 61, 0.4, 0.4), nota(2, 0.55, 64, 0.45, 0.9), nota(3, 1.1, 66, 0.3, 0.3), nota(4, 1.6, 67, 0.4, 0.9), nota(5, 2.0, 69, 0.05, 0.2)]
  const ctx = { bpm: 120, tonica: 'C', escala: 'mayor' as const }
  it('con todo a 0 solo ordena y recalcula tiempos', () => {
    const r = ajustarMelodiaVoz(crudas, { afinacion: 0, cuantizacion: 0, legato: 0, limpieza: 0 }, ctx)
    expect(r.map((n) => n.pitch)).toEqual([61, 64, 66, 67, 69])
    expect(r[0]!.beat).toBeCloseTo(0.07)
  })
  it('afinación 100 % mete todo en escala; 50 % corrige la mitad (las menos seguras primero)', () => {
    const t = ajustarMelodiaVoz(crudas, { afinacion: 100, cuantizacion: 0, legato: 0, limpieza: 0 }, ctx)
    expect(t.map((n) => n.pitch)).toEqual([60, 64, 65, 67, 69])
    const m = ajustarMelodiaVoz(crudas, { afinacion: 50, cuantizacion: 0, legato: 0, limpieza: 0 }, ctx)
    expect(m.map((n) => n.pitch)).toEqual([61, 64, 65, 67, 69])   // la nota 66 (confianza .3) cae primero, la 61 (.4) queda
  })
  it('cuantización 100 % clava la rejilla; legato alarga sin solapar; limpieza quita la nota corta e insegura', () => {
    const q = ajustarMelodiaVoz(crudas, { afinacion: 0, cuantizacion: 100, legato: 0, limpieza: 0 }, ctx)
    for (const n of q) expect((n.beat / 0.5) % 1).toBeCloseTo(0, 6)
    const l = ajustarMelodiaVoz(crudas, { afinacion: 0, cuantizacion: 100, legato: 100, limpieza: 0 }, ctx)
    for (let i = 0; i + 1 < l.length; i++) expect(l[i]!.beat + l[i]!.duracionBeats).toBeLessThanOrEqual(l[i + 1]!.beat + 1e-9)
    const c = ajustarMelodiaVoz(crudas, { afinacion: 0, cuantizacion: 0, legato: 0, limpieza: 100 }, ctx)
    expect(c).toHaveLength(4)
    expect(c.find((n) => n.id === 'n5')).toBeUndefined()
    expect(ajustarMelodiaVoz(crudas, SLIDERS_POR_DEFECTO, ctx).length).toBeGreaterThan(0)
  })
})

describe('letra sobre notas', () => {
  it('menos sílabas que notas: melismas repartidos; la primera nota canta', () => {
    const ns = [0, 1, 2, 3, 4, 5].map((i) => nota(i, i, 60 + i, 1))
    const r = alinearLetraANotas('Dios es', ns)   // Dios | es = 2 sílabas
    expect(r).toHaveLength(6)
    expect(r.filter((x) => x.silaba).map((x) => x.silaba)).toEqual(['Dios', 'es'])
    expect(r[0]!.silaba).toBe('Dios')
    expect(r.filter((x) => x.melisma)).toHaveLength(4)
  })
  it('más sílabas que notas: parte las notas más largas conservando la suma de duraciones', () => {
    const ns = [nota(1, 0, 60, 2), nota(2, 2, 62, 1)]
    const r = alinearLetraANotas('Aleluya', ns)   // A-le-lu-ya = 4 sílabas
    expect(r).toHaveLength(4)
    expect(r.every((x) => x.silaba)).toBe(true)
    expect(r.reduce((s, x) => s + x.nota.duracionBeats, 0)).toBeCloseTo(3)
    expect(r.map((x) => x.silaba).join('')).toBe('Aleluya')
  })
  it('sin letra devuelve las notas sin sílaba', () => {
    expect(alinearLetraANotas('', [nota(1, 0, 60)])[0]!.silaba).toBeNull()
  })
})

describe('armonización', () => {
  const mel = [60, 62, 64, 65, 67]
  it('respaldo diatónico: 3ª abajo, 3ª arriba, 5ª abajo, siempre en escala', () => {
    const v = armonizarDiatonico(mel, 'C', 'mayor', 3)
    expect(v[0]!.pitches).toEqual([57, 59, 60, 62, 64])
    expect(v[1]!.pitches).toEqual([64, 65, 67, 69, 71])
    expect(v).toHaveLength(3)
    for (const x of v) for (const p of x.pitches) expect([0, 2, 4, 5, 7, 9, 11]).toContain(p % 12)
  })
  it('lee la respuesta del LLM y descarta voces inválidas con motivo', () => {
    const txt = 'Claro:\n```json\n{"voces":[{"nombre":"Alto","pitches":[64,65,67,69,71]},{"nombre":"Corta","pitches":[1,2]},{"nombre":"Lejos","pitches":[30,30,30,30,30]},{"nombre":"Mala","pitches":[60.5,62,64,65,67]}]}\n```'
    const r = leerArmonizacionLLM(txt, mel)
    expect(r.voces.map((v) => v.nombre)).toEqual(['Alto'])
    expect(r.descartes).toHaveLength(3)
    expect(leerArmonizacionLLM('no json', mel).voces).toEqual([])
  })
  it('armonizar completa con respaldo cuando el LLM falla o da menos voces', () => {
    const a = armonizar({ melodia: mel, tonica: 'C', escala: 'mayor', voces: 3, respuestaLLM: '{"voces":[{"nombre":"Alto","pitches":[64,65,67,69,71]}]}' })
    expect(a.voces.map((v) => v.origen)).toEqual(['llm', 'diatonico', 'diatonico'])
    expect(armonizar({ melodia: mel, tonica: 'C', escala: 'mayor', voces: 2 }).voces.every((v) => v.origen === 'diatonico')).toBe(true)
  })
  it('el prompt incluye la melodía, la tonalidad y el formato de respuesta', () => {
    const p = construirPromptArmonizacion({ melodia: mel, tonica: 'D', escala: 'menor', voces: 2 })
    expect(p).toContain('[60,62,64,65,67]')
    expect(p).toContain('D menor')
    expect(p).toContain('"voces"')
  })
})

describe('volcado multipista', () => {
  it('lead con letra, coros al Vocal Choir y referencia silenciada', () => {
    const lead = alinearLetraANotas('Grande eres', [nota(1, 0, 60, 1), nota(2, 1, 62, 1), nota(3, 2, 64, 1), nota(4, 3, 65, 1)])
    const coros = armonizarDiatonico(lead.map((x) => x.nota.pitch), 'C', 'mayor', 2)
    const plan = planVolcadoMultipista({ ficha: { vozBancoId: 'mi-voz', conCoros: true }, lead, coros, audioReferencia: true })
    expect(plan.map((p) => p.nombre)).toEqual(['Voz Lead', 'Coro · 2ª voz (3ª abajo)', 'Coro · 3ª voz (3ª arriba)', NOMBRE_PISTA_REFERENCIA])
    expect(plan[0]!.plugin).toBe('com.jaswave.plugin.vocal-choir')
    expect(plan[0]!.notas!.map((n) => n.silaba)).toEqual(['Gran', 'de', 'e', 'res'])
    expect(plan[plan.length - 1]).toMatchObject({ tipo: 'audio', silenciada: true })
    expect(planVolcadoMultipista({ ficha: { conCoros: false }, lead, coros }).map((p) => p.nombre)).toEqual(['Voz Lead'])
  })
})
