/**
 * Renderizado de partitura con VexFlow (SVG) — layout por compases.
 */

import type { MidiNote } from '@jaswave/shared'
import { ensureVexFlowFonts, embedBravuraInSvg } from './vexflow-ready'

export type ScoreExportOpts = {
  title?: string
  subtitle?: string
  bpm: number
  drums?: boolean
  barsPerSystem?: number
}

const DRUM_PITCHES = new Set([35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 57, 59])

export function isDrumishNotes(notes: MidiNote[]): boolean {
  if (!notes.length) return false
  const drumHits = notes.filter((n) => DRUM_PITCHES.has(Math.round(n.pitch))).length
  return drumHits / notes.length > 0.55
}

export type ScorePage = {
  svg: string
  width: number
  height: number
}

export type ScoreRenderResult = {
  pages: ScorePage[]
  barCount: number
  noteCount: number
}

const BEATS_PER_BAR = 4
const SIXTEENTHS_PER_BAR = 16
export const SCORE_BAR_WIDTH = 148
export const SCORE_STAVE_TOP = 28
export const SCORE_LINE_SPACING = 10
const BARS_PER_SYSTEM = 4
const BAR_WIDTH = SCORE_BAR_WIDTH
const SYSTEM_HEIGHT = 118
const PAGE_WIDTH = 816
const PAGE_HEIGHT = 1056
const MARGIN_X = 52
const MARGIN_TOP = 96
const MARGIN_BOTTOM = 56
const HEADER_HEIGHT = 72
const SYSTEMS_PER_PAGE = Math.floor(
  (PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM - HEADER_HEIGHT) / SYSTEM_HEIGHT,
)

/** GM drum → posición VexFlow (percusión). */
const DRUM_VF_KEY: Record<number, string> = {
  35: 'f/4/x2',
  36: 'f/4/x2',
  37: 'a/4/x2',
  38: 'c/5',
  40: 'e/5/x3',
  41: 'f/4/x2',
  42: 'g/5/x2',
  43: 'f/4/x2',
  44: 'g/5/x2',
  45: 'a/4/x2',
  46: 'b/4/x2',
  47: 'a/4/x2',
  48: 'b/4/x2',
  49: 'c/5/x2',
  50: 'd/5/x2',
  51: 'e/5/x2',
  57: 'c/5/x2',
  59: 'd/5/x2',
}

const PITCH_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const

function midiToMelodicKey(pitch: number): string {
  const p = Math.max(0, Math.min(127, Math.round(pitch)))
  const name = PITCH_NAMES[((p % 12) + 12) % 12]!
  const oct = Math.floor(p / 12) - 1
  return `${name}/${oct}`
}

function pitchToStaffY(pitch: number, drums: boolean, staffTop: number, spacing: number): number {
  if (drums) {
    const map: Record<number, number> = {
      36: 4, 35: 4, 38: 2, 40: 2, 37: 2.5, 42: 0, 44: 0, 46: -0.5, 49: -1, 57: -1,
      51: -0.5, 50: 1, 47: 1.5, 45: 3, 43: 3.5, 41: 3.5,
    }
    const line = map[pitch] ?? 2
    return staffTop + line * spacing
  }
  const steps = (pitch - 64) / 2
  return staffTop + 4 * spacing - steps * (spacing / 2)
}

export function beatInBarToX(beatInBar: number, barWidth = SCORE_BAR_WIDTH): number {
  return (beatInBar / BEATS_PER_BAR) * barWidth
}

export function xToBeatInBar(x: number, barWidth = SCORE_BAR_WIDTH): number {
  return Math.max(0, Math.min(BEATS_PER_BAR, (x / barWidth) * BEATS_PER_BAR))
}

export function yToPitch(y: number, drums: boolean, staffTop = SCORE_STAVE_TOP, spacing = SCORE_LINE_SPACING): number {
  if (drums) {
    let best = 38
    let bestD = Infinity
    for (const p of Object.keys(DRUM_VF_KEY).map(Number)) {
      const py = pitchToStaffY(p, true, staffTop, spacing)
      const d = Math.abs(py - y)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best
  }
  let best = 60
  let bestD = Infinity
  for (let p = 36; p <= 96; p++) {
    const py = pitchToStaffY(p, false, staffTop, spacing)
    const d = Math.abs(py - y)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

export function computeScoreBarCount(notes: MidiNote[]): number {
  return totalBars(notes)
}

function pitchToVfKey(pitch: number, drums: boolean): string {
  if (drums) return DRUM_VF_KEY[Math.round(pitch)] ?? 'c/5/x2'
  return midiToMelodicKey(pitch)
}

export { pitchToVfKey, pitchToStaffY, BEATS_PER_BAR }

function sixteenthsToDuration(sixteenths: number, drums = false): string {
  if (drums) return '16'
  const s = Math.max(1, Math.min(16, sixteenths))
  if (s >= 16) return 'w'
  if (s >= 8) return 'h'
  if (s >= 4) return 'q'
  if (s >= 2) return '8'
  return '16'
}

type BarGroup = { sixteenth: number; pitches: number[] }

function groupBarNotes(notes: MidiNote[], barIndex: number): BarGroup[] {
  const groups = new Map<number, number[]>()
  for (const n of notes) {
    const inicio = Math.max(0, Number(n.inicio) || 0)
    const bar = Math.floor(inicio / BEATS_PER_BAR)
    if (bar !== barIndex) continue
    const inBar = inicio - bar * BEATS_PER_BAR
    const sixteenth = Math.min(SIXTEENTHS_PER_BAR - 1, Math.round(inBar * 4))
    const list = groups.get(sixteenth) ?? []
    list.push(Math.round(n.pitch))
    groups.set(sixteenth, list)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sixteenth, pitches]) => ({ sixteenth, pitches }))
}

function totalBars(notes: MidiNote[]): number {
  let maxEnd = BEATS_PER_BAR
  for (const n of notes) {
    const start = Math.max(0, Number(n.inicio) || 0)
    const end = start + Math.max(0.125, Number(n.duracion) || 0.25)
    maxEnd = Math.max(maxEnd, end)
  }
  return Math.max(1, Math.ceil(maxEnd / BEATS_PER_BAR))
}

async function buildTickablesForBar(
  barGroups: BarGroup[],
  drums: boolean,
  StaveNote: typeof import('vexflow').StaveNote,
): Promise<InstanceType<typeof StaveNote>[]> {
  const tickables: InstanceType<typeof StaveNote>[] = []
  let pos = 0
  for (let gi = 0; gi < barGroups.length; gi++) {
    const g = barGroups[gi]!
    if (g.sixteenth > pos) {
      const gap = g.sixteenth - pos
      tickables.push(
        new StaveNote({
          keys: ['b/4/r'],
          duration: sixteenthsToDuration(gap, drums),
          clef: drums ? 'percussion' : 'treble',
        }),
      )
      pos = g.sixteenth
    }
    const nextPos = barGroups[gi + 1]?.sixteenth ?? SIXTEENTHS_PER_BAR
    const dur = drums ? 1 : Math.max(1, nextPos - g.sixteenth)
    const keys = [...new Set(g.pitches)].map((p) => pitchToVfKey(p, drums))
    tickables.push(
      new StaveNote({
        keys: keys.length ? keys : ['c/4'],
        duration: sixteenthsToDuration(dur, drums),
        clef: drums ? 'percussion' : 'treble',
      }),
    )
    pos += dur
  }
  if (pos < SIXTEENTHS_PER_BAR) {
    tickables.push(
      new StaveNote({
        keys: ['b/4/r'],
        duration: sixteenthsToDuration(SIXTEENTHS_PER_BAR - pos, drums),
        clef: drums ? 'percussion' : 'treble',
      }),
    )
  }
  return tickables
}

async function buildTickablesFromBarNotes(
  barNotes: MidiNote[],
  drums: boolean,
  StaveNote: typeof import('vexflow').StaveNote,
  selectedIds?: Set<string>,
): Promise<InstanceType<typeof StaveNote>[]> {
  if (drums && barNotes.length > 0) {
    const barIndex = Math.floor((barNotes[0]?.inicio ?? 0) / BEATS_PER_BAR)
    const groups = groupBarNotes(barNotes, barIndex)
    return buildTickablesForBar(groups, true, StaveNote)
  }

  const sorted = [...barNotes].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
  const tickables: InstanceType<typeof StaveNote>[] = []
  let pos = 0
  for (const n of sorted) {
    const inBar = n.inicio - Math.floor(n.inicio / BEATS_PER_BAR) * BEATS_PER_BAR
    const onset16 = Math.min(SIXTEENTHS_PER_BAR - 1, Math.max(0, Math.round(inBar * 4)))
    const dur16 = Math.max(1, Math.min(SIXTEENTHS_PER_BAR - onset16, Math.round((n.duracion || 0.25) * 4)))
    if (onset16 > pos) {
      tickables.push(
        new StaveNote({
          keys: ['b/4/r'],
          duration: sixteenthsToDuration(onset16 - pos, drums),
          clef: drums ? 'percussion' : 'treble',
        }),
      )
      pos = onset16
    }
    const note = new StaveNote({
      keys: [pitchToVfKey(n.pitch, drums)],
      duration: sixteenthsToDuration(dur16, drums),
      clef: drums ? 'percussion' : 'treble',
    })
    if (selectedIds?.has(n.id)) {
      note.setStyle({ fillStyle: '#d97706', strokeStyle: '#b45309' })
    }
    tickables.push(note)
    pos = onset16 + dur16
  }
  if (pos < SIXTEENTHS_PER_BAR) {
    tickables.push(
      new StaveNote({
        keys: ['b/4/r'],
        duration: sixteenthsToDuration(SIXTEENTHS_PER_BAR - pos, drums),
        clef: drums ? 'percussion' : 'treble',
      }),
    )
  }
  if (!tickables.length) {
    tickables.push(
      new StaveNote({
        keys: ['b/4/r'],
        duration: 'w',
        clef: drums ? 'percussion' : 'treble',
      }),
    )
  }
  return tickables
}

/** Renderiza un compás en un contenedor DOM (editor interactivo). */
export async function renderScoreBarToContainer(
  container: HTMLElement,
  barIndex: number,
  notes: MidiNote[],
  drums: boolean,
  opts?: { showClef?: boolean; selectedIds?: Set<string> },
): Promise<void> {
  const { Renderer, Stave, StaveNote, Voice, Formatter } = await ensureVexFlowFonts()
  container.innerHTML = ''
  const width = BAR_WIDTH + 24
  const height = SYSTEM_HEIGHT
  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const ctx = renderer.getContext()
  ctx.setFillStyle('#1a1a1e')
  ctx.setStrokeStyle('#1a1a1e')

  const stave = new Stave(8, SCORE_STAVE_TOP - 8, BAR_WIDTH)
  if (opts?.showClef) {
    stave.addClef(drums ? 'percussion' : 'treble')
    if (barIndex === 0) stave.addTimeSignature('4/4')
  }
  stave.setContext(ctx).draw()

  const barNotes = notes.filter((n) => Math.floor((n.inicio ?? 0) / BEATS_PER_BAR) === barIndex)
  const tickables = await buildTickablesFromBarNotes(barNotes, drums, StaveNote, opts?.selectedIds)
  const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false)
  voice.addTickables(tickables)
  new Formatter().joinVoices([voice]).format([voice], BAR_WIDTH - 16)
  voice.draw(ctx, stave)

  ctx.setFont('10px Georgia, serif')
  ctx.setFillStyle('#6b6b70')
  ctx.fillText(String(barIndex + 1), 2, 14)
}

async function renderSystemSvg(
  barIndices: number[],
  notes: MidiNote[],
  drums: boolean,
  systemIndex: number,
  selectedIds?: Set<string>,
): Promise<{ svg: string; width: number; height: number }> {
  const { Renderer, Stave, StaveNote, Voice, Formatter } = await ensureVexFlowFonts()
  const width = MARGIN_X * 2 + BAR_WIDTH * barIndices.length
  const height = SYSTEM_HEIGHT + 24
  const div = document.createElement('div')
  div.style.position = 'fixed'
  div.style.left = '-99999px'
  div.style.top = '0'
  document.body.appendChild(div)

  try {
    const renderer = new Renderer(div, Renderer.Backends.SVG)
    renderer.resize(width, height)
    const ctx = renderer.getContext()
    ctx.setFillStyle('#1a1a1e')
    ctx.setStrokeStyle('#1a1a1e')

    let x = MARGIN_X
    for (let i = 0; i < barIndices.length; i++) {
      const barIndex = barIndices[i]!
      const stave = new Stave(x, 28, BAR_WIDTH)
      if (systemIndex === 0 && i === 0) {
        stave.addClef(drums ? 'percussion' : 'treble').addTimeSignature('4/4')
      }
      stave.setContext(ctx).draw()

      const barNotes = notes.filter((n) => Math.floor((n.inicio ?? 0) / BEATS_PER_BAR) === barIndex)
      const tickables = barNotes.length
        ? await buildTickablesFromBarNotes(barNotes, drums, StaveNote, selectedIds)
        : [
            new StaveNote({
              keys: ['b/4/r'],
              duration: 'w',
              clef: drums ? 'percussion' : 'treble',
            }),
          ]
      const voice = new Voice({ numBeats: 4, beatValue: 4 }).setStrict(false)
      voice.addTickables(tickables)
      new Formatter().joinVoices([voice]).format([voice], BAR_WIDTH - 18)
      voice.draw(ctx, stave)

      // Número de compás
      ctx.setFont('11px Georgia, serif')
      ctx.fillText(String(barIndex + 1), x + 4, 18)

      x += BAR_WIDTH
    }

    const svgEl = div.querySelector('svg')
    const svg = svgEl ? embedBravuraInSvg(svgEl.outerHTML) : ''
    return { svg, width, height }
  } finally {
    document.body.removeChild(div)
  }
}

function wrapPageSvg(
  systems: { svg: string; width: number; height: number }[],
  opts: ScoreExportOpts & { drums: boolean; pageIndex: number; pageCount: number },
): ScorePage {
  const contentH = systems.length * SYSTEM_HEIGHT
  const height = MARGIN_TOP + HEADER_HEIGHT + contentH + MARGIN_BOTTOM
  const width = PAGE_WIDTH

  const title = escapeXml(opts.title || 'Partitura')
  const subtitle =
    opts.subtitle ||
    `${opts.bpm} BPM · ${opts.drums ? 'Percusión' : 'Melódico'} · Compás 4/4`

  let y = MARGIN_TOP
  const systemFragments = systems
    .map((sys, i) => {
      const inner = extractSvgInner(sys.svg)
      const frag = `<g transform="translate(0, ${y + HEADER_HEIGHT + i * SYSTEM_HEIGHT})">${inner}</g>`
      return frag
    })
    .join('\n')

  const raw = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#faf9f7"/>
  <rect x="${MARGIN_X - 8}" y="${MARGIN_TOP - 12}" width="${width - (MARGIN_X - 8) * 2}" height="${height - MARGIN_TOP - MARGIN_BOTTOM + 12}" rx="4" fill="#ffffff" stroke="#e8e4dc" stroke-width="1"/>
  <text x="${MARGIN_X}" y="${y + 28}" font-family="Georgia, 'Times New Roman', serif" font-size="22" font-weight="600" fill="#1a1a1e">${title}</text>
  <text x="${MARGIN_X}" y="${y + 48}" font-family="system-ui, sans-serif" font-size="11" fill="#6b6b70">${escapeXml(subtitle)}</text>
  <line x1="${MARGIN_X}" y1="${y + 58}" x2="${width - MARGIN_X}" y2="${y + 58}" stroke="#e0dcd4" stroke-width="1"/>
  ${systemFragments}
  <text x="${width - MARGIN_X}" y="${height - 20}" text-anchor="end" font-family="system-ui, sans-serif" font-size="9" fill="#9a9a9e">JasWave · ${opts.pageIndex + 1} / ${opts.pageCount}</text>
</svg>`

  return { svg: embedBravuraInSvg(raw), width, height }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function extractSvgInner(svg: string): string {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i)
  return m?.[1]?.trim() ?? ''
}

/** Renderiza la partitura completa a páginas SVG (para vista previa y PDF). */
export async function renderScoreSvg(
  notes: MidiNote[],
  opts: ScoreExportOpts,
): Promise<ScoreRenderResult> {
  if (typeof document === 'undefined') {
    return { pages: [], barCount: 0, noteCount: notes.length }
  }

  await ensureVexFlowFonts()

  const drums = opts.drums ?? isDrumishNotes(notes)
  const barCount = totalBars(notes)
  const systems: { barIndices: number[]; systemIndex: number }[] = []
  for (let b = 0; b < barCount; b += BARS_PER_SYSTEM) {
    const barIndices: number[] = []
    for (let i = 0; i < BARS_PER_SYSTEM && b + i < barCount; i++) barIndices.push(b + i)
    systems.push({ barIndices, systemIndex: systems.length })
  }

  const renderedSystems: { svg: string; width: number; height: number }[] = []
  for (const sys of systems) {
    renderedSystems.push(await renderSystemSvg(sys.barIndices, notes, drums, sys.systemIndex))
  }

  const pages: ScorePage[] = []
  const pageCount = Math.max(1, Math.ceil(renderedSystems.length / SYSTEMS_PER_PAGE))
  for (let p = 0; p < pageCount; p++) {
    const slice = renderedSystems.slice(p * SYSTEMS_PER_PAGE, (p + 1) * SYSTEMS_PER_PAGE)
    if (!slice.length && p === 0) {
      pages.push(
        wrapPageSvg([], {
          ...opts,
          drums,
          pageIndex: 0,
          pageCount: 1,
          title: (opts.title || 'Partitura') + ' (vacío)',
        }),
      )
      break
    }
    pages.push(
      wrapPageSvg(slice, {
        ...opts,
        drums,
        pageIndex: p,
        pageCount,
      }),
    )
  }

  return { pages, barCount, noteCount: notes.length }
}

/** Layout compartido con editor / vista previa (tarjeta blanca sobre beige). */
export const SHEET_BAR_SLOT_WIDTH = SCORE_BAR_WIDTH + 24
export const SHEET_BAR_SLOT_HEIGHT = SYSTEM_HEIGHT
const SHEET_GAP = 4
const SHEET_CARD_PAD = 16
const SHEET_OUTER_PAD = 16
const SHEET_META_H = 40
const SHEET_PAGE_W = 816
const SHEET_PAGE_H = 1056
const SHEET_MARGIN = 40

async function renderBarFragment(
  barIndex: number,
  notes: MidiNote[],
  drums: boolean,
): Promise<string> {
  const div = document.createElement('div')
  div.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden'
  document.body.appendChild(div)
  try {
    await renderScoreBarToContainer(div, barIndex, notes, drums, { showClef: barIndex === 0 })
    const svg = div.querySelector('svg')
    return svg?.innerHTML.trim() ?? ''
  } finally {
    document.body.removeChild(div)
  }
}

function cardHeightForRows(rows: number): number {
  if (rows <= 0) return SHEET_CARD_PAD * 2
  return SHEET_CARD_PAD * 2 + rows * SHEET_BAR_SLOT_HEIGHT + (rows - 1) * SHEET_GAP
}

/** PDF con el mismo diseño que el editor (compases en tarjeta blanca / fondo beige). */
export async function renderScoreSheetPages(
  notes: MidiNote[],
  opts: ScoreExportOpts,
): Promise<ScoreRenderResult> {
  if (typeof document === 'undefined') {
    return { pages: [], barCount: 0, noteCount: notes.length }
  }

  await ensureVexFlowFonts()

  const drums = opts.drums ?? isDrumishNotes(notes)
  const barCount = totalBars(notes)
  const title = escapeXml(opts.title || 'Partitura')
  const subtitle = escapeXml(
    opts.subtitle || `${opts.bpm} BPM · ${drums ? 'Percusión' : 'Melódico'} · ${barCount} compases`,
  )

  const fragments: string[] = []
  for (let i = 0; i < barCount; i++) {
    fragments.push(await renderBarFragment(i, notes, drums))
  }

  const contentW = SHEET_PAGE_W - SHEET_MARGIN * 2
  const barsPerRow = Math.max(
    1,
    Math.floor((contentW - SHEET_CARD_PAD * 2 + SHEET_GAP) / (SHEET_BAR_SLOT_WIDTH + SHEET_GAP)),
  )
  const rowStep = SHEET_BAR_SLOT_HEIGHT + SHEET_GAP
  const availCardH =
    SHEET_PAGE_H - SHEET_MARGIN * 2 - SHEET_OUTER_PAD * 2 - SHEET_META_H - 16 - SHEET_CARD_PAD * 2
  const rowsPerPage = Math.max(1, Math.floor((availCardH + SHEET_GAP) / rowStep))

  const cardInnerW = barsPerRow * SHEET_BAR_SLOT_WIDTH + (barsPerRow - 1) * SHEET_GAP
  const cardW = cardInnerW + SHEET_CARD_PAD * 2
  const cardX = SHEET_MARGIN + Math.max(0, (contentW - cardW) / 2)

  const pages: ScorePage[] = []
  let barIdx = 0
  let pageIndex = 0

  while (barIdx < barCount || (barCount === 0 && pageIndex === 0)) {
    const barsLeft = barCount - barIdx
    const rowsThisPage =
      barCount === 0 ? 1 : Math.min(rowsPerPage, Math.ceil(barsLeft / barsPerRow))
    const barsThisPage =
      barCount === 0 ? 0 : Math.min(barsLeft, rowsThisPage * barsPerRow)
    const cardH = cardHeightForRows(rowsThisPage)
    const pageH =
      SHEET_MARGIN * 2 + SHEET_OUTER_PAD * 2 + SHEET_META_H + cardH + 12
    const cardY = SHEET_MARGIN + SHEET_OUTER_PAD + SHEET_META_H
    const metaY = SHEET_MARGIN + SHEET_OUTER_PAD

    let barMarkup = ''
    for (let row = 0; row < rowsThisPage; row++) {
      for (let col = 0; col < barsPerRow; col++) {
        const bi = barIdx + row * barsPerRow + col
        if (bi >= barCount) break
        const x = cardX + SHEET_CARD_PAD + col * (SHEET_BAR_SLOT_WIDTH + SHEET_GAP)
        const y = cardY + SHEET_CARD_PAD + row * rowStep
        const inner = fragments[bi] ?? ''
        barMarkup += `<g transform="translate(${x}, ${y})"><svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_BAR_SLOT_WIDTH}" height="${SHEET_BAR_SLOT_HEIGHT}" viewBox="0 0 ${SHEET_BAR_SLOT_WIDTH} ${SHEET_BAR_SLOT_HEIGHT}">${inner}</svg></g>\n`
      }
    }

    const raw = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_PAGE_W}" height="${pageH}" viewBox="0 0 ${SHEET_PAGE_W} ${pageH}">
  <rect width="100%" height="100%" fill="#f4f2ee"/>
  <text x="${SHEET_MARGIN}" y="${metaY + 16}" font-family="system-ui,-apple-system,sans-serif" font-size="13" font-weight="600" fill="#1a1a1e">${title}</text>
  <text x="${SHEET_MARGIN}" y="${metaY + 32}" font-family="system-ui,-apple-system,sans-serif" font-size="10" fill="#6b6b70">${subtitle}</text>
  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="8" fill="#ffffff" stroke="rgba(0,0,0,0.06)" stroke-width="1"/>
  ${barMarkup}
  <text x="${SHEET_PAGE_W - SHEET_MARGIN}" y="${pageH - 14}" text-anchor="end" font-family="system-ui,sans-serif" font-size="9" fill="#9a9a9e">JasWave · ${pageIndex + 1}</text>
</svg>`

    pages.push({ svg: embedBravuraInSvg(raw), width: SHEET_PAGE_W, height: pageH })
    barIdx += barsThisPage
    pageIndex += 1
    if (barCount === 0) break
  }

  return { pages, barCount, noteCount: notes.length }
}
