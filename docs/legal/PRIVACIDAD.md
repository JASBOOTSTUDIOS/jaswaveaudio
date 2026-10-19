# Política de Privacidad — JasWave

> **Borrador.** Pendiente de revisión legal. Los campos entre corchetes `[...]` están por
> completar. Describe la aplicación de escritorio para Windows; las futuras versiones web y
> Android tendrán su propia sección (ver §9).

**Versión:** borrador 0.1 · **Fecha:** [FECHA DE ENTRADA EN VIGOR]
**Responsable:** JASBOOTSTUDIOS · [CORREO DE CONTACTO DE PRIVACIDAD — PENDIENTE]

## 1. Resumen

- JasWave es una aplicación **local**: no hay cuentas de usuario, no hay telemetría, no hay
  analítica y no se envían informes de fallos.
- JASBOOTSTUDIOS **no recibe** sus proyectos, audio, MIDI ni claves de API.
- Solo salen datos de su equipo cuando usted usa funciones que lo requieren: la **IA con un
  proveedor externo** que usted configure, las **búsquedas web** del agente y, cuando esté
  habilitada, la **comprobación de actualizaciones**. Todo se describe abajo.

## 2. Datos que se quedan en su equipo

| Dato | Dónde se guarda |
|---|---|
| Proyectos (`.jaswave`), grabaciones, audio importado, exportaciones | Carpetas que usted elige |
| Sesión de trabajo y buffers de audio en caché | Datos de la aplicación (`%APPDATA%\JasWave`, IndexedDB) |
| Ajustes, perfiles de IA (sin claves), permisos de carpetas concedidos | Datos de la aplicación |
| **Claves de API** de proveedores de IA | Datos de la aplicación, **cifradas con el sistema operativo** (Electron `safeStorage` / DPAPI de Windows). La interfaz puede guardarlas o borrarlas, pero no leerlas. Si el cifrado del sistema no está disponible, no se guardan. |
| Lista de plugins VST detectados | Datos de la aplicación |

JasWave no copia estos datos a ningún servidor. Usted puede borrarlos eliminando sus proyectos y
la carpeta de datos de la aplicación (o desinstalando la aplicación).

## 3. Funciones de inteligencia artificial

Las funciones de IA están **desactivadas hasta que usted configure un proveedor**. Puede elegir:

- **Proveedores en la nube:** OpenAI, Anthropic, Google Gemini, OpenRouter, la pasarela de
  Kilo Code o cualquier endpoint compatible con la API de OpenAI que usted indique.
- **Modelos locales:** Ollama en su propio equipo. En este caso los datos no salen de su equipo.

Cuando usa el asistente con un proveedor en la nube, JasWave envía **directamente desde su
equipo a ese proveedor** (sin pasar por servidores de JASBOOTSTUDIOS):

- el texto de sus mensajes e instrucciones;
- el contexto del proyecto necesario para responder, que puede incluir: nombres de pistas y
  clips, notas MIDI (tono, duración, velocidad), nombres y parámetros de plugins, tempo (BPM),
  tonalidad y estructura del arreglo, y el texto de los documentos del proyecto que el agente
  lea;
- su clave de API, como credencial de autenticación ante el proveedor.

JasWave **no envía archivos de audio** al proveedor de IA.

El proveedor trata estos datos según **sus propios términos y política de privacidad**
(retención, uso para entrenamiento, ubicación de los servidores). Revíselos antes de usarlo.
JASBOOTSTUDIOS no controla ni es responsable del tratamiento que haga el proveedor.

## 4. Búsquedas web y consulta de plugins

Cuando el agente de IA necesita información (por ejemplo, qué hace un plugin), JasWave puede
enviar **consultas de texto breves** (como el nombre de un plugin) a:

- la API de respuestas instantáneas de **DuckDuckGo** (`api.duckduckgo.com`);
- la API de búsqueda de **Wikipedia** (`en.wikipedia.org`).

No se envían datos del proyecto más allá del texto de la consulta. Estos servicios reciben la
consulta y la dirección IP de su equipo y la tratan según sus propias políticas.

## 5. Actualizaciones

Cuando la actualización automática esté habilitada en la versión instalada, la aplicación
consultará el servidor de publicaciones (GitHub Releases) para comprobar si hay una versión
nueva y descargarla. Esta consulta revela a GitHub su dirección IP y la versión instalada; no
incluye datos de sus proyectos.

## 6. Puente local para la CLI (opcional)

JasWave incluye un puente HTTP local para herramientas de línea de comandos. En la aplicación
instalada está **apagado por defecto** y solo se activa si usted lo habilita. Cuando está activo
escucha únicamente en `127.0.0.1` (no es accesible desde otros equipos), exige un token
guardado en los datos de la aplicación y no transmite nada a Internet.

## 7. Plugins de terceros

Los plugins VST3/VST2 que usted carga son programas de terceros que se ejecutan en su equipo y
pueden tener sus propias funciones de red, activación o recopilación de datos. Esas prácticas se
rigen por las políticas de sus fabricantes, no por esta política.

## 8. Sus controles

- **Elegir proveedor:** usted decide qué proveedor de IA usar, o no usar ninguno.
- **Modo totalmente local:** use Ollama como proveedor para que ningún dato de IA salga de su
  equipo.
- **Borrar claves:** desde Ajustes puede borrar en cualquier momento las claves guardadas.
- **Búsquedas web:** solo ocurren cuando el agente de IA las solicita; si no usa el agente, o
  usa un modelo local sin pedirle búsquedas, no se realizan. [PENDIENTE: ajuste dedicado para
  desactivar la búsqueda web del agente.]
- **Permisos del agente:** el nivel de autonomía de la IA (solo lectura, sugerir, confirmar,
  etc.) lo fija usted; la IA no puede elevarlo.
- **Puente CLI:** permanece apagado salvo que usted lo active.

## 9. Retención

- **JASBOOTSTUDIOS** no recopila ni conserva datos personales de la aplicación de escritorio.
- **Sus datos locales** se conservan en su equipo hasta que usted los borre.
- **Proveedores de IA y servicios de búsqueda** conservan los datos que reciben según sus
  propias políticas.

**Versiones futuras.** Está previsto ofrecer versiones web y Android en las que las peticiones
de IA pasarán por un servidor intermedio (proxy) de JasWave. Cuando existan, esta política se
actualizará antes de su lanzamiento para describir qué datos procesa ese servidor, durante
cuánto tiempo y con qué fines.

## 10. Menores

JasWave no está dirigido específicamente a menores ni recopila conscientemente datos de ellos.
[PENDIENTE: edad mínima según jurisdicción.]

## 11. Cambios en esta política

Las modificaciones se publicarán con cada versión de la aplicación e indicarán la fecha de
entrada en vigor.

## 12. Contacto

Para preguntas sobre privacidad: JASBOOTSTUDIOS · [CORREO DE CONTACTO DE PRIVACIDAD — PENDIENTE]
· [DIRECCIÓN — PENDIENTE]
