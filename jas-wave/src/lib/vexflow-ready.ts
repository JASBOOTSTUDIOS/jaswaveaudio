/**
 * VexFlow 5 requiere cargar Bravura antes de dibujar; sin eso aparecen cajas vacías.
 */

export type VexFlowModule = typeof import('vexflow/bravura')

/** Misma URL que usa VexFlow internamente (Font.HOST_URL + Font.FILES.Bravura). */
const BRAVURA_WOFF2 =
  'https://cdn.jsdelivr.net/npm/@vexflow-fonts/bravura@1.0.2/bravura.woff2'

const BRAVURA_FACE = `@font-face{font-family:'Bravura';src:url('${BRAVURA_WOFF2}') format('woff2');font-display:block;}`

let ready: Promise<VexFlowModule> | null = null

export async function ensureVexFlowFonts(): Promise<VexFlowModule> {
  if (!ready) {
    ready = (async () => {
      const vf = await import('vexflow/bravura')
      if (typeof document !== 'undefined') {
        try {
          await document.fonts.load('24px Bravura')
          await document.fonts.load('12px Academico')
        } catch {
          /* ignore */
        }
        await document.fonts.ready
      }
      return vf
    })()
  }
  return ready
}

/** Incrusta @font-face Bravura en SVG (export PDF / raster). */
export function embedBravuraInSvg(svg: string): string {
  const style = `<style type="text/css"><![CDATA[${BRAVURA_FACE}]]></style>`
  if (/<defs[\s>]/i.test(svg)) {
    return svg.replace(/<defs([^>]*)>/i, `<defs$1>${style}`)
  }
  return svg.replace(/<svg([^>]*)>/i, `<svg$1><defs>${style}</defs>`)
}
