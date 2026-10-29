/**
 * Barra de actualización y de compartir del panel Grooves: interruptor «Actualizar grooves automáticamente»,
 * botón «Sincronizar ahora» (con última sincronización y novedades) e interruptor «Compartir mis grooves con
 * JasWave…» (apagado por defecto, con el texto de consentimiento).
 */

import { useState } from 'react'
import { CloudDownload, RefreshCw, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sincronizarGroovesAhora, useEstadoSyncGrooves } from '@/src/lib/grooves/sync-auto'
import { TEXTO_CONSENTIMIENTO, TEXTO_INTERRUPTOR } from '@/src/lib/grooves/propuestas'

const ROTULO_NOVEDAD: Record<string, string> = { nuevo: 'Nuevo', actualizado: 'Actualizado', retirado: 'Retirado', conservado: 'Conservé tu copia de' }

export function fechaAmigable(iso: string | null | undefined): string {
  if (!iso) return 'nunca'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'nunca'
  return d.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function resumenResultado(r: { ok: boolean; sinConexion?: boolean; error?: string; sinCambios?: boolean; descargados: number; actualizados: number; retirados: number; conservados: string[]; errores: unknown[] }): string {
  if (!r.ok && r.error) return r.error
  if (r.sinCambios) return 'Tu biblioteca ya está al día.'
  const partes = [
    r.descargados ? `${r.descargados} nuevo${r.descargados === 1 ? '' : 's'}` : '',
    r.actualizados ? `${r.actualizados} actualizado${r.actualizados === 1 ? '' : 's'}` : '',
    r.retirados ? `${r.retirados} retirado${r.retirados === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  const base = partes.length ? partes.join(' · ') : 'Sin novedades'
  const aviso = r.conservados.length ? ` · Conservé tu versión de ${r.conservados.length} que habías editado` : ''
  const fallos = r.errores.length ? ` · ${r.errores.length} no se pudieron bajar (se reintentará)` : ''
  return base + aviso + fallos
}

export function GroovesSyncBar() {
  const { estado, progreso, sincronizando, resultado, ajustar } = useEstadoSyncGrooves()
  const [verNovedades, setVerNovedades] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  if (!estado) return null

  return (
    <div className="shrink-0 border-b border-border px-3 py-2 text-[11px]" data-testid="grooves-sync">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CloudDownload className="size-3.5 text-accent-cyan" />
        <label className="flex items-center gap-1" title="Descarga ritmos nuevos del catálogo de JasWave y retira los que se quiten. Tus propios grooves nunca se tocan.">
          <input type="checkbox" checked={estado.auto} onChange={(e) => void ajustar({ auto: e.target.checked })} data-testid="grooves-sync-auto" />
          Actualizar grooves automáticamente
        </label>
        <Button size="sm" variant="outline" disabled={sincronizando} onClick={() => void sincronizarGroovesAhora()} data-testid="grooves-sync-ahora">
          <RefreshCw className={`size-3.5 ${sincronizando ? 'animate-spin' : ''}`} /> {sincronizando ? (progreso ? `Sincronizando ${progreso.hecho}/${progreso.total}` : 'Sincronizando…') : 'Sincronizar ahora'}
        </Button>
        <span className="text-muted-foreground" data-testid="grooves-sync-ultima">
          Última sincronización: {fechaAmigable(estado.ultima)}
          {resultado || estado.ultimoResultado ? ` · ${resumenResultado((resultado ?? estado.ultimoResultado)!)}` : ''}
        </span>
        {estado.novedades.length ? (
          <button type="button" className="text-accent-cyan hover:underline" onClick={() => setVerNovedades((v) => !v)} aria-expanded={verNovedades}>
            {verNovedades ? 'Ocultar novedades' : `Ver novedades (${estado.novedades.length})`}
          </button>
        ) : null}
      </div>
      {verNovedades ? (
        <ul className="jw-scrollbar mt-1 max-h-24 overflow-y-auto text-muted-foreground" data-testid="grooves-sync-novedades">
          {estado.novedades.map((n, i) => (
            <li key={`${n.fecha}-${n.nombre}-${i}`}>
              <span className="text-foreground">{ROTULO_NOVEDAD[n.tipo] ?? n.tipo}</span> «{n.nombre}» <span className="opacity-60">· {fechaAmigable(n.fecha)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Share2 className="size-3.5 text-accent-amber" />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={estado.compartir}
            onChange={(e) => {
              if (e.target.checked) setConfirmando(true)
              else void ajustar({ compartir: false })
            }}
            data-testid="grooves-compartir"
          />
          {TEXTO_INTERRUPTOR}
        </label>
        <span className="text-muted-foreground">Apagado por defecto: nada sale de tu equipo sin tu permiso.</span>
      </div>
      {confirmando ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-accent-amber/40 bg-accent-amber/10 px-2 py-1.5" role="alertdialog" aria-label="Permiso para compartir" data-testid="grooves-compartir-consentimiento">
          <span className="min-w-0 flex-1 text-foreground">
            {TEXTO_CONSENTIMIENTO} Solo se envían los grooves que tú creaste (nunca los del catálogo) y los que ya se parecen a algo de tu biblioteca no se envían.
          </span>
          <Button size="sm" onClick={() => { setConfirmando(false); void ajustar({ compartir: true }) }} data-testid="grooves-compartir-aceptar">Acepto y activo</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
        </div>
      ) : null}
    </div>
  )
}
