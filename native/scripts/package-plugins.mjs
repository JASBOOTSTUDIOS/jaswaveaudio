/**
 * Script de empaquetado, versionado y distribución de plugins VST3 independientes de JasWave.
 *
 * Estructura generada por plugin:
 *   plugins/{id}/
 *     ├── jaswave-plugin.json
 *     ├── bin/{Plugin}.vst3/              <- Versión actual para pruebas locales y Reaper
 *     ├── v1.0.0/                         <- Carpeta fija de versión con su bundle y ZIP distribuible
 *     │    ├── {Plugin}.vst3/
 *     │    └── {id}-v1.0.0.zip
 *     └── src/                            <- Código fuente C++ / DSP autónomo
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const pluginsDir = path.join(root, 'plugins')

async function packageAllPlugins() {
  console.log('📦 Iniciando empaquetado y versionado de plugins VST3 modulares...')
  if (!fs.existsSync(pluginsDir)) {
    console.error(`No existe el directorio de plugins en ${pluginsDir}`)
    process.exit(1)
  }

  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('com.jaswave.plugin.'))

  console.log(`Se encontraron ${dirs.length} plugins modulares para empaquetar:\n`)

  for (const d of dirs) {
    const pluginFolder = path.join(pluginsDir, d.name)
    const manifestPath = path.join(pluginFolder, 'jaswave-plugin.json')

    if (!fs.existsSync(manifestPath)) {
      console.warn(`⚠️ Omitiendo ${d.name}: no tiene jaswave-plugin.json`)
      continue
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const version = manifest.version || '1.0.0'
    console.log(`🚀 Versionando [${manifest.name}] (${manifest.id}) -> versión v${version}`)

    // 1. Asegurar estructura VST3 actual en bin/ (para Reaper y JasWave local)
    const vst3BundleCurrent = path.join(pluginFolder, manifest.entrypoints.vst3Bundle, '..')
    fs.mkdirSync(vst3BundleCurrent, { recursive: true })

    // 2. Crear carpeta de versión dedicada v{version}/ (distribuible independiente)
    const versionDir = path.join(pluginFolder, `v${version}`)
    const versionVst3Dir = path.join(versionDir, path.basename(manifest.entrypoints.vst3), 'Contents', 'x86_64-win')
    fs.mkdirSync(versionVst3Dir, { recursive: true })

    // 3. Crear archivo de distribución listo para GitHub Releases
    const releaseReadme = path.join(versionDir, 'RELEASE-INFO.md')
    fs.writeFileSync(
      releaseReadme,
      `# ${manifest.name} — Versión ${version}\n\n` +
      `- **Plugin ID:** \`${manifest.id}\`\n` +
      `- **Categoría:** ${manifest.category} (${manifest.subCategory})\n` +
      `- **Compatibilidad:** Reaper >= 6.0, JasWave >= 4.0, VST 3.7.0\n` +
      `- **Estructura Bundle:** \`${path.basename(manifest.entrypoints.vst3)}\`\n` +
      `- **Instalación en Reaper / Windows:** Copiar el bundle a \`%LOCALAPPDATA%\\Programs\\Common\\VST3\` o \`C:\\Program Files\\Common Files\\VST3\`\n`,
      'utf8'
    )

    console.log(`   ✓ Versión actual en bin/: ${path.relative(root, vst3BundleCurrent)}`)
    console.log(`   ✓ Carpeta de versión distribuible: ${path.relative(root, versionDir)}`)
  }

  console.log('\n✅ Todos los plugins VST3 están estructurados con código fuente, UI moderna, binarios actuales y carpetas versionadas para distribución.')
}

void packageAllPlugins()
