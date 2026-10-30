/**
 * Bandeja de propuestas: grooves que los usuarios crearon y, con su permiso, propusieron para el catálogo.
 * Cada tarjeta muestra la rejilla rítmica, los más parecidos (por contenido MIDI, con su porcentaje) y permite
 * compararla lado a lado, escucharla y decidir: aprobar, aprobar como variante, rechazar o marcar duplicada.
 */

import { useMemo, useState } from 'react'
import { Check, GitCompare, Inbox, Play, RefreshCw, Square, X } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { ComparacionGrooves, GrooveCatalogoAdmin, PropuestaGrooveAdmin, SimilarPropuesta } from '@/src/lib/backend/api'
import { fechaHora, mensaje, useAvisos, useEjecutar, useRecurso } from '../datos'
import { Boton, BotonIcono, Campo, CabeceraSeccion, Cargando, Hoja, Insignia, MensajeError, Nota, Panel, Segmentos, Selector, Vacio } from '../ui'
import { RejillaRitmica } from '../grooves/rejilla'
import { detenerPrevia, reproducirPrevia } from '../grooves/previa-midi'
import { etiquetasDeTexto } from './grooves'

type Estado = 'pendiente' | 'aprobada' | 'rechazada' | 'duplicada'
type Vista = 'todas' | 'unicas' | 'con-similares'

const TONO_ESTADO: Record<Estado, 'aviso' | 'ok' | 'error' | 'neutro'> = { pendiente: 'aviso', aprobada: 'ok', rechazada: 'error', duplicada: 'neutro' }
const NOMBRE_NIVEL: Record<string, string> = { duplicado: 'Duplicado', 'muy-similar': 'Muy parecido', similar: 'Parecido', distinto: 'Distinto' }
const tonoNivel = (n: string): 'error' | 'aviso' | 'cian' | 'neutro' => (n === 'duplicado' ? 'error' : n === 'muy-similar' ? 'aviso' : n === 'similar' ? 'cian' : 'neutro')

export function SeccionPropuestas() {
  const [estado, setEstado] = useState<Estado>('pendiente')
  const [vista, setVista] = useState<Vista>('todas')
  const { datos, error, cargando, recargar } = useRecurso(
    async () => {
      const api = apiJasWave().admin
      const [p, usuarios, catalogo] = await Promise.all([
        api.grooves.propuestas({ estado, ...(vista !== 'todas' ? { vista } : {}) }),
        api.usuarios().catch(() => []),
        api.grooves.listar().catch(() => ({ revision: 0, grooves: [] as GrooveCatalogoAdmin[] })),
      ])
      return { ...p, emails: new Map(usuarios.map((u) => [u.id, u.email])), catalogo: catalogo.grooves }
    },
    [estado, vista],
  )
  const ejecutar = useEjecutar()
  const avisar = useAvisos()
  const [sonando, setSonando] = useState<string | null>(null)
  const [comparando, setComparando] = useState<{ propuesta: PropuestaGrooveAdmin; con: SimilarPropuesta; datos: ComparacionGrooves | null; error?: string } | null>(null)
  const [aprobando, setAprobando] = useState<{ propuesta: PropuestaGrooveAdmin; variante: boolean } | null>(null)

  const grupoDe = useMemo(() => {
    const m = new Map<string, number>()
    datos?.grupos.forEach((g, i) => g.forEach((id) => m.set(id, i + 1)))
    return m
  }, [datos])

  const escuchar = async (p: PropuestaGrooveAdmin) => {
    if (sonando === p.id) {
      detenerPrevia()
      setSonando(null)
      return
    }
    try {
      setSonando(p.id)
      await reproducirPrevia(await apiJasWave().admin.grooves.archivoPropuesta(p.id))
    } catch (e) {
      avisar('error', mensaje(e))
    } finally {
      setSonando((s) => (s === p.id ? null : s))
    }
  }

  const abrirComparacion = async (propuesta: PropuestaGrooveAdmin, con: SimilarPropuesta) => {
    setComparando({ propuesta, con, datos: null })
    try {
      const d = await apiJasWave().admin.grooves.compararPropuesta(propuesta.id, con.tipo, con.id)
      setComparando({ propuesta, con, datos: d })
    } catch (e) {
      setComparando({ propuesta, con, datos: null, error: mensaje(e) })
    }
  }

  const decidir = async (fn: () => Promise<unknown>, ok: string) => {
    if (await ejecutar(fn, ok)) void recargar()
  }

  return (
    <>
      <CabeceraSeccion
        rotulo="Contenido"
        titulo="Propuestas de grooves"
        descripcion="Ritmos que los usuarios crearon y decidieron compartir. El sistema compara el contenido MIDI (no el nombre ni el archivo) para avisarte de duplicados y parecidos."
        acciones={
          <BotonIcono etiqueta="Actualizar" onClick={() => void recargar()}>
            <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
          </BotonIcono>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmentos<Estado>
          etiqueta="Estado"
          valor={estado}
          onCambiar={setEstado}
          opciones={[
            { id: 'pendiente', texto: 'Pendientes' },
            { id: 'aprobada', texto: 'Aprobadas' },
            { id: 'rechazada', texto: 'Rechazadas' },
            { id: 'duplicada', texto: 'Duplicadas' },
          ]}
        />
        <Segmentos<Vista>
          etiqueta="Vista"
          valor={vista}
          onCambiar={setVista}
          opciones={[
            { id: 'todas', texto: 'Todas' },
            { id: 'unicas', texto: 'Únicas' },
            { id: 'con-similares', texto: 'Con parecidos' },
          ]}
        />
      </div>
      {error ? <MensajeError>{error}</MensajeError> : null}
      {cargando && !datos ? <Cargando /> : null}
      {datos && datos.propuestas.length === 0 ? (
        <Vacio icono={<Inbox className="size-6" />} titulo="No hay propuestas aquí">
          Cuando un usuario comparta un groove suyo aparecerá en esta bandeja.
        </Vacio>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {datos?.propuestas.map((p) => (
          <Panel
            key={p.id}
            titulo={p.nombre}
            subtitulo={`${p.estilo} · ${p.compas} · ${p.compases} c · ${p.tempo} bpm`}
            acciones={
              <>
                <Insignia tono={TONO_ESTADO[p.estado]}>{p.estado}</Insignia>
                {p.vecesPropuesto > 1 ? <Insignia tono="violeta">Propuesto {p.vecesPropuesto} veces</Insignia> : null}
                {grupoDe.has(p.id) ? <Insignia tono="aviso">Grupo {grupoDe.get(p.id)} (casi idénticas)</Insignia> : null}
              </>
            }
          >
            <div data-testid="propuesta">
              <p className="mb-2 text-[12px] text-cy-apagado">
                De {datos.emails.get(p.usuarioId) ?? p.usuarioId}
                {p.usuarios.length > 1 ? ` y ${p.usuarios.length - 1} más` : ''} · {fechaHora(p.creadoEn)} · aceptó el texto de permiso del {p.consentimientoVersion}
              </p>
              <RejillaRitmica huella={p.huella} etiqueta={`Rejilla rítmica de ${p.nombre}`} />
              <div className="mt-3">
                <p className="cy-rotulo mb-1">Más parecidos</p>
                {p.similares.length === 0 ? (
                  <p className="text-[12px] text-cy-ok">Es única: no se parece a nada del catálogo ni a otras propuestas.</p>
                ) : (
                  <ul className="space-y-1">
                    {p.similares.map((s) => (
                      <li key={`${s.tipo}-${s.id}`} className="flex flex-wrap items-center gap-2 text-[12px]">
                        <Insignia tono={tonoNivel(s.nivel)} mono>
                          {Math.round(s.puntuacion)} %
                        </Insignia>
                        <span className="min-w-0 flex-1 truncate">
                          {s.nombre} <span className="text-cy-apagado">({s.tipo === 'groove' ? 'catálogo' : 'otra propuesta'} · {NOMBRE_NIVEL[s.nivel] ?? s.nivel})</span>
                        </span>
                        <BotonIcono etiqueta={`Comparar con ${s.nombre}`} onClick={() => void abrirComparacion(p, s)}>
                          <GitCompare className="size-3.5" />
                        </BotonIcono>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {p.notaAdmin ? <p className="mt-2 text-[12px] text-cy-tenue">Nota: {p.notaAdmin}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Boton compacto icono={sonando === p.id ? <Square className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />} onClick={() => void escuchar(p)}>
                  {sonando === p.id ? 'Detener' : 'Escuchar'}
                </Boton>
                {p.estado === 'pendiente' ? (
                  <>
                    <Boton compacto variante="primario" icono={<Check className="size-3.5" />} onClick={() => setAprobando({ propuesta: p, variante: false })}>
                      Aprobar
                    </Boton>
                    <Boton compacto onClick={() => setAprobando({ propuesta: p, variante: true })}>
                      Aprobar como variante
                    </Boton>
                    <Boton
                      compacto
                      variante="peligro"
                      icono={<X className="size-3.5" />}
                      onClick={() => {
                        const nota = window.prompt('Motivo (opcional, lo verá quien la propuso)', '')
                        if (nota !== null) void decidir(() => apiJasWave().admin.grooves.rechazarPropuesta(p.id, nota), 'Propuesta rechazada')
                      }}
                    >
                      Rechazar
                    </Boton>
                    <Boton
                      compacto
                      variante="fantasma"
                      onClick={() => {
                        const nota = window.prompt('Nota (opcional)', '')
                        if (nota !== null) void decidir(() => apiJasWave().admin.grooves.duplicadaPropuesta(p.id, nota, p.similares.find((s) => s.tipo === 'groove')?.id), 'Marcada como duplicada')
                      }}
                    >
                      Marcar duplicada
                    </Boton>
                  </>
                ) : null}
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <HojaComparacion c={comparando} onCerrar={() => setComparando(null)} />
      <HojaAprobar
        a={aprobando}
        catalogo={datos?.catalogo ?? []}
        onCerrar={() => setAprobando(null)}
        onAprobar={async (p, d) => {
          if (await ejecutar(() => apiJasWave().admin.grooves.aprobarPropuesta(p.id, d), 'Aprobada: ya está en el catálogo y llegará a las apps')) {
            setAprobando(null)
            void recargar()
          }
        }}
      />
    </>
  )
}

function HojaComparacion({ c, onCerrar }: { c: { propuesta: PropuestaGrooveAdmin; con: SimilarPropuesta; datos: ComparacionGrooves | null; error?: string } | null; onCerrar: () => void }) {
  return (
    <Hoja
      abierta={!!c}
      onCerrar={onCerrar}
      titulo={c ? `${c.propuesta.nombre} frente a ${c.con.nombre}` : ''}
      subtitulo={c?.datos ? `${Math.round(c.datos.resultado.puntuacion)} % de parecido${c.datos.resultado.desplazamiento ? ` (desplazado ${Math.abs(c.datos.resultado.desplazamiento)} tiempo)` : ''}` : undefined}
    >
      {c?.error ? <MensajeError>{c.error}</MensajeError> : null}
      {c && !c.datos && !c.error ? <Cargando /> : null}
      {c?.datos ? (
        <div className="space-y-4" data-testid="comparacion">
          <div>
            <p className="cy-rotulo mb-1">{c.datos.a.nombre} (propuesta)</p>
            <RejillaRitmica huella={c.datos.a.huella} contra={c.datos.b.huella} lado="a" etiqueta="Rejilla de la propuesta con diferencias" />
          </div>
          <div>
            <p className="cy-rotulo mb-1">{c.datos.b.nombre}</p>
            <RejillaRitmica huella={c.datos.b.huella} contra={c.datos.a.huella} lado="b" etiqueta="Rejilla del otro groove con diferencias" />
          </div>
          <Nota>
            <span className="text-cy-cian">Cian</span>: golpes que coinciden · <span className="text-cy-ambar">ámbar</span>: solo en la propuesta · <span className="text-[#b994ff]">violeta</span>: solo en el otro.
          </Nota>
        </div>
      ) : null}
    </Hoja>
  )
}

function HojaAprobar({
  a,
  catalogo,
  onCerrar,
  onAprobar,
}: {
  a: { propuesta: PropuestaGrooveAdmin; variante: boolean } | null
  catalogo: GrooveCatalogoAdmin[]
  onCerrar: () => void
  onAprobar: (p: PropuestaGrooveAdmin, d: { cambios: Record<string, unknown>; varianteDe?: string; nota?: string }) => Promise<void>
}) {
  const [f, setF] = useState<{ nombre: string; estilo: string; etiquetas: string; variante: string; nota: string } | null>(null)
  const [visto, setVisto] = useState<string | null>(null)
  const clave = a ? `${a.propuesta.id}:${a.variante}` : null
  if (a && clave !== visto) {
    setVisto(clave)
    const topGroove = a.propuesta.similares.find((s) => s.tipo === 'groove')
    setF({ nombre: a.propuesta.nombre, estilo: a.propuesta.estilo, etiquetas: a.propuesta.etiquetas.join(', '), variante: a.variante ? (topGroove?.id ?? '') : '', nota: '' })
  }
  if (!a && visto) setVisto(null)
  const p = a?.propuesta
  return (
    <Hoja
      abierta={!!a}
      onCerrar={onCerrar}
      titulo={a?.variante ? 'Aprobar como variante' : 'Aprobar propuesta'}
      subtitulo={p ? `${p.nombre} · se publicará con licencia CC0` : undefined}
      pie={
        <>
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="primario"
            disabled={!f || (a?.variante && !f.variante)}
            onClick={() =>
              p && f
                ? void onAprobar(p, {
                    cambios: { nombre: f.nombre.trim(), estilo: f.estilo.trim(), etiquetas: etiquetasDeTexto(f.etiquetas) },
                    ...(f.variante ? { varianteDe: f.variante } : {}),
                    ...(f.nota.trim() ? { nota: f.nota.trim() } : {}),
                  })
                : undefined
            }
          >
            Aprobar y publicar
          </Boton>
        </>
      }
    >
      {f && p ? (
        <div className="space-y-3">
          <Campo etiqueta="Nombre en el catálogo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={80} />
          <Campo etiqueta="Estilo" value={f.estilo} onChange={(e) => setF({ ...f, estilo: e.target.value })} ayuda="Uno o dos niveles, por ejemplo Worship/4-4." />
          <Campo etiqueta="Etiquetas (separadas por comas)" value={f.etiquetas} onChange={(e) => setF({ ...f, etiquetas: e.target.value })} />
          <Selector etiqueta={a?.variante ? 'Es variante de' : 'Es variante de (opcional)'} value={f.variante} onChange={(e) => setF({ ...f, variante: e.target.value })}>
            <option value="">— ninguno —</option>
            {catalogo.map((g) => (
              <option key={g.id} value={g.id}>
                {g.estilo} · {g.nombre}
              </option>
            ))}
          </Selector>
          <Campo etiqueta="Nota interna (opcional)" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} maxLength={300} />
          <Nota>Al aprobarla se crea un groove nuevo en el catálogo y se descarga en las apps de los usuarios.</Nota>
        </div>
      ) : null}
    </Hoja>
  )
}
