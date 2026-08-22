#!/usr/bin/env node
/** Smoke test: ping al node-host (cierra stdin). */
const { spawn } = require('child_process')
const path = require('path')

const host = path.join(__dirname, '..', 'node-host.cjs')
const child = spawn(process.execPath, [host], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

let out = ''
child.stdout.on('data', (d) => {
  out += d.toString('utf8')
  if (out.includes('\n')) {
    const line = out.split('\n').find((l) => l.trim().startsWith('{'))
    console.log(line || out.trim())
    child.stdin.end()
    child.kill()
    try {
      const j = JSON.parse(line)
      process.exit(j.ok ? 0 : 1)
    } catch {
      process.exit(1)
    }
  }
})
child.stderr.on('data', () => {})
child.on('error', (e) => {
  console.error(e)
  process.exit(1)
})
setTimeout(() => {
  console.error('timeout')
  child.kill()
  process.exit(1)
}, 4000)

child.stdin.write(JSON.stringify({ type: 'ping' }) + '\n')
