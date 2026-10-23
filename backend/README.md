# JasWave Backend

Servicio independiente (Express 5 + TypeScript + Prisma 7) para autenticación, licencias de VST, panel admin y
sincronización multi-usuario. No importa código de `shared/`, `ai-harness/` ni `jas-wave/`: el contrato con los
clientes es HTTP/WebSocket (ver `src/sync/protocolo.ts`).

## Arranque local

```bash
cd backend
npm ci
supabase start                 # Postgres + Auth en puertos 553xx (config en supabase/config.toml)
cp .env.example .env           # y pega la clave de: npm run licencias:generar-claves
npm run db:deploy              # aplica prisma/migrations
npm run dev                    # http://localhost:8787
```

Supabase Auth firma JWT con ES256 (`supabase/signing_keys.json`, **no versionado**). Para crearlo:
`echo '[]' > supabase/signing_keys.json && supabase gen signing-key --algorithm ES256` y reinicia Supabase.

## Verificación

```bash
npm run typecheck && npm run lint
npm test                       # unitarias
npm run test:integration       # requiere Supabase local en marcha
```

## API

| Ruta | Auth | Descripción |
|---|---|---|
| `GET /health` | — | Estado |
| `GET /me` | JWT | Identidad (incluye `esAdmin`) |
| `POST /license/device/start` | — | El VST pide un código de dispositivo |
| `POST /license/device/aprobar` | JWT | El usuario aprueba el código en el navegador |
| `POST /license/device/poll` | — | El VST recibe la licencia firmada (una vez) |
| `POST /license/refresh` | JWT | Renueva la licencia (vigencia 24 h) |
| `/admin/*` | JWT + admin | Productos, acciones, roles, usuarios, concesiones, licencias, auditoría |
| `WS /sync?token=` | JWT | Salas: `sala.unirse`, `comando`, `auth.refresh`, `ping` |

Licencia: `jwl1.<payload>.<firma Ed25519>`; acciones efectivas = roles ∪ allow − deny, solo con licencia `activa`.
WebSocket: cierre `4001` sin token / token inválido / expirado; `seq` monótono por sala; replay con `desdeSeq`.

La autorización se aplica en el backend (Prisma usa rol de servicio, sin RLS).
