import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import { writeFileAtomic } from './atomic-write'

describe('writeFileAtomic', () => {
  it('escribe, crea .bak del anterior y no deja temporales', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jaswave-atomic-'))
    const target = path.join(dir, 'sub', 'p.jaswave')
    await writeFileAtomic(target, '{"v":1}', { backup: true })
    const r = await writeFileAtomic(target, '{"v":2}', { backup: true })
    assert.equal(await fs.readFile(target, 'utf8'), '{"v":2}')
    assert.equal(await fs.readFile(`${target}.bak`, 'utf8'), '{"v":1}')
    assert.equal(r.size, 7)
    const leftovers = (await fs.readdir(path.dirname(target))).filter((f) => f.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('acepta binario', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jaswave-atomic-'))
    const target = path.join(dir, 'a.bin')
    await writeFileAtomic(target, new Uint8Array([1, 2, 3]))
    assert.deepEqual([...(await fs.readFile(target))], [1, 2, 3])
    await fs.rm(dir, { recursive: true, force: true })
  })
})
