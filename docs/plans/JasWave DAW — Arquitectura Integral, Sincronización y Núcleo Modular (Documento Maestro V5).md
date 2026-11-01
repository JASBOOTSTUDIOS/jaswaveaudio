# **JasWave DAW — Arquitectura Integral, Sincronización Multi-Usuario y Núcleo Modular (Documento Maestro V5)**

**Estado:** Documento Maestro de Arquitectura y Especificación de Ingeniería  
**Versión:** 5.0 (Definición Integral)  
**Ámbitos:** Desktop (Electron \+ C++), Web Client, Backend Sincronizado (Node.js \+ Supabase), Sistema Modular de Plugins y Empaquetado

# **1\. Visión General del Sistema y Filosofía Arquitectural**

JasWave es una Estación de Trabajo de Audio Digital (DAW) de grado profesional concebida bajo el paradigma "AI-First" y arquitectura abierta en red. El sistema unifica la producción de audio tradicional (edición MIDI, pistas de audio, mezcla por buses, automatizaciones, hosting de plugins VST3/VST2 y motor nativo de baja latencia) con un equipo de agentes de IA coordinados y colaboración multi-usuario en tiempo real.

## **Principios Fundamentales**

1. **El Estado de Dominio como Fuente Única de Verdad:** Tanto el usuario local como colaboradores remotos y agentes de IA operan exclusivamente mediante transacciones atómicas tipadas despachadas a través de `CommandExecutor` (`@jaswave/shared`).  
2. **Arquitectura de Micro-Núcleo (Microkernel Core):** El núcleo del DAW se restringe a la gestión de estado, transporte de audio, bus de eventos y sandboxing. Toda funcionalidad adicional (DSP, agentes, visualizadores, utilidades) opera como plugin modular.  
3. **Continuidad Web-Desktop Híbrida:** Edición inmediata y ágil en navegador con handover fluido y continuo hacia el runtime nativo de escritorio para renderizado pesado, hosting VST3 y hardware ASIO/WASAPI exclusivo.

# **2\. Arquitectura de Micro-Núcleo y Sistema Universal de Plugins**

## **2.1. Desacoplamiento Núcleo vs. Plugins**

El núcleo se mantiene minimalista, ligero (menos de 50 MB en paquete base) y estable:

* **Core Kernel:**  
  * Despachador de Comandos y Pila Transaccional con Undo/Redo particionado por usuario.  
  * Pipeline de Transporte y Enrutamiento PCM de baja latencia en C++ (WASAPI/ASIO nativo).  
  * Bus Central de Eventos y Gestión de Ciclo de Vida de Procesos Aislados.  
  * Validador de Invariantes de Dominio (`@jaswave/shared`).  
* **Categorías de Plugins Modulares:**  
  1. **DSP & Instruments:** Plugins VST3, VST2 encapsulados y efectos nativos compilados en C++.  
  2. **AI Agent Skills & Toolsets:** Habilidades analíticas y generativas de los agentes (Director, Productor, Mezcla, Mastering, QA) ejecutadas en Workers aislados.  
  3. **UI Extensions & Visualizers:** Módulos de interfaz (analizadores espectrales Welch, editores microtonales, vistas personalizadas de tiras de canal) integrados mediante Webpack Module Federation o carga dinámica de módulos ES.  
  4. **Import/Export & Hardware Bridges:** Drivers para controladores MIDI externos, protocolos OSC y conversores de proyecto.

## **2.2. Manifiesto Universal de Plugins (jaswave-plugin.json)**

Cada módulo se describe mediante un contrato estandarizado:{

  "id": "com.jaswave.module.sample-suite",

  "name": "JasWave Sample & Synth Suite",

  "version": "1.2.0",

  "category": "instrument-bundle",

  "targetPlatforms": \["win-x64", "web"\],

  "entrypoints": {

    "dspDesktop": "bin/synth.vst3",

    "dspWeb": "dist/web-synth-worklet.js",

    "aiSkill": "dist/agent-skills.js",

    "ui": "dist/ui-module.js"

  },

  "permissions": {

    "realtimeAudio": true,

    "fileSystem": "read-project-stems",

    "network": false,

    "commands": \["plugin.setParameter", "midi.insertClip"\]

  },

  "rolesAllowed": \["producer", "mix"\],

  "checksum": "SHA256:4a8b9c..."

}

## **2.3. Registro Dinámico de Herramientas Agénticas**

* En lugar de firmas estáticas en `@jaswave/ai-harness`, el `AgentToolRegistry` descubre herramientas en runtime según los plugins activos en la sesión.  
* Los System Prompts de los agentes de IA se reensamblan dinámicamente inyectando las tool definitions autorizadas según `action-policy.ts`.

## **2.4. Aislamiento, Seguridad y Cuarentena**

* **Aislamiento Out-of-Process:** El host C++ (`native/plugin-host/`) aloja los binarios VST de forma independiente. Fallos de segmentación o desbordamientos de búfer en plugins de terceros no afectan al proceso de Electron ni detienen la sesión.  
* **Watchdog de Estabilidad:** Si un plugin satura el hilo de procesamiento o genera excepciones recurrentes, se marca en cuarentena preventiva automática (`plugin-host-lifecycle.ts`).

# **3\. Topología Multiplataforma: Desktop (Electron) vs. Web Client**

## **3.1. Matriz Comparativa de Capacidades**

| Característica | Desktop Client (Electron \+ C++) | Web Client (Navegador) |
| :---- | :---- | :---- |
| **Motor de Audio** | Nativo C++ WASAPI / ASIO exclusivo (Latencia menor a 5 ms) | Web Audio API \+ AudioWorklet (Latencia estándar de navegador) |
| **Hosting VST3 / DLL** | Soporte total Out-of-Process con guardas de estabilidad | No soportado (Sandbox de seguridad web) |
| **Sintetizadores & FX** | Binarios nativos \+ JasWave Roles \+ VST3 de terceros | JasWave WebSynth (WebAudio), Soundfonts, Fallback Stems |
| **Edición MIDI** | Piano Roll acelerado Canvas 2D completo | Piano Roll idéntico en Canvas 2D \+ Web MIDI API |
| **Automatización** | Curvas completas de volumen, paneo, envíos y VST | Curvas completas sincronizadas por comandos atómicos |
| **Renderizado & Stems** | Exportación offline multipista de alta resolución | Preescucha en tiempo real y solicitud de renderizado remoto |
| **Instalación** | Instalador base ultra-ligero con descarga bajo demanda | Cero instalación (Acceso instantáneo vía URL) |

## **3.2. Estrategia de Fallback en Web y Gestión de Plugins Heterogéneos**

1. **Preescucha Ligera (WebSynth & Soundfonts):** Si una pista usa un plugin VST3 pesado inexistente en web, el navegador mapea las notas MIDI a un sintetizador WebAudio interno o soundfont compatible.  
2. **Stem Freezing Dinámico:** El cliente de escritorio o un worker headless genera un bounce PCM del stem procesado y lo transfiere a Supabase Storage. El cliente web reproduce el stem congelado manteniendo la visualización de notas MIDI interactiva.  
3. **Desacoplamiento Operativo:** El usuario en la web puede modificar notas, acordes y automatizaciones sin requerir el binario del plugin; los cambios se reflejan en el cliente de escritorio, que recalcula el audio nativo de inmediato.

# **4\. Handover Transparente entre Web y Desktop**

El flujo de trabajo permite comenzar en cualquier dispositivo y transferir la sesión a la estación de trabajo dedicada:

1. **Edición Web Inicial:** El usuario realiza bocetos de arreglos, edición MIDI y selección armónica en el navegador.  
2. **Detección de Requerimientos Nativos:** Al requerir VST3 dedicados, hardware ASIO o renderizado multipista completo, la interfaz presenta la opción "Abrir en JasWave Desktop".  
3. **Deep Linking Seguro:** La invocación despacha un enlace personalizado con token criptográfico temporal para asociar la sesión sin solicitar re-autenticación.  
4. **Instalador Inteligente / Lanzador:** Si el cliente de escritorio no está instalado, se descarga el paquete base ultra-compacto. Si ya existe, la aplicación se abre en foco inmediatamente.  
5. **Descarga Selectiva en Runtime:** El cliente de escritorio descarga únicamente los paquetes de plugins específicos solicitados por el proyecto y se suscribe al WebSocket de la sala, sincronizando los deltas de estado en tiempo real.

# **5\. Arquitectura de Sincronización Multi-Usuario y Supabase Auth**

## **5.1. Autenticación y Seguridad WebSocket**

* **Identidad con Supabase Auth:** Inicio de sesión vía correo/contraseña o proveedores OAuth2 (Google/GitHub). Emisión de JWT asimétrico (duración estándar 1 h) con claims de usuario y roles.  
* **Handshake WebSocket Seguro:**  
  * Verificación del token JWT en el protocolo de enlace mediante clave pública JWKS de Supabase. Conexiones sin token o expiradas son terminadas con código 4001\.  
  * Soporte de renovación de token transparente sin desconexión del socket durante la sesión de producción.  
* **Control de Acceso Basado en Roles (RBAC):**  
  * Roles de `owner` y `editor`: Capacidad de emitir comandos de mutación MIDI, automatización, creación y eliminación de pistas.  
  * Rol `viewer`: Acceso de solo lectura al árbol de estado y presencia.

## **5.2. Protocolo de Canales y Reconciliación de Estado**

* **Canales Multiplexados:**  
  * Canal de estado (`session:state`): Comandos atómicos secuenciados por números monótonos y Vector Clocks para resolución determinista de conflictos en concurrent edits.  
  * Canal de presencia (`session:presence`): Posición de transporte, selección activa, compases en loop y telemetría de cursores en tiempo real.  
  * Canal de chat e IA (`session:chat-ai`): Turnos de conversación con el equipo multi-agente y edición colaborativa del archivo maestro `plan.md`.  
* **Deshacer/Rehacer Particionado (Per-User Scopes):** La pila de Undo/Redo distingue los identificadores de comando por usuario. Un usuario puede deshacer sus últimas modificaciones sin revertir las notas grabadas por otro colaborador o por el Productor IA.

# **6\. Proceso de Despliegue, Instalador Ligero y Descarga Modular**

## **6.1. Paquete Base Mínimo (Zero-Bloat Core)**

* Tamaño inicial comprimido: Menor a 40 MB.  
* Contenido exclusivo del instalador base:  
  * Runtime de Electron optimizado.  
  * Proceso principal de Electron, bus IPC y motor de autenticación.  
  * Paquete `@jaswave/shared` y motor de renderizado de UI básica.  
  * Host nativo en C++ (`plugin-host`) y driver PCM WASAPI.

## **6.2. Gestor de Descarga en Tiempo de Ejecución (On-Demand Package Fetcher)**

* Al abrir o clonar un proyecto:  
  1. El DAW inspecciona la sección de dependencias y requerimientos de plugins del proyecto.  
  2. Consulta el inventario local en caché.  
  3. Si faltan módulos (herramientas de mezcla, modelos específicos de agentes, instrumentos adicionales), activa una descarga en segundo plano con interfaz no bloqueante.  
  4. Los módulos descargados se cargan en caliente en el runtime correspondiente sin necesidad de reiniciar la aplicación ni interrumpir la reproducción activa de audio.

# **7\. Hoja de Ruta de Implementación Técnica (Workstreams V5)**

| ID | Módulo | Alcance y Objetivos Técnicos | Prioridad |
| :---- | :---- | :---- | :---- |
| **K1** | Microkernel Core Refactor | Aislar `@jaswave/shared` y el host nativo C++ de dependencias estáticas de plugins. | Crítica |
| **P1** | Universal Plugin Spec & Loader | Parser de `jaswave-plugin.json`, verificación criptográfica y cargador de workers. | Crítica |
| **P2** | Dynamic Tool Registry for AI | Inyección reactiva de tools en los agentes de `@jaswave/ai-harness` según plugins activos. | Alta |
| **W1** | Web Client Foundation | Arrangement y Piano Roll en navegador con Canvas 2D y motor Web MIDI API. | Alta |
| **W2** | Fallback & WebSynth Bridge | Sintetizador sustractivo/FM ligero en WebAudio para preescucha de pistas VST. | Media |
| **H1** | Deep Link Handover Protocol | Esquema URI y exportación de sesión para transición web a desktop. | Media |
| **S1** | Supabase Auth & WS Server | Servidor de sincronización con validación JWT, heartbeats y reconexión automática. | Crítica |
| **S2** | CRDT / Vector Clock Engine | Reconciliación determinista de comandos concurrentes en notas MIDI y faders de mezcla. | Alta |
| **D1** | Lightweight Installer & CDN | Empaquetador mínimo (\<40 MB) y sistema de entrega de extensiones modular vía CDN. | Alta |

# **8\. Criterios de Aceptación y Certificación de Calidad**

1. **Aislamiento de Fallas:** El cierre abrupto o crash de un plugin VST3 o módulo JS de IA no debe interrumpir el buffer de reproducción de audio ni corromper el árbol de comandos.  
2. **Determinismo Colaborativo:** Pruebas automatizadas con múltiples clientes concurrentes emitiendo mutaciones simultáneas en el mismo compás deben converger a un estado idéntico.  
3. **Experiencia de Handover:** La transición de un proyecto abierto en navegador al cliente de escritorio debe restaurar cursor, selección y reproducción en menos de 3 segundos tras la apertura.

