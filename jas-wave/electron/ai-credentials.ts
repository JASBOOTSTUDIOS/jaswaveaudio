/**
 * API keys de proveedores de IA, cifradas con safeStorage (DPAPI en Windows)
 * en userData/ai-credentials.json. El renderer puede guardarlas o borrarlas,
 * pero nunca leerlas: main las inyecta al llamar al proveedor.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export type Cipher = {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

const MAX_KEY_LENGTH = 4096
const PROVIDER_ID = /^[\w.-]{1,128}$/

export class AiCredentialStore {
  private cache: Map<string, string> | null = null

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  private load(): Map<string, string> {
    if (this.cache) return this.cache
    const map = new Map<string, string>()
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>
      for (const [id, b64] of Object.entries(raw)) {
        try {
          map.set(id, this.cipher.decryptString(Buffer.from(b64, 'base64')))
        } catch {
          /* clave de otra máquina/usuario: se ignora */
        }
      }
    } catch {
      /* sin archivo todavía */
    }
    this.cache = map
    return map
  }

  private persist(map: Map<string, string>): void {
    const out: Record<string, string> = {}
    for (const [id, key] of map) out[id] = this.cipher.encryptString(key).toString('base64')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 })
    fs.renameSync(tmp, this.file)
  }

  /** Guarda (o borra si `key` está vacía). */
  set(providerId: unknown, key: unknown): { ok: true } | { ok: false; error: string } {
    if (typeof providerId !== 'string' || !PROVIDER_ID.test(providerId)) {
      return { ok: false, error: 'providerId inválido' }
    }
    const value = typeof key === 'string' ? key.trim() : ''
    if (value.length > MAX_KEY_LENGTH) return { ok: false, error: 'API key demasiado larga' }
    const map = this.load()
    if (!value) {
      if (!map.delete(providerId)) return { ok: true }
    } else {
      if (!this.cipher.isEncryptionAvailable()) {
        return { ok: false, error: 'El cifrado del sistema no está disponible; no se guardó la API key.' }
      }
      map.set(providerId, value)
    }
    this.persist(map)
    return { ok: true }
  }

  get(providerId: unknown): string | undefined {
    if (typeof providerId !== 'string') return undefined
    return this.load().get(providerId)
  }

  has(providerId: unknown): boolean {
    return this.get(providerId) !== undefined
  }
}
