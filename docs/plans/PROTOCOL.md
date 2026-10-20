# Protocolo para agentes

## Rama y commits
- Trabaja en la rama **`hardening/production`** (o una rama `ws/<id>-<slug>` creada desde ella y mergeada al terminar).
- Commits pequeños por tarea; mensaje en español con prefijo convencional (`fix(...)`, `feat(...)`, `test(...)`, `docs(plans)`).
- Si el agente es Claude, termina el mensaje con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; otros agentes
  usan su propia línea de atribución si su configuración lo indica.
- **No** hagas push ni merge a `main` sin pedirlo el usuario.

## Antes de empezar un workstream
1. En `STATUS.md` cambia su estado a `en curso` con tu nombre de agente y la fecha.
2. Lee el archivo del workstream completo, incluidas las **Notas de traspaso** del agente anterior.
3. Verifica que el árbol está limpio y que `npm run verify` pasa (si no pasa, arréglalo o anótalo antes de seguir).

## Durante
- Respeta las convenciones de `AGENTS.md`: identificadores de dominio en español en `shared/`, toda mutación del proyecto
  pasa por comandos (`tienda.executor.execute`), tests de `jas-wave` con `node:test` (`tsx --test`), de libs con Vitest.
- Muchos archivos usan **CRLF**: preserva el final de línea al editar.
- Seguridad (no regresionar): IPC con remitente validado (`electron/security.ts`), rutas vía `path-grants.ts`, allowlist del
  plugin host (`plugin-host-guard.ts`), API keys solo en main (`ai-credentials.ts`), política fail-closed de acciones IA
  (`ai-harness/src/agent/action-policy.ts`), datos de herramientas como no confiables (`ai-harness/src/agent/untrusted.ts`).
- Cada tarea marcada `- [x]` debe tener test o verificación reproducible.

## Al terminar una tarea / pausar
- Marca `- [x]` en el checklist del workstream.
- Actualiza **Notas de traspaso** (qué quedó a medias, decisiones, comandos útiles, archivos tocados).
- Actualiza `STATUS.md` (estado, último commit).
- Commit con los cambios de código **y** de `docs/plans/`.

## Definición de hecho (por workstream)
- Todas las casillas marcadas, criterios de aceptación cumplidos y demostrados.
- `npm run verify` en verde; e2e en verde si el workstream toca UI/Electron; nativo compila si toca `native/`.
- Sin `console.log` de depuración ni código muerto nuevo; docs relevantes actualizadas (README/CHANGELOG si aplica).
