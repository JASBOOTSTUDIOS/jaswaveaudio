# U3 · Validación de dominio real

**Objetivo:** ningún valor inválido (BPM 0, compás 4/3, nombre vacío, volumen NaN…) puede entrar al proyecto ni a un archivo
guardado.

## Contexto y hallazgos
- Settings guarda `Number(e.target.value)` en blur (`components/project-settings-dialog.tsx:376-400`, `guardar()` `:303-311`):
  vaciar BPM → 0. `project.update` sin validación ni undo (`shared/src/commands/auxiliary-commands.ts:368-430`).
  `project.save` no valida (`shared/src/project/persistencia.ts`), pero la carga exige `bpm.valor > 0` (`shared/src/schemas/proyecto.ts`)
  → archivo que no abre y el segundo guardado pisa el `.bak` bueno; la sesión se descarta al reiniciar.
- `tienda.ts` crea `crearPipelineValidacion` **sin `reglasDominio`** (no-op). Las reglas de `shared/src/state/validacion-dominio.ts`
  apuntan a comandos inexistentes (`track.crear`, `track.renombrar`, `proyecto.timeSignature.set`, `track.volume.set`; líneas ~47/66/96).
- `validarEstado` corre sobre el estado previo y solo avisa (`ejecutor-comandos.ts`).
- `project.setTimeSignature` acepta denominadores no potencia de 2 (`auxiliary-commands.ts:83-84`); `track.update` permite cambiar
  `id`/`tipo` por spread (`domain-commands.ts`).
- Editor de compás en `components/transport-bar.tsx:268,279` hace commit en blur del numerador (no se puede escribir el
  denominador); admite fraccionales (`:251`); vaciar BPM confirma el mínimo (`:146-148`).
- Notas MIDI inválidas ya se descartan (`shared/src/project/reparar-notas.ts`), pero en silencio.

## Tareas
- [ ] Reescribir `validacion-dominio.ts` con reglas sobre comandos reales: `track.create/update` (nombre no vacío ≤64, único por
      proyecto con sufijo automático si se repite; no cambiar `id`/`tipo`; volumen 0–1.5; pan −1..1), `project.setBpm/update`
      (BPM 20–300, usar `isValidBpm` si existe), `project.setTimeSignature/update` (numerador entero 1–32, denominador ∈ {1,2,4,8,16,32}),
      `clip.*` (inicio ≥0, duración >0, pista compatible con el tipo de clip), `master.update` (volumen 0–1.5).
- [ ] Cablear `crearReglasDominio()` en `shared/src/state/tienda.ts` (pipeline).
- [ ] `ejecutor-comandos.ts`: validar el **estado resultante** con `validarProyecto` (esquema zod) antes de confirmar; si falla,
      no aplicar y devolver `VALIDATION_FAILED` con el mensaje del esquema (incluir en batch: rollback del lote).
- [ ] `project.save` / `guardarProyecto`: validar con el esquema antes de escribir (nunca escribir ni rotar `.bak` con datos inválidos).
- [ ] UI: componente `components/ui/numeric-field.tsx` (parse, clamp, Enter/blur confirma, Esc/valor inválido revierte, muestra error)
      usado en settings (BPM, compás, sample rate, buffer), transport-bar (arreglar editor de compás: confirmar al salir del
      **grupo**, no del numerador), inspector de pista/clip/nota.
- [ ] Aviso visible (toast) cuando se descartan notas MIDI inválidas o se corrige un nombre duplicado.
- [ ] Tests: cada regla; BPM 0 rechazado en comando y en settings; guardado con estado inválido rechazado sin tocar `.bak`.

## Archivos
`shared/src/state/{validacion-dominio,tienda,ejecutor-comandos}.ts`, `shared/src/commands/{auxiliary,domain}-commands.ts`,
`shared/src/project/persistencia.ts`, `jas-wave/components/{project-settings-dialog,transport-bar}.tsx`, nuevo `numeric-field.tsx`.

## Criterios de aceptación
- Ningún comando deja el proyecto fuera del esquema; ningún archivo guardado es inválido.
- Inputs numéricos nunca confirman NaN/vacío; el compás se puede editar con teclado.

## Verificación
`npm run verify`; e2e: escribir BPM vacío/0 → se revierte; guardar → reabrir funciona.

## Notas de traspaso
_(vacío)_
