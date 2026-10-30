/**
 * Escritura atómica: tmp → fsync → (backup .bak) → rename.
 * Un corte de luz o crash a mitad de escritura deja intacto el archivo anterior.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  opts: { backup?: boolean } = {},
): Promise<{ size: number }> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    if (opts.backup) {
      try {
        await fs.copyFile(target, `${target}.bak`)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
    }
    await renameWithRetry(tmp, target)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw e
  }
  const stat = await fs.stat(target)
  return { size: stat.size }
}

/** Windows: rename puede fallar con EPERM/EBUSY si un antivirus o indexador tiene el archivo abierto. */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= attempts - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e
      await new Promise((r) => setTimeout(r, 50 * (i + 1)))
    }
  }
}
