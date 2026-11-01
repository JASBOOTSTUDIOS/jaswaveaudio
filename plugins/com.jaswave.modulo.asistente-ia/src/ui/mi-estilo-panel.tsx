/**
 * Panel «Mi estilo» (K1): cómo toca el usuario, aprendido de su teclado MIDI. Tres pasos: «Analizar mi toque»
 * (`analysis.performance`: informe con números de la toma o los últimos segundos), «Guardar como skill de estilo»
 * (`style.touch.learn` + habilidad `estilo-<slug>.md` con el perfil JSON) y la lista de estilos guardados, donde se
 * activa o desactiva el que usa la banda (se aplica a cada músico al terminar su parte).
 */
import { useEffect, useState } from 'react'
import { executeDawActions, useDAW, EVENTO_CARPETA_ASISTENTE, carpetaAsistente } from '@jaswave/host-sdk'
import { activarEstilo, estilosDelUsuario, guardarEstiloComoHabilidad, type EstiloUsuario } from '../motor/habilidades-agentes'

export function MiEstiloPanel() {
  const dawStore = useDAW()
  const [informe, setInforme] = useState('')
  const [nombre, setNombre] = useState('Mi estilo')
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [estilos, setEstilos] = useState<EstiloUsuario[]>(() => estilosDelUsuario())

  useEffect(() => {
    const recalcular = () => setEstilos(estilosDelUsuario())
    window.addEventListener(EVENTO_CARPETA_ASISTENTE, recalcular)
    return () => window.removeEventListener(EVENTO_CARPETA_ASISTENTE, recalcular)
  }, [])

  const analizar = async () => {
    setOcupado(true)
    setAviso(null)
    try {
      const [r] = await executeDawActions(dawStore, [{ type: 'analysis.performance', payload: {} }], { source: 'user_confirm' })
      setInforme(r?.message ?? '')
      if (r && !r.success) setAviso({ ok: false, texto: r.message })
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) })
    } finally {
      setOcupado(false)
    }
  }

  const guardar = async () => {
    setOcupado(true)
    setAviso(null)
    try {
      const [r] = await executeDawActions(dawStore, [{ type: 'style.touch.learn', payload: { nombre: nombre.trim() || 'Mi estilo' } }], { source: 'user_confirm' })
      const d = (r?.data ?? {}) as { perfilId?: string; nombre?: string; resumen?: string; perfil?: unknown }
      if (!r?.success || !d.perfil) {
        setAviso({ ok: false, texto: r?.message ?? 'No se pudo aprender el toque.' })
        return
      }
      const g = await guardarEstiloComoHabilidad({ nombre: d.nombre ?? nombre, resumen: d.resumen ?? '', perfilId: d.perfilId, perfil: d.perfil })
      setAviso(g.ok ? { ok: true, texto: `Skill de estilo guardada (${g.ruta}). La banda la usará en su próxima producción.` } : { ok: false, texto: g.error ?? 'No se pudo guardar la skill.' })
      setEstilos(estilosDelUsuario())
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : String(e) })
    } finally {
      setOcupado(false)
    }
  }

  const alternar = async (e: EstiloUsuario) => {
    await activarEstilo(e.ruta, !e.activo)
    setEstilos(estilosDelUsuario())
  }

  const quitar = async (e: EstiloUsuario) => {
    await carpetaAsistente.eliminar(e.ruta)
    setEstilos(estilosDelUsuario())
  }

  return (
    <div data-testid="mi-estilo-panel" className="flex flex-col gap-2 rounded-md border border-border bg-panel-raised/60 p-2 text-xs">
      <div className="font-medium">Mi estilo</div>
      <p className="text-muted-foreground">Toca en tu teclado, analiza tu toque y guárdalo: la banda lo aplica a sus músicos (menos la batería).</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" data-testid="mi-estilo-analizar" disabled={ocupado} onClick={() => void analizar()} className="rounded border border-border px-2 py-1 hover:bg-panel-base disabled:opacity-50">
          Analizar mi toque
        </button>
        <input data-testid="mi-estilo-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} aria-label="Nombre del estilo" className="min-w-0 flex-1 rounded border border-border bg-transparent px-2 py-1" />
        <button type="button" data-testid="mi-estilo-guardar" disabled={ocupado} onClick={() => void guardar()} className="rounded border border-border px-2 py-1 hover:bg-panel-base disabled:opacity-50">
          Guardar como skill de estilo
        </button>
      </div>
      {aviso ? (
        <div data-testid="mi-estilo-aviso" role="status" className={aviso.ok ? 'text-emerald-400' : 'text-red-400'}>
          {aviso.texto}
        </div>
      ) : null}
      {informe ? <pre data-testid="mi-estilo-informe" className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-panel-base/70 p-2 text-[11px]">{informe}</pre> : null}
      {estilos.length ? (
        <ul data-testid="mi-estilo-lista" className="flex flex-col gap-1">
          {estilos.map((e) => (
            <li key={e.ruta} data-testid="mi-estilo-item" data-activo={e.activo ? 'true' : 'false'} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <span className="min-w-0 flex-1 truncate" title={e.resumen}>
                {e.nombre}
              </span>
              <button type="button" onClick={() => void alternar(e)} className="rounded px-1.5 py-0.5 hover:bg-panel-base">
                {e.activo ? 'Activo' : 'Desactivado'}
              </button>
              <button type="button" onClick={() => void quitar(e)} className="rounded px-1.5 py-0.5 hover:bg-panel-base" aria-label={`Quitar ${e.nombre}`}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-muted-foreground">Aún no hay skills de estilo guardadas.</div>
      )}
    </div>
  )
}
