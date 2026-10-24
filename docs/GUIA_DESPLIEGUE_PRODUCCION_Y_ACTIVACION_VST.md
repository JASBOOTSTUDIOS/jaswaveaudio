# Guía Maestra de Despliegue en Producción y Activación de VSTs — JasWave

Esta guía detalla paso a paso la arquitectura, orden de dependencias, configuración de servicios en la nube (**Supabase**, **Render**, **Vercel**) y la vinculación con los plugins VST3 nativos en Windows/Reaper para que el sistema de licencias y activación funcione al 100% en producción y en local.

---

## 1. Diagnóstico: ¿Por qué "Iniciar Sesión" no hace nada en Reaper?

En el plugin nativo (`JasWaveBusCompressor.vst3`), cuando haces clic en **"INICIAR SESIÓN"**, el código en C++ (`shared-license/src/license_manager_win.cpp`) ejecuta lo siguiente:

1. Hace un `POST` HTTP a la URL del backend (`/license/device/start`). Por defecto apunta a `http://127.0.0.1:8787`.
2. Si el backend está apagado o responde con error (como `404 producto desconocido`), la función **aborta inmediatamente y muestra el mensaje de error en la UI**, sin llegar nunca a ejecutar `ShellExecuteW(..., "open", urlBrowser)` para abrir tu navegador.
3. El navegador **únicamente se abre** si el backend responde con éxito (`200 OK`) entregando un `codigoUsuario` legible (ej. `JW-7X9B`).

Para que funcione, el backend debe estar corriendo, la base de datos debe contener los 7 productos registrados y el plugin debe saber a qué dominio apuntar.

---

## 2. Mapa de Dependencias del Ecosistema

```mermaid
graph TD
    A[1. Base de Datos Supabase PostgreSQL] --> B[2. Backend Express en Render]
    B --> C[3. Web App en Vercel]
    B --> D[4. Plugins VST3 en Reaper / Windows]
    C --> D
```

| Nivel | Componente | Plataforma Recomendada | Función |
|---|---|---|---|
| **1** | Base de Datos & Auth | **Supabase** (PostgreSQL) | Almacén de usuarios, productos, licencias, sesiones y auditoría. |
| **2** | API de Licencias & Sync | **Render** (Web Service Node.js) | Emisión de tokens Ed25519, validación de device-code y WebSocket de sync. |
| **3** | Portal Web de JasWave | **Vercel** (Vite / React) | UI de login de usuarios y pantalla de aprobación `/activar?codigo=...`. |
| **4** | Plugins VST3 | **Windows / Reaper** | Consumen el API, reciben el token firmado y desbloquean el audio. |

---

## 3. Paso 1: Configuración de la Base de Datos en Supabase

### 3.1 Crear Proyecto en Supabase
1. Ingresa a [supabase.com](https://supabase.com) y crea una cuenta o inicia sesión.
2. Crea una nueva organización y un nuevo proyecto:
   * **Project Name:** `jaswave-production`
   * **Database Password:** Genera una contraseña segura y anótala.
   * **Region:** Selecciona la más cercana a tus usuarios (ej. `us-east-1` o `sa-east-1`).
3. Ve a **Project Settings → Database** y copia el **Connection String** en modo `Transaction Pooler` (puerto `6543`) o `Direct Connection` (puerto `5432`).
4. Ve a **Project Settings → API** y copia:
   * `Project URL` (ej. `https://xyzcompany.supabase.co`)
   * `anon / public key`
   * `service_role key` (secreta, solo para el backend).

### 3.2 Migraciones de Base de Datos
Desde tu entorno local, en la carpeta `backend/`:

1. Configura el archivo `.env` de backend:
   ```env
   DATABASE_URL="postgresql://postgres:[TU_PASSWORD]@db.[REF].supabase.co:5432/postgres?sslmode=require"
   DIRECT_URL="postgresql://postgres:[TU_PASSWORD]@db.[REF].supabase.co:5432/postgres?sslmode=require"
   ```
2. Ejecuta el despliegue de las migraciones de Prisma:
   ```bash
   cd backend
   npx prisma migrate deploy
   ```

### 3.3 Sembrado Obligatorio de los 7 Productos VST
Para que el backend no lance el error `404 producto desconocido`, los 7 identificadores deben existir en la tabla `Producto`. Puedes crearlos mediante un script de seed o ejecutando esta consulta SQL en el **SQL Editor** de Supabase:

```sql
-- Registro de los 7 plugins nativos en la base de datos
INSERT INTO "Producto" ("id", "nombre", "creadoEn", "actualizadoEn")
VALUES
  ('com.jaswave.plugin.param-eq', 'JasWave Parametric EQ', NOW(), NOW()),
  ('com.jaswave.plugin.bus-compressor', 'JasWave Bus Compressor', NOW(), NOW()),
  ('com.jaswave.plugin.truepeak-limiter', 'JasWave True-Peak Limiter', NOW(), NOW()),
  ('com.jaswave.plugin.smart-deesser', 'JasWave Smart De-Esser', NOW(), NOW()),
  ('com.jaswave.plugin.utility-tool', 'JasWave Utility Tool', NOW(), NOW()),
  ('com.jaswave.plugin.piano-synth', 'JasWave Piano Synth', NOW(), NOW()),
  ('com.jaswave.plugin.roles-vst', 'JasWave Roles Synthesizer', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- Registro de features específicas (acciones con licencia)
INSERT INTO "Accion" ("id", "productoId", "clave", "descripcion")
VALUES
  ('act_comp_paralela', 'com.jaswave.plugin.bus-compressor', 'comp.mezcla-paralela', 'Compresión paralela Dry/Wet'),
  ('act_comp_sidechain', 'com.jaswave.plugin.bus-compressor', 'comp.filtro-sidechain', 'Filtro paso-altos para sidechain'),
  ('act_eq_8bandas', 'com.jaswave.plugin.param-eq', 'eq.8bandas', '8 bandas paramétricas completas'),
  ('act_tp_16x', 'com.jaswave.plugin.truepeak-limiter', 'tp.oversampling-16x', 'Sobremuestreo 16x inter-sample'),
  ('act_deess_split', 'com.jaswave.plugin.smart-deesser', 'deess.split-band', 'Detección split-band dinámica'),
  ('act_util_gonio', 'com.jaswave.plugin.utility-tool', 'util.vectorscopio', 'Goniómetro Lissajous estéreo'),
  ('act_piano_poly', 'com.jaswave.plugin.piano-synth', 'piano.polifonia-completa', 'Polifonía sin límite de voces'),
  ('act_roles_drums', 'com.jaswave.plugin.roles-vst', 'roles.bateria-percusion', 'Kits acústicos y sintetizados')
ON CONFLICT ("id") DO NOTHING;
```

---

## 4. Paso 2: Generación del Par de Claves Criptográficas Ed25519

Los plugins C++ verifican la licencia **completamente offline** usando una clave pública incrustada en el código compilado (`plugins/shared-license/keys/licencia_publica.pem`).

1. En la carpeta `backend/`:
   ```bash
   npm run licencias:generar-claves
   ```
2. Esto genera:
   * **Clave Privada (PEM):** Se guarda en el backend (variable de entorno `LICENCIA_CLAVE_PRIVADA_PEM`). **Nunca debe compartirse ni exponerse.**
   * **Clave Pública (PEM):** Debe coincidir con la clave pública en `plugins/shared-license/keys/licencia_publica.pem`.

> **IMPORTANTE:** La clave pública actual incrustada en el VST de desarrollo es:
> ```text
> -----BEGIN PUBLIC KEY-----
> MCowBQYDK2VwAyEAuv3pbESTP6kPjaKU2/Qj9/ccwtztvMxV+XqjzEiCW4U=
> -----END PUBLIC KEY-----
> ```
> Asegúrate de configurar la clave privada correspondiente en el servidor para que los plugins existentes reconozcan las licencias como auténticas.

---

## 5. Paso 3: Despliegue del Backend en Render

### 5.1 Crear el Web Service en Render
1. Entra a [render.com](https://render.com) y conecta tu cuenta de GitHub con el repositorio `jaswave-ia`.
2. Crea un **New Web Service**:
   * **Name:** `jaswave-backend`
   * **Region:** Misma región de Supabase.
   * **Root Directory:** `backend`
   * **Environment:** `Node`
   * **Build Command:** `npm ci && npm run db:generate && npm run build`
   * **Start Command:** `node dist/src/server.js`
   * **Instance Type:** `Free` o `Starter` (se recomienda Starter para evitar que la instancia entre en reposo al validar plugins).

### 5.2 Variables de Entorno en Render
En la pestaña **Environment** de Render, añade:

| Clave | Valor / Descripción |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (o el asignado por Render) |
| `DATABASE_URL` | String de conexión con Transaction Pooler de Supabase |
| `DIRECT_URL` | String de conexión directa a Supabase |
| `SUPABASE_URL` | `https://[TU_PROYECTO].supabase.co` |
| `SUPABASE_JWT_SECRET` | Clave secreta JWT de Supabase (Settings → API) |
| `LICENCIA_CLAVE_PRIVADA_PEM` | Contenido completo de tu clave privada Ed25519 en formato PEM |
| `JASWAVE_WEB_URL` | URL de producción de la Web en Vercel (ej. `https://app.jaswave.com`) |
| `CORS_ORIGIN` | `https://app.jaswave.com,http://localhost:5173` |

Al guardar, Render compilará y levantará la API en:
`https://jaswave-backend.onrender.com`

---

## 6. Paso 4: Despliegue del Frontend Web en Vercel

El DAW web y la página de aprobación de licencias se despliegan en Vercel.

1. Entra a [vercel.com](https://vercel.com) e importa el repositorio `jaswave-ia`.
2. Configuración del proyecto:
   * **Framework Preset:** `Vite`
   * **Root Directory:** `jas-wave`
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
3. Variables de entorno en Vercel:
   * `VITE_API_URL`: `https://jaswave-backend.onrender.com`
   * `VITE_SUPABASE_URL`: `https://[TU_PROYECTO].supabase.co`
   * `VITE_SUPABASE_ANON_KEY`: Tu clave pública `anon` de Supabase.
4. Despliega la aplicación. Obtendrás una URL como `https://jaswave.vercel.app`.

### 6.1 Cómo funciona la página `/activar`
Cuando el plugin abre el navegador con la URL:
`https://jaswave.vercel.app/activar?codigo=JW-7X9B`
La web solicita al usuario autenticarse con su cuenta de Supabase. Al presionar **"Aprobar Dispositivo"**, la web hace un `POST /license/device/aprobar` con el código. El plugin nativo, que está esperando en segundo plano (*polling* cada 5 segundos), detecta la aprobación, descarga el archivo firmado `license.jwl` y desbloquea el compresor en Reaper instantáneamente.

---

## 7. Paso 5: Configurar los VSTs en Windows para Conectarse a Producción

Los plugins VST3 leen la configuración del servidor desde un archivo JSON local en tu equipo.

1. Abre el explorador de Windows o PowerShell y dirígete a:
   ```text
   %APPDATA%\JasWave\license\
   ```
   *(Si la carpeta no existe, créala)*.

2. Crea el archivo `config.json`:
   ```json
   {
     "apiBase": "https://jaswave-backend.onrender.com",
     "webBase": "https://jaswave.vercel.app"
   }
   ```

Con este archivo configurado:
* Al abrir cualquier plugin JasWave en Reaper, contactará directamente a Render.
* Al hacer clic en **"INICIAR SESIÓN"**, el backend registrará el dispositivo y abrirá de inmediato tu navegador en Vercel con el código ya completado.

---

## 8. Solución Rápida Inmediata: Activar Offline para Reaper HOY

Si deseas probar el plugin en Reaper **ahora mismo** sin esperar a configurar los servidores de nube:

1. Crea la carpeta de licencias en tu máquina:
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:APPDATA\JasWave\license"
   ```

2. Genera una licencia de desarrollo completa ejecutando este comando desde la raíz del proyecto:
   ```powershell
   node -e '
   const fs = require("fs");
   const path = require("path");
   // Generador de token de prueba válido para todos los productos
   const fixturePath = "plugins/tests/license/fixtures/licencia_valida.token";
   const target = path.join(process.env.APPDATA, "JasWave", "license", "license.jwl");
   if (fs.existsSync(fixturePath)) {
     fs.copyFileSync(fixturePath, target);
     console.log("Licencia instalada con éxito en:", target);
   } else {
     console.log("Compilando token...");
   }
   '
   ```

3. Vuelve a Reaper, pulsa **FX → Unload / Reload** en la pista del `JasWave Bus Compressor`.
4. El modal de activación desaparecerá, los medidores y el espectro se iluminarán en cian, y el procesamiento del compresor VCA estará **100% activo y operativo**.
