/**
 * Habilidad «Compositor letra → canción» (K4). Texto de oficio para el agente productor: cómo llevar la entrevista, usar la
 * lógica pura de `@jaswave/shared` (`music/compositor-cancion`) y volcar el resultado en pistas con las herramientas reales
 * del DAW. No registra nada por sí sola: `habilidadCompositorCancion()` devuelve la ruta y el Markdown listos para
 * `carpetaAsistente` (mismo formato que `habilidadEstiloMarkdown`) o para añadirse a las habilidades de serie del productor.
 */
export const RUTA_HABILIDAD_COMPOSITOR = 'habilidades/compositor-cancion.md'

export function habilidadCompositorCancion(): { ruta: string; contenido: string } {
  return {
    ruta: RUTA_HABILIDAD_COMPOSITOR,
    contenido: [
      '# Compositor letra → canción',
      '> @productor Cuando el usuario quiera crear una canción a partir de una letra, o cantar/tararear una melodía y que la conviertas en canción con coros.',
      '',
      'Método (una pregunta cada vez; no pidas todo junto):',
      '1. Entrevista: género, voz del banco (`.jwvoice`) para la melodía principal, si compones tú o canta el usuario, tono y escala, BPM, letra (una frase por línea) y si quiere coros. Guarda lo ya respondido y no lo repitas.',
      '2. Melodía:',
      '   - Modo «ia»: compón una melodía cantable en el tono (grados conjuntos, saltos pequeños, frase que respira, notas largas en las sílabas tónicas).',
      '   - Modo «cantada»: pide la grabación y llama a `analysis.voiceToMelody` sobre ese audio. Ajusta con los cuatro sliders 0–100 %: afinación a la escala, cuantización, legato y limpieza. Empieza con 70/50/30/40 y enséñale cómo suena; si dice «más fiel a mi voz», baja afinación y cuantización.',
      '3. Letra: reparte las sílabas sobre las notas. Con menos sílabas que notas hay melismas; con más, se parten las notas largas. Revisa que las sílabas tónicas caigan en tiempos fuertes o notas largas.',
      '4. Coros: pide armonías por voces (tercera abajo, tercera arriba, quinta abajo) con tonos MIDI exactos, dentro de la tonalidad, sin saltos innecesarios. Si tu respuesta no cumple el formato JSON o la longitud, la app usa un respaldo diatónico: no insistas.',
      '5. Volcado (cada paso por herramienta, con undo):',
      '   - Pista «Voz Lead» con el plugin `com.jaswave.plugin.vocal-choir` (fuente interna, 1 voz) y las notas con su sílaba en la letra del arreglo.',
      '   - Una pista por voz de coro con `com.jaswave.plugin.vocal-choir` y spread estéreo distinto, o una sola pista con 3–4 voces en el plugin.',
      '   - Acompañamiento con la banda (acordes del tono).',
      '   - Si el usuario cantó: audio original en una pista silenciada «[Audio Ref - Canto Original]» para contrastar.',
      '6. Comprueba: escucha el resultado, mide con las herramientas de análisis (tono, nivel) y cuenta lo que oyes tal cual, sin adornarlo.',
      '',
      'Criterio: la voz tiene que sonar cantada por personas: vibrato con retardo, ataques distintos por voz, desafinación mínima entre voces, y una consonante o respiración donde la letra lo pide.',
      '',
      '<!-- agente: productor -->',
      '',
    ].join('\n'),
  }
}
