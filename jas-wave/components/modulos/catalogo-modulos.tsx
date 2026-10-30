/**
 * Módulos disponibles en el catálogo firmado. Escritorio: instalar o actualizar (el proceso main
 * descarga, verifica firma y SHA-256 y deja el código en el paquete). Web: los módulos del catálogo se
 * cargan desde el servidor al activarlos; aquí solo se recarga la lista.
 */

import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { configBackend } from '@/src/lib/backend/config'
import { instalarPlugins, puertoEntregaEscritorio, versionInstalada } from '@/src/lib/plugins/entrega'
import { useCatalogoPlugins, useProgresoPlugins } from '@/components/plugins/plugins-necesarios'
import { sincronizarCatalogoWeb } from '@/src/modulos/arranque'
import { Aviso, Boton, Seccion } from '@/components/cuenta/ui'

type EntradaCatalogoModulo = { id: string; nombre: string; version: string; categoria?: string; descripcion?: string; ui?: string }

export function CatalogoModulos() {
  const escritorio = Boolean(window.electron?.pluginsInstalar)
  return escritorio ? <CatalogoEscritorio /> : <CatalogoWeb />
}

function CatalogoEscritorio() {
  const { catalogo, error, recargar } = useCatalogoPlugins()
  const progreso = useProgresoPlugins()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [fallos, setFallos] = useState<Record<string, string>>({})
  const modulos = ((catalogo?.paquetes ?? []) as EntradaCatalogoModulo[]).filter((p) => p.ui)

  const instalar = async (id: string) => {
    const puerto = puertoEntregaEscritorio(configBackend().apiUrl, async () => {})
    if (!puerto) return
    setOcupado(id)
    const r = await instalarPlugins([id], puerto)
    setFallos((f) => ({ ...f, [id]: r[id]?.ok ? '' : (r[id]?.error ?? 'error') }))
    setOcupado(null)
  }

  return (
    <Seccion
      titulo="Catálogo de módulos"
      acciones={
        <Boton aria-label="Recargar catálogo de módulos" onClick={recargar}>
          <RefreshCw className="size-3.5" />
        </Boton>
      }
    >
      {error ? <Aviso tipo="error">No se pudo obtener el catálogo: {error}</Aviso> : null}
      {!error && catalogo && !modulos.length ? <Aviso>El catálogo no tiene módulos publicados.</Aviso> : null}
      <ul className="flex flex-col gap-1.5">
        {modulos.map((m) => {
          const instalada = versionInstalada(m.id)
          const p = progreso[m.id]
          const actualizar = instalada && instalada !== m.version
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px]">
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-foreground">{m.nombre}</span>{' '}
                <span className="text-muted-foreground">
                  v{m.version}
                  {instalada ? ` · instalada v${instalada}` : ''}
                </span>
                {m.descripcion ? <span className="block text-muted-foreground">{m.descripcion}</span> : null}
              </span>
              {p && p.fase !== 'listo' && p.fase !== 'error' ? <span className="text-muted-foreground">{p.fase}…</span> : null}
              {fallos[m.id] ? <span className="text-red-400">{fallos[m.id]}</span> : null}
              {!instalada || actualizar ? (
                <Boton primario disabled={ocupado !== null} onClick={() => void instalar(m.id)}>
                  <Download className="mr-1 inline size-3" />
                  {actualizar ? 'Actualizar' : 'Instalar'}
                </Boton>
              ) : (
                <span className="text-accent-emerald">Instalado</span>
              )}
            </li>
          )
        })}
      </ul>
    </Seccion>
  )
}

function CatalogoWeb() {
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  return (
    <Seccion
      titulo="Catálogo de módulos"
      acciones={
        <Boton
          aria-label="Recargar catálogo de módulos"
          onClick={() =>
            void sincronizarCatalogoWeb()
              .then(() => setAviso({ tipo: 'ok', texto: 'Catálogo actualizado.' }))
              .catch((e: unknown) => setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }))
          }
        >
          <RefreshCw className="size-3.5" />
        </Boton>
      }
    >
      <Aviso>En la web los módulos se cargan desde el servidor de JasWave al activarlos (no se instalan).</Aviso>
      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
    </Seccion>
  )
}
