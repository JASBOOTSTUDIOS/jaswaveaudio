import type { HarnessDawAction } from '../types/actions'
import { normalizeToolArgs } from '../compatibility/legacy-actions-adapter'

const ACTIONS_RE = /<<<ACTIONS\s*([\s\S]*?)\s*ACTIONS>>>/gi

export function stripActionsBlock(text: string): string {
  return text
    .replace(ACTIONS_RE, '')
    .replace(/<<<DOC[\s\S]*?DOC>>>/gi, '')
    .replace(/<<<DECISION[\s\S]*?DECISION>>>/gi, '')
    .replace(/<<<DOC[\s\S]*$/gi, '')
    .replace(/<<<PLAN[\s\S]*PLAN>>>/gi, '')
    .replace(/<<<ACTIONS[\s\S]*$/gi, '')
    .replace(/<<<PLAN[\s\S]*$/gi, '')
    .replace(/Escribe solo el pensamiento de ESTA capa[^\n]*/gi, '')
    .replace(/<<<READY_FOR_GAP_REPORT>>>/gi, '')
    .replace(/##\s*Cambios en el proyecto[\s\S]*$/gi, '')
    .replace(/^\s*\[?\s*\{\s*"type"\s*:[\s\S]*$/gm, '')
    .replace(/\bdaw\.generateMidiSong\s*\([^)]*\)\s*;?/gi, '')
    .replace(/\b(?:track|midi|plugin|transport|ui|project)\.\w+\s*\([^)]*\)\s*;?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseActionsFromText(text: string): HarnessDawAction[] {
  const match = /<<<ACTIONS\s*([\s\S]*?)\s*ACTIONS>>>/i.exec(text)
  if (!match) return []
  try {
    let raw = match[1]!.trim()
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (a): a is Record<string, unknown> =>
          !!a && typeof a === 'object' && typeof (a as { type?: unknown }).type === 'string',
      )
      .map((a) => ({
        type: String(a.type),
        payload: normalizeToolArgs(a),
      }))
  } catch {
    return []
  }
}
