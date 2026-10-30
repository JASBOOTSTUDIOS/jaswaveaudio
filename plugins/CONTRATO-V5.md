# Contrato V5 de plugins JasWave (manifiesto + licencias)

Fuente única para quienes implementan plugins (C++), el cargador (`shared/src/plugins/manifiesto.ts`) y el backend.

## 1. Manifiesto `jaswave-plugin.json` (esquema V5)

```jsonc
{
  "id": "com.jaswave.plugin.param-eq",          // minúsculas, puntos y guiones; = productId de licencia
  "name": "JasWave EQ Parametric Pro",
  "version": "1.0.0",                           // semver
  "category": "audio-effect",                   // audio-effect | instrument | instrument-bundle | ai-skill | ui-extension | bridge
  "vendor": "JasWave Audio",
  "description": "…",
  "targetPlatforms": ["win-x64"],               // win-x64 | web
  "entrypoints": {
    "dspDesktop": "bin/JasWaveParamEq.vst3",    // bundle VST3 relativo al paquete
    "dspWeb": "dist/web-worklet.js",            // opcional
    "aiSkill": "dist/agent-skills.js",          // opcional
    "ui": "dist/ui-module.js"                   // opcional
  },
  "vst3": { "classId": "{4A15A3A0-…}", "subCategories": "Fx|EQ" },   // obligatorio si hay dspDesktop
  "permissions": {
    "realtimeAudio": true,
    "fileSystem": "none",                       // none | read-project-stems | read-write-project
    "network": false,                           // los VST hablan con el backend de licencias por su cuenta; esto es para módulos JS
    "commands": ["plugin.setParameter"]         // comandos del DAW que puede emitir su aiSkill
  },
  "rolesAllowed": ["mezcla", "mastering"],      // director | productor | mezcla | mastering | qa  (alias aceptados: producer→productor, mix→mezcla)
  "license": {
    "productId": "com.jaswave.plugin.param-eq",
    "features": [ { "key": "eq.bandas-avanzadas", "description": "Bandas 5–8" } ]   // acciones licenciables (admin las concede)
  },
  "ai": {
    "summary": "Ecualizador paramétrico de 8 bandas para corrección y color.",
    "intents": ["cortar-graves", "realzar-presencia", "eliminar-resonancia"],
    "parameters": [
      { "id": "b1.freq", "vstParamId": 1, "name": "Banda 1 Frecuencia", "min": 20, "max": 20000, "default": 100, "unit": "Hz", "scale": "log", "feature": null }
    ]
  },
  "download": { "url": "https://github.com/…/releases/download/…/com.jaswave.plugin.param-eq-1.0.0.zip", "sha256": "", "sizeBytes": 0 },
  "checksum": "SHA256:"                          // del zip del paquete; lo rellena native/scripts/package-plugins.mjs
}
```

`ai.parameters[].scale`: `linear` | `log` | `stepped` | `toggle` | `enum`. Un `enum` lleva `values` (una etiqueta por valor entero de
min a max) y la IA puede indicar la etiqueta o el índice. `readOnly: true` marca mediciones (p. ej. reducción de ganancia):
se describen pero no se ajustan.

`ai.parameters[].vstParamId` es el **ParamID numérico VST3** del parámetro (estable entre versiones): el DAW y la IA lo usan para
automatizar y para `plugin.setParameter`. `id` es un nombre legible estable (p. ej. `b1.freq`, `comp.threshold`).
`features[].key` sigue `^[a-z0-9][a-z0-9.\-]{1,120}$`. Un parámetro con `"feature": "x"` solo es operable si la licencia
concede la acción `x`. Las funciones básicas de cada plugin pueden quedar sin feature (siempre activas con licencia válida).

## 2. Licencia firmada (`jwl1`)

`jwl1.<payload base64url>.<firma base64url>`; firma **Ed25519** sobre los bytes ASCII de `jwl1.<payload base64url>`.

```json
{ "sub": "<usuarioId>", "email": "a@b.c", "dispositivo": "Reaper-PC",
  "productos": { "com.jaswave.plugin.param-eq": ["eq.bandas-avanzadas"] },
  "iat": 1792700000, "exp": 1792786400 }
```

- Válida si la firma verifica con `plugins/shared-license/keys/licencia_publica.pem` y `exp > ahora`.
- Un plugin funciona si `productos` contiene su `id` (aunque la lista de acciones esté vacía no se emite: ausencia = sin acceso).
- Vigencia 24 h: **sin renovar, deja de funcionar al vencer**.

## 3. Endpoints (backend, `apiBase`)

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /license/device/start` | `{productoId, dispositivo}` | `201 {codigoDispositivo, codigoUsuario, caducaEn, intervaloSeg}` |
| (usuario) abrir `{webBase}/activar?codigo=<codigoUsuario>` | — | el usuario inicia sesión y aprueba |
| `POST /license/device/poll` | `{codigoDispositivo, dispositivo}` | `{estado:'pendiente'}` · `{estado:'caducado'}` · `{estado:'aprobado', token, expiraEn, productos, tokenDispositivo}` |
| `POST /license/device/renovar` | `{tokenDispositivo, dispositivo}` | `{estado:'aprobado', token, expiraEn, productos, tokenDispositivo}` (rotado) · `401 dispositivo_revocado` · `403 sin_licencia` |

`tokenDispositivo` es un secreto de larga duración por equipo: se rota en cada renovación (usar siempre el último) y el
admin puede revocarlo. Guardar cifrado con **DPAPI** (`CryptProtectData`, ámbito usuario).

## 4. Almacenamiento compartido (todos los VST JasWave + el DAW)

`%APPDATA%\JasWave\license\`
- `license.jwl` — última licencia (texto).
- `device.bin` — `tokenDispositivo` cifrado con DPAPI.
- `config.json` — opcional `{ "apiBase": "https://…", "webBase": "https://…" }`. Por defecto `apiBase`
  = `JASWAVE_API_URL` o `http://127.0.0.1:8787`; `webBase` = `JASWAVE_WEB_URL` o `http://localhost:5173`.

Escritura atómica (archivo temporal + `MoveFileEx` con reemplazo). Renovación en hilo de fondo cuando quedan < 6 h,
reintentos con backoff; nunca en el hilo de audio.

## 5. Módulos del DAW (`category: ui-extension | ai-skill`, M3)

Un módulo es un paquete independiente en `plugins/com.jaswave.modulo.<nombre>/` con su propio `package.json`,
build (`vite build` → `dist/modulo.js` + `dist/modulo.css`) y manifiesto:

```json
{ "category": "ui-extension", "targetPlatforms": ["win-x64", "web"],
  "entrypoints": { "ui": "dist/modulo.js", "uiEstilos": "dist/modulo.css" } }
```

- **Código**: `dist/modulo.js` es ESM y exporta por defecto `definirModulo({...})` de `@jaswave/host-sdk`
  (herramientas del workspace, `activar(ctx)` → paneles, menús de clip, páginas de ajustes, componentes
  globales, zoom, `desactivar`).
- **Dependencias**: el módulo solo importa `@jaswave/host-sdk`, sus propios archivos y paquetes npm. React y la
  API del DAW los aporta el host en tiempo de ejecución (`globalThis.__JASWAVE_SDK__`); no se empaquetan.
  `plugins/scripts/verificar-independencia.mjs` lo comprueba en `npm run verify`.
- **API del DAW**: `jas-wave/src/modulos/api-host.ts` (lo publicado); sus tipos se generan en
  `plugins/sdk/host-sdk` con `npm run sdk:generar`. Cambiar una firma existente exige subir `VERSION_SDK`.
- **Entrega en escritorio**: zip con `jaswave-plugin.json` + `dist/` en el catálogo firmado (`jwc1`). El
  instalador verifica firma, SHA-256 y tamaño, intercambia `dist/` de forma atómica y registra el hash de cada
  archivo en `instalacion.json`. El renderer lo carga por `jaswave-modulo://<id>/dist/…`, que solo sirve
  archivos de `dist/` cuyo hash coincide (en desarrollo, también los de `plugins/` sin registro).
- **Entrega en la web**: el catálogo incluye `ui`, `uiEstilos` y el SHA-256 de cada archivo; los archivos se
  publican con `plugins/scripts/publicar-modulos-web.mjs` y se sirven en
  `<api>/modulos/<id>/<versión>/<ruta>` (inmutables). El navegador verifica la firma del catálogo con
  WebCrypto (Ed25519) antes de registrar módulos.
- **Pruebas**: cada módulo tiene pruebas de contrato en `test/` que se ejecutan contra el DAW real
  (`plugins/sdk/host-sdk/pruebas/host-real.ts`); su código de producción no importa el DAW.
