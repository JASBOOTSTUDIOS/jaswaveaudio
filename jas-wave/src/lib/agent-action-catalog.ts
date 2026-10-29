/**
 * Catálogo de acciones DAW que la IA (y la CLI) pueden ejecutar.
 * Incluye comandos del registry + orquestaciones solo-cliente (musicBuild, masterPass, …).
 */

import type { ToolCategory, RiskLevel } from '../../../shared/src/types/command'
import type { ToolDefinitionExtended, ToolHandler, ToolRegistry } from '../../../shared/src/ai/tool-registry'
import { toolRegistry } from '../../../shared/src/ai/tool-registry'
import { registroComandos } from '../../../shared/src/state/registro-comandos'
import { agentActionClassOfType } from '@jaswave/ai-harness'
import { A9_TOOL_NAMES } from './agent-audit-tools'

export type CatalogEntry = {
  type: string
  kind: 'command' | 'agent' | 'both'
  description: string
  examplePayload?: Record<string, unknown>
}

/** Acciones orquestadas por executeDawActions (pueden no existir en registry). */
export const AGENT_ONLY_ACTIONS: CatalogEntry[] = [
  {
    type: 'fs.readFile',
    kind: 'agent',
    description: 'Lee el contenido de un archivo en texto plano dentro del workspace del proyecto',
    examplePayload: { path: 'docs/plan.md' },
  },
  {
    type: 'fs.listDirectory',
    kind: 'agent',
    description: 'Lista los archivos y subcarpetas dentro del proyecto',
    examplePayload: { path: '' },
  },
  {
    type: 'fs.createDirectory',
    kind: 'agent',
    description: 'Crea una carpeta o estructura de carpetas anidadas dentro del proyecto',
    examplePayload: { path: 'stems/vocal' },
  },
  {
    type: 'fs.writeFile',
    kind: 'agent',
    description: 'Crea o sobrescribe un archivo dentro del proyecto de forma segura',
    examplePayload: { path: 'docs/mix-notes.md', content: '# Notas de mezcla' },
  },
  {
    type: 'fs.createScaffold',
    kind: 'agent',
    description: 'Genera el scaffold de carpetas y archivos recomendado según el género musical',
    examplePayload: { genre: 'worship' },
  },
  {
    type: 'terminal.execute',
    kind: 'agent',
    description: 'Ejecuta un comando en la terminal integrada dentro de la raíz del proyecto',
    examplePayload: { command: 'git status' },
  },
  {
    type: 'daw.musicBuild',
    kind: 'agent',
    description: 'Orquesta proyecto/MIDI/VSTs por fases',
    examplePayload: { aplicar: true, prompt: 'techno 120bpm', genero: 'techno', bpm: 120 },
  },
  {
    type: 'daw.wipeProject',
    kind: 'agent',
    description: 'Vacía el proyecto: borra todas las pistas (excepto master) con IDs reales',
    examplePayload: { aplicar: true },
  },
  {
    type: 'daw.composeProject',
    kind: 'agent',
    description: 'Compose de alto nivel (plan + build)',
    examplePayload: { aplicar: true, nombre: 'Demo', bpm: 100 },
  },
  {
    type: 'daw.composeWorship',
    kind: 'agent',
    description:
      'Produce un tema de worship moderno completo: compone (determinista, orgánico, con variaciones por sección), crea una pista por instrumento (Grand Piano, Shimmer Pad, Strings Section, Electric Bass, Worship Drums, Electric Guitar), carga un VST3 independiente en cada una y mezcla midiendo (balance por rol, paneo, master −14 LUFS con techo −1 dBTP). prompt libre o campos explícitos; la misma semilla da la misma canción. ' +
      'Tú decides la forma: secciones [{tipo,compases,progresion (grados romanos diatónicos con sus2/sus4/add9/7 e inversiones),intensidad 0..1}]. ' +
      'Para continuar lo que ya hay: inicioBeat = fin del contenido y ajustarProyecto:false (respeta tempo, tonalidad y compás). ' +
      'Con el toque del usuario: perfilToque {rol: perfilId|nombre} (de style.touch.list) se aplica a los clips de ese rol al crearlos (intensidadToque 0..1)',
    examplePayload: {
      semilla: 7,
      estilo: 'anthem',
      tonalidad: 'D',
      humanizacion: 0.7,
      roles: ['piano', 'pad', 'bajo', 'bateria', 'guitarra'],
      secciones: [
        { tipo: 'verso', compases: 8, progresion: ['Isus2', 'V/3', 'vi7', 'IVadd9'], intensidad: 0.4 },
        { tipo: 'coro', compases: 8, progresion: ['IV', 'I/3', 'V', 'vi7'], intensidad: 0.8 },
      ],
      inicioBeat: 16,
      ajustarProyecto: false,
    },
  },
  {
    type: 'daw.generateMidiSong',
    kind: 'agent',
    description: 'Genera canción MIDI en pista(s)',
    examplePayload: { aplicar: true, prompt: 'funk bass', minutos: 1 },
  },
  {
    type: 'analysis.midiPlayed',
    kind: 'agent',
    description:
      'Analiza lo que el usuario acaba de tocar en su teclado MIDI (últimos N s): notas, rango, velocidad, tempo estimado, ' +
      'micro-timing respecto a la rejilla (ms, + = tarde), flams, acordes arpegiados y legato. Úsalo para «tócalo como yo».',
    examplePayload: { segundos: 30, rejillaBeats: 0.25 },
  },
  {
    type: 'analysis.timing',
    kind: 'agent',
    description: 'Diagnóstico sync mix/ASIO (ahead, skew, buffer)',
    examplePayload: {},
  },
  {
    type: 'analysis.buffer',
    kind: 'agent',
    description:
      'Salud del buffer mix→pipe→ring→ASIO: fill, underruns, overflows, cola IPC (saturated/starving/healthy)',
    examplePayload: { sampleMs: 400, reset: true },
  },
  {
    type: 'analysis.fxBlame',
    kind: 'agent',
    description:
      'Aísla qué FX/VST degrada el audio: bypass A/B + buffer/peaks; restaura la cadena al terminar',
    examplePayload: { sampleMs: 350, settleMs: 120, includeInstruments: false },
  },
  {
    type: 'analysis.audioLens',
    kind: 'agent',
    description:
      'Analiza un audio (nota de voz adjunta o clip de audio): tonalidad, acordes, tempo y descripción. Indica audioRef (adjunto del chat) o clipId',
    examplePayload: { audioRef: 'sample-…' },
  },
  {
    type: 'analysis.voiceToMelody',
    kind: 'agent',
    description:
      'Convierte tarareo/voz en notas MIDI afinadas a la escala (YIN f0) y crea la pista/clip. Indica la fuente con audioRef (adjunto del chat) o clipId; instrumento: guitar|piano|bass|lead|strings; trackId opcional para insertar en una pista existente',
    examplePayload: { audioRef: 'sample-…', instrumento: 'piano', tonalidadRaiz: 'D', tonalidadEscala: 'mayor', cuantizar: '1/16', crearPista: true, inicioCompas: 0 },
  },
  {
    type: 'analysis.voiceToDrums',
    kind: 'agent',
    description:
      'Convierte beatbox/percusión vocal en notas MIDI de batería alineadas al tempo. Indica audioRef o clipId; crearPista o trackId para insertarlas',
    examplePayload: { audioRef: 'sample-…', cuantizar: '1/16', crearPista: true },
  },
  {
    type: 'analysis.extractMidi',
    kind: 'agent',
    description:
      'Extracción unificada de un audio: melodía f0, patrón de batería, acordes y tonalidad. tipo: melody|drums|both|all; crearPistas para insertarlas. Indica audioRef o clipId',
    examplePayload: { audioRef: 'sample-…', tipo: 'both', crearPistas: true },
  },
  {
    type: 'daw.masterPass',
    kind: 'agent',
    description: 'Cadena master + bounce + compareTarget',
    examplePayload: { target: 'streaming' },
  },
  {
    type: 'track.ganancia',
    kind: 'agent',
    description: 'Fija la ganancia de una pista en dB (valor real; lineal = 10^(dB/20))',
    examplePayload: { trackId: '…', db: 3 },
  },
  {
    type: 'pista.pan',
    kind: 'agent',
    description: 'Fija el paneo de una pista (-1 izquierda, 1 derecha)',
    examplePayload: { trackId: '…', pan: 0.3 },
  },
  {
    type: 'pista.eq.agregar',
    kind: 'agent',
    description: 'Añade/actualiza un ecualizador con hasta 24 bandas reales (freq Hz, gain dB, q, type: bell|lowShelf|highShelf|lowCut|highCut|notch|bandPass; opcionales slope, mode, solo)',
    examplePayload: { trackId: '…', bandas: [{ freq: 100, gain: 3, q: 1.4, type: 'bell', enabled: true }] },
  },
  {
    type: 'pista.eq.editar',
    kind: 'agent',
    description: 'Edita las bandas del ecualizador existente de una pista',
    examplePayload: { trackId: '…', bandas: [{ freq: 100, gain: 3, q: 1.4, type: 'bell', enabled: true }] },
  },
  {
    type: 'pista.eq.quitar',
    kind: 'agent',
    description: 'Quita el ecualizador de una pista',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'pista.eq.banda.agregar',
    kind: 'agent',
    description:
      'Agrega UNA banda al ecualizador de la pista (hasta 24; crea el EQ si falta). Tipos: bell, lowShelf, highShelf, lowCut, highCut, notch, bandPass. Opcionales: slope 12|24|36|48 (cortes), mode stereo|mid|side|left|right, solo',
    examplePayload: { trackId: '…', banda: { freq: 300, gain: -3, q: 2, type: 'bell', enabled: true, mode: 'stereo' } },
  },
  {
    type: 'pista.eq.banda.editar',
    kind: 'agent',
    description: 'Cambia solo los campos indicados de una banda del EQ (indice 0-based) y deja el resto igual',
    examplePayload: { trackId: '…', indice: 0, cambios: { gain: -4, q: 3 } },
  },
  {
    type: 'pista.eq.banda.quitar',
    kind: 'agent',
    description: 'Quita UNA banda del EQ de la pista (indice 0-based)',
    examplePayload: { trackId: '…', indice: 2 },
  },
  {
    type: 'pista.compresor.agregar',
    kind: 'agent',
    description: 'Añade/actualiza un compresor con valores reales (threshold dB, ratio :1, attack/release ms, knee, makeup dB)',
    examplePayload: { trackId: '…', threshold: -18, ratio: 4, attack: 10, release: 100, makeup: 3 },
  },
  {
    type: 'pista.compresor.editar',
    kind: 'agent',
    description: 'Edita los parámetros del compresor existente de una pista',
    examplePayload: { trackId: '…', threshold: -18, ratio: 4 },
  },
  {
    type: 'pista.compresor.quitar',
    kind: 'agent',
    description: 'Quita el compresor de una pista',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'pista.limite',
    kind: 'agent',
    description: 'Fija el techo (ceiling dBTP) y ganancia de entrada del limitador JasWave de una pista',
    examplePayload: { trackId: '…', ceiling: -1, gainIn: 0 },
  },
  {
    type: 'mix.eq',
    kind: 'agent',
    description:
      'Inserta/usa el EQ JasWave (hasta 24 bandas dinámicas) en una pista y fija parámetros reales (banda 1..24, freq Hz, gain dB, q, tipo, on, pendiente, modo, solo, output). accion: ajustar (por defecto) | agregarBanda | quitarBanda | estado (lista las bandas en uso).',
    examplePayload: { trackId: '…', accion: 'agregarBanda', freq: 3000, gain: -6, q: 1.4, tipo: 'bell' },
  },
  {
    type: 'mix.compress',
    kind: 'agent',
    description: 'Inserta/usa el compresor JasWave en una pista y fija parámetros reales (threshold dB, ratio :1, attack/release ms, knee, makeup dB, mix %).',
    examplePayload: { trackId: '…', threshold: -18, ratio: 4, attack: 10, release: 100, makeup: 3 },
  },
  {
    type: 'mix.limit',
    kind: 'agent',
    description: 'Inserta/usa el limitador true-peak JasWave en una pista/master y fija ceiling dBTP, inputGain dB, release ms, lookahead ms.',
    examplePayload: { trackId: 'master', ceiling: -1, gainIn: 6, release: 100, lookahead: 5 },
  },
  {
    type: 'master.normalizar',
    kind: 'agent',
    description: 'Normaliza el master a un objetivo LUFS real (usa medición A7b)',
    examplePayload: { objetivoLufs: -14 },
  },
  {
    type: 'audio.import',
    kind: 'agent',
    description: 'Importa archivo de audio a pista (crea pista audio si falta trackId)',
    examplePayload: { filePath: 'C:/samples/loop.wav', trackId: '…', inicio: 0 },
  },
  {
    type: 'reference.import',
    kind: 'agent',
    description: 'Importa pista de referencia A/B (muted por defecto)',
    examplePayload: { filePath: 'C:/refs/master.wav' },
  },
  {
    type: 'reference.toggleAB',
    kind: 'agent',
    description: 'Alterna escucha mix vs solo referencia',
    examplePayload: { mode: 'toggle' },
  },
  {
    type: 'midi.notes.get',
    kind: 'agent',
    description: 'Lee notas de un clip MIDI (solo lectura)',
    examplePayload: { clipId: '…', pistaId: '…', limit: 64 },
  },
  {
    type: 'midi.getClipSummary',
    kind: 'agent',
    description: 'Resumen compacto de un clip MIDI',
    examplePayload: { clipId: '…' },
  },
  {
    type: 'midi.notes.dedupe',
    kind: 'agent',
    description: 'Elimina notas duplicadas (mismo pitch+inicio) en un clip',
    examplePayload: { pistaId: '…', clipId: '…' },
  },
  {
    type: 'midi.clip.md.read',
    kind: 'agent',
    description: 'Lee el .md nota-a-nota de un clip (Docs o serializa desde el DAW)',
    examplePayload: { clipId: '…', pistaId: '…' },
  },
  {
    type: 'midi.clip.md.upsert',
    kind: 'agent',
    description: 'Escribe clip-*.md con tabla de notas (preview; no timeline hasta apply)',
    examplePayload: { clipId: '…', pistaId: '…', markdown: '---…', aplicar: false },
  },
  {
    type: 'midi.clip.md.apply',
    kind: 'agent',
    description: 'Aplica el .md del clip al DAW (midi.notes.set / clip.create)',
    examplePayload: { clipId: '…', pistaId: '…' },
  },
  {
    type: 'midi.notes.compare',
    kind: 'agent',
    description: 'Compara dos conjuntos de notas por id (clip vs md, o clipA vs clipB)',
    examplePayload: { clipId: '…', pistaId: '…', otherClipId: '…' },
  },
  {
    type: 'selection.get',
    kind: 'agent',
    description: 'Devuelve pista/clip seleccionados (solo lectura)',
    examplePayload: {},
  },
  {
    type: 'project.getSummary',
    kind: 'agent',
    description: 'Resumen del proyecto: BPM, pistas, fingerprint',
    examplePayload: {},
  },
  {
    type: 'track.list',
    kind: 'agent',
    description: 'Lista id/nombre/tipo de pistas',
    examplePayload: {},
  },
  {
    type: 'plugin.lookup',
    kind: 'agent',
    description: 'Busca VST en catálogo/web',
    examplePayload: { nombre: 'Serum' },
  },
  {
    type: 'web.search',
    kind: 'agent',
    description: 'Búsqueda web general (DuckDuckGo/Wikipedia) — solo lectura',
    examplePayload: { query: 'sidechain compression technique' },
  },
  // K6: internet para la IA (fuentes verificables y referencias musicales). Resultados = datos no confiables; cita la fuente.
  {
    type: 'web.buscar',
    kind: 'agent',
    description: 'Busca en internet (DuckDuckGo, respaldo Wikipedia) y devuelve título, enlace y resumen de cada resultado — solo lectura; cita el enlace',
    examplePayload: { q: 'historia de la bachata tempo típico', max: 5 },
  },
  {
    type: 'web.leer',
    kind: 'agent',
    description: 'Lee una página web http(s) y devuelve su texto legible (título, autor, fecha, párrafos; hasta 20 000 caracteres) — solo lectura; cita la URL',
    examplePayload: { url: 'https://es.wikipedia.org/wiki/Bachata', maxChars: 8000 },
  },
  {
    type: 'youtube.buscar',
    kind: 'agent',
    description: 'Busca vídeos en YouTube (título, canal, duración, enlace) para proponer referencias — solo lectura',
    examplePayload: { q: 'Romeo Santos Propuesta Indecente', max: 5 },
  },
  {
    type: 'youtube.ficha',
    kind: 'agent',
    description: 'Ficha de un vídeo de YouTube: título, canal, duración, descripción, capítulos y transcripción (si la hay) — solo lectura',
    examplePayload: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  },
  {
    type: 'referencia.analizar',
    kind: 'agent',
    description: 'Descarga el audio de una referencia de YouTube (yt-dlp bajo demanda, hasta 90 s del tramo más denso) y mide tempo, tonalidad, acordes, LUFS, true peak y espectro con los analizadores del DAW; informe en español con números',
    examplePayload: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  },
  {
    type: 'referencia.escuchar',
    kind: 'agent',
    description: 'Abre el vídeo de referencia en una ventana de JasWave (YouTube embebido, sin salir de la app) para escucharlo',
    examplePayload: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titulo: 'Propuesta Indecente' },
  },
  {
    type: 'plugin.probe',
    kind: 'agent',
    description: 'Prueba carga de plugin en host',
    examplePayload: { nombre: 'JasWave Roles' },
  },
  {
    type: 'plugin.snapshotState',
    kind: 'agent',
    description: 'Captura chunk/params VST del host al proyecto (todas las pistas o un slot)',
    examplePayload: {},
  },
  {
    type: 'plugin.listParameters',
    kind: 'agent',
    description: 'Lista parámetros VST de un slot',
    examplePayload: { trackId: '…', pluginInstanceId: '…' },
  },
  {
    type: 'plugin.searchParameters',
    kind: 'agent',
    description: 'Busca parámetros por nombre',
    examplePayload: { trackId: '…', query: 'cutoff' },
  },
  {
    type: 'plugin.getParameter',
    kind: 'agent',
    description: 'Lee un parámetro VST',
    examplePayload: { trackId: '…', pluginInstanceId: '…', parameterId: '0' },
  },
  {
    type: 'plugin.resetDefaults',
    kind: 'agent',
    description:
      'Devuelve un plugin (o solo los parameterIds indicados) a los valores por defecto que reporta el propio VST, en un solo paso de deshacer',
    examplePayload: { trackId: '…', pluginInstanceId: '…' },
  },
  {
    type: 'track.getFxChain',
    kind: 'agent',
    description: 'Devuelve cadena FX de una pista',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'library.preset.list',
    kind: 'agent',
    description: 'Lista presets (scope: project|global|all)',
    examplePayload: { scope: 'all' },
  },
  {
    type: 'library.preset.listGlobal',
    kind: 'agent',
    description: 'Lista presets globales cross-proyecto',
    examplePayload: {},
  },
  {
    type: 'library.preset.search',
    kind: 'agent',
    description: 'Busca presets (scope all por defecto)',
    examplePayload: { query: 'pad', scope: 'all' },
  },
  {
    type: 'library.preset.searchGlobal',
    kind: 'agent',
    description: 'Busca presets globales',
    examplePayload: { query: 'bass' },
  },
  {
    type: 'library.preset.save',
    kind: 'agent',
    description: 'Guarda preset en biblioteca del proyecto',
    examplePayload: { trackId: '…', nombre: 'Mi pad', rol: 'pad' },
  },
  {
    type: 'library.preset.saveGlobal',
    kind: 'agent',
    description: 'Guarda preset en biblioteca global (userData)',
    examplePayload: { trackId: '…', nombre: 'Trap bass', rol: 'bass', generoTags: ['trap'] },
  },
  {
    type: 'library.preset.promote',
    kind: 'agent',
    description: 'Promueve preset de proyecto a global',
    examplePayload: { presetId: '…' },
  },
  {
    type: 'library.preset.apply',
    kind: 'agent',
    description: 'Aplica preset (global o proyecto) a pista',
    examplePayload: { presetId: '…', trackId: '…' },
  },
  {
    type: 'library.preset.audition',
    kind: 'agent',
    description: 'Audiciona preset',
    examplePayload: { presetId: '…', bars: 2 },
  },
  {
    type: 'library.preset.saveFxChainGlobal',
    kind: 'agent',
    description: 'Guarda cadena FX completa en biblioteca global',
    examplePayload: { trackId: '…', nombre: 'Vocal chain' },
  },
  {
    type: 'style.profile.list',
    kind: 'agent',
    description: 'Lista perfiles de estilo (scope: project|global|all)',
    examplePayload: { scope: 'all' },
  },
  {
    type: 'style.profile.search',
    kind: 'agent',
    description: 'Busca perfiles de estilo por query/rol/tag',
    examplePayload: { query: 'funk', rol: 'drums', scope: 'all' },
  },
  {
    type: 'style.profile.saveFromClip',
    kind: 'agent',
    description: 'Extrae StyleProfile del clip MIDI (sin embeber notas) y lo guarda',
    examplePayload: { pistaId: '…', clipId: '…', nombre: 'Mi groove', tags: ['funk'], global: false },
  },
  {
    type: 'style.profile.apply',
    kind: 'agent',
    description: 'Aplica priors del perfil al clip (genera variación, no copia MIDI origen)',
    examplePayload: { profileId: '…', pistaId: '…', clipId: '…', replace: true },
  },
  {
    type: 'analysis.touch',
    kind: 'agent',
    description:
      'Analiza el TOQUE del usuario (solo lectura) en sus clips MIDI (clipIds / todos los de trackId) o en lo que acaba de tocar ' +
      '(segundos, como analysis.midiPlayed): micro-timing en ms por posición métrica (fuerte/débil/contratiempo/subdivisión), ' +
      'acordes arpegiados (orden grave→agudo, ms entre notas), microdinámica (por posición, voz superior/bajo, curva de arpegios), ' +
      'articulación legato/staccato y ataque de frase. Devuelve informe + perfil con confianza',
    examplePayload: { trackId: '…', clipIds: ['…'], instrumento: 'piano' },
  },
  {
    type: 'analysis.performance',
    kind: 'agent',
    description:
      'Informe completo (solo lectura) de cómo tocó el usuario: la toma grabada con «Grabar toma» (toma: true, o por defecto si existe), ' +
      'los últimos N s (segundos) o clips (clipIds/trackId). Devuelve texto en español y datos: perfil de toque v2 (micro-tiempo por ' +
      'posición y por voz, dinámica por mano, rubato por compás, pedal CC64), y acordes tocados como pitches agrupados con nombre cromático ' +
      '(p. ej. Dm7/F). Úsalo para «dime cómo toco», «qué acordes toqué» o antes de style.skill.save',
    examplePayload: { toma: true },
  },
  {
    type: 'style.skill.save',
    kind: 'agent',
    description:
      'Guarda la forma de tocar del usuario como SKILL DE ESTILO en la carpeta del asistente (habilidades/estilo-<nombre>.md, para todos ' +
      'los agentes): analiza la toma / últimos segundos / clips (como analysis.performance) y escribe el perfil y su descripción. ' +
      'La banda lo aplica a sus partes («con mi estilo»). nombre obligatorio; mismo nombre → actualiza',
    examplePayload: { nombre: 'Mi worship', toma: true },
  },
  {
    type: 'style.touch.learn',
    kind: 'agent',
    description:
      'Aprende y GUARDA el toque del usuario como perfil reutilizable (biblioteca global del usuario). Mismos orígenes que analysis.touch + nombre. ' +
      'Mismo nombre → actualiza. Devuelve {perfilId, nombre, resumen}. Un perfil por instrumento (piano, bajo, batería…)',
    examplePayload: { trackId: '…', nombre: 'Mi toque piano', instrumento: 'piano' },
  },
  {
    type: 'style.touch.apply',
    kind: 'agent',
    description:
      'Aplica un perfil de toque (perfilId o nombre) a un clip MIDI (clipId) o a todos los de la pista: reescribe timing, velocidad, ' +
      'duración y arpegiado de acordes para que suene como el usuario (un solo undo). intensidad 0..1 (1 = toque completo)',
    examplePayload: { nombre: 'Mi toque piano', trackId: '…', clipId: '…', intensidad: 0.9 },
  },
  {
    type: 'style.touch.list',
    kind: 'agent',
    description: 'Lista los perfiles de toque guardados (perfilId, nombre, instrumento, confianza, resumen)',
    examplePayload: {},
  },
  {
    type: 'score.exportClip',
    kind: 'agent',
    description: 'Exporta partitura PDF del clip MIDI (diálogo o ruta)',
    examplePayload: { pistaId: '…', clipId: '…' },
  },
  {
    type: 'score.exportProject',
    kind: 'agent',
    description: 'Exporta un PDF por cada clip MIDI a una carpeta (scores/)',
    examplePayload: { folderPath: '…', includeProject: false },
  },
  {
    type: 'doc.list',
    kind: 'agent',
    description: 'Lista docs del agente',
    examplePayload: {},
  },
  {
    type: 'doc.read',
    kind: 'agent',
    description: 'Lee un doc (plan.md, …)',
    examplePayload: { slug: 'plan.md' },
  },
  {
    type: 'doc.create',
    kind: 'agent',
    description: 'Crea doc',
    examplePayload: { slug: 'notas.md', content: '# Notas\n' },
  },
  {
    type: 'doc.write',
    kind: 'agent',
    description: 'Escribe doc completo',
    examplePayload: { slug: 'plan.md', content: '# Plan\n' },
  },
  {
    type: 'doc.append',
    kind: 'agent',
    description: 'Añade texto a un doc',
    examplePayload: { slug: 'plan.md', content: '\n- item\n' },
  },
  {
    type: 'doc.evaluate',
    kind: 'agent',
    description: 'Evalúa plan vs DAW',
    examplePayload: {},
  },
  {
    type: 'track.setParent',
    kind: 'agent',
    description:
      'Mete una pista en una carpeta-bus (padreId = id de una pista tipo carpeta; null la saca). La carpeta suma sus pistas, ' +
      'aplica sus FX y su fader; su mute/solo se hereda.',
    examplePayload: { trackId: '…', padreId: '…' },
  },
  {
    type: 'track.addVstLayer',
    kind: 'agent',
    description:
      'Añade otro instrumento VST3 a la pista (capa: p. ej. piano + pad). Todas las capas reciben el mismo MIDI y se suman antes de los FX.',
    examplePayload: { trackId: '…', nombre: 'JasWave Shimmer Pad' },
  },
  {
    type: 'track.freeze',
    kind: 'agent',
    description: 'Congela pista (bounce→clip + bypass)',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'clip.setMute',
    kind: 'agent',
    description: 'Silencia o activa clips (no suenan ni se exportan). Un paso de undo para todos.',
    examplePayload: { cambios: [{ pistaId: '…', clipId: '…', silenciado: true }] },
  },
  {
    type: 'clip.setFade',
    kind: 'agent',
    description: 'Fundido de entrada/salida de un clip de audio en SEGUNDOS, curva lineal|exponencial|logaritmica',
    examplePayload: { pistaId: '…', clipId: '…', tipo: 'in', duracion: 0.5, curva: 'exponencial' },
  },
  {
    type: 'clip.setGain',
    kind: 'agent',
    description: 'Ganancia de un clip de audio en dB (−48 a +24), antes del fader',
    examplePayload: { pistaId: '…', clipId: '…', gananciaDb: -3 },
  },
  {
    type: 'clip.setReverse',
    kind: 'agent',
    description: 'Reproduce al revés clips de audio (sin tocar el archivo)',
    examplePayload: { cambios: [{ pistaId: '…', clipId: '…', inverso: true }] },
  },
  {
    type: 'midi.notes.mute',
    kind: 'agent',
    description: 'Silencia (mute:true) o activa notas concretas de un clip MIDI; sin mute alterna',
    examplePayload: { pistaId: '…', clipId: '…', noteIds: ['…'], mute: true },
  },
  {
    type: 'midi.notes.split',
    kind: 'agent',
    description: 'Corta en dos las notas que cruzan `beat` (relativo al clip); noteIds opcional',
    examplePayload: { pistaId: '…', clipId: '…', beat: 2 },
  },
  {
    type: 'midi.zones.get',
    kind: 'agent',
    description: 'Lee las zonas MIDI del teclado (splits, capas, transposición), la seguridad del máster y el bloqueo Directo',
    examplePayload: {},
  },
  {
    type: 'midi.zones.set',
    kind: 'agent',
    description:
      'Sustituye las zonas MIDI (de una pista si das pistaId, o todas). Cada zona: pistaId, lo, hi (0-127), transposicion (semitonos), curvaVelocidad (lineal|suave|dura|fija), escalaVelocidad, canalEntrada/canalSalida (1-16, opcional). Split = rangos distintos; capa = mismo rango en dos pistas.',
    examplePayload: {
      zonas: [
        { pistaId: '…bajo', lo: 21, hi: 59, transposicion: -12 },
        { pistaId: '…piano', lo: 60, hi: 108, curvaVelocidad: 'suave' },
      ],
    },
  },
  {
    type: 'midi.zones.add',
    kind: 'agent',
    description: 'Añade una zona MIDI a una pista (rango lo-hi, transposición, curva de velocidad)',
    examplePayload: { pistaId: '…', lo: 60, hi: 108, transposicion: 0 },
  },
  {
    type: 'midi.zones.update',
    kind: 'agent',
    description: 'Cambia campos de una zona MIDI existente (lo, hi, transposicion, curvaVelocidad, pistaId, activa…)',
    examplePayload: { zonaId: '…', cambios: { hi: 64, transposicion: 12 } },
  },
  {
    type: 'midi.zones.remove',
    kind: 'agent',
    description: 'Quita una zona MIDI',
    examplePayload: { zonaId: '…' },
  },
  {
    type: 'directo.panic',
    kind: 'agent',
    description: 'PANIC: apaga todas las notas de todos los instrumentos y descarta el MIDI pendiente (notas colgadas)',
    examplePayload: {},
  },
  {
    type: 'directo.setSafety',
    kind: 'agent',
    description: 'Limitador true-peak del máster solo para monitorizar en directo (no entra en el bounce). techoDb entre -24 y 0 (defecto -0.5)',
    examplePayload: { activa: true, techoDb: -0.5 },
  },
  {
    type: 'directo.setLock',
    kind: 'agent',
    description: 'Modo Directo: bloquea (true) o libera (false) borrar, deshacer, cortar, pegar y duplicar mientras se toca en vivo',
    examplePayload: { bloqueo: true },
  },
  {
    type: 'export.midi',
    kind: 'agent',
    description:
      'Exporta notas MIDI a un .mid estándar (tipo 1, una pista por pista, batería en canal 10). Sin trackIds/clipId: todo el proyecto.',
    examplePayload: { ruta: 'D:/Exports/cancion.mid', trackIds: ['…'] },
  },
  {
    type: 'export.projectBundle',
    kind: 'agent',
    description: 'Empaqueta el proyecto y todo su audio en un .zip que se abre en cualquier equipo',
    examplePayload: { ruta: 'D:/Exports/cancion.jaswave.zip' },
  },
  {
    type: 'track.unfreeze',
    kind: 'agent',
    description: 'Descongela pista',
    examplePayload: { trackId: '…' },
  },
  {
    type: 'audio.listDevices',
    kind: 'agent',
    description: 'Lista backends/dispositivos de audio del host',
    examplePayload: {},
  },
  {
    type: 'audio.getDevice',
    kind: 'agent',
    description: 'Dispositivo de audio actual',
    examplePayload: {},
  },
  {
    type: 'audio.setDevice',
    kind: 'agent',
    description: 'Aplica backend/dispositivo (refleja en proyecto/UI)',
    examplePayload: { backend: 'asio', deviceId: '…', sampleRate: 48000, bufferSize: 512 },
  },
  {
    type: 'audio.ensureBest',
    kind: 'agent',
    description: 'Elige ASIO óptimo (UMC…) o WASAPI y sincroniza UI',
    examplePayload: { preferName: 'UMC' },
  },
  {
    type: 'audio.armNative',
    kind: 'agent',
    description: 'Arma clips/Roles → pipe → ASIO (sync nativo)',
    examplePayload: {},
  },
  {
    type: 'audio.clearQuarantine',
    kind: 'agent',
    description: 'Limpia VST aislados tras crash del host y restaura ASIO + mix',
    examplePayload: {},
  },
  // Herramientas de respaldo (A1, agent-fallback-tools.ts): solo calculan propuestas.
  {
    type: 'fallback.userIntent',
    kind: 'agent',
    description: 'Respaldo determinista: propone acciones a partir del pedido (tempo, musicBuild, edición MIDI). No muta.',
    examplePayload: { text: 'canción pop 100 bpm', mode: 'create' },
  },
  {
    type: 'fallback.styleEnhance',
    kind: 'agent',
    description: 'Propone realce de groove/estilo de la batería según el pedido (ghost notes, hats, fills). No muta.',
    examplePayload: { text: 'más groove con ghost notes' },
  },
  {
    type: 'fallback.midiClipEdit',
    kind: 'agent',
    description: 'Propone ediciones MIDI de clips según el pedido (suavizar, intro, pads). No muta.',
    examplePayload: { text: 'suaviza la intro' },
  },
  {
    type: 'fallback.sectionSplit',
    kind: 'agent',
    description: 'Propone partir clips MIDI largos en secciones. No muta.',
    examplePayload: {},
  },
  {
    type: 'fallback.midiAuditFix',
    kind: 'agent',
    description: 'Propone quitar notas MIDI duplicadas detectadas por la auditoría. No muta.',
    examplePayload: {},
  },

  // ── A9 · Auditoría y progreso ───────────────────────────────────────────────
  {
    type: 'plan.get',
    kind: 'agent',
    description: 'Plan estructurado (pasos, estados, criterios y evidencia)',
  },
  {
    type: 'plan.status',
    kind: 'agent',
    description: '% completado, paso actual, bloqueos',
  },
  {
    type: 'plan.updateStep',
    kind: 'agent',
    description: 'Actualiza un paso (marcar hecho exige audit.step + evidencia)',
    examplePayload: { id: 'S1', estado: 'hecho', evidencia: ['LUFS -14.0'] },
  },
  {
    type: 'plan.addStep',
    kind: 'agent',
    description: 'Añade un paso pendiente al plan',
    examplePayload: { titulo: 'Ajustar balance', fase: 'Mezcla', agente: 'mezcla', criterios: ['LUFS -14 ±1'] },
  },
  {
    type: 'plan.proposeChange',
    kind: 'agent',
    description: 'Propone replan (requiere aprobación)',
    examplePayload: { motivo: 'Necesita más paso para EQ', pasos: [{ titulo: 'EQ guitarra' }] },
  },
  {
    type: 'run.log',
    kind: 'agent',
    description: 'Bitácora del turno con agente/herramienta/estado/duración',
  },
  {
    type: 'run.diff',
    kind: 'agent',
    description: 'Diff semántico (pistas, clips, notas, plugins, mezcla, ruteo)',
    examplePayload: { desde: 'turno' },
  },
  {
    type: 'audit.project',
    kind: 'agent',
    description: 'Auditoría del proyecto (estructural + bloqueantes)',
    examplePayload: { incluirMix: true },
  },
  {
    type: 'audit.mix',
    kind: 'agent',
    description: 'Auditoría de mezcla con tendencia vs medición anterior',
  },
  {
    type: 'audit.step',
    kind: 'agent',
    description: 'Evalúa criterios de aceptación de un paso',
    examplePayload: { stepId: 'S1' },
  },
  {
    type: 'audit.history',
    kind: 'agent',
    description: 'Serie de mediciones y tendencia',
    examplePayload: { metrica: 'lufs', limite: 50 },
  },
  {
    type: 'audit.compareReference',
    kind: 'agent',
    description: 'Comparación contra pista de referencia',
  },
  {
    type: 'session.summary',
    kind: 'agent',
    description: 'Resumen compacto para retomar sesión/turno',
  },
]

/** Tipos que executeDawActions entiende (unión útil para list/filter). */
export const KNOWN_AGENT_ACTION_TYPES: string[] = [
  'project.setBpm',
  'project.setTimeSignature',
  'ui.setZoom',
  'track.create',
  'track.delete',
  'daw.wipeProject',
  'track.move',
  'track.update',
  'track.setParent',
  'track.addVstLayer',
  'track.toggleMute',
  'track.toggleSolo',
  'track.toggleArm',
  'transport.toggle',
  'transport.stop',
  'transport.toggleLoop',
  'transport.toggleMetronome',
  'transport.toggleRecord',
  'transport.togglePunch',
  'transport.toggleCountIn',
  'transport.seek',
  'master.update',
  'clip.create',
  'clip.split',
  'clip.merge',
  'midi.clip.splitIntoSections',
  'clip.resize',
  'clip.delete',
  'clip.move',
  'clip.setMute',
  'clip.setFade',
  'clip.setGain',
  'clip.setReverse',
  'midi.notes.mute',
  'midi.notes.split',
  'midi.notes.set',
  'midi.clip.create',
  'midi.transpose',
  'midi.quantize',
  'midi.humanize',
  'midi.setVelocity',
  'midi.deleteNotes',
  'midi.createNotes',
  'midi.notes.dedupe',
  'midi.clip.md.apply',
  'midi.makeStaccato',
  'midi.makeLegato',
  'midi.repeatPattern',
  'midi.reverse',
  'midi.invert',
  'midi.timeStretch',
  'midi.constrainScale',
  'midi.generatePattern',
  'midi.applyGroove',
  'midi.setCC',
  'midi.setPitchBend',
  'plugin.insert',
  'plugin.remove',
  'plugin.move',
  'plugin.bypass',
  'plugin.duplicate',
  'plugin.replace',
  'plugin.setParameter',
  'fxChain.copy',
  'fxChain.paste',
  'fxChain.loadPreset',
  'fxChain.savePreset',
  'render.start',
  'render.cancel',
  'render.getStatus',
  'analysis.loudness',
  'analysis.compareTarget',
  'analysis.spectrum',
  'analysis.stereo',
  'analysis.fullReport',
  'analysis.track',
  'analysis.mix',
  'analysis.masking',
  'analysis.dynamics',
  'analysis.section',
  'analysis.reference',
  'analysis.diagnose',
  'analysis.trackSound',
  'analysis.timing',
  'analysis.midiPlayed',
  'analysis.buffer',
  'analysis.fxBlame',
  'analysis.audioLens',
  'analysis.voiceToDrums',
  'analysis.voiceToMelody',
  'analysis.extractMidi',
  'marker.create',
  // K2 · acordes, letra y marcadores en el arreglo
  'marker.update',
  'marker.remove',
  'chords.set',
  'chords.get',
  'lyrics.set',
  'lyrics.get',
  'chords.upsert',
  'chords.remove',
  'chords.move',
  'lyrics.setPhrases',
  'lyrics.alignTiming',
  'lyrics.setChords',
  'lyrics.clear',
  'automation.setCurve',
  'automation.writePoint',
  'automation.clear',
  'bus.create',
  'send.set',
  'sidechain.connect',
  // A7c · actuación con valores reales
  'track.ganancia',
  'pista.pan',
  'pista.eq.agregar',
  'pista.eq.editar',
  'pista.eq.quitar',
  'pista.eq.banda.agregar',
  'pista.eq.banda.editar',
  'pista.eq.banda.quitar',
  'pista.compresor.agregar',
  'pista.compresor.editar',
  'pista.compresor.quitar',
  'pista.limite',
  'mix.eq',
  'mix.compress',
  'mix.limit',
  'master.normalizar',
  'take.folder.ensure',
  'take.add',
  'take.delete',
  'take.rename',
  'take.preview',
  'comp.segment.set',
  'comp.segment.clear',
  'transport.setRecordMode',
  'track.freeze',
  'track.unfreeze',
  'audio.listDevices',
  'audio.getDevice',
  'audio.setDevice',
  'audio.ensureBest',
  'audio.armNative',
  'audio.clearQuarantine',
  'project.new',
  'project.update',
  'project.save',
  'project.saveAs',
  'project.load',
  'midi.notes.patch',
  'midi.getNotes',
  ...AGENT_ONLY_ACTIONS.map((a) => a.type),
  ...A9_TOOL_NAMES,
]

export function mergeActionCatalog(
  registryTypes: Array<{ type: string; description?: string; risk?: string }>,
): CatalogEntry[] {
  const byType = new Map<string, CatalogEntry>()
  for (const t of KNOWN_AGENT_ACTION_TYPES) {
    byType.set(t, {
      type: t,
      kind: 'agent',
      description: AGENT_ONLY_ACTIONS.find((a) => a.type === t)?.description ?? t,
      examplePayload: AGENT_ONLY_ACTIONS.find((a) => a.type === t)?.examplePayload,
    })
  }
  for (const r of registryTypes) {
    const prev = byType.get(r.type)
    byType.set(r.type, {
      type: r.type,
      kind: prev ? 'both' : 'command',
      description: r.description || prev?.description || r.type,
      examplePayload: prev?.examplePayload,
    })
  }
  for (const a of AGENT_ONLY_ACTIONS) {
    if (!byType.has(a.type)) byType.set(a.type, a)
    else {
      const cur = byType.get(a.type)!
      byType.set(a.type, {
        ...cur,
        kind: cur.kind === 'command' ? 'both' : cur.kind,
        description: a.description || cur.description,
        examplePayload: a.examplePayload ?? cur.examplePayload,
      })
    }
  }
  return [...byType.values()].sort((a, b) => a.type.localeCompare(b.type))
}


function categoryFromType(type: string): ToolCategory {
  const p = type.split('.')[0] ?? 'ai'
  if (p === 'transport') return 'transport'
  if (p === 'track') return 'track'
  if (p === 'clip') return 'clip'
  if (p === 'midi') return 'midi'
  if (p === 'plugin' || p === 'fxChain') return 'plugin'
  if (p === 'automation') return 'automation'
  if (p === 'ui') return 'ui'
  if (p === 'audio' || p === 'render' || p === 'analysis' || p === 'bus' || p === 'send' || p === 'sidechain' || p === 'take' || p === 'comp' || p === 'reference' || p === 'master') {
    return 'audio'
  }
  return 'ai'
}

/**
 * Riesgo derivado de la política única del agente (@jaswave/ai-harness AGENT_ACTION_CLASSES):
 * read → read; write → write; destructive/system/sin clase → dangerous (fail closed).
 */
function riskFromType(type: string): RiskLevel {
  const cls = agentActionClassOfType(type)
  if (cls === 'read') return 'read'
  if (cls === 'write') return 'write'
  return 'dangerous'
}

const deferredHandler: ToolHandler = async () => ({
  success: false,
  error: { code: 'DEFERRED', message: 'Ejecutar vía executeDawActions / Command System' },
  events: [],
})

/** Handler que delega al Command System (ADR-0017 smoke path). */
const viaCommand =
  (type: string): ToolHandler =>
  async (params, ctx) => {
    try {
      const r = await ctx.commandExecutor.execute(type, (params ?? {}) as Record<string, unknown>, ctx.source)
      // Sin comando en esta tienda (acción solo del agente, p. ej. track.addVstLayer): la resuelve executeDawActions.
      const codigo = (r as { error?: { code?: string } }).error?.code
      if (!r.success && codigo === 'COMMAND_NOT_FOUND') return deferredHandler(params, ctx)
      return {
        success: r.success,
        data: r.result,
        error: r.success
          ? undefined
          : {
              code: 'CMD',
              message: String((r as { error?: { message?: string } }).error?.message ?? 'falló'),
            },
        events: [],
      }
    } catch (e) {
      return {
        success: false,
        error: { code: 'CMD', message: e instanceof Error ? e.message : String(e) },
        events: [],
      }
    }
  }

/**
 * Registra el catálogo agente en un Tool Registry.
 * Si el tipo existe en el Command Registry → handler real (viaCommand).
 * Si no (orquestaciones agent-only) → DEFERRED → Tool Runner cae al switch legacy.
 */
export function registerAgentCatalogOnRegistry(
  registry: ToolRegistry,
  types: string[] = KNOWN_AGENT_ACTION_TYPES,
  commandRegistry: { get(type: string): unknown } = registroComandos,
): void {
  const desc = new Map(AGENT_ONLY_ACTIONS.map((a) => [a.type, a]))
  for (const type of types) {
    if (registry.get(type)) continue
    const meta = desc.get(type)
    const def: ToolDefinitionExtended = {
      name: type,
      type,
      description: meta?.description ?? type,
      category: categoryFromType(type),
      risk: riskFromType(type),
      version: '1.0.0',
      tags: ['agent-catalog'],
    }
    const hasCommand = Boolean(commandRegistry.get(type))
    registry.register(def, hasCommand ? viaCommand(type) : deferredHandler)
  }
}

export function registerAgentCatalogTools(): void {
  registerAgentCatalogOnRegistry(toolRegistry)
}
