 hecho | Claude Opus 5.5 · 2026-10-23 | (este commit) |hecho | Claude Opus 5.5 · 2026-10-23 | (este commit) |hecho | Claude Opus 5.5 · 2026-10-23 | (este commit) |# Estado de los workstreams

Actualiza esta tabla al tomar, pausar o terminar un workstream (ver `PROTOCOL.md`).

| ID | Workstream | Depende de | Estado | Agente / fecha | Último commit |
|---|---|---|---|---|---|
| U1 | Cambios sin guardar | — | hecho | Claude (subagente, rama ws/u1-u5) · 2026-10-20 | b51fea3 |
| U2 | Undo limpio | — | hecho | Claude (subagente, hardening/production) · 2026-10-20 | 1dc0d54 |
| U3 | Validación de dominio real | — | hecho | Claude (subagente, hardening/production) · 2026-10-20 | 1dc0d54 |
| U4 | Media y archivos | U3 | hecho | opencode (rama ws/u4-u7) · 2026-10-21 | 1e689ff |
| U5 | Atajos y foco | — | hecho | Claude (subagente, rama ws/u1-u5) · 2026-10-20 | d3ab356 |
| U6 | Reproducción / grabación | U2 | hecho | opencode (rama ws/u4-u7) · 2026-10-22 | 0e65119 |
| U7 | Instancia única y ventanas | U1 | hecho | opencode (rama ws/u4-u7) · 2026-10-22 | 8678198 |
| A1 | Motor de turnos headless | — | hecho | Claude (subagente, rama ws/a1-a2-engine) · 2026-10-20 | 6e525d1 |
| A2 | Tool-calling nativo + proveedor mock | A1 | hecho | Claude (subagente, rama ws/a1-a2-engine) · 2026-10-20 | 1b24c21 |
| A3 | Los 5 modos | A1 | hecho | Claude (agente raíz) · 2026-10-20 | 50aaac9 |
| A4 | Plan estructurado editable | A1 | hecho | Claude (agente raíz) · 2026-10-20 | 3fe16ec |
| A5 | Ejecución hasta terminar | A3, A4 | hecho | Claude (agente raíz) · 2026-10-20 | 71afd92 |
| A6 | Equipo multi-agente | A5, A9(plan/bitácora) | pendiente | | |
| A7a | Medición DSP correcta | — | hecho | Claude (subagente) · 2026-10-20 | 73cdb04 (merge) |
| A7b | Análisis por pista | A7a | hecho | Claude (subagente) · 2026-10-21 | 3a9fb4d |
| A7c | Actuar con valores reales | A7b, A9 | hecho | Claude · 2026-10-22 | c451441 |
| A7d | FX propios JasWave | A7c | bloqueado (sin VST3 SDK ni MSVC: build nativo y e2e no verificables aquí; integración TS completa y testeada) | Claude Opus 5.5 · 2026-10-22 | — |
| A7e | masterPass y mezcla por medición | A7b, A7c | pendiente | | |
| A8 | CLI con turnos completos | A1, A5 | pendiente | | |
| A9 | Auditoría y progreso | A4 (plan), A1 (bitácora) | hecho | Claude (subagente) · 2026-10-21 | 58268d7 |
| B0 | Backend independiente (Express+TS+Supabase) | — | hecho | Claude Opus 5.5 · 2026-10-23 | (ver git log backend/) |
| S1 | Auth JWT + WebSocket de sync | B0 | hecho | Claude Opus 5.5 · 2026-10-23 | (ver git log backend/) |
| S2 | Reconciliación vectorial y undo por usuario | S1, K1 | hecho | Claude Opus 5.5 · 2026-10-23 | (ver git log shared/src/sync) |
| L1 | Licencias, roles y API admin | B0 | hecho | Claude Opus 5.5 · 2026-10-23 | (ver git log backend/) |
| L2 | Licencia dentro de cada VST | L1, V1 | hecho | Claude Opus 5.5 · 2026-10-23 | ae53d2c |
| L3 | Login y panel admin en el DAW | L1 | en curso (código y pruebas hechos; verificación en vivo pendiente) | Claude Opus 5.5 · 2026-10-23 | 7a607aa |
| P1 | Manifiesto jaswave-plugin.json y cargador | K1 | en curso | Claude Opus 5.5 · 2026-10-23 | (ver git log) |
| P2 | Registro dinámico de herramientas IA | P1 | hecho | Claude Opus 5.5 · 2026-10-23 | (ver git log) |
| K1 | Microkernel sin dependencias estáticas | — | en curso (parte nativa hecha; TS pendiente) | Claude Opus 5.5 · 2026-10-23 | ae53d2c |
| V1 | Plugins VST3 independientes | K1 | hecho | Claude Opus 5.5 · 2026-10-23 | ae53d2c |
| V2 | Rediseño UI cyber y calidad DSP | V1 | hecho | Claude Opus 5.5 · 2026-10-23 | ae53d2c |
| W1 | Cliente web | B0, K1 | pendiente | | |
| W2 | WebSynth y stem freezing | W1 | pendiente | | |
| H1 | Handover web → desktop | S1, W1 | pendiente | | |
| D1 | Instalador ligero y entrega modular | V1, L2 | pendiente | | |

Estados: `pendiente` · `en curso` · `bloqueado (motivo)` · `hecho`.
