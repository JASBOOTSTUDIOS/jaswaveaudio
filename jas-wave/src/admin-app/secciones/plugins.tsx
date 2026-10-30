/**
 * Plugins y roles: productos licenciables (plugins), sus acciones/funcionalidades, roles por producto y
 * qué acciones concede cada rol. En JasWave Desktop se pueden importar desde los plugins instalados.
 */

import { useState } from 'react'
import { Download, Plus, Puzzle, RefreshCw, Trash2 } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import { ErrorApiCliente, type ProductoAdmin } from '@/src/lib/backend/api'
import { plural, useAvisos, useEjecutar, useRecurso } from '../datos'
import { Boton, BotonIcono, CabeceraSeccion, Campo, Cargando, Insignia, MensajeError, Nota, Vacio } from '../ui'

type ManifiestoConLicencia = { name?: string; license?: { productId: string; features: { key: string; description?: string }[] } }
type ListarPlugins = () => Promise<{ manifiesto: unknown; integridad: string }[]>

/** Solo en JasWave Desktop: el proceso main lista los paquetes de plugins instalados. */
function listarPluginsInstalados(): ListarPlugins | null {
  const w = window as unknown as { electron?: { pluginsListar?: ListarPlugins } }
  return w.electron?.pluginsListar ?? null
}

/** Ejecuta una operación ignorando «ya existe» (importaciones idempotentes). */
async function crearSiFalta<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErrorApiCliente && e.codigo === 'conflicto') return null
    throw e
  }
}

/** Registra en el backend los productos y funciones licenciables de los plugins instalados (íntegros). */
async function importarDesdePlugins(listar: ListarPlugins): Promise<{ productos: number; acciones: number }> {
  const api = apiJasWave()
  let productos = 0
  let acciones = 0
  for (const p of await listar()) {
    if (p.integridad === 'alterada') continue
    const m = p.manifiesto as ManifiestoConLicencia
    const lic = m?.license
    if (!lic?.productId || !Array.isArray(lic.features)) continue
    if (await crearSiFalta(() => api.admin.crearProducto(lic.productId, m.name ?? lic.productId))) productos++
    for (const f of lic.features) {
      if (await crearSiFalta(() => api.admin.crearAccion(lic.productId, f.key, f.description ?? ''))) acciones++
    }
  }
  return { productos, acciones }
}

export function SeccionPlugins() {
  const ejecutar = useEjecutar()
  const avisar = useAvisos()
  const { datos, error, cargando, recargar } = useRecurso(() => apiJasWave().admin.productos())
  const [nuevoId, setNuevoId] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [importando, setImportando] = useState(false)
  const listar = listarPluginsInstalados()

  const hacer = async (fn: () => Promise<unknown>, ok?: string) => {
    const r = await ejecutar(fn, ok)
    if (r) await recargar()
    return r
  }

  return (
    <>
      <CabeceraSeccion
        rotulo="Licencias"
        titulo="Plugins y roles"
        descripcion="Funciones licenciables de cada plugin y qué concede cada rol. Los roles se asignan en «Usuarios»."
        acciones={
          <>
            <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
              <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
            </BotonIcono>
            {listar ? (
              <Boton
                icono={<Download className="size-4" />}
                cargando={importando}
                onClick={async () => {
                  setImportando(true)
                  let r = { productos: 0, acciones: 0 }
                  const ok = await hacer(async () => {
                    r = await importarDesdePlugins(listar)
                  })
                  setImportando(false)
                  if (ok) avisar('ok', `Importados ${r.productos} plugins y ${r.acciones} funciones.`)
                }}
              >
                Importar instalados
              </Boton>
            ) : null}
          </>
        }
      />
      {error ? <MensajeError>{error}</MensajeError> : null}

      <form
        className="cy-panel mb-5 grid grid-cols-1 items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          void hacer(() => apiJasWave().admin.crearProducto(nuevoId, nuevoNombre.trim()), 'Plugin creado.').then((ok) => {
            if (ok) {
              setNuevoId('')
              setNuevoNombre('')
            }
          })
        }}
      >
        <Campo etiqueta="Id del plugin" mono value={nuevoId} placeholder="com.jaswave.plugin.param-eq" onChange={(e) => setNuevoId(e.target.value.trim())} />
        <Campo etiqueta="Nombre" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        <Boton type="submit" variante="primario" disabled={!nuevoId || !nuevoNombre.trim()} icono={<Plus className="size-4" />} className="md:min-h-11">
          Crear plugin
        </Boton>
      </form>
      {!listar ? <div className="-mt-2 mb-5"><Nota>La importación desde los plugins instalados solo está disponible al abrir JasWave Admin desde JasWave Desktop.</Nota></div> : null}

      {!datos && cargando ? <Cargando /> : null}
      {datos && datos.length === 0 ? <Vacio icono={<Puzzle className="size-6" />} titulo="Aún no hay plugins licenciables." /> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {datos?.map((p) => (
          <TarjetaProducto key={p.id} producto={p} hacer={hacer} />
        ))}
      </div>
    </>
  )
}

function TarjetaProducto({ producto, hacer }: { producto: ProductoAdmin; hacer: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const api = apiJasWave()
  const [clave, setClave] = useState('')
  const [rol, setRol] = useState('')

  const alternar = (rolId: string, accionId: string) => {
    const r = producto.roles.find((x) => x.id === rolId)
    const actuales = new Set((r?.acciones ?? []).map((a) => a.accionId))
    if (actuales.has(accionId)) actuales.delete(accionId)
    else actuales.add(accionId)
    void hacer(() => api.admin.accionesDeRol(rolId, [...actuales]))
  }

  return (
    <article className="cy-panel min-w-0">
      <header className="flex min-w-0 items-start gap-3 border-b border-cy-borde/50 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-light tracking-wide text-cy-texto">{producto.nombre}</h3>
          <p className="truncate font-mono text-[11px] text-cy-apagado">{producto.id}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Insignia>{plural(producto.acciones.length, 'función', 'funciones')}</Insignia>
            <Insignia tono="violeta">{plural(producto.roles.length, 'rol', 'roles')}</Insignia>
          </div>
        </div>
        <BotonIcono
          etiqueta={`Eliminar ${producto.nombre}`}
          peligro
          onClick={() => {
            if (window.confirm(`¿Eliminar ${producto.nombre}? Se borran sus acciones, roles y licencias.`)) void hacer(() => api.admin.eliminarProducto(producto.id), 'Plugin eliminado.')
          }}
        >
          <Trash2 className="size-4" />
        </BotonIcono>
      </header>
      <div className="flex flex-col gap-4 p-4">
        {producto.acciones.length === 0 ? <p className="text-[12px] text-cy-apagado">Sin funciones licenciables.</p> : null}
        <ul className="flex flex-col gap-2">
          {producto.acciones.map((a) => (
            <li key={a.id} className="rounded-xl border border-cy-borde/50 bg-cy-negro/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] text-cy-texto">{a.clave}</p>
                  {a.descripcion ? <p className="truncate text-[11px] text-cy-apagado">{a.descripcion}</p> : null}
                </div>
                <BotonIcono etiqueta={`Eliminar ${a.clave}`} peligro onClick={() => void hacer(() => api.admin.eliminarAccion(a.id))}>
                  <Trash2 className="size-3.5" />
                </BotonIcono>
              </div>
              {producto.roles.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Roles que conceden ${a.clave}`}>
                  {producto.roles.map((r) => {
                    const on = Boolean(r.acciones?.some((x) => x.accionId === a.id))
                    return (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${r.nombre} concede ${a.clave}`}
                        onClick={() => alternar(r.id, a.id)}
                        className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition md:min-h-7 ${on ? 'border-cy-cian/50 bg-cy-cian/10 text-cy-cian' : 'border-cy-borde text-cy-apagado hover:text-cy-tenue'}`}
                      >
                        <span className={`size-1.5 rounded-full ${on ? 'bg-cy-cian shadow-[0_0_6px_rgba(25,217,255,0.9)]' : 'bg-cy-borde'}`} />
                        {r.nombre}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void hacer(() => api.admin.crearAccion(producto.id, clave)).then((ok) => ok && setClave(''))
            }}
          >
            <Campo etiqueta="Nueva función" mono value={clave} placeholder="eq.bandas-avanzadas" onChange={(e) => setClave(e.target.value.trim().toLowerCase())} />
            <BotonIcono etiqueta="Añadir función" type="submit" disabled={!clave} className="border border-cy-borde">
              <Plus className="size-4" />
            </BotonIcono>
          </form>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void hacer(() => api.admin.crearRol(producto.id, rol.trim())).then((ok) => ok && setRol(''))
            }}
          >
            <Campo etiqueta="Nuevo rol" value={rol} placeholder="mezcla" onChange={(e) => setRol(e.target.value)} />
            <BotonIcono etiqueta="Añadir rol" type="submit" disabled={!rol.trim()} className="border border-cy-borde">
              <Plus className="size-4" />
            </BotonIcono>
          </form>
        </div>
      </div>
    </article>
  )
}
