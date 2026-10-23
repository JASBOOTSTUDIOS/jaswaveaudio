/**
 * Primitivas visuales de los paneles de Cuenta y Administración (mismo estilo que los diálogos del DAW).
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

export function Campo({ etiqueta, ayuda, ...props }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{etiqueta}</span>
      <input
        {...props}
        className="rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
      />
      {ayuda ? <span className="text-[10px] text-muted-foreground">{ayuda}</span> : null}
    </label>
  )
}

export function Selector({ etiqueta, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta?: string; children: ReactNode }) {
  const select = (
    <select
      {...props}
      className="rounded-md border border-border bg-panel-raised px-2 py-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
    >
      {children}
    </select>
  )
  if (!etiqueta) return select
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{etiqueta}</span>
      {select}
    </label>
  )
}

export function Boton({ primario, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primario?: boolean }) {
  const base = primario
    ? 'rounded-md bg-accent-amber/20 px-2.5 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30 disabled:opacity-50'
    : 'rounded-md border border-border px-2.5 py-1.5 text-[11px] text-foreground hover:bg-panel-raised disabled:opacity-50'
  return <button type="button" {...props} className={`${base} ${className ?? ''}`} />
}

export function Seccion({ titulo, acciones, children }: { titulo: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{titulo}</h3>
        {acciones}
      </header>
      {children}
    </section>
  )
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  const color = tipo === 'error' ? 'text-red-400' : tipo === 'ok' ? 'text-accent-emerald' : 'text-muted-foreground'
  return (
    <p role={tipo === 'error' ? 'alert' : 'status'} className={`text-[11px] ${color}`}>
      {children}
    </p>
  )
}
