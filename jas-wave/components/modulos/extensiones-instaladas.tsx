/**
 * Extensiones instaladas (plugins VST3 y módulos), como el panel de extensiones de VS Code: versión,
 * origen (catálogo, archivo firmado o sin firmar), desinstalar, «Instalar desde archivo…» y el Modo
 * desarrollador (permite instalar .jwx sin firma; activarlo lo confirma un diálogo del sistema).
 */

import { useEffect, useState } from 'react'
import { FileUp, Puzzle, Trash2 } from 'lucide-react'
import { EVENTO_PLUGINS_CAMBIADOS, pluginsActivos, type PluginActivo } from '@/src/lib/plugins/registro-plugins'
import { desinstalarExtension, ETIQUETA_ORIGEN, extensionesDisponibles } from '@/src/lib/plugins/extensiones'
import { Aviso, Boton, Seccion } from '@/components/cuenta/ui'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { pedirInstalacionJwx } from './instalador-extensiones'

export function ExtensionesInstaladas() {
  const [lista, setLista] = useState<PluginActivo[]>(() => pluginsActivos())
  const [modoDev, setModoDev] = useState(false)
  const [quitar, setQuitar] = useState<PluginActivo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const refrescar = () => setLista(pluginsActivos())
    window.addEventListener(EVENTO_PLUGINS_CAMBIADOS, refrescar)
    void window.electron?.modoDesarrollador?.().then((v) => setModoDev(Boolean(v)))
    return () => window.removeEventListener(EVENTO_PLUGINS_CAMBIADOS, refrescar)
  }, [])

  if (!extensionesDisponibles()) return null

  const elegir = async () => {
    const ruta = await window.electron?.pluginsElegirJwx?.()
    if (ruta) pedirInstalacionJwx(ruta)
  }
  const cambiarModoDev = async (activo: boolean) => {
    setModoDev(Boolean(await window.electron?.fijarModoDesarrollador?.(activo)))
  }
  const desinstalar = async (p: PluginActivo) => {
    setQuitar(null)
    setError('')
    const r = await desinstalarExtension(p.manifiesto.id)
    if (!r.ok) setError(`No se pudo desinstalar ${p.manifiesto.name}: ${r.error ?? 'error desconocido'}`)
  }

  return (
    <Seccion
      titulo="Extensiones instaladas"
      acciones={
        <Boton onClick={() => void elegir()} title="Instala un archivo .jwx (también puedes arrastrarlo a la ventana)">
          <FileUp className="mr-1 inline size-3" />
          Instalar desde archivo…
        </Boton>
      }
    >
      <p className="text-[11px] text-muted-foreground">
        Plugins y módulos son archivos <span className="font-mono">.jwx</span>: ábrelos con doble clic, arrástralos a la ventana o elígelos aquí.
      </p>
      <label className="flex items-center gap-1.5 text-[11px] text-foreground">
        <input type="checkbox" role="switch" aria-label="Modo desarrollador" checked={modoDev} onChange={(e) => void cambiarModoDev(e.target.checked)} />
        Modo desarrollador <span className="text-muted-foreground">(permite instalar extensiones sin firma de JasWave)</span>
      </label>
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {!lista.length ? <Aviso>No hay extensiones instaladas.</Aviso> : null}
      <ul className="flex flex-col gap-1.5" data-testid="extensiones-instaladas">
        {lista.map((p) => {
          const m = p.manifiesto
          const sinFirma = p.origen === 'desarrollo'
          return (
            <li key={m.id} className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5" data-extension={m.id}>
              <Puzzle className="size-3.5 shrink-0 text-accent-cyan" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-foreground">
                  {m.name} <span className="text-muted-foreground">v{m.version}</span>
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {m.entrypoints.ui && !m.entrypoints.dspDesktop ? 'Módulo' : 'Plugin VST3'} ·{' '}
                  {p.origen ? (
                    <span className={sinFirma ? 'text-amber-400' : ''}>{ETIQUETA_ORIGEN[p.origen]}</span>
                  ) : (
                    'Desarrollo (repositorio)'
                  )}
                </div>
              </div>
              {p.desinstalable ? (
                <Boton onClick={() => setQuitar(p)} title={`Desinstalar ${m.name}`} aria-label={`Desinstalar ${m.name}`}>
                  <Trash2 className="inline size-3" />
                </Boton>
              ) : null}
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={!!quitar}
        onClose={() => setQuitar(null)}
        onConfirm={() => quitar && void desinstalar(quitar)}
        title="Desinstalar extensión"
        message={quitar ? `Se quitará ${quitar.manifiesto.name} de este equipo. Los proyectos que lo usen lo pedirán al abrirse.` : ''}
        confirmLabel="Desinstalar"
      />
    </Seccion>
  )
}
