/** Consumo: créditos por día (barras SVG), tabla por modelo y tabla por usuario con medidores. */

import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { ConsumoIAAdmin } from '@/src/lib/backend/api'
import { cifra, cupo, milisegundos, porcentaje, useRecurso } from '../datos'
import { BotonIcono, CabeceraSeccion, Cargando, Insignia, Medidor, MensajeError, Panel, Segmentos, Vacio } from '../ui'

const PERIODOS = [
  { id: '7', texto: '7 días' },
  { id: '30', texto: '30 días' },
  { id: '90', texto: '90 días' },
] as const
type Periodo = (typeof PERIODOS)[number]['id']

export function SeccionConsumo() {
  const [periodo, setPeriodo] = useState<Periodo>('30')
  const dias = Number(periodo)
  const { datos, error, cargando, recargar } = useRecurso(() => apiJasWave().admin.ia.consumo(dias), [dias])
  const { datos: modelos } = useRecurso(() => apiJasWave().admin.ia.modelos().catch(() => []))
  const nombres = new Map((modelos ?? []).map((m) => [m.id, m.nombre]))
  const nombreModelo = (id: string) => (id === 'conexion' ? 'Conexión directa' : (nombres.get(id) ?? id))

  return (
    <>
      <CabeceraSeccion
        rotulo="Uso"
        titulo="Consumo"
        descripcion="Créditos y peticiones de JasWave IA."
        acciones={
          <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
            <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
          </BotonIcono>
        }
      />
      <Segmentos etiqueta="Periodo" valor={periodo} onCambiar={setPeriodo} opciones={PERIODOS.map((p) => ({ id: p.id, texto: p.texto }))} />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {!datos && cargando ? <Cargando /> : null}
      {datos ? (
        <div className="flex flex-col gap-5">
          <Panel titulo="Créditos por día" subtitulo={`Total ${cifra(datos.porDia.reduce((s, d) => s + d.creditos, 0))} créditos · ${cifra(datos.porDia.reduce((s, d) => s + d.peticiones, 0))} peticiones`}>
            <GraficoDias porDia={datos.porDia} dias={dias} />
          </Panel>
          <TablaModelos porModelo={datos.porModelo} nombre={nombreModelo} />
          <TablaUsuarios porUsuario={datos.porUsuario} />
        </div>
      ) : null}
    </>
  )
}

/** Barras verticales de una sola serie (cian), con rejilla tenue y tooltip por barra. */
function GraficoDias({ porDia, dias }: { porDia: ConsumoIAAdmin['porDia']; dias: number }) {
  const serie = useMemo(() => {
    const mapa = new Map(porDia.map((d) => [d.dia, d]))
    const hoy = new Date()
    return Array.from({ length: dias }, (_, i) => {
      const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - (dias - 1 - i)))
      const k = d.toISOString().slice(0, 10)
      return mapa.get(k) ?? { dia: k, creditos: 0, peticiones: 0 }
    })
  }, [porDia, dias])
  const [foco, setFoco] = useState<number | null>(null)
  const max = Math.max(1, ...serie.map((d) => d.creditos))
  const tope = escalaBonita(max)
  const W = 720
  const H = 220
  const izq = 44
  const abajo = 24
  const arriba = 10
  const ancho = (W - izq) / serie.length
  const barra = Math.max(2, ancho - 2)
  const y = (v: number) => arriba + (H - arriba - abajo) * (1 - v / tope)
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope)
  const cadaEtiqueta = Math.ceil(serie.length / 7)
  const f = foco != null ? serie[foco] : null

  if (!porDia.length) return <Vacio titulo="Sin consumo en este periodo." />

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Créditos consumidos por día" onMouseLeave={() => setFoco(null)}>
        {marcas.map((m) => (
          <g key={m}>
            <line x1={izq} x2={W} y1={y(m)} y2={y(m)} stroke="#2D3375" strokeOpacity={m === 0 ? 0.9 : 0.35} strokeWidth={1} />
            <text x={izq - 8} y={y(m) + 3.5} textAnchor="end" fontSize={10} fill="#5C6399" fontFamily="var(--font-mono)">
              {cifra(m)}
            </text>
          </g>
        ))}
        {serie.map((d, i) => {
          const x = izq + i * ancho + (ancho - barra) / 2
          const h = Math.max(0, y(0) - y(d.creditos))
          const r = Math.min(4, barra / 2, h)
          return (
            <g key={d.dia}>
              {h > 0 ? (
                <path
                  d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barra - r} Q${x + barra},${y(0) - h} ${x + barra},${y(0) - h + r} V${y(0)} Z`}
                  fill={foco === i ? '#7DEBFF' : '#19D9FF'}
                  fillOpacity={foco == null || foco === i ? 0.9 : 0.45}
                  style={{ filter: foco === i ? 'drop-shadow(0 0 6px rgba(25,217,255,0.8))' : undefined }}
                />
              ) : null}
              {/* Zona de foco más grande que la barra. */}
              <rect x={izq + i * ancho} y={arriba} width={ancho} height={H - arriba - abajo} fill="transparent" onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)} />
              {i % cadaEtiqueta === 0 ? (
                <text x={x + barra / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#5C6399" fontFamily="var(--font-mono)">
                  {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      {f ? (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-cy-cian/40 bg-cy-panel/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur"
          style={{ left: `clamp(0px, calc(${((izq + (foco! + 0.5) * ancho) / W) * 100}% - 70px), calc(100% - 140px))`, width: 140 }}
        >
          <p className="font-mono text-[11px] text-cy-apagado">{new Date(`${f.dia}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          <p className="text-cy-texto">
            <span className="font-mono tabular-nums">{cifra(f.creditos)}</span> créditos
          </p>
          <p className="text-cy-tenue">
            <span className="font-mono tabular-nums">{cifra(f.peticiones)}</span> peticiones
          </p>
        </div>
      ) : null}
    </div>
  )
}

function escalaBonita(max: number): number {
  const p = 10 ** Math.floor(Math.log10(max))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}

function TablaModelos({ porModelo, nombre }: { porModelo: ConsumoIAAdmin['porModelo']; nombre: (id: string) => string }) {
  const maxCreditos = Math.max(1, ...porModelo.map((m) => m.creditos))
  return (
    <Panel titulo="Por modelo" relleno={false}>
      {porModelo.length === 0 ? (
        <div className="p-4">
          <Vacio titulo="Sin peticiones en este periodo." />
        </div>
      ) : (
        <>
          <div className="hidden grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] gap-3 border-b border-cy-borde/50 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-cy-apagado md:grid">
            <span>Modelo</span>
            <span className="text-right">Peticiones</span>
            <span className="text-right">Fallos</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Latencia</span>
            <span className="text-right">Créditos</span>
          </div>
          <ul className="divide-y divide-cy-borde/40">
            {porModelo.map((m) => (
              <li key={m.modelo} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))] md:items-center">
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <p className="truncate text-[13px] text-cy-texto">{nombre(m.modelo)}</p>
                  <div className="mt-1.5 max-w-[220px]">
                    <Medidor usados={m.creditos} limite={null} escala={maxCreditos} segmentos={20} compacto etiqueta={`Créditos de ${m.modelo}`} />
                  </div>
                </div>
                <Dato etiqueta="Peticiones" valor={cifra(m.peticiones)} />
                <Dato etiqueta="Fallos" valor={porcentaje(m.fallos, m.peticiones)} alerta={m.peticiones > 0 && m.fallos / m.peticiones > 0.1} />
                <Dato etiqueta="Tokens" valor={cifra(m.tokens)} />
                <Dato etiqueta="Latencia" valor={milisegundos(m.msMedio)} />
                <Dato etiqueta="Créditos" valor={cifra(m.creditos)} fuerte />
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

function Dato({ etiqueta, valor, alerta, fuerte }: { etiqueta: string; valor: string; alerta?: boolean; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
      <span className="text-[10px] uppercase tracking-[0.14em] text-cy-apagado md:hidden">{etiqueta}</span>
      <span className={`font-mono text-[12.5px] tabular-nums ${alerta ? 'text-cy-alerta' : fuerte ? 'text-cy-cian' : 'text-cy-tenue'}`}>{valor}</span>
    </div>
  )
}

function TablaUsuarios({ porUsuario }: { porUsuario: ConsumoIAAdmin['porUsuario'] }) {
  const [todos, setTodos] = useState(false)
  const ordenados = [...porUsuario].sort((a, b) => b.mes.usados - a.mes.usados || a.email.localeCompare(b.email))
  const lista = todos ? ordenados : ordenados.filter((u) => u.mes.usados > 0 || u.dia.usados > 0)
  const escalaMes = Math.max(1, ...porUsuario.map((u) => u.mes.usados))
  const escalaDia = Math.max(1, ...porUsuario.map((u) => u.dia.usados))
  return (
    <Panel
      titulo="Por usuario"
      subtitulo="Cupos del plan de cada usuario (día y mes en curso)"
      acciones={
        <button type="button" onClick={() => setTodos((t) => !t)} className="min-h-11 px-2 text-[11.5px] text-cy-cian hover:underline md:min-h-0">
          {todos ? 'Solo con consumo' : `Ver todos (${porUsuario.length})`}
        </button>
      }
      relleno={false}
    >
      {lista.length === 0 ? (
        <div className="p-4">
          <Vacio titulo="Ningún usuario ha consumido créditos este mes." />
        </div>
      ) : (
        <ul className="divide-y divide-cy-borde/40">
          {lista.map((u) => (
            <li key={u.usuarioId} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-cy-texto">{u.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {u.esAdmin ? <Insignia tono="violeta">admin · sin límite</Insignia> : u.plan ? <Insignia tono={u.plan.asignado ? 'cian' : 'neutro'}>{u.plan.nombre}{u.plan.asignado ? '' : ' · por defecto'}</Insignia> : <Insignia>sin plan</Insignia>}
                  <span className="font-mono text-[11px] text-cy-apagado">{cifra(u.mes.peticiones)} pet.</span>
                </div>
              </div>
              {(
                [
                  ['Hoy', u.dia.usados, u.dia.limite, escalaDia],
                  ['Mes', u.mes.usados, u.mes.limite, escalaMes],
                ] as const
              ).map(([t, usados, limite, escala]) => (
                <div key={t} className="min-w-0">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-cy-apagado">{t}</span>
                    <span className="font-mono text-[11.5px] tabular-nums text-cy-tenue">{cupo(usados, limite)}</span>
                  </div>
                  <Medidor usados={usados} limite={limite} escala={escala} segmentos={20} compacto etiqueta={`${t} ${u.email}`} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
