# 02 · Interfaz

## Anatomía de la ventana

```
┌────────┬──────────────────────────────┬─────────┐
│ Rail   │  Área central (Arrange /     │ Panel   │
│ icons  │  Piano roll / etc.)         │ derecho │
│        ├──────────────────────────────┤         │
│        │  Panel inferior (Mixer…)     │         │
└────────┴──────────────────────────────┴─────────┘
         Barra de transporte
```

## Rail izquierdo (herramientas)

| Icono / label | Para qué sirve |
|---------------|----------------|
| **Asistente Jas** | Chat IA, modos, Music Build |
| **Explorador** | Archivos/docs del proyecto en disco |
| **Docs** | Editor de `plan.md` y docs del agente |
| **Biblioteca** | Presets VST (proyecto / global) |
| **Instrumentos** | Catálogo VST + JasWave Roles |
| **FX Chain** | Inserts de la pista o Master |
| **Editor de plugin** | UI nativa del VST abierto |
| **MIDI Learn** | Mapear controlador MIDI → acciones |
| **Arrange** | Timeline principal |
| **Mixer** | Faders, sends, medidores |
| **Piano roll** | Edición de notas MIDI |
| **Medidores** | Espectro, LUFS, listen tras bounce |
| **Enrutamiento** | Buses / routing |
| **Inspector** | Detalle de la pista seleccionada |
| **Configuración** | Ajustes del proyecto |

Puedes mostrar/ocultar **panel izquierdo**, **derecho** e **inferior** desde el rail o el menú **Ver**.

## Menús

- **Archivo** — nuevo, abrir, guardar, exportar bounce, cerrar
- **Editar** — deshacer/rehacer, cortar/copiar/pegar, duplicar
- **Ver** — zoom, paneles, paleta de comandos
- **Transporte** — play, stop, grabar, bucle, metrónomo
- **Acciones** — ajustes, MIDI Learn, atajos

## Paleta de comandos

`Ctrl+Shift+P` — busca cualquier acción por nombre (pista, transporte, UI…).

## Tip de productividad

- Trabaja en **Arrange** para estructura.
- Baja al **Mixer** para niveles.
- Usa **Piano roll** solo con un clip MIDI seleccionado.
- Deja el **Asistente Jas** a un lado; no hace falta maximizarlo siempre.

Siguiente: [03 · Proyectos](./03-proyectos.md).
