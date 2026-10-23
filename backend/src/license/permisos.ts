/**
 * Resolución de permisos efectivos de un usuario sobre un producto.
 * Regla: acciones = (acciones de roles ∪ concesiones allow) − concesiones deny,
 * ignorando concesiones expiradas. Solo aplica si la licencia está activa.
 */

export type EstadoLicenciaDominio = 'activa' | 'suspendida' | 'revocada';

export type ConcesionDominio = {
  accionClave: string;
  efecto: 'allow' | 'deny';
  expiraEn: Date | null;
};

export type EntradaPermisos = {
  estadoLicencia: EstadoLicenciaDominio | null;
  /** Acciones que otorgan los roles asignados al usuario para este producto. */
  accionesDeRoles: string[];
  concesiones: ConcesionDominio[];
  ahora: Date;
};

export function resolverAcciones(entrada: EntradaPermisos): string[] {
  if (entrada.estadoLicencia !== 'activa') return [];
  const vigentes = entrada.concesiones.filter((c) => !c.expiraEn || c.expiraEn.getTime() > entrada.ahora.getTime());
  const denegadas = new Set(vigentes.filter((c) => c.efecto === 'deny').map((c) => c.accionClave));
  const permitidas = new Set<string>([
    ...entrada.accionesDeRoles,
    ...vigentes.filter((c) => c.efecto === 'allow').map((c) => c.accionClave),
  ]);
  return [...permitidas].filter((a) => !denegadas.has(a)).sort();
}
