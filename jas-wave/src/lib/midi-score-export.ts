/**
 * Export MIDI clip → partitura PDF con VexFlow + vista previa.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { MidiClip, MidiNote } from '@jaswave/shared'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { renderScoreSheetPages, type ScorePage, type ScoreExportOpts, isDrumishNotes } from './midi-score-render'
import { ensureVexFlowFonts, embedBravuraInSvg } from './vexflow-ready'
import { openScorePreview } from './score-preview-store'

export type { ScoreExportOpts } from './midi-score-render'
export { isDrumishNotes } from './midi-score-render'

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]+/gi, '-').replace(/\s+/g, '-').slice(0, 80) || 'score'
}

async function svgPageToPng(svg: string, width: number, height: number): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null
  await ensureVexFlowFonts()
  const svgWithFont = embedBravuraInSvg(svg)
  const blob = new Blob([svgWithFont], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.width = width
    img.height = height
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg load'))
      img.src = url
    })
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#faf9f7'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    const b64 = dataUrl.split(',')[1]
    if (!b64) return null
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function buildScorePdfFromPages(pages: ScorePage[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const page of pages) {
    const png = await svgPageToPng(page.svg, page.width, page.height)
    const pdfPage = pdf.addPage([page.width, page.height])
    if (png) {
      const img = await pdf.embedPng(png)
      pdfPage.drawImage(img, { x: 0, y: 0, width: page.width, height: page.height })
    }
  }
  if (pdf.getPageCount() === 0) {
    return buildScorePdfBytesFallback([], { bpm: 120, title: 'Partitura' })
  }
  return pdf.save()
}

/** Fallback pdf-lib (tests / sin DOM). */
export async function buildScorePdfBytes(
  notes: MidiNote[],
  opts: ScoreExportOpts,
): Promise<Uint8Array> {
  if (typeof document !== 'undefined') {
    try {
      const rendered = await renderScoreSheetPages(notes, opts)
      if (rendered.pages.length) return buildScorePdfFromPages(rendered.pages)
    } catch {
      /* fallback */
    }
  }
  return buildScorePdfBytesFallback(notes, opts)
}

export async function buildScorePdfBytesPreferVexFlow(
  notes: MidiNote[],
  opts: ScoreExportOpts,
): Promise<Uint8Array> {
  return buildScorePdfBytes(notes, opts)
}

type ScoreEvent = { bar: number; beat: number; pitch: number; dur: number; vel: number }

function notesToEvents(notes: MidiNote[]): ScoreEvent[] {
  return notes
    .map((n) => {
      const inicio = Math.max(0, Number(n.inicio) || 0)
      return {
        bar: Math.floor(inicio / 4),
        beat: inicio % 4,
        pitch: Math.round(n.pitch),
        dur: Math.max(0.125, Number(n.duracion) || 0.25),
        vel: n.velocidad ?? 80,
      }
    })
    .sort((a, b) => a.bar - b.bar || a.beat - b.beat || a.pitch - b.pitch)
}

function pitchToStaffY(pitch: number, drums: boolean, staffTop: number, spacing: number): number {
  if (drums) {
    const map: Record<number, number> = {
      36: 4, 35: 4, 38: 2, 40: 2, 37: 2.5, 42: 0, 44: 0, 46: -0.5, 49: -1, 57: -1, 51: -0.5,
      50: 1, 47: 1.5, 45: 3, 43: 3.5, 41: 3.5,
    }
    return staffTop + (map[pitch] ?? 2) * spacing
  }
  const steps = (pitch - 64) / 2
  return staffTop + 4 * spacing - steps * (spacing / 2)
}

async function buildScorePdfBytesFallback(
  notes: MidiNote[],
  opts: ScoreExportOpts,
): Promise<Uint8Array> {
  const drums = opts.drums ?? isDrumishNotes(notes)
  const events = notesToEvents(notes)
  const maxBar = events.length ? Math.max(...events.map((e) => e.bar)) : 0
  const barsPerSystem = opts.barsPerSystem ?? 4
  const systems = Math.max(1, Math.ceil((maxBar + 1) / barsPerSystem))

  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.TimesRoman)
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const pageW = 612
  const pageH = 792
  const margin = 48
  let page = pdf.addPage([pageW, pageH])
  let y = pageH - margin

  const drawHeader = () => {
    page.drawRectangle({
      x: margin - 8,
      y: y - 52,
      width: pageW - (margin - 8) * 2,
      height: 56,
      color: rgb(0.98, 0.98, 0.97),
      borderColor: rgb(0.9, 0.88, 0.85),
      borderWidth: 0.5,
    })
    page.drawText(opts.title || 'Partitura', {
      x: margin,
      y: y - 18,
      size: 18,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.12),
    })
    const sub = opts.subtitle || `${opts.bpm} BPM · ${drums ? 'Percusión' : 'Melódico'}`
    page.drawText(sub, { x: margin, y: y - 36, size: 10, font, color: rgb(0.4, 0.4, 0.45) })
    y -= 64
  }
  drawHeader()

  const systemH = 80
  const spacing = 7
  for (let sys = 0; sys < systems; sys++) {
    if (y - systemH < margin + 40) {
      page = pdf.addPage([pageW, pageH])
      y = pageH - margin
      drawHeader()
    }
    const staffTop = y
    const staffW = pageW - margin * 2
    for (let i = 0; i < 5; i++) {
      const ly = staffTop - i * spacing
      page.drawLine({
        start: { x: margin, y: ly },
        end: { x: margin + staffW, y: ly },
        thickness: 0.5,
        color: rgb(0.2, 0.2, 0.22),
      })
    }
    for (let b = 0; b <= barsPerSystem; b++) {
      const x = margin + (staffW * b) / barsPerSystem
      page.drawLine({
        start: { x, y: staffTop },
        end: { x, y: staffTop - 4 * spacing },
        thickness: b === 0 || b === barsPerSystem ? 1.5 : 0.6,
        color: rgb(0.15, 0.15, 0.18),
      })
    }
    const barStart = sys * barsPerSystem
    page.drawText(String(barStart + 1), { x: margin - 16, y: staffTop - 2 * spacing, size: 8, font })

    const barEnd = barStart + barsPerSystem - 1
    const inSys = events.filter((e) => e.bar >= barStart && e.bar <= barEnd)
    for (const ev of inSys) {
      const localBar = ev.bar - barStart
      const x =
        margin + (staffW * localBar) / barsPerSystem + (staffW / barsPerSystem) * (ev.beat / 4) + 8
      const ny = pitchToStaffY(ev.pitch, drums, staffTop, spacing)
      page.drawEllipse({
        x,
        y: ny,
        xScale: 2.8,
        yScale: 2.2,
        color: rgb(0.05, 0.05, 0.08),
      })
    }
    y -= systemH + 12
  }

  if (!events.length) {
    page.drawText('(sin notas)', { x: margin, y: y, size: 11, font, color: rgb(0.55, 0.55, 0.55) })
  }

  return pdf.save()
}

export function scoreFileName(trackName: string, clipName: string): string {
  return `${sanitizeFileName(trackName)}-${sanitizeFileName(clipName)}.pdf`
}

export async function saveScorePdfBytes(
  bytes: Uint8Array,
  fileName: string,
): Promise<{ ok: boolean; message: string }> {
  if (typeof window !== 'undefined' && window.electron?.dialogSave) {
    const dialog = await window.electron.dialogSave(fileName)
    const path = typeof dialog === 'string' ? dialog : dialog && !dialog.canceled ? dialog.filePath : undefined
    if (!path) return { ok: false, message: 'Cancelado' }
    if (window.electron.fileSaveBinary) {
      const result = await window.electron.fileSaveBinary(path, bytes)
      if (result && result.success === false) {
        downloadBlob(bytes, fileName)
        return { ok: false, message: result.error || 'Error al guardar PDF' }
      }
    } else {
      downloadBlob(bytes, fileName)
    }
    return { ok: true, message: `Partitura guardada: ${path}` }
  }
  downloadBlob(bytes, fileName)
  return { ok: true, message: `Descarga iniciada: ${fileName}` }
}

export async function exportClipScorePdfDialog(
  tienda: TiendaDAW,
  pistaId: string,
  clipId: string,
): Promise<{ ok: boolean; message: string }> {
  const st = tienda.obtenerEstado()
  const track = st.project?.tracks?.find((t: { id: string }) => t.id === pistaId)
  const clip = (track?.clips ?? []).find((c: { id: string }) => c.id === clipId) as MidiClip | undefined
  if (!track || !clip || clip.tipo !== 'midi') {
    return { ok: false, message: 'Clip MIDI no encontrado' }
  }
  const bpm = st.project?.bpm?.valor ?? 120
  const drums = /bater|drum/i.test(track.nombre) || isDrumishNotes(clip.notas ?? [])
  openScorePreview({
    title: `${track.nombre} · ${clip.nombre}`,
    subtitle: `${bpm} BPM · ${drums ? 'Percusión' : 'Melódico'} · ${(clip.notas ?? []).length} notas`,
    fileName: scoreFileName(track.nombre, clip.nombre),
    notes: clip.notas ?? [],
    bpm,
    drums,
  })
  return { ok: true, message: 'Vista previa de partitura' }
}

export async function exportProjectScoresToFolder(
  tienda: TiendaDAW,
  folderPath: string,
  includeProjectCopy?: boolean,
): Promise<{ ok: boolean; message: string; count: number }> {
  const st = tienda.obtenerEstado()
  const bpm = st.project?.bpm?.valor ?? 120
  let count = 0
  const scoresDir = `${folderPath.replace(/[/\\]+$/, '')}/scores`
  for (const track of st.project?.tracks ?? []) {
    for (const c of track.clips ?? []) {
      if ((c as MidiClip).tipo !== 'midi') continue
      const clip = c as MidiClip
      const drums = /bater|drum/i.test(track.nombre) || isDrumishNotes(clip.notas ?? [])
      const bytes = await buildScorePdfBytes(clip.notas ?? [], {
        title: `${track.nombre} · ${clip.nombre}`,
        bpm,
        drums,
      })
      const fname = scoreFileName(track.nombre, clip.nombre || clip.id)
      const path = `${scoresDir}/${fname}`
      await saveBytes(path, bytes)
      count += 1
    }
  }
  if (includeProjectCopy && st.project?.ruta && window.electron?.fileRead && window.electron?.fileSave) {
    try {
      const raw = await window.electron.fileRead(st.project.ruta)
      if (raw) {
        const dest = `${folderPath.replace(/[/\\]+$/, '')}/${sanitizeFileName(st.project.nombre || 'proyecto')}.jaswave`
        await window.electron.fileSave(dest, raw)
      }
    } catch {
      /* optional */
    }
  }
  return {
    ok: count > 0,
    message: count ? `${count} partituras en ${scoresDir}` : 'No hay clips MIDI',
    count,
  }
}

async function saveBytes(path: string, bytes: Uint8Array): Promise<void> {
  if (typeof window !== 'undefined' && window.electron?.fileSaveBinary) {
    await window.electron.fileSaveBinary(path, bytes)
    return
  }
  downloadBlob(bytes, path.split(/[/\\]/).pop() || 'score.pdf')
}

function downloadBlob(bytes: Uint8Array, name: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
