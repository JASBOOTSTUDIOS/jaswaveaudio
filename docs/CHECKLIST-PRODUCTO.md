# Checklist de producto — JasWave completo

> Criterio: **terminar una canción aquí y entregar un archivo**, no el roadmap entero (marketplace, colaboración, stems por IA).
> Fecha: 2026-08-23 · Marcar ítems al cerrarlos; no tachar lo que aún es de laboratorio.

Hoy: arrange, mixer, piano roll, transporte, metrónomo, clips, Soft Pad, VST3 (UI+DSP), FX serial, WASAPI/ASIO, copiloto + Music Build + harness.

---

## Bloqueantes (sin esto no es un DAW de producción)

### 1. Exportar / bounce
- [x] Bounce / render offline a **WAV** (PCM16/24 con dithering TPDF; notas VST + clips + Soft Pad; LUFS adjunto)
- [ ] Exportar **FLAC** y **MP3**
- [x] Rango (todo el proyecto o selección de tiempo)
- [x] Progreso y cancelar
- [ ] Stems por pista (después del bounce mix)

### 2. Un motor, no dos
- [ ] Playback nativo de clips (hoy: Web Audio → pipe → host)
- [ ] Freeze de pista
- [x] Render offline = el mismo audio que Play (stems pre-renderizados inline por paso; live MIDI gateada)
- [ ] Addon `native/audio-engine` fuera de stub o retirado del camino

### 3. Mezcla de estudio
- [ ] Sends / returns
- [ ] Sidechain
- [ ] PDC (compensación de latencia) de verdad entre pistas
- [ ] Freeze / bounce in place

### 4. Estado de plugins en el proyecto
- [ ] Chunk / preset del VST en el `.jaswave`
- [ ] Reabrir el proyecto restaura el instrumento (no solo el path)
- [ ] Bypass y parámetros de la cadena persisten y suenan igual

### 5. Grabación usable
- [ ] Monitoreo de entrada
- [ ] Punch in/out
- [ ] Tomas / comping
- [x] MIDI desde teclado hardware (Web MIDI: thru a pista armada/seleccionada + grabación a clip)
- [ ] Count-in fiable
- [ ] Armado → clip de audio sin glitches (base ya existe)

### 6. Automatización
- [ ] Volumen y pan en el tiempo
- [ ] Parámetros de plugin
- [ ] Grabación de automatización (fader en play)
- [ ] Lanes editables en el arrange

### 7. Host estable
- [ ] ASIO (UMC y similares) sin crash al reabrir device
- [ ] BFD / Kontakt / Analog Lab en sesión larga
- [ ] Crash de un VST ≠ tumbar el DAW
- [ ] Sesión de 4+ horas sin xruns graves

### 8. Producto instalable
- [ ] Build empaquetado (Windows primero)
- [ ] Un músico abre el .exe y trabaja sin `npm run dev`

---

## Después (no bloquean “completo”)

- [ ] Macros y scripting
- [ ] Themes / atajos configurables a fondo
- [ ] Extensiones del DAW
- [ ] Colaboración multi-usuario
- [ ] IA generativa de audio
- [ ] Separación de stems / análisis avanzado
- [ ] Nube y marketplace

---

## Corte siguiente (orden de ataque)

1. Bounce WAV
2. Estado VST en el proyecto
3. Automatización de volumen / pan
