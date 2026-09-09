import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { ChatMarkdown, sanitizeAssistantMarkdown } from './chat-markdown'
import type { StoredChatMessage } from '@/src/lib/ai-chat-store'
import { cn } from '@/lib/utils'

type Step = NonNullable<StoredChatMessage['reasoningSteps']>[number]

type Props = {
  steps: NonNullable<StoredChatMessage['reasoningSteps']>
  /** Expandido mientras el turno está en curso */
  live?: boolean
}

function isEmptyStep(step: Step): boolean {
  const c = sanitizeAssistantMarkdown(step.content ?? '').trim()
  if (!c) return true
  if (/^\(sin respuesta del modelo\)$/i.test(c)) return true
  if (/^\*{0,3}$/.test(c)) return true
  if (/^(I understand\.?\s*)?Let'?s begin\.?$/i.test(c)) return true
  return false
}

function thoughtLabel(steps: Step[], live: boolean): string {
  if (live) return 'Consejo dialogando…'
  const stamps = steps
    .flatMap((s) => [s.startedAt, s.endedAt])
    .filter((n): n is number => typeof n === 'number' && n > 0)
  if (stamps.length >= 2) {
    const sec = Math.max(1, Math.round((Math.max(...stamps) - Math.min(...stamps)) / 1000))
    if (sec < 3) return 'Consejo breve'
    return `Consejo · ${sec}s`
  }
  return 'Consejo de modelos'
}

export function ReasoningStepsPanel({ steps, live = false }: Props) {
  const useful = steps.filter((s) => !isEmptyStep(s))
  const [open, setOpen] = useState(live)
  const [stepOpen, setStepOpen] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {}
    useful.forEach((s, i) => {
      init[i] = live ? i === useful.length - 1 : false
    })
    return init
  })

  useEffect(() => {
    setOpen(live)
  }, [live])

  if (!steps.length) return null

  const label = thoughtLabel(steps, live)

  return (
    <div data-chat-selectable className="mb-2 w-full min-w-0 select-text">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-1 py-0.5 text-left text-[0.85em] text-muted-foreground/70 hover:text-muted-foreground"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open ? (
        <div className="mt-1 w-full min-w-0 space-y-0.5 overflow-x-hidden pl-4">
          {useful.length === 0 ? (
            <p className="text-[0.85em] leading-relaxed text-muted-foreground/60">
              Este turno no dejó notas internas legibles.
            </p>
          ) : (
            useful.map((step, i) => (
              <div key={`${step.phase}-${i}`} data-chat-selectable className="w-full min-w-0 select-text">
                <button
                  type="button"
                  aria-expanded={Boolean(stepOpen[i])}
                  onClick={() => setStepOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                  className="flex w-full min-w-0 items-center gap-1 py-0.5 text-left text-[0.85em] text-muted-foreground/80 hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      'size-3 shrink-0 transition-transform duration-150',
                      stepOpen[i] && 'rotate-90',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{step.title}</span>
                  {step.toolsUsed?.length ? (
                    <span className="min-w-0 max-w-[40%] shrink-0 truncate text-[0.8em] text-muted-foreground/50">
                      {step.toolsUsed.join(', ')}
                    </span>
                  ) : null}
                </button>
                {stepOpen[i] ? (
                  <div className="w-full min-w-0 overflow-x-hidden break-words py-1 pl-4 text-[0.85em] leading-relaxed text-muted-foreground">
                    <ChatMarkdown text={step.content} />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
