import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import { findMidiClip } from '../../../shared/src/midi/query'
import { getAgentDoc } from './agent-docs'
import { midiClipDocSlug } from './midi-clip-markdown'
import {
  bindMidiClipMdSync,
  ensureMidiClipDoc,
  getMidiClipMdSyncStatus,
  unbindMidiClipMdSync,
} from './midi-clip-md-sync'

function installLocalStorage() {
  const bag = new Map<string, string>()
  const store = {
    getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
    setItem: (k: string, v: string) => {
      bag.set(k, String(v))
    },
    removeItem: (k: string) => {
      bag.delete(k)
    },
    clear: () => bag.clear(),
  }
  ;(globalThis as unknown as { localStorage: typeof store }).localStorage = store
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('midi-clip-md-sync', () => {
  beforeEach(() => {
    installLocalStorage()
    unbindMidiClipMdSync()
  })

  afterEach(() => {
    unbindMidiClipMdSync()
  })

  it('ensureMidiClipDoc escribe clip-*.md desde el DAW', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { tipo: 'midi', nombre: 'Piano' })
    const track = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!
    await tienda.executor.execute('midi.clip.create', {
      pistaId: track.id,
      nombre: 'Intro',
      inicio: 0,
      duracion: 8,
      notas: [{ id: 'n1', pitch: 60, inicio: 0, duracion: 1, velocidad: 90, canal: 0 }],
    })
    const clip = track.clips?.[0] ?? tienda.obtenerEstado().project.tracks.find((t) => t.id === track.id)!.clips![0]!
    const out = ensureMidiClipDoc(tienda, clip.id, track.id)
    assert.ok(out)
    assert.equal(out!.slug, midiClipDocSlug(clip.id))
    const doc = getAgentDoc(tienda.obtenerEstado().project.id, out!.slug)
    assert.ok(doc?.content.includes('pitch'))
    assert.ok(doc?.content.includes('60'))
  })

  it('daw→md: notes.set regenera el .md (debounce)', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { tipo: 'midi', nombre: 'Piano' })
    const track = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!
    await tienda.executor.execute('midi.clip.create', {
      pistaId: track.id,
      nombre: 'Intro',
      inicio: 0,
      duracion: 8,
      notas: [{ id: 'n1', pitch: 60, inicio: 0, duracion: 1, velocidad: 90, canal: 0 }],
    })
    const clip = tienda.obtenerEstado().project.tracks.find((t) => t.id === track.id)!.clips![0]!
    const bound = bindMidiClipMdSync({ tienda, clipId: clip.id, trackId: track.id })
    assert.ok(bound)

    await tienda.executor.execute('midi.notes.set', {
      pistaId: track.id,
      clipId: clip.id,
      notas: [
        { id: 'n1', pitch: 64, inicio: 0, duracion: 1, velocidad: 100, canal: 0 },
        { id: 'n2', pitch: 67, inicio: 1, duracion: 0.5, velocidad: 80, canal: 0 },
      ],
    })
    await sleep(350)
    const doc = getAgentDoc(tienda.obtenerEstado().project.id, bound!.slug)
    assert.match(doc?.content ?? '', /64/)
    assert.match(doc?.content ?? '', /67/)
    assert.equal(getMidiClipMdSyncStatus().bound, true)
    assert.equal(getMidiClipMdSyncStatus().noteCount, 2)
  })

  it('md inválido no pisa el MIDI', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { tipo: 'midi', nombre: 'Piano' })
    const track = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!
    await tienda.executor.execute('midi.clip.create', {
      pistaId: track.id,
      nombre: 'Intro',
      inicio: 0,
      duracion: 8,
      notas: [{ id: 'n1', pitch: 60, inicio: 0, duracion: 1, velocidad: 90, canal: 0 }],
    })
    const clip = tienda.obtenerEstado().project.tracks.find((t) => t.id === track.id)!.clips![0]!
    const bound = bindMidiClipMdSync({ tienda, clipId: clip.id, trackId: track.id })
    assert.ok(bound)

    const { writeAgentDoc } = await import('./agent-docs')
    writeAgentDoc(tienda.obtenerEstado().project.id, bound!.slug, '# bad\n\n## Notas\n\n| x |\n| --- |\n| no |\n', {
      origin: 'user',
      preserveUserNotes: false,
    })
    await sleep(350)
    const notes = findMidiClip(tienda.obtenerEstado(), clip.id, track.id)?.clip.notas
    assert.equal(notes?.length, 1)
    assert.equal(notes?.[0]?.pitch, 60)
    assert.ok(getMidiClipMdSyncStatus().parseErrors.length > 0)
  })

  it('md→daw: editar pitch en .md actualiza notas', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { tipo: 'midi', nombre: 'Piano' })
    const track = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!
    await tienda.executor.execute('midi.clip.create', {
      pistaId: track.id,
      nombre: 'Intro',
      inicio: 0,
      duracion: 8,
      notas: [{ id: 'n1', pitch: 60, inicio: 0, duracion: 1, velocidad: 90, canal: 0 }],
    })
    const clip = tienda.obtenerEstado().project.tracks.find((t) => t.id === track.id)!.clips![0]!
    const bound = bindMidiClipMdSync({ tienda, clipId: clip.id, trackId: track.id })
    assert.ok(bound)

    const { writeAgentDoc } = await import('./agent-docs')
    const before = getAgentDoc(tienda.obtenerEstado().project.id, bound!.slug)!.content
    const edited = before.replace(
      /(\|\s*[\w.-]+\s*\|\s*)60(\s*\|\s*C4\s*\|)/,
      '$172$2',
    )
    assert.notEqual(edited, before, 'markdown debe cambiar el pitch')
    writeAgentDoc(tienda.obtenerEstado().project.id, bound!.slug, edited, {
      origin: 'user',
      preserveUserNotes: false,
    })
    await sleep(400)
    const status = getMidiClipMdSyncStatus()
    assert.deepEqual(status.parseErrors, [], status.parseErrors.join('; '))
    const notes = findMidiClip(tienda.obtenerEstado(), clip.id, track.id)?.clip.notas
    assert.equal(notes?.[0]?.pitch, 72)
  })
})
