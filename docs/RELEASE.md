# Cómo publicar una versión

Guía para publicar una versión de JasWave para Windows. La versión de la aplicación es la de
`jas-wave/package.json`.

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
4. Si hay componentes de terceros nuevos, regenerar los avisos:

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

La etiqueta debe tener la forma `vX.Y.Z` y coincidir con la versión de `jas-wave/package.json`.
(Se usa `--no-git-tag-version` porque `jas-wave/` no es la raíz del repositorio.)

## 3. Workflow de release

Al subir la etiqueta `v*`, el workflow de GitHub Actions de release:

1. instala dependencias y ejecuta la verificación;
2. compila el plugin host nativo (`native/plugin-host`, CMake + Visual Studio 2022 + VST3 SDK
   v3.8.1_build_84);
3. empaqueta el instalador NSIS con electron-builder (`npm run pack:win` →
   `jas-wave/release/JasWave-Setup-X.Y.Z.exe`);
4. publica el instalador y `latest.yml` en **GitHub Releases**, que es la fuente que usa
   `electron-updater` para la actualización automática.

Revisar el borrador o la release generada, completar las notas con la sección del
`CHANGELOG.md` y publicarla.

### Repositorio privado y auto-actualización

`electron-updater` descarga las actualizaciones de GitHub Releases **sin autenticación**. Si el
repositorio de código (`JASBOOTSTUDIOS/jaswaveaudio`) es privado, los clientes no podrán leer sus
releases. En ese caso hay que publicar los artefactos en un **repositorio público solo de
releases** (por ejemplo `JASBOOTSTUDIOS/jaswave-releases`) configurando `build.publish`
(`owner`/`repo`) en `jas-wave/package.json` y un token con permiso de escritura sobre ese
repositorio en los secretos del workflow.

## 4. Firma de código

La firma de código está **desactivada** actualmente: el instalador se publica sin firmar y
Windows SmartScreen mostrará una advertencia.

Para activarla, configurar en *Settings → Secrets and variables → Actions* una de estas opciones:

- **Certificado (.pfx):**
  - `WIN_CSC_LINK`: el certificado en base64 (o una URL https).
  - `WIN_CSC_KEY_PASSWORD`: la contraseña del certificado.

  electron-builder firma automáticamente cuando estas variables están presentes.
- **Azure Trusted Signing:** configurar `win.azureSignOptions` en `jas-wave/package.json` y los
  secretos `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` y `AZURE_CLIENT_SECRET` de la aplicación con
  acceso a la cuenta de firma.

Firmar también el `jaswave-plugin-host.exe` incluido en `resources/plugin-host`.

## 5. Empaquetar en local

```bash
npm run pack:win        # desde la raíz; build + stage del plugin host + NSIS
```

Requiere haber compilado antes el plugin host nativo (ver `native/plugin-host/README.md`); el
paso `stage:host` lo copia a `jas-wave/resources/plugin-host`.

**Problema conocido:** si electron-builder falla al extraer `winCodeSign` con un error de
creación de enlaces simbólicos (*"Cannot create symbolic link: El cliente no dispone de un
privilegio requerido"*), activa el **Modo de desarrollador** de Windows
(*Configuración → Sistema → Para desarrolladores*) o ejecuta la terminal como administrador,
borra la caché `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` y vuelve a intentarlo.

## 6. Después de publicar

- Instalar la versión publicada en una máquina limpia y comprobar que arranca, carga un plugin
  VST3 y reproduce audio.
- Comprobar que una instalación anterior detecta la actualización (si el auto-update está
  activo).
- Añadir una sección `## [Unreleased]` vacía en `CHANGELOG.md`.
