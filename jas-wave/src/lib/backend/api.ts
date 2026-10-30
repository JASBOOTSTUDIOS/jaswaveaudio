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

// ---------- Admin · JasWave IA (modelos de marca, planes, consumo y grupo de claves) ----------
export type RazonamientoIA = 'off' | 'bajo' | 'normal'
export type EslabonModeloJasWave = { proveedorId: string; modelo: string; razonamiento: RazonamientoIA }
export type ModeloJasWaveAdmin = {
  id: string
  nombre: string
  descripcion: string
  orden: number
  activo: boolean
  cadena: EslabonModeloJasWave[]
  creditosPorMil: number
  maxTokens: number
}
export type DatosModeloJasWave = {
  nombre: string
  descripcion: string
  orden?: number
  activo?: boolean
  cadena: EslabonModeloJasWave[]
  creditosPorMil?: number
  maxTokens?: number
}
export type PruebaEslabonIA = { conexionId: string; modelo: string; razonamiento: RazonamientoIA; ok: boolean; ms: number; error?: string }
export type PlanIAAdmin = {
  id: string
  nombre: string
  descripcion: string
  creditosDia: number | null
  creditosMes: number | null
  peticionesMinuto: number
  /** Ids de modelos JasWave permitidos (vacío = todos). */
  modelos: string[]
  porDefecto: boolean
  usuarios?: number
}
export type DatosPlanIA = Omit<PlanIAAdmin, 'id' | 'usuarios'>
export type EstadoClaveIA = { enVuelo: number; enPausaHasta: number | null; usos: number; fallos: number; ultimoError?: string }
/** Clave del grupo de una conexión: nunca incluye el secreto. La principal tiene id `<conexión>:principal`. */
export type ClaveConexionIA = { id: string; etiqueta: string; activa: boolean; principal: boolean; estado: EstadoClaveIA | null }
export type ConsumoIAAdmin = {
  porModelo: { modelo: string; peticiones: number; fallos: number; creditos: number; tokens: number; msMedio: number }[]
  porUsuario: {
    usuarioId: string
    email: string
    esAdmin: boolean
    licencia: string | null
    plan: { id: string; nombre: string; asignado: boolean } | null
    dia: { usados: number; limite: number | null }
    mes: { usados: number; limite: number | null; peticiones: number }
  }[]
  porDia: { dia: string; creditos: number; peticiones: number }[]
}

/** Groove del catálogo tal como lo ve el administrador (sin los bytes del .mid). */
export type GrooveCatalogoAdmin = {
  id: string
  ruta: string
  estilo: string
  nombre: string
  tipo: string
  compas: string
  tempo: number
  compases: number
  intensidad: number
  etiquetas: string[]
  autor: string
  licencia: string
  revision: number
  sha256: string
  tamano: number
  activo: boolean
  creadoEn: string
  actualizadoEn: string
}
export type DatosGrooveAdmin = Partial<Pick<GrooveCatalogoAdmin, 'nombre' | 'estilo' | 'tipo' | 'compas' | 'tempo' | 'compases' | 'intensidad' | 'etiquetas' | 'autor' | 'licencia'>>
export type ResultadoLoteGrooves = { creados: string[]; reemplazados: string[]; sinCambios: string[]; errores: { archivo: string; error: string }[] }
export type SimilarPropuesta = { tipo: 'groove' | 'propuesta'; id: string; nombre: string; puntuacion: number; nivel: string }
export type PropuestaGrooveAdmin = {
  id: string
  usuarioId: string
  usuarios: string[]
  nombre: string
  estilo: string
  tipo: string
  compas: string
  tempo: number
  compases: number
  intensidad: number
  etiquetas: string[]
  autor: string
  licencia: string
  sha256: string
  huella: unknown
  estado: 'pendiente' | 'aprobada' | 'rechazada' | 'duplicada'
  vecesPropuesto: number
  similares: SimilarPropuesta[]
  notaAdmin: string
  grooveId: string | null
  consentimientoVersion: string
  consentimientoEn: string
  creadoEn: string
}
export type ComparacionGrooves = {
  resultado: { puntuacion: number; nivel: string; identica: boolean; desplazamiento: number }
  a: { nombre: string; huella: unknown }
  b: { nombre: string; huella: unknown }
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

  /** Descarga binaria autenticada (p. ej. el .mid de un groove para escucharlo). */
  async function pedirBytes(ruta: string): Promise<Uint8Array> {
    const t = await o.token()
    if (!t) throw new ErrorApiCliente(401, 'no_autenticado', 'inicia sesión para continuar')
    let r: Response
    try {
      r = await f(`${o.base}${ruta}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' })
    } catch {
      throw new ErrorApiCliente(0, 'sin_conexion', 'no se pudo contactar con el servidor de JasWave')
    }
    if (!r.ok) throw new ErrorApiCliente(r.status, 'error', `error ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
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
        // Grupo de claves de una conexión (solo escritura: nunca vuelven al cliente).
        claves: (id: string) => pedir<{ claves: ClaveConexionIA[] }>('GET', `/admin/ia/proveedores/${enc(id)}/claves`).then((r) => r.claves),
        agregarClave: (id: string, apiKey: string, etiqueta = '') =>
          pedir<{ ok: true }>('POST', `/admin/ia/proveedores/${enc(id)}/claves`, { apiKey, etiqueta }),
        cambiarClave: (id: string, claveId: string, cambios: { activa?: boolean; etiqueta?: string }) =>
          pedir<{ ok: true }>('PUT', `/admin/ia/proveedores/${enc(id)}/claves/${enc(claveId)}`, cambios),
        quitarClave: (id: string, claveId: string) => pedir<void>('DELETE', `/admin/ia/proveedores/${enc(id)}/claves/${enc(claveId)}`),
        // Modelos JasWave (los que ven los usuarios; «auto» es virtual y lo gestiona el servidor).
        modelos: () => pedir<{ modelos: ModeloJasWaveAdmin[] }>('GET', '/admin/ia/modelos').then((r) => r.modelos),
        guardarModelo: (id: string, d: DatosModeloJasWave) =>
          pedir<{ modelo: ModeloJasWaveAdmin }>('PUT', `/admin/ia/modelos/${enc(id)}`, d).then((r) => r.modelo),
        probarModelo: (id: string) =>
          pedir<{ eslabones: PruebaEslabonIA[] }>('POST', `/admin/ia/modelos/${enc(id)}/probar`).then((r) => r.eslabones),
        eliminarModelo: (id: string) => pedir<void>('DELETE', `/admin/ia/modelos/${enc(id)}`),
        // Planes de IA y su asignación a usuarios.
        planes: () => pedir<{ planes: PlanIAAdmin[] }>('GET', '/admin/ia/planes').then((r) => r.planes),
        crearPlan: (d: DatosPlanIA) => pedir<{ plan: PlanIAAdmin }>('POST', '/admin/ia/planes', d).then((r) => r.plan),
        actualizarPlan: (id: string, d: DatosPlanIA) => pedir<{ plan: PlanIAAdmin }>('PUT', `/admin/ia/planes/${enc(id)}`, d).then((r) => r.plan),
        eliminarPlan: (id: string) => pedir<void>('DELETE', `/admin/ia/planes/${enc(id)}`),
        asignarPlan: (usuarioId: string, planId: string | null) => pedir<{ ok: true }>('PUT', `/admin/ia/usuarios/${enc(usuarioId)}/plan`, { planId }),
        consumo: (dias = 30) => pedir<ConsumoIAAdmin>('GET', `/admin/ia/consumo?dias=${dias}`),
      },
      // Catálogo de grooves MIDI que se sincroniza con las apps de los usuarios, y propuestas de los usuarios.
      grooves: {
        listar: () => pedir<{ revision: number; grooves: GrooveCatalogoAdmin[] }>('GET', '/admin/grooves'),
        crear: (d: DatosGrooveAdmin & { nombre: string; estilo: string; base64: string }) =>
          pedir<{ groove: GrooveCatalogoAdmin }>('POST', '/admin/grooves', d).then((r) => r.groove),
        lote: (d: { archivos?: { nombre: string; carpeta?: string; base64: string }[]; zip?: string; estilo?: string; reemplazar?: boolean }) =>
          pedir<ResultadoLoteGrooves>('POST', '/admin/grooves/lote', d),
        editar: (id: string, d: DatosGrooveAdmin) => pedir<{ groove: GrooveCatalogoAdmin }>('PUT', `/admin/grooves/${enc(id)}`, d).then((r) => r.groove),
        reemplazarArchivo: (id: string, base64: string) =>
          pedir<{ groove: GrooveCatalogoAdmin }>('PUT', `/admin/grooves/${enc(id)}/archivo`, { base64 }).then((r) => r.groove),
        activar: (id: string, activo: boolean) => pedir<{ groove: GrooveCatalogoAdmin }>('PUT', `/admin/grooves/${enc(id)}/activo`, { activo }).then((r) => r.groove),
        borrar: (id: string) => pedir<void>('DELETE', `/admin/grooves/${enc(id)}`),
        renombrarEstilo: (actual: string, nuevo: string) => pedir<{ cambiados: number }>('POST', '/admin/grooves/estilos/renombrar', { actual, nuevo }),
        archivo: (id: string) => pedirBytes(`/admin/grooves/${enc(id)}/archivo`),
        propuestas: (filtro: { estado?: string; vista?: string } = {}) => {
          const q = new URLSearchParams(Object.entries(filtro).filter(([, v]) => v) as [string, string][]).toString()
          return pedir<{ propuestas: PropuestaGrooveAdmin[]; grupos: string[][] }>('GET', `/admin/grooves/propuestas${q ? `?${q}` : ''}`)
        },
        archivoPropuesta: (id: string) => pedirBytes(`/admin/grooves/propuestas/${enc(id)}/archivo`),
        compararPropuesta: (id: string, tipo: 'groove' | 'propuesta', con: string) =>
          pedir<ComparacionGrooves>('GET', `/admin/grooves/propuestas/${enc(id)}/comparar?tipo=${tipo}&con=${enc(con)}`),
        aprobarPropuesta: (id: string, d: { cambios?: DatosGrooveAdmin; varianteDe?: string; nota?: string } = {}) =>
          pedir<{ propuesta: PropuestaGrooveAdmin; grooveId: string }>('POST', `/admin/grooves/propuestas/${enc(id)}/aprobar`, d),
        rechazarPropuesta: (id: string, nota = '') => pedir<{ propuesta: PropuestaGrooveAdmin }>('POST', `/admin/grooves/propuestas/${enc(id)}/rechazar`, { nota }),
        duplicadaPropuesta: (id: string, nota = '', de?: string) =>
          pedir<{ propuesta: PropuestaGrooveAdmin }>('POST', `/admin/grooves/propuestas/${enc(id)}/marcar-duplicada`, { nota, ...(de ? { de } : {}) }),
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
