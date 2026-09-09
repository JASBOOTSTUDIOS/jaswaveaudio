import type { AgentTurnContext } from '../context/agent-context'
import { formatAgentContextForPrompt } from '../context/compose-agent-context'
import { agentBasePrompt } from './base-prompt'
import { agentMusicPolicyPrompt } from './music-policy'

export type ComposeAgentPromptInput = {
  context: AgentTurnContext
  modeBlock: string
  toolsFragment?: string
  base?: string
  musicPolicy?: string
}

export function composeAgentPrompt(input: ComposeAgentPromptInput): string {
  return [
    formatAgentContextForPrompt(input.context),
    '',
    input.modeBlock,
    '',
    input.base ?? agentBasePrompt(),
    '',
    input.musicPolicy ?? agentMusicPolicyPrompt(),
    '',
    input.toolsFragment
      ? `## Herramientas (Tool Registry)\nUsa solo estos type en <<<ACTIONS>>>.\n${input.toolsFragment}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
