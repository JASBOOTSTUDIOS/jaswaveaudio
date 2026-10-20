# E2E de la app empaquetada (Playwright)

Pruebas de extremo a extremo sobre **JasWave.exe empaquetado** (o el build de desarrollo).
Cada spec arranca su propia instancia de Electron con un `userData` temporal, la maneja
por el agent bridge HTTP y comprueba la UI por CDP.

| Spec | Escenario |
| --- | --- |
| `01-launch` | Arranque: título, UI renderizada, sin errores de consola, CSP, sin `require`, `window.electron`, userData aislado |
| `02-security` | Desde la página: `fileRead`/`fileSave` fuera de concesiones, `pluginHostSend load` de DLL arbitraria, `shellOpenExternal(file://…)`, `window.open`, fetch al bridge. Con bridge apagado (no escucha) y encendido (Origin → 403, Host ajeno → 403, sin token → 401) |
| `03-project` | `project.new` + BPM + pista MIDI + clip con notas vía bridge; la pista aparece en la UI; Ctrl+Z / Ctrl+Y con ids estables |
| `04-save-reopen` | Guardar en carpeta temporal (ruta concedida por el bridge), `.bak` en el segundo guardado, `project.load` restaura pista/clip/BPM |
| `05-export` | `render.start` a WAV (pista de audio con un seno generado); WAV válido y > 200 KB. Se salta si no hay plugin host |
| `06-crash` | Error no capturado + rechazo de promesa → `logs/jaswave.log`, app viva; crash del proceso renderer → `render-process-gone` en el log y main vivo |
| `07-agent-mock` | Turno completo del agente por la UI con el proveedor mock (`JASWAVE_AI_MOCK=fixtures/agent-mock-tempo.json`): pedido → tool call nativa → tarjeta Aplicar → «Todas» → BPM aplicado y run `completed` en `userData/agent-runs` |

## Cómo ejecutar

```bash
# 1. Empaquetar sin instalador (release/win-unpacked/JasWave.exe)
cd jas-wave
npm run pack:dir            # = build + stage:host + electron-builder --win dir
#   (o `npm run pack:win`, que además genera el instalador NSIS)

# 2. Ejecutar la suite
npm run e2e                 # desde jas-wave/
npm run e2e                 # o desde la raíz del monorepo
npx playwright test -c e2e/playwright.config.ts 03-project   # un solo spec
```

Build de desarrollo (sin empaquetar, `electron .` cargando `dist/index.html`):

```bash
npm run build && npm run e2e:dev
```

La primera vez no hace falta `npx playwright install`: no se usa ningún navegador de
Playwright, solo `chromium.connectOverCDP` contra el propio Electron.

## Variables de entorno

| Variable | Efecto |
| --- | --- |
| `JASWAVE_E2E_TARGET` | `packaged` (por defecto) o `dev` |
| `JASWAVE_E2E_EXE` | Ruta alternativa al ejecutable empaquetado |
| `JASWAVE_E2E_KEEP_TMP=1` | No borrar la carpeta temporal (`%TEMP%/jaswave-e2e-*`: `userData/`, `work/`) |
| `JASWAVE_E2E_ALLOW_SILENT=1` | `05-export` no falla si el WAV exportado es silencio (solo diagnóstico) |
| `JASWAVE_AI_MOCK` | Ruta a un guion JSON del proveedor mock (formato en `ai-harness/src/engine/mock-script.ts`): todas las peticiones de chat se responden desde el guion, sin red. También sirve para la CLI con la app abierta |
| `CI` | 1 reintento, `forbidOnly` y reporte HTML en `jas-wave/playwright-report/` |

El lanzador fija por su cuenta `JASWAVE_AGENT_BRIDGE` (`0`/`1`), `JASWAVE_AGENT_PORT`
(puerto libre) y `JASWAVE_AGENT_TOKEN` (token aleatorio), y elimina `VITE_DEV_SERVER_URL`.

## Detalles de implementación

- **Por qué no `_electron.launch()`**: el ejecutable empaquetado tiene el fuse
  `EnableNodeCliInspectArguments=false`, así que `--inspect` se ignora y Playwright no
  puede conectarse. Se lanza el exe con `--remote-debugging-port=<libre>` (switch de
  Chromium, no afectado por los fuses) y se usa `chromium.connectOverCDP`.
- **Aislamiento**: `--user-data-dir=<tmp>/userData` (Electron lo respeta para
  `app.getPath('userData')`; `01-launch` lo verifica). Los proyectos y renders van a
  `<tmp>/work`, fuera de userData, para ejercitar las concesiones de ruta del bridge.
- **Diálogos nativos**: no se automatizan. Guardar usa `project.update { ruta }` +
  `project.save`; abrir usa `project.load { ruta }`. El bridge autenticado concede la
  carpeta de esas rutas solo durante la sesión.
- **Fallos**: al fallar un test se adjuntan captura de pantalla, salida del proceso main,
  errores de consola y `jaswave.log` (`jas-wave/test-results/e2e/`).
- **Audio**: el bounce es offline en el plugin host; no hace falta ASIO (WASAPI o sin
  dispositivo). Sin `jaswave-plugin-host.exe` el test de export se salta con el motivo.
- Los archivos de `e2e/` no entran en `npm test` (glob `src|lib|electron/**/*.test.ts`) y
  tienen su propio `tsconfig.json` (incluido en `npm run typecheck`).
