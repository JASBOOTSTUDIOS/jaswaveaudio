/**
 * Perfiles de mezcla por estilo (plan T), como DATOS. La mezcla inicial determinista (`automezcla.ts`) no tiene reglas
 * fijas de ningún género: aplica el perfil elegido (por el productor, por la hoja de ruta o, como último recurso, por
 * palabras del pedido). El modelo de mezcla recibe ese perfil como guion y puede modificarlo: sus decisiones mandan.
 *
 * Criterio técnico de los valores (rangos típicos del género; son un punto de partida, no un dogma):
 *  - `nivelDb`: nivel relativo de cada rol respecto de la suma (solo importan las diferencias). El cimiento (bombo,
 *    bajo, batería) y la voz/lead mandan; el acompañamiento va por debajo.
 *  - `hpfHz`: pasa-altos de los roles que no llevan graves. 90–150 Hz en worship/pop; el rock deja guitarras más llenas;
 *    el jazz y la balada filtran poco (instrumentos acústicos con cuerpo).
 *  - `recorteDb` (a 300 Hz): limpia el «barro» acumulado de 200–400 Hz; más en estilos densos, casi nada en jazz.
 *  - `objetivoEspectral`: máximo de energía bajo 250 Hz y mínimo entre 250 Hz y 6 kHz. Worship/pop/rock: graves < 42–45 %,
 *    medios+presencia > 25–30 % (una pasada real con 76 % entre 60–250 Hz y solo 3 % de medios sonaba sorda). Electrónica
 *    tolera más grave; jazz y balada piden más cuerpo en medios.
 *  - `seccion`: dB sobre el fader al inicio y fin de cada tipo de sección (coro − verso: 3 dB worship, 4 dB pop/rock,
 *    5 dB balada, ≈ 1 dB jazz).
 *  - `master`: LUFS integrado y techo true-peak. 14 LUFS streaming (worship/pop), 12 rock, 16 jazz/balada, 9 electrónica.
 */

export type RolMezcla = 'bombo' | 'bateria' | 'bajo' | 'piano' | 'guitarra' | 'cuerdas' | 'pad' | 'lead' | 'voz' | 'otro'
export const ROLES_MEZCLA: readonly RolMezcla[] = ['bombo', 'bateria', 'bajo', 'piano', 'guitarra', 'cuerdas', 'pad', 'lead', 'voz', 'otro']
export type TipoSeccion = 'intro' | 'verso' | 'precoro' | 'coro' | 'puente' | 'final' | 'otra'
export const TIPOS_SECCION: readonly TipoSeccion[] = ['intro', 'verso', 'precoro', 'coro', 'puente', 'final', 'otra']

type TablaRol<T> = Record<RolMezcla, T>

export type PerfilMezcla = {
  id: string
  nombre: string
  descripcion: string
  /** Otras palabras con las que se reconoce el estilo («adoración», «alabanza»…). */
  alias: string[]
  nivelDb: TablaRol<number>
  /** Pasa-altos (Hz) por rol; 0 = sin filtro. */
  hpfHz: TablaRol<number>
  /** Recorte (dB, ≤ 0) a 300 Hz por rol. */
  recorteDb: TablaRol<number>
  /** Realce de presencia (dB, ≥ 0) a 3,5 kHz por rol. */
  presenciaDb: TablaRol<number>
  /** Paneo base por rol (−1…1); los de un mismo rol alternan lados. */
  paneo: TablaRol<number>
  /** Multiplicador de todos los paneos (anchura de la imagen estéreo). */
  anchura: number
  /** Envío a la reverb (0–1) por rol. */
  envioReverb: TablaRol<number>
  /** Nivel del bus de reverb (dB respecto de 0 dB del fader). */
  busReverbDb: number
  objetivoEspectral: { gravesMax: number; mediosMin: number }
  seccion: Record<TipoSeccion, [number, number]>
  master: { lufs: number; picoDbtp: number }
  /** RMS objetivo de la suma antes del máster. */
  rmsSumaDb: number
  /** Cresta (pico − RMS) típica del género, si no se midió. */
  crestaDb: number
}

const rol = (o: Partial<TablaRol<number>>, resto: number): TablaRol<number> => ({
  bombo: resto, bateria: resto, bajo: resto, piano: resto, guitarra: resto, cuerdas: resto, pad: resto, lead: resto, voz: resto, otro: resto, ...o,
})

const WORSHIP: PerfilMezcla = {
  id: 'worship-moderno',
  nombre: 'Worship moderno',
  descripcion: 'Adoración contemporánea: base sobria, pads y cuerdas que abrazan, voz/melodía al frente, coro que crece ~3 dB.',
  alias: ['worship', 'adoracion', 'alabanza', 'congregacional', 'iglesia', 'cristiana'],
  nivelDb: rol({ bombo: -7, bateria: -5, bajo: -7, piano: -8, guitarra: -9, cuerdas: -10, pad: -12, lead: -5, voz: -4 }, -10),
  hpfHz: rol({ piano: 90, guitarra: 110, cuerdas: 120, pad: 150, lead: 100, voz: 90, otro: 100 }, 0),
  recorteDb: rol({ piano: -1.5, guitarra: -2, cuerdas: -2, pad: -2.5, lead: -1, otro: -1.5 }, 0),
  presenciaDb: rol({ piano: 1.5, guitarra: 2, voz: 1 }, 0),
  paneo: rol({ piano: 0.3, guitarra: -0.35, cuerdas: -0.45, pad: 0.45 }, 0),
  anchura: 1,
  envioReverb: rol({ piano: 0.22, guitarra: 0.26, cuerdas: 0.28, pad: 0.15, lead: 0.2, voz: 0.25, otro: 0.15 }, 0),
  busReverbDb: -3,
  objetivoEspectral: { gravesMax: 0.45, mediosMin: 0.25 },
  seccion: { intro: [-2.5, -1.5], verso: [-1.5, -1.5], precoro: [-1, 0], coro: [1.5, 1.5], puente: [-0.5, 2], final: [-1, -3], otra: [-1, -1] },
  master: { lufs: -14, picoDbtp: -1 },
  rmsSumaDb: -18,
  crestaDb: 12,
}

const POP: PerfilMezcla = {
  ...WORSHIP,
  id: 'pop',
  nombre: 'Pop',
  descripcion: 'Pop actual: voz y batería adelante, bajo firme, acompañamiento compacto y brillante; coro ~4 dB sobre el verso.',
  alias: ['pop', 'radio', 'comercial'],
  nivelDb: rol({ bombo: -6, bateria: -4, bajo: -6, piano: -9, guitarra: -8, cuerdas: -12, pad: -13, lead: -5, voz: -3 }, -10),
  hpfHz: rol({ piano: 100, guitarra: 120, cuerdas: 130, pad: 160, lead: 100, voz: 100, otro: 110 }, 0),
  recorteDb: rol({ piano: -2, guitarra: -2, cuerdas: -2.5, pad: -3, lead: -1, voz: -1, otro: -2 }, 0),
  presenciaDb: rol({ piano: 1.5, guitarra: 2, voz: 1.5 }, 0),
  paneo: rol({ piano: 0.35, guitarra: -0.45, cuerdas: -0.5, pad: 0.5 }, 0),
  anchura: 1.1,
  envioReverb: rol({ piano: 0.15, guitarra: 0.18, cuerdas: 0.2, pad: 0.12, lead: 0.15, voz: 0.18, otro: 0.12 }, 0),
  busReverbDb: -5,
  objetivoEspectral: { gravesMax: 0.42, mediosMin: 0.28 },
  seccion: { intro: [-3, -2], verso: [-2, -2], precoro: [-1, 0], coro: [2, 2], puente: [-1, 1.5], final: [0, -2.5], otra: [-1, -1] },
  master: { lufs: -14, picoDbtp: -1 },
  crestaDb: 11,
}

const ROCK: PerfilMezcla = {
  ...WORSHIP,
  id: 'rock',
  nombre: 'Rock',
  descripcion: 'Rock: batería y guitarras al frente y abiertas, bajo presente, teclas y cuerdas de apoyo; más fuerte y menos reverb.',
  alias: ['rock', 'metal', 'punk', 'grunge', 'indie'],
  nivelDb: rol({ bombo: -5, bateria: -3, bajo: -6, piano: -11, guitarra: -5, cuerdas: -14, pad: -15, lead: -5, voz: -3 }, -10),
  hpfHz: rol({ piano: 100, guitarra: 80, cuerdas: 140, pad: 160, lead: 100, voz: 100, otro: 110 }, 0),
  recorteDb: rol({ piano: -2, guitarra: -2.5, cuerdas: -2, pad: -3, lead: -1.5, voz: -1, otro: -2 }, 0),
  presenciaDb: rol({ piano: 1, guitarra: 2.5, voz: 1.5 }, 0),
  paneo: rol({ piano: 0.3, guitarra: -0.6, cuerdas: -0.4, pad: 0.4 }, 0),
  anchura: 1.2,
  envioReverb: rol({ piano: 0.1, guitarra: 0.1, cuerdas: 0.15, pad: 0.1, lead: 0.12, voz: 0.12, otro: 0.1 }, 0),
  busReverbDb: -7,
  objetivoEspectral: { gravesMax: 0.45, mediosMin: 0.3 },
  seccion: { intro: [-2, -1], verso: [-2, -2], precoro: [-1, 0.5], coro: [2, 2], puente: [-1, 2], final: [0, -2], otra: [-1, -1] },
  master: { lufs: -12, picoDbtp: -1 },
  crestaDb: 11,
}

const BALADA: PerfilMezcla = {
  ...WORSHIP,
  id: 'balada',
  nombre: 'Balada',
  descripcion: 'Balada íntima: piano o guitarra y voz al frente, ritmo discreto, cuerdas con espacio; mucha dinámica entre verso y coro (~5 dB).',
  alias: ['balada', 'ballad', 'intimo', 'acustica', 'romantica', 'lenta'],
  nivelDb: rol({ bombo: -11, bateria: -10, bajo: -8, piano: -5, guitarra: -8, cuerdas: -9, pad: -12, lead: -5, voz: -3 }, -10),
  hpfHz: rol({ piano: 70, guitarra: 90, cuerdas: 100, pad: 130, lead: 90, voz: 80, otro: 90 }, 0),
  recorteDb: rol({ piano: -1, guitarra: -1.5, cuerdas: -1.5, pad: -2, lead: -0.5, otro: -1 }, 0),
  presenciaDb: rol({ piano: 1, guitarra: 1.5, voz: 1 }, 0),
  paneo: rol({ piano: 0.25, guitarra: -0.3, cuerdas: -0.5, pad: 0.5 }, 0),
  anchura: 1,
  envioReverb: rol({ piano: 0.28, guitarra: 0.3, cuerdas: 0.3, pad: 0.2, lead: 0.28, voz: 0.3, otro: 0.2 }, 0),
  busReverbDb: -2,
  objetivoEspectral: { gravesMax: 0.42, mediosMin: 0.3 },
  seccion: { intro: [-3.5, -2.5], verso: [-3, -3], precoro: [-2, -0.5], coro: [2, 2], puente: [-1.5, 2.5], final: [-1, -4], otra: [-2, -2] },
  master: { lufs: -16, picoDbtp: -1 },
  rmsSumaDb: -20,
  crestaDb: 14,
}

const JAZZ: PerfilMezcla = {
  ...WORSHIP,
  id: 'jazz',
  nombre: 'Jazz',
  descripcion: 'Jazz: sonido natural y abierto, bajo y piano con cuerpo, batería ligera, casi sin filtros ni recortes; dinámica muy conservada.',
  alias: ['jazz', 'swing', 'bossa', 'blues', 'soul'],
  nivelDb: rol({ bombo: -9, bateria: -7, bajo: -5, piano: -5, guitarra: -8, cuerdas: -11, pad: -14, lead: -5, voz: -4 }, -10),
  hpfHz: rol({ piano: 50, guitarra: 70, cuerdas: 80, pad: 100, lead: 70, voz: 70, otro: 70 }, 0),
  recorteDb: rol({ pad: -1.5, cuerdas: -1, otro: -0.5 }, 0),
  presenciaDb: rol({}, 0),
  paneo: rol({ piano: -0.25, guitarra: 0.3, cuerdas: -0.4, pad: 0.4, bateria: 0 }, 0),
  anchura: 1,
  envioReverb: rol({ piano: 0.1, guitarra: 0.12, cuerdas: 0.15, pad: 0.1, lead: 0.12, voz: 0.12, otro: 0.1 }, 0),
  busReverbDb: -6,
  objetivoEspectral: { gravesMax: 0.5, mediosMin: 0.28 },
  seccion: { intro: [-1, -0.5], verso: [-0.5, -0.5], precoro: [-0.5, 0], coro: [0.5, 0.5], puente: [0, 0.5], final: [0, -1.5], otra: [0, 0] },
  master: { lufs: -16, picoDbtp: -1 },
  rmsSumaDb: -20,
  crestaDb: 16,
}

const ELECTRONICA: PerfilMezcla = {
  ...WORSHIP,
  id: 'electronica',
  nombre: 'Electrónica',
  descripcion: 'Electrónica/dance: bombo y bajo potentes, pads y leads anchos, poca dinámica; el «drop» (coro) golpea más que el verso.',
  alias: ['electronica', 'electronic', 'edm', 'dance', 'house', 'techno', 'synthwave'],
  nivelDb: rol({ bombo: -3, bateria: -5, bajo: -4, piano: -10, guitarra: -11, cuerdas: -12, pad: -9, lead: -5, voz: -4 }, -10),
  hpfHz: rol({ piano: 110, guitarra: 120, cuerdas: 130, pad: 120, lead: 100, voz: 100, otro: 110 }, 0),
  recorteDb: rol({ piano: -2, guitarra: -2, cuerdas: -2, pad: -2, lead: -1, otro: -2 }, 0),
  presenciaDb: rol({ lead: 1.5, piano: 1, guitarra: 1.5 }, 0),
  paneo: rol({ piano: 0.4, guitarra: -0.5, cuerdas: -0.6, pad: 0.6, lead: 0.15 }, 0),
  anchura: 1.3,
  envioReverb: rol({ piano: 0.2, guitarra: 0.2, cuerdas: 0.25, pad: 0.2, lead: 0.2, voz: 0.2, otro: 0.15 }, 0),
  busReverbDb: -4,
  objetivoEspectral: { gravesMax: 0.55, mediosMin: 0.18 },
  seccion: { intro: [-3, -2], verso: [-1.5, -1.5], precoro: [-1, 1], coro: [2, 2], puente: [-2, 1], final: [0, -3], otra: [-1, -1] },
  master: { lufs: -9, picoDbtp: -1 },
  rmsSumaDb: -16,
  crestaDb: 9,
}

/** Perfiles de serie. El primero es el de respaldo cuando no se puede determinar el estilo. */
export const PERFILES_MEZCLA: readonly PerfilMezcla[] = [WORSHIP, POP, ROCK, BALADA, JAZZ, ELECTRONICA]
export const PERFIL_MEZCLA_DEFECTO: PerfilMezcla = WORSHIP

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Busca un perfil por id, nombre o alias exactos (sin tildes ni mayúsculas). */
export function buscarPerfilMezcla(texto: string | undefined | null, perfiles: readonly PerfilMezcla[] = PERFILES_MEZCLA): PerfilMezcla | null {
  const t = sinTildes(String(texto ?? ''))
  if (!t) return null
  const exacto = perfiles.find((p) => sinTildes(p.id) === t || sinTildes(p.nombre) === t || p.alias.some((a) => sinTildes(a) === t))
  if (exacto) return exacto
  // El estilo declarado puede ser una frase corta («worship moderno», «pop acústico»): se busca por palabra completa.
  const palabras = new Set(t.split(/[^a-z0-9ñ]+/).filter(Boolean))
  return perfiles.find((p) => [p.id, p.nombre, ...p.alias].some((a) => sinTildes(a).split(/[^a-z0-9ñ]+/).some((w) => w.length > 2 && palabras.has(w)))) ?? null
}

export type OrigenPerfil = 'productor' | 'hoja' | 'pedido' | 'defecto'
export type PerfilElegido = { perfil: PerfilMezcla; origen: OrigenPerfil; motivo: string }

/**
 * Elige el perfil: 1) el que el productor fijó (ajuste); 2) el estilo que emitió el planificador en la hoja de ruta (o el
 * del `ConfigProduccion`); 3) como último recurso, palabras del pedido; 4) el de respaldo. Los perfiles de usuario
 * (`perfiles`) se buscan antes que los de serie con el mismo nombre.
 */
export function elegirPerfilMezcla(o: { productor?: string; estiloHoja?: string; pedido?: string; perfiles?: readonly PerfilMezcla[] }): PerfilElegido {
  const lista = [...(o.perfiles ?? []), ...PERFILES_MEZCLA]
  const p1 = buscarPerfilMezcla(o.productor, lista)
  if (p1) return { perfil: p1, origen: 'productor', motivo: `perfil elegido por el productor («${o.productor}»)` }
  const p2 = buscarPerfilMezcla(o.estiloHoja, lista)
  if (p2) return { perfil: p2, origen: 'hoja', motivo: `estilo de la hoja de ruta («${o.estiloHoja}»)` }
  const p3 = buscarPerfilMezcla(o.pedido, lista) ?? lista.find((p) => p.alias.concat([p.id]).some((a) => new RegExp(`\\b${sinTildes(a).replace(/[^a-z0-9]/g, '.')}`).test(sinTildes(o.pedido ?? ''))))
  if (p3) return { perfil: p3, origen: 'pedido', motivo: 'palabras del pedido (no se declaró un estilo)' }
  return { perfil: PERFIL_MEZCLA_DEFECTO, origen: 'defecto', motivo: 'no se pudo determinar el estilo: perfil por defecto' }
}

// ── Validación de perfiles escritos por el productor ───────────────────────────────────────────

const MAX_DB = 24
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)

function tablaDe(v: unknown, base: TablaRol<number>, nombre: string, min: number, max: number, errores: string[]): TablaRol<number> {
  if (v === undefined) return base
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    errores.push(`«${nombre}» debe ser un objeto con roles (${ROLES_MEZCLA.join(', ')}).`)
    return base
  }
  const salida = { ...base }
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!(ROLES_MEZCLA as readonly string[]).includes(k)) {
      errores.push(`«${nombre}»: rol desconocido «${k}».`)
      continue
    }
    const n = num(x)
    if (n === null || n < min || n > max) errores.push(`«${nombre}.${k}» debe ser un número entre ${min} y ${max}.`)
    else salida[k as RolMezcla] = n
  }
  return salida
}

/**
 * Valida y completa un perfil escrito a mano (JSON). Solo hace falta `id` y `nombre`; lo que falte se hereda de
 * `base` (por defecto el perfil indicado en `"base"` o el worship). Devuelve los errores en español.
 */
export function validarPerfilMezcla(entrada: unknown, perfiles: readonly PerfilMezcla[] = PERFILES_MEZCLA): { ok: true; perfil: PerfilMezcla } | { ok: false; errores: string[] } {
  const errores: string[] = []
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, errores: ['El perfil debe ser un objeto JSON.'] }
  const o = entrada as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') : ''
  const nombre = typeof o.nombre === 'string' ? o.nombre.trim() : ''
  if (!id) errores.push('Falta «id» (letras, números y guiones).')
  if (!nombre) errores.push('Falta «nombre».')
  const base = (typeof o.base === 'string' ? buscarPerfilMezcla(o.base, perfiles) : null) ?? PERFIL_MEZCLA_DEFECTO
  if (typeof o.base === 'string' && !buscarPerfilMezcla(o.base, perfiles)) errores.push(`«base» desconocida: «${o.base}» (usa ${PERFILES_MEZCLA.map((p) => p.id).join(', ')}).`)
  const perfil: PerfilMezcla = {
    ...base,
    id,
    nombre,
    descripcion: typeof o.descripcion === 'string' ? o.descripcion.slice(0, 400) : base.descripcion,
    alias: Array.isArray(o.alias) ? o.alias.filter((a): a is string => typeof a === 'string').slice(0, 12) : [],
    nivelDb: tablaDe(o.nivelDb, base.nivelDb, 'nivelDb', -40, 6, errores),
    hpfHz: tablaDe(o.hpfHz, base.hpfHz, 'hpfHz', 0, 400, errores),
    recorteDb: tablaDe(o.recorteDb, base.recorteDb, 'recorteDb', -6, 0, errores),
    presenciaDb: tablaDe(o.presenciaDb, base.presenciaDb, 'presenciaDb', 0, 4, errores),
    paneo: tablaDe(o.paneo, base.paneo, 'paneo', -1, 1, errores),
    envioReverb: tablaDe(o.envioReverb, base.envioReverb, 'envioReverb', 0, 0.6, errores),
  }
  const campo = (clave: string, min: number, max: number, actual: number): number => {
    if (o[clave] === undefined) return actual
    const n = num(o[clave])
    if (n === null || n < min || n > max) {
      errores.push(`«${clave}» debe ser un número entre ${min} y ${max}.`)
      return actual
    }
    return n
  }
  perfil.anchura = campo('anchura', 0, 1.6, base.anchura)
  perfil.busReverbDb = campo('busReverbDb', -24, 0, base.busReverbDb)
  perfil.rmsSumaDb = campo('rmsSumaDb', -30, -10, base.rmsSumaDb)
  perfil.crestaDb = campo('crestaDb', 6, 24, base.crestaDb)
  if (o.objetivoEspectral !== undefined) {
    const e = o.objetivoEspectral as Record<string, unknown>
    const g = num(e?.gravesMax)
    const m = num(e?.mediosMin)
    if (g === null || m === null || g < 0.2 || g > 0.8 || m < 0.05 || m > 0.6) errores.push('«objetivoEspectral» necesita gravesMax (0,2–0,8) y mediosMin (0,05–0,6).')
    else perfil.objetivoEspectral = { gravesMax: g, mediosMin: m }
  }
  if (o.master !== undefined) {
    const e = o.master as Record<string, unknown>
    const l = num(e?.lufs)
    const p = num(e?.picoDbtp)
    if (l === null || p === null || l < -24 || l > -6 || p < -6 || p > 0) errores.push('«master» necesita lufs (−24…−6) y picoDbtp (−6…0).')
    else perfil.master = { lufs: l, picoDbtp: p }
  }
  if (o.seccion !== undefined) {
    const s = o.seccion as Record<string, unknown>
    const salida = { ...base.seccion }
    for (const [k, v] of Object.entries(s ?? {})) {
      const par = Array.isArray(v) && v.length === 2 ? [num(v[0]), num(v[1])] : null
      if (!(TIPOS_SECCION as readonly string[]).includes(k)) errores.push(`«seccion»: tipo desconocido «${k}» (${TIPOS_SECCION.join(', ')}).`)
      else if (!par || par[0] === null || par[1] === null || Math.abs(par[0]) > MAX_DB / 2 || Math.abs(par[1]) > MAX_DB / 2) errores.push(`«seccion.${k}» debe ser [inicio, fin] en dB (±12).`)
      else salida[k as TipoSeccion] = [par[0], par[1]]
    }
    perfil.seccion = salida
  }
  return errores.length ? { ok: false, errores } : { ok: true, perfil }
}

/** Texto breve del perfil para el encargo del modelo de mezcla (guion de estilo). */
export function describirPerfilMezcla(p: PerfilMezcla): string {
  const niveles = (['bateria', 'bajo', 'piano', 'guitarra', 'cuerdas', 'pad', 'lead', 'voz'] as RolMezcla[]).map((r) => `${r} ${p.nivelDb[r]} dB`).join(', ')
  const verso = p.seccion.verso[0]
  const coro = p.seccion.coro[0]
  return [
    `Perfil «${p.nombre}»: ${p.descripcion}`,
    `Niveles relativos: ${niveles}.`,
    `Objetivo de balance: graves (< 250 Hz) < ${Math.round(p.objetivoEspectral.gravesMax * 100)} % y medios+presencia > ${Math.round(p.objetivoEspectral.mediosMin * 100)} % de la energía.`,
    `Dinámica por sección: coro ${(coro - verso).toFixed(1)} dB sobre el verso. Máster: ${p.master.lufs} LUFS, techo ${p.master.picoDbtp} dBTP.`,
  ].join(' ')
}
