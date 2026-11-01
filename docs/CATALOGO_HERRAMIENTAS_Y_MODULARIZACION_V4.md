# JasWave DAW — Catálogo Oficial de Herramientas del Agente, Estado Real y Modularización (V4)

> **Documento:** Inventario Técnico de Herramientas, Estatus Operativo y Arquitectura de Micro-Núcleo  
> **Versión:** 4.0  
> **Fecha:** Octubre 2026  
> **Módulos:** `@jaswave/shared`, `@jaswave/ai-harness`, `jas-wave`, `native/plugin-host`  

---

## 1. Visión de Modularización Universal (Arquitectura Microkernel)

Para lograr un instalador base ultra-ligero (< 45 MB), JasWave separa el **Núcleo de Ejecución Inmutable (Core Kernel)** de los **Módulos Dinámicos (Plugins Instalables On-Demand)**:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     JASWAVE CORE KERNEL (Instalador Base < 45 MB)                │
├─────────────────────────────────────────────────────────────────────────────────┤
│ • CommandExecutor & Pila Unificada de Undo/Redo                                 │
│ • EventBus Central y Validador de Invariantes de Estado                         │
│ • Motor de Audio en Tiempo Real C++ (WASAPI/ASIO) y Clock de Transporte         │
│ • Watchdog de Estabilidad, Cuarentena y Confinamiento de Rutas (Path Grants)    │
│ • Plugin Loader dinámico (Validador de manifiestos jaswave-plugin.json)         │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Carga Dinámica en Caliente
       ┌─────────────────────────────────┼─────────────────────────────────┐
       ▼                                 ▼                                 ▼
[ DSP / AUDIO PLUGINS ]       [ AGENT TOOLKITS / SKILLS ]       [ UI EXTENSIONS ]
 native/plugin-host (C++)      ai-harness/workers (JS/Wasm)      Renderer (React Microfrontends)
 • EQ Paramétrico              • Worship Modern Toolkit          • Visualizador Espectral 3D
 • Compresor de Bus            • Trap 808 Sculptor Toolkit       • Editor de Partituras
 • True-Peak Limiter           • Algoritmo de Strumming          • Consola SSL Virtual
```

---

## 2. Inventario Completo de Herramientas del Agente IA y Estatus Real

A continuación se detalla la totalidad de herramientas registradas en el sistema, su rol asociado, estado de verificación, clase de riesgo y su encapsulación como módulo desacoplable:

### 2.1. Dominio de Planificación y Proyecto
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `plan.get` | Director, QA | `read` | ✅ **Operativo** | Obtiene el contenido de `plan.md` parseado con estados de tareas. | `@jaswave/core-planning` |
| `plan.status` | Director, QA | `read` | ✅ **Operativo** | Devuelve el porcentaje de avance y pasos bloqueantes pendientes. | `@jaswave/core-planning` |
| `plan.updateStep`| Director | `write` | ✅ **Operativo** | Marca pasos como hechos, pendientes o fallidos de forma transaccional. | `@jaswave/core-planning` |
| `plan.addStep` | Director | `write` | ✅ **Operativo** | Inserta nuevos pasos en el plan ante replanificaciones. | `@jaswave/core-planning` |
| `project.getSummary` | Todos | `read` | ✅ **Operativo** | Radiografía completa: pistas, tempo, compás, plugins cargados y duración. | **Core Kernel** |
| `project.setBpm` | Productor | `write` | ✅ **Operativo** | Ajusta el tempo del proyecto con recálculo de compases y rejilla. | **Core Kernel** |
| `project.setTimeSig` | Productor | `write` | ✅ **Operativo** | Modifica la signatura de compás (4/4, 3/4, 6/8). | **Core Kernel** |
| `project.save` | Director | `system` | ✅ **Operativo** | Persiste el proyecto en disco con backup `.bak` atómico. | **Core Kernel** |
| `project.new` | Director | `system` | ✅ **Operativo** | Reinicializa el estado con confirmación de cambios pendientes. | **Core Kernel** |
| `daw.wipeProject` | Director | `destructive`| ✅ **Operativo** | Limpieza total del proyecto con confirmación obligatoria. | **Core Kernel** |

---

### 2.2. Dominio Musical y Generación MIDI
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `midi.notes.get` | Productor, QA | `read` | ✅ **Operativo** | Lee las notas (pitch, inicio, duración, velocidad) de un clip. | `@jaswave/plugin-midi-engine` |
| `midi.notes.set` | Productor | `write` | ✅ **Operativo** | Reemplaza o asigna notas completas a un clip con deshacer. | `@jaswave/plugin-midi-engine` |
| `midi.notes.patch`| Productor | `write` | ✅ **Operativo** | Modifica quirúrgicamente notas individuales sin tocar el resto. | `@jaswave/plugin-midi-engine` |
| `midi.clip.create`| Productor | `write` | ✅ **Operativo** | Crea un nuevo clip MIDI en la pista especificada. | `@jaswave/plugin-midi-engine` |
| `midi.quantize` | Productor | `write` | ✅ **Operativo** | Cuantiza el timing de notas a una rejilla (1/4, 1/8, 1/16) con fuerza configurable. | `@jaswave/plugin-midi-engine` |
| `midi.humanize` | Productor | `write` | ✅ **Operativo** | Aplica micro-variaciones aleatorias reproducibles de timing y velocidad. | `@jaswave/plugin-midi-engine` |
| **`midi.strum`** | Productor | `write` | ✅ **Operativo** *(Nuevo)* | **Rasgueo orgánico de acordes** con micro-offset por cuerda y decaimiento. | `@jaswave/plugin-humanizer-pro` |
| `midi.transpose` | Productor | `write` | ✅ **Operativo** | Transpone semitonos manteniendo la integridad de escalas. | `@jaswave/plugin-midi-engine` |
| `midi.constrainScale` | Productor | `write` | ✅ **Operativo** | Forza las notas a encajar en una escala modal/tonal elegida. | `@jaswave/plugin-theory-pack` |
| `midi.applyGroove`| Productor | `write` | ✅ **Operativo** | Aplica plantillas de swing y groove rítmico. | `@jaswave/plugin-humanizer-pro` |
| `daw.musicBuild` | Productor | `write` | ✅ **Operativo** | Procedimiento macro de construcción musical de secciones. | `@jaswave/plugin-music-builder` |

---

### 2.3. Dominio de Pistas, Ruteo y Mezclador
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `track.list` | Todos | `read` | ✅ **Operativo** | Lista todas las pistas, tipos (audio/midi/instrumento) y colores. | **Core Kernel** |
| `track.create` | Productor | `write` | ✅ **Operativo** | Crea pistas con nombre, tipo y color con límite de invariantes. | **Core Kernel** |
| `track.delete` | Productor | `destructive`| ✅ **Operativo** | Elimina una pista y sus clips dependientes bajo confirmación. | **Core Kernel** |
| `track.update` | Mezcla, Prod | `write` | ✅ **Operativo** | Modifica volumen, paneo o nombre de la pista con undo transaccional. | **Core Kernel** |
| `track.toggleMute`| Mezcla, Prod | `write` | ✅ **Operativo** | Conmuta el estado de silencio (Mute). | **Core Kernel** |
| `track.toggleSolo`| Mezcla, Prod | `write` | ✅ **Operativo** | Conmuta el estado de Solo en el bus de mezcla. | **Core Kernel** |
| `bus.create` | Mezcla | `write` | ✅ **Operativo** | Crea buses auxiliares (stems, reverbs, delays). | `@jaswave/plugin-routing-pro` |
| `send.set` | Mezcla | `write` | ✅ **Operativo** | Establece el nivel de envío de una pista hacia un bus auxiliar. | `@jaswave/plugin-routing-pro` |
| `sidechain.connect`| Mezcla | `write` | ✅ **Operativo** | Configura ruteo de compresión sidechain (ej. Bombo $\rightarrow$ Bajo). | `@jaswave/plugin-routing-pro` |
| `clip.gain` | Mezcla | `write` | 🔄 **En desarrollo** | Ajusta la ganancia estática en dB previa al fader del canal. | `@jaswave/plugin-routing-pro` |

---

### 2.4. Dominio de Plugins, Procesadores y Valores Físicos
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `plugin.lookup` | Productor, Mix | `read` | ✅ **Operativo** | Busca plugins instalados por nombre o rol semántico. | **Core Kernel** (Host OOP) |
| `plugin.insert` | Productor, Mix | `write` | ✅ **Operativo** | Inserta un VST en el slot de canal con verificación de compatibilidad. | **Core Kernel** (Host OOP) |
| `plugin.remove` | Productor, Mix | `destructive`| ✅ **Operativo** | Retira un procesador liberando recursos en el proceso C++. | **Core Kernel** (Host OOP) |
| `plugin.setParameter` | Mezcla, Mast | `write` | ✅ **Operativo** | Fija parámetros con soporte de **valores físicos (`parsePhysicalValue`)**. | **Core Kernel** (Host OOP) |
| `plugin.listParameters` | Mezcla, Mast | `read` | ✅ **Operativo** | Extrae metadatos de parámetros nativos (IDs, rangos, unidades). | **Core Kernel** (Host OOP) |
| `plugin.searchParameters`| Mezcla, Mast | `read` | ✅ **Operativo** | Búsqueda difusa de parámetros mediante etiquetas semánticas (`intel`). | `@jaswave/plugin-intel-pack` |
| **`mix.eq`** | Mezcla | `write` | 🔄 **En desarrollo** | Inserta/ajusta EQ paramétrico con bandas `{freq, gain, Q, type}`. | `@jaswave/plugin-jaswave-fx` |
| **`mix.compress`** | Mezcla | `write` | 🔄 **En desarrollo** | Ajusta compresión con umbral en dB, ratio, ataque y relajación en ms. | `@jaswave/plugin-jaswave-fx` |
| **`mix.limit`** | Mastering | `write` | 🔄 **En desarrollo** | Configura limitador True-Peak fijando techo (Ceiling) y ganancia. | `@jaswave/plugin-jaswave-fx` |

---

### 2.5. Dominio de Medición y Diagnóstico DSP Acústico
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `analysis.loudness`| Mastering, QA | `read` | ✅ **Operativo** | Medición BS.1770: LUFS integrado, Short-term, Momentary y True-Peak. | `@jaswave/plugin-dsp-analyzer` |
| `analysis.spectrum`| Mezcla, QA | `read` | ✅ **Operativo** | Densidad de potencia espectral Welch en 31 bandas de 1/3 octava. | `@jaswave/plugin-dsp-analyzer` |
| `analysis.stereo` | Mezcla, QA | `read` | ✅ **Operativo** | Correlación de fase (-1 a +1), ancho estéreo y pérdida en mono. | `@jaswave/plugin-dsp-analyzer` |
| `analysis.masking` | Mezcla, QA | `read` | ✅ **Operativo** | Matriz de colisión frecuencial entre pares de pistas. | `@jaswave/plugin-dsp-analyzer` |
| `analysis.diagnose`| Mezcla, QA | `read` | ✅ **Operativo** | Diagnóstico experto: detección de barro, aspereza, falta de sub y fatiga. | `@jaswave/plugin-dsp-analyzer` |
| `analysis.track` | Mezcla, QA | `read` | ✅ **Operativo** | Extracción y análisis de audio PCM stem por stem. | `@jaswave/plugin-dsp-analyzer` |
| `analysis.reference`| Mastering, QA | `read` | ✅ **Operativo** | Comparación acústica contra una pista de referencia comercial. | `@jaswave/plugin-dsp-analyzer` |
| `reference.toggleAB`| Mezcla, Mast | `write` | ✅ **Operativo** | Conmutación instantánea A/B con igualación automática de sonoridad. | `@jaswave/plugin-dsp-analyzer` |
| `daw.masterPass` | Mastering | `write` | ⏳ **Pendiente (A7e)**| Procedimiento autónomo de mezcla por stem y mastering iterativo. | `@jaswave/plugin-masterpass` |

---

### 2.6. Dominio de Auditoría, Verificación y Seguridad
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `audit.project` | QA, Director | `read` | ✅ **Operativo** | Auditoría estructural de integridad y balance del proyecto. | `@jaswave/core-audit` |
| `audit.mix` | QA, Mezcla | `read` | ✅ **Operativo** | Evaluación de headroom, balance L/R y cumplimiento de estándares. | `@jaswave/core-audit` |
| `audit.step` | QA | `read` | ✅ **Operativo** | Verificación técnica de los criterios específicos del paso del plan. | `@jaswave/core-audit` |
| **`qa.verdict`** | QA | `read` | ✅ **Operativo** *(Nuevo)* | **Veredicto vinculante:** Aprobado o Rechazado con reporte de fallos. | `@jaswave/core-audit` |
| `session.summary` | Director | `read` | ✅ **Operativo** | Resumen ejecutivo del turno de trabajo sin sobrecargar el contexto. | `@jaswave/core-audit` |

---

### 2.7. Dominio de Workspace, Sistema de Archivos y Terminal (V4 - A10)
| Herramienta | Rol Asignado | Clase | Estatus Real | Funcionalidad | Paquete / Módulo Desacoplado |
|---|---|---|---|---|---|
| `fs.createDirectory`| Director | `write` | 📐 **Especificado** | Crea carpetas anidadas (`mkdir -p`) dentro de la raíz del proyecto. | `@jaswave/plugin-workspace-ide` |
| `fs.writeFile` | Director, Prod | `write` | 📐 **Especificado** | Crea o sobrescribe archivos (código, scripts, markdown, JSON). | `@jaswave/plugin-workspace-ide` |
| `fs.readFile` | Todos | `read` | 📐 **Especificado** | Lee el contenido en texto plano de cualquier archivo del workspace. | `@jaswave/plugin-workspace-ide` |
| `fs.createScaffold` | Director | `write` | 📐 **Especificado** | Genera la arquitectura completa de carpetas según el género musical. | `@jaswave/plugin-workspace-ide` |
| `terminal.execute` | Director, QA | `system` | 📐 **Especificado** | Ejecuta comandos en la terminal integrada con retorno de salida. | `@jaswave/plugin-workspace-ide` |

---

## 3. Plan de Empaquetado y Distribución Modular

### 3.1. Estándar de Manifiesto `jaswave-plugin.json`
Cada módulo fuera del instalador base incluye su descriptor de capacidades:

```json
{
  "id": "com.jaswave.plugin.dsp-analyzer",
  "name": "Suite de Análisis Acústico DSP Pro",
  "version": "1.0.0",
  "category": "audio-analysis",
  "sizeMb": 4.2,
  "entrypoints": {
    "node": "dist/index.js",
    "aiTools": "dist/tools.json",
    "uiPanel": "dist/ui-component.js"
  },
  "permissions": {
    "realtimePcmRead": true,
    "fileSystem": "read-project-audio",
    "commands": ["analysis.*", "audit.mix"]
  },
  "rolesAllowed": ["mezcla", "mastering", "qa"],
  "signature": "SHA256:7f8a9b2c..."
}
```

### 3.2. Ciclo de Vida: Descarga, Activación y Lazy Loading
1. **Instalador Base Reducido:** El usuario descarga el ejecutable de JasWave conteniendo únicamente el **Core Kernel**, el motor C++ y la interfaz básica.
2. **Descarga en Caliente (*Plugin Store / On-Demand*):**
   * Al abrir un proyecto de *Worship*, el gestor detecta que se requiere `@jaswave/plugin-humanizer-pro` (para el rasgueo `strumNotes`) y lo descarga en segundo plano desde el CDN oficial en milisegundos.
3. **Carga en Memoria Perezosa (*Lazy Loading*):**
   * Los pesos y el código de las herramientas de *Mastering* no ocupan un solo byte de RAM hasta que el Director del equipo agéntico asigna un paso que invoca formalmente a ese especialista.
4. **Desconexión Limpia y Cuarentena:**
   * Si un plugin de terceros o una herramienta agéntica lanza una excepción crítica, el *Lifecycle Watchdog* lo desactiva en caliente, restituye el fader a estado seguro y previene la caída del proceso principal de audio.
