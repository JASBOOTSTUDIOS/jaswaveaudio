import * as esbuild from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function buildElectron() {
  try {
    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../electron/main.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: path.resolve(__dirname, '../build/electron/electron/main.mjs'),
      external: ['electron'],
      sourcemap: true,
    })

    await esbuild.build({
      entryPoints: [path.resolve(__dirname, '../electron/preload.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: path.resolve(__dirname, '../build/electron/electron/preload.mjs'),
      external: ['electron'],
      sourcemap: true,
    })

    console.log('Electron files built successfully')
    process.exit(0)
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

buildElectron()
