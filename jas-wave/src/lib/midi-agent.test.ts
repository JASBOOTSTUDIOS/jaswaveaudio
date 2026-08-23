/**
 * Brief MIDI del agente: tonalidad, progresión, menciones.
 * npx tsx --test src/lib/midi-agent.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fallbackActionsFromUserIntent } from './ai-daw-agent'
import {
  collectCitedMessages,
  filterMentionables,
  formatUserTurnWithCitations,
  historyWithCitedPins,
  listMentionables,
  resolveAtMentions,
} from './ai-mentions'
import { detectAgentMode, wantsFullProject } from './ai-modes'
import {
  composeMidiFromBrief,
  inferArticulationFromText,
  inferKeyFromText,
  inferMinutesFromText,
  inferProgressionFromText,
  parseMidiBriefFromText,
} from './midi-song-generator'
import type { DAWState } from '../../../shared/src/types/state'

const USER =
  'creame un clip midi en f# con la secuencia de acordes 6 - 4 - 1 - 3, con una duracion de 2 minutos con arpegios suaves, y con las notas como si fuesen un rasgueo hacia abajo de guitarra.'

function miniState(selectedId: string): DAWState {
  return {
    project: {
      tracks: [
        {
          id: 't-audio',
          nombre: 'Audio 1',
          tipo: 'audio',
          clips: [],
          plugins: [],
        },
        {
          id: 't-midi',
          nombre: 'Piano Lead',
          tipo: 'midi',
          clips: [{ id: 'c1', nombre: 'Intro', tipo: 'midi' }],
          plugins: [{ id: 'p1', nombre: 'JasWave Soft Pad', tipo: 'instrumento' }],
        },
      ],
    },
    selection: { idsPistas: [selectedId], idsClips: [], idPrincipal: selectedId },
  } as unknown as DAWState
}

describe('inferKeyFromText', () => {
  it('detecta F# en «en f#» (no C menor)', () => {
    const k = inferKeyFromText(USER)
    assert.equal(k.explicit, true)
    assert.equal(k.root, 54)
    assert.equal(k.scale, 'major')
    assert.match(k.label, /F#/)
  })
  it('F# menor es explícito', () => {
    const k = inferKeyFromText('clip en f# menor')
    assert.equal(k.scale, 'minor')
    assert.equal(k.explicit, true)
  })
})

describe('inferProgressionFromText', () => {
  it('lee 6-4-1-3 con espacios', () => {
    assert.deepEqual(inferProgressionFromText(USER), [6, 4, 1, 3])
  })
  it('lee romanos vi-IV-I-iii', () => {
    assert.deepEqual(inferProgressionFromText('vi-IV-I-iii'), [6, 4, 1, 3])
  })
})

describe('parseMidiBriefFromText', () => {
  it('arma brief de rasgueo 2 min en F#', () => {
    const b = parseMidiBriefFromText(USER, 120)
    assert.equal(b.keyLabel, 'F# mayor')
    assert.deepEqual(b.degrees, [6, 4, 1, 3])
    assert.equal(b.minutes, 2)
    assert.equal(b.articulation, 'strum')
  })
})

describe('composeMidiFromBrief', () => {
  it('genera notas con velocidades distintas y duración ~2 min', () => {
    const brief = parseMidiBriefFromText(USER, 120)
    const song = composeMidiFromBrief(brief, { bpm: 120, seed: 1 })
    assert.ok(song.notes.length > 50)
    assert.ok(song.durationBeats >= 240)
    const vels = new Set(song.notes.map((n) => n.velocidad))
    assert.ok(vels.size > 1, 'cada nota no debe compartir una sola velocidad')
    assert.match(song.structureLabel, /6–4–1–3|6-4-1-3/)
  })
})

describe('inferArticulationFromText', () => {
  it('rasgueo gana sobre arpegio', () => {
    assert.equal(inferArticulationFromText(USER), 'strum')
    assert.equal(inferArticulationFromText('arpegios suaves de piano'), 'arp')
  })
})

describe('inferMinutesFromText', () => {
  it('2 minutos', () => {
    assert.equal(inferMinutesFromText(USER), 2)
  })
})

describe('resolveAtMentions', () => {
  it('resuelve @Piano Lead y @Intro', () => {
    const st = miniState('t-midi')
    const hits = resolveAtMentions('modifica @Piano Lead y el clip @Intro', st)
    assert.ok(hits.some((h) => h.trackId === 't-midi' && h.kind === 'track'))
    assert.ok(hits.some((h) => h.clipId === 'c1'))
  })
})

describe('fallbackActionsFromUserIntent', () => {
  it('aplica clip a la pista MIDI seleccionada, no inventa C menor', () => {
    const st = miniState('t-midi')
    const actions = fallbackActionsFromUserIntent(USER, st)
    const gen = actions.find((a) => a.type === 'daw.generateMidiSong')
    assert.ok(gen)
    assert.equal(gen!.payload?.pistaId, 't-midi')
    assert.equal(gen!.payload?.aplicar, true)
    assert.equal(gen!.payload?.keyRoot, 54)
    assert.deepEqual(gen!.payload?.progresion, [6, 4, 1, 3])
    assert.equal(gen!.payload?.articulacion, 'strum')
    assert.equal(gen!.payload?.minutos, 2)
  })
})

describe('modos y @', () => {
  it('detecta plan vs crear vs proyecto completo', () => {
    assert.equal(detectAgentMode('haz un plan del arreglo'), 'plan')
    assert.equal(detectAgentMode('crea un clip midi'), 'create')
    assert.equal(wantsFullProject('crea un proyecto completo desde cero'), true)
    assert.equal(detectAgentMode('crea un proyecto completo desde cero'), 'create')
    assert.equal(wantsFullProject('créame una canción de reggaetón, 95 BPM'), true)
  })
  it('al escribir @ lista modos, acciones y pistas', () => {
    const st = miniState('t-midi')
    const all = filterMentionables(listMentionables(st), '')
    assert.ok(all.some((m) => m.kind === 'mode' && m.label === 'Plan'))
    assert.ok(all.some((m) => m.kind === 'action'))
    assert.ok(all.some((m) => m.kind === 'track' && m.label === 'Piano Lead'))
  })

  it('cita un mensaje anterior sin perder el pedido actual', () => {
    const st = miniState('t-midi')
    const chat = [
      { id: 'u1', role: 'user' as const, content: 'crea un bajo funk en F#' },
      { id: 'a1', role: 'assistant' as const, content: 'Listo, puse el bajo en la pista.' },
    ]
    const hits = listMentionables(st, chat)
    assert.ok(hits.some((m) => m.kind === 'message' && m.messageId === 'u1'))
    const resolved = resolveAtMentions('cambia el groove @msg:u1', st, chat)
    assert.ok(resolved.some((m) => m.kind === 'message' && m.messageId === 'u1'))
    const cited = collectCitedMessages('sigue con eso', ['u1'], st, chat)
    const packed = formatUserTurnWithCitations('ahora ponle más ghost notes', cited)
    assert.match(packed, /bajo funk/)
    assert.match(packed, /ahora ponle más ghost notes/)
    const hist = historyWithCitedPins(
      [
        ...chat,
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `x${i}`,
          role: 'user' as const,
          content: `turno ${i}`,
        })),
      ],
      cited,
      [],
    )
    assert.ok(hist.some((m) => m.content.includes('Mensaje citado') && m.content.includes('bajo funk')))
    assert.ok(hist.some((m) => m.content === 'turno 19'))
  })
})
