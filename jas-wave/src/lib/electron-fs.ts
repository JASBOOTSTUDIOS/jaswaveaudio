/**
 * Escritura a disco vía Electron que falla de forma visible: main puede rechazar rutas
 * no concedidas (path-grants) y antes esos fallos se ignoraban como éxito.
 */

type SaveResult = { success: boolean; error?: string } | undefined

function assertSaved(result: SaveResult, path: string): void {
  if (!result || result.success === false) {
    throw new Error(result?.error || `No se pudo escribir ${path}`)
  }
}

export async function saveTextOrThrow(path: string, contenido: string): Promise<void> {
  const api = window.electron
  if (!api?.fileSave) throw new Error('Guardado en disco no disponible')
  assertSaved(await api.fileSave(path, contenido), path)
}

export async function saveBinaryOrThrow(path: string, data: Uint8Array): Promise<void> {
  const api = window.electron
  if (!api?.fileSaveBinary) throw new Error('Guardado en disco no disponible')
  assertSaved(await api.fileSaveBinary(path, data), path)
}
