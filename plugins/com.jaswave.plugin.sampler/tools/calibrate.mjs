#!/usr/bin/env node
// Calibra la ganancia (gain=) de cada instrumento .jwi para que una frase de prueba mida el LUFS objetivo.
//   node calibrate.mjs <sampler_render.exe> <index.txt> [carpeta temporal]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
const [exe, indexFile, tmpArg] = process.argv.slice(2)
const tmp = tmpArg ?? fs.mkdtempSync(path.join(os.tmpdir(), 'jwcal-'))
fs.mkdirSync(tmp, { recursive: true })
const TARGET = [[/piano de cola|piano ·/i, 'piano', -24], [/rhodes|eléctrico/i, 'keys', -26], [/pads?/i, 'chord', -27], [/batería|drum/i, 'drums', -22], [/bajo/i, 'bass', -24], [/guitarra/i, 'guitar', -25]]
function kw(x, sr) {
  const bq = (b0, b1, b2, a1, a2) => { let z1 = 0, z2 = 0; return (v) => { const y = b0 * v + z1; z1 = b1 * v - a1 * y + z2; z2 = b2 * v - a2 * y; return y } }
  let K = Math.tan(Math.PI * 1681.974450955533 / sr), Q = 0.7071752369554196, Vh = Math.pow(10, 3.999843853973347 / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K
  const s1 = bq((Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0)
  K = Math.tan(Math.PI * 38.13547087602444 / sr); Q = 0.5003270373238773; a0 = 1 + K / Q + K * K
  const s2 = bq(1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0)
  const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = s2(s1(x[i])); return y
}
function lufs(wav) {
  const b = fs.readFileSync(wav), sr = b.readUInt32LE(24), n = (b.length - 44) / 8
  const L = new Float32Array(n), R = new Float32Array(n)
  for (let i = 0; i < n; i++) { L[i] = b.readFloatLE(44 + i * 8); R[i] = b.readFloatLE(48 + i * 8) }
  const kl = kw(L, sr), kr = kw(R, sr), blk = Math.floor(sr * 0.4), hop = Math.floor(sr * 0.1), ms = []
  for (let i = 0; i + blk <= n; i += hop) { let a = 0, c = 0; for (let k = 0; k < blk; k++) { a += kl[i + k] ** 2; c += kr[i + k] ** 2 } ms.push((a + c) / blk) }
  const lu = (e) => -0.691 + 10 * Math.log10(Math.max(e, 1e-12))
  const abs = ms.filter((e) => lu(e) > -70); if (!abs.length) return -120
  const rel = lu(abs.reduce((a, b) => a + b, 0) / abs.length) - 10
  const g = abs.filter((e) => lu(e) > rel); return g.length ? lu(g.reduce((a, b) => a + b, 0) / g.length) : -120
}
const base = path.dirname(indexFile)
for (const ln of fs.readFileSync(indexFile, 'utf8').split(/\r?\n/)) {
  const [name, rel] = ln.split('|'); if (!rel || ln.startsWith('#')) continue
  const target = TARGET.find((t) => t[0].test(name)); if (!target) continue
  const jwi = path.join(base, rel.trim())
  let txt = fs.readFileSync(jwi, 'utf8')
  const wav = path.join(tmp, path.basename(jwi) + '.wav')
  const run = () => { const r = spawnSync(exe, [jwi, wav, target[1]], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${name}: render falló ${r.stdout}${r.stderr}`); return lufs(wav) }
  let cur = Number((/^gain=(.*)$/m.exec(txt) ?? [0, 0])[1])
  let l = run()
  for (let it = 0; it < 2 && Math.abs(l - target[2]) > 0.4; it++) {
    cur += target[2] - l
    txt = /^gain=/m.test(txt) ? txt.replace(/^gain=.*$/m, `gain=${cur.toFixed(1)}`) : txt.replace(/^name=.*$/m, (m) => `${m}\ngain=${cur.toFixed(1)}`)
    fs.writeFileSync(jwi, txt)
    l = run()
  }
  console.log(`${name.padEnd(36)} objetivo ${target[2]} LUFS  ->  ${l.toFixed(1)} LUFS  (gain ${cur.toFixed(1)} dB)`)
}
