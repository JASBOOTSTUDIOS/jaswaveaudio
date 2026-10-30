# T — Mezcla inicial automática por perfiles de estilo

> Estado: implementado y probado con tests (sin modelo real, sin oído, sin pasada real). Pendiente: una pasada real y medirla con `analizar-audio.cjs`.

## 1. Hallazgos medidos (render de 40 s del e2e 29, 7 pistas, antes del máster)

- Pico 0 dBFS con 5.883 muestras al tope y +0,4 dBTP; RMS −9,9 dBFS (objetivo −14 LUFS); cresta 9,9 dB.
- **76 % de la energía entre 60–250 Hz y 16,6 % bajo 60 Hz**; medios 1,9 %, presencia 1,0 %, brillo 0,7 %, aire 0,1 % (centroide ≈ 212 Hz: sordo y retumbante).
- RMS por segundo casi plano (4 dB entre verso y pre-coro: sin curva dinámica); casi mono (correlación L/R 0,92).
- Todos los faders a 0 dB, sin EQ ni paneo. Las 2 peticiones del modelo de mezcla esperaron 6 min a mediciones nativas que agotaron su tiempo.
- La revisión de partes del QA gastó 258 peticiones en 9 min 44 s.

## 2. Diseño

La mezcla determinista es **solo el suelo de seguridad**: aplica un **perfil de estilo** (datos) como punto de partida, sin modelo, y el
modelo de mezcla recibe ese perfil como guion y **decide con criterio de género**; sus decisiones mandan sobre la base. Si el modelo
falla, se corta por tiempo o no responde, la base ya está hecha. No hay reglas fijas de ningún género: el worship es un perfil más.

| Pieza | Archivo |
|---|---|
| Perfiles como datos, validación, elección | `shared/src/music/perfiles-mezcla.ts` |
| Plan puro (ganancias, HPF, paneo, balance espectral, secciones) | `shared/src/music/automezcla.ts` |
| Aplicación con comandos reales, idempotencia, reversión, medición con tope | `plugins/com.jaswave.modulo.asistente-ia/src/motor/turno/automezcla-banda.ts` |
| Perfiles del productor (carpeta del asistente) | `.../turno/perfiles-mezcla-usuario.ts` |
| Enganche en la producción | `ai-harness/src/agente/produccion.ts` (`mezclaInicial`, evento `mezcla_inicial`) y `turno-banda.ts` |
| Máster mínimo con el objetivo del perfil | `.../turno/master-minimo.ts` |

### 2.1 Perfiles por estilo (`PERFILES_MEZCLA`)

Worship moderno, pop, rock, balada, jazz y electrónica. Cada perfil define: nivel relativo por rol (bombo, batería, bajo, piano, guitarra,
cuerdas, pad, lead, voz), pasa-altos y recorte (300 Hz) por rol, realce de presencia, paneo por rol y anchura, envío de reverb por rol y nivel
del bus, objetivo de balance espectral (graves máx., medios+presencia mín.), curva por sección (verso/coro/puente/…), objetivo de máster
(LUFS y techo dBTP), RMS de la suma y cresta típica. Criterio de los números (rangos típicos del género; punto de partida, no dogma):

| Perfil | Graves máx. | Medios mín. | Coro − verso | Máster | Carácter |
|---|---|---|---|---|---|
| worship-moderno | 45 % | 25 % | 3 dB | −14 LUFS / −1 dBTP | base sobria, pads y cuerdas abrazan, voz al frente |
| pop | 42 % | 28 % | 4 dB | −14 / −1 | voz y batería adelante, acompañamiento compacto |
| rock | 45 % | 30 % | 4 dB | −12 / −1 | batería y guitarras al frente y abiertas, poca reverb |
| balada | 42 % | 30 % | 5 dB | −16 / −1 | piano o guitarra y voz, ritmo discreto, mucha reverb |
| jazz | 50 % | 28 % | 1 dB | −16 / −1 | natural, casi sin filtros, dinámica conservada |
| electrónica | 55 % | 18 % | 4 dB | −9 / −1 | bombo y bajo potentes, anchura 1,3, poca dinámica |

Worship: bombo y bajo no deben acumular más del 45 % de la energía en graves y medios+presencia debe superar el 25 % (de lo medido en el proyecto real).

### 2.2 Selección del perfil (`elegirPerfilMezcla`)

1. **Productor**: ajuste `jaswave-banda-perfil-mezcla` (id o nombre; `fijarPerfilDelProductor`) o `ConfigProduccion.estilo`.
2. **Hoja de ruta**: el planificador emite `estilo` en `hoja_de_ruta` (campo nuevo de `HojaDeRuta`; la herramienta lo pide en su descripción).
3. **Último recurso**: palabras del pedido.
4. Respaldo: worship moderno, indicado en el resumen («no se pudo determinar el estilo»).

El resumen y el encargo del modelo dicen qué perfil se usó y por qué.

### 2.3 Perfiles propios del productor

Documento Markdown en la carpeta del asistente (`%APPDATA%\JasWave\asistente\habilidades\mezcla-perfil-<id>.md`) con un bloque ```json. Solo
hacen falta `id`, `nombre` y lo que cambie; `base` indica de qué perfil de serie hereda (por defecto worship). Se valida (`validarPerfilMezcla`,
errores en español: rol desconocido, rangos, `objetivoEspectral`, `master`, `seccion`). Un perfil propio con el mismo nombre que uno de serie
lo sustituye. Aparece en Ajustes → IA → Habilidades (donde se edita); `plantillaPerfilUsuario(base, id, nombre)` genera una copia editable y
`guardarPerfilUsuario` la valida y guarda. Los perfiles con errores no se cargan y se avisan en el resumen.
Límite: no hay todavía un selector propio en la UI; el perfil activo se fija con `fijarPerfilDelProductor` (localStorage).

### 2.4 Reglas del plan (`planificarAutomezcla`)

1. **Ganancia por rol**: RMS por pista = RMS objetivo de la suma + nivel relativo normalizado − nivel del stem a fader 0 dB (mediciones POST-FADER,
   así que aplicar dos veces da lo mismo). Sin medición: RMS típico por rol. Suma ≈ −18 dBFS RMS (según perfil), pico estimado < −3 dBFS (cresta medida
   o del perfil, más el máximo de las secciones); si no cabe, se baja todo. Fader máximo +2,9 dB.
2. **Filtros**: pasa-altos por rol (bajo y bombo no se tocan), campana de −1 a −3 dB a 300 Hz, presencia de +1 a +2,5 dB a 3,5 kHz si la mezcla medida
   es sorda (o no hay medición). Slots fijos de `mix.eq` (1 = HPF, 2 = recorte, 3 = presencia): repetirlo no apila bandas.
3. **Paneo y reverb**: paneo del perfil por la anchura, alternando lados en roles repetidos; un bus «Reverb corta» (`bus.create` + `plugin.insert` de
   JasWave Ambience) y `send.set` por pista; sin reverb cargada no se crean envíos (no se suma señal seca).
4. **Balance espectral**: se predice el reparto por bandas de la suma. Si los graves pasan del objetivo se baja el cimiento (hasta 4 dB); si aún no
   cumple, EQ ancho en el máster (menos de ±3 dB: pasa-altos a 28 Hz si hay mucho sub, estante bajo, campana a 1,8 kHz, estante alto). Si no se
   cumple, se avisa («Aviso: …») en lugar de fingirlo.
5. **Dinámica por sección**: `automation.setCurve parametro:"volumen"` por pista a partir de la hoja de ruta (valor absoluto; los roles rítmicos siguen
   la mitad). No se pisa la automatización de volumen del usuario ni se tocan pistas silenciadas.

Idempotencia: el plan sale en valores absolutos y `MemoriaAutomezcla` recuerda la firma de las pistas y cada banda/curva/envío aplicados, así que repetir
no cambia nada. Reversión: `revertirAutomezcla` devuelve fader y paneo, quita bandas, curvas y envíos; además todo va por comandos con undo.

## 3. Enganche en la producción

- Justo antes de la etapa de mezcla del modelo («mezcla inicial», evento `mezcla_inicial` y línea en el resumen). Se aplica también sin participante de mezcla.
- El modelo de mezcla recibe: perfil, niveles, objetivo espectral, balance medido y resumen; se le dice que su criterio de estilo manda y que puede
  modificar o deshacer. **Tope de 6 pasos** (`PASOS_AFINAR_MEZCLA`).
- Máster mínimo (plan Q; −14 LUFS y −1 dBTP, o el objetivo del perfil) tras el tope de tiempo y ahora también si el modelo de máster no termina.

## 4. Medición

- Una sola `analysis.mix` (stems y suma) con **tope de 60 s** (`MAX_MS_MEDICION_AUTOMEZCLA`); si falla o tarda más, valores por rol y aviso. La medición
  sigue en segundo plano y el render queda en la caché de `analysis-render` (misma revisión y faders), de modo que `medirBanda` posterior no repite un
  render idéntico. Caché propia del medidor por huella del proyecto.
- **Medir stems sin renderizar el proyecto completo** requeriría: (1) render por pista en el host nativo (bounce solo de esa pista y su cadena, en
  paralelo y con tope por pista); (2) caché por pista con su propia huella (notas del clip, instrumento, cadena de plugins y fader), para re-medir solo la
  pista que cambió; (3) estimar el espectro de la suma sumando potencias de los stems en vez de renderizar la suma; (4) cancelar el render al vencer el tope.

## 5. Revisión de partes del QA (recorte)

- Tope de **40 peticiones por ronda** (`maxPeticionesRondaQA`; revisión y corrección; los músicos que corrigen se reparten el tope con mínimo 4 pasos
  cada uno). Agotado, el agente se corta sin llamar al modelo y queda anotado.
- Lecturas del QA ya hechas (misma herramienta y argumentos) no se repiten mientras nadie escriba (`lecturasUnicas`).
- Si la medición determinista ya da problemas concretos en las partes, el modelo no vuelve a juzgar (`qaSoloMedicion`). Si todo está limpio ya se omitía
  (`qaPartesLimpias`).
- Palancas en `ahorro` (`qaSoloMedicion`, `topeRondaQA`, `lecturasUnicas`); `ahorro: false` las apaga.

## 6. Pruebas

- `shared/src/test/automezcla.test.ts` (28): ganancias, HPF, paneo, reverb, EQ de máster < ±3 dB, curvas de sección (coro − verso = 3 dB), pico < −3 dBFS,
  sin medición, determinismo; pasada sorda sintética (≈ 80 % de graves) → graves < 45 % y medios > 25 % en worship; los seis perfiles producen mezclas
  distintas y coherentes, cambiar de perfil cambia el balance, elección productor > hoja > pedido > respaldo, validación del perfil del productor.
- `ai-harness/src/test/agente-automezcla.test.ts` (10): orden mezcla inicial → modelo, estilo de la hoja, guion de perfil en el encargo, tope de pasos,
  fallo del enganche, sin participante de mezcla, máster mínimo si cae el modelo de máster, QA sin modelo con medición concreta, tope de peticiones por
  ronda, lecturas únicas.
- `plugins/com.jaswave.modulo.asistente-ia/test/automezcla-banda.test.ts` (10): tienda real; volumen, paneo, curvas, bus y envíos; idempotencia; sin
  medición (tope de tiempo); medición que falla; respeto de pistas silenciadas y de la automatización del usuario; reversión; el perfil cambia el
  resultado; máster mínimo con el objetivo del perfil; plantilla de perfil propio.

## 7. Qué validar con una pasada real

1. Pedido de worship (y otro de rock o jazz): en el resumen «Mezcla inicial (sin modelo)», el perfil elegido y el motivo.
2. Render de 40 s y `node analizar-audio.cjs mezcla.wav`: pico < −3 dBFS antes del máster; −1 dBTP y −14 LUFS (o el objetivo del perfil) después; graves
   < 45 % y medios+presencia > 25 %; centroide muy por encima de 212 Hz; RMS por segundo con el coro ≈ 3 dB sobre el verso; correlación L/R < 0,9.
3. Que `mix.eq accion:"ajustar" banda:N` cargue JasWave EQ en cada pista y que JasWave Ambience se cargue en el bus (si no, no hay envíos y el resumen lo dice).
4. Que el modelo de mezcla ajuste algo con criterio de estilo (sin deshacer a ciegas) y termine en 6 pasos o menos.
5. Peticiones y tiempo de `qa_musicos` (objetivo: unas 40 por ronda).
