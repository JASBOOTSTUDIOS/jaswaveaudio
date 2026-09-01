/**
 * Persistencia de tomas de audio: WAV en media/grabaciones/.
 */

export const RECORDINGS_REL_DIR = 'media/grabaciones'

export function makeRecordingFileName(trackId: string, at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  const safe = trackId.replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 24) || 'pista'
  return `grabacion-${stamp}-${safe}.wav`
}

export function recordingRelativePath(fileName: string): string {
  return `${RECORDINGS_REL_DIR}/${fileName}`
}

function joinPath(dir: string, fileName: string): string {
  const trimmed = dir.replace(/[/\\]+$/, '')
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${trimmed}${sep}${fileName}`
}

export async function resolveRecordingsDir(projectRuta?: string | null): Promise<string | null> {
  const api = window.electron
  if (!api?.recordingsDir) return null
  try {
    return await api.recordingsDir(projectRuta ?? undefined)
  } catch {
    return null
  }
}

export async function saveRecordingWav(
  bytes: Uint8Array,
  fileName: string,
  projectRuta?: string | null,
): Promise<{ absPath: string; sourceId: string } | null> {
  const dir = await resolveRecordingsDir(projectRuta)
  if (!dir || !window.electron?.fileSaveBinary) return null
  const absPath = joinPath(dir, fileName)
  const result = await window.electron.fileSaveBinary(absPath, bytes)
  if (!result?.success) return null
  return { absPath, sourceId: recordingRelativePath(fileName) }
}

export function recordingBasename(sourceId: string): string | null {
  const norm = sourceId.replace(/\\/g, '/')
  const base = norm.split('/').pop()
  if (!base || !/\.wav$/i.test(base)) return null
  return base
}

export async function loadRecordingBytes(
  sourceId: string,
  projectRuta?: string | null,
): Promise<ArrayBuffer | null> {
  const api = window.electron
  if (!api?.fileReadBinary) return null
  const norm = sourceId.replace(/\\/g, '/')
  const looksAbsolute = /^[a-zA-Z]:[\\/]/.test(sourceId) || norm.startsWith('/')
  const tryRead = async (ruta: string): Promise<ArrayBuffer | null> => {
    try {
      const data = await api.fileReadBinary!(ruta)
      if (!data) return null
      const out = new ArrayBuffer(data.byteLength)
      new Uint8Array(out).set(data)
      return out
    } catch {
      return null
    }
  }
  if (looksAbsolute) return tryRead(sourceId)
  const base = recordingBasename(sourceId)
  if (!base) return null
  const dir = await resolveRecordingsDir(projectRuta)
  if (!dir) return null
  return tryRead(joinPath(dir, base))
}
