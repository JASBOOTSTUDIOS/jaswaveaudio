/**
 * Panel de administración (L3). Solo se muestra a administradores; el backend vuelve a validar cada
 * petición (un usuario sin rol admin recibe 403 aunque fuerce la UI).
 *
 * - Productos (VST): acciones/funcionalidades licenciables, roles por producto y qué acciones da cada rol.
 * - Usuarios (por correo): varios roles, permisos directos (permitir/denegar con caducidad),
 *   estado de licencia por producto y dispositivos (revocar).
 * - Auditoría de cada cambio.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import { apiJasWave, useSesion } from '@/src/lib/backend/sesion'
import { ErrorApiCliente, type DispositivoAdmin, type ProductoAdmin, type RegistroAuditoriaAdmin, type UsuarioAdmin } from '@/src/lib/backend/api'
import { pluginsActivos } from '@/src/lib/plugins/registro-plugins'
import { Aviso, Boton, Campo, Seccion, Selector } from '../cuenta/ui'

type Pestana = 'productos' | 'usuarios' | 'auditoria'

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Ejecuta una operación ignorando "ya existe" (importaciones idempotentes). */
async function crearSiFalta<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErrorApiCliente && e.codigo === 'conflicto') return null
    throw e
  }
}

/** Registra en el backend los productos y funciones licenciables de los plugins instalados. */
export async function importarDesdePlugins(api = apiJasWave()): Promise<{ productos: number; acciones: number }> {
  let productos = 0
  let acciones = 0
  for (const { manifiesto: m } of pluginsActivos()) {
    if (!m.license) continue
    if (await crearSiFalta(() => api.admin.crearProducto(m.license!.productId, m.name))) productos++
    for (const f of m.license.features) {
      if (await crearSiFalta(() => api.admin.crearAccion(m.license!.productId, f.key, f.description))) acciones++
    }
  }
  return { productos, acciones }
}

export function PanelAdmin() {
  const sesion = useSesion()
  const [pestana, setPestana] = useState<Pestana>('productos')

  if (sesion.cargando) return <div className="p-4 text-[12px] text-muted-foreground">Cargando…</div>
  if (!sesion.identidad?.esAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
        <ShieldAlert className="size-6 text-muted-foreground" />
        <p className="text-[12px] text-muted-foreground">Acceso solo para administradores.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-border px-3 pt-2" role="tablist" aria-label="Administración">
        {(['productos', 'usuarios', 'auditoria'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pestana === p}
            onClick={() => setPestana(p)}
            className={`rounded-t-md px-3 py-1.5 text-[11px] ${pestana === p ? 'bg-panel-raised text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {p === 'productos' ? 'Plugins y roles' : p === 'usuarios' ? 'Usuarios y accesos' : 'Auditoría'}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pestana === 'productos' ? <PestanaProductos /> : pestana === 'usuarios' ? <PestanaUsuarios /> : <PestanaAuditoria />}
      </div>
    </div>
  )
}

function useProductos() {
  const [productos, setProductos] = useState<ProductoAdmin[]>([])
  const [error, setError] = useState<string | null>(null)
  const recargar = useCallback(async () => {
    try {
      setProductos(await apiJasWave().admin.productos())
      setError(null)
    } catch (e) {
      setError(mensaje(e))
    }
  }, [])
  useEffect(() => {
    void recargar()
  }, [recargar])
  return { productos, error, recargar }
}

// ───────────────────────────── Productos, acciones y roles ─────────────────────────────

function PestanaProductos() {
  const { productos, error, recargar } = useProductos()
  const [nuevoId, setNuevoId] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)

  const ejecutar = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) setAviso({ tipo: 'ok', texto: ok })
      await recargar()
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensaje(e) })
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
      <Seccion
        titulo="Nuevo plugin licenciable"
        acciones={
          <Boton
            className="flex items-center gap-1"
            onClick={() =>
              void ejecutar(async () => {
                const r = await importarDesdePlugins()
                setAviso({ tipo: 'ok', texto: `Importados ${r.productos} plugins y ${r.acciones} funciones desde los plugins instalados.` })
              })
            }
          >
            <Download className="size-3.5" /> Importar desde plugins instalados
          </Boton>
        }
      >
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Campo etiqueta="Id (p. ej. com.jaswave.plugin.param-eq)" value={nuevoId} onChange={(e) => setNuevoId(e.target.value.trim())} />
          <Campo etiqueta="Nombre" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
          <Boton
            primario
            disabled={!nuevoId || !nuevoNombre}
            onClick={() =>
              void ejecutar(async () => {
                await apiJasWave().admin.crearProducto(nuevoId, nuevoNombre)
                setNuevoId('')
                setNuevoNombre('')
              }, 'Plugin creado.')
            }
          >
            Crear
          </Boton>
        </div>
      </Seccion>
      {productos.map((p) => (
        <TarjetaProducto key={p.id} producto={p} ejecutar={ejecutar} />
      ))}
      {productos.length === 0 && !error ? <Aviso>Aún no hay plugins licenciables.</Aviso> : null}
    </div>
  )
}

function TarjetaProducto({ producto, ejecutar }: { producto: ProductoAdmin; ejecutar: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [clave, setClave] = useState('')
  const [rol, setRol] = useState('')
  const api = apiJasWave()

  const alternar = (rolId: string, accionId: string) => {
    const r = producto.roles.find((x) => x.id === rolId)
    const actuales = new Set((r?.acciones ?? []).map((a) => a.accionId))
    if (actuales.has(accionId)) actuales.delete(accionId)
    else actuales.add(accionId)
    void ejecutar(() => api.admin.accionesDeRol(rolId, [...actuales]))
  }

  return (
    <Seccion
      titulo={`${producto.nombre} · ${producto.id}`}
      acciones={
        <Boton
          aria-label={`Eliminar ${producto.nombre}`}
          onClick={() => {
            if (window.confirm(`¿Eliminar ${producto.nombre}? Se borran sus acciones, roles y licencias.`)) void ejecutar(() => api.admin.eliminarProducto(producto.id), 'Plugin eliminado.')
          }}
        >
          <Trash2 className="size-3.5" />
        </Boton>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-normal">Acción / funcionalidad</th>
              {producto.roles.map((r) => (
                <th key={r.id} className="px-2 py-1 text-center font-normal">
                  {r.nombre}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {producto.acciones.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="py-1 pr-2">
                  <span className="font-mono text-foreground">{a.clave}</span>
                  {a.descripcion ? <span className="block text-[10px] text-muted-foreground">{a.descripcion}</span> : null}
                </td>
                {producto.roles.map((r) => (
                  <td key={r.id} className="px-2 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${r.nombre} concede ${a.clave}`}
                      checked={Boolean(r.acciones?.some((x) => x.accionId === a.id))}
                      onChange={() => alternar(r.id, a.id)}
                    />
                  </td>
                ))}
                <td className="text-right">
                  <button aria-label={`Eliminar ${a.clave}`} className="text-muted-foreground hover:text-red-400" onClick={() => void ejecutar(() => api.admin.eliminarAccion(a.id))}>
                    <Trash2 className="size-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-end gap-2">
          <Campo etiqueta="Nueva acción" value={clave} placeholder="eq.bandas-avanzadas" onChange={(e) => setClave(e.target.value.trim().toLowerCase())} />
          <Boton disabled={!clave} onClick={() => void ejecutar(async () => { await api.admin.crearAccion(producto.id, clave); setClave('') })}>
            <Plus className="size-3.5" />
          </Boton>
        </div>
        <div className="flex items-end gap-2">
          <Campo etiqueta="Nuevo rol" value={rol} placeholder="mezcla" onChange={(e) => setRol(e.target.value)} />
          <Boton disabled={!rol} onClick={() => void ejecutar(async () => { await api.admin.crearRol(producto.id, rol); setRol('') })}>
            <Plus className="size-3.5" />
          </Boton>
        </div>
      </div>
    </Seccion>
  )
}

// ───────────────────────────── Usuarios y accesos ─────────────────────────────

function PestanaUsuarios() {
  const { productos } = useProductos()
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([])
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState('')
  const [filtro, setFiltro] = useState('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const api = apiJasWave()

  const recargar = useCallback(async () => {
    try {
      setUsuarios(await apiJasWave().admin.usuarios())
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensaje(e) })
    }
  }, [])
  useEffect(() => {
    void recargar()
  }, [recargar])

  const ejecutar = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
      if (ok) setAviso({ tipo: 'ok', texto: ok })
      await recargar()
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensaje(e) })
    }
  }

  const visibles = usuarios.filter((u) => u.email.includes(filtro.toLowerCase()))
  const usuario = usuarios.find((u) => u.id === seleccion) ?? null

  return (
    <div className="grid grid-cols-[minmax(180px,1fr)_2fr] gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <Campo etiqueta="Añadir usuario por correo" type="email" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
          <Boton primario disabled={!nuevo.includes('@')} onClick={() => void ejecutar(async () => { await api.admin.crearUsuario(nuevo); setNuevo('') }, 'Usuario añadido.')}>
            <Plus className="size-3.5" />
          </Boton>
        </div>
        <Campo etiqueta="Buscar" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        <ul className="max-h-[60vh] overflow-y-auto rounded-md border border-border" role="listbox" aria-label="Usuarios">
          {visibles.map((u) => (
            <li key={u.id}>
              <button
                role="option"
                aria-selected={u.id === seleccion}
                onClick={() => setSeleccion(u.id)}
                className={`w-full truncate px-2 py-1.5 text-left text-[11px] ${u.id === seleccion ? 'bg-panel-raised text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {u.email}
                {!u.subAuth ? <span className="ml-1 text-[9px] text-accent-amber">(sin registrar)</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
        {usuario ? <DetalleUsuario usuario={usuario} productos={productos} ejecutar={ejecutar} /> : <Aviso>Selecciona un usuario.</Aviso>}
      </div>
    </div>
  )
}

function DetalleUsuario({
  usuario,
  productos,
  ejecutar,
}: {
  usuario: UsuarioAdmin
  productos: ProductoAdmin[]
  ejecutar: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
}) {
  const api = apiJasWave()
  const rolesUsuario = useMemo(() => new Set(usuario.roles.map((r) => r.rolId)), [usuario])
  const [dispositivos, setDispositivos] = useState<DispositivoAdmin[]>([])
  const [caducidad, setCaducidad] = useState('')

  const cargarDispositivos = useCallback(async () => {
    setDispositivos(await apiJasWave().admin.dispositivos(usuario.id).catch(() => []))
  }, [usuario.id])
  useEffect(() => {
    void cargarDispositivos()
  }, [cargarDispositivos])

  const alternarRol = (rolId: string) => {
    const s = new Set(rolesUsuario)
    if (s.has(rolId)) s.delete(rolId)
    else s.add(rolId)
    void ejecutar(() => api.admin.rolesDeUsuario(usuario.id, [...s]))
  }

  const cambiarConcesion = (accionId: string, valor: string) => {
    if (valor === '') void ejecutar(() => api.admin.quitarConcesion(usuario.id, accionId))
    else
      void ejecutar(() =>
        api.admin.concesion(usuario.id, accionId, valor as 'allow' | 'deny', caducidad ? new Date(caducidad).toISOString() : null),
      )
  }

  return (
    <>
      <h3 className="text-[13px] font-semibold text-foreground">{usuario.email}</h3>
      <Campo
        etiqueta="Caducidad de los próximos permisos directos (opcional)"
        type="datetime-local"
        value={caducidad}
        onChange={(e) => setCaducidad(e.target.value)}
      />
      {productos.map((p) => {
        const licencia = usuario.licencias.find((l) => l.productoId === p.id)
        return (
          <Seccion
            key={p.id}
            titulo={p.nombre}
            acciones={
              <Selector
                aria-label={`Licencia de ${p.nombre}`}
                value={licencia?.estado ?? ''}
                onChange={(e) => {
                  if (e.target.value) void ejecutar(() => api.admin.licencia(usuario.id, p.id, e.target.value as 'activa'), 'Licencia actualizada.')
                }}
              >
                <option value="" disabled>
                  Sin licencia
                </option>
                <option value="activa">Activa</option>
                <option value="suspendida">Suspendida</option>
                <option value="revocada">Revocada</option>
              </Selector>
            }
          >
            <div className="flex flex-wrap gap-3">
              {p.roles.map((r) => (
                <label key={r.id} className="flex items-center gap-1 text-[11px] text-foreground">
                  <input type="checkbox" checked={rolesUsuario.has(r.id)} onChange={() => alternarRol(r.id)} /> Rol {r.nombre}
                </label>
              ))}
              {p.roles.length === 0 ? <Aviso>Este plugin aún no tiene roles.</Aviso> : null}
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {p.acciones.map((a) => {
                  const c = usuario.concesiones.find((x) => x.accionId === a.id)
                  const porRol = p.roles.some((r) => rolesUsuario.has(r.id) && r.acciones?.some((x) => x.accionId === a.id))
                  return (
                    <tr key={a.id} className="border-t border-border">
                      <td className="py-1 font-mono text-foreground">{a.clave}</td>
                      <td className="text-muted-foreground">{porRol ? 'por rol' : ''}</td>
                      <td className="text-right">
                        <Selector aria-label={`Permiso directo ${a.clave}`} value={c?.efecto ?? ''} onChange={(e) => cambiarConcesion(a.id, e.target.value)}>
                          <option value="">—</option>
                          <option value="allow">Permitir</option>
                          <option value="deny">Denegar</option>
                        </Selector>
                        {c?.expiraEn ? <span className="ml-1 text-[9px] text-muted-foreground">hasta {new Date(c.expiraEn).toLocaleDateString()}</span> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Seccion>
        )
      })}
      <Seccion titulo="Dispositivos">
        {dispositivos.length === 0 ? <Aviso>Sin dispositivos activados.</Aviso> : null}
        {dispositivos.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-foreground">
              {d.nombre || 'Equipo'} <span className="text-[10px] text-muted-foreground">· último uso {new Date(d.ultimoUso).toLocaleString()}</span>
            </span>
            {d.revocado ? (
              <span className="text-[10px] text-red-400">revocado</span>
            ) : (
              <Boton onClick={() => void ejecutar(async () => { await api.admin.revocarDispositivo(d.id, true); await cargarDispositivos() }, 'Dispositivo revocado.')}>
                Revocar
              </Boton>
            )}
          </div>
        ))}
      </Seccion>
    </>
  )
}

// ───────────────────────────── Auditoría ─────────────────────────────

function PestanaAuditoria() {
  const [registros, setRegistros] = useState<RegistroAuditoriaAdmin[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    apiJasWave()
      .admin.auditoria(200)
      .then(setRegistros)
      .catch((e) => setError(mensaje(e)))
  }, [])
  return (
    <div className="flex flex-col gap-2">
      {error ? <Aviso tipo="error">{error}</Aviso> : null}
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">Fecha</th>
            <th className="font-normal">Acción</th>
            <th className="font-normal">Objetivo</th>
            <th className="font-normal">Actor</th>
          </tr>
        </thead>
        <tbody>
          {registros.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1 text-muted-foreground">{new Date(r.creadoEn).toLocaleString()}</td>
              <td className="font-mono text-foreground">{r.accion}</td>
              <td className="truncate text-foreground">{r.objetivo}</td>
              <td className="truncate font-mono text-[10px] text-muted-foreground">{r.actorId.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
