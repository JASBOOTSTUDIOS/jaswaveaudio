/**

 * npm test (desde plugins/com.jaswave.modulo.asistente-ia)

 */



import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { describeActionForUser, labelForAction, tituloHerramientaParaUsuario } from '../src/motor/describe-action'

import {

  advanceChecklistAfterStep,

  buildChecklistFromActions,

  normalizeChecklist,

} from '../src/motor/ai-agent-checklist'



describe('describeActionForUser', () => {
  it('describe tempo', () => {
    const d = describeActionForUser({ type: 'project.setBpm', payload: { bpm: 72 } })
    assert.match(d.label, /72/)
    assert.match(d.label, /tempo/i)
  })

  it('describe notes.set con conteo y nombres de nota', () => {
    const d = describeActionForUser({
      type: 'midi.notes.set',
      payload: {
        pistaId: 't1',
        clipId: 'c1',
        notas: [
          { pitch: 60, inicio: 0, duracion: 1 },
          { pitch: 64, inicio: 1, duracion: 1 },
        ],
      },
    })
    assert.match(d.label, /2 notas/)
    assert.match(d.label, /Do4 a Mi4/)
    assert.doesNotMatch(d.label, /t1|c1/)
  })

  it('describe dedupe sin datos técnicos', () => {
    const d = describeActionForUser({
      type: 'midi.notes.dedupe',
      payload: { pistaId: 'bass-track', clipId: 'clip-1' },
    })
    assert.match(d.label, /duplicad/i)
    assert.doesNotMatch(`${d.label} ${d.detail ?? ''}`, /midi\.notes|pistaId|clipId|clip-1/)
  })

  it('resuelve nombres de pista y clip con el estado', () => {
    const estado = {
      project: {
        tracks: [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', nombre: 'Bajo', clips: [{ id: 'k9', nombre: 'Intro' }] }],
      },
    } as unknown as Parameters<typeof describeActionForUser>[1]
    const borrar = describeActionForUser(
      { type: 'track.delete', payload: { pistaId: 'a1b2c3d4-0000-4000-8000-000000000001' } },
      estado,
    )
    assert.equal(borrar.label, 'Eliminar la pista «Bajo»')
    const clip = describeActionForUser({ type: 'clip.delete', payload: { clipId: 'k9' } }, estado)
    assert.equal(clip.label, 'Eliminar el clip «Intro»')
    assert.equal(describeActionForUser({ type: 'track.delete', payload: { pistaId: 'zzz' } }).label, 'Eliminar una pista')
  })

  it('el caso por defecto humaniza por prefijo', () => {
    assert.equal(labelForAction({ type: 'track.freeze', payload: {} }), 'Congelar una pista')
    assert.equal(labelForAction({ type: 'mixer.setVolume', payload: {} }), 'Ajustar la mezcla')
    assert.equal(labelForAction({ type: 'plugin.move', payload: {} }), 'Ajustar un efecto o instrumento')
    assert.equal(labelForAction({ type: 'analysis.spectrum', payload: {} }), 'Analizar el proyecto')
    assert.equal(labelForAction({ type: 'render.start', payload: {} }), 'Exportar audio')
    assert.equal(labelForAction({ type: 'foo.barBaz', payload: {} }), 'Hacer un cambio en el proyecto')
  })

  it('tituloHerramientaParaUsuario devuelve gerundios legibles', () => {
    assert.equal(tituloHerramientaParaUsuario('track.list'), 'Revisando las pistas')
    assert.equal(tituloHerramientaParaUsuario('track.create'), 'Creando una pista')
    assert.equal(tituloHerramientaParaUsuario('project.setBpm'), 'Cambiando el tempo')
    assert.equal(tituloHerramientaParaUsuario('midi.createNotes'), 'Escribiendo notas MIDI')
    assert.equal(tituloHerramientaParaUsuario('tools.search'), 'Buscando herramientas')
    assert.equal(tituloHerramientaParaUsuario('foo.barBaz', 'lectura'), 'Revisando el proyecto')
    assert.equal(tituloHerramientaParaUsuario('foo.barBaz'), 'Trabajando en el proyecto')
  })

  it('ninguna etiqueta contiene tipos, ids, JSON ni guiones bajos', () => {
    const uuid = 'a1b2c3d4-1111-4222-8333-444455556666'
    const payload = {
      pistaId: uuid,
      trackId: uuid,
      clipId: 'f3a9c2e1-aaaa-4bbb-8ccc-ddddeeeeffff',
      noteIds: ['n_1', 'n_2'],
      notas: [{ pitch: 60, inicio: 0, duracion: 1 }],
      parameterId: 'cutoff_freq',
      pluginId: 'vst3:Serum.Xfer',
      slug: 'notas_proyecto.md',
      filePath: 'C:/audio/toma_1.wav',
      bpm: 90,
      semitonos: 2,
    }
    const tipos = [
      'project.setBpm', 'project.update', 'project.save', 'project.getSummary', 'project.setTimeSignature',
      'track.create', 'track.delete', 'track.update', 'track.list', 'track.toggleMute', 'track.toggleSolo',
      'track.freeze', 'track.getFxChain', 'track.addVstLayer',
      'clip.create', 'clip.delete', 'clip.move', 'clip.split', 'clip.merge', 'clip.setGain',
      'midi.clip.create', 'midi.notes.set', 'midi.notes.dedupe', 'midi.notes.get', 'midi.transpose',
      'midi.quantize', 'midi.humanize', 'midi.setVelocity', 'midi.deleteNotes', 'midi.createNotes',
      'midi.clip.md.upsert', 'midi.clip.md.apply', 'midi.clip.splitIntoSections',
      'plugin.insert', 'plugin.remove', 'plugin.bypass', 'plugin.setParameter', 'plugin.listParameters',
      'library.preset.apply', 'library.preset.search',
      'mixer.setVolume', 'mix.eq', 'send.set', 'master.update',
      'analysis.fullReport', 'analysis.loudness', 'render.start', 'export.midi',
      'transport.toggle', 'transport.seek', 'automation.writePoint', 'marker.create',
      'doc.write', 'doc.read', 'doc.list', 'audio.import', 'ui.setZoom',
      'daw.musicBuild', 'daw.wipeProject', 'daw.composeProject', 'daw.generateMidiSong',
      'web.search', 'tools.search', 'agent.askUser', 'foo.barBaz',
    ]
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    for (const type of tipos) {
      for (const p of [payload, {}]) {
        const d = describeActionForUser({ type, payload: p })
        for (const texto of [d.label, d.detail ?? '']) {
          assert.doesNotMatch(texto, /[A-Za-z]\.[A-Za-z]/, `${type}: «${texto}» contiene un tipo técnico`)
          assert.doesNotMatch(texto, /[{}]/, `${type}: «${texto}» contiene JSON`)
          assert.doesNotMatch(texto, /_/, `${type}: «${texto}» contiene _`)
          assert.doesNotMatch(texto, uuidRe, `${type}: «${texto}» contiene un id`)
        }
        assert.ok(d.label.trim().length > 0, `${type}: etiqueta vacía`)
      }
      const t = tituloHerramientaParaUsuario(type)
      assert.doesNotMatch(t, /[A-Za-z]\.[A-Za-z]|[{}_]/, `${type}: título «${t}»`)
    }
  })

  it('labelForAction alias', () => {
    assert.match(labelForAction({ type: 'track.create', payload: { nombre: 'Pad' } }), /Pad/)
  })
})

describe('checklist advance after approve', () => {

  it('advanceChecklistAfterStep marca done y avanza', () => {

    const list = buildChecklistFromActions([

      { type: 'project.setBpm', payload: { bpm: 70 } },

      { type: 'daw.musicBuild', payload: { prompt: 'x' } },

    ])!

    const stepId = list.items[0]!.id

    const next = advanceChecklistAfterStep(list, stepId, 'done')

    assert.equal(next.items[0]!.status, 'done')

    assert.equal(next.currentIndex, 1)

    assert.equal(next.items[1]!.status, 'ready')

  })



  it('descartar paso = skipped', () => {

    const list = normalizeChecklist({

      status: 'active',

      currentIndex: 0,

      items: [

        {

          id: 'a',

          label: 'Tempo',

          status: 'ready',

          actions: [{ type: 'project.setBpm', payload: { bpm: 80 } }],

        },

      ],

    })

    const next = advanceChecklistAfterStep(list, 'a', 'skipped')

    assert.equal(next.items[0]!.status, 'skipped')

    assert.equal(next.status, 'done')

  })

})


