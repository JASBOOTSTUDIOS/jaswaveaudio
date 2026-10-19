/**
 * Heurísticas de producción para el LLM — no son validaciones de dominio.
 */

export function agentMusicPolicyPrompt(): string {
  return [
    '### FLUJO DE TRABAJO (operaciones complejas)',
    'CANCIÓN COMPLETA ("créame una canción de X minutos / bachata / …"):',
    '→ UN solo daw.musicBuild { aplicar:true, midiSource:"procedural", bpm, minutos, genero, prompt }.',
    '  Eso crea pistas + marcadores + clips MIDI con notas.',
    '→ Tras success: Kael (QA) pregunta al usuario si le gustó (request-user-input / CLARIFY). NO complete silencioso.',
    '→ PROHIBIDO midiSource:"ai" en canción completa (deja el proyecto sin notas).',
    '→ PROHIBIDO project.setBpm aparte: el BPM va DENTRO de musicBuild.',
    '→ PROHIBIDO proponer 20 clip.delete / track.delete; para limpiar el proyecto: daw.wipeProject.',
    '',
    'REFINAR / rellenar huecos (proyecto YA con pistas):',
    '→ UN midi.clip.create { pistaId, inicio, duracion, notas[] no vacío } por iteración.',
    '→ Luego humanize / mezcla / master según haga falta.',
    '',
    '### Tempo por género (NO inventes half-time)',
    'Bachata: 118–130 BPM (típico 125). NUNCA 60–80 (eso es half-time erróneo).',
    'Reggaetón: ~90–100. Worship/ballad: ~68–76. Pop: ~110–128.',
    '',
    '### Densidad MIDI',
    '- Batería ≥1.5 notas/beat (kick+snare+HH). PROHIBIDO solo kick cada 4 beats.',
    '- Bajo ≥0.5 notas/beat, legato. PROHIBIDO 4 notas en 32 beats.',
    '- Pad: cambios de voicing cada 4–8 beats. Piano/Keys ≥0.4 notas/beat.',
    '',
    '### Instrumentos',
    'Batería GM: Kick=36 Snare=38 Rim=37 CHH=42 OHH=46 Crash=49 Ride=51 Toms 48/47/45/43.',
    'Bajo pitch 28–55. Piano 36–84. Pads 48–79. Guitarra 40–76. Lead 55–84.',
    'Mezcla sugerida: batería 0.75–0.85; bajo 0.7–0.8; keys 0.55–0.65; pads 0.4–0.55; lead 0.75–0.85.',
    'VST: plugin.probe antes de confiar; library.preset.search/apply antes de setParameter.',
    'NO digas master listo si AudioListenReport.ok=false.',
  ].join('\n')
}
