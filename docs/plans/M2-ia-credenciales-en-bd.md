# M2 — Proveedores de IA en la base de datos, con permisos por rol

**Depende de:** L1, M1 · **Estado:** ver STATUS.md

## Objetivo

Las credenciales de IA viven en la BD y se dan de alta dinámicamente desde el panel Admin. El acceso se
controla con el sistema de roles existente; un usuario puede registrar su propio modelo solo si el admin
se lo permite.

## Diseño

- Producto `com.jaswave.modulo.asistente-ia` (se siembra al arrancar el backend) con acciones:
  - `ia.usar` — sin ella no hay asistente.
  - `ia.proveedor.<slug>` — una por proveedor del admin (se crea/borra con el proveedor).
  - `ia.modelo-propio` — puede registrar y usar sus propios modelos.
  Requiere licencia activa del producto (como los VST). Los administradores tienen todo.
- `ProveedorIA` (Prisma): tipo, URL, modelos, límites; clave cifrada con AES-256-GCM
  (`IA_CLAVE_MAESTRA`, AAD = id + versión). La clave es de solo escritura: nunca sale por la API ni se audita.
- Proveedores propios: `ejecucion=servidor` (el backend los llama con red restringida: sin redes privadas,
  revalida el DNS al conectar, sin redirecciones) o `ejecucion=local` (solo escritorio: el DAW descarga la
  clave del dueño al almacén cifrado de Electron y ejecuta en el equipo, p. ej. Ollama local).
- Cliente: `src/lib/ia/catalogo-ia.ts` (catálogo sin claves desde `GET /ia/proveedores`),
  `ai-settings.ts` deriva los perfiles del catálogo y solo guarda preferencias, `transporte-ia.ts` enruta
  cada petición (backend o Electron). Los ajustes antiguos con proveedores locales y sus claves se borran.

## Hecho

- [x] Backend: `src/ia/proveedores.ts`, `src/ia/rutas.ts` (`/ia/*`, `/admin/ia/*`), `src/seguridad/{cifrado,url-segura,red-restringida}.ts`,
      migración `20261023100000_ia_proveedores`, scripts `ia:generar-clave` e `ia:importar-entorno`.
- [x] Tests: `test/seguridad.test.ts`, `test/ia.test.ts`, `test/integracion/ia.int.test.ts`.
- [x] DAW: Ajustes → IA (`components/ia/ajustes-ia.tsx`: modelos permitidos, preferencias, «Mis modelos»),
      Admin → IA (`components/admin/admin-ia.tsx`), formulario compartido.
- [x] Tests: `src/lib/ia/catalogo-ia.test.ts`, `transporte-ia.test.ts`, `agent-engine-host.test.ts`.

## Notas de traspaso

- Producción: `npm run ia:generar-clave` → `IA_CLAVE_MAESTRA` en `backend/.env` y en un gestor de secretos
  (si se pierde, las claves guardadas no se recuperan). Migrar un `IA_*` antiguo con `npm run ia:importar-entorno`.
- El limitador de peticiones es en memoria (por usuario y proveedor).
- Los proveedores del admin son de confianza (pueden apuntar a la LAN); los de usuarios no.
