/**
 * Bloque de volumen de una tira de canal (mixer e inspector): recorrido de fader de alto fijo (160 px) con
 * escala en dB, VU estéreo L/R, lectura digital de la ganancia y pico retenido con indicador de clip.
 * Su alto no depende del contenido de la tira: los FX o envíos nunca empujan ni aplastan el fader.
 */
import { formatearDb } from '@/lib/audio-conversions'
import { FADER_ALTO_PX, FaderControl, PeakBadge, usePeakHold } from './controls'

export function ChannelFaderBlock({
  db,
  color,
  onChange,
  stereo,
  defaultValue = 0,
  testId,
  estrecho = false,
}: {
  db: number
  color: string
  onChange: (db: number, gestureId?: string) => void
  /** Picos L/R lineales (0..1) post-fader. */
  stereo: { l: number; r: number }
  defaultValue?: number
  testId?: string
  /** Tira estrecha (mixer colapsado): ganancia y pico apilados en vez de en fila. */
  estrecho?: boolean
}) {
  const { pico, clip, reset } = usePeakHold(stereo.l, stereo.r)
  return (
    <div className="flex shrink-0 flex-col items-stretch gap-1">
      <div className="flex justify-center" style={{ height: FADER_ALTO_PX }} data-testid={testId}>
        <div className="flex h-full w-[52px] justify-center">
          <FaderControl
            db={db}
            color={color}
            onChange={onChange}
            stereo={stereo}
            defaultValue={defaultValue}
            showScale
          />
        </div>
      </div>
      <div className={`flex items-center justify-center gap-1 ${estrecho ? 'flex-col' : ''}`}>
        <span
          className="h-4 w-9 shrink-0 rounded-sm bg-background/60 text-center font-mono text-[9px] leading-4 tabular-nums text-foreground ring-1 ring-border"
          title="Ganancia del fader (dB)"
        >
          {formatearDb(db)}
        </span>
        <PeakBadge pico={pico} clip={clip} onReset={reset} />
      </div>
    </div>
  )
}
