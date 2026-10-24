/**
 * npx tsx --test electron/plugins/firma-paquete.test.ts
 * La firma del backend (POST /catalogo/firmar-paquete) la verifica el DAW con el mismo formato.
 */
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { describe, it } from 'node:test'
import { firmarPaquete as firmarEnBackend } from '../../../backend/src/catalog/firma-paquete'
import { firmarPaquete, mensajeFirma, verificarFirmaPaquete } from './firma-paquete'

const par = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return { privada: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publica: publicKey.export({ type: 'spki', format: 'pem' }).toString() }
}
const h = (c: string) => c.repeat(64)
const archivos = { 'jaswave-plugin.json': h('a'), 'dist/index.js': h('b'), 'dist/chunks/x.js': h('c') }
const esperado = { id: 'com.jaswave.modulo.prueba', version: '1.0.0' }

describe('firma de paquetes .jwx (X1)', () => {
  it('el mensaje firmado no depende del orden de las rutas', () => {
    const invertido = Object.fromEntries(Object.entries(archivos).reverse())
    assert.deepEqual(mensajeFirma('a.b.c', '1.0.0', archivos), mensajeFirma('a.b.c', '1.0.0', invertido))
  })

  it('lo que firma el backend lo acepta el DAW', () => {
    const k = par()
    const f = firmarEnBackend(esperado.id, esperado.version, archivos, k.privada)
    const r = verificarFirmaPaquete(JSON.stringify(f), esperado, archivos, [k.publica])
    assert.equal(r.estado, 'valida')
    assert.deepEqual(firmarPaquete(esperado.id, esperado.version, archivos, k.privada).firma, f.firma)
  })

  it('rechaza otra clave, otro paquete, archivos de más o de menos y hashes cambiados', () => {
    const k = par()
    const otra = par()
    const texto = JSON.stringify(firmarPaquete(esperado.id, esperado.version, archivos, k.privada))
    const motivo = (r: ReturnType<typeof verificarFirmaPaquete>) => (r.estado === 'invalida' ? r.motivo : r.estado)
    assert.match(motivo(verificarFirmaPaquete(texto, esperado, archivos, [otra.publica])), /no es de JasWave/)
    assert.match(motivo(verificarFirmaPaquete(texto, { ...esperado, version: '1.0.1' }, archivos, [k.publica])), /otro paquete/)
    assert.match(motivo(verificarFirmaPaquete(texto, esperado, { ...archivos, 'dist/troyano.js': h('d') }, [k.publica])), /no firmado/)
    const { ['dist/chunks/x.js']: _fuera, ...menos } = archivos
    assert.match(motivo(verificarFirmaPaquete(texto, esperado, menos, [k.publica])), /falta/)
    assert.match(motivo(verificarFirmaPaquete(texto, esperado, { ...archivos, 'dist/index.js': h('e') }, [k.publica])), /modificado/)
    assert.equal(verificarFirmaPaquete(null, esperado, archivos, [k.publica]).estado, 'ausente')
    assert.match(motivo(verificarFirmaPaquete('{', esperado, archivos, [k.publica])), /JSON/)
    // la segunda clave (pruebas en desarrollo) también vale si la primera no
    assert.equal(verificarFirmaPaquete(texto, esperado, archivos, [otra.publica, k.publica]).estado, 'valida')
  })
})
