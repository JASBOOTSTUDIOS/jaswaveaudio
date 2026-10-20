# Estado de los workstreams

Actualiza esta tabla al tomar, pausar o terminar un workstream (ver `PROTOCOL.md`).

| ID | Workstream | Depende de | Estado | Agente / fecha | Último commit |
|---|---|---|---|---|---|
| U1 | Cambios sin guardar | — | pendiente | | |
| U2 | Undo limpio | — | pendiente | | |
| U3 | Validación de dominio real | — | pendiente | | |
| U4 | Media y archivos | U3 | pendiente | | |
| U5 | Atajos y foco | — | pendiente | | |
| U6 | Reproducción / grabación | U2 | pendiente | | |
| U7 | Instancia única y ventanas | U1 | pendiente | | |
| A1 | Motor de turnos headless | — | pendiente | | |
| A2 | Tool-calling nativo + proveedor mock | A1 | pendiente | | |
| A3 | Los 5 modos | A1 | pendiente | | |
| A4 | Plan estructurado editable | A1 | pendiente | | |
| A5 | Ejecución hasta terminar | A3, A4 | pendiente | | |
| A6 | Equipo multi-agente | A5, A9(plan/bitácora) | pendiente | | |
| A7a | Medición DSP correcta | — | hecho | Claude (subagente) · 2026-10-20 | ver rama `ws/a7a-dsp` |
| A7b | Análisis por pista | A7a | pendiente | | |
| A7c | Actuar con valores reales | — | pendiente | | |
| A7d | FX propios JasWave | A7c | pendiente | | |
| A7e | masterPass y mezcla por medición | A7b, A7c | pendiente | | |
| A8 | CLI con turnos completos | A1, A5 | pendiente | | |
| A9 | Auditoría y progreso | A4 (plan), A1 (bitácora) | pendiente | | |

Estados: `pendiente` · `en curso` · `bloqueado (motivo)` · `hecho`.
