/**
 * Habilidades de cada agente de la banda (skills): el conocimiento de oficio que un músico, el arreglista, el
 * QA, la mezcla o el máster consultan antes de una tarea concreta, con las herramientas reales del DAW.
 *
 *  - De serie: por rol y, en los músicos, por familia de instrumento (batería, bajo, piano, guitarra,
 *    sintes/pads, cuerdas). Siempre disponibles aunque el usuario no haya configurado nada.
 *  - Del usuario: archivos Markdown de su carpeta de configuración (`habilidades/*.md`) asignados a un agente
 *    con «@id» en el título o la descripción, o con una línea `<!-- agente: baterista, bajista -->`.
 *    Valen el id del especialista, su nombre, su rol (musico, mezcla, master, qa, coherencia, director,
 *    planificador) o «todos». Si repiten el id de una de serie, la del usuario manda.
 *
 * El agente ve solo la lista (nombre + cuándo) y lee el contenido con `leer_habilidad` cuando aplica.
 * Criterio de todas las de serie: que la música suene tocada por personas, no por una máquina.
 */
import { carpetaAsistente, habilidadDesdeMarkdown, slugAsistente } from '@jaswave/host-sdk'
import type { ArchivoAsistente, HabilidadAgente, RolProduccion } from '@jaswave/host-sdk'

import type { EspecialistaConfig } from './especialistas-storage'

export type FamiliaInstrumento = 'bateria' | 'bajo' | 'piano' | 'guitarra' | 'sinte' | 'cuerdas'

const ROL_PRODUCCION: Record<string, RolProduccion> = {
  planificador: 'planificador',
  director: 'director',
  musico: 'musico',
  arreglista: 'coherencia',
  coherencia: 'coherencia',
  qa: 'qa',
  mezcla: 'mezcla',
  mastering: 'master',
  master: 'master',
}

export function rolProduccionDe(role: string): RolProduccion {
  return ROL_PRODUCCION[role] ?? 'musico'
}

/** Familia de instrumento de un especialista (por instrumento, nombre, id y etiquetas). */
export function familiaDe(e: Pick<EspecialistaConfig, 'id' | 'nombre' | 'instrumento' | 'skills'>): FamiliaInstrumento | null {
  const t = `${e.instrumento ?? ''} ${e.nombre} ${e.id} ${(e.skills ?? []).join(' ')}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  if (/bater|drum|percu|caja|bombo/.test(t)) return 'bateria'
  if (/\bbajo|bass\b|bajista/.test(t)) return 'bajo'
  if (/piano|tecla|keys|organ|rhodes|wurli/.test(t)) return 'piano'
  if (/guitar/.test(t)) return 'guitarra'
  if (/cuerda|string|violin|viola|cello|orquest/.test(t)) return 'cuerdas'
  if (/sint|synth|\blead\b|\bpad\b|pads|atmos|ambient|shimmer/.test(t)) return 'sinte'
  return null
}

const h = (id: string, nombre: string, descripcion: string, lineas: string[]): HabilidadAgente => ({ id, nombre, descripcion, contenido: lineas.join('\n'), origen: 'base' })

// ── Músicos (todos) ────────────────────────────────────────────────────────

const MUSICO: HabilidadAgente[] = [
  h('tocar-con-vida', 'Tocar con vida (nada robótico)', 'SIEMPRE antes de grabar o corregir una parte: cómo evitar que suene a máquina.', [
    'Lo que suena a máquina y está prohibido: todas las notas con la misma duración; solo las tres notas de la triada (C–E–G) una y otra vez; el mismo bloque copiado en cada compás; todas las velocidades iguales; todo clavado en la rejilla.',
    'Armonía: el cifrado es un punto de partida. Usa TODA la escala de la tonalidad: notas de paso entre dos del acorde, bordaduras (sube o baja un grado y vuelve), apoyaturas en el tiempo fuerte que resuelven a la nota del acorde, anticipaciones del acorde siguiente en la «y» de 4. Colorea con extensiones: add9 (2.ª), sus2/sus4, 6.ª, maj7/m7, 11.ª; usa inversiones para que las voces se muevan poco. Regla única: en el tiempo fuerte de cada compás que se oiga el acorde de ese compás; el resto del compás es tuyo.',
    'Ritmo: mezcla duraciones en cada compás (una larga de apoyo, corcheas, alguna semicorchea de adorno, un silencio). Mete una síncopa o una anticipación por frase; en el coro, acentúa la «y» de 4 cuando el bombo lo haga. Haz frases de 2 o 4 compases con pregunta y respuesta; ninguna frase igual dos compases seguidos: cambia una nota, una duración o la octava.',
    'Arpegios y adornos modernos: arpegio ascendente en corcheas y descendente en semicorcheas; «roll» de acorde (las notas del acorde separadas 0,03–0,06 beats, de grave a agudo); nota de gracia (semitono o tono por debajo, duración 0,08–0,12 y velocidad −20, justo antes de la nota principal); eco de la última nota una octava arriba y más suave; trino corto en finales de frase (dos notas alternas de 0,125).',
    'Humanizar: velocidad distinta en cada nota (±10 alrededor de la dinámica de la sección; apoyos +8, pasos −12, adornos −20). Micro-tiempo en instrumentos melódicos y armónicos: desplaza cada nota entre −0,04 y +0,04 beats (las de apoyo ligeramente tarde, las anticipaciones ligeramente antes); nunca más de 0,05 y nunca en la batería (ella humaniza con velocidades y ghost notes). Duraciones también humanas: una negra puede durar 0,9 o 1,05 beats.',
    'Antes de informar, lee el clip con midi.notes.get y mira tres cosas: ¿hay al menos 3 duraciones distintas? ¿hay notas que no son de la triada (extensiones, paso, adornos)? ¿las velocidades varían al menos 20 entre la más suave y la más fuerte? Si falla alguna, retoca con midi.notes.patch antes de dar la parte por hecha.',
  ]),
  h('grabar-por-secciones', 'Grabar la parte por secciones', 'Cuando grabes una parte nueva siguiendo la hoja de ruta.', [
    'Método (una sección = un clip, del largo exacto de la sección):',
    '1. Lee la HOJA DE RUTA: beat de inicio y beats de cada sección, acorde por compás, tonalidad, carácter. Lee «Tocar con vida» si aún no lo hiciste.',
    '2. Por cada sección crea UN clip con midi.clip.create {pistaId, nombre: "<Sección>", inicio: <beat inicio de la sección>, duracion: <beats>, notas: [...]}. Cada nota: pitch (MIDI), inicio en beats CONTADOS DESDE EL PRINCIPIO DEL CLIP (la primera suele estar cerca de 0), duracion en beats, velocidad 1–127.',
    '3. En el tiempo fuerte de cada compás (beat 0, 4, 8… del clip en 4/4) suena el acorde de ese compás (con sus extensiones); el resto del compás lleva pasos, arpegios, adornos y silencios.',
    '4. Dinámica por sección: intro/verso 60–85, pre-coro creciendo, coro 95–120, puente según el plan, outro apagándose; dentro de la sección, cada nota con su velocidad (±10).',
    '5. Nada después del final de la canción. No crees pistas: trabaja en la de tu encargo.',
    'Comprobación: midi.notes.get {pistaId, clipId} de un clip al azar (¿empieza cerca de 0? ¿pitches en la tonalidad? ¿duraciones y velocidades variadas?) y analysis.trackSound {} para confirmar que tu pista suena.',
  ]),
  h('verificar-que-suena', 'Comprobar que la pista suena', 'Al terminar de grabar o si dudas de que tu pista tenga instrumento.', [
    '1. analysis.trackSound {} (o con {trackId}) dice por pista si falta instrumento, si el VST falló o está en bypass, si hay mute/solo o volumen casi a cero.',
    '2. Sin instrumento: track.addVstLayer {trackId, nombre} con un nombre instalado (los lista la propia revisión): JasWave Worship Drums, Electric Bass, Grand Piano, Piano Synth, Electric Guitar, Shimmer Pad, Strings Section, Ambient Atmos, Sampler.',
    '3. En bypass: plugin.bypass {trackId, slot, bypass: false}. Mute/solo o volumen 0: track.update {trackId, datos: {mute: false, solo: false, volumen: 0.8}} (volumen lineal 0–4; 1 = 0 dB; NUNCA 0).',
    '4. Vuelve a medir con analysis.trackSound y, solo entonces, informa que la pista suena.',
  ]),
  h('corregir-sin-rehacer', 'Corregir una devolución o un aviso', 'Cuando te devuelven la parte (arreglista, QA, mezcla) o el ensayo acordó un ajuste.', [
    '1. Entiende el aviso: pista, compases y qué pasa. Compás N empieza en el beat (N−1)×4 de la canción; resta el inicio del clip para situarlo dentro del clip.',
    '2. Lee UNA vez el clip afectado con midi.notes.get {pistaId, clipId} (sin limit pequeño si necesitas todo).',
    '3. Cambia solo lo señalado con midi.notes.patch {pistaId, clipId, upsert: [notas con su id y los campos nuevos], removeIds: [ids que sobran]}. Si hay que rehacer el clip entero, midi.notes.set {pistaId, clipId, notas, reemplazarTodas: true}.',
    '4. Si el aviso dice que tu parte «suena robótica», no toques nota a nota: vuelve a grabar esa sección aplicando «Tocar con vida» (duraciones variadas, extensiones y pasos, adornos, velocidades y micro-tiempo).',
    '5. Conserva lo que ya encajaba (ritmo, intención, dinámica). No crees pistas ni dupliques clips.',
    '6. Relee con midi.notes.get y confirma que el compás señalado quedó bien antes de informar.',
  ]),
]

// ── Por familia de instrumento ────────────────────────────────────────────

const FAMILIA: Record<FamiliaInstrumento, HabilidadAgente[]> = {
  bateria: [
    h('bateria-groove', 'Groove de batería', 'Cuando grabes la base rítmica (eres la primera oleada: los demás te escuchan).', [
      'Notas (JasWave Worship Drums, mapa GM): bombo 36, caja 38, aro 37, hi-hat cerrado 42, hi-hat pedal 44, hi-hat abierto 46, ride 51, campana del ride 53, crash 49/57, toms 50 (agudo), 47, 45, 41 (grave), shaker/pandereta 54/70 si el kit lo tiene.',
      '4/4 balada/adoración: bombo en 1 y 3 (en el coro añade la «y» de 3 o la «a» de 4), caja en 2 y 4 (vel 95–110), hi-hat en corcheas en el verso (vel 55–75, acentúa los tiempos; las corcheas débiles −15), ride en el coro. Ghost notes de caja (vel 25–45) en las semicorcheas «e» y «a» del 2 y del 4 dan vida; no las pongas todas: 2–3 por compás y en sitios distintos cada compás.',
      '6/8: bombo en 1 y 4, caja en 4 (o en 4 y 6), hi-hat en las 6 corcheas con acentos en 1 y 4.',
      'Tempo lento (<80): deja aire, menos bombo, hi-hat en negras con una corchea de relleno al final del compás; tempo rápido (>120): hi-hat en negras o corcheas abiertas.',
      'Rejilla: la batería sí va en la rejilla (inicio múltiplo de 0,25 o tresillos). Humaniza con VELOCIDAD, no moviendo el tiempo: hi-hat alternando ±8, caja 2 vs 4 distintas (la del 4 un poco más fuerte), bombo ±6. Un patrón no se copia igual en todos los compases: cada 2 compases cambia una cosa (una ghost, el hi-hat abierto en la «y» de 4, un golpe de bombo extra).',
      'Un clip por sección; en la intro puedes tocar solo hi-hat/aro, una percusión suave o nada si el plan lo pide.',
    ]),
    h('bateria-fills-y-transiciones', 'Fills y transiciones', 'Al cambiar de sección (último compás) y al abrir el coro.', [
      'Fill en el último compás de cada sección: ocupa los tiempos 3 y 4 (o solo el 4 si la sección es suave): semicorcheas de caja → tom agudo (50) → tom medio (47) → tom grave (45/41), velocidades crecientes 70→110. Varía los fills: nunca el mismo dos veces en la canción (cambia el orden de los toms, mete un tresillo, deja un hueco).',
      'Primer tiempo de la sección nueva: crash (49) vel 105–115 junto al bombo. Coro: crash en el 1 de los compases 1 y 5.',
      'Pre-coro → coro: redoble de caja en semicorcheas durante los 2 últimos tiempos con velocidad 50→105 (crescendo) y hi-hat abierto (46) en la «y» de 4.',
      'Puente: puede empezar sin batería (o solo bombo en negras) y volver a entrar con un fill largo (un compás entero).',
      'No metas fills en mitad de la sección: rompen el groove.',
    ]),
    h('bateria-biblioteca-de-grooves', 'Biblioteca de grooves (cuándo usarla)', 'Antes de escribir la batería a mano: decide si una base de la biblioteca de grooves MIDI te sirve.', [
      'Herramientas: groove.listar {estilo?, tipo?, compas?, etiquetas?, texto?} para ver lo disponible (estilos como worship, pop, rock, balada, shuffle/blues, jazz, funk, soul, reggae, latin, afrobeat, hip-hop, electronica, metal, country, gospel, 12-8; tipos groove, fill, intro, outro, transicion) y groove.insertar {grooveId o estilo+tipo+compas+etiquetas, pistaId, inicioBeat, compases, variacion: "ligera", fill: true} que crea un clip MIDI con undo en TU pista (mapa GM de Worship Drums).',
      'Úsala cuando el estilo pedido esté en la biblioteca y quieras una base sólida y humana: elige el compás del proyecto (4/4, 6/8, 12/8), la intensidad de la sección (verso suave, coro lleno, puente con crescendo) y repítela los compases que dure la sección. Pasa fill: true en el último compás de la sección para cambiarlo por un fill del mismo estilo, y variacion: "ligera" para que ningún compás repetido suene idéntico.',
      'Después de insertar, léelo (midi.notes.get) y VARÍALO: cada 4 compases cambia algo (una ghost, el hi-hat abierto, un bombo extra), pon el crash del coro y suaviza o sube velocidades según la dinámica de la sección. No pegues el mismo clip sin tocar de principio a fin.',
      'Escribe la parte a mano (midi.clip.create) cuando: el estilo no esté en la biblioteca, el compás sea raro, el plan pida algo muy concreto (un hit sincronizado con otro instrumento, un silencio, un fill propio) o el groove no encaje tras probarlo. Nunca inventes un grooveId: sale de groove.listar.',
      'El tempo del proyecto manda: los grooves están en beats, no cambies el bpm para encajarlos. Si el compás del groove no coincide con el del proyecto, elige otro groove del compás correcto en vez de forzarlo.',
    ]),
    h('bateria-dinamica-por-seccion', 'Dinámica por sección', 'Para que la batería cuente la forma de la canción.', [
      'Intro: mínima (hi-hat cerrado o aro) o silencio. Verso 1: hi-hat cerrado, bombo/caja vel 80–95, sin crash. Pre-coro: añade ghost notes y abre el hi-hat al final.',
      'Coro: ride o hi-hat abierto, caja 105–115, bombo 100–110, crash al entrar. Verso 2: un punto más que el verso 1 (p. ej. bombo en corcheas puntual, campana del ride).',
      'Puente con crescendo: empieza vacío y crece cada 2 compases (bombo → caja en el 4 → hi-hat → todo). Coro final: lo más lleno (doble crash, caja en 2 y 4 con flam = dos notas separadas 0,03 beats, la primera −30 de velocidad).',
      'Outro: vuelve al patrón del verso y apaga: últimas dos notas, bombo+crash en el 1 del último compás y nada más. Nada suena tras el final de la canción.',
    ]),
  ],
  bajo: [
    h('bajo-con-el-bombo', 'Línea de bajo apoyada en el bombo', 'Cuando grabes el bajo (escucha la batería primero).', [
      'Registro: E1–G2 (MIDI 28–43); la fundamental del acorde (o la nota tras «/») en el primer tiempo de CADA compás, vel 90–105 y ligeramente tarde (+0,02 beats): es el peso del compás.',
      'Lee la batería con midi.notes.get en su pista: coloca tus ataques donde cae el bombo (36). Si no hay batería aún, sigue el patrón bombo 1 y 3.',
      'Duraciones VARIADAS, no todas iguales: la fundamental larga (negra con puntillo o blanca), una corchea antes del cambio, un silencio en la «y» de 4 cuando el bombo no toca ahí. Un compás con 2 notas y el siguiente con 4.',
      'Notas de paso y adornos (con toda la escala): la quinta o la octava en la última corchea; aproximación cromática desde un semitono por debajo de la fundamental siguiente (duración 0,25, vel −15); «slide» simulado = nota de gracia un tono abajo (0,1 beats, vel −25) pegada a la fundamental; 3.ª o 6.ª como nota de paso al cambiar de acorde. Nunca una nota fuera de la escala con duración ≥ 0,5 en tiempo fuerte.',
      'Comprueba: cada compás empieza con la fundamental correcta (midi.notes.get), hay al menos 3 duraciones distintas y la pista suena (analysis.trackSound).',
    ]),
    h('bajo-por-seccion', 'Bajo por sección', 'Para variar el bajo entre verso, coro y puente sin perder el ancla.', [
      'Intro/verso: redondas o blancas en la fundamental (vel 85–95) con una nota de paso corta hacia el acorde siguiente en la última corchea.',
      'Pre-coro: negras, añade la octava en el 4 y una anticipación de la fundamental siguiente en la «y» de 4.',
      'Coro: pulso de corcheas en la fundamental con la octava o la quinta en las corcheas débiles (vel 100–110, las débiles −12), una síncopa por compás (salta la corchea del 3 y ataca en la «y» de 3) y un relleno distinto cada 2 compases.',
      'Puente: nota pedal (la misma fundamental todo el puente, redondas con un «respiro» de corchea antes de cada repetición) o silencio los primeros compases si hay crescendo; entra con el crescendo.',
      'Outro: vuelve a redondas y termina en la tónica sostenida hasta el final exacto de la canción.',
    ]),
  ],
  piano: [
    h('piano-voicings', 'Voicings de piano', 'Cuando grabes acordes de piano o teclado.', [
      'Registro: mano derecha C4–C6 (60–84), mano izquierda C2–C4 (36–60). Si hay bajo, no dobles la fundamental grave: deja la izquierda en la quinta o la octava media.',
      'Voicings modernos, no triadas planas: 3–5 notas con color (add9, sus2, maj7, m7, 6, 11) y en posición abierta (fundamental–quinta abajo, tercera–novena arriba). Cambia de voicing en cada repetición del mismo acorde (inversión distinta o una nota de color nueva). Conduce las voces: mantén las notas comunes y mueve las demás ≤ 2 semitonos.',
      'Acorde con «/» (p. ej. G/B): la nota tras la barra en la mano izquierda, el resto arriba.',
      'Tiempo fuerte de cada compás: el acorde de ese compás (hoja de ruta). Entre acordes: notas de paso de la escala en la derecha, una apoyatura (2.ª o 4.ª que resuelve a la 3.ª) en el coro, anticipación del acorde siguiente en la «y» de 4.',
      'Humaniza: «roll» del acorde (notas separadas 0,02–0,05 beats de grave a agudo), la mano izquierda 0,01–0,03 antes que la derecha, velocidades 70–95 con la nota superior +6 (la melodía interna) y los graves −10; cada acorde con duración ligeramente distinta (3,8–4,1 beats si es redonda).',
    ]),
    h('piano-patrones-ritmicos', 'Patrones rítmicos y arpegios de piano', 'Para que el piano acompañe distinto en cada sección y no repita bloques.', [
      'Intro/verso: acorde sostenido (redonda rota en «roll») en la derecha y arpegio en corcheas en la izquierda (fundamental–quinta–octava–novena), vel 60–80, con la última corchea del compás como nota de paso al acorde siguiente.',
      'Pre-coro: acordes en negras con anticipación en la «y» de 4 (el acorde siguiente entra media corchea antes), creciendo; adorno de dos semicorcheas (9.ª→3.ª) en el 4 cada 2 compases.',
      'Coro: bloques en corcheas con la anticipación en la «y» de 4 y octavas en la izquierda, vel 95–115, pero no todos iguales: en el 2.º y 4.º compás sustituye las corcheas del 3 por un arpegio ascendente en semicorcheas; añade una melodía interna en la nota superior (que cambie de compás a compás).',
      'Puente: arpegios lentos (negras) que crecen a corcheas; coro final: como el coro más la octava aguda y un «eco» de la nota superior una octava arriba y −20 de velocidad. Outro: acorde final en «roll» lento (0,08 entre notas) sostenido hasta el fin exacto.',
      'Rejilla de referencia de corcheas/semicorcheas, pero con micro-tiempo humano (±0,03) y velocidades vivas; nunca el mismo patrón nota por nota en dos compases seguidos.',
    ]),
  ],
  guitarra: [
    h('guitarra-arpegios-y-ritmica', 'Arpegios y rítmica de guitarra', 'Cuando grabes la guitarra eléctrica o acústica.', [
      'Registro: E3–E5 (52–76) para arpegios; acordes con 3–4 notas (fundamental, quinta, octava, y color arriba: 9.ª, 2.ª suspendida o 7.ª mayor: forma «power + color»).',
      'Verso: arpegio en corcheas sobre el acorde con una nota de color (fundamental, quinta, novena, octava, tercera, novena…), vel 65–85, duraciones 1–1,5 beats (que suenen superpuestas), y una «hammer-on» simulada: nota de gracia un tono abajo (0,1 beats, vel −25) antes de la tercera. Cambia el orden del arpegio cada 2 compases.',
      'Coro: rasgueo en corcheas (todas las notas del acorde casi a la vez: separadas 0,02–0,04 beats de grave a agudo), vel 90–110, acento en 2 y 4, silencio en la «y» de 3 cada 2 compases para respirar; o palm mute en corcheas (duración 0,25, vel 70) con acentos (vel 95) en las síncopas si el plan pide pegada.',
      'Deja hueco al piano: si el piano toca acordes en corcheas, tú arpegios largos o notas tenidas con un «swell»; si el piano hace pads, tú la rítmica.',
      'Tiempo fuerte = acorde del compás (hoja de ruta). Entre tiempos, notas de paso de la escala y anticipaciones. Acorde con «/»: la nota del bajo no es tuya. Micro-tiempo humano ±0,03 (un rasgueo nunca cae clavado).',
    ]),
    h('guitarra-cadena-de-efectos', 'Cadena de efectos de la guitarra', 'Antes de grabar o si el sonido no encaja (limpio vs. saturado).', [
      'Inspecciona el instrumento con analysis.trackSound y plugin.setParameter sobre el propio VST (JasWave Electric Guitar: ganancia, cab, delay, chorus).',
      'Verso: limpio con chorus suave y delay en corcheas (mix 15–25 %). Coro: más ganancia (drive) y menos delay. Adoración: delay con puntillo (3/16) es clásico.',
      'No añadas plugins externos si el propio instrumento lo resuelve; si lo haces, comprueba con analysis.trackSound que no quedó en bypass.',
    ]),
  ],
  sinte: [
    h('sinte-pads-y-texturas', 'Pads y texturas', 'Cuando grabes pads, atmósferas o colchones (Shimmer Pad, Ambient Atmos).', [
      'Notas largas: una por acorde (o por sección si el acorde no cambia), hasta el cambio; 3–4 notas (triada abierta con 9.ª o 6.ª como color) en C3–C5 (48–72) sin la fundamental grave si hay bajo. Entra cada nota del acorde con un desfase distinto (0,05–0,3 beats) para que el pad «respire» en vez de caer en bloque.',
      'Velocidad baja y por sección: intro/verso 50–65, coro 75–90, puente creciendo 55→95 (sube la velocidad en cada acorde). Nunca velocidades > 100: el pad no es un lead.',
      'Cruza las notas 0,1–0,2 beats por encima del cambio para que no haya huecos; en el coro añade una nota alta (la 9.ª o la 5.ª una octava arriba) que entre en el compás 3 y no en el 1. Deja el centro-medio libre (no muchas notas entre 300 y 600 Hz): el pad llena, no pisa.',
      'Nada después del final: la última nota termina exactamente en el beat final de la canción.',
    ]),
    h('sinte-lead', 'Lead de sinte', 'Cuando el plan pide una melodía de sinte (puente, intro, coro final).', [
      'Monofónico (una nota a la vez), registro C4–C6 (60–84), con toda la escala de la tonalidad: en tiempos fuertes notas del acorde, entre ellos pasos, bordaduras y una apoyatura por frase.',
      'Frases de 2 compases en pregunta–respuesta: la pregunta termina en una nota del acorde que no es la tónica; la respuesta resuelve. Silencio de al menos 1 beat entre frases. Ninguna frase igual dos veces: varía el final, la octava o el ritmo.',
      'Ritmo con variedad (negras, corcheas, una síncopa y un tresillo o dos semicorcheas de adorno por frase), velocidades 85–110 (±10 por nota), última nota de la frase más larga; nota de gracia (0,1 beats, −25) antes de la nota más alta de la frase; micro-tiempo ±0,03.',
      'No toques encima de la melodía vocal del verso: si el plan no pide lead en una sección, no grabes en ella.',
    ]),
  ],
  cuerdas: [
    h('cuerdas-arreglo', 'Arreglo de cuerdas', 'Cuando grabes la sección de cuerdas (Strings Section).', [
      'Notas sostenidas por acorde: 3–4 voces entre G2 y G5 (43–79), posición abierta (violines arriba, violas en medio, cellos en la fundamental o la quinta), con una 9.ª o una 6.ª como color en los violines.',
      'Verso: solo violas/cellos (2 voces) vel 55–70. Pre-coro: añade violines a la tercera, crescendo (velocidad subiendo acorde a acorde). Coro: 4 voces, vel 85–100, octava aguda en el coro final. Las voces no entran todas a la vez: desfases de 0,05–0,2 beats, los cellos primero.',
      'Conducción de voces: mantén notas comunes, mueve lo mínimo; evita quintas paralelas en las dos voces superiores. Entre dos acordes, una nota de paso de la escala en la voz superior (blanca o negra) para que la línea cante.',
      'Contracantos solo en el puente o el coro final: blancas y negras en la escala, en pregunta–respuesta con la melodía, con una apoyatura que resuelve. Deja respirar entre secciones (corchea de silencio). Duraciones ligeramente distintas (no todas exactamente 4 beats).',
    ]),
  ],
}

// ── Otros roles ───────────────────────────────────────────────────────────

const POR_ROL: Partial<Record<RolProduccion, HabilidadAgente[]>> = {
  musico: MUSICO,
  planificador: [
    h('hoja-de-ruta', 'Escribir la hoja de ruta', 'Siempre, al planificar una canción.', [
      '1. Elige tonalidad, tempo y compás según el pedido (adoración: 68–78 BPM baladas, 120–132 up-tempo; 6/8 para himnos).',
      '2. Forma con compases: Intro 4 · Verso 8 · Pre-coro 4 · Coro 8 · Verso 8 · Pre-coro 4 · Coro 8 · Puente 8 · Coro final 8 · Outro 4 (ajusta al pedido).',
      '3. UN acorde por compás en cifrado americano, coherente en la tonalidad, con color moderno (no solo triadas): verso I–V–vi–IV o vi–IV–I–V como Cadd9 · Gsus4 · Em7 · Fmaj7; coro con resolución al I; puente IV–V–vi–V o un pedal; inversiones (G/B, C/E) para que el bajo camine. Cambia una o dos cosas entre la primera y la segunda vuelta de la misma sección (p. ej. el IV por un ii7).',
      '4. Carácter por sección (suave, crece, lleno, se apaga) y qué hace cada instrumento en cada una.',
      '5. Entrega todo con hoja_de_ruta y después el plan breve: instrumentación por pista (nombre del VST3) y papel de cada una por sección, pidiendo explícitamente partes vivas: duraciones variadas, arpegios, adornos, velocidades y micro-tiempo humanos, nada de bloques iguales.',
    ]),
  ],
  director: [
    h('preparar-y-repartir', 'Preparar el proyecto y repartir', 'Siempre, al dirigir una producción.', [
      '1. Común: project.setBpm {bpm}, project.setTimeSignature {numerador, denominador}; una pista MIDI por instrumento con track.create {nombre, tipo: "midi"} y su instrumento con track.addVstLayer {trackId, nombre: "JasWave …"} (nombres instalados: analysis.trackSound los lista).',
      '2. Comprueba con analysis.trackSound que cada pista tiene su instrumento cargado antes de repartir.',
      '3. asignar_encargos: un encargo por músico con `pista` (el id de su pista; cada músico solo podrá escribir ahí) y un texto AUTOSUFICIENTE: nombre e id de su pista, secciones (con sus beats), estilo, dinámica por sección y qué debe dejar sitio a los demás. Pide a cada uno que toque con vida (variedad rítmica, extensiones, adornos, humanización). Base rítmica primero (batería, bajo).',
      '4. No toques las partes de los músicos. En el ensayo, arbitra: acepta lo que mejora el conjunto y descarta lo contradictorio.',
    ]),
  ],
  coherencia: [
    h('metodo-de-coherencia', 'Método del arreglista', 'Siempre que recibas problemas de coherencia medidos.', [
      '1. Agrupa los problemas por pista. Por cada pista señalada, lee UNA vez el clip de la sección afectada con midi.notes.get {pistaId, clipId}.',
      '2. Sitúa el compás: compás N = beat (N−1)×4 de la canción; dentro del clip, resta el inicio del clip.',
      '3. Corrige todos los compases de ese clip en UN midi.notes.patch {pistaId, clipId, upsert: [notas con id y campos nuevos], removeIds: [...]}: nota larga fuera de tono → a la nota más cercana de la escala; tiempo fuerte sin nota del acorde → cambia el pitch a una del acorde (o su 9.ª/6.ª); muy lejos de la rejilla (> 0,08 beats) → acércala a la rejilla dejando un desvío humano de ±0,03; notas tras el final → recórtalas o quítalas; bajo sin fundamental → fundamental en el beat 0 del compás.',
      '4. Lo que NO es un problema y no debes tocar: micro-tiempo de hasta ±0,05 beats, duraciones desiguales, notas de paso y adornos cortos, extensiones (add9, 6, maj7, sus), velocidades variadas. Nunca cuantices una parte entera ni iguales duraciones o velocidades: eso la mata.',
      '5. Si la medición dice que una parte «suena robótica», devuélvela a su músico con devolver_trabajo (que la toque con vida); no la arregles tú. Clip que empieza a mitad de compás: muévelo con clip.move o recréalo en el beat de su sección. Pista que se apaga antes del final: devuelve la parte si falta una sección entera.',
      '6. Nunca cambies tonalidad, tempo ni forma, ni toques pistas no señaladas. Conserva la intención: corrige lo mínimo. Relee con midi.notes.get antes de informar.',
    ]),
  ],
  qa: [
    h('revision-de-partes', 'Revisar las partes', 'Al revisar lo que grabaron los músicos.', [
      '1. analysis.trackSound {}: cada pista con instrumento, sin mute/solo que la tape, volumen razonable.',
      '2. Por pista: midi.notes.get de 1–2 clips (limit 40). Comprueba: el clip empieza en el beat de su sección; pitches en la tonalidad; en el tiempo fuerte, el acorde del compás; velocidades que cambian entre verso y coro; nada después del final.',
      '3. Juzga si suena humano o a máquina (esto es un defecto real): ¿todas las notas duran lo mismo? ¿solo las 3 notas de la triada, sin extensiones ni notas de paso? ¿el mismo bloque en cada compás? ¿velocidades iguales? ¿todo clavado en la rejilla en un instrumento melódico? Si pasa cualquiera de estas, el problema es «suena robótica: …» para su músico.',
      '4. Juzga el conjunto: ¿el bajo toca la fundamental con el bombo? ¿el piano y la guitarra se pisan en el mismo registro y ritmo? ¿hay dinámica y arpegios/adornos que den vida?',
      '5. veredicto_calidad: aprobado solo si lo comprobaste; cada problema con «quien» (el músico) y el compás o sección. Nombra pistas por su nombre.',
    ]),
    h('revision-de-mezcla-y-master', 'Revisar mezcla y máster', 'Al revisar la mezcla o el máster (no juzgues el arreglo).', [
      'Mezcla: analysis.mix {} → pico de la mezcla ≤ −3 dBFS antes del máster, ninguna pista ahogada ni dominando (stems), paneo con estéreo real, envíos a reverb presentes en piano/guitarra/pads y no en bajo/bombo.',
      'Máster: analysis.loudness {} → −14 LUFS integrados (±1,5) y pico ≤ −1 dBTP; dinámica viva (rango pico−LUFS ≥ 6 dB). Volumen del máster nunca 0.',
      'Solo marca lo medido; con «quien» = mezcla o máster según toque.',
    ]),
  ],
  mezcla: [
    h('mezcla-balance-y-paneo', 'Gain staging, balance y paneo', 'Al empezar la mezcla.', [
      '1. analysis.trackSound {}: arregla antes lo que impide oír (mute/solo, volumen ~0, instrumento sin cargar).',
      '2. Punto de partida (track.update {trackId, datos: {volumen}} lineal, 1 = 0 dB): batería 0.9, bajo 0.85, piano 0.7, guitarra 0.6, cuerdas 0.55, pad 0.5, lead 0.65, voz 0.9. Ajusta oyendo los stems de analysis.mix (nada por encima de −6 dBFS de pico por pista, mezcla ≤ −3 dBFS).',
      '3. Paneo (datos.paneo −1…1): batería y bajo al centro; piano −0.2; guitarra +0.35; cuerdas y pad abiertos (−0.4/+0.4 si hay dos pistas, o ancho del propio VST); lead +0.1.',
      '4. Vuelve a medir con analysis.mix y compara con el objetivo antes de pasar a EQ.',
    ]),
    h('mezcla-eq-correctiva', 'EQ correctiva', 'Después del balance, para que las pistas no se pisen.', [
      'mix.eq {trackId, accion: "agregarBanda", tipo, freq, gain, q}: tipos bell, highpass, lowpass, lowshelf, highshelf (también en español: campana, pasa altos…). mix.eq {trackId, accion: "estado"} lista las bandas.',
      'Pasa altos en pads, guitarra, cuerdas y piano a 100–150 Hz (deja el grave para bajo y bombo). Bajo: lowshelf +2 dB a 80 Hz y corte suave a 300 Hz (−2 dB, q 1) si embarra. Bombo/batería: +2 dB a 60 Hz, −3 dB a 300–400 Hz.',
      'Piano y guitarra: −2…−3 dB en 250–400 Hz (q 1.2) si suena turbio; brillo +1.5 dB highshelf a 8 kHz en el piano. Pad: lowpass a 8–10 kHz para que no compita con el lead.',
      'Cortes antes que realces, y nunca más de ±4 dB. Comprueba con analysis.mix que el balance no cambió (si sí, retoca el volumen).',
    ]),
    h('mezcla-compresion', 'Compresión', 'Para controlar dinámica en bajo, batería y voz.', [
      'mix.compress {trackId, threshold, ratio, attack, release, makeup}. Bajo: −18 dB, 4:1, 10 ms, 100 ms, makeup 3. Batería: −12 dB, 3:1, 5 ms, 80 ms, makeup 2. Piano: −20 dB, 2:1, 20 ms, 150 ms, makeup 1 (suave). Voz: −20 dB, 3:1, 10 ms, 120 ms.',
      'No comprimas pads ni cuerdas (ya son planos). Reducción de ganancia objetivo 3–6 dB; si aplasta, sube el threshold. La compresión no debe borrar las dinámicas que los músicos tocaron.',
      'Mide después con analysis.mix: el pico de la pista debe bajar y el LUFS subir un poco.',
    ]),
    h('mezcla-espacio-y-reverb', 'Espacio y reverb por envíos', 'Para dar profundidad sin embarrar.', [
      '1. bus.create {nombre: "Reverb", tipo: "fx"} devuelve busId (uno solo para toda la mezcla; otro «Delay» si hace falta).',
      '2. send.set {trackId, busId, amount}: piano 0.25, guitarra 0.3, cuerdas 0.3, pad 0.2, lead 0.25, voz 0.2. Nada en bajo ni bombo (un envío de caja/aros de 0.1 si la batería es una sola pista: mejor 0).',
      '3. Si el bus no tiene reverb cargada, plugin.insert en el bus con una reverb instalada (JasWave Ambience) y comprueba con analysis.trackSound.',
      '4. analysis.mix: el pico no debe subir más de 1 dB por la reverb; si embarra, pasa altos del bus a 300 Hz con mix.eq {trackId: busId, accion: "agregarBanda", tipo: "highpass", freq: 300}.',
    ]),
  ],
  master: [
    h('master-a-menos-14-lufs', 'Máster a −14 LUFS', 'Siempre, al preparar el máster.', [
      '1. Mide: analysis.loudness {} (LUFS integrados y pico dBTP de la mezcla).',
      '2. Limitador: mix.limit {trackId: "master", ceiling: -1, gainIn: G, release: 100, lookahead: 5} con G = −14 − LUFS medido (máximo +8 dB; si hace falta más, la mezcla está baja: devuélvela con devolver_trabajo).',
      '3. Vuelve a medir. Objetivo −14 ±1 LUFS y pico ≤ −1 dBTP. Si el rango pico−LUFS cae por debajo de 6 dB, baja gainIn 1–2 dB: no aplastes la dinámica.',
      '4. master.update {datos: {volumen: 1}}: el fader del máster en 0 dB (nunca 0 ni valores en dB).',
      '5. Informa con los números medidos antes y después.',
    ]),
    h('master-balance-espectral', 'Balance espectral del máster', 'Si tras el limitador el conjunto suena opaco o chillón.', [
      'mix.eq {trackId: "master", accion: "agregarBanda", …} con movimientos de ±1…1.5 dB como máximo: lowshelf 100 Hz si falta cuerpo, highshelf 10 kHz +1 dB si falta aire, bell −1.5 dB a 2.5–3 kHz (q 1) si chilla.',
      'Mide con analysis.mix antes y después; si el pico sube, vuelve a mix.limit. El EQ del máster nunca sustituye a una mezcla mal equilibrada: devuélvela.',
    ]),
  ],
}

/** Habilidades de serie de un especialista: las de su rol más las de su familia de instrumento (músicos). */
export function habilidadesBaseDe(e: Pick<EspecialistaConfig, 'id' | 'nombre' | 'role' | 'instrumento' | 'skills'>): HabilidadAgente[] {
  const rol = rolProduccionDe(e.role)
  const base = POR_ROL[rol] ?? []
  if (rol !== 'musico') return base
  const fam = familiaDe(e)
  return [...base, ...(fam ? FAMILIA[fam] : [])]
}

/** Habilidades de serie por rol (para `ConfigProduccion.habilidadesPorRol`): sin las de familia, que van por participante. */
export function habilidadesBasePorRol(): Partial<Record<RolProduccion, HabilidadAgente[]>> {
  return { ...POR_ROL }
}

// ── Del usuario ───────────────────────────────────────────────────────────

const RE_AGENTES = /<!--\s*agentes?\s*:\s*([^>]+?)\s*-->/i

/** A qué agentes está asignada una habilidad del usuario («@id» en título/descripción o `<!-- agente: a, b -->`). */
export function destinatariosDeHabilidad(contenido: string): string[] {
  const cabecera = contenido.replace(/\r\n/g, '\n').split('\n').slice(0, 8).join('\n')
  const out = new Set<string>()
  for (const m of cabecera.matchAll(/(?:^|[\s(])@([a-z0-9][a-z0-9-]{1,63})/gi)) out.add(m[1]!.toLowerCase())
  const c = RE_AGENTES.exec(cabecera)
  if (c) for (const t of c[1]!.split(/[,;\s]+/)) if (t.trim()) out.add(slugAsistente(t.trim()))
  return [...out]
}

function limpiarMenciones(texto: string): string {
  return texto
    .replace(/(^|[\s(])@[a-z0-9][a-z0-9-]{1,63}/gi, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Claves con las que un especialista reconoce una asignación: su id, su nombre, su rol y «todos». */
export function clavesDe(e: Pick<EspecialistaConfig, 'id' | 'nombre' | 'role'>): Set<string> {
  const rol = rolProduccionDe(e.role)
  const claves = [e.id, slugAsistente(e.nombre), e.role, rol, 'todos', 'banda', 'all']
  if (rol === 'musico') claves.push('musicos', 'musico')
  if (rol === 'coherencia') claves.push('arreglista')
  if (rol === 'master') claves.push('mastering')
  return new Set(claves.map((c) => c.toLowerCase()))
}

/** Habilidades del usuario asignadas a este especialista (archivos activos de `habilidades/`). */
export function habilidadesUsuarioDe(e: Pick<EspecialistaConfig, 'id' | 'nombre' | 'role'>, archivos: readonly ArchivoAsistente[] = carpetaAsistente.archivos()): HabilidadAgente[] {
  const claves = clavesDe(e)
  const out: HabilidadAgente[] = []
  for (const a of archivos) {
    if (a.carpeta !== 'habilidades') continue
    if (/<!--\s*desactivad[ao]\s*-->/i.test(a.contenido)) continue
    const destinos = destinatariosDeHabilidad(a.contenido)
    if (!destinos.some((d) => claves.has(d))) continue
    const h = habilidadDesdeMarkdown(a.contenido, { id: `usuario:${a.nombre}`, nombrePorDefecto: a.nombre, origen: 'usuario' })
    if (!h) continue
    const nombre = limpiarMenciones(h.nombre) || h.nombre
    out.push({ ...h, id: slugAsistente(nombre) || h.id, nombre, descripcion: limpiarMenciones(h.descripcion) })
  }
  return out
}

/** Todo lo que sabe hacer un especialista: de serie + del usuario (la del usuario sustituye a la de serie del mismo id o nombre). */
export function habilidadesDelEspecialista(e: EspecialistaConfig, archivos?: readonly ArchivoAsistente[]): HabilidadAgente[] {
  const propias = habilidadesUsuarioDe(e, archivos)
  const pisa = (b: HabilidadAgente) => propias.some((p) => p.id === b.id || slugAsistente(p.nombre) === slugAsistente(b.nombre))
  const porId = new Map<string, HabilidadAgente>()
  for (const h of [...habilidadesBaseDe(e).filter((b) => !pisa(b)), ...propias]) porId.set(h.id, h)
  return [...porId.values()]
}

/** Plantilla de una habilidad nueva para un agente (archivo de la carpeta del asistente). */
export function plantillaHabilidad(e: Pick<EspecialistaConfig, 'id' | 'nombre'>, nombre = 'Nueva habilidad'): { ruta: string; contenido: string } {
  const slugAgente = slugAsistente(e.nombre) || e.id
  return {
    ruta: `habilidades/${slugAgente}-${slugAsistente(nombre) || 'nueva-habilidad'}.md`,
    contenido: [
      `# ${nombre}`,
      `> @${slugAgente} Cuándo debe usarla ${e.nombre} (una frase: el agente decide con esto si la lee).`,
      '',
      'Escribe aquí el método paso a paso, como se lo explicarías a un músico de sesión:',
      '1. Qué mirar antes de empezar.',
      '2. Qué tocar o ajustar (registro, ritmo, dinámica; herramientas del DAW si las conoces).',
      '3. Cómo comprobar que quedó bien.',
      '',
      `<!-- agente: ${slugAgente} -->`,
      '',
    ].join('\n'),
  }
}

// ── Skills de estilo del usuario («estilo-<slug>.md», aprendidas de su teclado MIDI) ─────────────────────────

/** Lo que guarda una skill de estilo: referencia al perfil de toque de la biblioteca y copia portátil del JSON. */
export type EstiloUsuario = {
  /** Ruta del archivo (`habilidades/estilo-<slug>.md`). */
  ruta: string
  nombre: string
  /** Id del perfil en `touch-profiles.json` (para `style.touch.apply`); puede faltar si el archivo viene de otro equipo. */
  perfilId?: string
  resumen: string
  /** Copia del perfil (JSON) — se reimporta con `style.touch.learn` si falta en la biblioteca. */
  perfil?: unknown
  /** Intensidad 0–1 con la que la banda aplica el estilo. */
  intensidad: number
  activo: boolean
}

export const PREFIJO_ESTILO = 'estilo-'

export function rutaHabilidadEstilo(nombre: string): string {
  return `habilidades/${PREFIJO_ESTILO}${slugAsistente(nombre) || 'mi-estilo'}.md`
}

/** Markdown de la habilidad «estilo-<slug>»: instrucciones para el músico + el perfil como bloque JSON. */
export function habilidadEstiloMarkdown(o: { nombre: string; resumen: string; perfilId?: string; perfil: unknown; intensidad?: number }): { ruta: string; contenido: string } {
  const nombre = o.nombre.trim() || 'Mi estilo'
  const intensidad = Math.max(0, Math.min(1, Number.isFinite(Number(o.intensidad)) ? Number(o.intensidad) : 1))
  return {
    ruta: rutaHabilidadEstilo(nombre),
    contenido: [
      `# Estilo: ${nombre}`,
      `> @musicos Cómo toca el usuario (micro-tiempos, dinámica, legato, pedal, rubato): léela antes de grabar una parte armónica o melódica.`,
      '',
      'Así toca el usuario en su teclado MIDI, medido de sus tomas reales. Tómalo como su carácter, no como una plantilla:',
      '',
      o.resumen.trim(),
      '',
      'Cómo usarlo:',
      '1. Escribe las notas con intención musical (duraciones y velocidades variadas, extensiones, pasos); no cuantices ni aplanes.',
      '2. Al terminar tu parte, la app aplica automáticamente su micro-tiempo, microdinámica, legato, offset del acorde y pedal sobre tu pista (`style.touch.apply`); no lo repitas a mano.',
      '3. La batería no se humaniza con micro-tiempo: sigue en la rejilla.',
      '',
      `<!-- agente: musicos -->`,
      `<!-- estilo-intensidad: ${intensidad} -->`,
      ...(o.perfilId ? [`<!-- estilo-perfil-id: ${o.perfilId} -->`] : []),
      '',
      '```json estilo-perfil',
      JSON.stringify(o.perfil),
      '```',
      '',
    ].join('\n'),
  }
}

/** Interpreta un archivo `habilidades/estilo-*.md`; null si no es una skill de estilo. */
export function estiloDesdeArchivo(a: Pick<ArchivoAsistente, 'ruta' | 'carpeta' | 'nombre' | 'contenido'>): EstiloUsuario | null {
  if (a.carpeta !== 'habilidades' || !/^estilo-/i.test(a.nombre.replace(/^.*[\/]/, ''))) return null
  const titulo = /^#\s*(?:Estilo:\s*)?(.+)$/m.exec(a.contenido)?.[1]?.trim() || a.nombre.replace(/^estilo-|\.md$/gi, '')
  const resumen = /medido de sus tomas reales[^\n]*\n\n([\s\S]*?)\n\nCómo usarlo:/.exec(a.contenido)?.[1]?.trim() ?? ''
  const intensidad = Number(/<!--\s*estilo-intensidad:\s*([\d.]+)\s*-->/.exec(a.contenido)?.[1])
  const perfilId = /<!--\s*estilo-perfil-id:\s*([^\s>]+)\s*-->/.exec(a.contenido)?.[1]
  let perfil: unknown
  const json = /```json estilo-perfil\s*\n([\s\S]*?)\n```/.exec(a.contenido)?.[1]
  if (json) {
    try {
      perfil = JSON.parse(json)
    } catch {
      perfil = undefined
    }
  }
  return {
    ruta: a.ruta,
    nombre: titulo,
    ...(perfilId ? { perfilId } : {}),
    resumen,
    ...(perfil !== undefined ? { perfil } : {}),
    intensidad: Number.isFinite(intensidad) ? Math.max(0, Math.min(1, intensidad)) : 1,
    activo: !/<!--\s*desactivad[ao]\s*-->/i.test(a.contenido),
  }
}

/** Skills de estilo del usuario (más reciente primero según el orden del listado). */
export function estilosDelUsuario(archivos: readonly ArchivoAsistente[] = carpetaAsistente.archivos()): EstiloUsuario[] {
  return archivos.map(estiloDesdeArchivo).filter((e): e is EstiloUsuario => e !== null)
}

/** El estilo que usa la banda: el primero activo (si hay varios, el usuario desactiva los que no quiere). */
export function estiloActivoDelUsuario(archivos?: readonly ArchivoAsistente[]): EstiloUsuario | null {
  return estilosDelUsuario(archivos).find((e) => e.activo) ?? null
}

/** Guarda la skill de estilo en la carpeta del asistente (crea o actualiza). */
export async function guardarEstiloComoHabilidad(o: { nombre: string; resumen: string; perfilId?: string; perfil: unknown; intensidad?: number }): Promise<{ ok: boolean; ruta: string; error?: string }> {
  const { ruta, contenido } = habilidadEstiloMarkdown(o)
  try {
    await carpetaAsistente.escribir(ruta, contenido)
    return { ok: true, ruta }
  } catch (e) {
    return { ok: false, ruta, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Activa o desactiva una skill de estilo (la desactivada la banda no la usa). */
export async function activarEstilo(ruta: string, activo: boolean): Promise<boolean> {
  const a = carpetaAsistente.archivo(ruta)
  if (!a) return false
  const limpio = a.contenido.replace(/<!--\s*desactivad[ao]\s*-->\s*\n?/gi, '')
  await carpetaAsistente.escribir(ruta, activo ? limpio : `${limpio.trimEnd()}\n<!-- desactivada -->\n`)
  return true
}
