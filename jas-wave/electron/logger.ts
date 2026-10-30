/**
 * Log persistente del proceso main: userData/logs/jaswave.log con rotación simple.
 * Recoge errores de main, del renderer (IPC 'log-error') y caídas de procesos hijos.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024
const KEEP_FILES = 3

let logFile: string | null = null

export function initLogger(logsDir: string): string {
  fs.mkdirSync(logsDir, { recursive: true })
  logFile = path.join(logsDir, 'jaswave.log')
  return logsDir
}

function rotateIfNeeded(file: string): void {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return
  } catch {
    return
  }
  for (let i = KEEP_FILES - 1; i >= 1; i--) {
    const from = i === 1 ? file : `${file}.${i - 1}`
    try {
      fs.renameSync(from, `${file}.${i}`)
    } catch {
      /* no existe */
    }
  }
}

function stringify(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function logLine(level: 'info' | 'warn' | 'error', scope: string, ...parts: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${parts.map(stringify).join(' ')}`.slice(0, 16_000)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  if (!logFile) return
  try {
    rotateIfNeeded(logFile)
    fs.appendFileSync(logFile, `${line}\n`)
  } catch {
    /* disco lleno / sin permisos: no romper la app por el log */
  }
}
