/**
 * U-maestra F3a: fichas curadas de paneles y diálogos para principiantes.
 * Valida el esquema, que sustituyan a una ficha generada, que cubran todo el inventario y que cada
 * control con `ayuda` exista de verdad como data-testid / data-ayuda en el código.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { formatearErrores, validarFichas, type FichaAyuda } from '@jaswave/host-sdk'
import { fichasGeneradas } from '../src/ayuda/cargador'
import { fichasDialogos } from '../src/ayuda/curado/dialogos'
import { fichasPaneles } from '../src/ayuda/curado/paneles'

const todas: FichaAyuda[] = [...fichasPaneles, ...fichasDialogos]
const generadas = fichasGeneradas()
const idsGeneradas = new Set(generadas.map((f) => f.id))
const idsTodas = new Set([...idsGeneradas, ...todas.map((f) => f.id)])

describe('fichas curadas de paneles y diálogos', () => {
  it('validan con validarFichas junto a las generadas (sin ids duplicados ni relacionadas rotas)', () => {
    const errores = validarFichas([...todas])
    // Las relacionadas pueden apuntar a generadas o a curadas de otros archivos: se comprueba contra el conjunto fusionado.
    const propios = errores.filter((e) => !(e.campo === 'relacionadas' && idsTodas.has(/«(.+)»/.exec(e.mensaje)?.[1] ?? '')))
    assert.deepEqual(propios, [], formatearErrores(propios))
    const fusionadas = [...generadas.filter((g) => !todas.some((c) => c.id === g.id)), ...todas]
    const errFusion = validarFichas(fusionadas)
    assert.deepEqual(errFusion, [], formatearErrores(errFusion))
  })

  it('cada curada sustituye a una ficha generada existente', () => {
    const huerfanas = todas.filter((f) => !idsGeneradas.has(f.id)).map((f) => f.id)
    assert.deepEqual(huerfanas, [], `Ids curados sin ficha generada: ${huerfanas.join(', ')}`)
  })

  it('cubren todos los panel:* y pantalla:* del inventario generado', () => {
    const faltan = generadas
      .filter((g) => g.id.startsWith('panel:') || g.id.startsWith('pantalla:'))
      .filter((g) => !todas.some((c) => c.id === g.id))
      .map((g) => g.id)
    assert.deepEqual(faltan, [], `Faltan fichas curadas para: ${faltan.join(', ')}`)
  })

  it('los paneles son tipo panel y los diálogos tipo pantalla, todos curados', () => {
    for (const f of fichasPaneles) assert.equal(f.tipo, 'panel', f.id)
    for (const f of fichasDialogos) assert.equal(f.tipo, 'pantalla', f.id)
    for (const f of todas) assert.equal(f.fuente, 'curada', f.id)
  })

  it('toda ficha tiene al menos un paso, un resumen de 40+ caracteres, etiquetas y cómo abrirla', () => {
    for (const f of todas) {
      assert.ok((f.pasos?.length ?? 0) >= 1, `${f.id}: sin pasos`)
      assert.ok(f.pasos!.every((p) => p.trim().length > 15), `${f.id}: paso demasiado corto`)
      assert.ok(f.resumen.trim().length >= 40, `${f.id}: resumen demasiado corto`)
      assert.ok((f.etiquetas?.length ?? 0) >= 3, `${f.id}: pocas etiquetas`)
      assert.ok(f.comoAbrir && (f.comoAbrir.herramienta || f.comoAbrir.menu), `${f.id}: sin comoAbrir`)
    }
  })

  it('conserva el comoAbrir.herramienta de la ficha generada (lo usa abrir_pantalla)', () => {
    for (const f of todas) {
      const g = generadas.find((x) => x.id === f.id)
      if (g?.comoAbrir?.herramienta) assert.equal(f.comoAbrir?.herramienta, g.comoAbrir.herramienta, f.id)
    }
  })

  it('ningún texto menciona «Ctrl+K» (la paleta es Ctrl+Shift+P)', () => {
    for (const f of todas) assert.ok(!JSON.stringify(f).includes('Ctrl+K'), `${f.id} menciona Ctrl+K`)
    assert.equal(fichasDialogos.find((f) => f.id === 'pantalla:paleta')?.comoAbrir?.atajo, 'Ctrl+Shift+P')
  })

  it('las relacionadas no apuntan a la propia ficha ni se repiten', () => {
    for (const f of todas) {
      const r = f.relacionadas ?? []
      assert.ok(!r.includes(f.id), `${f.id} se relaciona consigo misma`)
      assert.equal(new Set(r).size, r.length, `${f.id}: relacionadas repetidas`)
    }
  })

  it('cada control con `ayuda` existe como data-testid o data-ayuda en el código', () => {
    const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const fuentes: string[] = []
    const recorrer = (dir: string) => {
      if (!existsSync(dir)) return
      for (const n of readdirSync(dir)) {
        if (n === 'node_modules' || n === 'dist' || n.startsWith('build')) continue
        const p = join(dir, n)
        const st = statSync(p)
        if (st.isDirectory()) recorrer(p)
        else if (/\.tsx$/.test(n) && !/\.test\./.test(n)) fuentes.push(readFileSync(p, 'utf8'))
      }
    }
    recorrer(join(raiz, 'jas-wave', 'components'))
    recorrer(join(raiz, 'jas-wave', 'src'))
    for (const m of readdirSync(join(raiz, 'plugins')).filter((d) => d.startsWith('com.jaswave.modulo.'))) recorrer(join(raiz, 'plugins', m, 'src'))
    const codigo = fuentes.join('\n')
    for (const f of todas)
      for (const c of f.controles ?? []) {
        const existe = codigo.includes(`data-testid="${c.ayuda}"`) || codigo.includes(`data-ayuda="${c.ayuda}"`)
        assert.ok(existe, `${f.id}: el control «${c.etiqueta}» usa el id «${c.ayuda}», que no existe en el código`)
      }
  })
})
