# 11 · Flujos prácticos

Recetas de punta a punta. Combínalas con los prompts de [08](./08-asistente-y-prompts.md).

---

## A) Canción completa con Asistente (recomendado)

1. Audio + IA configurados.
2. Modo **Pensar** o **Plan** → prompt Music Build con género/BPM/tonalidad/secciones/roles.
3. Revisa preview / `plan.md` → **Construir**.
4. Escucha; corrige MIDI en piano roll.
5. Abre UIs de VST (DecentSampler → carga `.dspreset`).
6. Modo **Crear**: mezcla + sends + automatización ligera.
7. `masterPass` + bounce WAV listen streaming.
8. `Ctrl+S`.

---

## B) Canción 100 % manual

1. Nuevo proyecto · BPM.
2. Pistas MIDI + audio.
3. Instrumentos: Roles o VST escaneados.
4. Piano roll / import audio.
5. Mixer + FX Chain.
6. Bounce.

---

## C) Grabar voz / guitarra

1. Pista audio · entrada del interface.
2. WASAPI Shared si necesitas soft-monitor; o monitor hardware con ASIO.
3. Metrónomo + count-in.
4. Arma · graba · edita clip (split, fade si aplica).
5. FX (EQ/comp) · bounce.

---

## D) Plantilla con Biblioteca

1. Monta un kit (drums BFD, bass, keys DecentSampler) que te guste.
2. **Biblioteca → Guardar** cada VST con nombre claro (`PopKick_v1`).
3. Nuevo proyecto → Asistente: “aplica presets globales PopKick_v1 …” o aplícalos a mano.
4. Music Build solo para MIDI encima de esos sonidos.

---

## E) Proyecto pesado (CPU)

1. Termina de editar MIDI en pistas Kontakt/BFD.
2. **Freeze** por pista.
3. Sigue mezclando con audio congelado.
4. Unfreeze solo si cambias el arreglo.

---

## F) Entrega a un colaborador externo

1. Bounce estéreo WAV 24-bit.
2. Stems dry (opcional).
3. Guarda `.jaswave` + carpeta de samples si hay rutas locales.
4. Anota BPM y tonalidad en Docs / `plan.md`.

---

## G) Sesión solo consulta (aprender el proyecto)

Modo **Consulta**:

```text
Explícame la estructura: pistas, VSTs, duración estimada, y qué faltaría para un bounce de streaming.
```

No cambia nada; ideal antes de tocar.

Siguiente: [12 · Solución de problemas](./12-solucion-problemas.md).
