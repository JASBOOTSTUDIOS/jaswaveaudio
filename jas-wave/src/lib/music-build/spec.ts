import {
  inferClipNameFromText,
  inferKeyFromText,
  inferMinutesFromText,
  inferProgressionFromText,
  parseMidiBriefFromText,
} from '../midi-song-generator'
import { draftArrangement } from '../plugin-knowledge'
import { pluginRegistry } from '../plugin/registry'
import type { MusicBuildSpec, MusicSection } from './types'

const DEFAULT_FORM: MusicSection[] = [
  { name: 'Intro', bars: 8 },
  { name: 'Verso', bars: 16 },
  { name: 'Estribillo', bars: 16 },
  { name: 'Verso 2', bars: 16 },
  { name: 'Estribillo 2', bars: 16 },
  { name: 'Puente', bars: 8 },
  { name: 'Final', bars: 8 },
]

function sectionsFromText(text: string, minutes: number, bpm: number): MusicSection[] {
  const t = text.toLowerCase()
  if (/intro|verso|coro|estribillo|puente|outro|pre-?coro/.test(t)) {
    const parts: MusicSection[] = []
    const push = (name: string, bars: number) => {
      if (!parts.some((p) => p.name === name)) parts.push({ name, bars })
    }
    if (/intro/.test(t)) push('Intro', 8)
    if (/verso|verse/.test(t)) push('Verso', 16)
    if (/pre-?coro|pre-?chorus/.test(t)) push('Pre-coro', 8)
    if (/estribillo|coro|chorus/.test(t)) push('Estribillo', 16)
    if (/puente|bridge/.test(t)) push('Puente', 8)
    if (/outro|final|coda/.test(t)) push('Outro', 8)
    if (parts.length >= 2) return parts
  }
  const totalBars = Math.max(16, Math.round((minutes * bpm) / 4))
  if (totalBars <= 32) {
    return [
      { name: 'Intro', bars: 4 },
      { name: 'Tema', bars: Math.max(8, totalBars - 8) },
      { name: 'Outro', bars: 4 },
    ]
  }
  return DEFAULT_FORM
}

export function specFromPrompt(prompt: string, bpmHint?: number): MusicBuildSpec {
  const brief = parseMidiBriefFromText(prompt, bpmHint ?? 120)
  const key = inferKeyFromText(prompt)
  const minutes = inferMinutesFromText(prompt, brief.minutes || 2)
  const bpmMatch = prompt.match(/\b(\d{2,3})\s*bpm\b/i)
  const bpm = bpmHint || brief.bpm || (bpmMatch ? Number(bpmMatch[1]) : 120)
  const drafts = draftArrangement(prompt, pluginRegistry.list())
  const degrees = inferProgressionFromText(prompt) ?? brief.degrees
  return {
    nombre: inferClipNameFromText(prompt, key.label),
    prompt,
    bpm,
    keyRoot: key.explicit ? key.root : brief.keyRoot,
    scale: key.explicit ? key.scale : brief.scale,
    keyLabel: key.explicit ? key.label : brief.keyLabel,
    minutes,
    degrees: degrees.length ? degrees : [1, 5, 6, 4],
    sections: sectionsFromText(prompt, minutes, bpm),
    tracks: drafts.map((d) => ({
      nombre: d.nombre,
      rol: d.rol,
      tipo: d.tipo,
      articulacion: d.articulacion,
      pluginNombre: d.pluginName,
      pluginId: d.pluginId,
    })),
  }
}
