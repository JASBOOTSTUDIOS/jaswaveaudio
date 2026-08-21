import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

delete process.env.ELECTRON_RUN_AS_NODE

const projectRoot = path.join(__dirname, '..')
const electronPath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

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
