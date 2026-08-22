#!/usr/bin/env node
/**
 * Fallback Plugin Host Process (Node) — mismo protocolo JSON-line que el binario C++.
 * Usado cuando jaswave-plugin-host.exe no está compilado.
 * Discovery FS de .vst3; load → HostNotReady (sin fingir VST3).
 */

const fs = require('fs')
const path = require('path')
const readline = require('readline')

const PROCESS_ID = 'jaswave-plugin-host-node'

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function expandEnv(p) {
  if (process.platform === 'win32') {
    return p.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`)
  }
  return p.replace(/^~(?=$|\/|\\)/, process.env.HOME || process.env.USERPROFILE || '')
}

function walkVst3(dir, out, depth = 0) {
  if (depth > 6 || out.length > 800) return
  let root
  try {
    root = path.resolve(dir)
  } catch {
    return
  }

  // Si la ruta es el propio bundle .vst3, registrarlo
  try {
    if (root.toLowerCase().endsWith('.vst3')) {
      const st = fs.statSync(root)
      if (st.isDirectory() || st.isFile()) {
        out.push(root)
        return
      }
    }
  } catch {
    return
  }

  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name)
    const lower = ent.name.toLowerCase()
    if (lower.endsWith('.vst3')) {
      out.push(full)
      continue
    }
    if (ent.isDirectory()) {
      walkVst3(full, out, depth + 1)
    }
  }
}

function handle(msg) {
  const type = msg && msg.type
  if (type === 'ping') {
    reply({ ok: true, processId: PROCESS_ID, latencySamples: 0 })
    return
  }
  if (type === 'discover') {
    const root = expandEnv(String(msg.path || ''))
    if (!root) {
      reply({ ok: false, code: 'PluginScanFailed', message: 'discover requiere path' })
      return
    }
    const found = []
    walkVst3(root, found)
    const plugins = found.map((p) => ({
      path: p,
      name: path.basename(p, '.vst3'),
      format: 'vst3',
      hostReady: false,
    }))
    reply({ ok: true, processId: PROCESS_ID, plugins, count: plugins.length })
    return
  }
  if (
    type === 'load' ||
    type === 'prepare' ||
    type === 'unload' ||
    type === 'setBypass' ||
    type === 'getLatency' ||
    type === 'crashReport'
  ) {
    reply({
      ok: false,
      code: 'HostNotReady',
      message:
        'Plugin Host Process activo (Node fallback). Load VST3 requiere binario nativo + Steinberg SDK.',
    })
    return
  }
  reply({ ok: false, code: 'PluginLoadFailed', message: `Comando desconocido: ${type}` })
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
process.stderr.write('[jaswave-plugin-host-node] ready\n')
rl.on('line', (line) => {
  try {
    handle(JSON.parse(line))
  } catch (e) {
    reply({
      ok: false,
      code: 'PluginLoadFailed',
      message: e instanceof Error ? e.message : 'JSON inválido',
    })
  }
})
