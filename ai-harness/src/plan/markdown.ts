export const PLAN_SLUG = 'plan.md'
export const USER_NOTES_HEADING = 'Notas del usuario'

export const DEFAULT_PLAN_MD = `# Plan

## Intención
_Describe qué quieres producir. La IA y tú pueden editar este archivo._

## Por implementar
- [ ] (añade tareas o pistas aquí)

## En curso

## Implementado

## Evaluación
Aún no hay ejecución. Cuando la IA cree pistas o clips, comparará lo planeado con el DAW.

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
