/**
 * Tarjetas de fuentes (K6): los enlaces que la IA cita en una respuesta («Fuentes:» o en el texto) se muestran
 * como tarjetas con dominio y título; los de YouTube llevan miniatura y los botones «Escuchar en JasWave»
 * (acción `referencia.escuchar`: el vídeo se abre en una ventana de la app) y «Analizar referencia».
 *
 * La miniatura llega por el proceso main como `data:` URL (la CSP del renderer no admite imágenes externas).
 */

import { useEffect, useState } from 'react'
import { ExternalLink, Headphones, Link2, Loader2, Waves } from 'lucide-react'
import { executeDawActions, useDAW } from '@jaswave/host-sdk'

export type Fuente = { url: string; titulo?: string; dominio: string; videoId?: string }

const MAX_TARJETAS = 8
const RE_ENLACE_MD = /\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g
const RE_URL = /https?:\/\/[^\s<>()"'`\][]+/g

/** Id de vídeo de YouTube (watch, youtu.be, shorts, embed) o undefined. */
export function videoIdDeUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
    if (host !== 'youtube.com' && host !== 'youtu.be' && host !== 'youtube-nocookie.com') return undefined
    const v = u.searchParams.get('v')
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
    const m = /^\/(?:shorts\/|embed\/|live\/)?([A-Za-z0-9_-]{11})(?:[/?#]|$)/.exec(u.pathname)
    return m?.[1]
  } catch {
    return undefined
  }
}

function normalizar(raw: string): string | null {
  try {
    const u = new URL(raw.replace(/[.,;:!?»”’)]+$/g, ''))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

/** Enlaces http(s) de un texto: primero los `[título](url)` de Markdown, después los sueltos. */
export function extraerFuentes(texto: string): Fuente[] {
  const out: Fuente[] = []
  const agregar = (url: string, titulo?: string) => {
    const norm = normalizar(url)
    if (!norm) return
    const previa = out.find((f) => f.url === norm)
    if (previa) {
      if (!previa.titulo && titulo) previa.titulo = titulo
      return
    }
    out.push({ url: norm, titulo: titulo?.trim() || undefined, dominio: new URL(norm).hostname.replace(/^www\./, ''), videoId: videoIdDeUrl(norm) })
  }
  const t = String(texto ?? '')
  for (const m of t.matchAll(RE_ENLACE_MD)) agregar(m[2]!, m[1])
  for (const m of t.match(RE_URL) ?? []) agregar(m)
  return out
}

type PuenteWeb = {
  youtubeMiniatura?: (videoId: string) => Promise<unknown>
}
function puenteWeb(): PuenteWeb | undefined {
  return (window as unknown as { electron?: { webTools?: PuenteWeb } }).electron?.webTools
}
function abrirFuera(url: string): void {
  const e = (window as unknown as { electron?: { shellOpenExternal?: (u: string) => Promise<boolean> } }).electron
  void e?.shellOpenExternal?.(url)
}

function Miniatura({ videoId }: { videoId: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    const p = puenteWeb()
    if (!p?.youtubeMiniatura) return
    void p
      .youtubeMiniatura(videoId)
      .then((r) => {
        const resp = r as { ok?: boolean; datos?: string } | null
        if (vivo && resp?.ok && typeof resp.datos === 'string') setSrc(resp.datos)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [videoId])
  return (
    <div className="flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-black/60">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <Headphones className="size-5 text-muted-foreground" aria-hidden />}
    </div>
  )
}

export function TarjetaFuente({ fuente, onAnalizar }: { fuente: Fuente; onAnalizar?: (url: string, titulo?: string) => void }) {
  const dawStore = useDAW()
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const esVideo = Boolean(fuente.videoId)

  const escuchar = async () => {
    setAbriendo(true)
    setError(null)
    try {
      const [r] = await executeDawActions(dawStore, [{ type: 'referencia.escuchar', payload: { url: fuente.url, titulo: fuente.titulo } }], { source: 'user_confirm' })
      if (r && !r.success) setError(r.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAbriendo(false)
    }
  }

  return (
    <div data-testid="tarjeta-fuente" data-url={fuente.url} className="flex min-w-0 gap-2.5 rounded-md border border-border bg-panel-raised/70 p-2">
      {esVideo ? (
        <Miniatura videoId={fuente.videoId!} />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted/60 text-[12px] font-semibold uppercase text-muted-foreground">
          {fuente.dominio.charAt(0) || <Link2 className="size-3.5" aria-hidden />}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-foreground" title={fuente.titulo ?? fuente.url}>
            {fuente.titulo ?? fuente.url}
          </div>
          <div className="truncate text-[10px] text-muted-foreground" title={fuente.url}>
            {fuente.dominio}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {esVideo ? (
            <>
              <button
                type="button"
                onClick={() => void escuchar()}
                disabled={abriendo}
                className="inline-flex items-center gap-1 rounded-full border border-accent-amber/40 bg-accent-amber/10 px-2 py-0.5 text-[10px] font-medium text-accent-amber transition-colors hover:bg-accent-amber/20 disabled:opacity-60"
              >
                {abriendo ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Headphones className="size-3" aria-hidden />}
                Escuchar en JasWave
              </button>
              {onAnalizar ? (
                <button
                  type="button"
                  onClick={() => onAnalizar(fuente.url, fuente.titulo)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-accent-amber hover:text-foreground"
                >
                  <Waves className="size-3" aria-hidden />
                  Analizar referencia
                </button>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => abrirFuera(fuente.url)}
            title="Abrir en el navegador"
            className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink className="size-3" aria-hidden />
            Abrir
          </button>
        </div>
        {error ? <div className="text-[10px] text-red-400">{error}</div> : null}
      </div>
    </div>
  )
}

/** Tarjetas para todos los enlaces de una respuesta del asistente (nada si no hay enlaces). */
export function TarjetasFuente({ texto, onAnalizar }: { texto: string; onAnalizar?: (url: string, titulo?: string) => void }) {
  const fuentes = extraerFuentes(texto).slice(0, MAX_TARJETAS)
  if (!fuentes.length) return null
  return (
    <div data-testid="tarjetas-fuente" className="mt-2 grid gap-1.5 sm:grid-cols-2">
      {fuentes.map((f) => (
        <TarjetaFuente key={f.url} fuente={f} onAnalizar={onAnalizar} />
      ))}
    </div>
  )
}
