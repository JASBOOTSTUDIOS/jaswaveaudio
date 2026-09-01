import { useState } from 'react'
import { Brain } from 'lucide-react'
import { ChatMarkdown, sanitizeAssistantMarkdown } from './chat-markdown'
import type { StoredChatMessage } from '@/src/lib/ai-chat-store'
import { cn } from '@/lib/utils'

type Step = NonNullable<StoredChatMessage['reasoningSteps']>[number]

type Props = {
  steps: NonNullable<StoredChatMessage['reasoningSteps']>
  /** Expandido mientras el turno está en curso */
  defaultOpen?: boolean
}

function isEmptyStep(step: Step): boolean {
  const c = sanitizeAssistantMarkdown(step.content ?? '').trim()
  if (!c) return true
  if (/^\(sin respuesta del modelo\)$/i.test(c)) return true
  if (/^\*{0,3}$/.test(c)) return true
  if (/^(I understand\.?\s*)?Let'?s begin\.?$/i.test(c)) return true
  return false
}

export function ReasoningStepsPanel({ steps, defaultOpen = false }: Props) {
  const useful = steps.filter((s) => !isEmptyStep(s))
  const skipped = steps.length - useful.length
  const [open, setOpen] = useState(defaultOpen)
  const [stepOpen, setStepOpen] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {}
    useful.forEach((s, i) => {
      init[i] = defaultOpen ? true : !s.collapsed
    })
    return init
  })

  if (!steps.length) return null

  return (
    <div
      data-chat-selectable
      className="mb-2 select-text rounded-md border border-violet-900/40 bg-violet-950/20"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((o) => !o)
          }
        }}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-violet-300/90 hover:text-violet-200"
      >
        <Brain className="size-3 shrink-0 select-none" />
        Pensamiento interno
        {useful.length
          ? ` · ${useful.length} nota${useful.length === 1 ? '' : 's'}`
          : ' · (sin notas útiles)'}
        {skipped > 0 ? (
          <span className="font-normal normal-case text-violet-400/70"> · {skipped} omitido(s)</span>
        ) : null}
        <span className="ml-auto select-none text-[9px]">{open ? '▾' : '▸'}</span>
      </div>
      {open ? (
        <div className="max-h-48 space-y-1 overflow-y-auto border-t border-violet-900/30 px-2 py-1.5 select-text">
          <p className="px-1 pb-1 text-[10px] leading-snug text-violet-300/60">
            Borrador interno del asistente — la respuesta útil está debajo, en lenguaje de productor.
          </p>
          {useful.length === 0 ? (
            <p className="px-1 text-[11px] text-muted-foreground">
              Este turno no dejó notas internas legibles (fallos de red o capas vacías).
            </p>
          ) : (
            useful.map((step, i) => (
              <div
                key={`${step.phase}-${i}`}
                data-chat-selectable
                className="select-text rounded border border-violet-900/20 bg-black/20"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setStepOpen((prev) => ({ ...prev, [i]: !prev[i] }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setStepOpen((prev) => ({ ...prev, [i]: !prev[i] }))
                    }
                  }}
                  className="flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-left text-[10px] font-medium text-violet-200/90"
                >
                  <span className="truncate">{step.title}</span>
                  {step.toolsUsed?.length ? (
                    <span className="shrink-0 select-none rounded bg-violet-900/50 px-1 text-[8px] text-violet-300">
                      {step.toolsUsed.map((t) => (typeof t === 'string' ? t : t.type)).join(', ')}
                    </span>
                  ) : null}
                  <span className="ml-auto select-none text-[8px] text-muted-foreground">
                    {stepOpen[i] ? '▾' : '▸'}
                  </span>
                </div>
                {stepOpen[i] ? (
                  <div
                    className={cn(
                      'select-text border-t border-violet-900/15 px-2 py-1.5 text-[11px] text-muted-foreground',
                    )}
                  >
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
