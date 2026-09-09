export const PLAN_SLUG = 'plan.md'
export const USER_NOTES_HEADING = 'Notas del usuario'

export const DEFAULT_PLAN_MD = `# Plan

## Intención
### Qué se busca
_Género, tempo, tonalidad, mood y referencia. La IA lo reescribe en cada pedido._

### Forma
_Intro / verso / coro / puente — compases y qué debe pasar en cada uno._

### Pistas previstas
_Nombre, rol e instrumento de cada pista._

### Último pedido
_Se actualiza en cada mensaje del usuario._

## Por implementar
- [ ] (tareas concretas y comprobables: pista «Nombre», BPM, clip de sección con notas, mezcla…)

## En curso

## Implementado

## Evaluación
Aún no hay ejecución. Cada turno compara lo planeado con el DAW y marca \`[x]\` lo hecho.

## ${USER_NOTES_HEADING}
_Tus notas no se pisan automáticamente. Escríbelas aquí._
`

export function getMarkdownSection(md: string, heading: string): string {
  const re = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, 'im')
  const match = re.exec(md)
  if (!match) return ''
  const start = match.index! + match[0].length
  const rest = md.slice(start)
  const next = /^##\s+/m.exec(rest)
  const body = next ? rest.slice(0, next.index) : rest
  return body.replace(/^\n+/, '').replace(/\n+$/, '')
}

export function setMarkdownSection(md: string, heading: string, body: string): string {
  const re = new RegExp(`(^##\\s+${escapeRegExp(heading)}\\s*$)[\\s\\S]*?(?=^##\\s+|\\Z)`, 'im')
  const block = `## ${heading}\n${body.trim()}\n`
  if (re.test(md)) return md.replace(re, block)
  return `${md.trim()}\n\n${block}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
