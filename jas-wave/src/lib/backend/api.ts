/**
 * Cliente tipado del backend JasWave (backend/README.md). Añade el JWT de la sesión y convierte las
 * respuestas de error `{ error: { codigo, mensaje } }` en `ErrorApiCliente`.
 */

export class ErrorApiCliente extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    message: string,
  ) {
    super(message)
    this.name = 'ErrorApiCliente'
  }
}

export type Identidad = { userId: string; email: string; roles: string[]; esAdmin: boolean }

export type RespuestaLicencia = {
  estado: 'aprobado'
  token: string
  expiraEn: string
  productos: Record<string, string[]>
  tokenDispositivo: string
}

export type AccionAdmin = { id: string; productoId: string; clave: string; descripcion: string }
export type RolAdmin = { id: string; productoId: string; nombre: string; acciones?: { accionId: string }[] }
export type ProductoAdmin = { id: string; nombre: string; creadoEn: string; acciones: AccionAdmin[]; roles: RolAdmin[] }
export type UsuarioAdmin = {
  id: string
  email: string
  subAuth: string | null
  esAdmin: boolean
  roles: { usuarioId: string; rolId: string; rol: RolAdmin }[]
  licencias: { id: string; productoId: string; estado: 'activa' | 'suspendida' | 'revocada' }[]
  concesiones: { id: string; accionId: string; productoId: string; efecto: 'allow' | 'deny'; expiraEn: string | null; accion: AccionAdmin }[]
}
export type DispositivoAdmin = { id: string; nombre: string; revocado: boolean; creadoEn: string; ultimoUso: string }
export type RegistroAuditoriaAdmin = { id: string; actorId: string; accion: string; objetivo: string; datos: unknown; creadoEn: string }

/** Proveedor de IA tal como lo devuelve el backend (M2). Nunca incluye la clave. */
export type ProveedorIAApi = {
  id: string
  slug: string
  nombre: string
  tipo: string
  baseUrl?: string
  modelos: string[]
  modeloPorDefecto: string
  maxTokens: number
  herramientas: boolean | null
  origen: 'admin' | 'propio'
  ejecucion: 'servidor' | 'local'
  activo: boolean
  tieneClave: boolean
  custom?: Record<string, unknown> | null
  peticionesPorMinuto?: number
}
export type PermisosIAApi = { usar: boolean; modeloPropio: boolean; proveedores: string[] }
export type DatosProveedorIA = {
  nombre?: string
  tipo?: string
  baseUrl?: string
  modelos?: string[]
  modeloPorDefecto?: string
  maxTokens?: number
  herramientas?: boolean | null
  custom?: Record<string, unknown> | null
  activo?: boolean
  apiKey?: string
  ejecucion?: 'servidor' | 'local'
  slug?: string
  peticionesPorMinuto?: number
}

export type OpcionesClienteApi = {
  base: string
  /** Devuelve el JWT vigente de la sesión (o null sin sesión). */
  token: () => Promise<string | null>
  fetch?: typeof fetch
}

export function crearClienteApi(o: OpcionesClienteApi) {
  const f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, autenticado = true): Promise<T> {
    const cabeceras: Record<string, string> = {}
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
    if (autenticado) {
      const t = await o.token()
      if (!t) throw new ErrorApiCliente(401, 'no_autenticado', 'inicia sesión para continuar')
      cabeceras.Authorization = `Bearer ${t}`
    }
    let r: Response
    try {
      r = await f(`${o.base}${ruta}`, { method: metodo, headers: cabeceras, cache: 'no-store', ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}) })
    } catch {
      throw new ErrorApiCliente(0, 'sin_conexion', 'no se pudo contactar con el servidor de JasWave')
    }
    if (r.status === 204) return undefined as T
    const datos = (await r.json().catch(() => null)) as { error?: { codigo?: string; mensaje?: string } } | null
    if (!r.ok) {
      throw new ErrorApiCliente(r.status, datos?.error?.codigo ?? 'error', datos?.error?.mensaje ?? `error ${r.status}`)
    }
    return datos as T
  }

  const enc = encodeURIComponent
  return {
    me: () => pedir<{ identidad: Identidad }>('GET', '/me').then((r) => r.identidad),
    refrescarLicencia: (datos: { dispositivo: string; tokenDispositivo?: string }) => pedir<RespuestaLicencia>('POST', '/license/refresh', datos),
    aprobarCodigo: (codigoUsuario: string) => pedir<{ ok: true }>('POST', '/license/device/aprobar', { codigoUsuario }),
    handover: {
      crear: (datos: Record<string, unknown>, sesion?: { access_token: string; refresh_token: string }) =>
        pedir<{ token: string; url: string; caducaEn: string }>('POST', '/handover', { datos, ...(sesion ? { sesion } : {}) }),
      /** El token de un solo uso es la credencial: no requiere sesión. */
      canjear: (token: string) =>
        pedir<{ datos: Record<string, unknown>; sesion?: { access_token: string; refresh_token: string } }>('POST', '/handover/canjear', { token }, false),
    },
    ia: {
      proveedores: () => pedir<{ permisos: PermisosIAApi; proveedores: ProveedorIAApi[] }>('GET', '/ia/proveedores'),
      misProveedores: () => pedir<{ proveedores: ProveedorIAApi[] }>('GET', '/ia/mis-proveedores').then((r) => r.proveedores),
      crearPropio: (d: DatosProveedorIA) => pedir<{ proveedor: ProveedorIAApi }>('POST', '/ia/mis-proveedores', d).then((r) => r.proveedor),
      actualizarPropio: (id: string, d: DatosProveedorIA) =>
        pedir<{ proveedor: ProveedorIAApi }>('PUT', `/ia/mis-proveedores/${enc(id)}`, d).then((r) => r.proveedor),
      clavePropia: (id: string, apiKey: string | null) => pedir<{ ok: true }>('PUT', `/ia/mis-proveedores/${enc(id)}/clave`, { apiKey }),
      eliminarPropio: (id: string) => pedir<void>('DELETE', `/ia/mis-proveedores/${enc(id)}`),
      /** Escritorio: credencial de un modelo propio de ejecución local (solo su dueño). */
      credencialLocal: (id: string) =>
        pedir<{ proveedor: ProveedorIAApi & { apiKey?: string } }>('GET', `/ia/mis-proveedores/${enc(id)}/credencial`).then((r) => r.proveedor),
    },
    admin: {
      ia: {
        proveedores: () => pedir<{ proveedores: ProveedorIAApi[] }>('GET', '/admin/ia/proveedores').then((r) => r.proveedores),
        deUsuarios: () =>
          pedir<{ proveedores: (ProveedorIAApi & { propietario: string | null })[] }>('GET', '/admin/ia/proveedores-usuario').then((r) => r.proveedores),
        crear: (d: DatosProveedorIA & { slug: string }) => pedir<{ proveedor: ProveedorIAApi }>('POST', '/admin/ia/proveedores', d).then((r) => r.proveedor),
        actualizar: (id: string, d: DatosProveedorIA) =>
          pedir<{ proveedor: ProveedorIAApi }>('PUT', `/admin/ia/proveedores/${enc(id)}`, d).then((r) => r.proveedor),
        clave: (id: string, apiKey: string | null) => pedir<{ ok: true }>('PUT', `/admin/ia/proveedores/${enc(id)}/clave`, { apiKey }),
        eliminar: (id: string) => pedir<void>('DELETE', `/admin/ia/proveedores/${enc(id)}`),
        probar: (id: string) =>
          pedir<{ estado: string; modelos: string[]; error?: string; pista?: string }>('POST', `/admin/ia/proveedores/${enc(id)}/probar`),
      },
      productos: () => pedir<{ productos: ProductoAdmin[] }>('GET', '/admin/productos').then((r) => r.productos),
      crearProducto: (id: string, nombre: string) => pedir<{ producto: ProductoAdmin }>('POST', '/admin/productos', { id, nombre }),
      eliminarProducto: (id: string) => pedir<void>('DELETE', `/admin/productos/${enc(id)}`),
      crearAccion: (productoId: string, clave: string, descripcion = '') =>
        pedir<{ accion: AccionAdmin }>('POST', `/admin/productos/${enc(productoId)}/acciones`, { clave, descripcion }).then((r) => r.accion),
      eliminarAccion: (id: string) => pedir<void>('DELETE', `/admin/acciones/${enc(id)}`),
      crearRol: (productoId: string, nombre: string) =>
        pedir<{ rol: RolAdmin }>('POST', `/admin/productos/${enc(productoId)}/roles`, { nombre }).then((r) => r.rol),
      accionesDeRol: (rolId: string, accionIds: string[]) => pedir<{ ok: true }>('PUT', `/admin/roles/${enc(rolId)}/acciones`, { accionIds }),
      usuarios: () => pedir<{ usuarios: UsuarioAdmin[] }>('GET', '/admin/usuarios').then((r) => r.usuarios),
      crearUsuario: (email: string) => pedir<{ usuario: UsuarioAdmin }>('POST', '/admin/usuarios', { email }).then((r) => r.usuario),
      rolesDeUsuario: (usuarioId: string, rolIds: string[]) => pedir<{ ok: true }>('PUT', `/admin/usuarios/${enc(usuarioId)}/roles`, { rolIds }),
      concesion: (usuarioId: string, accionId: string, efecto: 'allow' | 'deny', expiraEn?: string | null) =>
        pedir<unknown>('PUT', `/admin/usuarios/${enc(usuarioId)}/concesiones`, { accionId, efecto, expiraEn: expiraEn ?? null }),
      quitarConcesion: (usuarioId: string, accionId: string) => pedir<void>('DELETE', `/admin/usuarios/${enc(usuarioId)}/concesiones/${enc(accionId)}`),
      licencia: (usuarioId: string, productoId: string, estado: 'activa' | 'suspendida' | 'revocada') =>
        pedir<unknown>('PUT', `/admin/licencias/${enc(usuarioId)}/${enc(productoId)}`, { estado }),
      dispositivos: (usuarioId: string) =>
        pedir<{ dispositivos: DispositivoAdmin[] }>('GET', `/admin/usuarios/${enc(usuarioId)}/dispositivos`).then((r) => r.dispositivos),
      revocarDispositivo: (id: string, revocado: boolean) => pedir<unknown>('PUT', `/admin/dispositivos/${enc(id)}`, { revocado }),
      auditoria: (limite = 100) =>
        pedir<{ registros: RegistroAuditoriaAdmin[] }>('GET', `/admin/auditoria?limite=${limite}`).then((r) => r.registros),
    },
  }
}

export type ClienteApi = ReturnType<typeof crearClienteApi>
