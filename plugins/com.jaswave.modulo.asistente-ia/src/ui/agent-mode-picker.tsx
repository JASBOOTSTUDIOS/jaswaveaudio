
import { AGENT_MODE_META, saveAgentMode } from '@jaswave/host-sdk'
import type { AgentMode } from '@jaswave/host-sdk'

type Props = {
  value: AgentMode
  onChange: (mode: AgentMode) => void
}

const MODE_TABLE = [
  'Cómo trabaja el asistente (Ctrl+Shift+M para cambiar)',
  '',
  'Consulta: responde a tus preguntas sin cambiar nada del proyecto.',
  'Pensar: analiza y te propone ideas, sin cambiar nada.',
  'Plan: escribe el plan de trabajo, sin cambiar la música.',
  'Crear: planifica y hace los cambios (te pide permiso una vez).',
  'Auto: como Crear, pero sin pedir permiso para el plan.',
].join('\n')

export function AgentModePicker({ value, onChange }: Props) {
  const selectClass =
    'max-w-[7.5rem] truncate rounded-md border border-border bg-panel-raised px-1.5 py-1 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber'

  return (
    <select
      className={selectClass}
      value={value}
      title={MODE_TABLE}
      aria-label="Cómo trabaja el asistente (Ctrl+Shift+M para cambiar)"
      data-agent-mode-picker
      onChange={(e) => {
        const m = e.target.value as AgentMode
        onChange(m)
        saveAgentMode(m)
      }}
    >
      <option value="auto" title="Decide según lo que pidas y no te pide permiso para el plan">
        Auto
      </option>
      {(Object.keys(AGENT_MODE_META) as Exclude<AgentMode, 'auto'>[]).map((id) => (
        <option key={id} value={id} title={AGENT_MODE_META[id].hint}>
          {AGENT_MODE_META[id].label}
        </option>
      ))}
    </select>
  )
}
