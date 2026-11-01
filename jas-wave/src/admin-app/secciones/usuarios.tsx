/**
 * Usuarios: lista con buscador y detalle (plan de IA con medidores de consumo, licencias y roles por
 * plugin, permisos directos con caducidad y dispositivos).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Laptop, Plus, RefreshCw, Search, UserRound } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { ConsumoIAAdmin, DispositivoAdmin, PlanIAAdmin, ProductoAdmin, UsuarioAdmin } from '@/src/lib/backend/api'
import { cupo, fechaHora, plural, useEjecutar, useRecurso } from '../datos'
import { Boton, BotonIcono, CabeceraSeccion, Campo, Cargando, Casilla, Hoja, Insignia, Led, Medidor, MensajeError, Nota, Panel, Plegable, Selector, Vacio } from '../ui'

type ConsumoUsuario = ConsumoIAAdmin['porUsuario'][number]

export function SeccionUsuarios() {
  const ejecutar = useEjecutar()
  const { datos, error, cargando, recargar } = useRecurso(async () => {
    const api = apiJasWave().admin
    const [usuarios, productos, planes, consumo] = await Promise.all([
      api.usuarios(),
      api.productos(),
      api.ia.planes().catch(() => [] as PlanIAAdmin[]),
      api.ia.consumo(30).catch(() => null),
    ])
    return { usuarios, productos, planes, consumo }
  })
  const [filtro, setFiltro] = useState('')
  const [nuevo, setNuevo] = useState('')
  const [seleccion, setSeleccion] = useState<string | null>(null)

  const consumoDe = useMemo(() => new Map((datos?.consumo?.porUsuario ?? []).map((u) => [u.usuarioId, u])), [datos])
  const visibles = (datos?.usuarios ?? []).filter((u) => u.email.toLowerCase().includes(filtro.trim().toLowerCase()))
  const usuario = datos?.usuarios.find((u) => u.id === seleccion) ?? null
  // Escala de los medidores sin límite (ilimitados): el mayor consumo del periodo.
  const escalaMes = Math.max(1, ...(datos?.consumo?.porUsuario ?? []).map((u) => u.mes.usados))
  const escalaDia = Math.max(1, ...(datos?.consumo?.porUsuario ?? []).map((u) => u.dia.usados))

  return (
    <>
      <CabeceraSeccion
        rotulo="Cuentas"
        titulo="Usuarios"
        descripcion="Plan de IA, licencias, roles, permisos directos y dispositivos de cada cuenta."
        acciones={
          <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
            <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
          </BotonIcono>
        }
      />
      {error ? <MensajeError>{error}</MensajeError> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_minmax(0,360px)]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cy-apagado" />
          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por correo…"
            aria-label="Buscar usuarios"
            className="cy-entrada min-h-11 pl-9"
          />
        </label>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ejecutar(() => apiJasWave().admin.crearUsuario(nuevo.trim()), 'Usuario añadido.').then((ok) => {
              if (ok) {
                setNuevo('')
                void recargar()
              }
            })
          }}
        >
          <input type="email" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="nuevo@correo.com" aria-label="Añadir usuario por correo" className="cy-entrada min-h-11" />
          <Boton type="submit" variante="primario" disabled={!nuevo.includes('@')} icono={<Plus className="size-4" />} className="md:min-h-11">
            Añadir
          </Boton>
        </form>
      </div>

      {!datos && cargando ? <Cargando /> : null}
      {datos ? (
        <Panel titulo={`${visibles.length} de ${datos.usuarios.length} usuarios`} relleno={false}>
          {visibles.length === 0 ? (
            <div className="p-4">
              <Vacio icono={<UserRound className="size-6" />} titulo="Ningún usuario coincide con la búsqueda." />
            </div>
          ) : (
            <ul className="divide-y divide-cy-borde/40">
              {visibles.map((u) => {
                const c = consumoDe.get(u.id)
                return (
                  <li key={u.id}>
                    <button type="button" onClick={() => setSeleccion(u.id)} className="flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover:bg-cy-cian/[0.04]">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-cy-borde bg-cy-negro text-[13px] uppercase text-cy-tenue">{u.email.slice(0, 1)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] text-cy-texto">{u.email}</p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                          {u.esAdmin ? <Insignia tono="violeta">admin</Insignia> : null}
                          {!u.subAuth ? <Insignia tono="aviso">sin registrar</Insignia> : null}
                          {c?.plan ? <Insignia tono={c.plan.asignado ? 'cian' : 'neutro'}>{c.plan.nombre}{c.plan.asignado ? '' : ' · por defecto'}</Insignia> : null}
                          <span className="text-[11px] text-cy-apagado">
                            {plural(u.roles.length, 'rol', 'roles')} · {plural(u.licencias.filter((l) => l.estado === 'activa').length, 'licencia', 'licencias')}
                          </span>
                        </div>
                      </div>
                      {c ? (
                        <div className="hidden w-40 shrink-0 sm:block">
                          <div className="mb-1 text-right font-mono text-[10.5px] tabular-nums text-cy-apagado">mes {cupo(c.mes.usados, c.mes.limite)}</div>
                          <Medidor usados={c.mes.usados} limite={c.mes.limite} escala={escalaMes} segmentos={16} compacto etiqueta={`Consumo mensual de ${u.email}`} />
                        </div>
                      ) : null}
                      <ChevronRight className="size-4 shrink-0 text-cy-apagado" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      <Hoja abierta={Boolean(usuario)} onCerrar={() => setSeleccion(null)} titulo={usuario?.email ?? ''} subtitulo={usuario ? (usuario.esAdmin ? 'Administrador' : usuario.subAuth ? 'Cuenta registrada' : 'Aún no se ha registrado') : undefined}>
        {usuario && datos ? (
          <DetalleUsuario usuario={usuario} productos={datos.productos} planes={datos.planes} consumo={consumoDe.get(usuario.id) ?? null} escalas={[escalaDia, escalaMes]} recargar={recargar} />
        ) : null}
      </Hoja>
    </>
  )
}

function DetalleUsuario({
  usuario,
  productos,
  planes,
  consumo,
  escalas,
  recargar,
}: {
  usuario: UsuarioAdmin
  productos: ProductoAdmin[]
  planes: PlanIAAdmin[]
  consumo: ConsumoUsuario | null
  escalas: [number, number]
  recargar: () => Promise<void>
}) {
  const ejecutar = useEjecutar()
  const api = apiJasWave()
  const rolesUsuario = useMemo(() => new Set(usuario.roles.map((r) => r.rolId)), [usuario])
  const [dispositivos, setDispositivos] = useState<DispositivoAdmin[] | null>(null)
  const [caducidad, setCaducidad] = useState('')

  const cargarDispositivos = useCallback(async () => {
    setDispositivos(await apiJasWave().admin.dispositivos(usuario.id).catch(() => []))
  }, [usuario.id])
  useEffect(() => {
    void cargarDispositivos()
  }, [cargarDispositivos])

  const hacer = async (fn: () => Promise<unknown>, ok?: string) => {
    if (await ejecutar(fn, ok)) await recargar()
  }

  const alternarRol = (rolId: string) => {
    const s = new Set(rolesUsuario)
    if (s.has(rolId)) s.delete(rolId)
    else s.add(rolId)
    void hacer(() => api.admin.rolesDeUsuario(usuario.id, [...s]))
  }

  const cambiarConcesion = (accionId: string, valor: string) => {
    if (valor === '') void hacer(() => api.admin.quitarConcesion(usuario.id, accionId))
    else void hacer(() => api.admin.concesion(usuario.id, accionId, valor as 'allow' | 'deny', caducidad ? new Date(caducidad).toISOString() : null))
  }

  const planPorDefecto = planes.find((p) => p.porDefecto)
  const planActual = consumo?.plan?.asignado ? consumo.plan.id : ''

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <h3 className="cy-rotulo">Plan de IA</h3>
        {usuario.esAdmin ? (
          <Nota>Los administradores usan JasWave IA sin límites de plan.</Nota>
        ) : (
          <Selector
            aria-label="Plan de IA"
            value={planActual}
            onChange={(e) => void hacer(() => api.admin.ia.asignarPlan(usuario.id, e.target.value || null), 'Plan de IA actualizado.')}
          >
            <option value="">{planPorDefecto ? `Por defecto (${planPorDefecto.nombre})` : 'Sin plan (por defecto)'}</option>
            {planes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Selector>
        )}
        {consumo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['Hoy', consumo.dia.usados, consumo.dia.limite, escalas[0]],
                ['Este mes', consumo.mes.usados, consumo.mes.limite, escalas[1]],
              ] as const
            ).map(([t, usados, limite, escala]) => (
              <div key={t} className="rounded-xl border border-cy-borde/60 bg-cy-negro/50 p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="cy-rotulo">{t}</span>
                  <span className="font-mono text-[12px] tabular-nums text-cy-texto">{cupo(usados, limite)}</span>
                </div>
                <Medidor usados={usados} limite={limite} escala={escala} etiqueta={`Créditos ${t.toLowerCase()}`} />
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="cy-rotulo">Licencias y roles</h3>
        <Campo etiqueta="Caducidad de los próximos permisos directos (opcional)" type="datetime-local" value={caducidad} onChange={(e) => setCaducidad(e.target.value)} />
        {productos.length === 0 ? <Vacio titulo="Aún no hay plugins licenciables." /> : null}
        {productos.map((p) => {
          const licencia = usuario.licencias.find((l) => l.productoId === p.id)
          return (
            <Plegable
              key={p.id}
              titulo={p.nombre}
              extra={<Led estado={licencia?.estado === 'activa' ? 'ok' : licencia?.estado === 'suspendida' ? 'aviso' : licencia ? 'error' : 'apagado'} titulo={licencia?.estado ?? 'Sin licencia'} />}
            >
              <div className="flex flex-col gap-3">
                <Selector
                  etiqueta="Licencia"
                  value={licencia?.estado ?? ''}
                  onChange={(e) => {
                    if (e.target.value) void hacer(() => api.admin.licencia(usuario.id, p.id, e.target.value as 'activa'), 'Licencia actualizada.')
                  }}
                >
                  <option value="" disabled>
                    Sin licencia
                  </option>
                  <option value="activa">Activa</option>
                  <option value="suspendida">Suspendida</option>
                  <option value="revocada">Revocada</option>
                </Selector>
                <div>
                  <p className="mb-1 text-[10.5px] uppercase tracking-[0.16em] text-cy-apagado">Roles</p>
                  {p.roles.length === 0 ? <p className="text-[12px] text-cy-apagado">Este plugin aún no tiene roles.</p> : null}
                  <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    {p.roles.map((r) => (
                      <Casilla key={r.id} etiqueta={r.nombre} checked={rolesUsuario.has(r.id)} onChange={() => alternarRol(r.id)} />
                    ))}
                  </div>
                </div>
                {p.acciones.length ? (
                  <div>
                    <p className="mb-1 text-[10.5px] uppercase tracking-[0.16em] text-cy-apagado">Permisos directos</p>
                    <ul className="flex flex-col divide-y divide-cy-borde/30">
                      {p.acciones.map((a) => {
                        const c = usuario.concesiones.find((x) => x.accionId === a.id)
                        const porRol = p.roles.some((r) => rolesUsuario.has(r.id) && r.acciones?.some((x) => x.accionId === a.id))
                        return (
                          <li key={a.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2">
                            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-cy-texto">{a.clave}</span>
                            {porRol ? <Insignia tono="ok">por rol</Insignia> : null}
                            {c?.expiraEn ? <span className="text-[10.5px] text-cy-apagado">hasta {new Date(c.expiraEn).toLocaleDateString()}</span> : null}
                            <select
                              aria-label={`Permiso directo ${a.clave}`}
                              value={c?.efecto ?? ''}
                              onChange={(e) => cambiarConcesion(a.id, e.target.value)}
                              className="cy-entrada min-h-11 w-32 md:min-h-8"
                            >
                              <option value="">—</option>
                              <option value="allow">Permitir</option>
                              <option value="deny">Denegar</option>
                            </select>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Plegable>
          )
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="cy-rotulo">Dispositivos</h3>
        {dispositivos === null ? <Cargando /> : null}
        {dispositivos?.length === 0 ? <p className="text-[12px] text-cy-apagado">Sin dispositivos activados.</p> : null}
        {dispositivos?.map((d) => (
          <div key={d.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-cy-borde/50 bg-cy-negro/40 px-3 py-2">
            <Laptop className="size-4 shrink-0 text-cy-apagado" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-cy-texto">{d.nombre || 'Equipo'}</p>
              <p className="truncate text-[11px] text-cy-apagado">Último uso {fechaHora(d.ultimoUso)}</p>
            </div>
            {d.revocado ? (
              <Insignia tono="error">revocado</Insignia>
            ) : (
              <Boton
                variante="peligro"
                compacto
                onClick={() =>
                  void ejecutar(() => api.admin.revocarDispositivo(d.id, true), 'Dispositivo revocado.').then((ok) => {
                    if (ok) void cargarDispositivos()
                  })
                }
              >
                Revocar
              </Boton>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
