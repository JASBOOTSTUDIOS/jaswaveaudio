import { useState } from 'react'
import { Piano, Sparkles, Volume2 } from 'lucide-react'
import { audioEngine } from '@/lib/audio-engine'
import { requestOpenTool } from '@/src/workspace/types'

const WHITE = [60, 62, 64, 65, 67, 69, 71, 72] // C4–C5
const BLACK = [
  { pitch: 61, left: 28 },
  { pitch: 63, left: 60 },
  { pitch: 66, left: 124 },
  { pitch: 68, left: 156 },
  { pitch: 70, left: 188 },
]

function noteLabel(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

/**
 * Panel de instrumentos: incluye JasWave Soft Pad (synth de prueba MIDI).
 */
export function InstrumentsPanel() {
  const [held, setHeld] = useState<number | null>(null)
  const [gain, setGain] = useState(0.35)

  const down = (pitch: number) => {
    setHeld(pitch)
    audioEngine.noteOn(pitch, 100)
  }
  const up = (pitch: number) => {
    setHeld(null)
    audioEngine.noteOff(pitch)
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Piano className="size-4 text-accent-amber" />
        <span className="text-[12px] font-semibold text-foreground">Instrumentos</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="rounded-lg border border-border bg-panel-raised/50 p-3">
          <div className="mb-2 flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 text-accent-amber" />
            <div>
              <div className="text-[13px] font-semibold text-foreground">JasWave Soft Pad</div>
              <p className="text-[11px] text-muted-foreground">
                Sintetizador de prueba (triangle + filtro). Ideal para audicionar el piano roll y
                notas MIDI.
              </p>
            </div>
          </div>

          <label className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Volume2 className="size-3" />
            Nivel
            <input
              type="range"
              min={0.05}
              max={0.8}
              step={0.01}
              value={gain}
              onChange={(e) => {
                const v = Number(e.target.value)
                setGain(v)
                audioEngine.setSynthGain(v)
              }}
              className="flex-1"
            />
          </label>

          <div className="relative mx-auto h-28 w-[256px] select-none">
            <div className="absolute inset-x-0 bottom-0 flex h-full">
              {WHITE.map((pitch) => (
                <button
                  key={pitch}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                    down(pitch)
                  }}
                  onPointerUp={() => up(pitch)}
                  onPointerCancel={() => up(pitch)}
                  className={`relative flex-1 rounded-b border border-border ${
                    held === pitch ? 'bg-accent-amber/50' : 'bg-background hover:bg-panel'
                  }`}
                  title={noteLabel(pitch)}
                >
                  <span className="absolute bottom-1 left-0 right-0 text-center font-mono text-[8px] text-muted-foreground">
                    {pitch % 12 === 0 ? noteLabel(pitch) : ''}
                  </span>
                </button>
              ))}
            </div>
            {BLACK.map(({ pitch, left }) => (
              <button
                key={pitch}
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                  down(pitch)
                }}
                onPointerUp={() => up(pitch)}
                onPointerCancel={() => up(pitch)}
                className={`absolute top-0 z-10 h-16 w-6 -translate-x-1/2 rounded-b ${
                  held === pitch ? 'bg-accent-amber' : 'bg-zinc-800 hover:bg-zinc-700'
                }`}
                style={{ left }}
                title={noteLabel(pitch)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => requestOpenTool('piano-roll', { zone: 'bottom' })}
            className="mt-3 w-full rounded-md bg-accent-amber/15 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/25"
          >
            Abrir piano roll
          </button>
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
          Asigna Soft Pad a una pista desde el Inspector → pestaña Plugins. El piano roll y este
          teclado usan el mismo motor MIDI de preview.
        </p>
      </div>
    </div>
  )
}
