# Estado de los workstreams

Actualiza esta tabla al tomar, pausar o terminar un workstream (ver `PROTOCOL.md`).

| ID | Workstream | Depende de | Estado | Agente / fecha | Último commit |
|---|---|---|---|---|---|
| U1 | Cambios sin guardar | — | hecho | Claude (subagente, rama ws/u1-u5) · 2026-10-20 | b51fea3 |
| U2 | Undo limpio | — | hecho | Claude (subagente, hardening/production) · 2026-10-20 | 1dc0d54 |
| U3 | Validación de dominio real | — | hecho | Claude (subagente, hardening/production) · 2026-10-20 | 1dc0d54 |
| U4 | Media y archivos | U3 | pendiente | | |
| U5 | Atajos y foco | — | hecho | Claude (subagente, rama ws/u1-u5) · 2026-10-20 | d3ab356 |
| U6 | Reproducción / grabación | U2 | pendiente | | |
| U7 | Instancia única y ventanas | U1 | pendiente | | |
| A1 | Motor de turnos headless | — | hecho | Claude (subagente, rama ws/a1-a2-engine) · 2026-10-20 | 6e525d1 |
| A2 | Tool-calling nativo + proveedor mock | A1 | hecho | Claude (subagente, rama ws/a1-a2-engine) · 2026-10-20 | 1b24c21 |
| A3 | Los 5 modos | A1 | pendiente | | |
| A4 | Plan estructurado editable | A1 | pendiente | | |
| A5 | Ejecución hasta terminar | A3, A4 | pendiente | | |
| A6 | Equipo multi-agente | A5, A9(plan/bitácora) | pendiente | | |
| A7a | Medición DSP correcta | — | hecho | Claude (subagente) · 2026-10-20 | 73cdb04 (merge) |
| A7b | Análisis por pista | A7a | pendiente | | |
| A7c | Actuar con valores reales | — | pendiente | | |
| A7d | FX propios JasWave | A7c | pendiente | | |
| A7e | masterPass y mezcla por medición | A7b, A7c | pendiente | | |
| A8 | CLI con turnos completos | A1, A5 | pendiente | | |
| A9 | Auditoría y progreso | A4 (plan), A1 (bitácora) | pendiente | | |

Estados: `pendiente` · `en curso` · `bloqueado (motivo)` · `hecho`.
