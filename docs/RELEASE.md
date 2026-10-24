# Cómo publicar una versión

Guía para publicar una versión de JasWave para Windows. La versión de la aplicación es la de
`jas-wave/package.json`. La configuración del instalador está en
`jas-wave/electron-builder.cjs` (JS, para poder leer variables de entorno al empaquetar).

## 1. Preparar

1. Partir de `main` actualizado y con CI en verde.
2. Verificar en local:

   ```bash
   npm run install:all
   npm run verify        # lint + typecheck + tests
   npm run build
   ```

3. Mover las entradas de `## [Unreleased]` de `CHANGELOG.md` a una sección nueva
   `## [X.Y.Z] - AAAA-MM-DD`.
4. Si hay componentes de terceros nuevos (renderer o `dependencies` del proceso main, como
   `electron-updater`), regenerar los avisos:

   ```bash
   cd jas-wave && npm run notices
   ```

5. Revisar que `docs/legal/EULA.md` y `jas-wave/build-resources/eula.txt` estén sincronizados.

## 2. Subir la versión y etiquetar

```bash
cd jas-wave
npm version X.Y.Z --no-git-tag-version   # actualiza package.json y package-lock.json
cd ..
git add jas-wave/package.json jas-wave/package-lock.json CHANGELOG.md THIRD_PARTY_NOTICES.md
git commit -m "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z
```

La etiqueta debe tener la forma `vX.Y.Z` y coincidir con la versión de `jas-wave/package.json`
(el workflow lo comprueba y falla si no coincide). Se usa `--no-git-tag-version` porque
`jas-wave/` no es la raíz del repositorio.

## 3. Workflow de release (`.github/workflows/release.yml`)

Al subir la etiqueta `v*`, en `windows-latest`:

1. comprueba que la etiqueta coincide con `jas-wave/package.json`;
2. `npm run install:all` y `npm run verify`;
3. `npm run native:sdk`: clona el Steinberg VST3 SDK fijado en `v3.8.1_build_84` (submódulos
   `base`, `cmake`, `pluginterfaces`, `public.sdk`) en `native/plugin-host/third_party/vst3sdk`
   y verifica la etiqueta (`native/scripts/fetch-vst3sdk.mjs`);
4. `npm run native:build`: CMake + "Visual Studio 17 2022", Release x64
   (`native/scripts/build-native.mjs`) → `jaswave-plugin-host.exe`, `JasWavePiano.vst3` y
   `JasWaveRoles.vst3` en las carpetas `build-release/`;
5. `npm run release:win` con `CI=true`: build de la app, `stage:host` en **modo estricto** (falla
   si falta cualquier binario nativo) y `electron-builder --win nsis --publish always`;
6. publica en **GitHub Releases** (como **borrador**) el instalador
   `JasWave-Setup-X.Y.Z.exe`, su `.blockmap` y `latest.yml`, que es lo que lee `electron-updater`.
   También quedan como artefacto del workflow.

Revisar el borrador, completar las notas con la sección del `CHANGELOG.md` y **publicarlo**: los
clientes solo ven releases publicadas (no borradores).

El instalador incluye en `resources/`:

- `plugin-host/jaswave-plugin-host.exe` (+ `node-host.cjs` de respaldo). El host se enlaza con `/MT`
  (runtime de C++ estático): **no requiere** el redistribuible de Visual C++ en la PC destino. Comprobar con
  `dumpbin /dependents` que solo aparecen DLLs del sistema antes de publicar.
- Los VST3 de JasWave **no** van en el instalador (D1): se descargan bajo demanda o se instalan desde paquetes `.jwx`.

`native/audio-engine` (addon N-API, stub detrás de `JASWAVE_NATIVE_AUDIO=1`) **no** forma parte
del release.

El workflow `.github/workflows/native.yml` (manual o push a `main` que toque `native/**`)
compila solo los binarios nativos y los sube como artefacto, para validar cambios en C++ sin
publicar.

### Repositorio de releases y auto-actualización

`electron-updater` comprueba las actualizaciones 30 s después de arrancar y cada 6 h, las
descarga en segundo plano y las instala al cerrar la app (o al pulsar **Reiniciar** en el aviso
"Actualización vX lista"). Está desactivado fuera de la app empaquetada, con
`JASWAVE_DISABLE_UPDATES=1` o si falta `resources/app-update.yml` (p. ej. builds `--win dir`).
El registro va a `userData/logs/jaswave.log` (scope `updater`).

El repositorio del feed se fija **al empaquetar** con variables de entorno (en el workflow, como
*variables* de Actions):

| Variable | Por defecto |
|---|---|
| `JASWAVE_RELEASES_OWNER` | `JASBOOTSTUDIOS` |
| `JASWAVE_RELEASES_REPO` | `jaswaveaudio` |

`electron-updater` descarga de GitHub Releases **sin autenticación**. Si el repositorio de
código es privado, los clientes no podrán leer sus releases: crear un repositorio **público solo
de releases** (por ejemplo `JASBOOTSTUDIOS/jaswave-releases`), definir
`JASWAVE_RELEASES_OWNER`/`JASWAVE_RELEASES_REPO` en *Settings → Secrets and variables → Actions →
Variables* y un secreto `JASWAVE_RELEASES_TOKEN` (PAT con permiso de escritura en ese repo). Sin
ese secreto se usa `GITHUB_TOKEN`, que solo puede publicar en el propio repositorio.

## 4. Firma de código (preparada, desactivada)

Sin certificado el instalador se publica **sin firmar** (electron-builder registra *"no signing
info identified, signing is skipped"*) y Windows SmartScreen mostrará una advertencia.

La firma se activa sola cuando el workflow recibe credenciales:

- **Certificado (.pfx):** secretos `WIN_CSC_LINK` (certificado en base64 o URL https) y
  `WIN_CSC_KEY_PASSWORD`. En local también vale `CSC_LINK`/`CSC_KEY_PASSWORD`.
- **Azure Trusted Signing:** secretos `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
  y variables `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`,
  `AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_PUBLISHER`. Con las siete presentes
  `electron-builder.cjs` añade `win.azureSignOptions` (tiene prioridad sobre el .pfx).

Con firma activa se añade `win.signExts: [".exe", ".dll", ".vst3"]`, de modo que también se
firman `jaswave-plugin-host.exe` y los binarios `JasWaveRoles.vst3`/`JasWavePiano.vst3` de
`resources/`. Los secretos que no existen llegan vacíos y no activan nada.

## 5. Empaquetar en local

```bash
npm run native:sdk      # una vez: VST3 SDK fijado
npm run native:build    # binarios nativos (Release x64)
npm run pack:win        # build + stage + NSIS (--publish never)
```

- `stage:host` (`jas-wave/scripts/stage-plugin-host.mjs`) copia el plugin host a
  `jas-wave/resources/plugin-host` y los bundles VST3 a `jas-wave/resources/vst3/JasWave`
  (desde `build-release/` u otras carpetas de build, o desde `%LOCALAPPDATA%`). En local solo
  **avisa** si falta algo; con `CI` definido o `--strict` (`npm run stage:host:strict`) falla.
- Para probar sin instalador: `cd jas-wave && npm run electron:dir` (o
  `npx electron-builder --win dir` tras `npm run build` y `npm run stage:host`) →
  `jas-wave/release/win-unpacked/`.
- Otro generador de Visual Studio: `JASWAVE_CMAKE_GENERATOR="Visual Studio 18 2026" npm run native:build`.

**Problema conocido:** si electron-builder falla al extraer `winCodeSign` con un error de
creación de enlaces simbólicos (*"Cannot create symbolic link: El cliente no dispone de un
privilegio requerido"*), activa el **Modo de desarrollador** de Windows
(*Configuración → Sistema → Para desarrolladores*) o ejecuta la terminal como administrador,
borra la caché `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` y vuelve a intentarlo.

## 6. Después de publicar

- Instalar la versión publicada en una máquina limpia (sin `%LOCALAPPDATA%\Programs\Common\VST3\JasWave`)
  y comprobar que arranca, carga JasWave Roles/Piano desde `resources/vst3`, carga un plugin
  VST3 de terceros y reproduce audio.
- Comprobar que una instalación anterior detecta la actualización, muestra el aviso y se
  actualiza al reiniciar.
- Añadir una sección `## [Unreleased]` vacía en `CHANGELOG.md`.
