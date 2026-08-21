import type { FileService } from '../../../shared/src/project/persistencia'

export class FileServiceElectron implements FileService {
  async guardar(ruta: string, contenido: string): Promise<void> {
    const result = await window.electron.fileSave(ruta, contenido)
    if (!result?.success) {
      throw new Error(result?.error || `No se pudo guardar: ${ruta}`)
    }
  }

  async leer(ruta: string): Promise<string> {
    return window.electron.fileRead(ruta)
  }

  async existe(ruta: string): Promise<boolean> {
    return window.electron.fileExists(ruta)
  }

  async eliminar(ruta: string): Promise<void> {
    await window.electron.fileSave(ruta, '')
  }

  async obtenerTamano(ruta: string): Promise<number> {
    return window.electron.fileSize(ruta)
  }

  limpiar(): void {
    // noop: FileServiceElectron no mantiene estado en memoria
  }
}
