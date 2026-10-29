/**
 * Etiqueta de modo del chat: «/configurar …» se muestra como una píldora con icono y nombre amable,
 * tanto en la caja de texto (con × para quitarla) como en los mensajes ya enviados.
 */
import { CalendarClock, GraduationCap, ListChecks, MessagesSquare, SlidersHorizontal, Target, Users, X, type LucideIcon } from 'lucide-react'
import { parsearComandoChat } from '@jaswave/host-sdk'
import { ChatMarkdown } from '@jaswave/ui-markdown'

export type TipoChip = 'configurar' | 'aprender' | 'meta' | 'plan' | 'entrevista' | 'programar' | 'banda'

interface MetaChip {
  etiqueta: string
  icono: LucideIcon
  /** Texto de ayuda de la caja mientras la etiqueta está puesta. */
  pista: string
}

export const CHIPS_COMANDO: Record<TipoChip, MetaChip> = {
  configurar: { etiqueta: 'Configurar', icono: SlidersHorizontal, pista: '¿Qué quieres crear, cambiar o quitar? (o escribe «salir»)' },
  aprender: { etiqueta: 'Aprender', icono: GraduationCap, pista: '¿Qué debo recordar en este proyecto?' },
  meta: { etiqueta: 'Meta', icono: Target, pista: '¿Qué objetivo quieres que cumpla?' },
  plan: { etiqueta: 'Plan', icono: ListChecks, pista: '¿Sobre qué preparo el plan?' },
  entrevista: { etiqueta: 'Entrevista', icono: MessagesSquare, pista: '¿Qué quieres definir? Te haré preguntas' },
  programar: { etiqueta: 'Programar', icono: CalendarClock, pista: 'Cuándo y qué, p. ej. «en 10 minutos revisar la mezcla»' },
  banda: { etiqueta: 'Banda', icono: Users, pista: '¿Qué tema producimos con la banda?' },
}

/**
 * Si el texto empieza por un comando de modo, devuelve su tipo, cómo se escribió (`/config`) y el resto.
 * `conEspacio` exige que el comando ya esté cerrado por un espacio (mientras se escribe «/conf» no hay etiqueta).
 */
export function separarComando(texto: string, conEspacio = false): { tipo: TipoChip; token: string; resto: string } | null {
  const m = (conEspacio ? /^\/([\w-]+)\s/ : /^\/([\w-]+)(?=\s|$)/).exec(texto)
  if (!m) return null
  const cmd = parsearComandoChat(`/${m[1]}`)
  if (!cmd) return null
  const tipo = (cmd.tipo === 'aprender-deshacer' ? 'aprender' : cmd.tipo) as TipoChip
  return { tipo, token: `/${m[1]}`, resto: texto.slice(m[1].length + 1).replace(/^\s+/, '') }
}

/** Texto de un mensaje; si es del usuario y empieza por un comando de modo, este se ve como etiqueta. */
export function MensajeConComando({ texto, usuario }: { texto: string; usuario: boolean }) {
  const chip = usuario ? separarComando(texto) : null
  if (!chip) return <ChatMarkdown text={texto} />
  return (
    <div className="flex flex-col items-start gap-1">
      <ChipComando tipo={chip.tipo} pequeno />
      {chip.resto ? <ChatMarkdown text={chip.resto} /> : null}
    </div>
  )
}

export function ChipComando({ tipo, onQuitar, pequeno }: { tipo: TipoChip; onQuitar?: () => void; pequeno?: boolean }) {
  const meta = CHIPS_COMANDO[tipo]
  const Icono = meta.icono
  return (
    <span
      data-testid="chip-comando"
      data-comando={tipo}
      className={`inline-flex shrink-0 select-none items-center gap-1 rounded-full bg-accent-amber/10 font-medium text-accent-amber ring-1 ring-accent-amber/30 ${
        pequeno ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]'
      }`}
    >
      <Icono className={pequeno ? 'size-2.5' : 'size-3'} aria-hidden />
      {meta.etiqueta}
      {onQuitar ? (
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar modo ${meta.etiqueta}`}
          title="Quitar"
          className="-mr-0.5 rounded-full p-px text-accent-amber/70 transition-colors hover:bg-accent-amber/20 hover:text-accent-amber"
        >
          <X className="size-2.5" />
        </button>
      ) : null}
    </span>
  )
}
