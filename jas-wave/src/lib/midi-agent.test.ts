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
          plugins: [{ id: 'p1', nombre: 'JasWave Roles', tipo: 'instrumento' }],
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
  it('no inventa generateMidiSong ni musicBuild (decisiones creativas van al modelo)', () => {
    const st = miniState('t-midi')
    const actions = fallbackActionsFromUserIntent(USER, st)
    assert.ok(!actions.some((a) => a.type === 'daw.generateMidiSong' || a.type === 'daw.musicBuild'))
  })

  it('BPM explícito sigue siendo determinista', () => {
    const actions = fallbackActionsFromUserIntent('pon BPM a 120')
    const bpm = actions.find((a) => a.type === 'project.setBpm')
    assert.equal(bpm?.payload?.bpm, 120)
  })
})

describe('modos y @', () => {
  it('detecta plan vs crear vs proyecto completo', () => {
    assert.equal(detectAgentMode('haz un plan del arreglo'), 'plan')
    assert.equal(detectAgentMode('crea un clip midi'), 'create')
    assert.equal(wantsFullProject('crea un proyecto completo desde cero'), true)
    assert.equal(detectAgentMode('crea un proyecto completo desde cero'), 'create')
    assert.equal(wantsFullProject('créame una canción de reggaetón, 95 BPM'), true)
    assert.equal(
      wantsFullProject(
        'quiero que me crees una cancion de adoracion moderna en D mayor con BFD, Descent y 4Front Bass',
      ),
      true,
    )
  })

  it('refinar canción (más lenta / sublime) → create + BPM sin inventar musicBuild', () => {
    const prompt =
      'ahora necesito que me hagas esta cancion mas sublime, mas lenta, esta muy rapida'
    assert.equal(detectAgentMode(prompt), 'create')
    assert.equal(detectAgentMode(prompt, 'plan'), 'create')
    assert.equal(wantsFullProject(prompt), true)
    const actions = fallbackActionsFromUserIntent(prompt, undefined, 'auto')
    assert.ok(actions.some((a) => a.type === 'project.setBpm'))
    assert.equal(actions.some((a) => a.type === 'daw.musicBuild'), false)
    const bpm = actions.find((a) => a.type === 'project.setBpm')!.payload!.bpm as number
    assert.ok(bpm < 100, `BPM debería ser lento, got ${bpm}`)
  })

  it('solo más lenta → setBpm sin rebuild completo', () => {
    const actions = fallbackActionsFromUserIntent('está muy rápida, hazla más lenta', undefined, 'auto')
    assert.ok(actions.some((a) => a.type === 'project.setBpm'))
    assert.equal(actions.some((a) => a.type === 'daw.musicBuild'), false)
  })

  it('notas duplicadas + selección anclada → midi.notes.dedupe', async () => {
    const { setMusicalSelectionAnchor, clearMusicalSelectionAnchor } = await import('./ai-selection-context')
    setMusicalSelectionAnchor({
      kind: 'midi-notes',
      trackId: 't-bass',
      trackName: 'Bajo',
      clipId: 'c-bass',
      clipName: 'Piano · C mayor',
      noteIds: ['n1', 'n2'],
      notes: [
        { id: 'n1', pitch: 53, inicio: 0, duracion: 1, velocidad: 80 },
        { id: 'n2', pitch: 53, inicio: 0, duracion: 1, velocidad: 80 },
      ],
      label: '2 notas · «Bajo» · pitches 53–53',
      createdAt: Date.now(),
    })
    try {
      const actions = fallbackActionsFromUserIntent(
        '[selección: 64 notas · «Bajo» · pitches 53–76] estan multi duplicadas las notas en este clip',
        undefined,
        'auto',
      )
      assert.ok(actions.some((a) => a.type === 'midi.notes.dedupe'))
      const d = actions.find((a) => a.type === 'midi.notes.dedupe')!
      assert.equal(d.payload?.pistaId, 't-bass')
      assert.equal(d.payload?.clipId, 'c-bass')
    } finally {
      clearMusicalSelectionAnchor()
    }
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
