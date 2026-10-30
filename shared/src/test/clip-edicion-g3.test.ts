import { beforeEach, describe, expect, it } from 'vitest'
import { crearEstadoInicial, crearTiendaDAW } from '../state'

type T = ReturnType<typeof crearTiendaDAW>

const ultimaPista = (t: T): string => {
  const tracks = t.obtenerEstado().project.tracks
  return tracks[tracks.length - 1]!.id
}

async function preparar(): Promise<{ t: T; pistaId: string; audioPista: string; midiId: string; audioId: string }> {
  const t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  await t.executor.execute('track.create', { nombre: 'Teclas', tipo: 'midi' })
  const pistaId = ultimaPista(t)
  await t.executor.execute('track.create', { nombre: 'Voz', tipo: 'audio' })
  const audioPista = ultimaPista(t)
  const midi = await t.executor.execute('midi.clip.create', {
    pistaId,
    inicio: 0,
    duracion: 8,
    notas: [
      { pitch: 60, inicio: 0, duracion: 4, velocidad: 100 },
      { pitch: 64, inicio: 1, duracion: 1, velocidad: 90 },
    ],
  })
  const audio = await t.executor.execute('clip.create', { pistaId: audioPista, nombre: 'voz', inicio: 8, duracion: 8, sourceId: 'media/voz.wav' })
  expect(midi.success, JSON.stringify(midi.error)).toBe(true)
  expect(audio.success, JSON.stringify(audio.error)).toBe(true)
  const clips = t.obtenerEstado().project.tracks.flatMap((p) => p.clips as Array<{ id: string; tipo: string }>)
  return { t, pistaId, audioPista, midiId: clips.find((c) => c.tipo === 'midi')!.id, audioId: clips.find((c) => c.tipo === 'audio')!.id }
}

/** Busca el clip en cualquier pista (el primer argumento se ignora: compatibilidad de los tests). */
const clip = (t: T, _pistaId: string, id: string) =>
  t.obtenerEstado().project.tracks.flatMap((p) => p.clips as unknown as Array<Record<string, unknown>>).find((c) => c.id === id)!

describe('G3 · edición de clips y notas', () => {
  let ctx: Awaited<ReturnType<typeof preparar>>
  beforeEach(async () => {
    ctx = await preparar()
  })

  it('clip.setMute silencia varios clips en un solo paso de undo', async () => {
    const { t, pistaId, midiId, audioId } = ctx
    const r = await t.executor.execute('clip.setMute', {
      cambios: [
        { pistaId, clipId: midiId, silenciado: true },
        { pistaId: ctx.audioPista, clipId: audioId, silenciado: true },
      ],
    })
    expect(r.success).toBe(true)
    expect(clip(t, pistaId, midiId).silenciado).toBe(true)
    expect(clip(t, pistaId, audioId).silenciado).toBe(true)
    await t.executor.undo()
    expect(clip(t, pistaId, midiId).silenciado).toBe(false)
    expect(clip(t, pistaId, audioId).silenciado).toBe(false)
    await t.executor.redo()
    expect(clip(t, pistaId, audioId).silenciado).toBe(true)
  })

  it('clip.setFade en segundos, acotado al largo del clip y con undo', async () => {
    const { t, pistaId, audioId } = ctx
    // 8 beats a 120 BPM = 4 s; con un fade out de 1 s, el fade in no puede pasar de 3 s.
    await t.executor.execute('clip.setFade', { pistaId: ctx.audioPista, clipId: audioId, tipo: 'out', duracion: 1 })
    const r = await t.executor.execute('clip.setFade', { pistaId: ctx.audioPista, clipId: audioId, tipo: 'in', duracion: 10, curva: 'exponencial' })
    expect(r.success).toBe(true)
    const fadeIn = clip(t, pistaId, audioId).fadeIn as { duracion: number; curva: string }
    expect(fadeIn.duracion).toBeCloseTo(3)
    expect(fadeIn.curva).toBe('exponencial')
    await t.executor.undo()
    expect((clip(t, pistaId, audioId).fadeIn as { duracion: number }).duracion).toBe(0)
  })

  it('los fades y la ganancia son solo de audio', async () => {
    const { t, pistaId, midiId } = ctx
    expect((await t.executor.execute('clip.setFade', { pistaId, clipId: midiId, tipo: 'in', duracion: 1 })).success).toBe(false)
    expect((await t.executor.execute('clip.setGain', { pistaId, clipId: midiId, gananciaDb: 3 })).success).toBe(false)
  })

  it('clip.setGain acota a −48..+24 dB y deshace al valor previo', async () => {
    const { t, pistaId, audioId } = ctx
    await t.executor.execute('clip.setGain', { pistaId: ctx.audioPista, clipId: audioId, gananciaDb: 40 })
    expect(clip(t, pistaId, audioId).ganancia).toBe(24)
    await t.executor.undo()
    expect(clip(t, pistaId, audioId).ganancia).toBe(0)
  })

  it('midi.notes.mute alterna y deshace', async () => {
    const { t, pistaId, midiId } = ctx
    const notas = () => clip(t, pistaId, midiId).notas as Array<{ id: string; mute?: boolean; pitch: number }>
    const id = notas()[0]!.id
    await t.executor.execute('midi.notes.mute', { pistaId, clipId: midiId, noteIds: [id] })
    expect(notas()[0]!.mute).toBe(true)
    await t.executor.execute('midi.notes.mute', { pistaId, clipId: midiId, noteIds: [id] })
    expect(notas()[0]!.mute).toBe(false)
    await t.executor.undo()
    expect(notas()[0]!.mute).toBe(true)
  })

  it('midi.notes.split corta las notas que cruzan el punto, con ids únicos y undo', async () => {
    const { t, pistaId, midiId } = ctx
    const notas = () => clip(t, pistaId, midiId).notas as Array<{ id: string; pitch: number; inicio: number; duracion: number }>
    const r = await t.executor.execute('midi.notes.split', { pistaId, clipId: midiId, beat: 1.5 })
    expect(r.success).toBe(true)
    const n = notas()
    expect(n).toHaveLength(4)
    expect(new Set(n.map((x) => x.id)).size).toBe(4)
    const do60 = n.filter((x) => x.pitch === 60).sort((a, b) => a.inicio - b.inicio)
    expect(do60.map((x) => [x.inicio, x.duracion])).toEqual([
      [0, 1.5],
      [1.5, 2.5],
    ])
    await t.executor.undo()
    expect(notas()).toHaveLength(2)
    await t.executor.redo()
    expect(notas()).toHaveLength(4)
  })

  it('midi.notes.split sin notas que cortar falla con mensaje claro', async () => {
    const { t, pistaId, midiId } = ctx
    const r = await t.executor.execute('midi.notes.split', { pistaId, clipId: midiId, beat: 7 })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r)).toMatch(/Ninguna nota cruza/)
  })
})
