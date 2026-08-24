import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Command, ArrowRight } from 'lucide-react'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { DAWState } from '../../shared/src'
import { getActionSystemFromWindow } from '@/hooks/use-shortcut-dispatcher'

interface PaletteCommand {
  id: string
  label: string
  category: string
  shortcut?: string
  description?: string
  execute: () => unknown
  input?: { label: string; defaultValue: string; apply: (value: string) => void }
}

export function CommandPalette() {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pendingInput, setPendingInput] = useState<{ label: string; defaultValue: string; apply: (v: string) => void } | null>(null)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tienda = useDAW()
  const open = useDAWState((s: DAWState) => s.ui?.paletaComandosAbierta ?? false)

  const setOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof value === 'function' ? value(open) : value
      void tienda.executor.execute('ui.setPalette', { abierta: next })
    },
    [open, tienda],
  )

  // Preferir Action Registry; fallback mínimo si aún no está listo
  const commands: PaletteCommand[] = useMemo(() => {
    const system = getActionSystemFromWindow()
    if (system) {
      const defs = query.trim()
        ? system.actions.search(query, 40)
        : system.actions.list().slice(0, 40)
      return defs.map((def) => {
        const bindings = system.shortcuts.getBindingsForAction(def.id)
        return {
          id: def.id,
          label: def.name,
          category: def.category,
          description: def.description,
          shortcut: bindings[0]?.shortcut,
          execute: () => {
            system.actions.execute(def.id)
          },
        }
      })
    }

    return [
      {
        id: 'transport.togglePlay',
        label: 'Reproducir / Pausar',
        category: 'Transport',
        shortcut: 'Space',
        execute: () => tienda.executor.execute('transport.toggle', {}),
      },
      {
        id: 'window.keyboardShortcuts',
        label: 'Atajos de teclado',
        category: 'Window',
        execute: () => window.dispatchEvent(new CustomEvent('open-shortcuts-dialog')),
      },
    ]
  }, [query, tienda])


  const filtered = commands

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Keep selected visible
  useEffect(() => {
    if (listRef.current) {
      const item = listRef.current.children[selectedIndex] as HTMLElement
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const executeCommand = useCallback(
    async (cmd: PaletteCommand) => {
      if (cmd.input) {
        setPendingInput(cmd.input)
        setInputValue(cmd.input.defaultValue)
        setTimeout(() => inputRef.current?.focus(), 10)
        return
      }
      setOpen(false)
      await cmd.execute()
    },
    [setOpen],
  )

  // Listen for shortcut-triggered toggle
  useEffect(() => {
    const handler = () => setOpen((prev) => !prev)
    window.addEventListener('toggle-command-palette', handler)
    return () => window.removeEventListener('toggle-command-palette', handler)
  }, [])

  // Escape closes palette
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (pendingInput) {
          setPendingInput(null)
        } else {
          setOpen(false)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, pendingInput])

  // Keyboard navigation inside palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (pendingInput) {
      if (e.key === 'Enter') {
        e.preventDefault()
        pendingInput.apply(inputValue)
        setPendingInput(null)
        setOpen(false)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setPendingInput(null)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault()
      executeCommand(filtered[selectedIndex])
    }
  }

  if (!open) return null

  return (
    <div
      data-command-palette
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Command className="size-4 shrink-0 text-accent-amber" />
          {pendingInput ? (
            <>
              <span className="shrink-0 text-[13px] text-muted-foreground">{pendingInput.label}</span>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                spellCheck={false}
                autoFocus
              />
              <kbd className="rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ↵
              </kbd>
            </>
          ) : (
            <>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                onKeyDown={handleKeyDown}
                placeholder="Escribe un comando…"
                className="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
                spellCheck={false}
              />
              <kbd className="rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                esc
              </kbd>
            </>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              No se encontraron comandos
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors ${
                  i === selectedIndex
                    ? 'bg-accent-amber/15 text-foreground'
                    : 'text-foreground hover:bg-panel-raised'
                }`}
              >
                <span className="flex-1 truncate font-medium">{cmd.label}</span>
                <span className="shrink-0 rounded bg-panel-raised px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {cmd.category}
                </span>
                {cmd.shortcut && (
                  <kbd className="shrink-0 rounded border border-border bg-panel-raised px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {cmd.shortcut}
                  </kbd>
                )}
                {i === selectedIndex && (
                  <ArrowRight className="size-3.5 shrink-0 text-accent-amber" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span>
            ↑↓ navegar · ↵ ejecutar · esc cerrar
          </span>
          <span className="text-accent-amber font-medium">
            {filtered.length} comando{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
