/**
 * Asignar / quitar un dispositivo MIDI en una pista.
 * Un canal = un dispositivo (o ninguno).
 */

import { useEffect, useState } from 'react'
import { useDAW } from '@/src/context/daw-context'
import { midiController } from '@/src/lib/midi-controller'

export function TrackMidiInput({
  trackId,
  assignedId,
  compact = false,
}: {
  trackId: string
  assignedId?: string
  compact?: boolean
}) {
  const tienda = useDAW()
  const [devices, setDevices] = useState(() => midiController.listInputs())

  useEffect(() => midiController.subscribeDevices(() => setDevices(midiController.listInputs())), [])

  const value = assignedId?.trim() || ''

  return (
    <select
      aria-label="Dispositivo MIDI de la pista"
      title="Dispositivo MIDI (asignar / quitar)"
      value={value}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const id = e.target.value
        void tienda.executor.execute('track.update', {
          trackId,
          datos: { entrada: id || undefined, recibirMidi: Boolean(id) },
        })
      }}
      className={`w-full truncate rounded border border-border bg-background text-foreground ${
        compact ? 'h-[16px] px-0.5 text-[8px]' : 'h-6 px-1 text-[10px]'
      }`}
    >
      <option value="">MIDI: ninguno</option>
      {value && !devices.some((d) => d.id === value) ? (
        <option value={value}>{value}</option>
      ) : null}
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  )
}
