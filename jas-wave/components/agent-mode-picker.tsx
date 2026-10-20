import { AGENT_MODE_META, saveAgentMode, type AgentMode } from '@/src/lib/ai-modes'

type Props = {
  value: AgentMode
  onChange: (mode: AgentMode) => void
}

const MODE_TABLE = [
  'Modo del coproducer (atajo: Ctrl+Shift+M para alternar)',
  '',
  '· Consulta — responde con evidencia; no muta el DAW',
  '· Pensar — diagnóstico y propuesta de arreglo; no escribe ni muta',
  '· Plan — escribe el plan estructurado en plan.md; no muta',
  '· Crear — planifica y ejecuta hasta terminar (pide aprobación una vez)',
  '· Auto — como Crear, pero el plan se aprueba solo',
].join('\n')

export function AgentModePicker({ value, onChange }: Props) {
  const selectClass =
    'max-w-[7.5rem] truncate rounded-md border border-border bg-panel-raised px-1.5 py-1 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber'

  return (
    <select
      className={selectClass}
      value={value}
      title={MODE_TABLE}
      aria-label="Modo del coproducer (Ctrl+Shift+M alterna)"
      data-agent-mode-picker
      onChange={(e) => {
        const m = e.target.value as AgentMode
        onChange(m)
        saveAgentMode(m)
      }}
    >
      <option value="auto" title="Decide según el pedido; aprueba el plan solo">
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
