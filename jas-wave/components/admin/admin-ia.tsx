/**
 * Admin → IA (M2): proveedores de modelos para los roles (con su clave cifrada en el servidor, de solo
 * escritura) y vista de los modelos propios que han añadido los usuarios. Quién usa cada proveedor se
 * decide en «Plugins y roles» con el producto «Asistente IA»: acciones `ia.usar`,
 * `ia.proveedor.<slug>` e `ia.modelo-propio`.
 */

import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { ProveedorIAApi } from '@/src/lib/backend/api'
import { refrescarCatalogoIA } from '@/src/lib/ia/catalogo-ia'
import { Aviso, Boton, Seccion } from '../cuenta/ui'
import { CambiarClave, FormularioProveedorIA } from '../ia/formulario-proveedor-ia'

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function PestanaIA() {
  const [proveedores, setProveedores] = useState<ProveedorIAApi[]>([])
  const [deUsuarios, setDeUsuarios] = useState<(ProveedorIAApi & { propietario: string | null })[]>([])
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [pruebas, setPruebas] = useState<Record<string, string>>({})

  const recargar = useCallback(async () => {
    try {
      const api = apiJasWave()
      const [a, u] = await Promise.all([api.admin.ia.proveedores(), api.admin.ia.deUsuarios()])
      setProveedores(a)
      setDeUsuarios(u)
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensaje(e) })
    }
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      setAviso({ tipo: 'ok', texto: ok })
      await recargar()
      // El propio admin también usa estos proveedores.
      void refrescarCatalogoIA().catch(() => {})
    } catch (e) {
      setAviso({ tipo: 'error', texto: mensaje(e) })
      throw e
    }
  }

  const probar = async (id: string) => {
    setPruebas((p) => ({ ...p, [id]: 'Probando…' }))
    try {
      const r = await apiJasWave().admin.ia.probar(id)
      setPruebas((p) => ({ ...p, [id]: r.estado === 'healthy' ? `Conectado (${r.modelos.length} modelos)` : `${r.estado}: ${r.error ?? r.pista ?? ''}` }))
    } catch (e) {
      setPruebas((p) => ({ ...p, [id]: mensaje(e) }))
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="admin-ia">
      <Aviso>
        Para dar acceso: en «Plugins y roles», producto «Asistente IA», crea un rol con <code>ia.usar</code> y las acciones{' '}
        <code>ia.proveedor.&lt;slug&gt;</code> de los proveedores que pueda usar; añade <code>ia.modelo-propio</code> si puede registrar sus
        propios modelos. Luego asigna el rol y activa la licencia del producto en «Usuarios y accesos».
      </Aviso>
      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}

      <Seccion
        titulo="Proveedores para los roles"
        acciones={
          <span className="flex gap-1">
            <Boton aria-label="Recargar proveedores" onClick={() => void recargar()}>
              <RefreshCw className="size-3.5" />
            </Boton>
            <Boton onClick={() => setCreando(true)} disabled={creando}>
              <Plus className="mr-1 inline size-3" />
              Nuevo proveedor
            </Boton>
          </span>
        }
      >
        {creando ? (
          <FormularioProveedorIA
            modo="admin"
            onCancelar={() => setCreando(false)}
            onGuardar={(d) =>
              ejecutar(() => apiJasWave().admin.ia.crear({ ...d, slug: d.slug ?? '' }), 'Proveedor creado.').then(() => setCreando(false))
            }
          />
        ) : null}
        {!proveedores.length && !creando ? <Aviso>Todavía no hay proveedores.</Aviso> : null}
        <ul className="flex flex-col gap-1.5">
          {proveedores.map((p) =>
            editando === p.id ? (
              <li key={p.id}>
                <FormularioProveedorIA
                  modo="admin"
                  inicial={p}
                  onCancelar={() => setEditando(null)}
                  onGuardar={(d) => ejecutar(() => apiJasWave().admin.ia.actualizar(p.id, d), 'Cambios guardados.').then(() => setEditando(null))}
                />
              </li>
            ) : (
              <li key={p.id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{p.nombre}</span>
                  <code className="text-muted-foreground">ia.proveedor.{p.slug}</code>
                  <span className="text-muted-foreground">
                    {p.tipo} · {p.baseUrl}
                  </span>
                  <span className={p.tieneClave ? 'text-accent-emerald' : 'text-muted-foreground'}>{p.tieneClave ? 'con clave' : 'sin clave'}</span>
                  <label className="ml-auto flex items-center gap-1">
                    <input
                      type="checkbox"
                      aria-label={`Activo ${p.nombre}`}
                      checked={p.activo}
                      onChange={(e) => void ejecutar(() => apiJasWave().admin.ia.actualizar(p.id, { activo: e.target.checked }), 'Estado actualizado.').catch(() => {})}
                    />
                    Activo
                  </label>
                </div>
                <div className="text-muted-foreground">
                  Modelos: {p.modelos.join(', ')} · por defecto {p.modeloPorDefecto} · {p.peticionesPorMinuto ?? '—'}/min por usuario
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Boton onClick={() => setEditando(p.id)}>Editar</Boton>
                  <CambiarClave onGuardar={(c) => ejecutar(() => apiJasWave().admin.ia.clave(p.id, c), c ? 'Clave guardada.' : 'Clave eliminada.')} />
                  <Boton onClick={() => void probar(p.id)}>Probar conexión</Boton>
                  <Boton
                    aria-label={`Eliminar ${p.nombre}`}
                    onClick={() => void ejecutar(() => apiJasWave().admin.ia.eliminar(p.id), 'Proveedor eliminado.').catch(() => {})}
                  >
                    <Trash2 className="size-3.5" />
                  </Boton>
                  {pruebas[p.id] ? <span className="text-muted-foreground">{pruebas[p.id]}</span> : null}
                </div>
              </li>
            ),
          )}
        </ul>
      </Seccion>

      <Seccion titulo="Modelos propios de los usuarios">
        {!deUsuarios.length ? (
          <Aviso>Ningún usuario ha añadido modelos propios.</Aviso>
        ) : (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Usuario</th>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Dónde</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {deUsuarios.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-1">{p.propietario}</td>
                  <td>{p.nombre}</td>
                  <td>{p.tipo}</td>
                  <td>{p.ejecucion === 'local' ? 'su equipo' : 'servidor'}</td>
                  <td className="max-w-[16rem] truncate">{p.baseUrl}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
    </div>
  )
}
