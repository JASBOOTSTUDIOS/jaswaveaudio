/** Resumen: créditos de hoy y del mes, peticiones, fallos, latencia, estado de los modelos y top de usuarios. */

import { ArrowRight, RefreshCw } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import { cifra, cupo, milisegundos, porcentaje, useRecurso } from '../datos'
import type { IdSeccion } from '../navegacion'
import { Boton, BotonIcono, CabeceraSeccion, Cargando, Cifra, Insignia, Led, Medidor, MensajeError, Panel, Vacio } from '../ui'

export function SeccionResumen({ onIr }: { onIr: (s: IdSeccion) => void }) {
  const { datos, error, cargando, recargar } = useRecurso(async () => {
    const api = apiJasWave().admin.ia
    const [consumo, modelos] = await Promise.all([api.consumo(30), api.modelos()])
    return { consumo, modelos }
  })

  const c = datos?.consumo
  const hoy = c ? c.porUsuario.reduce((s, u) => s + u.dia.usados, 0) : 0
  const mes = c ? c.porUsuario.reduce((s, u) => s + u.mes.usados, 0) : 0
  const peticiones = c ? c.porModelo.reduce((s, m) => s + m.peticiones, 0) : 0
  const fallos = c ? c.porModelo.reduce((s, m) => s + m.fallos, 0) : 0
  const latencia = peticiones && c ? c.porModelo.reduce((s, m) => s + m.msMedio * m.peticiones, 0) / peticiones : 0
  const tasaFallos = peticiones ? fallos / peticiones : 0
  const top = c ? [...c.porUsuario].filter((u) => u.mes.usados > 0).sort((a, b) => b.mes.usados - a.mes.usados).slice(0, 6) : []
  const maxTop = top[0]?.mes.usados ?? 0
  const porModelo = new Map((c?.porModelo ?? []).map((m) => [m.modelo, m]))

  return (
    <>
      <CabeceraSeccion
        rotulo="Panel de control"
        titulo="Resumen"
        descripcion="Actividad de JasWave IA en los últimos 30 días."
        acciones={
          <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
            <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
          </BotonIcono>
        }
      />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {!datos && cargando ? <Cargando /> : null}
      {datos ? (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra etiqueta="Créditos hoy" valor={cifra(hoy)} led="activo" />
            <Cifra etiqueta="Créditos del mes" valor={cifra(mes)} detalle={`${cifra(c!.porUsuario.reduce((s, u) => s + u.mes.peticiones, 0))} peticiones este mes`} />
            <Cifra etiqueta="Peticiones" valor={cifra(peticiones)} detalle={<span className={tasaFallos > 0.1 ? 'text-cy-alerta' : tasaFallos > 0.03 ? 'text-cy-ambar' : ''}>30 días · {porcentaje(fallos, peticiones)} fallos</span>} led={tasaFallos > 0.1 ? 'error' : tasaFallos > 0.03 ? 'aviso' : 'ok'} />
            <Cifra etiqueta="Latencia media" valor={milisegundos(latencia)} led={latencia > 15000 ? 'aviso' : 'ok'} />
          </div>

          <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <Panel
              titulo="Modelos JasWave"
              acciones={
                <Boton variante="fantasma" compacto onClick={() => onIr('ia-modelos')}>
                  Configurar <ArrowRight className="size-3.5" />
                </Boton>
              }
              relleno={false}
            >
              {datos.modelos.length === 0 ? (
                <div className="p-4">
                  <Vacio titulo="Aún no hay modelos JasWave configurados." />
                </div>
              ) : (
                <ul className="divide-y divide-cy-borde/40">
                  {datos.modelos.map((m) => {
                    const uso = porModelo.get(m.id)
                    const esAuto = m.id === 'auto'
                    const estado = !m.activo ? 'apagado' : !esAuto && m.cadena.length === 0 ? 'aviso' : uso && uso.peticiones && uso.fallos / uso.peticiones > 0.2 ? 'error' : 'ok'
                    return (
                      <li key={m.id} className="flex min-w-0 items-center gap-3 px-4 py-3">
                        <Led estado={estado} titulo={!m.activo ? 'Desactivado' : estado === 'aviso' ? 'Sin cadena' : estado === 'error' ? 'Muchos fallos' : 'Operativo'} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] text-cy-texto">{m.nombre}</p>
                          <p className="truncate font-mono text-[11px] text-cy-apagado">
                            {m.id} · {esAuto ? 'según la tarea' : `${m.cadena.length} ${m.cadena.length === 1 ? 'eslabón' : 'eslabones'}`}
                          </p>
                        </div>
                        <div className="text-right font-mono text-[11.5px] tabular-nums text-cy-tenue">
                          <div>{cifra(uso?.peticiones ?? 0)} pet.</div>
                          <div className="text-cy-apagado">{milisegundos(uso?.msMedio)}</div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              titulo="Top usuarios del mes"
              acciones={
                <Boton variante="fantasma" compacto onClick={() => onIr('consumo')}>
                  Consumo <ArrowRight className="size-3.5" />
                </Boton>
              }
            >
              {top.length === 0 ? (
                <Vacio titulo="Sin consumo este mes." />
              ) : (
                <ul className="flex flex-col gap-3.5">
                  {top.map((u) => (
                    <li key={u.usuarioId} className="min-w-0">
                      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[12.5px] text-cy-texto">{u.email}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {u.plan ? <Insignia>{u.plan.nombre}</Insignia> : u.esAdmin ? <Insignia tono="violeta">admin</Insignia> : null}
                          <span className="font-mono text-[11.5px] tabular-nums text-cy-tenue">{cupo(u.mes.usados, u.mes.limite)}</span>
                        </span>
                      </div>
                      <Medidor usados={u.mes.usados} limite={u.mes.limite} escala={maxTop} compacto etiqueta={`Consumo de ${u.email}`} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}
    </>
  )
}
