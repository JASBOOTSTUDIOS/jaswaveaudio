# M — Biblioteca de grooves MIDI por estilos

> Estado: **fases 1–5 hechas en código y tests** (29-10-2026); fase 6 (otros DAW) solo documentada; **administración desde la app y
> sincronización por internet hechas en código y tests** (secciones 4b y 4c, 29-10-2026), sin probar contra el servidor real ni e2e.
> No se ha ejecutado e2e, ni build, ni despliegue (hay una prueba con la app en curso). **Sin oír**: los patrones se
> validaron por estructura y lectura, no por oído; falta escucharlos con el kit real en el DAW.

## 1. Qué es y para qué

La batería (Worship Drums) viene con una biblioteca de ritmos MIDI organizada por estilos, estilo MT Power Drum Kit, y el
usuario puede añadir los suyos. Los grooves son archivos `.mid` normales (arrastrables a cualquier DAW) con metadatos opcionales.
Se distribuyen con la app/plugins: 136 grooves originales CC0 en `plugins/grooves/estilos/`.

## 2. Formato y carpeta

`%APPDATA%\JasWave\grooves\<Estilo>\[<Subestilo>\]*.mid` (`JASWAVE_GROOVES_DIR` la sustituye). Hasta 2 niveles de carpeta
(estilo y subestilo). Los archivos y carpetas que empiezan por «.» no se indexan.

Metadatos (todos opcionales), de menor a mayor prioridad:

1. **Inferidos** del `.mid` y la ruta: tempo (primer meta 0x51), compás (0x58), `compases` = duración de las notas / duración del
   compás, estilo = 1.ª carpeta, subestilo = 2.ª, nombre = archivo sin número inicial ni guiones, `tipo` por palabras del
   nombre (`fill|relleno`, `intro`, `outro|final|ending`, `trans|transicion`).
2. **`groove.json` de la carpeta**: valores por defecto de sus `.mid` y, opcionalmente, `archivos: { "x.mid": {...} }`.
   `id`, `nombre`, `origen` y `revision` **no** se heredan de la carpeta (solo del archivo), para que un `.mid` que el usuario
   deje en una carpeta del catálogo siga siendo suyo.
3. **Sidecar `<nombre>.json`** junto al `.mid`.

Campos: `id`, `nombre`, `estilo`, `subestilo`, `tempo` (20–400), `compas` (`"4/4"`, `"6/8"`, `"12/8"` o `{numerador,denominador}`),
`compases`, `tipo` (`groove|fill|intro|outro|transicion`), `etiquetas[]` (slug), `intensidad` 1–5, `autor`, `licencia`, `origen`
(`usuario|catalogo`), `revision`. Todo se valida y normaliza en `shared/src/grooves/indice.ts` (`fusionarMetadatos`).

Notas: mapa GM de Worship Drums — bombo 35/36, caja 38, cross-stick 37, palmas 39, toms 41–50, hi-hat 42/44/46, crashes
49/57, ride 51, campana de ride 53, pandereta 54, cencerro 56, shaker 70. Posiciones en beats (negras), 480 PPQ, canal 10.

## 3. Arquitectura

| Capa | Archivo | Qué hace |
|---|---|---|
| Lógica pura | `shared/src/grooves/{tipos,indice,desde-smf}.ts` (tests: `shared/src/test/grooves.test.ts`) | Metadatos, inferencia, filtros, árbol de estilos, `construirNotasDeGroove`, `aplicarDiferencias`. Sin disco. |
| Disco (main) | `jas-wave/electron/grooves-service.ts`, `grooves-midi.ts` (+ test) | Raíz, siembra, indexado con caché (mtime+tamaño), vigilancia (`fs.watch`, 350 ms), importar, papelera (`shell.trashItem`), favoritos, estilos. Devuelve datos **crudos**; no importa `shared/` (el main se compila aparte). |
| IPC | `electron/main.ts` (`grooves-*`), `electron/preload.ts` (`window.electron.grooves`) | Todas las rutas son relativas a la raíz y se validan (sin `..`, sin absolutas, nombres Windows reservados). Los archivos de disco a importar pasan por `pathGrants.isBinaryReadAllowed`. La raíz se concede `readwrite`. |
| Cliente | `jas-wave/src/lib/grooves/cliente.ts`, `previsualizador.ts` | Convierte lo crudo en `EntradaGroove` (con `shared`), lee notas (`leerSmf`), inserta, vista previa en bucle. |
| UI | `jas-wave/components/grooves-panel.tsx` | Herramienta `grooves` (icono Drum en la barra lateral = entrada del menú de ventanas). |
| IA | `agent-action-catalog.ts`, `ai-daw-agent.ts`, `ai-harness/src/agent/action-policy.ts` | `groove.listar` (read), `groove.insertar` (write). |
| Habilidad | `asistente-ia/src/motor/habilidades-agentes.ts` → `bateria-biblioteca-de-grooves` | Cuándo usar la biblioteca y cuándo escribir a mano. |
| Contenido | `plugins/grooves/tools/generar_grooves.mjs` → `plugins/grooves/estilos/`, `catalogo.json`, `LICENCIA.txt` | Generador reproducible (`--verificar` comprueba que lo versionado coincide). |

### Decisiones

- **Inserción = `midi.clip.create`** (comando existente con undo y auditoría); no se añadió un comando nuevo a `shared/src/commands`.
  «Adaptar compás» ejecuta antes `project.setTimeSignature` (otro paso de undo).
- **El tempo del proyecto manda**: las notas se guardan en beats. «Escalar al tempo» (opcional, apagado) mantiene la duración
  real del groove en segundos (`beats × tempoProyecto / tempoGroove`).
- **Vista previa** con `routeMidiToTrack(..., { ignoreMute, ignorarZonas })`, el mismo camino del piano roll; no crea pistas ni
  mueve el transporte. Al ritmo del bpm del proyecto, en bucle, sin notas colgadas al parar.
- **Siembra**: copia solo lo que no existe y no fue ya instalado (consultando `.sync.json`); si el usuario borra un groove de
  serie, no vuelve. Fusiona `groove.json` sin pisar entradas existentes. Empaquetado: `extraResources` → `resources/grooves/`.
- **Borrar** = papelera del sistema; sin papelera disponible el borrado falla (nunca definitivo).
- **IA**: `groove.insertar` acepta `grooveId` o criterios (`estilo`, `tipo`, `compas`, `etiquetas`, `intensidadMin`, `texto`),
  `pistaId`, `inicioBeat`, `compases` (largo del clip), `variacion: "ligera"`, `fill` (`true` = fill del mismo estilo/compás, o id)
  y `escalarAlTempo`/`adaptarCompas`. Atención: `compas` filtra ("6/8"), `compases` es el largo.

### Contenido de serie (136 grooves)

Worship 35 (4-4: versos con cross-stick/ride/campana, pre-coro, coros, puente con crescendo, medio tiempo, pandereta, palmas,
intros, finales, transiciones; 6-8: versos, coros, puente, oración, intro, final), Pop 9, Rock 10, Pop-Rock 5, Indie 5, Balada 5
(incluye 3/4), Shuffle-Blues 6, Jazz 6 (swing con ride, escobillas, vals 3/4), Funk 6, Soul 4, Reggae 3, Latin 7 (bossa, samba,
cascara, cumbia, dembow), Afrobeat 4, Hip-Hop 4, Electronica 5, Metal 6, Country 4, Gospel 5, 12-8 7. Grooves de 1, 2 o 4 compases
y fills de 1 compás; velocidades y micro-tiempos humanizados con semilla por nombre, ghost notes, variaciones entre compases.
Todo original (CC0): patrones escritos en el generador, nada copiado de librerías comerciales.

## 4. Contrato para sincronización

Pensado para que la fase siguiente (backend + panel admin + cliente de sincronización) lo use **tal cual**.

**Metadatos por groove** (en `groove.json` → `archivos[<archivo>]` o sidecar; ya los escribe el generador):

```json
{ "id": "jw-worship-4-4-coro-pleno", "nombre": "Coro pleno", "tempo": 76, "compas": "4/4", "compases": 4,
  "tipo": "groove", "etiquetas": ["coro","pleno"], "intensidad": 4,
  "origen": "catalogo", "revision": 1, "autor": "JasWave", "licencia": "CC0-1.0" }
```

- `id`: estable, slug (`[a-z0-9-]`), **distinto de la ruta**; el catálogo usa `jw-<estilo>[-<sub>]-<nombre>`. Sin id explícito, los
  grooves del usuario reciben `usr-<12 primeros hex del SHA-256>`.
- `origen`: `usuario` (por defecto) o `catalogo`. `revision`: entero ≥ 1 que el servidor sube al cambiar el contenido.
- `sha256`: hash hex del `.mid`; lo calcula el servicio al indexar (`EntradaGroove.sha256`), no se escribe a mano.

**`.sync.json`** en la raíz de la carpeta de grooves (lo escribe la siembra; la sincronización lo mantiene):

```json
{ "version": 1, "catalogoRevision": 3,
  "grooves": [ { "id": "jw-pop-pop-clasico", "ruta": "Pop/pop-clasico.mid", "sha256": "…64 hex…", "revision": 1 } ] }
```

Solo contiene lo que vino del catálogo. **Regla**: una sincronización solo puede actualizar o quitar archivos listados aquí;
nunca toca nada de origen `usuario`. Si una ruta del catálogo ya está ocupada por un archivo del usuario, se desvía a
`<nombre>-catalogo.mid`. El usuario puede borrar un groove del catálogo (queda en `.sync.json`: la siembra no lo repone; la
sincronización decide si lo vuelve a bajar).

**`aplicarDiferencias(indiceLocal, indiceRemoto, { rutasOcupadas? })`** (`shared/src/grooves/indice.ts`, pura, con tests):
devuelve `{ descargar, actualizar: [{anterior, nuevo}], borrar, sinCambios }`. Compara por `id`: nuevo en remoto → descargar;
`revision` mayor, `sha256` o `ruta` distintos → actualizar; solo local → borrar. Helpers: `aEntradasSync(lista)`,
`normalizarArchivoSync(json)`. El índice remoto usa el mismo `EntradaSync` (`{id, ruta, sha256, revision}`); `plugins/grooves/catalogo.json`
es un ejemplo exacto (más `version`, `total`).

Esto ya está implementado: ver «4b. Administración y sincronización». Al aplicar se valida la ruta remota (`rutaRemotaValida` + `ServicioGrooves.resolver`: no se confía en el servidor) y los borrados van a la papelera.

## 4b. Administración y sincronización

El administrador publica grooves desde **JasWave Admin** (secciones «Grooves» y «Propuestas de grooves») y las apps de los
usuarios los reciben solas por internet; el plugin de batería los ve porque lee la misma carpeta.

### Esquema (Prisma, migraciones `20261029190000_grooves` y `20261029200000_grooves_propuestas`)

- `GrooveCatalogo`: `id` (slug estable, `jw-<estilo>-<nombre>`), `ruta` (única, `Estilo[/Sub]/archivo.mid`), `estilo`, `nombre`, `tipo`, `compas`,
  `tempo`, `compases`, `intensidad`, `etiquetas[]`, `autor`, `licencia`, `revision` (sube con cada cambio), `sha256`, `tamano`,
  `contenido` (bytes del .mid), `activo`, fechas.
- `GrooveCatalogoEstado` (fila única): **revisión global** del catálogo; sube con cada alta, cambio, retirada o borrado.
- `PropuestaGroove`: ver sección 4c.

### Rutas

Usuario autenticado (`backend/src/grooves/rutas.ts`, `rutasGrooves`):

| Ruta | Qué hace |
|---|---|
| `GET /grooves/indice[?desde=<revisión>]` | `{revision, total, grooves:[{id, ruta, estilo, nombre, tipo, compas, tempo, compases, intensidad, etiquetas, autor, licencia, revision, sha256, tamano}]}` solo de los `activo`. Con `desde` igual a la revisión actual responde **304** sin cuerpo. |
| `GET /grooves/:id/archivo` | Los bytes del .mid (`audio/midi`, cabecera `X-Groove-Sha256`). 404 si está retirado. |
| `GET /grooves/consentimiento` | Versión y texto de consentimiento vigentes. |
| `POST /grooves/propuestas`, `GET /grooves/propuestas/mias` | Ver 4c. |

Administrador (`/admin/grooves`, mismo patrón que `rutasAdminIA`: `exigirAutenticacion` + `exigirAdmin`):
`GET /` (todo, con revisión global) · `POST /` (alta: JSON con `base64` y metadatos) · `POST /lote` (varios .mid con
`carpeta`=estilo, o `zip` en base64 con `Estilo/[Sub/]archivo.mid`; `reemplazar` actualiza los que ya existen; los errores de un
archivo no frenan a los demás) · `PUT /:id` (metadatos, nombre y/o estilo = renombrar o mover; sube `revision`) · `PUT /:id/archivo`
(reemplaza el .mid, recalcula `sha256`, sube `revision`) · `PUT /:id/activo` (retirar/publicar) · `DELETE /:id` ·
`POST /estilos/renombrar` (todo un estilo) · `GET /:id/archivo` (también retirados, para la vista previa). Cada cambio se registra
con `auditar` (`groove.crear|editar|mover|reemplazar|activar|desactivar|borrar|estilo.renombrar|propuesta.*`).

### Seguridad y validación (zod, `backend/src/grooves/validacion.ts`, `midi.ts`, `zip.ts`)

- .mid: máx. 256 KB, cabecera `MThd` válida (longitud 6, formato 0–2, resolución en pulsos por negra), pistas bien formadas y al menos una nota.
- Nombres y estilos: 1–2 niveles; sin `..`, separadores, `:*?"<>|`, control, bidireccionales ni de ancho cero, nombres reservados de Windows
  ni puntos al inicio/final. Etiquetas slug, tempo 20–400, compás `n/d`, intensidad 1–5. Esquemas `strict` (campos desconocidos = 400).
- Límites: 3000 grooves, 600 por estilo, 400 por lote, zip ≤ 12 MB (≤ 48 MB descomprimido, contra bombas zip), sin zips cifrados.
- Solo administradores pueden escribir; los usuarios solo leen lo `activo`. El cliente **no confía** en el servidor: valida id, ruta, tamaño y SHA-256.

### Flujo de sincronización (`jas-wave/electron/grooves-sync.ts`)

1. Dispara el renderer (`src/lib/grooves/sync-auto.ts`, montado en `App.tsx`): al iniciar sesión, al volver la conexión (`online`) y cada 6 h
   (`INTERVALO_SYNC_MS`); si falla reintenta con espera creciente (30 s, 1 min, 2 min… tope 30 min). Corre en segundo plano, nunca bloquea.
   Respeta el interruptor «Actualizar grooves automáticamente».
2. El main pide el índice con `?desde=<catalogoRevision de .sync.json>` (304 = al día), compara con `.sync.json` (`diferenciasSync`, igual a
   `aplicarDiferencias` de shared; un test lo comprueba) y descarga solo lo nuevo o cambiado, 4 a la vez.
3. Cada archivo se verifica (tamaño y SHA-256) antes de escribirse (a `.tmp`, nueva comprobación del hash y renombrado atómico) junto con su
   sidecar `<nombre>.json` (`origen: catalogo`, `id`, `revision`…). Lo retirado va a la papelera.
4. **Solo toca lo de origen `catalogo`** (lo listado en `.sync.json`). Los del usuario nunca; si el catálogo trae una ruta ya ocupada por uno del
   usuario, se baja como `<nombre>-catalogo.mid`. Si el usuario editó a mano uno del catálogo y el catálogo lo cambia o lo retira, su copia se
   conserva como suya (`origen: usuario`, id `usr-<12 hex>`) y se avisa. Si el usuario borró uno del catálogo, no se resucita.
5. `catalogoRevision` solo se anota si todo salió bien (si algo falló se reintenta). Sin conexión o con sesión caducada devuelve un resultado y
   no toca nada. Una sola sincronización a la vez.
6. Eventos al renderer: `grooves-sync-inicio|progreso|fin` (`window.electron.grooves.onSync`). IPC: `syncAhora`, `syncEstado`, `syncAjustes`,
   `proponer`. Estado local en `.sync-estado.json` (último resultado, novedades, ajustes). El panel Grooves muestra el interruptor, «Sincronizar
   ahora», la última sincronización y las novedades.

### Cómo siembra el administrador el catálogo inicial

```bash
cd backend
npm run grooves:sembrar -- --simular      # prueba sin escribir
npm run grooves:sembrar                   # importa los 136 MIDI de plugins/grooves/estilos con sus ids y metadatos
npm run grooves:sembrar -- --reemplazar   # además actualiza los que cambiaron (sube su revisión)
```

(`backend/scripts/sembrar-grooves.ts`; usa `catalogo.json` y `groove.json`, así las apps que ya traen los de serie los reconocen y no los bajan otra vez.)

## 4c. Propuestas de usuarios y similitud

### Privacidad y consentimiento (obligatorio)

Nada sale del equipo sin permiso. En el panel Grooves: interruptor «Compartir mis grooves con JasWave para mejorar el catálogo» (**apagado por
defecto**) con el texto «Al compartirlo, autorizas a JasWave a incluirlo en el catálogo bajo licencia CC0», y un botón «Proponer al catálogo» por
groove propio. Solo se proponen grooves del usuario (nunca los del catálogo). Antes de enviar, la app compara por contenido con su biblioteca y
avisa si hay uno igual (no deja enviar) o parecido (porcentaje); lo ya propuesto no se reenvía (`propuestos` en `.sync-estado.json`). El servidor
exige `consentimiento: {aceptado: true, version}`, rechaza versiones del texto desconocidas y guarda en la propuesta la versión y la fecha aceptadas
(`consentimientoVersion`, `consentimientoEn`). La licencia de lo propuesto se fija en CC0-1.0. Versión actual del texto: `2026-10-29`.

### Huella y similitud (`shared/src/grooves/similitud.ts`, copia idéntica en `backend/src/grooves/similitud.ts`, un test lo verifica)

- **Normalización** independiente del tempo y del formato: 7 familias de pieza (bombo, caja/cross-stick/palmas, hi-hat, ride/campana, platos,
  toms, percusión) según el mapa GM; cuadrícula por compás de semicorcheas (4 pasos por negra) o de tresillos de semicorchea (6 por negra) en
  compases compuestos (6/8, 9/8, 12/8); velocidad en 3 niveles (<50, 50–89, ≥90). Micro-tiempos y humanización se absorben al cuantizar.
- **Huella exacta**: hash de la matriz binaria (sin velocidades) reducida a su periodo mínimo; igual huella = mismo patrón (otro tempo, otras
  velocidades o repetido varias veces dan lo mismo) → puntuación 100.
- **Puntuación 0–100**: por compás, Jaccard ponderado de golpes por pieza (bombo y caja 3; hi-hat y ride 1,5; platos y toms 1; percusión 0,75) 90 % +
  perfil de velocidades 10 %; se prueban todas las alineaciones de compás (repitiendo el patrón menor hasta igualar la longitud) y desplazamientos de
  −2…+2 tiempos con 4 % de penalización por tiempo; el total mezcla 88 % coincidencia + 12 % densidad y resta hasta 10 % por diferencia de longitud.
  Compases o cuadrícula distintos (6/8 frente a 4/4): solo densidad y longitud, tope 50. Solo la huella idéntica llega a 100.
- **Umbrales** (`UMBRALES_SIMILITUD`, configurables): ≥ 98 % «duplicado», ≥ 85 % «muy similar», ≥ 70 % «similar».
- **Rendimiento**: `buscarSimilares` prefiltra por huella, cuadrícula y densidad; 1 propuesta contra 2.000 grooves tarda ~decenas de ms (test < 1 s).
- Tests (`shared/src/test/grooves-similitud.test.ts`): mismo groove con otro tempo y velocidades, con un fill añadido, con ghost notes, desplazado un
  tiempo, groove distinto del mismo estilo, 6/8 frente a 4/4, JSON y rendimiento.

### Backend (`backend/src/grooves/propuestas.ts`)

- `PropuestaGroove`: usuario(s), `contenido` .mid, metadatos, `huella` + `huellaHash`, `estado` (`pendiente|aprobada|rechazada|duplicada`),
  `vecesPropuesto`, `similares` (`[{tipo: groove|propuesta, id, nombre, puntuacion, nivel}]`, hasta 8 con ≥ 70 %), `notaAdmin`, `grooveId`, consentimiento.
- **Duplicado exacto**: si la huella ya existe en otra propuesta no se abre otra revisión: se suma el usuario y el contador `vecesPropuesto`. Si es
  idéntico a un groove del catálogo, la propuesta entra directamente como `duplicada`.
- `similares` se calcula al recibirla y se **recalcula** (con retraso de 3 s para agrupar cambios) cuando cambia el catálogo (`POST /admin/grooves/propuestas/recalcular` lo fuerza).
- Límites: 40 pendientes por usuario y 30 por día; .mid ≤ 256 KB.
- Usuario: `POST /grooves/propuestas`, `GET /grooves/propuestas/mias` (estado y nota si se rechazó).
- Admin: `GET /admin/grooves/propuestas?estado=&vista=unicas|con-similares|todas` (con `grupos` de propuestas casi idénticas entre sí, ≥ 85 %),
  `GET .../:id/archivo`, `GET .../:id/comparar?tipo=groove|propuesta&con=<id>` (ambas huellas + puntuación), `POST .../:id/aprobar`
  (`{cambios?, varianteDe?, nota?}`: crea el groove del catálogo con licencia CC0; como variante añade la etiqueta `variante` y hereda estilo),
  `POST .../:id/rechazar`, `POST .../:id/marcar-duplicada`.

### Panel de administración (`jas-wave/src/admin-app/secciones/`)

- **Grooves** (`grooves.tsx`): lista por estilo con búsqueda, subir uno o varios .mid o un zip (con resultado por archivo), editar metadatos, reemplazar
  archivo, retirar/publicar, borrar, renombrar estilo, vista previa sonora (sintetizador simple WebAudio, `grooves/previa-midi.ts`; el kit real solo
  suena en el DAW) y versión del catálogo. No hay contador de usuarios sincronizados (el servidor no lo registra; pendiente si se quiere).
- **Propuestas de grooves** (`grooves-propuestas.tsx`): tarjetas con nombre, estilo, autor, fecha, veces propuesto, mini-rejilla rítmica
  (`grooves/rejilla.tsx`), los más parecidos con su porcentaje, vista lado a lado con diferencias resaltadas (cian coincide, ámbar solo propuesta,
  violeta solo el otro), escuchar y botones Aprobar / Aprobar como variante / Rechazar / Marcar duplicada.

## 5. Fase 2 (solo diseño): usar la biblioteca desde otros DAW

Objetivo: dentro del editor de Worship Drums (VST3 en Cubase, Reaper, FL…) un explorador de grooves y poder **arrastrar un
.mid al DAW anfitrión** (pista MIDI).

- **Datos**: el plugin lee la misma carpeta (`%APPDATA%\JasWave\grooves`, mismo `JASWAVE_GROOVES_DIR`) en un hilo no de audio,
  con un lector C++ de `groove.json`/sidecar y un resumen del SMF (tempo, compás, compases). Mismo orden de prioridad de
  metadatos que `fusionarMetadatos`; ignorar `.sync.json` salvo para mostrar el origen. Alternativa más barata: que la app deje un
  `indice.json` (ya calculado) en la raíz y el plugin solo lo lea; si no existe, escaneo propio.
- **Explorador en el editor**: árbol de estilos + búsqueda + filtros (compás, tipo, intensidad) y vista previa tocando el propio
  motor del plugin desde un hilo de preview (cola de eventos al sampler, nunca bloquear el hilo de audio). Reutilizar la capa de
  UI de `shared-ui` (listas con scroll, campos de texto).
- **Arrastrar al DAW**: arrastre nativo de archivo (Windows: `IDataObject` con `CF_HDROP` mediante `DoDragDrop`; en VST3 con
  `IPlugView` se inicia desde la ventana del editor). Se arrastra el `.mid` de la biblioteca tal cual o, si hay opciones
  (repetir N compases, fill final), una copia temporal en `%TEMP%\JasWave\drag\` generada con el escritor SMF. Compatibilidad
  de anfitriones variable (Cubase/Reaper/Studio One aceptan; FL y Ableton, según versión): ofrecer también «Mostrar en carpeta».
- **Qué falta**: lector SMF + JSON en C++ (hay `nlohmann`? comprobar `shared-dsp`), hilo de preview, widget de lista en
  `shared-ui`, el `DoDragDrop`, tests con `host_test.cpp`, y coordinar con quien toque el editor del plugin (L2). Licencias:
  los grooves de serie son CC0; los del usuario no se redistribuyen.

## 6. Verificación hecha

- `shared`: `npm run typecheck`, `npm test` (834 tests; 13 nuevos de grooves).
- `ai-harness`: typecheck + 312 tests (1 nuevo de política).
- `jas-wave`: `tsc -b --noEmit`, `tsc -p tsconfig.electron.json --noEmit`, `tsx --test electron/grooves-service.test.ts
  src/lib/grooves/previsualizador.test.ts src/lib/plugin/plugin-ui-acciones.test.ts` (17 pasan).
- Módulo asistente: typecheck + `npm test` (128 pasan).
- `node plugins/grooves/tools/generar_grooves.mjs --verificar` → 0 diferencias.

- Administración y sincronización: backend `npx vitest run test/grooves.test.ts` (19; en total 104 con el resto), `npm run typecheck` y `npm run lint` limpios; migraciones aplicadas en la base local (`prisma migrate deploy` + `generate`); `npm run grooves:sembrar -- --simular` lee los 136 sin errores (no se escribió nada). `shared`: `grooves-similitud.test.ts` (10). `jas-wave`: `tsx --test electron/grooves-sync.test.ts src/lib/grooves/sync-programador.test.ts src/admin-app/**/*.test.ts`, `tsc -b --noEmit`, `tsc -p tsconfig.electron.json --noEmit` y eslint de lo nuevo.

## 7. Notas de traspaso

- **Pendiente (admin y sync)**: sembrar el catálogo real (`npm run grooves:sembrar`) y desplegar la migración; probar de punta a punta con la app (sincronizar, retirar, editar uno local, proponer con y sin permiso); aviso visible en el panel cuando se conserva una copia del usuario (hoy sale en «novedades»); contador de usuarios sincronizados (no existe); persistir el intervalo de 6 h como ajuste de usuario (hoy es la constante `INTERVALO_SYNC_MS`); la vista previa del admin usa un sintetizador simple, no el kit real.
- **Pendiente**: probar el panel en la app real (arrastre al arreglo, vista previa con el kit, importar por diálogo y soltando
  archivos, vigilancia al copiar a mano en la carpeta); escuchar los 136 patrones y retocar los que suenen «cuadrados»
  (editar `plugins/grooves/tools/generar_grooves.mjs`, subir `REVISION` de los que cambien y regenerar); e2e del panel.
- **Avisos**: la raíz se concede `readwrite` a `pathGrants` al crear el servicio; el árbol de estilos admite 2 niveles; límite
  2 MB por `.mid` y 5000 archivos. `finally` de la siembra silencia la vigilancia para no avisar al renderer por cada copia.
- **No se tocó**: `plugins/com.jaswave.plugin.worship-drums/`, `plugins/samples/`, `ai-harness/src/agente/runtime.ts`,
  `agent-tool-runner.ts`, `catalogo-agente.ts`.
- **Archivos nuevos**: `shared/src/grooves/*`, `shared/src/test/grooves.test.ts`, `jas-wave/electron/grooves-{service,midi}.ts` y
  `grooves-service.test.ts`, `jas-wave/src/lib/grooves/*`, `jas-wave/components/grooves-panel.tsx`,
  `ai-harness/src/test/grooves-politica.test.ts`, `plugins/grooves/**`. **Editados**: `shared/src/index.ts`, `electron/main.ts`,
  `preload.ts`, `electron-builder.cjs`, `workspace/types.ts`, `icon-rail.tsx`, `tool-host.tsx`, `ArrangementView.tsx` (soltar
  groove en la pista), `agent-action-catalog.ts`, `ai-daw-agent.ts`, `action-policy.ts`, `harness.ts` (lectura), `habilidades-agentes.ts`.
- Pasar `groove.json`/sidecar con `tempo` fuera de 20–400 cae a 100 bpm (valor por defecto) y no se avisa; si molesta, avisar en el panel.
