# Planes de implementación — JasWave

Esta carpeta contiene los planes ejecutables de la fase **"Robustez ante errores del usuario + IA ingeniero de sonido
multi-agente"**. Están escritos para que **cualquier agente de código** (Claude Code, opencode, Kilo, etc.) pueda
continuar el trabajo sin el contexto de la conversación original.

## Cómo empezar (agentes)
1. Lee [`PROTOCOL.md`](PROTOCOL.md) — reglas obligatorias de trabajo.
2. Lee [`00-contexto.md`](00-contexto.md) — arquitectura, decisiones del usuario y hallazgos.
3. Abre [`STATUS.md`](STATUS.md), toma el primer workstream **pendiente** cuyas dependencias estén **hechas**.
4. Sigue el archivo del workstream: checklist, archivos, criterios y comandos de verificación.
5. Al pausar o terminar: actualiza checklist, `STATUS.md` y la sección **Notas de traspaso** del workstream.

## Orden recomendado
| Fase | Workstreams | Notas |
|---|---|---|
| 1 | U1, U2, U3 ∥ A7a | Datos/undo primero; DSP aislado en `shared/` |
| 2 | A1, A2 | Motor de turnos headless + tool-calling nativo + proveedor mock |
| 3 | A3, A4, A5, A9 (parte plan/bitácora) | Modos, plan estructurado, ejecución hasta terminar |
| 4 | A6 ∥ A7b | Equipo multi-agente ∥ análisis por pista (nativo) |
| 5 | A7c, A7d, A7e ∥ U4, U5, U6, U7 | Valores reales, FX propios, mastering ∥ resto de robustez |
| 6 | A8, A9 (resto) | CLI de agente, auditoría completa, certificación y e2e |

## Índice
- Robustez: [U1](U1-cambios-sin-guardar.md) · [U2](U2-undo-limpio.md) · [U3](U3-validacion-dominio.md) ·
  [U4](U4-media-archivos.md) · [U5](U5-atajos-foco.md) · [U6](U6-reproduccion-grabacion.md) · [U7](U7-instancia-ventanas.md)
- IA: [A1](A1-motor-headless.md) · [A2](A2-tool-calling-nativo.md) · [A3](A3-modos.md) · [A4](A4-plan-estructurado.md) ·
  [A5](A5-ejecucion-hasta-terminar.md) · [A6](A6-multi-agente.md) · [A7a](A7a-medicion-dsp.md) ·
  [A7b](A7b-analisis-por-pista.md) · [A7c](A7c-actuar-valores-reales.md) · [A7d](A7d-fx-jaswave.md) ·
  [A7e](A7e-masterpass-y-mezcla.md) · [A8](A8-cli-agente.md) · [A9](A9-auditoria-progreso.md)

## Verificación global
```bash
npm run install:all     # una vez
npm run verify          # lint + typecheck + tests (shared, ai-harness, jas-wave)
cd jas-wave && npm run build && npx electron-builder --win dir && npm run e2e   # e2e sobre app empaquetada
# Nativo (si tocas native/): npm run native:sdk && npm run native:build && npm run stage:host --prefix jas-wave
# CLI con la app abierta (JASWAVE_AGENT_BRIDGE=1 en empaquetada): node jas-wave/cli/daw-cli.mjs certify --quick
```
