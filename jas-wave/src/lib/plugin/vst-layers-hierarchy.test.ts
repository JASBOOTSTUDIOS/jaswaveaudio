import { test } from 'node:test'
import assert from 'node:assert/strict'
import { creariaCiclo, padresEfectivos, pistasAudibles, planSoltarPista, profundidad, type PistaJerarquia } from './track-hierarchy'
import { encodeTrackGraph } from './track-graph-encoding'
import { MidiLookahead, slotsDePista, type MidiLookaheadSink } from '../../../lib/midi-lookahead'

const carpeta = (id: string, extra: Partial<PistaJerarquia> = {}): PistaJerarquia => ({ id, tipo: 'carpeta', ...extra })
const pista = (id: string, padreId?: string, extra: Partial<PistaJerarquia> = {}): PistaJerarquia => ({
  id,
  tipo: 'midi',
  padreId,
  ...extra,
})

test('padre efectivo: solo carpetas existentes, sin auto-referencia ni ciclos', () => {
  const padres = padresEfectivos([
    carpeta('F'),
    pista('a', 'F'),
    pista('b', 'no-existe'),
    pista('c', 'a'), // el padre no es carpeta → raíz
    carpeta('X', { padreId: 'Y' }),
    carpeta('Y', { padreId: 'X' }),
  ])
  assert.equal(padres.get('a'), 'F')
  assert.equal(padres.has('b'), false)
  assert.equal(padres.has('c'), false)
  // El ciclo X↔Y se rompe: al menos uno de los dos sale a la raíz.
  assert.ok(!(padres.get('X') === 'Y' && padres.get('Y') === 'X'))
})

test('mute de una carpeta silencia todo lo que cuelga de ella (anidado)', () => {
  const pistas = [carpeta('F', { silenciada: true }), carpeta('G', { padreId: 'F' }), pista('a', 'G'), pista('b')]
  const aud = pistasAudibles(pistas)
  assert.deepEqual([...aud].sort(), ['b'])
})

test('solo de una carpeta: suenan ella y sus hijas; el resto calla', () => {
  const pistas = [carpeta('F', { soloActiva: true }), pista('a', 'F'), pista('b', 'F'), pista('c')]
  const aud = pistasAudibles(pistas)
  assert.deepEqual([...aud].sort(), ['F', 'a', 'b'])
})

test('solo de una hija: suenan ella y sus carpetas por encima, no sus hermanas', () => {
  const pistas = [carpeta('F'), carpeta('G', { padreId: 'F' }), pista('a', 'G', { soloActiva: true }), pista('b', 'G'), pista('c')]
  const aud = pistasAudibles(pistas)
  assert.deepEqual([...aud].sort(), ['F', 'G', 'a'])
})

test('los buses de retorno siguen sonando con un solo activo', () => {
  const aud = pistasAudibles([pista('a', undefined, { soloActiva: true }), pista('rev')], new Set(['rev']))
  assert.ok(aud.has('rev'))
})

test('profundidad y detección de ciclos al mover', () => {
  const padres = padresEfectivos([carpeta('F'), carpeta('G', { padreId: 'F' }), pista('a', 'G')])
  assert.equal(profundidad('a', padres), 2)
  assert.equal(profundidad('F', padres), 0)
  assert.equal(creariaCiclo('F', 'G', padres), true)
  assert.equal(creariaCiclo('F', 'F', padres), true)
  assert.equal(creariaCiclo('a', 'F', padres), false)
  assert.equal(creariaCiclo('a', undefined, padres), false)
})

test('el grafo codifica el stem padre como 5º campo y lo omite en la raíz', () => {
  const enc = encodeTrackGraph({
    tracks: [
      { stemIndex: 0, gain: 1, pan: 0, muted: false, slots: [] },
      { stemIndex: 1, gain: 0.5, pan: 0, muted: false, parentStem: 0, slots: [{ slotId: 's1', instrument: true, bypass: false }] },
      { stemIndex: 2, gain: 1, pan: 0, muted: true, parentStem: 2, slots: [] },
    ],
    master: [],
  })
  const partes = enc.split('||')[0]!.split(';').filter(Boolean)
  assert.equal(partes[0], '0~1~0~0|')
  assert.equal(partes[1], '1~0.5~0~0~0|s1:i:0')
  // Un padre igual a sí mismo se ignora (sale al master).
  assert.equal(partes[2], '2~1~0~1|')
})

test('capas: el MIDI de la pista llega al instrumento principal y a cada capa, una vez', () => {
  const enviadas: Array<{ slot: string; pitch: number }> = []
  const sink: MidiLookaheadSink = {
    note: (slot, pitch) => enviadas.push({ slot, pitch }),
    cc: () => {},
  }
  const sch = new MidiLookahead(sink)
  const t = { id: 't', silenciada: false, soloActiva: false, vstInstrumentSlotId: 'piano', vstLayerSlotIds: ['pad', 'piano'] }
  assert.deepEqual(slotsDePista(t), ['piano', 'pad'])
  sch.begin([{ id: 'c', trackId: 't', notes: [{ pitch: 60, velocity: 100, startSec: 0, durationSec: 1 }] }], [t], 0)
  sch.tick(0)
  sch.tick(0.1)
  assert.deepEqual(
    enviadas.map((e) => e.slot).sort(),
    ['pad', 'piano'],
  )
})

test('capas: cambiar las capas en play hace panic de los slots previos', () => {
  const panics: string[] = []
  const sch = new MidiLookahead({ note: () => {}, cc: () => {}, panicSlot: (s) => panics.push(s) })
  const base = { id: 't', silenciada: false, soloActiva: false, vstInstrumentSlotId: 'piano' }
  sch.begin([{ id: 'c', trackId: 't', notes: [{ pitch: 60, velocity: 100, startSec: 0, durationSec: 10 }] }], [{ ...base, vstLayerSlotIds: ['pad'] }], 0)
  sch.tick(0)
  sch.retargetTracks([base], 1)
  assert.deepEqual(panics.sort(), ['pad', 'piano'])
})

test('soltar sobre la mitad derecha de una carpeta mete la pista justo debajo', () => {
  const pistas = [pista('a'), carpeta('F'), pista('b', 'F'), pista('c')]
  assert.deepEqual(planSoltarPista(pistas, 'c', 'F', true), [
    { type: 'track.move', payload: { trackId: 'c', toIndex: 2 } },
    { type: 'track.update', payload: { trackId: 'c', datos: { padreId: 'F' } } },
  ])
  // Desde arriba: el destino se desplaza al quitar la pista.
  assert.deepEqual(planSoltarPista(pistas, 'a', 'F', true)[0], { type: 'track.move', payload: { trackId: 'a', toIndex: 1 } })
})

test('soltar entre hijas adopta la carpeta; sobre la carpeta o una raíz la saca', () => {
  const pistas = [carpeta('F'), pista('b', 'F'), pista('c', 'F'), pista('d')]
  assert.deepEqual(planSoltarPista(pistas, 'd', 'c', false), [
    { type: 'track.move', payload: { trackId: 'd', toIndex: 2 } },
    { type: 'track.update', payload: { trackId: 'd', datos: { padreId: 'F' } } },
  ])
  assert.deepEqual(planSoltarPista(pistas, 'b', 'F', false), [
    { type: 'track.move', payload: { trackId: 'b', toIndex: 0 } },
    { type: 'track.update', payload: { trackId: 'b', datos: { padreId: null } } },
  ])
})

test('soltar nunca mete una carpeta dentro de sus hijas', () => {
  const pistas = [carpeta('F'), carpeta('G', { padreId: 'F' }), pista('x')]
  const plan = planSoltarPista(pistas, 'F', 'G', true)
  assert.ok(!plan.some((c) => c.type === 'track.update'))
})
