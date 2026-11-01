/**
 * Persistencia de runs del motor de agente en `userData/agent-runs/<id>.json` (A1).
 * Validación estricta: id seguro para nombre de archivo, JSON de tamaño acotado cuyo `id`
 * coincide, rutas comprobadas con path-grants (userData ya está concedido en lectura/escritura).
 */

import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { writeFileAtomic } from './atomic-write'

export const AGENT_RUN_ID_RE = /^[A-Za-z0-9_-]{1,80}$/
export const AGENT_RUN_MAX_BYTES = 2 * 1024 * 1024
export const AGENT_RUN_MAX_FILES = 200

export type AgentRunMeta = {
  id: string
  conversationId: string
  messageId?: string
  status: string
  mode?: string
  updatedAt: number
  userText: string
}

export type AgentRunStoreDeps = {
  dir: () => string
  assertWrite: (p: string) => string
  assertRead: (p: string) => string
}

export function createAgentRunStore(deps: AgentRunStoreDeps) {
  const fileFor = (id: string) => path.join(deps.dir(), `${id}.json`)

  const prune = async () => {
    try {
      const dir = deps.dir()
      const names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json'))
      if (names.length <= AGENT_RUN_MAX_FILES) return
      const stats = await Promise.all(
        names.map(async (n) => ({ n, t: (await fsp.stat(path.join(dir, n))).mtimeMs })),
      )
      stats.sort((a, b) => a.t - b.t)
      for (const s of stats.slice(0, stats.length - AGENT_RUN_MAX_FILES)) {
        await fsp.rm(deps.assertWrite(path.join(dir, s.n)), { force: true })
      }
    } catch {
      /* poda best-effort */
    }
  }

  return {
    async save(runId: unknown, json: unknown): Promise<{ ok: boolean; error?: string }> {
      if (typeof runId !== 'string' || !AGENT_RUN_ID_RE.test(runId)) return { ok: false, error: 'runId inválido' }
      if (typeof json !== 'string' || json.length > AGENT_RUN_MAX_BYTES) return { ok: false, error: 'run demasiado grande o inválido' }
      let parsed: { id?: unknown }
      try {
        parsed = JSON.parse(json) as { id?: unknown }
      } catch {
        return { ok: false, error: 'JSON inválido' }
      }
      if (!parsed || typeof parsed !== 'object' || parsed.id !== runId) return { ok: false, error: 'id no coincide' }
      try {
        const file = deps.assertWrite(fileFor(runId))
        await fsp.mkdir(path.dirname(file), { recursive: true })
        await writeFileAtomic(file, json)
        void prune()
        return { ok: true }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },

    async load(runId: unknown): Promise<string | null> {
      if (typeof runId !== 'string' || !AGENT_RUN_ID_RE.test(runId)) return null
      try {
        return await fsp.readFile(deps.assertRead(fileFor(runId)), 'utf8')
      } catch {
        return null
      }
    },

    async list(limit: unknown): Promise<AgentRunMeta[]> {
      const max = Math.max(1, Math.min(200, Number(limit) || 50))
      let names: string[] = []
      try {
        names = (await fsp.readdir(deps.assertRead(deps.dir()))).filter((n) => n.endsWith('.json'))
      } catch {
        return []
      }
      const metas: AgentRunMeta[] = []
      for (const n of names) {
        try {
          const raw = await fsp.readFile(deps.assertRead(path.join(deps.dir(), n)), 'utf8')
          const r = JSON.parse(raw) as Record<string, unknown>
          if (typeof r.id !== 'string') continue
          metas.push({
            id: r.id,
            conversationId: String(r.conversationId ?? ''),
            messageId: typeof r.messageId === 'string' ? r.messageId : undefined,
            status: String(r.status ?? ''),
            mode: typeof r.mode === 'string' ? r.mode : undefined,
            updatedAt: Number(r.updatedAt) || 0,
            userText: String(r.userText ?? '').slice(0, 120),
          })
        } catch {
          /* archivo corrupto: se ignora */
        }
      }
      return metas.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max)
    },

    async remove(runId: unknown): Promise<boolean> {
      if (typeof runId !== 'string' || !AGENT_RUN_ID_RE.test(runId)) return false
      try {
        await fsp.rm(deps.assertWrite(fileFor(runId)), { force: true })
        return true
      } catch {
        return false
      }
    },
  }
}
