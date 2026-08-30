import { describe, expect, it } from 'vitest'
import {
  formatMidiTimelineForPrompt,
  buildReadOnlyProjectContext,
  buildMidiAuditReport,
  buildMidiAuditFixActions,
  buildMidiAuditClarifications,
  isGarbageAssistantReply,
} from '../ask/read-context'
import type { DAWState } from '@jaswave/shared'

function miniState(): DAWState {
  return {
    project: {
      id: 'p1',
      nombre: 'Test',
      bpm: { valor: 72, automatizado: false },
      timeSignature: { numerador: 4, denominador: 4 },
      tracks: [
        {
          id: 't-bass',
          nombre: 'Bajo',
          tipo: 'midi',
          silenciada: false,
          soloActiva: false,
          armada: false,
          plugins: [],
          clips: [
            {
              id: 'c1',
              nombre: 'Bajo loop',
              tipo: 'midi',
              inicio: 0,
              duracion: 8,
              notas: [
                { id: 'n1', pitch: 53, inicio: 0, duracion: 1, velocidad: 80, canal: 0, presion: 0, seleccionada: false },
                { id: 'n2', pitch: 53, inicio: 0, duracion: 1, velocidad: 90, canal: 0, presion: 0, seleccionada: false },
                { id: 'n3', pitch: 55, inicio: 9, duracion: 1, velocidad: 70, canal: 0, presion: 0, seleccionada: false },
              ],
            },
          ],
        },
      ],
    },
    transport: { reproduciendo: false, grabacion: 'inactiva', loop: { activo: false }, posicion: { segundos: 0 } },
  } as unknown as DAWState
}

describe('midi timeline context', () => {
  it('incluye inicio/duración/fin y flags de duplicados/fuera', () => {
    const text = formatMidiTimelineForPrompt(miniState())
    expect(text).toMatch(/72 BPM/)
    expect(text).toMatch(/inicio=0\.000b/)
    expect(text).toMatch(/dur=8\.000b/)
    expect(text).toMatch(/fin=8\.000b/)
    expect(text).toMatch(/duplicados/)
    expect(text).toMatch(/fuera del clip/)
    expect(text).toMatch(/Bajo/)
  })

  it('buildReadOnlyProjectContext incluye timeline y criterio', () => {
    const ctx = buildReadOnlyProjectContext(miniState())
    expect(ctx).toMatch(/Timeline MIDI/)
    expect(ctx).toMatch(/Criterio de productor/)
    expect(ctx).toMatch(/inicio=0\.000b/)
  })

  it('buildMidiAuditReport lista duplicados y notas fuera', () => {
    const report = buildMidiAuditReport(miniState())
    expect(report).toMatch(/Auditoría MIDI/)
    expect(report).toMatch(/duplicad/i)
    expect(report).toMatch(/fuera/i)
    expect(isGarbageAssistantReply('¡¡¡¡¡¡¡¡¡¡¡¡¡¡¡')).toBe(true)
    expect(isGarbageAssistantReply(report)).toBe(false)
  })

  it('buildMidiAuditFixActions y clarifications para duplicados', () => {
    const fixes = buildMidiAuditFixActions(miniState())
    expect(fixes.length).toBeGreaterThanOrEqual(1)
    expect(fixes[0]?.type).toBe('midi.notes.dedupe')
    expect(fixes[0]?.payload.pistaId).toBeTruthy()
    expect(fixes[0]?.payload.clipId).toBeTruthy()
    const qs = buildMidiAuditClarifications(miniState())
    expect(qs).toHaveLength(1)
    expect(qs[0]?.id).toBe('midi_audit_fix')
    expect(qs[0]?.options.length).toBeGreaterThanOrEqual(2)
  })
})
