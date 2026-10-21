# Estado de los workstreams

Actualiza esta tabla al tomar, pausar o terminar un workstream (ver `PROTOCOL.md`).

| ID | Workstream | Depende de | Estado | Agente / fecha | Último commit |
|---|---|---|---|---|---|
| U1 | Cambios sin guardar | — | hecho | Claude (subagente, rama ws/u1-u5) · 2026-10-20 | b51fea3 |
| U2 | Undo limpio | — | hecho | Claude (subagente, hardening/production) · 2026-10-20 | 1dc0d54 |
| U3 | Validación de dominio real | — | hecho | Claude (subagente, hardening/production) · 2026-10-20 | 1dc0d54 |
| U4 | Media y archivos | U3 | en curso | opencode (rama ws/u4-u7) · 2026-10-21 | |
| U5 | Atajos y foco | — | hecho | Claude (subagente, rama ws/u1-u5) · 2026-10-20 | d3ab356 |
| U6 | Reproducción / grabación | U2 | en curso | opencode (rama ws/u4-u7) · 2026-10-21 | |
| U7 | Instancia única y ventanas | U1 | en curso | opencode (rama ws/u4-u7) · 2026-10-21 | |
| A1 | Motor de turnos headless | — | hecho | Claude (subagente, rama ws/a1-a2-engine) · 2026-10-20 | 6e525d1 |
| A2 | Tool-calling nativo + proveedor mock | A1 | hecho | Claude (subagente, rama ws/a1-a2-engine) · 2026-10-20 | 1b24c21 |
| A3 | Los 5 modos | A1 | hecho | Claude (agente raíz) · 2026-10-20 | 50aaac9 |
| A4 | Plan estructurado editable | A1 | hecho | Claude (agente raíz) · 2026-10-20 | 3fe16ec |
| A5 | Ejecución hasta terminar | A3, A4 | hecho | Claude (agente raíz) · 2026-10-20 | 71afd92 |
| A6 | Equipo multi-agente | A5, A9(plan/bitácora) | pendiente | | |
| A7a | Medición DSP correcta | — | hecho | Claude (subagente) · 2026-10-20 | 73cdb04 (merge) |
| A7b | Análisis por pista | A7a | en curso | Claude (subagente) · 2026-10-20 | |
| A7c | Actuar con valores reales | — | pendiente | | |
| A7d | FX propios JasWave | A7c | pendiente | | |
| A7e | masterPass y mezcla por medición | A7b, A7c | pendiente | | |
| A8 | CLI con turnos completos | A1, A5 | pendiente | | |
| A9 | Auditoría y progreso | A4 (plan), A1 (bitácora) | en curso | Claude (subagente) · 2026-10-20 | |

Estados: `pendiente` · `en curso` · `bloqueado (motivo)` · `hecho`.
