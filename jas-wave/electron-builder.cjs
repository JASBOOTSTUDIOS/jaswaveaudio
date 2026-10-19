/**
 * Configuración de electron-builder (antes "build" en package.json).
 * Se usa JS para leer variables de entorno en tiempo de empaquetado:
 *
 *   JASWAVE_RELEASES_OWNER / JASWAVE_RELEASES_REPO
 *       Repositorio de GitHub Releases para publicar y para el feed de auto-update
 *       (por defecto JASBOOTSTUDIOS/jaswaveaudio). Si el repo de código es privado,
 *       apuntar a un repo público solo de releases: electron-updater descarga sin token.
 *
 *   Firma de código — PREPARADA PERO DESACTIVADA hasta tener certificado.
 *   Solo se firma si hay credenciales en el entorno:
 *     - WIN_CSC_LINK (o CSC_LINK) + WIN_CSC_KEY_PASSWORD (o CSC_KEY_PASSWORD): .pfx
 *     - Azure Trusted Signing: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET,
 *       AZURE_TRUSTED_SIGNING_ENDPOINT, AZURE_TRUSTED_SIGNING_ACCOUNT,
 *       AZURE_TRUSTED_SIGNING_PROFILE, AZURE_TRUSTED_SIGNING_PUBLISHER
 *   Sin ellas electron-builder registra "no signing info identified" y no firma.
 */

const env = process.env
const has = (name) => typeof env[name] === 'string' && env[name].trim() !== ''

const releasesOwner = (env.JASWAVE_RELEASES_OWNER || 'JASBOOTSTUDIOS').trim()
const releasesRepo = (env.JASWAVE_RELEASES_REPO || 'jaswaveaudio').trim()

const AZURE_SIGN_VARS = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_TRUSTED_SIGNING_ENDPOINT',
  'AZURE_TRUSTED_SIGNING_ACCOUNT',
  'AZURE_TRUSTED_SIGNING_PROFILE',
  'AZURE_TRUSTED_SIGNING_PUBLISHER',
]
const azureSigning = AZURE_SIGN_VARS.every(has)
const certSigning = !azureSigning && (has('WIN_CSC_LINK') || has('CSC_LINK'))
const signing = azureSigning || certSigning

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.jaswave.app',
  productName: 'JasWave',
  directories: {
    output: 'release',
    buildResources: 'build-resources',
  },
  icon: 'build-resources/icon.png',
  files: [
    'dist/**/*',
    'build/electron/**/*',
    'public/jaswave-icono-con-frecuencia.png',
    'public/jaswavelogo.png',
  ],
  extraResources: [
    { from: 'resources/plugin-host', to: 'plugin-host' },
    // Plugins propios (los copia scripts/stage-plugin-host.mjs); la app los usa si no hay instalación de usuario.
    { from: 'resources/vst3/JasWave', to: 'vst3/JasWave' },
    { from: 'public/jaswave-icono-con-frecuencia.png', to: 'jaswave-icono-con-frecuencia.png' },
    { from: '../THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' },
  ],
  publish: [
    {
      provider: 'github',
      owner: releasesOwner,
      repo: releasesRepo,
      // Se crea como borrador: se revisa y se publica a mano (solo las publicadas llegan a los clientes).
      releaseType: 'draft',
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build-resources/icon.png',
    artifactName: 'JasWave-Setup-${version}.${ext}',
    signAndEditExecutable: true,
    ...(signing
      ? {
          // Firmar también los binarios nativos de resources/ (plugin host y plugins VST3).
          signExts: ['.exe', '.dll', '.vst3'],
        }
      : {}),
    ...(azureSigning
      ? {
          azureSignOptions: {
            endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
            codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT,
            certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE,
            publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER,
          },
        }
      : {}),
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'JasWave',
    perMachine: false,
    license: 'build-resources/eula.txt',
  },
  electronFuses: {
    runAsNode: true,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
}

if (!signing) {
  // GitHub Actions pasa los secretos no definidos como cadena vacía: que no activen la firma.
  delete env.CSC_LINK
  delete env.WIN_CSC_LINK
}

module.exports = config
