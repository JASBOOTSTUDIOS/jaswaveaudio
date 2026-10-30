/**
 * Periodos de cuota (día y mes) en la zona horaria del servicio (`IA_ZONA_HORARIA`, IANA; por defecto UTC).
 */

function desfaseMin(fecha: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zona, timeZoneName: 'longOffset' }).formatToParts(fecha);
  const t = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(t);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

function partesEnZona(fecha: Date, zona: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zona, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** Instante UTC de la medianoche local (y, m, d) en la zona. */
function medianoche(y: number, m: number, d: number, zona: string): Date {
  const aprox = new Date(Date.UTC(y, m - 1, d));
  return new Date(aprox.getTime() - desfaseMin(aprox, zona) * 60_000);
}

export type Periodos = { inicioDia: Date; finDia: Date; inicioMes: Date; finMes: Date };

export function periodosDe(ahora: Date, zona = 'UTC'): Periodos {
  let z = zona;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
  } catch {
    z = 'UTC';
  }
  const { y, m, d } = partesEnZona(ahora, z);
  const inicioDia = medianoche(y, m, d, z);
  const manana = new Date(Date.UTC(y, m - 1, d + 1));
  const finDia = medianoche(manana.getUTCFullYear(), manana.getUTCMonth() + 1, manana.getUTCDate(), z);
  const inicioMes = medianoche(y, m, 1, z);
  const sig = new Date(Date.UTC(y, m, 1));
  const finMes = medianoche(sig.getUTCFullYear(), sig.getUTCMonth() + 1, 1, z);
  return { inicioDia, finDia, inicioMes, finMes };
}
