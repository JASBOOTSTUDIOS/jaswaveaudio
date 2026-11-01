/**
 * Siembra el catálogo de grooves del servidor con los MIDI de serie (plugins/grooves/estilos, 136 grooves CC0).
 * Lo ejecuta el administrador, una vez o cuando regenere los grooves:
 *
 *   npm run grooves:sembrar                      # crea los que falten; no toca los que ya existen
 *   npm run grooves:sembrar -- --reemplazar      # además actualiza los que cambiaron (sube su revisión)
 *   npm run grooves:sembrar -- --dir ../plugins/grooves --simular
 *
 * Usa los mismos ids, rutas y metadatos de `catalogo.json` y `groove.json`, así las apps que ya traen esos
 * grooves de serie los reconocen como los del catálogo y no los descargan otra vez.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearDb } from '../src/db.js';
import { crearServicioGrooves } from '../src/grooves/servicio.js';
import { esquemaMetadatos } from '../src/grooves/validacion.js';

const args = process.argv.slice(2);
const bandera = (n: string) => args.includes(n);
const valor = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);

const aqui = dirname(fileURLToPath(import.meta.url));
const base = resolve(valor('--dir') ?? join(aqui, '..', '..', 'plugins', 'grooves'));
const estilos = join(base, 'estilos');
if (!existsSync(estilos)) {
  console.error(`No existe ${estilos}. Usa --dir <carpeta con estilos/ y catalogo.json>.`);
  process.exit(1);
}

type Crudo = Record<string, unknown>;
const leer = (p: string): Crudo | undefined => {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Crudo;
  } catch {
    return undefined;
  }
};
const catalogo = leer(join(base, 'catalogo.json')) as { grooves?: Array<{ id: string; ruta: string; revision: number }> } | undefined;
const porRuta = new Map((catalogo?.grooves ?? []).map((g) => [g.ruta, g]));

function* recorrer(dir: string, prefijo = ''): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefijo ? `${prefijo}/${e.name}` : e.name;
    if (e.isDirectory()) yield* recorrer(join(dir, e.name), rel);
    else if (/\.mid$/i.test(e.name)) yield rel;
  }
}

const db = crearDb();
const servicio = crearServicioGrooves({ db });
const actor = 'script-sembrar-grooves';
const simular = bandera('--simular');
const reemplazar = bandera('--reemplazar');

let creados = 0;
let actualizados = 0;
let iguales = 0;
const fallos: string[] = [];
const { grooves: existentes } = await servicio.listarAdmin();
const porId = new Map(existentes.map((g) => [g.id, g]));

for (const rel of recorrer(estilos)) {
  try {
    const partes = rel.split('/');
    const archivo = partes.pop()!.replace(/\.mid$/i, '');
    const estilo = partes.join('/');
    const bytes = readFileSync(join(estilos, rel));
    const carpeta = leer(join(estilos, ...partes, 'groove.json')) as ({ archivos?: Record<string, Crudo> } & Crudo) | undefined;
    const propios = carpeta?.archivos?.[`${archivo}.mid`] ?? {};
    const def: Crudo = { ...(carpeta ?? {}) };
    delete def.archivos;
    const m = { ...def, ...propios } as Crudo;
    const entrada = porRuta.get(rel);
    const id = (m.id as string | undefined) ?? entrada?.id;
    if (!id) throw new Error('sin id en groove.json ni en catalogo.json');
    const previo = porId.get(id);
    if (previo) {
      if (previo.sha256 === createHash('sha256').update(bytes).digest('hex')) iguales++;
      else if (reemplazar && !simular) {
        await servicio.reemplazarArchivo(actor, id, bytes);
        actualizados++;
      } else iguales++;
      continue;
    }
    const meta = esquemaMetadatos.partial().parse({
      nombre: m.nombre,
      tipo: m.tipo,
      compas: typeof m.compas === 'string' ? m.compas : undefined,
      tempo: m.tempo,
      compases: m.compases,
      intensidad: m.intensidad,
      etiquetas: m.etiquetas,
      autor: m.autor ?? 'JasWave',
      licencia: m.licencia ?? 'CC0-1.0',
    });
    if (!simular) await servicio.crear(actor, { ...meta, nombre: meta.nombre ?? archivo, estilo, id, archivo, contenido: bytes });
    creados++;
  } catch (e) {
    fallos.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`${simular ? '[simulación] ' : ''}creados: ${creados} · actualizados: ${actualizados} · sin cambios: ${iguales} · con error: ${fallos.length}`);
for (const f of fallos) console.log(`  - ${f}`);
await (db as unknown as { $disconnect: () => Promise<void> }).$disconnect();
process.exit(fallos.length ? 1 : 0);
