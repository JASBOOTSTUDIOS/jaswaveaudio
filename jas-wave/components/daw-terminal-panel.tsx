import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, Columns2, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { DAW_CLI_HELP_SECTIONS, formatTermCwd, runDawCliLine } from '@/src/lib/daw-cli-inapp'
import { getActiveConversationId } from '@/src/lib/ai-chat-store'
import {
  appendTerminalLine,
  clearTerminalSession,
  createTerminalSession,
  focusTerminalPane,
  getTerminalState,
  killFocusedTerminal,
  pushTerminalHistory,
  selectTerminalSession,
  setTerminalCwd,
  splitTerminal,
  subscribeTerminalSessions,
  unsplitTerminal,
  type TerminalSession,
} from '@/src/lib/daw-terminal-sessions'
import { cn } from '@/lib/utils'

const FONT =
  "12.5px/1.5 Consolas, 'Cascadia Mono', 'Cascadia Code', 'Courier New', ui-monospace, monospace"

function useTerminalState() {
  return useSyncExternalStore(subscribeTerminalSessions, getTerminalState, getTerminalState)
}

function PromptMark({ cwd }: { cwd?: string[] }) {
  return (
    <>
      <span className="text-[#569cd6]">jaswave</span>
      <span className="text-[#ce9178]"> {formatTermCwd(cwd)}</span>
      <span className="text-[#cccccc]">{'>'}</span>
    </>
  )
}

function HelpBlock() {
  return (
    <div className="my-1 select-text">
      {DAW_CLI_HELP_SECTIONS.map((sec) => (
        <div key={sec.title} className="mb-2">
          <div className="text-[#569cd6]">{sec.title}</div>
          <div className="grid grid-cols-[minmax(11rem,max-content)_1fr] gap-x-4 gap-y-0.5">
            {sec.rows.map((r) => (
              <div key={r.cmds} className="contents">
                <span className="text-[#9cdcfe]">{r.cmds}</span>
                <span className="text-[#6a9955]">{r.desc}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="text-[#808080]">
        Carpetas: <span className="text-[#9cdcfe]">/</span>
        {'  '}
        <span className="text-[#9cdcfe]">/pistas</span>
        {'  '}
        <span className="text-[#9cdcfe]">/transporte</span>
        {'  '}
        <span className="text-[#9cdcfe]">/mixer</span>
      </div>
    </div>
  )
}

function AgentLine({ text }: { text: string }) {
  const [tool, status, detail] = text.split('\t')
  const fail = status === 'fail'
  const running = status === '…'
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <span className="shrink-0 text-[#808080]">{'>'}</span>
      <span className="min-w-0 flex-1 truncate text-[#9cdcfe]">
        {tool}
        {detail ? <span className="text-[#808080]">  {detail}</span> : null}
      </span>
      <span
        className={
          fail ? 'shrink-0 text-[#f48771]' : running ? 'shrink-0 text-[#dcdcaa]' : 'shrink-0 text-[#6a9955]'
        }
      >
        {status}
      </span>
    </div>
  )
}

function OutLines({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((row, i) => (
        <div
          key={i}
          className={row.endsWith('/') ? 'text-[#569cd6]' : 'text-[#cccccc]'}
        >
          {row || '\u00a0'}
        </div>
      ))}
    </>
  )
}

function SessionPane({
  session,
  focused,
  onFocus,
}: {
  session: TerminalSession
  focused: boolean
  onFocus: () => void
}) {
  const tienda = useDAW()
  const [cmd, setCmd] = useState('')
  const [busy, setBusy] = useState(false)
  const [histIdx, setHistIdx] = useState(-1)
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [session.lines.length])

  useEffect(() => {
    if (focused) inputRef.current?.focus()
  }, [focused, session.id])

  const run = useCallback(async () => {
    const line = cmd.trim()
    if (!line || busy) return
    setBusy(true)
    pushTerminalHistory(session.id, line)
    setCmd('')
    setHistIdx(-1)
    const conversationId = getActiveConversationId() ?? 'terminal'
    try {
      const r = await runDawCliLine(tienda, line, {
        conversationId,
        messageId: session.id,
        cwd: session.cwd ?? [],
        history: session.history,
      })
      if (r.clear) {
        clearTerminalSession(session.id)
        return
      }
      appendTerminalLine(session.id, 'in', line)
      if (r.cwd) setTerminalCwd(session.id, r.cwd)
      if (r.title === 'help') {
        appendTerminalLine(session.id, 'help', '')
      } else if (r.body) {
        appendTerminalLine(session.id, r.ok ? 'out' : 'err', r.body)
      }
    } catch (e) {
      appendTerminalLine(session.id, 'in', line)
      appendTerminalLine(session.id, 'err', e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, cmd, session.id, tienda])

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      clearTerminalSession(session.id)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!session.history.length) return
      const next = histIdx < 0 ? session.history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(next)
      setCmd(session.history[next] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < 0) return
      const next = histIdx + 1
      if (next >= session.history.length) {
        setHistIdx(-1)
        setCmd('')
        return
      }
      setHistIdx(next)
      setCmd(session.history[next] ?? '')
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      void run()
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#1e1e1e]" onMouseDown={onFocus}>
      <div
        ref={scroller}
        className="jw-term-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[#cccccc]"
        style={{ font: FONT }}
      >
        {session.lines.map((ln) => (
          <div key={ln.id} className="min-w-0">
            {ln.kind === 'in' ? (
              <div>
                <PromptMark cwd={session.cwd} />
                <span className="pl-1 text-[#cccccc]">{ln.text}</span>
              </div>
            ) : ln.kind === 'help' ? (
              <HelpBlock />
            ) : ln.kind === 'agent' ? (
              <AgentLine text={ln.text} />
            ) : ln.kind === 'err' ? (
              <div className="whitespace-pre-wrap break-words text-[#f48771]">{ln.text}</div>
            ) : ln.kind === 'sys' ? (
              <div className="text-[#6a9955]">{ln.text}</div>
            ) : (
              <OutLines text={ln.text} />
            )}
          </div>
        ))}
        <div className="flex items-center">
          <PromptMark cwd={session.cwd} />
          <input
            ref={inputRef}
            value={cmd}
            onChange={(e) => {
              setCmd(e.target.value)
              setHistIdx(-1)
            }}
            onKeyDown={onKeyDown}
            disabled={busy}
            className="min-w-0 flex-1 bg-transparent pl-1 text-[#cccccc] outline-none caret-[#cccccc]"
            style={{ font: FONT }}
            spellCheck={false}
            autoComplete="off"
            aria-label={`Comando ${session.name}`}
          />
        </div>
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex size-6 items-center justify-center rounded-sm text-[#cccccc]/70 hover:bg-white/10 hover:text-[#cccccc]',
        active && 'bg-white/10 text-[#cccccc]',
      )}
    >
      {children}
    </button>
  )
}

/** Terminal estilo VS Code: varias sesiones, split y kill. */
export function DawTerminalPanel() {
  const snap = useTerminalState()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const focusedId = snap.panes[snap.focusedPane] ?? snap.panes[0]
  const focused = snap.sessions.find((s) => s.id === focusedId)

  useEffect(() => {
    const focus = () => {
      focusTerminalPane(snap.focusedPane)
    }
    window.addEventListener('jaswave-focus-terminal', focus)
    return () => window.removeEventListener('jaswave-focus-terminal', focus)
  }, [snap.focusedPane])

  useEffect(() => {
    if (!pickerOpen && !newOpen) return
    const onDown = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) {
        setPickerOpen(false)
        setNewOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen, newOpen])

  return (
    <section
      data-shortcut-scope="ignore"
      className="flex h-full min-h-0 flex-col bg-[#1e1e1e]"
      aria-label="Terminal"
    >
      <div
        ref={pickerRef}
        className="flex h-7 shrink-0 items-center justify-end gap-0.5 px-1"
      >
        <div className="relative min-w-0">
          <button
            type="button"
            title="Seleccionar terminal"
            onClick={() => {
              setPickerOpen((o) => !o)
              setNewOpen(false)
            }}
            className="flex max-w-[14rem] items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-[11px] text-[#cccccc]/85 hover:bg-white/10"
          >
            <SquareTerminal className="size-3 shrink-0 opacity-70" />
            <span className="min-w-0 truncate">{focused?.name ?? 'Terminal'}</span>
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </button>
          {pickerOpen ? (
            <div className="absolute right-0 top-full z-50 mt-0.5 min-w-[12rem] border border-[#3c3c3c] bg-[#252526] py-1 shadow-lg">
              {snap.sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    selectTerminalSession(s.id)
                    setPickerOpen(false)
                  }}
                  className={cn(
                    'flex w-full px-3 py-1 text-left text-[12px] hover:bg-[#04395e]',
                    s.id === focusedId ? 'text-white' : 'text-[#cccccc]',
                  )}
                >
                  {s.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <IconBtn title="Nueva terminal" onClick={() => createTerminalSession(true)}>
          <Plus className="size-3.5" />
        </IconBtn>
        <div className="relative">
          <IconBtn
            title="Nueva terminal…"
            onClick={() => {
              setNewOpen((o) => !o)
              setPickerOpen(false)
            }}
          >
            <ChevronDown className="size-3" />
          </IconBtn>
          {newOpen ? (
            <div className="absolute right-0 top-full z-50 mt-0.5 min-w-[11rem] border border-[#3c3c3c] bg-[#252526] py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  createTerminalSession(true)
                  setNewOpen(false)
                }}
                className="flex w-full px-3 py-1 text-left text-[12px] text-[#cccccc] hover:bg-[#04395e]"
              >
                JasWave CLI
              </button>
            </div>
          ) : null}
        </div>
        <IconBtn
          title={snap.panes.length > 1 ? 'Quitar split' : 'Dividir terminal'}
          active={snap.panes.length > 1}
          onClick={() => {
            if (snap.panes.length > 1) unsplitTerminal()
            else splitTerminal()
          }}
        >
          <Columns2 className="size-3.5" />
        </IconBtn>
        <IconBtn title="Cerrar terminal" onClick={() => killFocusedTerminal()}>
          <Trash2 className="size-3.5" />
        </IconBtn>
      </div>
      <div className="flex min-h-0 flex-1">
        {snap.panes.map((id, i) => {
          const session = snap.sessions.find((s) => s.id === id)
          if (!session) return null
          return (
            <div
              key={`${id}-${i}`}
              className={cn('flex min-h-0 min-w-0 flex-1', i > 0 && 'border-l border-[#3c3c3c]')}
            >
              <SessionPane
                session={session}
                focused={snap.focusedPane === i}
                onFocus={() => focusTerminalPane(i === 1 ? 1 : 0)}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
