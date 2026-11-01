import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIDI_HORIZON_SEC,
  MidiLookahead,
  type MidiLookaheadClip,
  type MidiLookaheadSink,
  type MidiLookaheadTrack,
} from './midi-lookahead'

type Enviada = { slot: string; pitch: number; when: number; dur: number; now: number }

function montar(opts: { horizonSec?: number } = {}) {
  const enviadas: Enviada[] = []
  const ccs: Array<{ slot: string; cc: number; t: number }> = []
  const panics: string[] = []
  const sink: MidiLookaheadSink = {
    note: (slot, pitch, _v, when, dur, now) => enviadas.push({ slot, pitch, when, dur, now }),
    cc: (slot, cc, _v, t) => ccs.push({ slot, cc, t }),
    panicSlot: (slot) => panics.push(slot),
  }
  return { sch: new MidiLookahead(sink, opts), enviadas, ccs, panics }
}

function pista(id: string, extra: Partial<MidiLookaheadTrack> = {}): MidiLookaheadTrack {
  return { id, silenciada: false, soloActiva: false, vstInstrumentSlotId: `slot-${id}`, ...extra }
}

/** Una nota por 0,5 s durante `n` notas, pitch = 60 + (i % 12). */
function clipDenso(id: string, trackId: string, n: number, offsetSec = 0): MidiLookaheadClip {
  return {
    id,
    trackId,
    notes: Array.from({ length: n }, (_, i) => ({
      pitch: 60 + (i % 12),
      velocity: 100,
      startSec: offsetSec + i * 0.5,
      durationSec: 0.4,
    })),
  }
}

test('el horizonte por defecto es largo (>= 3 s) para absorber bloqueos del hilo principal', () => {
  assert.ok(MIDI_HORIZON_SEC >= 3)
})

test('primer tick programa solo la ventana [inicio, ahora + horizonte]', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 100)], [pista('t1')], 0)
  sch.tick(0)
  const hasta = MIDI_HORIZON_SEC
  assert.ok(enviadas.length > 0)
  assert.ok(enviadas.every((e) => e.when <= hasta + 1e-9))
  // 0, 0.5, ..., 3.5 -> 8 notas
  assert.equal(enviadas.length, Math.floor(hasta / 0.5) + 1)
  assert.equal(sch.scheduledUntilSec, hasta)
})

test('ticks sucesivos no duplican notas', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 40)], [pista('t1')], 0)
  for (let t = 0; t <= 25; t += 0.1) sch.tick(t)
  assert.equal(enviadas.length, 40)
  const claves = new Set(enviadas.map((e) => `${e.pitch}@${e.when}`))
  assert.equal(claves.size, 40)
})

test('un tick que se retrasa 2 s no pierde ninguna nota (el horizonte absorbe el retraso)', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 60)], [pista('t1')], 0)
  sch.tick(0)
  // El hilo principal se bloquea 2 s: el siguiente tick llega en t=2.0 en lugar de 0.1.
  // Todas las notas hasta 3.5 s ya estaban en el host => nada audible falta en [0, 2].
  const antes = enviadas.filter((e) => e.when < 2.0).length
  assert.equal(antes, 4) // 0, .5, 1, 1.5
  sch.tick(2.0)
  const tras = enviadas.map((e) => e.when)
  // Sin huecos: 0,0.5,... hasta 2.0+3.5 = 5.5
  for (let w = 0; w <= 5.5 + 1e-9; w += 0.5) {
    assert.equal(tras.filter((x) => Math.abs(x - w) < 1e-6).length, 1, `nota en ${w}`)
  }
})

test('con el horizonte antiguo (0,85 s) el mismo retraso de 2 s SI pierde audio programado', () => {
  const { sch, enviadas } = montar({ horizonSec: 0.85 })
  sch.begin([clipDenso('c1', 't1', 60)], [pista('t1')], 0)
  sch.tick(0)
  const programadoHasta = Math.max(...enviadas.map((e) => e.when))
  assert.ok(programadoHasta < 2.0, 'con 0,85 s el host se queda sin notas antes de t=2')
})

test('retraso mayor que el horizonte: las notas ya terminadas se descartan, las vivas suenan recortadas', () => {
  const { sch, enviadas } = montar({ horizonSec: 1 })
  sch.begin([clipDenso('c1', 't1', 30)], [pista('t1')], 0)
  sch.tick(0)
  const n0 = enviadas.length
  // Bloqueo de 5 s
  sch.tick(5.2)
  const nuevas = enviadas.slice(n0)
  // La nota de 5.0 (dura 0.4 => hasta 5.4) sigue viva: suena ahora con 0.2 s restantes.
  const viva = nuevas.find((e) => Math.abs(e.when - 5.2) < 1e-9)
  assert.ok(viva, 'nota viva reprogramada desde ahora')
  assert.ok(Math.abs(viva!.dur - 0.2) < 1e-6)
  // Nada anterior a 5.2 - tolerancia queda en el pasado.
  assert.ok(nuevas.every((e) => e.when >= 5.2 - 1e-9))
})

test('inicio en mitad de una nota (seek): suena desde el cursor con la duración restante', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 10)], [pista('t1')], 1.2)
  sch.tick(1.2)
  const primera = enviadas[0]!
  assert.equal(primera.pitch, 62) // nota i=2 (1.0..1.4)
  assert.ok(Math.abs(primera.when - 1.2) < 1e-9)
  assert.ok(Math.abs(primera.dur - 0.2) < 1e-6)
})

test('reprogramar tras seek: begin() descarta lo anterior y no hereda claves', () => {
  const { sch, enviadas } = montar()
  const clip = clipDenso('c1', 't1', 40)
  sch.begin([clip], [pista('t1')], 0)
  sch.tick(0)
  const n1 = enviadas.length
  // Seek a 10 s (el motor llama a playClips -> begin otra vez)
  sch.begin([clip], [pista('t1')], 10)
  sch.tick(10)
  const nuevas = enviadas.slice(n1)
  assert.ok(nuevas.length > 0)
  assert.ok(nuevas.every((e) => e.when >= 10 - 1e-9))
  // Y volver a 0 reenvía las primeras notas (claves limpias)
  sch.begin([clip], [pista('t1')], 0)
  const n2 = enviadas.length
  sch.tick(0)
  assert.equal(enviadas.length - n2, n1)
})

test('mute en vivo: panic del slot y no se vuelve a programar mientras esté silenciada', () => {
  const { sch, enviadas, panics } = montar()
  sch.begin([clipDenso('c1', 't1', 40)], [pista('t1')], 0)
  sch.tick(0)
  const n = enviadas.length
  const cambiadas = sch.retargetTracks([pista('t1', { silenciada: true })], 0.5)
  assert.deepEqual(cambiadas, ['t1'])
  assert.deepEqual(panics, ['slot-t1'])
  sch.tick(0.6)
  sch.tick(3)
  assert.equal(enviadas.length, n, 'sin notas nuevas en pista silenciada')
})

test('unmute en vivo: reprograma desde ahora sin esperar al siguiente horizonte', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 40)], [pista('t1', { silenciada: true })], 0)
  sch.tick(0)
  sch.tick(0.5)
  assert.equal(enviadas.length, 0)
  sch.retargetTracks([pista('t1')], 0.6)
  // Notas dentro de lo ya cubierto (hasta 0.5 + horizonte) están en el host de inmediato.
  assert.ok(enviadas.length > 0)
  assert.ok(enviadas.every((e) => e.when + e.dur > 0.6))
  assert.ok(enviadas.some((e) => e.when < 1.5), 'suena ya, no 3 s más tarde')
})

test('solo: una pista en solo silencia a las demás', () => {
  const { sch, enviadas } = montar()
  sch.begin(
    [clipDenso('c1', 't1', 10), clipDenso('c2', 't2', 10)],
    [pista('t1'), pista('t2', { soloActiva: true })],
    0,
  )
  sch.tick(0)
  assert.ok(enviadas.length > 0)
  assert.ok(enviadas.every((e) => e.slot === 'slot-t2'))
})

test('retarget sin cambios de audibilidad no reprograma ni hace panic', () => {
  const { sch, enviadas, panics } = montar()
  sch.begin([clipDenso('c1', 't1', 10)], [pista('t1')], 0)
  sch.tick(0)
  const n = enviadas.length
  const cambiadas = sch.retargetTracks([pista('t1')], 0.2)
  assert.deepEqual(cambiadas, [])
  assert.equal(panics.length, 0)
  assert.equal(enviadas.length, n)
})

test('rewindAll (reinicio del host) reenvía lo que ya estaba en la cola', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 20)], [pista('t1')], 0)
  sch.tick(1)
  const n = enviadas.length
  sch.rewindAll()
  sch.tick(1)
  assert.ok(enviadas.length > n)
})

test('reloj que retrocede rebobina en lugar de quedarse mudo', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 40)], [pista('t1')], 0)
  sch.tick(10)
  const n = enviadas.length
  sch.tick(2) // retrocedió 8 s
  assert.ok(enviadas.length >= n)
  assert.ok(sch.scheduledUntilSec <= 2 + MIDI_HORIZON_SEC + 1e-9)
})

test('rendimiento: 90 clips x 1000 notas, 600 ticks de 100 ms no son O(n^2)', () => {
  const clips = Array.from({ length: 90 }, (_, i) => ({
    id: `c${i}`,
    trackId: `t${i % 9}`,
    notes: Array.from({ length: 1000 }, (_, k) => ({
      pitch: 36 + (k % 48),
      velocity: 90,
      startSec: i * 0.1 + k * 0.06,
      durationSec: 0.05,
    })),
  }))
  const pistas = Array.from({ length: 9 }, (_, i) => pista(`t${i}`))
  let enviadas = 0
  const sch = new MidiLookahead({ note: () => void enviadas++, cc: () => {} })
  sch.begin(clips, pistas, 0)
  const t0 = performance.now()
  for (let t = 0; t < 60; t += 0.1) sch.tick(t)
  const ms = performance.now() - t0
  assert.ok(enviadas > 0)
  assert.ok(ms < 1500, `600 ticks tardaron ${ms.toFixed(0)} ms`)
})

test('tope por tick y slot: un racimo enorme se reparte en ticks sucesivos sin perder notas', () => {
  const racimo: MidiLookaheadClip = {
    id: 'c',
    trackId: 't1',
    notes: Array.from({ length: 4000 }, (_, i) => ({
      pitch: i % 128,
      velocity: 80,
      startSec: 0.1 + i * 1e-4,
      durationSec: 0.5,
    })),
  }
  const { sch, enviadas } = montar()
  sch.begin([racimo], [pista('t1')], 0)
  sch.tick(0)
  assert.ok(enviadas.length <= 1500)
  for (let i = 0; i < 6; i++) sch.tick(0.01 * (i + 1))
  assert.equal(enviadas.length, 4000)
})

test('rewindSlot (panic ajeno de la UI sobre un slot) reenvia solo esa pista, recortando notas vivas', () => {
  const { sch, enviadas } = montar()
  sch.begin([clipDenso('c1', 't1', 20), clipDenso('c2', 't2', 20)], [pista('t1'), pista('t2')], 0)
  sch.tick(1.1)
  const antes = enviadas.length
  assert.equal(sch.rewindSlot('slot-t1'), true)
  assert.equal(sch.rewindSlot('slot-inexistente'), false)
  sch.tick(1.15)
  const nuevas = enviadas.slice(antes)
  assert.ok(nuevas.length > 0)
  assert.ok(nuevas.every((e) => e.slot === 'slot-t1'), 'la otra pista no se duplica')
  assert.ok(nuevas.every((e) => e.when >= 1.15 - 1e-9), 'nada en el pasado')
})
