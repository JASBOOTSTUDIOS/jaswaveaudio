# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público** para vulnerabilidades de seguridad.

Envía el reporte de forma privada a **[CORREO DE SEGURIDAD — PENDIENTE]** o mediante
*GitHub → Security → Report a vulnerability* (avisos privados) en
[JASBOOTSTUDIOS/jaswaveaudio](https://github.com/JASBOOTSTUDIOS/jaswaveaudio) si está habilitado.

Incluye, si es posible:

- versión de JasWave y de Windows;
- descripción del problema e impacto;
- pasos para reproducirlo o prueba de concepto;
- si afecta a un plugin de terceros concreto, su nombre y versión.

Nos comprometemos a acusar recibo en un plazo de **[N] días hábiles**, mantenerte informado y
darte crédito en el `CHANGELOG.md` si lo deseas. Pedimos no divulgar el problema hasta que exista
una versión corregida o hayan pasado **90 días** desde el reporte, lo que ocurra primero.

## Versiones soportadas

| Versión | Soporte de seguridad |
|---|---|
| Última versión publicada (0.x) | Sí |
| Versiones anteriores | No — actualiza a la última |

Mientras JasWave esté en 0.x solo se corrigen vulnerabilidades en la última versión.

## Modelo de seguridad (resumen)

JasWave es una aplicación de escritorio Electron que ejecuta contenido no confiable
(respuestas de modelos de IA, archivos de proyecto, plugins de terceros). Las defensas
principales son:

- **Renderer aislado:** `sandbox: true`, `contextIsolation`, `webSecurity` y sin integración de
  Node en todas las ventanas. El preload no tiene dependencias de Node.
- **CSP** estricta en el build; fuentes y recursos locales (sin CDN).
- **IPC con allowlist:** cada canal valida que el remitente sea el renderer propio; solo existen
  los canales necesarios y sus argumentos se validan.
- **Path grants:** el renderer solo puede leer/escribir bajo los datos de la aplicación, las
  carpetas que el usuario eligió en diálogos y (solo lectura) las carpetas de plugins VST. Se
  bloquean rutas UNC y *path traversal*.
- **Plugin host fuera de proceso** (`native/plugin-host`): los plugins corren en un proceso
  separado; los comandos que acepta están en una allowlist y las rutas se validan.
- **ffmpeg** con argumentos en allowlist, solo audio y con timeout.
- **Navegación restringida:** `window.open`, navegación externa y `<webview>` bloqueados;
  `shell.openExternal` solo para `http(s)` y `mailto`.
- **Claves de API cifradas** con el sistema operativo (`safeStorage`/DPAPI) en el proceso main;
  el renderer no puede leerlas.
- **Permisos de la IA:** el nivel de autonomía lo fija el usuario y la IA solo puede reducirlo;
  cada comando pasa por el pipeline de permisos según su riesgo real; el registro de
  herramientas falla cerrado (sin permisos = denegado).
- **Puente CLI local** apagado por defecto en la app instalada; cuando se activa escucha solo en
  loopback, exige token Bearer, sin CORS y con límite de tamaño de petición.
- **Guardado atómico** de proyectos (archivo temporal + fsync + rename, con copia `.bak`).

### Fuera de alcance

- Comportamiento malicioso de **plugins de terceros** cargados por el usuario (se ejecutan con
  los permisos del usuario en el proceso del host).
- Seguridad de los **proveedores de IA** externos.
- Ataques que requieren control previo de la cuenta de Windows del usuario.
