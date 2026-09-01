import { useMemo, useState } from 'react'
import { MessageCircleQuestion, Send } from 'lucide-react'
import type { ClarificationAnswer, ClarificationQuestion } from '@/src/lib/ai-clarify'
import { cn } from '@/lib/utils'

type Props = {
  questions: ClarificationQuestion[]
  status?: 'pending' | 'answered' | 'skipped'
  onSubmit: (answers: ClarificationAnswer[], formCustom?: string) => void
  onSkip?: () => void
}

type PickState = { indexes: number[]; custom: string }

/**
 * Preguntas como botones (una) o checkboxes (varias) + campo libre al pie del form.
 */
export function ClarificationCard({ questions, status = 'pending', onSubmit, onSkip }: Props) {
  const [picked, setPicked] = useState<Record<string, PickState>>(() => {
    const init: Record<string, PickState> = {}
    for (const q of questions) init[q.id] = { indexes: [], custom: '' }
    return init
  })
  const [formCustom, setFormCustom] = useState('')
  const [done, setDone] = useState(status !== 'pending')

  const canSend = useMemo(() => {
    if (formCustom.trim()) return true
    return questions.every((q) => {
      const p = picked[q.id]
      if (!p) return false
      if (p.indexes.length > 0) return true
      if (q.allowCustom !== false && p.custom.trim()) return true
      return false
    })
  }, [picked, questions, formCustom])

  const toggleOption = (q: ClarificationQuestion, index: number) => {
    setPicked((prev) => {
      const cur = prev[q.id] ?? { indexes: [], custom: '' }
      if (q.multi) {
        const set = new Set(cur.indexes)
        if (set.has(index)) set.delete(index)
        else set.add(index)
        return {
          ...prev,
          [q.id]: { indexes: [...set].sort((a, b) => a - b), custom: '' },
        }
      }
      return {
        ...prev,
        [q.id]: { indexes: [index], custom: '' },
      }
    })
  }

  if (!questions.length) return null

  if (done) {
    return (
      <div className="mt-2 rounded-md border border-border/70 bg-panel-raised/40 px-2.5 py-2 text-[11px] text-muted-foreground">
        Respuestas enviadas — la IA continúa con tu criterio.
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-accent-amber/40 bg-panel-raised/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
        <MessageCircleQuestion className="size-3.5 text-accent-amber" />
        Elige una opción por pregunta
        <span className="font-normal text-muted-foreground">
          (multi = varias · luego Continuar)
        </span>
      </div>

      {questions.map((q) => {
        const p = picked[q.id] ?? { indexes: [], custom: '' }
        return (
          <div key={q.id} className="space-y-1.5">
            <p className="text-[12px] font-medium text-foreground">
              {q.question}
              {q.multi ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                  · selección múltiple
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt, i) => {
                const on = p.indexes.includes(i)
                return (
                  <button
                    key={`${q.id}-${i}`}
                    type="button"
                    onClick={() => toggleOption(q, i)}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-left text-[11px] transition-colors ring-1',
                      on
                        ? 'bg-accent-amber text-background ring-accent-amber'
                        : 'bg-background/60 text-foreground ring-border hover:bg-background hover:ring-accent-amber/50',
                    )}
                  >
                    {q.multi ? (
                      <span className="mr-1.5 inline-block w-3 font-mono text-[10px] opacity-80">
                        {on ? '☑' : '☐'}
                      </span>
                    ) : null}
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}

      <div className="border-t border-border/50 pt-2">
        <label className="text-[10px] text-muted-foreground">
          Si ninguna opción encaja, escribe aquí tu respuesta
        </label>
        <textarea
          value={formCustom}
          rows={2}
          placeholder="Respuesta personalizada (se envía al modelo junto con lo que seleccionaste)…"
          className="mt-0.5 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber/60"
          onChange={(e) => setFormCustom(e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-0.5">
        {onSkip ? (
          <button
            type="button"
            onClick={() => {
              setDone(true)
              onSkip()
            }}
            className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Usar defaults
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canSend}
          onClick={() => {
            const answers: ClarificationAnswer[] = questions.map((q) => {
              const p = picked[q.id]!
              if (p.indexes.length) {
                const value = p.indexes.map((i) => q.options[i]).filter(Boolean).join(', ')
                return { id: q.id, optionIndexes: p.indexes, value }
              }
              if (p.custom.trim()) {
                return { id: q.id, optionIndexes: [], value: p.custom.trim() }
              }
              // Cubierto por formCustom global
              return {
                id: q.id,
                optionIndexes: [],
                value: formCustom.trim() || '(sin preferencia — usa criterio de la IA)',
              }
            })
            setDone(true)
            onSubmit(answers, formCustom.trim() || undefined)
          }}
          className="inline-flex items-center gap-1 rounded-md bg-accent-amber px-2.5 py-1.5 text-[11px] font-semibold text-background disabled:opacity-40"
        >
          <Send className="size-3" />
          Enviar respuestas
        </button>
      </div>
    </div>
  )
}
