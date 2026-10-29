# Requerimientos de Alojamiento e Infraestructura del Ecosistema JasWave
*(Considerando la Arquitectura del Motor de Audio, VST3 y Servicios Cloud)*

> **Propósito del Documento:**  
> Especificar formalmente la topología de despliegue, infraestructura requerida, restricciones de latencia y dimensionamiento de servidores para el ecosistema **JasWave DAW**, explicando en detalle **por qué y cómo se distribuye el sistema entre el cliente local (Edge) y la nube**, tomando como eje central las exigencias críticas de procesamiento en tiempo real del **Motor de Audio**.

---

## 1. Resumen Ejecutivo: La Paradoja del Audio en Tiempo Real y la Solución Híbrida

Un DAW profesional (Digital Audio Workstation) **no puede alojarse íntegramente en la nube** como si fuera una aplicación web convencional (tipo CRUD o SaaS administrativo). El motivo radica en la **física acústica y la latencia de red**:

1. **La barrera de la latencia en tiempo real:**  
   Para que un músico o productor pueda tocar un teclado MIDI o grabar voz sin percibir desfase (retraso), la latencia total de ida y vuelta (*round-trip latency*) debe situarse **por debajo de 10 a 15 milisegundos**.
2. **Latencia de Internet (RTT):**  
   Una conexión a internet promedio presenta un *ping* (Round Trip Time) de entre 25 ms y 120 ms, sumado a fluctuaciones (*jitter*) y pérdidas de paquetes. Si el motor de audio residiera en un servidor remoto, la monitorización en vivo y la respuesta al pulsar teclas sufrirían un retardo inaceptable y cortes continuos de sonido (*buffer underruns*).
3. **Acceso directo al Hardware:**  
   El motor de audio necesita dialogar directamente con la interfaz física conectada por USB/Thunderbolt (controladores **ASIO** en Windows, **CoreAudio** en macOS, **Oboe/AAudio** en Android) y los dispositivos MIDI físicos.

### La Solución Arquitectónica: Modelo Híbrido "Local-First Edge + Cloud Services"

El ecosistema JasWave divide estrictamente sus componentes en dos mundos interconectados:

```mermaid
graph TB
    subgraph CLIENTE_LOCAL ["1. CLIENTE LOCAL / EDGE (Host del Motor de Audio Realtime)"]
        UI_DESKTOP["JasWave GUI (Electron / React 19)"]
        AUDIO_ENGINE["Motor de Audio C++ (miniaudio / WASAPI / ASIO)"]
        VST_HOST["Plugin Host Nativo C++ (Instancias VST3)"]
        LOCAL_AI["Ollama LLM (Llama 3 8B / Qwen Local)"]
        HARDWARE_IO["Interfaz de Audio (USB/ASIO) + Teclado MIDI"]
        
        UI_DESKTOP <-->|N-API / Named Pipe| AUDIO_ENGINE
        AUDIO_ENGINE <-->|C++ In-Process / IPC| VST_HOST
        AUDIO_ENGINE <--> HARDWARE_IO
        UI_DESKTOP <-->|HTTP Localhost 11434| LOCAL_AI
    end

    subgraph CLOUD_SERVICES ["2. INFRAESTRUCTURA CLOUD (Alojamiento y Servicios Centralizados)"]
        PORTAL_PWA["Portal Web & Catálogo PWA<br/>(Vercel / Cloudflare Pages)"]
        BACKEND_API["Backend Express / Node.js<br/>(Render / Fly.io / VPS)"]
        AUTH_DB["Base de Datos & Auth<br/>(Supabase PostgreSQL)"]
        STORAGE_BIN["Almacén de Binarios & Plugins<br/>(GitHub Releases / Cloudflare R2)"]
        CLOUD_AI["AI Gateway Remoto (Opcional)<br/>(OpenAI / Claude / vLLM)"]
        CLOUD_WORKER["Headless Audio Worker (Opcional)<br/>(Bouncing & Stem Separation)"]
        
        PORTAL_PWA <--> BACKEND_API
        BACKEND_API <--> AUTH_DB
        BACKEND_API <--> STORAGE_BIN
        CLOUD_WORKER <--> AUTH_DB
    end

    CLIENTE_LOCAL <-->|REST / Ed25519 Device Sync| BACKEND_API
    CLIENTE_LOCAL <-->|Descarga de Plugins .jwx| STORAGE_BIN
    CLIENTE_LOCAL <-->|OAuth 2.0 PKCE / Backup| AUTH_DB
```

---

## 2. Requerimientos Detallados del Motor de Audio

El motor de audio de JasWave cuenta con tres implementaciones según el entorno de despliegue:

### 2.1 Motor de Audio Nativo Real-Time (Windows Desktop / USB Portable) — *Alojamiento Local Obligatorio*

Este es el motor de grado profesional de JasWave (`native/audio-engine` y `native/plugin-host`).

* **Ubicación:** Se ejecuta exclusivamente en la máquina física del usuario (PC con Windows 10/11 x64, laptop o versión USB Portable).
* **Drivers Soportados:** **ASIO** (latencia ultra-baja <5 ms), **WASAPI Exclusive** (latencia baja <10 ms), WASAPI Shared (estándar Windows), DirectSound / WinMM (compatibilidad).
* **Restricciones Críticas del Audio Thread (C++):**
  - **Cero bloqueos:** Prohibido el uso de mutexes bloqueantes, I/O de disco o sockets de red en el hilo de procesamiento.
  - **Cero asignaciones dinámicas:** Toda la memoria para buffers de audio y tablas de mezcla se preasigna en la inicialización (*memory pools*).
  - **Aislamiento de la IA:** El LLM o los agentes nunca tocan ni esperan por el hilo de audio; interactúan mediante snapshots atómicos en el hilo de control.
* **Requisitos del Hardware Local del Usuario:**
  - **Procesador (CPU):** Mínimo 4 núcleos x64 con soporte de instrucciones **AVX2 y FMA3** (Intel Core i5 8ª gen o AMD Ryzen 2000 en adelante).
  - **Memoria RAM:** Mínimo 8 GB (Recomendado 16 GB DDR4/DDR5 para proyectos multi-pista con instrumentos virtuales pesados).
  - **Almacenamiento Local:** Disco SSD NVMe o SATA III (o pendrive USB 3.0/3.2 con velocidad de lectura sostenida > 120 MB/s en el caso del modo portable).
  - **Interfaz de Audio:** Tarjeta de sonido con controlador ASIO nativo o interfaz USB Class-Compliant.

### 2.2 Motor de Audio Web / PWA (Browser Fallback) — *Alojamiento en CDN Web*

Para usuarios que acceden desde el navegador en el Portal Web (`jaswave.vercel.app` o PWA) sin instalar la aplicación de escritorio:

* **Ubicación:** Se aloja en el CDN web y se ejecuta en el navegador del cliente mediante la **Web Audio API** y **AudioWorklet (WebAssembly/WASM)**.
* **Capacidades:**
  - Reproducción de clips de audio y loops en formato WAV/MP3.
  - Sintetizador básico por software (Soft Pad / Piano synth en WebAssembly).
  - Cadena básica de ecualización y compresión mediante nodos Web Audio nativos.
* **Limitaciones:**
  - **No puede ejecutar plugins VST3 nativos** (los archivos `.vst3` son bibliotecas dinámicas C++ `.dll` de Windows y no pueden ejecutarse dentro del sandbox de seguridad del navegador).
  - Latencia mayor (entre 20 ms y 45 ms) condicionada por el compositor de audio de Chromium/Edge/Firefox.

### 2.3 Motor de Audio Headless en la Nube (Cloud Worker) — *Alojamiento en Servidores Cloud*

Existen tareas de audio que **no requieren tiempo real** y que aportan un enorme valor al alojarse en servidores cloud potentes:

* **Casos de Uso en Nube:**
  1. **Offline Project Bounce / Renderizado:** Generación de archivos finales WAV/FLAC/MP3 a alta resolución a partir del archivo de proyecto JSON (`.jwp`) sin consumir la CPU de la computadora del usuario.
  2. **Separación de Stems con Inteligencia Artificial:** Modelos como Demucs o Spleeter para separar voz, batería, bajo e instrumentos desde un archivo subido.
  3. **Masterización Automática Cloud:** Análisis y ajuste de LUFS integrado EBU R128 (-14 LUFS para Spotify/Apple Music, True-Peak Limiter a 8x/16x).
* **Requisitos del Servidor Cloud para Headless Audio Worker:**
  - **Tipo de Instancia:** Compute-Optimized (Optimizada para cómputo) o GPU-Accelerated (para modelos neuronales de audio).
  - **CPU:** Mínimo 4 vCPUs dedicadas (3.0 GHz+ sostenidos, con AVX-512 para DSP acelerado).
  - **RAM:** Mínimo 8 GB (16 GB para separación de pistas largas de más de 5 minutos).
  - **GPU (Opcional, requerida solo si ejecuta IA de Stems):** NVIDIA T4, L4 o A10G (8 GB a 16 GB VRAM) con soporte CUDA 12+.
  - **Disco:** Almacenamiento rápido NVMe o `/dev/shm` (RAM disk temporal) para procesar archivos PCM en memoria sin degradar el disco físico.

---

## 3. Matriz Completa de Alojamiento por Componente del Sistema

La siguiente tabla resume exactamente **dónde debe ir alojada cada pieza del proyecto JasWave**, qué tecnologías utiliza y cuáles son las plataformas proveedoras recomendadas:

| Componente | Qué Ejecuta | Dónde se Aloja | Proveedores Recomendados | Requisitos de Servidor / Entorno |
|---|---|---|---|---|
| **1. Motor de Audio Realtime & VST Host** | C++ DSP, WASAPI, ASIO, Carga de plugins VST3 nativos | **Cliente Local (Edge)** | Instalador Windows / USB Portable / Android | CPU x64 con AVX2, RAM ≥ 8 GB, Audio Interface ASIO/WASAPI |
| **2. Portal Web & Catálogo PWA** | Interfaz visual, landing de plugins, showcase, login | **Cloud (Front CDN)** | **Vercel** / Cloudflare Pages / AWS Amplify | Jamstack / Edge Network, HTTPS, TLS 1.3, compresión Brotli/Gzip |
| **3. Backend API & Licenciamiento** | Express, validación de licencias Ed25519, sync WebSocket, REST | **Cloud (PaaS / VPS)** | **Render** / Fly.io / Railway / Hetzner Cloud | Node.js 20+, 1-2 vCPU, 1-2 GB RAM, soporte WebSockets persistentes |
| **4. Base de Datos & Autenticación** | PostgreSQL, Supabase Auth, políticas RLS, registro de licencias | **Cloud (BaaS)** | **Supabase** (Managed PostgreSQL) | PostgreSQL 15+, Transaction Pooler (puerto 6543), conexión directa (5432) |
| **5. Distribución de Binarios (.jwx / VST3)** | Paquetes firmados de plugins VST3, instaladores `.exe`, samples | **Cloud (Storage / CDN)** | **GitHub Releases** / Cloudflare R2 / AWS S3 | Alta tasa de transferencia de descarga, CDN global sin costos abusivos de egress |
| **6. Respaldo de Proyectos de Usuario** | Almacenamiento de archivos `.jwp`, tomas de audio, stems | **Cloud Storage del Usuario** | **Google Drive API (PKCE)** / Supabase Storage | Cuota del usuario mediante token OAuth (alcance estricto `drive.file`) |
| **7. Proveedor de Inteligencia Artificial (LLM)** | Asistente de producción musical, lectura de estado del DAW, comandos | **Híbrido (Local o Cloud)** | **Ollama** (Local) / OpenAI / Anthropic / Groq / vLLM | Local: GPU 6GB+ o CPU con AVX2. Remoto: API REST con streaming |
| **8. Headless Cloud Audio Engine (Opcional)** | Renderizado offline, separación de stems IA, mastering LUFS | **Cloud (Workers Dedicados)** | **Hetzner Dedicated** / AWS EC2 (c7i / g5) / RunPod | 4-8 vCPU dedicadas, 16 GB RAM, disco NVMe o GPU NVIDIA para modelos IA |

---

## 4. Requisitos de Infraestructura Servidora (Cloud Tier)

A continuación se detallan las configuraciones concretas para desplegar y alojar los servicios en producción:

### 4.1 Backend en PaaS o Servidor VPS (Render / Fly.io / Hetzner)

El backend de JasWave (`backend/`) administra el catálogo de plugins, la autenticación de usuarios, la verificación de compras y la emisión de tokens criptográficos Ed25519 para los plugins VST3 en Reaper y JasWave.

* **Requisitos del Sistema Operativo:** Linux (Ubuntu 22.04 LTS o Debian 12).
* **Entorno de Ejecución:** Node.js v20.x o superior, npm v10+.
* **Capacidad de Servidor Recomendada:**
  - **Fase Inicial / MVP:** 1 vCPU Compartida, 512 MB - 1 GB RAM (Ej. Render Web Service Starter o Fly.io Shared CPU).
  - **Fase Producción:** 2 vCPUs dedicadas, 2 GB - 4 GB RAM (Garantiza latencia de respuesta < 50 ms en validación de tokens y WebSockets).
* **Variables de Entorno Críticas requeridas en el Host:**
  ```env
  NODE_ENV=production
  PORT=8787
  DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:6543/postgres?pgbouncer=true"
  DIRECT_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
  SUPABASE_URL="https://[TU-PROYECTO].supabase.co"
  SUPABASE_JWT_SECRET="[SECRETO-JWT-SUPABASE]"
  LICENCIA_CLAVE_PRIVADA_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
  JASWAVE_WEB_URL="https://jaswave.vercel.app"
  CORS_ORIGIN="https://jaswave.vercel.app,http://localhost:5173"
  ```
* **Requisitos de Red:**
  - Soporte de conexiones salientes por puerto `5432` y `6543` hacia la base de datos PostgreSQL.
  - Certificado SSL/TLS válido (HTTPS obligatorio en puerto `443`).
  - Habilitación de *WebSockets* (WSS) sin timeout agresivo de proxies reversos para la sincronización en vivo.

### 4.2 Base de Datos en Supabase (PostgreSQL 15+)

* **Esquema de Datos:** Tablas `Usuario`, `Producto`, `Licencia`, `Dispositivo` y `Sesion` gestionadas mediante Prisma ORM.
* **Seguridad:** Row Level Security (RLS) habilitado para que los usuarios solo puedan consultar sus propias licencias.
* **Dimensionamiento:**
  - **Almacenamiento de base de datos:** ~500 MB bastan para más de 100,000 registros de usuarios y licencias.
  - **Pool de Conexiones:** Habilitar Transaction Pooler de PgBouncer para evitar saturación de conexiones ante picos de uso del backend.

### 4.3 CDN de Distribución de Binarios (Archivos `.jwx` y VSTs)

Los plugins de JasWave se compilan en archivos binarios C++ (`.vst3`) empaquetados en contenedores firmados con extensión `.jwx` (tamaño promedio por plugin: 5 MB a 25 MB).

* **Alojamiento Recomendado:**
  1. **GitHub Releases:** Gratuito, integrado directamente con el CI/CD (`.github/workflows`), distribución global a través de la infraestructura CDN de GitHub / Fastly. Ideal para plugins oficiales del tag `plugins-v1.0.0`.
  2. **Cloudflare R2 / AWS S3:** Para paquetes de expansión, librerías de sonidos o actualizaciones automáticas OTA (*Over-The-Air*), destacando Cloudflare R2 por tener **$0 de costo por transferencia de salida (Zero Egress Fees)**.

---

## 5. Requisitos para el Cliente Local (Donde se Aloja el Motor de Audio)

Dado que el motor de audio reside en el equipo del usuario, el proyecto debe contemplar los siguientes perfiles de despliegue local:

### 5.1 Entorno de Escritorio Windows (Instalación Tradicional)

* **Sistema Operativo:** Windows 10 (versión 21H2 o superior) o Windows 11 de 64 bits.
* **Ruta de Configuración y Licencias:**  
  `%APPDATA%\JasWave\`
* **Configuración del Plugin Host para VST3:**  
  `%APPDATA%\JasWave\license\config.json`
* **Drivers de Audio Recomendados:**
  - Tarjetas dedicadas: Focusrite Scarlett USB, Universal Audio Volt, Behringer U-Phoria (con driver ASIO del fabricante).
  - Tarjetas integradas: ASIO4ALL o FL Studio ASIO como alternativa WASAPI Exclusive.

### 5.2 Entorno USB Portable (Zero-Extract)

* **Formato del Pendrive:** Sistema de archivos **exFAT** (para soporte de archivos > 4 GB y compatibilidad entre Windows, macOS y Linux).
* **Rendimiento Mínimo de la Unidad USB:**
  - Lectura secuencial: ≥ 150 MB/s (USB 3.0/3.1/3.2 Gen 1).
  - Escritura secuencial: ≥ 60 MB/s.
* **Cuidado de la Memoria Flash (Optimizaciones del Motor de Audio):**
  - Los buffers temporales de grabación de audio deben mantenerse en **RAM o en la carpeta `%TEMP%` del sistema anfitrión**, escribiéndose en el pendrive solo al guardar o mediante el archivo WAL (*Write-Ahead Logging*).

### 5.3 Entorno Móvil Android (Versión Capacitor + Google Oboe C++)

* **Sistema Operativo:** Android 10.0 (API level 29) o superior.
* **Arquitectura de CPU:** ARM64-v8a.
* **Motor de Audio Móvil:** Google Oboe en modo exclusivo AAudio, garantizando latencias inferiores a 15 ms en terminales modernos.
* **Conectividad:** Soporte USB Host / USB-OTG para conexión de interfaces de audio clase 2.0 y teclados controladores MIDI.

---

## 6. Diagrama de Topología y Conexiones de Red

A continuación se ilustra cómo viajan los datos entre el motor de audio local y la infraestructura en la nube:

```mermaid
sequenceDiagram
    autonumber
    actor Musico as Músico / Productor
    participant DAW as JasWave GUI (Electron / React)
    participant Engine as Motor C++ / VST Host (Local)
    participant HW as Placa de Sonido (ASIO / HW)
    participant Backend as Backend API (Render)
    participant Supabase as Supabase (PostgreSQL)
    participant CDN as GitHub / Cloudflare R2

    Note over Musico, HW: PROCESAMIENTO EN TIEMPO REAL (100% LOCAL / CERO RED)
    Musico->>HW: Toca nota en Teclado MIDI / Entrada Micrófono
    HW->>Engine: Flujo de samples PCM (Buffer: 128 samples / 2.9 ms)
    Engine->>Engine: DSP Graph: VST3 Slots + Paneo + Mixer
    Engine->>HW: Salida de Audio analógica a Monitores / Auriculares
    Note right of Engine: Latencia Total: < 5 ms (Sin tocar internet)

    Note over DAW, CDN: OPERACIONES ASÍNCRONAS EN LA NUBE (ALOJAMIENTO CLOUD)
    DAW->>Backend: POST /auth/device-code (Autenticación / Activación)
    Backend->>Supabase: Valida licencia Pro/Ultra
    Supabase-->>Backend: Licencia Activa
    Backend-->>DAW: Token criptográfico Ed25519
    DAW->>Engine: Suministra token al VST (Desbloqueo permanente offline)
    
    DAW->>CDN: Descarga de nuevo plugin .jwx (En segundo plano)
    CDN-->>DAW: Paquete binario descargado y validado con SHA-256
```

---

## 7. Estrategia de Costos y Dimensionamiento por Fases

Para la puesta en marcha del proyecto, la infraestructura cloud puede escalarse de manera gradual:

### Fase 1: Desarrollo y Pruebas Beta (Costo: $0 a $15 USD / mes)
* **Frontend Web:** Plan Gratuito de Vercel (Hobby).
* **Backend API:** Plan Gratuito de Render (o instancia eco de $7/mes para evitar que entre en suspensión).
* **Base de Datos & Auth:** Plan Gratuito de Supabase (hasta 500 MB de base de datos y 50,000 usuarios activos mensuales).
* **Distribución de Plugins:** GitHub Releases público (gratuito e ilimitado).
* **Motor de Audio:** Ejecución 100% local en los equipos de los testers.

### Fase 2: Producción Comercial (Costo: $50 a $150 USD / mes)
* **Frontend Web:** Vercel Pro ($20/mes) o Cloudflare Pages con dominio propio.
* **Backend API:** VPS Dedicado en Hetzner Cloud (CX22 / CPX31: 4 vCPUs, 8 GB RAM, ~$15 a $25/mes) o Render Team ($19/mes/seat + cómputo).
* **Base de Datos:** Supabase Pro ($25/mes) con respaldos diarios y escalado de conexiones.
* **Almacenamiento y CDN:** Cloudflare R2 ($0.015 por GB/mes, $0 por salida de tráfico).
* **Firma de Código (Obligatorio para evitar alertas de Windows Defender SmartScreen):** Certificado Sectigo o DigiCert EV Code Signing (~$250 a $400 USD / año).

### Fase 3: Escala Masiva con Cloud Audio Workers (Costo: $250+ USD / mes)
* Se agregan instancias dedicadas (AWS EC2 c7i o servidores bare-metal en Hetzner) ejecutando contenedores Docker de la versión *headless* del motor C++ para procesar renderizado offline y exportaciones masivas solicitadas desde la web.

---

## 8. Conclusiones y Recomendaciones Finales

1. **El Motor de Audio pertenece al Cliente (Edge):**  
   Bajo ninguna circunstancia debe intentarse trasladar el pipeline de mezcla y procesamiento VST3 en tiempo real a un servidor web remoto; la física de la red destruye la experiencia musical. El motor de audio C++ debe distribuirse empaquetado dentro de la aplicación de escritorio (Electron + N-API) o en la app móvil (Android Oboe).
2. **La Nube es para Servicios, Identidad y Distribución:**  
   La infraestructura de servidores (Render, Supabase, Vercel y GitHub Releases) debe destinarse a:
   - Autenticación segura y gestión de usuarios.
   - Verificación y firma criptográfica de licencias mediante Ed25519.
   - Sincronización de proyectos (Google Drive / Supabase).
   - Catálogo web y entrega de paquetes `.jwx` optimizados.
3. **Resiliencia Offline:**  
   Gracias a la arquitectura criptográfica Ed25519 ya implementada en JasWave, una vez que el usuario activa su licencia contra el backend en la nube, el motor de audio y los plugins nativos pueden funcionar **completamente desconectados de internet de manera indefinida**, cumpliendo con los estándares de la industria del audio profesional.
