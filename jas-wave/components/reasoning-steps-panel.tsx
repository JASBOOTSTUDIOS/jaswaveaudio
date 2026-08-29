import { useState } from 'react'
import { Brain } from 'lucide-react'
import { ChatMarkdown } from './chat-markdown'
import type { StoredChatMessage } from '@/src/lib/ai-chat-store'
import { cn } from '@/lib/utils'

type Props = {
  steps: NonNullable<StoredChatMessage['reasoningSteps']>
  /** Expandido mientras el turno está en curso */
  defaultOpen?: boolean
}

export function ReasoningStepsPanel({ steps, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const [stepOpen, setStepOpen] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {}
    steps.forEach((s, i) => {
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
        Razonamiento ({steps.length} pasos)
        <span className="ml-auto select-none text-[9px]">{open ? '▾' : '▸'}</span>
      </div>
      {open ? (
        <div className="max-h-64 space-y-1 overflow-y-auto border-t border-violet-900/30 px-2 py-1.5 select-text">
          {steps.map((step, i) => (
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
                    {step.toolsUsed.join(', ')}
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
          ))}
        </div>
      ) : null}
    </div>
  )
}
