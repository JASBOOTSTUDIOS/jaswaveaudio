/**
 * Documentos Markdown del proyecto (plan.md y otros).
 * Editables por el usuario y por la IA. Persistidos por projectId.
 */

export type AgentDoc = {
  slug: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  origin: 'system' | 'ai' | 'user'
}

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

const STORAGE_KEY = 'jaswave-agent-docs-v1'
const listeners = new Set<() => void>()
const cache = new Map<string, AgentDoc[]>()
const diskRutaByProject = new Map<string, string>()

type ElectronDocsFs = {
  fileSave?: (ruta: string, contenido: string) => Promise<{ success: boolean; error?: string }>
  fileRead?: (ruta: string) => Promise<string>
  fileExists?: (ruta: string) => Promise<boolean>
  fileListDir?: (
    dir: string,
  ) => Promise<{
    success?: boolean
    entries?: Array<{ name: string; isDirectory: boolean; isFile: boolean }>
  }>
}

function electronFs(): ElectronDocsFs | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electron?: ElectronDocsFs }).electron
}

export function docsFolderForProject(projectRuta: string): string {
  const sep = projectRuta.includes('\\') ? '\\' : '/'
  const dir = projectRuta.replace(/[/\\][^/\\]+$/, '')
  return `${dir}${sep}docs`
}

export function bindAgentDocsDisk(projectId: string, projectRuta?: string): void {
  const id = projectId || 'default'
  if (projectRuta) diskRutaByProject.set(id, projectRuta)
  else diskRutaByProject.delete(id)
}

function writeDocsToDisk(projectRuta: string, docs: AgentDoc[]): void {
  const fs = electronFs()
  if (!fs?.fileSave) return
  const folder = docsFolderForProject(projectRuta)
  const sep = folder.includes('\\') ? '\\' : '/'
  void Promise.all(docs.map((d) => fs.fileSave!(`${folder}${sep}${d.slug}`, d.content))).catch(() => undefined)
}

/** Lista slugs `.md` en `{proyecto}/docs/` (disco). */
export async function listDocsSlugsOnDisk(projectRuta?: string): Promise<string[]> {
  const fs = electronFs()
  if (!fs?.fileListDir || !projectRuta) return []
  const folder = docsFolderForProject(projectRuta)
  try {
    const listed = await fs.fileListDir(folder)
    const names = (listed.entries ?? [])
      .filter((e) => e.isFile && /\.md$/i.test(e.name))
      .map((e) => e.name.toLowerCase())
    return [...new Set(names)].sort((a, b) => {
      if (a === PLAN_SLUG) return -1
      if (b === PLAN_SLUG) return 1
      return a.localeCompare(b)
    })
  } catch {
    return []
  }
}

export async function hydrateAgentDocsFromDisk(projectId: string, projectRuta?: string): Promise<void> {
  bindAgentDocsDisk(projectId, projectRuta)
  const fs = electronFs()
  if (!fs?.fileRead || !projectRuta) return
  const folder = docsFolderForProject(projectRuta)
  const sep = folder.includes('\\') ? '\\' : '/'
  // Asegura carpeta docs/ escribiendo plan si hace falta
  if (fs.fileSave) {
    const planPath = `${folder}${sep}${PLAN_SLUG}`
    const exists = fs.fileExists ? await fs.fileExists(planPath) : false
    if (!exists) {
      const plan = listAgentDocs(projectId).find((d) => d.slug === PLAN_SLUG)
      await fs.fileSave(planPath, plan?.content ?? DEFAULT_PLAN_MD)
    }
  }
  const current = listAgentDocs(projectId)
  const diskSlugs = await listDocsSlugsOnDisk(projectRuta)
  const slugs = new Set([...current.map((d) => d.slug), ...diskSlugs, PLAN_SLUG])
  let changed = false
  const next = [...current]
  for (const slug of slugs) {
    const ruta = `${folder}${sep}${slug}`
    try {
      const exists = fs.fileExists ? await fs.fileExists(ruta) : true
      if (!exists) continue
      const content = await fs.fileRead(ruta)
      if (typeof content !== 'string' || !content.trim()) continue
      const prev = next.find((d) => d.slug === slug)
      const normalized = content.replace(/\r\n/g, '\n').trimEnd() + '\n'
      if (prev && prev.content === normalized) continue
      const now = Date.now()
      const doc: AgentDoc = {
        slug,
        title: prev?.title || titleFromSlug(slug),
        content: normalized,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        origin: 'user',
      }
      const idx = next.findIndex((d) => d.slug === slug)
      if (idx >= 0) next[idx] = doc
      else next.push(doc)
      changed = true
    } catch {
      /* archivo ausente o ilegible */
    }
  }
  if (changed) persist(projectId, next)
}

function emit() {
  for (const l of listeners) l()
}

export function subscribeAgentDocs(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function sanitizeDocSlug(raw: string): string {
  const base = raw.trim().replace(/\\/g, '/').split('/').pop() || 'nota.md'
  const cleaned = base
    .replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]+/gi, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const withExt = /\.md$/i.test(cleaned) ? cleaned : `${cleaned || 'nota'}.md`
  return withExt.toLowerCase()
}

function titleFromSlug(slug: string): string {
  return slug.replace(/\.md$/i, '').replace(/-/g, ' ')
}

function loadBag(): Record<string, AgentDoc[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, AgentDoc[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveBag(bag: Record<string, AgentDoc[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bag))
}

function ensurePlan(docs: AgentDoc[]): AgentDoc[] {
  if (docs.some((d) => d.slug === PLAN_SLUG)) return docs
  const now = Date.now()
  return [
    {
      slug: PLAN_SLUG,
      title: 'Plan',
      content: DEFAULT_PLAN_MD,
      createdAt: now,
      updatedAt: now,
      origin: 'system',
    },
    ...docs,
  ]
}

export function listAgentDocs(projectId: string): AgentDoc[] {
  const id = projectId || 'default'
  const hit = cache.get(id)
  if (hit) return hit
  const bag = loadBag()
  const docs = ensurePlan(Array.isArray(bag[id]) ? bag[id]! : [])
  cache.set(id, docs)
  return docs
}

function persist(projectId: string, docs: AgentDoc[]) {
  const id = projectId || 'default'
  const next = ensurePlan(docs).sort((a, b) => {
    if (a.slug === PLAN_SLUG) return -1
    if (b.slug === PLAN_SLUG) return 1
    return b.updatedAt - a.updatedAt
  })
  cache.set(id, next)
  const bag = loadBag()
  bag[id] = next
  saveBag(bag)
  const disk = diskRutaByProject.get(id)
  if (disk) writeDocsToDisk(disk, next)
  emit()
}

export function getAgentDoc(projectId: string, slug: string): AgentDoc | null {
  const s = sanitizeDocSlug(slug)
  return listAgentDocs(projectId).find((d) => d.slug === s) ?? null
}

export function writeAgentDoc(
  projectId: string,
  slug: string,
  content: string,
  opts?: { origin?: AgentDoc['origin']; title?: string; preserveUserNotes?: boolean },
): AgentDoc {
  const s = sanitizeDocSlug(slug)
  const docs = listAgentDocs(projectId)
  const prev = docs.find((d) => d.slug === s)
  let body = content.replace(/\r\n/g, '\n')
  if ((opts?.preserveUserNotes ?? true) && prev) {
    body = mergePreservingUserNotes(prev.content, body)
  }
  if (s === PLAN_SLUG) body = normalizePlanCheckboxes(ensurePlanTemplate(body))
  const now = Date.now()
  const doc: AgentDoc = {
    slug: s,
    title: opts?.title || prev?.title || titleFromSlug(s),
    content: body.trimEnd() + '\n',
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    origin: opts?.origin ?? 'ai',
  }
  persist(projectId, [...docs.filter((d) => d.slug !== s), doc])
  return doc
}

export function createAgentDoc(
  projectId: string,
  slug: string,
  content: string,
  origin: AgentDoc['origin'] = 'ai',
): AgentDoc {
  return writeAgentDoc(projectId, slug, content, { origin, preserveUserNotes: false })
}

export function deleteAgentDoc(projectId: string, slug: string): boolean {
  const s = sanitizeDocSlug(slug)
  if (s === PLAN_SLUG) {
    writeAgentDoc(projectId, PLAN_SLUG, DEFAULT_PLAN_MD, { origin: 'system', preserveUserNotes: false })
    return true
  }
  const docs = listAgentDocs(projectId)
  if (!docs.some((d) => d.slug === s)) return false
  persist(projectId, docs.filter((d) => d.slug !== s))
  return true
}

export function splitMarkdownSections(md: string): Array<{ heading: string | null; body: string }> {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: Array<{ heading: string | null; body: string }> = []
  let heading: string | null = null
  let buf: string[] = []
  const flush = () => {
    out.push({ heading, body: buf.join('\n').replace(/^\n+|\n+$/g, '') })
    buf = []
  }
  for (const line of lines) {
    const m = /^##[ \t]+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      heading = m[1]!.trim()
      continue
    }
    buf.push(line)
  }
  flush()
  return out
}

export function getMarkdownSection(md: string, heading: string): string {
  const hit = splitMarkdownSections(md).find(
    (s) => s.heading && s.heading.toLowerCase() === heading.toLowerCase(),
  )
  return hit?.body ?? ''
}

export function setMarkdownSection(md: string, heading: string, body: string): string {
  const parts = splitMarkdownSections(md)
  const idx = parts.findIndex((s) => s.heading && s.heading.toLowerCase() === heading.toLowerCase())
  const block = body.trim()
  if (idx >= 0) {
    parts[idx] = { heading, body: block }
  } else {
    parts.push({ heading, body: block })
  }
  return parts
    .map((p) => (p.heading ? `## ${p.heading}\n\n${p.body}`.trimEnd() : p.body.trimEnd()))
    .filter((s) => s.length)
    .join('\n\n') + '\n'
}

export const PLAN_SECTION_HEADINGS = [
  'Intención',
  'Por implementar',
  'En curso',
  'Implementado',
  'Evaluación',
  USER_NOTES_HEADING,
] as const

export function normalizePlanCheckboxes(md: string): string {
  let next = md
  for (const heading of ['Por implementar', 'En curso'] as const) {
    const body = getMarkdownSection(next, heading)
    if (!body.trim()) continue
    const lines = body.split('\n').map((line) => {
      if (/^\s*[-*]\s*\[[ xX]\]/.test(line)) return line
      const m = /^\s*[-*]\s+(.+)$/.exec(line)
      if (!m) return line
      const text = m[1]!.trim()
      if (!text || text.startsWith('_') || /^\(/.test(text)) return line
      return `- [ ] ${text}`
    })
    next = setMarkdownSection(next, heading, lines.join('\n'))
  }
  return next
}

/** Completa secciones que el modelo suele omitir, sin pisar lo ya escrito. */
export function ensurePlanTemplate(md: string): string {
  let next = (md || '').replace(/\r\n/g, '\n').trim()
  if (!next) return DEFAULT_PLAN_MD
  if (!/^#\s+/m.test(next)) next = `# Plan\n\n${next}`
  for (const heading of PLAN_SECTION_HEADINGS) {
    const parts = splitMarkdownSections(next)
    const has = parts.some((p) => p.heading && p.heading.toLowerCase() === heading.toLowerCase())
    if (has) continue
    const fallback = getMarkdownSection(DEFAULT_PLAN_MD, heading).trim() || '_'
    next = setMarkdownSection(next, heading, fallback)
  }
  return next.endsWith('\n') ? next : `${next}\n`
}

export function mergePreservingUserNotes(previous: string, incoming: string): string {
  const userNotes = getMarkdownSection(previous, USER_NOTES_HEADING)
  let next = incoming
  if (!getMarkdownSection(next, USER_NOTES_HEADING) && userNotes) {
    next = setMarkdownSection(next, USER_NOTES_HEADING, userNotes)
  } else if (userNotes.trim() && userNotes.trim() !== '_Tus notas no se pisan automáticamente. Escríbelas aquí._') {
    next = setMarkdownSection(next, USER_NOTES_HEADING, userNotes)
  }
  return next
}

export function parseDocBlocksFromText(text: string): Array<{ slug: string; content: string }> {
  const out: Array<{ slug: string; content: string }> = []
  const re = /<<<DOC\s+([^\s>]+)\s*([\s\S]*?)\s*DOC>>>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({ slug: sanitizeDocSlug(m[1]!), content: m[2]!.trim() + '\n' })
  }
  return out
}

export function applyMarkdownDocsFromModel(
  projectId: string,
  text: string,
): { slugs: string[]; edits: import('./chat-doc-edits').ChatDocEdit[] } {
  const slugs: string[] = []
  const edits: import('./chat-doc-edits').ChatDocEdit[] = []
  for (const b of parseDocBlocksFromText(text)) {
    const prev = getAgentDoc(projectId, b.slug)
    const previousContent = prev?.content ?? ''
    const doc = writeAgentDoc(projectId, b.slug, b.content, { origin: 'ai' })
    slugs.push(b.slug)
    edits.push({
      slug: doc.slug,
      title: doc.title,
      action: prev ? 'write' : 'create',
      previousContent,
      newContent: doc.content,
      updatedAt: doc.updatedAt,
    })
  }
  return { slugs, edits }
}

export function formatDocsForPrompt(projectId: string, maxChars = 14000): string {
  const docs = listAgentDocs(projectId)
  const names = docs.map((d) => d.slug).join(', ')
  const plan = docs.find((d) => d.slug === PLAN_SLUG)
  let planBody = plan?.content ?? DEFAULT_PLAN_MD
  if (planBody.length > maxChars) planBody = planBody.slice(0, maxChars) + '\n…[truncado]'
  return [
    '## Documentos Markdown del proyecto (editables por el USUARIO y por ti)',
    `Archivos: ${names || 'plan.md'}`,
    'El usuario puede abrir el panel Docs y editar estos .md. NO borres «Notas del usuario».',
    'plan.md es la fuente de verdad del trabajo. Actualízalo cuando cambie el objetivo, arranque o falle una operación compleja, o el usuario lo pida — no en cada pregunta corta.',
    '1) Si el pedido cambia género, pistas, forma o mezcla: reescribe intención y tareas `- [ ]` concretas (pista «Nombre», clip de sección, BPM…).',
    '2) Emite ACTIONS alineadas a las tareas pendientes de ESTE pedido.',
    '3) Tras mutar el DAW el cliente marcará `[x]` lo que ya exista. Tú también puedes doc.evaluate.',
    '<<<DOC plan.md',
    '(markdown completo del plan)',
    'DOC>>>',
    '',
    '### plan.md actual',
    planBody,
  ].join('\n')
}

export function docsPromptActions(): string {
  return [
    '- doc.create { slug: "notas.md", content }  ← nuevo markdown',
    '- doc.write { slug: "plan.md", content }  ← reemplaza el archivo (preserva Notas del usuario)',
    '- doc.append { slug, markdown, section? }  ← añade al final o a una sección ##',
    '- doc.list',
    '- doc.read { slug }',
    '- doc.evaluate  ← compara plan.md con el DAW y reescribe Evaluación + marca Implementado',
    'Ciclo: si el objetivo cambió, actualizar plan.md → implementar → evaluar y marcar lo hecho.',
  ].join('\n')
}

