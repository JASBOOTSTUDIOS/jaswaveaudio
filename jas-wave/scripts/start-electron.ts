import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

delete process.env.ELECTRON_RUN_AS_NODE

const projectRoot = path.join(__dirname, '..')
const electronPath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

/** Evita dos jaswave-plugin-host (ASIO doble = eco / silencio / host «no disponible»). */
function killOrphanHosts() {
  if (process.platform !== 'win32') return
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    execFileSync(
      'taskkill',
      ['/F', '/IM', 'jaswave-plugin-host.exe', '/T'],
      { stdio: 'ignore', windowsHide: true },
    )
  } catch {
    /* ninguno */
  }
}

killOrphanHosts()

let scriptPath = process.argv[2]

if (scriptPath === '.' || !scriptPath) {
  const packageJsonPath = path.join(projectRoot, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  scriptPath = path.join(projectRoot, packageJson.main)
}

const child = spawn(electronPath, [scriptPath], {
  stdio: 'inherit',
  env: { ...process.env },
})

child.on('error', (err) => {
  console.error('Failed to start Electron:', err)
  process.exit(1)
})

child.on('exit', (code) => {
  killOrphanHosts()
  process.exit(code ?? 0)
})