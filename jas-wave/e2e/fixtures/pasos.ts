/**
 * Pasos visibles de una prueba: cada paso se anuncia en la salida y deja una captura numerada en
 * JASWAVE_E2E_CAPTURAS (si está definida), para que una persona pueda seguir lo que hizo la prueba.
 */
import type { Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

export function crearPasos(page: () => Page, prueba: string) {
  let n = 0
  const dir = process.env.JASWAVE_E2E_CAPTURAS ? path.join(process.env.JASWAVE_E2E_CAPTURAS, prueba) : null
  if (dir) fs.mkdirSync(dir, { recursive: true })
  return async (texto: string) => {
    n++
    const etiqueta = `${String(n).padStart(2, '0')} ${texto}`
    console.log(`[paso] ${prueba} · ${etiqueta}`)
    if (!dir) return
    const archivo = `${String(n).padStart(2, '0')}-${texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60)}.png`
    await page()
      .screenshot({ path: path.join(dir, archivo), timeout: 10_000 })
      .catch(() => undefined)
  }
}

/** WAV mono de 16 bits con un tono (para soltar un audio en el chat sin depender de archivos del usuario). */
export function escribirWavTono(ruta: string, segundos = 1.5, hz = 440, sr = 44100): void {
  const n = Math.round(segundos * sr)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / sr) * 0.4 * 32767), 44 + i * 2)
  fs.mkdirSync(path.dirname(ruta), { recursive: true })
  fs.writeFileSync(ruta, buf)
}

/** Archivos que cumplen `filtro` bajo `raiz` (recursivo). */
export function buscarArchivos(raiz: string, filtro: (nombre: string) => boolean): string[] {
  if (!fs.existsSync(raiz)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(raiz, { withFileTypes: true })) {
    const p = path.join(raiz, e.name)
    if (e.isDirectory()) out.push(...buscarArchivos(p, filtro))
    else if (filtro(e.name)) out.push(p)
  }
  return out
}
