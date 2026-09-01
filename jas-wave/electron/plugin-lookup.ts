/**
 * Consulta pública (DuckDuckGo + Wikipedia) para uso de VSTs / mapas MIDI.
 * Solo GET JSON; el renderer nunca abre URLs arbitrarias.
 */

export type PluginWebHit = {
  title: string
  snippet: string
  url: string
}

const TIMEOUT_MS = 8000

async function getJson(url: string): Promise<unknown> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'JasWave/0.1 (plugin-lookup)' },
    })
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function lookupPluginOnWeb(pluginName: string): Promise<PluginWebHit[]> {
  const q = `${pluginName} VST plugin MIDI mapping keyswitch notes`
  const hits: PluginWebHit[] = []

  const ddg = (await getJson(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`,
  )) as Record<string, unknown> | null
  if (ddg) {
    const abs = asString(ddg.AbstractText)
    const absUrl = asString(ddg.AbstractURL)
    if (abs) {
      hits.push({ title: asString(ddg.Heading) || pluginName, snippet: abs, url: absUrl })
    }
    const related = Array.isArray(ddg.RelatedTopics) ? ddg.RelatedTopics : []
    for (const raw of related.slice(0, 4)) {
      const t = raw as Record<string, unknown>
      const text = asString(t.Text)
      const url = asString(t.FirstURL)
      if (text) hits.push({ title: text.slice(0, 80), snippet: text, url })
    }
  }

  const wiki = (await getJson(
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(pluginName + ' software')}&limit=3&namespace=0&format=json&origin=*`,
  )) as unknown[] | null
  if (Array.isArray(wiki) && wiki.length >= 4) {
    const titles = Array.isArray(wiki[1]) ? (wiki[1] as unknown[]) : []
    const descs = Array.isArray(wiki[2]) ? (wiki[2] as unknown[]) : []
    const urls = Array.isArray(wiki[3]) ? (wiki[3] as unknown[]) : []
    for (let i = 0; i < titles.length; i++) {
      hits.push({
        title: asString(titles[i]),
        snippet: asString(descs[i]),
        url: asString(urls[i]),
      })
    }
  }

  return hits.filter((h) => h.snippet || h.title).slice(0, 8)
}
