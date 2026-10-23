import { useEffect, useId, useState } from 'react'

type Props = {
  source: string
}

let mermaidReady: Promise<typeof import('mermaid')['default']> | null = null

function loadMermaid() {
  if (!mermaidReady) {
      mermaidReady = import('mermaid').then((mod) => {
      const mermaid = ((mod as { default?: unknown }).default ?? mod) as unknown as typeof import('mermaid')['default']
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          darkMode: true,
          background: 'transparent',
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          fontSize: '14px',
          primaryColor: '#1e1e1e',
          primaryTextColor: '#e6e6e6',
          primaryBorderColor: '#d0d0d0',
          secondaryColor: '#1e1e1e',
          secondaryTextColor: '#e6e6e6',
          secondaryBorderColor: '#d0d0d0',
          tertiaryColor: '#1e1e1e',
          tertiaryTextColor: '#e6e6e6',
          tertiaryBorderColor: '#d0d0d0',
          lineColor: '#d0d0d0',
          textColor: '#e6e6e6',
          mainBkg: '#1e1e1e',
          nodeBorder: '#d0d0d0',
          clusterBkg: '#181818',
          clusterBorder: '#d0d0d0',
          titleColor: '#e6e6e6',
          edgeLabelBackground: '#1e1e1e',
          nodeTextColor: '#e6e6e6',
        },
        flowchart: {
          useMaxWidth: true,
          htmlLabels: false,
          padding: 12,
        },
      })
      return mermaid
    })
  }
  return mermaidReady
}

/** Diagrama Mermaid en tema oscuro (preview de documentos). */
export function MermaidDiagram({ source }: Props) {
  const uid = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const id = `jw-mmd-${uid}-${Math.random().toString(36).slice(2, 8)}`
    setSvg(null)
    setError(null)
    void loadMermaid()
      .then((mermaid) => mermaid.render(id, source.trim() || 'flowchart TD\n  A[ ]'))
      .then((out) => {
        if (!cancelled) setSvg(out.svg)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Diagrama inválido')
      })
    return () => {
      cancelled = true
    }
  }, [source, uid])

  if (error) {
    return (
      <pre className="doc-md-code" data-mermaid-error="">
        {source}
        {'\n'}
        <span className="text-muted-foreground">{error}</span>
      </pre>
    )
  }

  if (!svg) {
    return <div className="doc-md-mermaid-placeholder" aria-hidden />
  }

  return <div className="doc-md-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}
