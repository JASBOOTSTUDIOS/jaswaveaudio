/**
 * Grooves del catálogo: lo que el administrador publica y las apps de los usuarios (y el plugin de batería, que
 * lee la misma carpeta) reciben solas por internet. Lista por estilo con búsqueda, subida de .mid sueltos o de un
 * zip, edición, reemplazo de archivo, activar/desactivar (retirar sin borrar), borrar y vista previa.
 */

import { useMemo, useRef, useState } from 'react'
import { Drum, FileUp, Pencil, Play, RefreshCw, Replace, Search, Square, Trash2, Upload } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { DatosGrooveAdmin, GrooveCatalogoAdmin, ResultadoLoteGrooves } from '@/src/lib/backend/api'
import { mensaje, plural, useAvisos, useEjecutar, useRecurso } from '../datos'
import { Boton, BotonIcono, Campo, Casilla, CabeceraSeccion, Cargando, Hoja, Insignia, MensajeError, Nota, Plegable, Selector, Vacio } from '../ui'
import { detenerPrevia, reproducirPrevia } from '../grooves/previa-midi'

const TIPOS: Record<string, string> = { groove: 'Groove', fill: 'Fill (relleno)', intro: 'Intro', outro: 'Final', transicion: 'Transición' }

export function aBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const leerArchivo = async (f: File) => aBase64(new Uint8Array(await f.arrayBuffer()))

function Etiquetas({ valor, onCambiar }: { valor: string; onCambiar: (v: string) => void }) {
  return <Campo etiqueta="Etiquetas (separadas por comas)" value={valor} onChange={(e) => onCambiar(e.target.value)} placeholder="verso, suave, cross-stick" />
}

/** Convierte lo escrito en etiquetas válidas (minúsculas, sin acentos, con guiones). */
export function etiquetasDeTexto(t: string): string[] {
  return [
    ...new Set(
      t
        .split(',')
        .map((x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30))
        .filter(Boolean),
    ),
  ].slice(0, 20)
}

export function SeccionGrooves() {
  const { datos, error, cargando, recargar } = useRecurso(() => apiJasWave().admin.grooves.listar())
  const ejecutar = useEjecutar()
  const avisar = useAvisos()
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<GrooveCatalogoAdmin | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [sonando, setSonando] = useState<string | null>(null)
  const reemplazo = useRef<HTMLInputElement>(null)
  const [reemplazarId, setReemplazarId] = useState<string | null>(null)

  const lista = useMemo(() => datos?.grooves ?? [], [datos])
  const q = busqueda.trim().toLowerCase()
  const visibles = lista.filter((g) => !q || `${g.nombre} ${g.estilo} ${g.etiquetas.join(' ')} ${g.tipo}`.toLowerCase().includes(q))
  const porEstilo = useMemo(() => {
    const m = new Map<string, GrooveCatalogoAdmin[]>()
    for (const g of visibles) m.set(g.estilo, [...(m.get(g.estilo) ?? []), g])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }, [visibles])
  const estilos = useMemo(() => [...new Set(lista.map((g) => g.estilo))].sort((a, b) => a.localeCompare(b, 'es')), [lista])

  const escuchar = async (g: GrooveCatalogoAdmin) => {
    if (sonando === g.id) {
      detenerPrevia()
      setSonando(null)
      return
    }
    try {
      setSonando(g.id)
      const bytes = await apiJasWave().admin.grooves.archivo(g.id)
      await reproducirPrevia(bytes)
    } catch (e) {
      avisar('error', mensaje(e))
    } finally {
      setSonando((s) => (s === g.id ? null : s))
    }
  }

  const renombrarEstilo = async (actual: string) => {
    const nuevo = window.prompt(`Nuevo nombre para el estilo «${actual}» (usa Estilo o Estilo/Subestilo)`, actual)?.trim()
    if (!nuevo || nuevo === actual) return
    if (await ejecutar(() => apiJasWave().admin.grooves.renombrarEstilo(actual, nuevo), 'Estilo renombrado')) void recargar()
  }

  return (
    <>
      <CabeceraSeccion
        rotulo="Contenido"
        titulo="Grooves"
        descripcion="Los ritmos que publiques aquí llegan solos a la app de los usuarios y al plugin de batería. Si cambias o retiras uno, se actualiza en sus equipos."
        acciones={
          <>
            <Boton variante="primario" icono={<Upload className="size-4" />} onClick={() => setSubiendo(true)}>
              Subir grooves
            </Boton>
            <BotonIcono etiqueta="Actualizar lista" onClick={() => void recargar()}>
              <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
            </BotonIcono>
          </>
        }
      />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {cargando && !datos ? <Cargando /> : null}
      {datos ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="cy-entrada flex min-h-9 min-w-[220px] flex-1 items-center gap-2 md:max-w-sm">
              <Search className="size-4 text-cy-apagado" />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre, estilo o etiqueta" className="w-full bg-transparent outline-none" aria-label="Buscar grooves" />
            </label>
            <Insignia tono="cian" mono>
              Versión del catálogo {datos.revision}
            </Insignia>
            <Insignia>{plural(lista.length, 'groove', 'grooves')}</Insignia>
            <Insignia tono="aviso">{lista.filter((g) => !g.activo).length} retirados</Insignia>
          </div>
          {lista.length === 0 ? (
            <Vacio icono={<Drum className="size-6" />} titulo="El catálogo está vacío">
              Sube archivos .mid (o un zip con carpetas por estilo). Para cargar de una vez los 136 grooves de serie, ejecuta <code>npm run grooves:sembrar</code> en el servidor.
            </Vacio>
          ) : (
            <div className="space-y-3">
              {porEstilo.map(([estilo, grooves]) => (
                <Plegable
                  key={estilo}
                  abiertoInicial={Boolean(q) || porEstilo.length <= 3}
                  titulo={
                    <span className="flex items-center gap-2">
                      {estilo} <Insignia>{grooves.length}</Insignia>
                    </span>
                  }
                  extra={
                    <BotonIcono etiqueta={`Renombrar el estilo ${estilo}`} onClick={() => void renombrarEstilo(estilo)}>
                      <Pencil className="size-3.5" />
                    </BotonIcono>
                  }
                >
                  <ul className="divide-y divide-cy-borde/40">
                    {grooves.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="admin-groove">
                        <BotonIcono etiqueta={sonando === g.id ? 'Detener' : `Escuchar ${g.nombre}`} onClick={() => void escuchar(g)}>
                          {sonando === g.id ? <Square className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
                        </BotonIcono>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-[13px] ${g.activo ? 'text-cy-texto' : 'text-cy-apagado line-through'}`}>{g.nombre}</div>
                          <div className="truncate text-[11px] text-cy-apagado">
                            {TIPOS[g.tipo] ?? g.tipo} · {g.compas} · {g.compases} c · {g.tempo} bpm · intensidad {g.intensidad}/5 · rev. {g.revision} · {(g.tamano / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        {!g.activo ? <Insignia tono="aviso">Retirado</Insignia> : null}
                        <BotonIcono etiqueta={`Editar ${g.nombre}`} onClick={() => setEditando(g)}>
                          <Pencil className="size-3.5" />
                        </BotonIcono>
                        <BotonIcono
                          etiqueta={`Reemplazar el archivo de ${g.nombre}`}
                          onClick={() => {
                            setReemplazarId(g.id)
                            reemplazo.current?.click()
                          }}
                        >
                          <Replace className="size-3.5" />
                        </BotonIcono>
                        <Boton compacto onClick={async () => (await ejecutar(() => apiJasWave().admin.grooves.activar(g.id, !g.activo), g.activo ? 'Retirado de las apps' : 'Publicado')) && void recargar()}>
                          {g.activo ? 'Retirar' : 'Publicar'}
                        </Boton>
                        <BotonIcono
                          etiqueta={`Borrar ${g.nombre}`}
                          peligro
                          onClick={async () => {
                            if (!window.confirm(`¿Borrar «${g.nombre}» del catálogo? Desaparecerá de las apps de los usuarios. Si solo quieres ocultarlo, usa «Retirar».`)) return
                            if (await ejecutar(() => apiJasWave().admin.grooves.borrar(g.id), 'Groove borrado')) void recargar()
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </BotonIcono>
                      </li>
                    ))}
                  </ul>
                </Plegable>
              ))}
              {visibles.length === 0 ? <Nota>Ningún groove coincide con la búsqueda.</Nota> : null}
            </div>
          )}
        </>
      ) : null}

      <input
        ref={reemplazo}
        type="file"
        accept=".mid,.midi,audio/midi"
        className="hidden"
        aria-label="Archivo MIDI de reemplazo"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !reemplazarId) return
          const id = reemplazarId
          if (await ejecutar(async () => apiJasWave().admin.grooves.reemplazarArchivo(id, await leerArchivo(f)), 'Archivo reemplazado: las apps lo descargarán')) void recargar()
        }}
      />

      <HojaSubida abierta={subiendo} estilos={estilos} onCerrar={() => setSubiendo(false)} onListo={() => void recargar()} />
      <HojaEdicion groove={editando} estilos={estilos} onCerrar={() => setEditando(null)} onListo={() => void recargar()} />
    </>
  )
}

function HojaSubida({ abierta, estilos, onCerrar, onListo }: { abierta: boolean; estilos: string[]; onCerrar: () => void; onListo: () => void }) {
  const [estilo, setEstilo] = useState('')
  const [reemplazar, setReemplazar] = useState(false)
  const [archivos, setArchivos] = useState<File[]>([])
  const [zip, setZip] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoLoteGrooves | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cerrar = () => {
    setArchivos([])
    setZip(null)
    setResultado(null)
    setError(null)
    onCerrar()
  }
  const enviar = async () => {
    setEnviando(true)
    setError(null)
    setResultado(null)
    try {
      const api = apiJasWave().admin.grooves
      const r = zip
        ? await api.lote({ zip: await leerArchivo(zip), ...(estilo.trim() ? { estilo: estilo.trim() } : {}), reemplazar })
        : await api.lote({
            archivos: await Promise.all(archivos.map(async (f) => ({ nombre: f.name, base64: await leerArchivo(f) }))),
            ...(estilo.trim() ? { estilo: estilo.trim() } : {}),
            reemplazar,
          })
      setResultado(r)
      onListo()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }
  const listo = (zip || archivos.length > 0) && (zip ? true : estilo.trim().length > 0)

  return (
    <Hoja
      abierta={abierta}
      onCerrar={cerrar}
      titulo="Subir grooves"
      subtitulo="Varios .mid a un estilo, o un zip con una carpeta por estilo (Estilo/Subestilo/archivo.mid)"
      pie={
        <>
          <Boton variante="fantasma" onClick={cerrar}>
            Cerrar
          </Boton>
          <Boton variante="primario" cargando={enviando} disabled={!listo || enviando} icono={<FileUp className="size-4" />} onClick={() => void enviar()}>
            Subir
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Campo etiqueta="Estilo (para los .mid sueltos)" value={estilo} onChange={(e) => setEstilo(e.target.value)} list="estilos-grooves" placeholder="Worship o Worship/4-4" ayuda="Se usa para los archivos que no vengan dentro de una carpeta del zip." />
          <datalist id="estilos-grooves">
            {estilos.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
        </div>
        <label className="block text-[13px] text-cy-texto">
          <span className="cy-rotulo mb-1 block">Archivos .mid</span>
          <input
            type="file"
            multiple
            accept=".mid,.midi,audio/midi"
            disabled={!!zip}
            onChange={(e) => {
              setArchivos(Array.from(e.target.files ?? []))
              setResultado(null)
            }}
            aria-label="Archivos MIDI"
          />
        </label>
        <label className="block text-[13px] text-cy-texto">
          <span className="cy-rotulo mb-1 block">o un zip</span>
          <input
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => {
              setZip(e.target.files?.[0] ?? null)
              setResultado(null)
            }}
            aria-label="Archivo zip"
          />
        </label>
        <Casilla etiqueta="Si ya existe uno en esa ruta, actualizarlo" checked={reemplazar} onChange={setReemplazar} />
        <Nota>Se comprueba que cada archivo sea un MIDI válido (máx. 256 KB) y que tenga notas. El tempo, el compás y los compases se leen del propio archivo; luego puedes editarlos.</Nota>
        {error ? <MensajeError>{error}</MensajeError> : null}
        {resultado ? (
          <div className="rounded-lg border border-cy-borde/60 p-3 text-[13px]" role="status" data-testid="resultado-lote">
            <p>
              {plural(resultado.creados.length, 'groove nuevo', 'grooves nuevos')} · {resultado.reemplazados.length} actualizados · {resultado.sinCambios.length} sin cambios · {resultado.errores.length} con problemas
            </p>
            {resultado.errores.length ? (
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-cy-alerta">
                {resultado.errores.map((e) => (
                  <li key={e.archivo}>
                    {e.archivo}: {e.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Hoja>
  )
}

function HojaEdicion({ groove, estilos, onCerrar, onListo }: { groove: GrooveCatalogoAdmin | null; estilos: string[]; onCerrar: () => void; onListo: () => void }) {
  const ejecutar = useEjecutar()
  const [f, setF] = useState<{ nombre: string; estilo: string; tipo: string; compas: string; tempo: string; compases: string; intensidad: string; etiquetas: string; autor: string; licencia: string } | null>(null)
  const [vistoId, setVistoId] = useState<string | null>(null)
  if (groove && groove.id !== vistoId) {
    setVistoId(groove.id)
    setF({ nombre: groove.nombre, estilo: groove.estilo, tipo: groove.tipo, compas: groove.compas, tempo: String(groove.tempo), compases: String(groove.compases), intensidad: String(groove.intensidad), etiquetas: groove.etiquetas.join(', '), autor: groove.autor, licencia: groove.licencia })
  }
  if (!groove) {
    if (vistoId) setVistoId(null)
    return <Hoja abierta={false} onCerrar={onCerrar} titulo="" children={null} />
  }
  const campo = (k: keyof NonNullable<typeof f>) => (e: { target: { value: string } }) => setF((x) => (x ? { ...x, [k]: e.target.value } : x))
  const guardar = async () => {
    if (!f) return
    const d: DatosGrooveAdmin = {
      nombre: f.nombre.trim(),
      estilo: f.estilo.trim(),
      tipo: f.tipo,
      compas: f.compas.trim(),
      tempo: Number(f.tempo),
      compases: Number(f.compases),
      intensidad: Number(f.intensidad),
      etiquetas: etiquetasDeTexto(f.etiquetas),
      autor: f.autor.trim(),
      licencia: f.licencia.trim(),
    }
    if (await ejecutar(() => apiJasWave().admin.grooves.editar(groove.id, d), 'Cambios guardados: las apps los recibirán')) {
      onListo()
      onCerrar()
    }
  }
  return (
    <Hoja
      abierta
      onCerrar={onCerrar}
      titulo={`Editar «${groove.nombre}»`}
      subtitulo={`Revisión ${groove.revision} · ${groove.ruta}`}
      pie={
        <>
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" onClick={() => void guardar()}>
            Guardar
          </Boton>
        </>
      }
    >
      {f ? (
        <div className="space-y-3">
          <Campo etiqueta="Nombre" value={f.nombre} onChange={campo('nombre')} maxLength={80} />
          <Campo etiqueta="Estilo" value={f.estilo} onChange={campo('estilo')} list="estilos-grooves-ed" ayuda="Cambiarlo mueve el groove a otro estilo en las apps." />
          <datalist id="estilos-grooves-ed">
            {estilos.map((e) => (
              <option key={e} value={e} />
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-3">
            <Selector etiqueta="Tipo" value={f.tipo} onChange={campo('tipo')}>
              {Object.entries(TIPOS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Selector>
            <Campo etiqueta="Compás" value={f.compas} onChange={campo('compas')} placeholder="4/4" />
            <Campo etiqueta="Tempo (bpm)" type="number" min={20} max={400} value={f.tempo} onChange={campo('tempo')} />
            <Campo etiqueta="Compases" type="number" min={1} max={64} value={f.compases} onChange={campo('compases')} />
            <Selector etiqueta="Intensidad" value={f.intensidad} onChange={campo('intensidad')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} de 5
                </option>
              ))}
            </Selector>
          </div>
          <Etiquetas valor={f.etiquetas} onCambiar={(v) => setF({ ...f, etiquetas: v })} />
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Autor" value={f.autor} onChange={campo('autor')} maxLength={60} />
            <Campo etiqueta="Licencia" value={f.licencia} onChange={campo('licencia')} maxLength={40} />
          </div>
        </div>
      ) : null}
    </Hoja>
  )
}
