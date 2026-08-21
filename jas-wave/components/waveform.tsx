import { makeWaveform } from '@/lib/daw-data'

type WaveformProps = {
  seed: number
  color: string
  bars?: number
  className?: string
}

export function Waveform({ seed, color, bars = 220, className }: WaveformProps) {
  const data = makeWaveform(seed, bars)
  return (
    <div
      className={`flex h-full w-full items-center gap-px overflow-hidden ${className ?? ''}`}
      aria-hidden="true"
    >
      {data.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${Math.max(6, h * 100)}%`,
            backgroundColor: color,
            opacity: 0.78,
          }}
        />
      ))}
    </div>
  )
}
