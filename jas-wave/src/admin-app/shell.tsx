/**
 * Marco de JasWave Admin: sidebar izquierdo en escritorio y tableta (≥768 px); en móvil, barra inferior
 * fija con las 4 secciones principales y un botón «Menú» que abre una hoja con todas las secciones.
 */

import { useState, type ReactNode } from 'react'
import { LogOut, Menu, Sparkles } from 'lucide-react'
import { JASWAVE_APP_ICON_SRC } from '@/components/brand'
import { GRUPOS, SECCIONES, esIA, type IdSeccion } from './navegacion'
import { Hoja } from './ui'

const unir = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

function Marca({ compacta }: { compacta?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-cy-cian/40 bg-cy-negro shadow-[0_0_15px_rgba(25,217,255,0.25)]">
        <img src={JASWAVE_APP_ICON_SRC} alt="" className="size-6 object-contain" draggable={false} />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[14px] font-semibold uppercase tracking-[0.2em] text-cy-texto">
          Jas<span className="cy-marca">Wave</span>
        </div>
        {!compacta ? <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cy-cian/80">Admin</div> : null}
      </div>
      {compacta ? <span className="rounded border border-cy-cian/30 bg-cy-cian/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-cy-cian">ADMIN</span> : null}
    </div>
  )
}

function ElementoNav({ id, activo, onIr }: { id: IdSeccion; activo: boolean; onIr: (s: IdSeccion) => void }) {
  const s = SECCIONES[id]
  const Icono = s.icono
  return (
    <button
      type="button"
      onClick={() => onIr(id)}
      aria-current={activo ? 'page' : undefined}
      className={unir(
        'group relative flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] transition md:min-h-10',
        activo ? 'bg-cy-cian/10 text-cy-cian' : 'text-cy-tenue hover:bg-cy-borde/30 hover:text-cy-texto',
      )}
    >
      {activo ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-cy-cian shadow-[0_0_10px_rgba(25,217,255,0.9)]" /> : null}
      <Icono className={unir('size-[18px] shrink-0', activo ? 'drop-shadow-[0_0_6px_rgba(25,217,255,0.8)]' : 'text-cy-apagado group-hover:text-cy-tenue')} />
      <span className="truncate tracking-wide">{s.titulo}</span>
    </button>
  )
}

function ListaSecciones({ actual, onIr }: { actual: IdSeccion; onIr: (s: IdSeccion) => void }) {
  return (
    <nav aria-label="Secciones" className="flex flex-col gap-5">
      {GRUPOS.map((g) => (
        <div key={g.titulo} className="flex flex-col gap-0.5">
          <p className="cy-rotulo mb-1.5 px-3 text-[9.5px] text-cy-apagado">{g.titulo}</p>
          {g.secciones.map((id) => (
            <ElementoNav key={id} id={id} activo={actual === id} onIr={onIr} />
          ))}
        </div>
      ))}
    </nav>
  )
}

function Usuario({ email, onSalir }: { email: string; onSalir: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-cy-borde/60 bg-cy-negro/60 p-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cy-violeta via-cy-azul to-cy-cian text-[13px] font-semibold uppercase text-white">
        {email.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-cy-texto">{email}</p>
        <p className="font-mono text-[10px] uppercase tracking-wider text-cy-cian/80">Administrador</p>
      </div>
      <button
        type="button"
        onClick={onSalir}
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        className="grid size-11 shrink-0 place-items-center rounded-lg text-cy-apagado hover:bg-cy-alerta/10 hover:text-cy-alerta md:size-9"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  )
}

const PRINCIPALES: { id: IdSeccion; texto: string }[] = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'usuarios', texto: 'Usuarios' },
  { id: 'ia-modelos', texto: 'IA' },
  { id: 'consumo', texto: 'Consumo' },
]

export function MarcoAdmin({ seccion, onIr, email, onSalir, children }: { seccion: IdSeccion; onIr: (s: IdSeccion) => void; email: string; onSalir: () => void; children: ReactNode }) {
  const [menu, setMenu] = useState(false)
  const ir = (s: IdSeccion) => {
    setMenu(false)
    onIr(s)
  }
  return (
    <div className="relative min-h-dvh">
      {/* Fondo: rejilla tenue y halos de marca, como la carcasa de los VST. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0">
        <div className="absolute -left-40 -top-40 size-[520px] rounded-full bg-cy-violeta/10 blur-[120px]" />
        <div className="absolute -right-40 top-1/3 size-[480px] rounded-full bg-cy-cian/[0.06] blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{ backgroundImage: 'linear-gradient(#2D3375 1px, transparent 1px), linear-gradient(90deg, #2D3375 1px, transparent 1px)', backgroundSize: '44px 44px' }}
        />
      </div>

      {/* Sidebar (≥768 px) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-cy-borde/60 bg-[#070821]/90 backdrop-blur-md md:flex lg:w-[256px]">
        <div className="px-4 pb-4 pt-5">
          <Marca />
        </div>
        <div className="cy-linea-marca mx-4 h-px opacity-40" />
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-5">
          <ListaSecciones actual={seccion} onIr={ir} />
        </div>
        <div className="p-3">
          <Usuario email={email} onSalir={onSalir} />
        </div>
      </aside>

      {/* Cabecera móvil */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-cy-borde/60 bg-[#070821]/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <Marca compacta />
      </header>

      <main className="relative z-10 min-w-0 px-4 pb-[calc(96px+env(safe-area-inset-bottom))] pt-5 md:ml-[232px] md:px-7 md:pb-10 md:pt-8 lg:ml-[256px] lg:px-10">
        <div className="mx-auto w-full max-w-[1280px]">{children}</div>
      </main>

      {/* Barra inferior móvil */}
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-cy-borde/70 bg-[#070821]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {PRINCIPALES.map((p) => {
          const s = SECCIONES[p.id]
          const activo = p.id === 'ia-modelos' ? esIA(seccion) : seccion === p.id
          const Icono = p.id === 'ia-modelos' ? Sparkles : s.icono
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => ir(p.id === 'ia-modelos' && esIA(seccion) ? seccion : p.id)}
              aria-current={activo ? 'page' : undefined}
              className={unir('relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] tracking-wide', activo ? 'text-cy-cian' : 'text-cy-apagado')}
            >
              {activo ? <span className="absolute inset-x-5 top-0 h-[2px] rounded-full bg-cy-cian shadow-[0_0_10px_rgba(25,217,255,0.9)]" /> : null}
              <Icono className={unir('size-[22px]', activo && 'drop-shadow-[0_0_6px_rgba(25,217,255,0.8)]')} />
              {p.texto}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => setMenu(true)}
          aria-haspopup="dialog"
          aria-expanded={menu}
          className={unir('flex min-h-[60px] flex-col items-center justify-center gap-1 text-[10.5px] tracking-wide', menu ? 'text-cy-cian' : 'text-cy-apagado')}
        >
          <Menu className="size-[22px]" />
          Menú
        </button>
      </nav>

      <Hoja abierta={menu} onCerrar={() => setMenu(false)} titulo="Menú" subtitulo="Todas las secciones de JasWave Admin">
        <div className="flex flex-col gap-5">
          <ListaSecciones actual={seccion} onIr={ir} />
          <Usuario email={email} onSalir={onSalir} />
        </div>
      </Hoja>
    </div>
  )
}
