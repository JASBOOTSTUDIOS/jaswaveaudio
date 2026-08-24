/**
 * Asignar / quitar un dispositivo de entrada de audio en una pista.
 */

import { useEffect, useState } from 'react'
import { useDAW } from '@/src/context/daw-context'
import {
  listAudioInputs,
  refreshAudioInputs,
  subscribeAudioInputs,
} from '@/src/lib/audio-inputs'

export function TrackAudioInput({
  trackId,
  assignedId,
  compact = false,
}: {
  trackId: string
  assignedId?: string
  compact?: boolean
}) {
  const tienda = useDAW()
  const [devices, setDevices] = useState(() => listAudioInputs())

  useEffect(() => subscribeAudioInputs(() => setDevices(listAudioInputs())), [])

  useEffect(() => {
    // Solo enumerateDevices: no pedir getUserMedia al montar el mixer
    // (abre la UMC en WASAPI y choca con ASIO → se oye la entrada con monitor OFF).
    void refreshAudioInputs()
  }, [])

  const value = assignedId?.trim() || ''

  return (
    <select
      aria-label="Dispositivo de entrada de audio"
      title="Entrada de audio (asignar / quitar)"
      value={value}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const id = e.target.value
        void tienda.executor.execute('track.update', {
          trackId,
          datos: { dispositivoEntrada: id || '', entrada: id || undefined },
        })
      }}
      className={`w-full truncate rounded border border-border bg-background text-foreground ${
        compact ? 'h-[16px] px-0.5 text-[8px]' : 'h-6 px-1 text-[10px]'
      }`}
    >
      <option value="">Audio: predeterminado</option>
      {value && !devices.some((d) => d.id === value) ? <option value={value}>{value}</option> : null}
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  )
}
