/**
 * Eficiencia de la IA (plan N): perfil de tokens por etapa de una producción simulada (11 músicos, 10 secciones)
 * y guardas de equivalencia entre variantes. Sin modelo real ni dinero.
 *
 *   EFICIENCIA_INFORME=ruta.json npx tsx --tsconfig ../sdk/host-sdk/pruebas/tsconfig.pruebas.json --test test/eficiencia-ia.test.ts
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { simular, tokens, type Informe, type Variante } from './ayuda/simulacion-banda'

const NINGUNO = { herramientasPorRol: false, resultados: false, ensayoLimpio: false, qaMedible: false, qaPartesLimpias: false, diagnostico: false }
const solo = (k: string) => ({ ...NINGUNO, [k]: true })
const VARIANTES: Variante[] = [
  { nombre: 'antes', ahorro: false },
  { nombre: '+herramientas por rol', ahorro: solo('herramientasPorRol') },
  { nombre: '+resultados recortados/acuse', ahorro: solo('resultados') },
  { nombre: '+diagnóstico en escritura', ahorro: solo('diagnostico'), diagnostico: true },
  { nombre: '+ensayo solo con problemas', ahorro: solo('ensayoLimpio') },
  { nombre: '+QA mezcla/máster por medición', ahorro: solo('qaMedible') },
  { nombre: '+QA partes por medición', ahorro: { ...solo('qaPartesLimpias'), ensayoLimpio: false } },
  { nombre: '+armonía al escribir (auto)', ahorro: false, armonia: true },
  { nombre: '+armonía siempre ajusta', ahorro: false, armonia: { modo: 'ajustar', maxAjuste: 0.15 } },
  { nombre: '+armonía siempre rechaza', ahorro: false, armonia: { modo: 'rechazar', maxAjuste: 0.15 } },
  { nombre: 'TODO', ahorro: undefined, diagnostico: true, armonia: true },
]

describe('eficiencia: producción simulada', { timeout: 600_000 }, () => {
  const informes: Informe[] = []
  it('perfil por etapa y equivalencia de escrituras', async () => {
    for (const v of VARIANTES) informes.push(await simular(v))
    if (process.env.EFICIENCIA_INFORME) writeFileSync(process.env.EFICIENCIA_INFORME, JSON.stringify(informes, null, 1))
    const base = informes[0]!
    const fila = (i: Informe) => `| ${i.variante} | ${i.total.llamadas} | ${tokens(i.total.entrada).toLocaleString('es')} | ${tokens(i.total.cacheable).toLocaleString('es')} | ${(100 - (100 * i.total.entrada) / base.total.entrada).toFixed(1)} % |`
    console.log(['', '| variante | llamadas | tokens entrada | prefijo repetido (cacheable) | ahorro entrada |', '|---|---|---|---|---|'].join(String.fromCharCode(10)))
    for (const i of informes) console.log(fila(i))
    for (const i of [base, informes[informes.length - 1]!]) {
      console.log(['', `== ${i.variante}: ${i.estado} · ${i.etapas}`, '| etapa | llamadas | entrada | sistema | herramientas | historial | herr./llamada |', '|---|---|---|---|---|---|---|'].join(String.fromCharCode(10)))
      for (const [e, m] of Object.entries(i.porEtapa)) console.log(`| ${e} | ${m.llamadas} | ${tokens(m.entrada)} | ${tokens(m.sistema)} | ${tokens(m.herramientas)} | ${tokens(m.historial)} | ${(m.nHerramientas / m.llamadas).toFixed(1)} |`)
    }
    assert.ok(base.total.llamadas > 50)
    // Equivalencia: las mismas escrituras (herramienta + argumentos), la misma cobertura y la misma medición final.
    console.log(['', '| variante | arreglista (llamadas) | rechazos armonía | escrituras ajustadas | coherencia final |', '|---|---|---|---|---|'].join(String.fromCharCode(10)))
    for (const i of informes) console.log(`| ${i.variante} | ${i.llamadasArreglista} | ${i.rechazosArmonia} | ${i.ajustesArmonia} | ${i.coherenciaOk ? 'verde' : `roja (${i.coherenciaDetalles.length} avisos)`} |`)
    for (const i of informes.slice(1)) {
      assert.deepEqual(i.estructuras, base.estructuras, i.variante)
      if (!i.variante.includes('armonía') && i.variante !== 'TODO') assert.deepEqual(i.escrituras, base.escrituras, i.variante)
      assert.deepEqual(i.cobertura, base.cobertura, i.variante)
      if (!i.variante.includes('armonía') && i.variante !== 'TODO') assert.equal(i.coherenciaOk, base.coherenciaOk, i.variante)
    }
  })
})
