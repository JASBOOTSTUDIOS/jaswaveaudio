import type { HerramientaAgente } from './tipos'

/**
 * Selección de herramientas por relevancia: el agente empieza con un conjunto pequeño (los modelos débiles
 * se pierden con 100+ esquemas) y amplía con `buscar_herramientas` cuando lo necesita.
 */

const SINONIMOS: Record<string, string[]> = {
  tempo: ['bpm', 'settempo', 'setbpm'],
  bpm: ['tempo'],
  pista: ['track'],
  pistas: ['track'],
  canal: ['track', 'mixer'],
  nota: ['notes', 'midi', 'note'],
  notas: ['notes', 'midi', 'note'],
  melodia: ['midi', 'notes', 'melody'],
  acorde: ['chord', 'chords', 'harmony'],
  acordes: ['chord', 'chords', 'harmony'],
  armonia: ['chord', 'harmony'],
  clip: ['clip'],
  clips: ['clip'],
  bateria: ['drum', 'drums', 'beat'],
  ritmo: ['drum', 'groove', 'beat'],
  bajo: ['bass'],
  volumen: ['volume', 'gain', 'mixer'],
  mezcla: ['mixer', 'mix', 'volume', 'pan'],
  mezclar: ['mixer', 'mix'],
  efecto: ['fx', 'plugin', 'insert'],
  efectos: ['fx', 'plugin', 'insert'],
  reverb: ['fx', 'reverb'],
  instrumento: ['instrument', 'vst', 'plugin'],
  plugin: ['plugin', 'vst', 'fx'],
  exportar: ['render', 'export', 'bounce'],
  renderizar: ['render', 'bounce'],
  master: ['master', 'loudness', 'lufs'],
  analizar: ['analysis', 'analyze', 'summary'],
  analisis: ['analysis', 'summary'],
  borrar: ['delete', 'remove'],
  eliminar: ['delete', 'remove'],
  crear: ['create', 'add', 'new'],
  anadir: ['add', 'create'],
  agregar: ['add', 'create'],
  mover: ['move'],
  copiar: ['duplicate', 'copy'],
  duplicar: ['duplicate'],
  transponer: ['transpose'],
  cuantizar: ['quantize'],
  humanizar: ['humanize'],
  silenciar: ['mute'],
  solo: ['solo'],
  nombre: ['rename', 'name'],
  renombrar: ['rename'],
  color: ['color'],
  seleccion: ['selection'],
  cancion: ['song', 'compose', 'arrangement', 'section'],
  componer: ['compose', 'song', 'midi'],
  seccion: ['section', 'marker', 'arrangement'],
  estrofa: ['section', 'verse'],
  coro: ['section', 'chorus'],
  estilo: ['style'],
  tonalidad: ['key', 'scale'],
  escala: ['scale', 'key'],
  compas: ['timesignature', 'meter'],
  loop: ['loop'],
  reproducir: ['transport', 'play'],
  parar: ['transport', 'stop'],
  grabar: ['record'],
}

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 2)
}

function terminosConsulta(consulta: string): string[] {
  const base = palabras(consulta)
  const out = new Set(base)
  for (const p of base) for (const s of SINONIMOS[p] ?? []) out.add(s)
  return [...out]
}

function textoHerramienta(h: HerramientaAgente): { nombre: string[]; resto: string[] } {
  const nombre = palabras(h.nombre.replace(/([a-z])([A-Z])/g, '$1 $2'))
  const resto = palabras(`${h.descripcion} ${(h.etiquetas ?? []).join(' ')}`)
  return { nombre, resto }
}

/** Puntúa herramientas contra una consulta en lenguaje natural; devuelve las mejores primero. */
export function buscarHerramientas(consulta: string, catalogo: HerramientaAgente[], max = 8): HerramientaAgente[] {
  const terminos = terminosConsulta(consulta)
  if (!terminos.length) return []
  const exacta = catalogo.find((h) => normalizar(h.nombre) === normalizar(consulta.trim()))
  const puntuadas = catalogo
    .map((h) => {
      const t = textoHerramienta(h)
      let puntos = 0
      for (const term of terminos) {
        if (t.nombre.some((w) => w === term)) puntos += 4
        else if (t.nombre.some((w) => w.startsWith(term) || term.startsWith(w))) puntos += 2
        if (t.resto.some((w) => w === term)) puntos += 1
      }
      return { h, puntos }
    })
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.h.nombre.localeCompare(b.h.nombre))
    .map((x) => x.h)
  const res = exacta ? [exacta, ...puntuadas.filter((h) => h !== exacta)] : puntuadas
  return res.slice(0, max)
}

/** Conjunto inicial: herramientas base de consulta + las más relevantes para el pedido. */
export function seleccionarIniciales(
  pedido: string,
  catalogo: HerramientaAgente[],
  o: { base?: string[]; max?: number } = {},
): string[] {
  const max = o.max ?? 18
  const nombres = new Set<string>()
  for (const n of o.base ?? []) if (catalogo.some((h) => h.nombre === n)) nombres.add(n)
  for (const h of buscarHerramientas(pedido, catalogo, max)) {
    if (nombres.size >= max) break
    nombres.add(h.nombre)
  }
  return [...nombres]
}
