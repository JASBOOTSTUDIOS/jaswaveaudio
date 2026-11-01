/**
 * Primitivas visuales de JasWave Admin con el estilo «cyber» de los VST JasWave: paneles con brillo cian,
 * rótulos finos en mayúsculas, cifras en mono, LEDs y medidores segmentados tipo VU.
 */

import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Loader2, X } from 'lucide-react'

const unir = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

// ───────────────────────────── Estructura ─────────────────────────────

export function Panel({
  titulo,
  subtitulo,
  acciones,
  children,
  className,
  activo,
  relleno = true,
}: {
  titulo?: ReactNode
  subtitulo?: ReactNode
  acciones?: ReactNode
  children?: ReactNode
  className?: string
  activo?: boolean
  relleno?: boolean
}) {
  return (
    <section className={unir('cy-panel min-w-0', activo && 'cy-panel-activo', className)}>
      {titulo || acciones ? (
        <header className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-cy-borde/50 px-4 py-3">
          <div className="min-w-0">
            {titulo ? <h3 className="cy-rotulo truncate">{titulo}</h3> : null}
            {subtitulo ? <p className="mt-0.5 truncate text-[12px] text-cy-apagado">{subtitulo}</p> : null}
          </div>
          {acciones ? <div className="flex flex-wrap items-center gap-1.5">{acciones}</div> : null}
        </header>
      ) : null}
      <div className={relleno ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

/** Cabecera de cada sección: rótulo, título grande y acciones. */
export function CabeceraSeccion({ rotulo, titulo, descripcion, acciones }: { rotulo?: string; titulo: string; descripcion?: string; acciones?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {rotulo ? <p className="cy-rotulo text-cy-cian/80">{rotulo}</p> : null}
        <h1 className="mt-1 text-[22px] font-light tracking-wide text-cy-texto md:text-[26px]">{titulo}</h1>
        {descripcion ? <p className="mt-1 max-w-2xl text-[13px] text-cy-tenue">{descripcion}</p> : null}
      </div>
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
    </header>
  )
}

/** Pestañas segmentadas (subsecciones). */
export function Segmentos<T extends string>({ valor, opciones, onCambiar, etiqueta }: { valor: T; opciones: { id: T; texto: string }[]; onCambiar: (v: T) => void; etiqueta: string }) {
  return (
    <div role="tablist" aria-label={etiqueta} className="mb-5 flex w-full gap-1 rounded-xl border border-cy-borde/70 bg-cy-negro p-1 md:w-auto md:inline-flex">
      {opciones.map((o) => (
        <button
          key={o.id}
          role="tab"
          type="button"
          aria-selected={o.id === valor}
          onClick={() => onCambiar(o.id)}
          className={unir(
            'min-h-10 flex-1 rounded-lg px-4 text-[12px] uppercase tracking-[0.16em] transition md:flex-none',
            o.id === valor ? 'bg-cy-cian/12 text-cy-cian shadow-[0_0_14px_-4px_rgba(25,217,255,0.6)] ring-1 ring-cy-cian/40' : 'text-cy-tenue hover:text-cy-texto',
          )}
        >
          {o.texto}
        </button>
      ))}
    </div>
  )
}

export function Plegable({ titulo, children, abiertoInicial = false, extra }: { titulo: ReactNode; children: ReactNode; abiertoInicial?: boolean; extra?: ReactNode }) {
  const [abierto, setAbierto] = useState(abiertoInicial)
  const id = useId()
  return (
    <div className="rounded-xl border border-cy-borde/60 bg-cy-negro/40">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((a) => !a)}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left"
      >
        <ChevronDown className={unir('size-4 text-cy-apagado transition-transform', !abierto && '-rotate-90')} />
        <span className="cy-rotulo flex-1">{titulo}</span>
        {extra}
      </button>
      {abierto ? (
        <div id={id} className="border-t border-cy-borde/40 p-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Panel lateral (escritorio/tableta) u hoja inferior (móvil) para detalles y formularios. */
export function Hoja({ abierta, onCerrar, titulo, subtitulo, children, pie }: { abierta: boolean; onCerrar: () => void; titulo: ReactNode; subtitulo?: ReactNode; children: ReactNode; pie?: ReactNode }) {
  useEffect(() => {
    if (!abierta) return
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', tecla)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', tecla)
      document.body.style.overflow = previo
    }
  }, [abierta, onCerrar])
  if (!abierta) return null
  // Portal al body: el contenido principal crea su propio contexto de apilamiento.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch" role="dialog" aria-modal="true">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-[#02030a]/75 backdrop-blur-sm" onClick={onCerrar} />
      <div className="cy-hoja relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-cy-borde/80 bg-cy-panel shadow-[0_0_40px_-10px_rgba(25,217,255,0.35)] md:max-h-none md:w-[min(560px,92vw)] md:rounded-none md:rounded-l-2xl md:border-y-0 md:border-r-0">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-cy-borde md:hidden" />
        <header className="flex items-start gap-3 border-b border-cy-borde/60 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-light tracking-wide text-cy-texto">{titulo}</h2>
            {subtitulo ? <p className="mt-0.5 truncate text-[12px] text-cy-apagado">{subtitulo}</p> : null}
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar panel" className="grid size-11 place-items-center rounded-lg text-cy-tenue hover:bg-cy-borde/40 hover:text-cy-texto md:size-9">
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {pie ? <footer className="flex flex-wrap justify-end gap-2 border-t border-cy-borde/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{pie}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}

// ───────────────────────────── Controles ─────────────────────────────

type VarianteBoton = 'primario' | 'normal' | 'peligro' | 'fantasma'

export function Boton({
  variante = 'normal',
  icono,
  cargando,
  className,
  children,
  compacto,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; icono?: ReactNode; cargando?: boolean; compacto?: boolean }) {
  const estilos: Record<VarianteBoton, string> = {
    primario:
      'border border-cy-cian/60 bg-cy-cian/12 text-cy-cian shadow-[0_0_16px_-4px_rgba(25,217,255,0.55)] hover:bg-cy-cian/20 hover:shadow-[0_0_22px_-2px_rgba(25,217,255,0.6)]',
    normal: 'border border-cy-borde bg-cy-panel2 text-cy-texto hover:border-cy-cian/40 hover:text-white',
    peligro: 'border border-cy-alerta/40 bg-cy-alerta/8 text-cy-alerta hover:bg-cy-alerta/15',
    fantasma: 'border border-transparent text-cy-tenue hover:bg-cy-borde/30 hover:text-cy-texto',
  }
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || cargando}
      className={unir(
        'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-[12px] tracking-wide transition disabled:cursor-not-allowed disabled:opacity-45 md:min-h-9',
        compacto ? 'px-2.5' : 'px-3.5',
        estilos[variante],
        className,
      )}
    >
      {cargando ? <Loader2 className="size-4 animate-spin" /> : icono}
      {children}
    </button>
  )
}

/** Botón solo con icono (objetivo táctil de 44 px en móvil). */
export function BotonIcono({ etiqueta, children, peligro, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { etiqueta: string; peligro?: boolean }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      {...props}
      className={unir(
        'grid size-11 shrink-0 place-items-center rounded-lg text-cy-apagado transition disabled:opacity-35 md:size-8',
        peligro ? 'hover:bg-cy-alerta/10 hover:text-cy-alerta' : 'hover:bg-cy-borde/40 hover:text-cy-cian',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Etiquetado({ etiqueta, ayuda, children, className }: { etiqueta?: string; ayuda?: ReactNode; children: ReactNode; className?: string }) {
  if (!etiqueta && !ayuda) return <>{children}</>
  return (
    <label className={unir('flex min-w-0 flex-col gap-1.5', className)}>
      {etiqueta ? <span className="text-[10.5px] uppercase tracking-[0.16em] text-cy-apagado">{etiqueta}</span> : null}
      {children}
      {ayuda ? <span className="text-[11px] text-cy-apagado">{ayuda}</span> : null}
    </label>
  )
}

export function Campo({ etiqueta, ayuda, className, mono, ...props }: InputHTMLAttributes<HTMLInputElement> & { etiqueta?: string; ayuda?: ReactNode; mono?: boolean }) {
  return (
    <Etiquetado etiqueta={etiqueta} ayuda={ayuda} className={className}>
      <input {...props} className={unir('cy-entrada min-h-11 md:min-h-9', mono && 'font-mono text-[12px]')} />
    </Etiquetado>
  )
}

/**
 * Texto editable en línea: parece texto normal y se convierte en campo al pasar o enfocar (sin
 * formularios ruidosos). Para nombres y descripciones visibles por los usuarios.
 */
export function TextoEditable({
  valor,
  onCambiar,
  etiqueta,
  placeholder,
  className,
  maxLength,
}: {
  valor: string
  onCambiar: (v: string) => void
  etiqueta: string
  placeholder?: string
  className?: string
  maxLength?: number
}) {
  return (
    <input
      value={valor}
      onChange={(e) => onCambiar(e.target.value)}
      aria-label={etiqueta}
      title={etiqueta}
      placeholder={placeholder}
      maxLength={maxLength}
      className={unir(
        'w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 -mx-1.5 outline-none transition placeholder:text-cy-apagado/70',
        'hover:border-cy-borde/80 hover:bg-cy-negro/40 focus:border-cy-cian/60 focus:bg-cy-negro focus:shadow-[0_0_0_3px_rgba(25,217,255,0.12)]',
        className,
      )}
    />
  )
}

export function Selector({ etiqueta, ayuda, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta?: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <Etiquetado etiqueta={etiqueta} ayuda={ayuda} className={className}>
      <select {...props} className="cy-entrada min-h-11 md:min-h-9">
        {children}
      </select>
    </Etiquetado>
  )
}

export function Casilla({ etiqueta, checked, onChange, disabled, mono }: { etiqueta: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; mono?: boolean }) {
  return (
    <label className={unir('flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 text-[13px] text-cy-texto md:min-h-8', disabled && 'opacity-50')}>
      <input type="checkbox" className="cy-check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={unir('min-w-0 truncate', mono && 'font-mono text-[12px]')}>{etiqueta}</span>
    </label>
  )
}

/** Interruptor tipo botón de encendido de un VST (LED + texto). */
export function Interruptor({ activo, onCambiar, etiqueta, textoOn = 'Activo', textoOff = 'Apagado', disabled }: { activo: boolean; onCambiar: (v: boolean) => void; etiqueta: string; textoOn?: string; textoOff?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onCambiar(!activo)}
      className={unir(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-[11px] uppercase tracking-[0.14em] transition disabled:opacity-50 md:min-h-8',
        activo ? 'border-cy-cian/50 bg-cy-cian/10 text-cy-cian' : 'border-cy-borde bg-cy-negro text-cy-apagado',
      )}
    >
      <Led estado={activo ? 'activo' : 'apagado'} />
      {activo ? textoOn : textoOff}
    </button>
  )
}

// ───────────────────────────── Indicadores ─────────────────────────────

export type EstadoLed = 'ok' | 'aviso' | 'error' | 'activo' | 'apagado'
const COLOR_LED: Record<EstadoLed, string> = {
  ok: 'bg-cy-ok shadow-[0_0_8px_1px_rgba(61,255,181,0.7)]',
  aviso: 'bg-cy-ambar shadow-[0_0_8px_1px_rgba(255,194,77,0.7)]',
  error: 'bg-cy-alerta shadow-[0_0_8px_1px_rgba(255,79,195,0.75)]',
  activo: 'bg-cy-cian shadow-[0_0_8px_1px_rgba(25,217,255,0.75)]',
  apagado: 'bg-cy-borde',
}
export function Led({ estado, titulo }: { estado: EstadoLed; titulo?: string }) {
  return <span role={titulo ? 'img' : undefined} aria-label={titulo} title={titulo} className={unir('inline-block size-2 shrink-0 rounded-full', COLOR_LED[estado])} />
}

/** Chip pequeño. */
export function Insignia({ children, tono = 'neutro', mono }: { children: ReactNode; tono?: 'neutro' | 'cian' | 'violeta' | 'ok' | 'aviso' | 'error'; mono?: boolean }) {
  const t: Record<string, string> = {
    neutro: 'border-cy-borde text-cy-tenue',
    cian: 'border-cy-cian/40 text-cy-cian bg-cy-cian/8',
    violeta: 'border-cy-violeta/50 text-[#b994ff] bg-cy-violeta/10',
    ok: 'border-cy-ok/40 text-cy-ok bg-cy-ok/8',
    aviso: 'border-cy-ambar/40 text-cy-ambar bg-cy-ambar/8',
    error: 'border-cy-alerta/40 text-cy-alerta bg-cy-alerta/8',
  }
  return <span className={unir('inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-[10.5px] tracking-wide', t[tono], mono && 'font-mono')}>{children}</span>
}

/**
 * Medidor segmentado tipo VU: cian en zona normal, ámbar cerca del límite y magenta al llegar.
 * Sin límite (ilimitado) se pinta proporcional a `escala`.
 */
export function Medidor({ usados, limite, escala, segmentos = 24, etiqueta, compacto }: { usados: number; limite: number | null; escala?: number; segmentos?: number; etiqueta?: string; compacto?: boolean }) {
  const tope = limite ?? escala ?? 0
  const fraccion = tope > 0 ? Math.min(1, usados / tope) : 0
  const encendidos = Math.round(fraccion * segmentos)
  return (
    <div className="flex min-w-0 flex-col gap-1" role="meter" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={tope || undefined} aria-valuenow={usados}>
      <div className={unir('flex gap-[2px]', compacto ? 'h-2' : 'h-3')}>
        {Array.from({ length: segmentos }, (_, i) => {
          const pos = (i + 1) / segmentos
          const encendido = i < encendidos
          const color = !encendido ? 'bg-cy-borde/40' : limite != null && pos > 0.9 ? 'bg-cy-alerta shadow-[0_0_6px_rgba(255,79,195,0.7)]' : limite != null && pos > 0.7 ? 'bg-cy-ambar shadow-[0_0_6px_rgba(255,194,77,0.6)]' : 'bg-cy-cian shadow-[0_0_6px_rgba(25,217,255,0.6)]'
          return <span key={i} className={unir('min-w-0 flex-1 rounded-[1px]', color)} />
        })}
      </div>
    </div>
  )
}

/** Cifra destacada (créditos, latencia…) con rótulo y LED opcional. */
export function Cifra({ etiqueta, valor, unidad, detalle, led }: { etiqueta: string; valor: ReactNode; unidad?: string; detalle?: ReactNode; led?: EstadoLed }) {
  return (
    <div className="cy-panel min-w-0 p-4">
      <div className="flex items-center gap-2">
        {led ? <Led estado={led} /> : null}
        <span className="cy-rotulo truncate">{etiqueta}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="truncate font-mono text-[26px] leading-none text-cy-texto tabular-nums md:text-[28px]">{valor}</span>
        {unidad ? <span className="text-[11px] uppercase tracking-widest text-cy-apagado">{unidad}</span> : null}
      </div>
      {detalle ? <div className="mt-2 truncate text-[11.5px] text-cy-apagado">{detalle}</div> : null}
    </div>
  )
}

export function Vacio({ icono, titulo, children }: { icono?: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-cy-borde/70 px-4 py-8 text-center">
      {icono ? <div className="text-cy-apagado">{icono}</div> : null}
      <p className="text-[13px] text-cy-tenue">{titulo}</p>
      {children ? <div className="text-[12px] text-cy-apagado">{children}</div> : null}
    </div>
  )
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[12px] text-cy-apagado" role="status">
      <Loader2 className="size-4 animate-spin text-cy-cian" /> {texto}
    </div>
  )
}

export function MensajeError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-cy-alerta/40 bg-cy-alerta/8 px-3 py-2 text-[12px] text-cy-alerta">
      {children}
    </p>
  )
}

export function Nota({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-cy-borde/60 bg-cy-negro/50 px-3 py-2 text-[12px] leading-relaxed text-cy-tenue">{children}</p>
}
