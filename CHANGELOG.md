# Changelog

Todos los cambios relevantes de JasWave se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[Versionado Semántico](https://semver.org/lang/es/). La versión de la app está en
`jas-wave/package.json`.

## [Unreleased]

Endurecimiento para producción (rama `hardening/production`).

### Añadido

- **CI** en GitHub Actions (Windows): lint, typecheck, tests de `shared`, `ai-harness` y
  `jas-wave`, y build. Scripts raíz `install:all`, `typecheck`, `test` y `verify`.
- **Pipeline de permisos real** para el agente: cada comando se evalúa con su riesgo real y
  respeta el nivel de autonomía (solo lectura / sugerir ya no escriben). Las acciones quedan
  auditadas con su origen real (IA, usuario que aprobó, CLI).
- **Cancelación de peticiones de IA:** "Detener" aborta la petición HTTP y sus reintentos en el
  proceso main y libera la cola.
- Documentación legal y de proyecto: `LICENSE`, `docs/legal/EULA.md` (y página de licencia en
  el instalador), `docs/legal/PRIVACIDAD.md`, `THIRD_PARTY_NOTICES.md` (incluido en la app
  instalada) con script `npm run notices`, `SECURITY.md`, `docs/RELEASE.md` y ADR-0018
  (soporte VST2).

### Cambiado

- **Electron endurecido:** `sandbox: true` y `webSecurity` en todas las ventanas, preload sin
  dependencias de Node, CSP en el build.
- **IPC:** todos los canales validan que el remitente sea el renderer propio; se eliminan
  canales sin uso.
- **Path grants:** el renderer solo accede a los datos de la app, a carpetas elegidas por el
  usuario y (solo lectura) a las carpetas VST; se bloquean UNC y *path traversal*.
- **Plugin host:** allowlist de comandos y validación de rutas de plugin/render.
- **ffmpeg:** argumentos en allowlist, solo audio y con timeout.
- **`shell.openExternal`** limitado a `http(s)` y `mailto`; `window.open`, navegación y
  `<webview>` bloqueados.
- **Puente del agente (CLI):** apagado por defecto en la app instalada, token Bearer, sin CORS,
  solo loopback y cuerpo ≤ 2 MB.
- **Registro de herramientas fail-closed:** sin PermissionManager se deniega; contexto por
  instancia y nivel derivado del origen.
- **Claves de API cifradas** con `safeStorage`/DPAPI en el proceso main; el renderer ya no las
  guarda en `localStorage` ni puede leerlas (migración automática).
- **Fuentes locales** (Inter, JetBrains Mono, Bravura) en lugar de CDN.
- **Guardado atómico** de proyectos (temporal + fsync + rename, con `.bak`).
- Dependencias de UI movidas a `devDependencies` (Vite las empaqueta). Node ≥ 22.

### Corregido

- La **app empaquetada abría una ventana en blanco**: ahora carga `dist/index.html` desde la
  ruta de la app; logo e icono con rutas relativas.
- **Escalada de permisos de la IA:** la IA o los scripts ya no pueden subir su nivel de
  autonomía (antes se aprobaba desde READ_ONLY y revertía la parada de emergencia).
- Detección de `STATE_CONFLICT` al aplicar ejecuciones pendientes del agente.
- Clave de Gemini enviada por cabecera en lugar de en la URL.

### Eliminado

- Targets de empaquetado macOS/Linux (el plugin host nativo es solo Windows).
- Ejecutable del plugin host y `.d.ts` generados del control de versiones.
