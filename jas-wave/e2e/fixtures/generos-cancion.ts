/**
 * Géneros de la prueba «canción completa con la IA real» (e2e 29). Se elige con JASWAVE_E2E_GENERO
 * (worship por defecto). Cada género trae su encargo, su forma y los umbrales con los que se juzga:
 * la música electrónica es repetitiva y cuantizada por naturaleza, así que no se mide como worship.
 */
export type GeneroCancion = {
  id: 'worship' | 'salsa' | 'merengue' | 'electronica'
  titulo: string
  /** Nombre de archivo de salida (sin acentos). */
  archivo: string
  bpm: number
  /** Tonalidad en el análisis armónico (nota de la tónica). */
  tonica: string
  forma: Array<[string, number]>
  pedido: string
  umbrales: {
    /** Porcentaje máximo de compases que son copia exacta de otro en la misma pista. */
    copiasMax: number
    /** Porcentaje máximo de notas en rejilla exacta (batería / resto). */
    rejillaBateria: number
    rejillaResto: number
    /** Porcentaje máximo de tiempos con choques de segunda menor entre pistas. */
    choquesMax: number
  }
}

const PISTAS_BASE =
  'Una pista por instrumento con su VST3 JasWave cargado. Mezcla: bus de reverb con envíos, EQ y compresión por pista, volúmenes equilibrados. ' +
  'Máster con limitador a −14 LUFS y picos por debajo de −1 dBTP.'

export const GENEROS: Record<GeneroCancion['id'], GeneroCancion> = {
  worship: {
    id: 'worship',
    titulo: 'Tu Gracia Me Alcanzó',
    archivo: 'Tu Gracia Me Alcanzo',
    bpm: 74,
    tonica: 'D',
    forma: [['Intro', 4], ['Verso 1', 8], ['Pre-coro 1', 4], ['Coro 1', 8], ['Verso 2', 8], ['Pre-coro 2', 4], ['Coro 2', 8], ['Puente', 8], ['Coro final', 8], ['Outro', 4]],
    pedido: [
      '/banda Canción de adoración completa «Tu Gracia Me Alcanzó», Re mayor, 74 BPM, 4/4, al estilo del grupo Barak:',
      'worship moderno dominicano, pads amplios y guitarras eléctricas con delay y ambiente, piano con voicings abiertos (novenas, sus2/sus4),',
      'batería contundente y bajo profundo en los coros, coros grandes y coreables con un pasaje de cánticos «aaa / oh-oh» en el puente,',
      'frases melódicas cantables, nada cuadrado ni robótico.',
      'Forma: Intro 4 compases, Verso 1 8, Pre-coro 4, Coro 8, Verso 2 8, Pre-coro 4, Coro 8, Puente 8 con crescendo, Coro final 8 y Outro 4.',
      'Banda completa, una pista por instrumento con su VST3 JasWave cargado: batería (Worship Drums) con fills al cambiar de sección,',
      'bajo eléctrico, piano de cola, guitarra eléctrica arpegiada, cuerdas (Strings Section), pad ambiental (Shimmer Pad) y un lead de sinte en el puente.',
      'Dinámica real: versos suaves, coros llenos, el puente crece y el outro se apaga (velocidades distintas por sección).',
      'Mezcla: bus de reverb con envíos desde piano, guitarra, cuerdas y pad; EQ y compresión por pista; guitarra y cuerdas abiertas en estéreo; volúmenes equilibrados.',
      'Máster con limitador a −14 LUFS y picos por debajo de −1 dBTP.',
    ].join(' '),
    umbrales: { copiasMax: 50, rejillaBateria: 90, rejillaResto: 60, choquesMax: 8 },
  },
  salsa: {
    id: 'salsa',
    titulo: 'Sabor de Mi Tierra',
    archivo: 'Sabor de Mi Tierra',
    bpm: 190,
    tonica: 'C',
    forma: [['Intro', 4], ['Verso 1', 8], ['Coro 1', 8], ['Verso 2', 8], ['Coro 2', 8], ['Mambo', 16], ['Coro final', 8], ['Outro', 4]],
    pedido: [
      '/banda Salsa brava completa «Sabor de Mi Tierra», Do menor, 190 BPM (clave 2-3), 4/4, estilo salsa dura de los años 70:',
      'piano con montuno de octavas y guajeos sincopados que varían entre compases, bajo con tumbao anticipado (el bajo cae antes del tiempo fuerte),',
      'percusión latina con conga, bongó y cencerro (usa el kit de percusión de la batería), clave marcando el 2-3,',
      'cuerdas como colchón armónico y sección de «metales» hecha con el sinte o las cuerdas en stabs cortos en los coros y el mambo.',
      'Forma: Intro 4 compases, Verso 1 8, Coro 8, Verso 2 8, Coro 8, Mambo 16 (piano y percusión en diálogo, metales entrando por capas), Coro final 8 y Outro 4.',
      'Progresión típica menor (Cm, Fm, G7, Cm / Ab, Fm, G7), con tensiones y notas de paso, nada cuadrado: el piano no repite el mismo guajeo dos compases seguidos.',
      PISTAS_BASE,
    ].join(' '),
    // La salsa lleva ostinatos (tumbao, clave): se admiten más repeticiones y mucha cuantización rítmica.
    umbrales: { copiasMax: 70, rejillaBateria: 95, rejillaResto: 80, choquesMax: 10 },
  },
  merengue: {
    id: 'merengue',
    titulo: 'Baila Conmigo Esta Noche',
    archivo: 'Baila Conmigo Esta Noche',
    bpm: 135,
    tonica: 'G',
    forma: [['Intro', 4], ['Verso 1', 8], ['Coro 1', 8], ['Verso 2', 8], ['Coro 2', 8], ['Jaleo', 16], ['Coro final', 8], ['Outro', 4]],
    pedido: [
      '/banda Merengue dominicano completo «Baila Conmigo Esta Noche», Sol mayor, 135 BPM, 2/4 sentido en 4/4 (compás de 4 tiempos con el patrón de tambora),',
      'tambora con el golpe característico (parches y palo), güira en corcheas constantes, bajo marcando tónica y quinta,',
      'piano con guajeos rítmicos de merengue, acordeón o sinte tipo acordeón (usa el sinte o el sampler) con melodía rápida de frases cortas,',
      'saxofones o metales hechos con el sinte o las cuerdas en respuestas cortas en los coros.',
      'Forma: Intro 4 compases, Verso 1 8, Coro 8, Verso 2 8, Coro 8, Jaleo 16 (acelerando la energía, la percusión se llena), Coro final 8 y Outro 4.',
      'Progresión I-IV-V (G, C, D) con variaciones; el jaleo sube de intensidad por capas. Nada cuadrado ni robótico: las melodías cambian entre compases.',
      PISTAS_BASE,
    ].join(' '),
    umbrales: { copiasMax: 70, rejillaBateria: 95, rejillaResto: 80, choquesMax: 10 },
  },
  electronica: {
    id: 'electronica',
    titulo: 'Neon Horizon',
    archivo: 'Neon Horizon',
    bpm: 124,
    tonica: 'A',
    forma: [['Intro', 8], ['Build 1', 8], ['Drop 1', 16], ['Break', 8], ['Build 2', 8], ['Drop 2', 16], ['Outro', 8]],
    pedido: [
      '/banda Tema de música electrónica (progressive house) completo «Neon Horizon», La menor, 124 BPM, 4/4:',
      'bombo a cuatro por el piso, hi-hats abiertos en contratiempo, clap en 2 y 4 (usa la batería con un kit electrónico o el kit disponible más cercano),',
      'bajo de sinte con sidechain/pulso rítmico, arpegio de sinte constante que abre su filtro en los builds, pad atmosférico, lead de sinte con hook en los drops,',
      'efecto de riser/ruido en los builds (con el sinte o el pad) y silencio total de batería en el break.',
      'Forma: Intro 8 compases (solo ritmo y pad), Build 1 8 (suben capas y velocidad), Drop 1 16 (todo entra), Break 8 (sin batería, solo pad y arpegio), Build 2 8, Drop 2 16 (más denso que el primero) y Outro 8.',
      'Progresión Am, F, C, G; el arpegio y el bajo cambian de patrón entre secciones para no sonar a bucle de 4 compases.',
      PISTAS_BASE,
    ].join(' '),
    // Electrónica: bucles y rejilla estricta son parte del género; el aviso sigue siendo la variedad entre secciones.
    umbrales: { copiasMax: 85, rejillaBateria: 100, rejillaResto: 95, choquesMax: 10 },
  },
}

export function generoDesdeEntorno(env: NodeJS.ProcessEnv = process.env): GeneroCancion {
  const id = (env.JASWAVE_E2E_GENERO ?? 'worship').trim().toLowerCase() as GeneroCancion['id']
  const g = GENEROS[id]
  if (!g) throw new Error(`JASWAVE_E2E_GENERO desconocido: ${id}. Opciones: ${Object.keys(GENEROS).join(', ')}`)
  return g
}
