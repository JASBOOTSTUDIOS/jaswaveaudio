import { AGENT_MODE_META, saveAgentMode, type AgentMode } from '@/src/lib/ai-modes'

type Props = {
  value: AgentMode
  onChange: (mode: AgentMode) => void
}

const MODES: AgentMode[] = ['auto', 'ask', 'plan', 'create', 'think']

export function AgentModePicker({ value, onChange }: Props) {
  const selectClass =
    'max-w-[7.5rem] truncate rounded-md border border-border bg-panel-raised px-1.5 py-1 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber'

  return (
    <select
      className={selectClass}
      value={value}
      title="Modo del coproducer"
      onChange={(e) => {
        const m = e.target.value as AgentMode
        onChange(m)
        saveAgentMode(m)
      }}
    >
      <option value="auto">Auto</option>
      {(Object.keys(AGENT_MODE_META) as Exclude<AgentMode, 'auto'>[]).map((id) => (
        <option key={id} value={id} title={AGENT_MODE_META[id].hint}>
          {AGENT_MODE_META[id].label}
        </option>
      ))}
    </select>
  )
}
