/** Auditoría: últimos cambios administrativos (quién, qué, sobre qué y cuándo). */

import { useState } from 'react'
import { RefreshCw, ScrollText, Search } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { UsuarioAdmin } from '@/src/lib/backend/api'
import { fechaHora, useRecurso } from '../datos'
import { BotonIcono, CabeceraSeccion, Cargando, MensajeError, Panel, Vacio } from '../ui'

/** Color del prefijo de la acción (ia.*, licencia.*…). */
function tonoAccion(accion: string): string {
  if (/eliminar|quitar|revocar|borrar/.test(accion)) return 'text-cy-alerta'
  if (accion.startsWith('ia.')) return 'text-cy-cian'
  return 'text-[#b994ff]'
}

export function SeccionAuditoria() {
  const { datos, error, cargando, recargar } = useRecurso(async () => {
    const api = apiJasWave().admin
    const [registros, usuarios] = await Promise.all([api.auditoria(200), api.usuarios().catch(() => [] as UsuarioAdmin[])])
    return { registros, emails: new Map(usuarios.map((u) => [u.id, u.email])) }
  })
  const [filtro, setFiltro] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const f = filtro.trim().toLowerCase()
  const lista = (datos?.registros ?? []).filter((r) => !f || `${r.accion} ${r.objetivo} ${datos?.emails.get(r.actorId) ?? r.actorId}`.toLowerCase().includes(f))

  return (
    <>
      <CabeceraSeccion
        rotulo="Sistema"
        titulo="Auditoría"
        descripcion="Los 200 cambios administrativos más recientes."
        acciones={
          <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
            <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
          </BotonIcono>
        }
      />
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cy-apagado" />
        <input type="search" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar por acción, objetivo o actor…" aria-label="Filtrar auditoría" className="cy-entrada min-h-11 pl-9" />
      </label>
      {error ? <MensajeError>{error}</MensajeError> : null}
      {!datos && cargando ? <Cargando /> : null}
      {datos ? (
        <Panel relleno={false}>
          {lista.length === 0 ? (
            <div className="p-4">
              <Vacio icono={<ScrollText className="size-6" />} titulo="Sin registros." />
            </div>
          ) : (
            <ul className="divide-y divide-cy-borde/40">
              {lista.map((r) => {
                const tieneDatos = r.datos != null && !(typeof r.datos === 'object' && Object.keys(r.datos as object).length === 0)
                return (
                  <li key={r.id} className="px-4 py-2.5">
                    <button
                      type="button"
                      disabled={!tieneDatos}
                      aria-expanded={tieneDatos ? abierto === r.id : undefined}
                      onClick={() => setAbierto((a) => (a === r.id ? null : r.id))}
                      className="grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 text-left md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-center"
                    >
                      <span className="font-mono text-[11px] tabular-nums text-cy-apagado">{fechaHora(r.creadoEn)}</span>
                      <span className={`truncate font-mono text-[12px] ${tonoAccion(r.accion)}`}>{r.accion}</span>
                      <span className="truncate text-[12px] text-cy-texto">{datos.emails.get(r.objetivo) ?? r.objetivo}</span>
                      <span className="truncate text-[11.5px] text-cy-tenue">{datos.emails.get(r.actorId) ?? r.actorId.slice(0, 8)}</span>
                    </button>
                    {abierto === r.id ? (
                      <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-cy-borde/50 bg-cy-negro p-2 font-mono text-[11px] text-cy-tenue">{JSON.stringify(r.datos, null, 2)}</pre>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      ) : null}
    </>
  )
}
