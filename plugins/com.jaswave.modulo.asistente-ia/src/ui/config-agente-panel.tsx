/**
 * Ajustes → IA → «Personaliza tu asistente», al estilo de un IDE con agente:
 *  - Reglas para todos tus proyectos.
 *  - Instrucciones de este proyecto (AGENTS.md, viaja con el proyecto).
 *  - Habilidades, prompts y planes: archivos de tu carpeta de configuración. Se editan aquí, a mano en
 *    cualquier editor (Abrir carpeta) o con ayuda de la IA (/configurar).
 * Los especialistas (subagentes) se configuran en su propia sección.
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Aviso, Boton, Seccion, carpetaAsistente, getAgentDoc, useDAWState, writeAgentDoc } from '@jaswave/host-sdk'
import type { CarpetaAsistente } from '@jaswave/host-sdk'

import {
  AGENTS_SLUG,
  EVENTO_CONFIG_AGENTE,
  NOMBRE_CARPETA,
  cargarConfigAgente,
  documentosConfig,
  guardarConfigAgente,
  guardarDocumentosConfig,
  habilidadesDisponiblesAgente,
  prepararConfigAgente,
  type HabilidadUsuario,
} from '../motor/config-agente'

const CAMPO =
  'w-full rounded-md border border-border bg-panel-raised px-2 py-1.5 text-[11px] leading-snug text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
/** El texto crece con el contenido (sin barra de desplazamiento) hasta un alto razonable. */
const AREA = `${CAMPO} resize-none [field-sizing:content] min-h-[3.5rem] max-h-72`

type Textos = { titulo: string; ayuda: string; vacio: string; nuevo: string; nombre: string; descripcion: string; contenido: string }

const TEXTOS: Record<CarpetaAsistente, Textos> = {
  habilidades: {
    titulo: 'Habilidades',
    ayuda: 'Pasos que quieres que siga en ciertos pedidos. El asistente las consulta cuando el pedido encaja con la descripción.',
    vacio: 'Aún no tienes habilidades.',
    nuevo: 'Nueva habilidad',
    nombre: 'Nombre (p. ej. Batería de adoración)',
    descripcion: 'Cuándo usarla (p. ej. cuando pida batería para un tema lento)',
    contenido: 'Qué debe hacer, paso a paso (p. ej. bombo en 1 y 3, cross-stick en los versos, platos solo en el coro…)',
  },
  prompts: {
    titulo: 'Prompts',
    ayuda: 'Instrucciones que reutilizas. Pídele al asistente que use uno por su nombre («usa mi prompt Intro épica»).',
    vacio: 'Aún no tienes prompts guardados.',
    nuevo: 'Nuevo prompt',
    nombre: 'Nombre (p. ej. Intro épica)',
    descripcion: 'Para qué sirve (p. ej. empezar un tema con pad y piano)',
    contenido: 'El texto del prompt (p. ej. crea 8 compases de intro con pad cálido, piano arpegiado y un crescendo al final)',
  },
  planes: {
    titulo: 'Planes',
    ayuda: 'Planes de trabajo que quieres repetir en tus proyectos («sigue mi plan Mezcla de adoración»).',
    vacio: 'Aún no tienes planes guardados.',
    nuevo: 'Nuevo plan',
    nombre: 'Nombre (p. ej. Mezcla de adoración)',
    descripcion: 'Para qué sirve (p. ej. dejar lista la mezcla para publicar)',
    contenido: 'Los pasos, uno por línea (p. ej. - [ ] equilibrar volúmenes…)',
  },
}

function nuevoDocumento(): HabilidadUsuario {
  return { id: `nuevo-${Date.now().toString(36)}`, nombre: '', descripcion: '', instrucciones: '', activa: true }
}

type AvisoPanel = { tipo: 'ok' | 'error'; texto: string } | null

function ListaDocumentos(props: {
  carpeta: CarpetaAsistente
  lista: HabilidadUsuario[]
  extra?: React.ReactNode
  onGuardar: (lista: HabilidadUsuario[], texto: string) => void
}) {
  const t = TEXTOS[props.carpeta]
  const [borrador, setBorrador] = useState<HabilidadUsuario[]>(props.lista)
  const [abierta, setAbierta] = useState<string | null>(null)
  useEffect(() => setBorrador(props.lista), [props.lista])
  const cambiar = (id: string, patch: Partial<HabilidadUsuario>) => setBorrador((l) => l.map((h) => (h.id === id ? { ...h, ...patch } : h)))
  const singular = NOMBRE_CARPETA[props.carpeta].singular

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">{t.titulo}</span>
        <Boton
          onClick={() => {
            const h = nuevoDocumento()
            setBorrador((l) => [...l, h])
            setAbierta(h.id)
          }}
        >
          <Plus className="mr-1 inline size-3" />
          {t.nuevo}
        </Boton>
      </div>
      <span className="text-[10px] text-muted-foreground">{t.ayuda}</span>
      {borrador.length === 0 && !props.extra ? <span className="text-[11px] text-muted-foreground">{t.vacio}</span> : null}
      <ul className="flex flex-col gap-1">
        {borrador.map((h) => {
          const abiertaEsta = abierta === h.id
          const guardado = props.lista.some((x) => x.id === h.id)
          return (
            <li key={h.id} className="flex flex-col gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  aria-label={`Activar ${h.nombre || singular}`}
                  checked={h.activa}
                  disabled={!guardado}
                  onChange={(e) =>
                    props.onGuardar(
                      props.lista.map((x) => (x.id === h.id ? { ...x, activa: e.target.checked } : x)),
                      e.target.checked ? 'Activado.' : 'Desactivado.',
                    )
                  }
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAbierta(abiertaEsta ? null : h.id)}>
                  <span className="block truncate text-foreground">{h.nombre || 'Sin nombre'}</span>
                  {h.descripcion && !abiertaEsta ? <span className="block truncate text-[10px] text-muted-foreground">{h.descripcion}</span> : null}
                </button>
                <Boton aria-label={abiertaEsta ? 'Cerrar' : `Editar ${h.nombre}`} onClick={() => setAbierta(abiertaEsta ? null : h.id)}>
                  {abiertaEsta ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </Boton>
                <Boton
                  aria-label={`Eliminar ${h.nombre || singular}`}
                  onClick={() => {
                    if (!guardado) {
                      setBorrador((l) => l.filter((x) => x.id !== h.id))
                      return
                    }
                    props.onGuardar(props.lista.filter((x) => x.id !== h.id), 'Eliminado. Puedes pedirle al asistente que lo recupere.')
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Boton>
              </div>
              {abiertaEsta ? (
                <div className="flex flex-col gap-1.5">
                  <input className={CAMPO} aria-label="Nombre" placeholder={t.nombre} value={h.nombre} onChange={(e) => cambiar(h.id, { nombre: e.target.value })} />
                  <input
                    className={CAMPO}
                    aria-label={props.carpeta === 'habilidades' ? 'Cuándo usarla' : 'Para qué sirve'}
                    placeholder={t.descripcion}
                    value={h.descripcion}
                    onChange={(e) => cambiar(h.id, { descripcion: e.target.value })}
                  />
                  <textarea
                    className={AREA}
                    aria-label="Contenido"
                    placeholder={t.contenido}
                    value={h.instrucciones}
                    onChange={(e) => cambiar(h.id, { instrucciones: e.target.value })}
                  />
                  <div className="flex justify-end">
                    <Boton
                      primario
                      disabled={!h.nombre.trim() || !h.instrucciones.trim()}
                      onClick={() => {
                        props.onGuardar(guardado ? props.lista.map((x) => (x.id === h.id ? h : x)) : [...props.lista, h], 'Guardado.')
                        setAbierta(null)
                      }}
                    >
                      Guardar
                    </Boton>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
        {props.extra}
      </ul>
    </div>
  )
}

export function ConfigAgentePanel() {
  const projectId = useDAWState((s) => s.project?.id || 'default')
  const [reglas, setReglas] = useState(() => cargarConfigAgente().reglas)
  const [docs, setDocs] = useState<Record<CarpetaAsistente, HabilidadUsuario[]>>({ habilidades: [], prompts: [], planes: [] })
  const [agentsMd, setAgentsMd] = useState('')
  const [aviso, setAviso] = useState<AvisoPanel>(null)

  const leer = useCallback(() => {
    setReglas(cargarConfigAgente().reglas)
    setDocs({
      habilidades: documentosConfig('habilidades'),
      prompts: documentosConfig('prompts'),
      planes: documentosConfig('planes'),
    })
  }, [])

  const recargar = useCallback(async () => {
    try {
      await prepararConfigAgente()
    } finally {
      leer()
    }
  }, [leer])

  useEffect(() => {
    void recargar()
    window.addEventListener(EVENTO_CONFIG_AGENTE, leer)
    return () => window.removeEventListener(EVENTO_CONFIG_AGENTE, leer)
  }, [recargar, leer])

  useEffect(() => {
    try {
      setAgentsMd(getAgentDoc(projectId, AGENTS_SLUG)?.content ?? '')
    } catch {
      setAgentsMd('')
    }
  }, [projectId])

  const conAviso = async (accion: () => Promise<void>, ok: string) => {
    try {
      await accion()
      setAviso({ tipo: 'ok', texto: ok })
    } catch (e) {
      setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudo guardar.' })
    } finally {
      leer()
    }
  }

  const guardarReglas = () => {
    if (reglas === cargarConfigAgente().reglas) return
    void conAviso(() => guardarConfigAgente({ ...cargarConfigAgente(), reglas }), 'Reglas guardadas.')
  }

  const guardarAgentsMd = () => {
    try {
      writeAgentDoc(projectId, AGENTS_SLUG, agentsMd, { origin: 'user' })
      setAviso({ tipo: 'ok', texto: 'Instrucciones del proyecto guardadas.' })
    } catch (e) {
      setAviso({ tipo: 'error', texto: e instanceof Error ? e.message : 'No se pudieron guardar las instrucciones.' })
    }
  }

  const delProyecto = habilidadesDisponiblesAgente(projectId, { version: 1, reglas: '', habilidades: [] })

  return (
    <Seccion titulo="Personaliza tu asistente">
      <p className="text-[11px] text-muted-foreground">
        Dile cómo quieres que trabaje. Lo tendrá en cuenta en cada mensaje, igual que si se lo repitieras tú.
      </p>
      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px]">
        <span className="min-w-0 flex-1 text-muted-foreground">
          {carpetaAsistente.enDisco
            ? 'Todo se guarda como archivos en tu carpeta de configuración: puedes abrirlos y editarlos con cualquier editor.'
            : 'Se guarda en este navegador.'}
        </span>
        {carpetaAsistente.enDisco ? (
          <Boton onClick={() => void carpetaAsistente.abrirEnExplorador()}>
            <FolderOpen className="mr-1 inline size-3" />
            Abrir carpeta
          </Boton>
        ) : null}
        <Boton aria-label="Volver a leer la carpeta" onClick={() => void recargar().then(() => setAviso({ tipo: 'ok', texto: 'Configuración actualizada.' }))}>
          <RefreshCw className="size-3.5" />
        </Boton>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ia-reglas" className="text-[11px] font-medium text-foreground">
          Reglas para todos tus proyectos
        </label>
        <textarea
          id="ia-reglas"
          className={AREA}
          value={reglas}
          placeholder="Por ejemplo: responde breve; pregúntame antes de cambiar el tempo; prefiero sonidos cálidos y orgánicos."
          onChange={(e) => setReglas(e.target.value)}
          onBlur={guardarReglas}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="ia-agents-md" className="text-[11px] font-medium text-foreground">
          Instrucciones de este proyecto
        </label>
        <textarea
          id="ia-agents-md"
          className={AREA}
          value={agentsMd}
          placeholder="Por ejemplo: canción de adoración en Re mayor a 72 BPM; voz principal femenina; nada de sintetizadores agresivos."
          onChange={(e) => setAgentsMd(e.target.value)}
          onBlur={guardarAgentsMd}
        />
        <span className="text-[10px] text-muted-foreground">Se guardan con el proyecto y solo se aplican aquí.</span>
      </div>

      {(['habilidades', 'prompts', 'planes'] as const).map((carpeta) => (
        <ListaDocumentos
          key={carpeta}
          carpeta={carpeta}
          lista={docs[carpeta]}
          onGuardar={(lista, texto) => void conAviso(() => guardarDocumentosConfig(carpeta, lista), texto)}
          extra={
            carpeta === 'habilidades' && delProyecto.length
              ? delProyecto.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate text-foreground">{h.nombre}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">de este proyecto</span>
                  </li>
                ))
              : undefined
          }
        />
      ))}

      <p className="text-[10px] text-muted-foreground">
        ¿Prefieres que te ayude? Escribe <b>/configurar</b> en el chat: te hace preguntas, te recomienda y crea, edita o elimina
        habilidades, prompts, planes y reglas por ti. Con «/» también puedes planificar, hacer una entrevista, fijar una meta,
        enseñarle algo o programar una tarea.
      </p>
    </Seccion>
  )
}
