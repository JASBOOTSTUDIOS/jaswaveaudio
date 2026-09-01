export type ProjectPlanTrack = {
  nombre: string
  rol: string
  tipo: 'midi' | 'instrumento' | 'audio'
  pluginNombre?: string
  pluginId?: string
  articulacion?: string
  noteMapSummary?: string
}

export type ProjectPlanData = {
  kind: 'projectPlan'
  nombre: string
  bpm: number
  keyLabel: string
  minutes: number
  pensamiento?: string
  tracks: ProjectPlanTrack[]
  status?: 'pending' | 'applied' | 'discarded'
  applied?: boolean
}

export function parsePlanFromText(text: string): ProjectPlanData | null {
  const match = /<<<PLAN\s*([\s\S]*?)\s*PLAN>>>/i.exec(text)
  if (!match) return null
  try {
    const raw = match[1].trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const pistas = Array.isArray(parsed.pistas)
      ? parsed.pistas
      : Array.isArray(parsed.tracks)
        ? parsed.tracks
        : []
    const tracks: ProjectPlanTrack[] = pistas
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((t) => ({
        nombre: String(t.nombre ?? t.name ?? 'Pista'),
        rol: String(t.rol ?? t.role ?? 'keys'),
        tipo: t.tipo === 'audio' || t.tipo === 'instrumento' ? t.tipo : 'midi',
        pluginNombre: t.pluginNombre ? String(t.pluginNombre) : t.pluginName ? String(t.pluginName) : undefined,
        pluginId: t.pluginId ? String(t.pluginId) : undefined,
        articulacion: t.articulacion ? String(t.articulacion) : undefined,
        noteMapSummary: t.notasUso ? String(t.notasUso) : t.noteMapSummary ? String(t.noteMapSummary) : undefined,
      }))
    if (tracks.length === 0) return null
    return {
      kind: 'projectPlan',
      nombre: String(parsed.nombre ?? 'Proyecto'),
      bpm: Number(parsed.bpm ?? 120) || 120,
      keyLabel: String(parsed.tonalidad ?? parsed.keyLabel ?? 'C mayor'),
      minutes: Number(parsed.minutos ?? parsed.minutes ?? 2) || 2,
      pensamiento: parsed.pensamiento ? String(parsed.pensamiento) : undefined,
      tracks,
    }
  } catch {
    return null
  }
}
