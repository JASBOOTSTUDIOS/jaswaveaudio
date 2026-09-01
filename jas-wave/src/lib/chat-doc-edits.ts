/**
 * Ediciones de documentos Markdown mostradas en el chat del Coproducer.
 */

import type { ActionResult } from './ai-daw-agent'

export type ChatDocEdit = {
  slug: string
  title: string
  action: 'create' | 'write' | 'append'
  previousContent: string
  newContent: string
  updatedAt: number
}

export type DocEditResultData = {
  slug: string
  action: ChatDocEdit['action']
  previousContent: string
  newContent: string
  title?: string
}

export function extractDocEditsFromResults(results: ActionResult[]): ChatDocEdit[] {
  const edits: ChatDocEdit[] = []
  for (const r of results) {
    if (!r.success) continue
    if (r.type !== 'doc.create' && r.type !== 'doc.write' && r.type !== 'doc.append') continue
    const data = r.data as DocEditResultData | undefined
    if (!data?.slug || data.newContent == null) continue
    edits.push({
      slug: data.slug,
      title: data.title ?? data.slug,
      action: data.action ?? (r.type === 'doc.create' ? 'create' : r.type === 'doc.append' ? 'append' : 'write'),
      previousContent: data.previousContent ?? '',
      newContent: data.newContent,
      updatedAt: Date.now(),
    })
  }
  return edits
}

/** Conserva la última edición por slug. */
export function mergeDocEdits(...groups: ChatDocEdit[][]): ChatDocEdit[] {
  const bySlug = new Map<string, ChatDocEdit>()
  for (const group of groups) {
    for (const edit of group) {
      bySlug.set(edit.slug, edit)
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

export function openDocFromChat(slug: string, mode: 'edit' | 'preview' = 'edit'): void {
  void import('./docs-editor-store').then(({ openDocsTab }) => {
    openDocsTab(slug, mode)
  })
  void import('@/src/workspace/types').then(({ requestOpenTool }) => {
    requestOpenTool('docs', { zone: 'left' })
  })
}
