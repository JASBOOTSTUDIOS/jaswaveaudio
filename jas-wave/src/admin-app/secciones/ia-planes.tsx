/** IA › Planes: cupos de créditos por día/mes, peticiones por minuto y modelos JasWave permitidos. */

import { useState } from 'react'
import { Gem, Pencil, Plus, RefreshCw, Star, Trash2, Users } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { DatosPlanIA, ModeloJasWaveAdmin, PlanIAAdmin } from '@/src/lib/backend/api'
import { cifra, useEjecutar, useRecurso } from '../datos'
import type { IdSeccion } from '../navegacion'
import { Boton, BotonIcono, CabeceraSeccion, Campo, Cargando, Casilla, Hoja, Insignia, MensajeError, Vacio } from '../ui'
import { NavIA } from './ia-nav'

const VACIO: DatosPlanIA = { nombre: '', descripcion: '', creditosDia: null, creditosMes: null, peticionesMinuto: 20, modelos: [], porDefecto: false }

export function SeccionPlanes({ onIr }: { onIr: (s: IdSeccion) => void }) {
  const ejecutar = useEjecutar()
  const { datos, error, cargando, recargar } = useRecurso(async () => {
    const api = apiJasWave().admin.ia
    const [planes, modelos] = await Promise.all([api.planes(), api.modelos().catch(() => [] as ModeloJasWaveAdmin[])])
    return { planes, modelos }
  })
  const [editando, setEditando] = useState<PlanIAAdmin | 'nuevo' | null>(null)
  const nombreModelo = new Map((datos?.modelos ?? []).map((m) => [m.id, m.nombre]))

  return (
    <>
      <CabeceraSeccion
        rotulo="Inteligencia artificial"
        titulo="Planes de IA"
        descripcion="Cupos de créditos y modelos permitidos. Se asignan a cada usuario en «Usuarios»."
        acciones={
          <>
            <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
              <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
            </BotonIcono>
            <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setEditando('nuevo')}>
              Nuevo plan
            </Boton>
          </>
        }
      />
      <NavIA actual="ia-planes" onIr={onIr} />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {!datos && cargando ? <Cargando /> : null}
      {datos && datos.planes.length === 0 ? <Vacio icono={<Gem className="size-6" />} titulo="Aún no hay planes. Sin plan, los usuarios no tienen límite de créditos." /> : null}
      {datos ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {datos.planes.map((p) => (
            <article key={p.id} className={`cy-panel flex min-w-0 flex-col ${p.porDefecto ? 'cy-panel-activo' : ''}`}>
              <header className="flex min-w-0 items-start gap-2 p-4 pb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="truncate text-[17px] font-light tracking-wide text-cy-texto">{p.nombre}</h3>
                    {p.porDefecto ? (
                      <Insignia tono="cian">
                        <Star className="size-3" /> por defecto
                      </Insignia>
                    ) : null}
                  </div>
                  {p.descripcion ? <p className="mt-0.5 line-clamp-2 text-[12px] text-cy-tenue">{p.descripcion}</p> : null}
                </div>
                <BotonIcono etiqueta={`Editar ${p.nombre}`} onClick={() => setEditando(p)}>
                  <Pencil className="size-4" />
                </BotonIcono>
                <BotonIcono
                  etiqueta={`Eliminar ${p.nombre}`}
                  peligro
                  onClick={() => {
                    if (window.confirm(`¿Eliminar el plan «${p.nombre}»?${p.usuarios ? ` ${p.usuarios} usuarios pasarán al plan por defecto.` : ''}`))
                      void ejecutar(() => apiJasWave().admin.ia.eliminarPlan(p.id), 'Plan eliminado.').then((ok) => { if (ok) void recargar() })
                  }}
                >
                  <Trash2 className="size-4" />
                </BotonIcono>
              </header>
              <dl className="grid grid-cols-3 gap-px border-y border-cy-borde/50 bg-cy-borde/40">
                {(
                  [
                    ['Día', p.creditosDia],
                    ['Mes', p.creditosMes],
                    ['Pet./min', p.peticionesMinuto],
                  ] as const
                ).map(([t, v]) => (
                  <div key={t} className="bg-cy-panel2 px-3 py-2.5 text-center">
                    <dt className="text-[9.5px] uppercase tracking-[0.18em] text-cy-apagado">{t}</dt>
                    <dd className="mt-0.5 font-mono text-[17px] tabular-nums text-cy-texto">{v == null ? '∞' : cifra(v)}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {p.modelos.length === 0 ? <Insignia tono="ok">Todos los modelos</Insignia> : p.modelos.map((m) => <Insignia key={m}>{nombreModelo.get(m) ?? m}</Insignia>)}
                </div>
                <p className="mt-auto flex items-center gap-1.5 text-[12px] text-cy-tenue">
                  <Users className="size-3.5 text-cy-apagado" />
                  <span className="font-mono tabular-nums text-cy-texto">{p.usuarios ?? 0}</span> usuarios asignados
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <FormularioPlan
        plan={editando}
        modelos={datos?.modelos ?? []}
        onCerrar={() => setEditando(null)}
        alGuardar={async () => {
          setEditando(null)
          await recargar()
        }}
      />
    </>
  )
}

function FormularioPlan({ plan, modelos, onCerrar, alGuardar }: { plan: PlanIAAdmin | 'nuevo' | null; modelos: ModeloJasWaveAdmin[]; onCerrar: () => void; alGuardar: () => Promise<void> }) {
  const ejecutar = useEjecutar()
  const [d, setD] = useState<DatosPlanIA>(VACIO)
  const [abiertoPara, setAbiertoPara] = useState<PlanIAAdmin | 'nuevo' | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Reinicia el borrador al abrir con otro plan (sin efecto: se compara durante el render).
  if (plan !== abiertoPara) {
    setAbiertoPara(plan)
    if (plan) setD(plan === 'nuevo' ? VACIO : { nombre: plan.nombre, descripcion: plan.descripcion, creditosDia: plan.creditosDia, creditosMes: plan.creditosMes, peticionesMinuto: plan.peticionesMinuto, modelos: [...plan.modelos], porDefecto: plan.porDefecto })
  }
  const cambiar = (p: Partial<DatosPlanIA>) => setD((x) => ({ ...x, ...p }))
  const numero = (v: string) => (v.trim() === '' ? null : Math.max(1, Math.round(Number(v)) || 1))
  const elegibles = modelos.filter((m) => m.id !== 'auto')
  const guardar = async () => {
    setEnviando(true)
    const api = apiJasWave().admin.ia
    const datos = { ...d, nombre: d.nombre.trim(), descripcion: d.descripcion.trim() }
    const ok = await ejecutar(() => (plan === 'nuevo' ? api.crearPlan(datos) : api.actualizarPlan((plan as PlanIAAdmin).id, datos)), plan === 'nuevo' ? 'Plan creado.' : 'Plan guardado.')
    setEnviando(false)
    if (ok) await alGuardar()
  }
  return (
    <Hoja
      abierta={Boolean(plan)}
      onCerrar={onCerrar}
      titulo={plan === 'nuevo' ? 'Nuevo plan' : `Editar «${(plan as PlanIAAdmin | null)?.nombre ?? ''}»`}
      pie={
        <>
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" disabled={!d.nombre.trim() || d.peticionesMinuto < 1} cargando={enviando} onClick={() => void guardar()}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo etiqueta="Nombre" value={d.nombre} maxLength={60} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Pro" />
        <Campo etiqueta="Descripción" value={d.descripcion} maxLength={200} onChange={(e) => cambiar({ descripcion: e.target.value })} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Créditos / día" type="number" min={1} mono placeholder="∞" value={d.creditosDia ?? ''} onChange={(e) => cambiar({ creditosDia: numero(e.target.value) })} />
          <Campo etiqueta="Créditos / mes" type="number" min={1} mono placeholder="∞" value={d.creditosMes ?? ''} onChange={(e) => cambiar({ creditosMes: numero(e.target.value) })} />
          <Campo etiqueta="Peticiones / min" type="number" min={1} max={10000} mono value={d.peticionesMinuto} onChange={(e) => cambiar({ peticionesMinuto: Math.round(Number(e.target.value) || 0) })} />
        </div>
        <p className="-mt-2 text-[11px] text-cy-apagado">Deja un cupo vacío para que sea ilimitado.</p>
        <div>
          <p className="mb-1 text-[10.5px] uppercase tracking-[0.16em] text-cy-apagado">Modelos permitidos</p>
          <Casilla etiqueta="Todos los modelos JasWave" checked={d.modelos.length === 0} onChange={(v) => cambiar({ modelos: v ? [] : elegibles.map((m) => m.id) })} />
          {d.modelos.length > 0 ? (
            <div className="ml-7 grid grid-cols-1 sm:grid-cols-2">
              {elegibles.map((m) => (
                <Casilla
                  key={m.id}
                  etiqueta={m.nombre}
                  checked={d.modelos.includes(m.id)}
                  onChange={(v) => {
                    const s = v ? [...d.modelos, m.id] : d.modelos.filter((x) => x !== m.id)
                    // Ninguno marcado equivaldría a «todos»: se mantiene al menos uno.
                    if (s.length) cambiar({ modelos: s })
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-cy-borde/60 bg-cy-negro/40 px-3">
          <Casilla etiqueta="Plan por defecto (usuarios sin plan asignado)" checked={d.porDefecto} onChange={(v) => cambiar({ porDefecto: v })} />
        </div>
      </div>
    </Hoja>
  )
}
