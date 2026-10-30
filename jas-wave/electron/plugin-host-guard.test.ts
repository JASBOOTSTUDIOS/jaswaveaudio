import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { PathGrants } from './path-grants'
import { checkHostCommand, clearAnalysisRoot, setAnalysisRoot } from './plugin-host-guard'

function grants() {
  const g = new PathGrants({ platform: 'win32' })
  g.grant('C:\\Program Files\\Common Files\\VST3', 'read')
  g.grant('D:\\Proyectos\\cancion', 'readwrite')
  return g
}

describe('plugin-host-guard', () => {
  it('rechaza comandos desconocidos', () => {
    assert.equal(checkHostCommand({ type: 'exec' }, grants()).ok, false)
    assert.equal(checkHostCommand({}, grants()).ok, false)
  })

  it('load solo desde raíces VST concedidas y con extensión de plugin', () => {
    const g = grants()
    assert.equal(checkHostCommand({ type: 'load', path: 'C:\\Program Files\\Common Files\\VST3\\Synth.vst3' }, g).ok, true)
    assert.equal(checkHostCommand({ type: 'load', path: 'C:\\Users\\me\\Downloads\\evil.dll' }, g).ok, false)
    assert.equal(checkHostCommand({ type: 'load', path: 'C:\\Program Files\\Common Files\\VST3\\x.exe' }, g).ok, false)
  })

  it('render solo a carpetas con escritura', () => {
    const g = grants()
    assert.equal(checkHostCommand({ type: 'renderOfflineStart', outPath: 'D:\\Proyectos\\cancion\\mix.wav' }, g).ok, true)
    assert.equal(checkHostCommand({ type: 'renderOfflineStart', outPath: 'C:\\Windows\\mix.wav' }, g).ok, false)
  })

  it('los stems del export necesitan escritura en cada ruta', () => {
    const g = grants()
    const base = { type: 'renderOfflineStart', outPath: 'D:\\Proyectos\\cancion\\mix.wav' }
    const ok = checkHostCommand(
      { ...base, stemOuts: '0|D:\\Proyectos\\cancion\\mix-stems\\01 - Bajo.wav;3|D:\\Proyectos\\cancion\\mix-stems\\04 - Voz.wav' },
      g,
    )
    assert.equal(ok.ok, true)
    assert.equal(checkHostCommand({ ...base, stemOuts: '0|C:\\Windows\\x.wav' }, g).ok, false)
    assert.equal(checkHostCommand({ ...base, stemOuts: 'x|D:\\Proyectos\\cancion\\a.wav' }, g).ok, false)
    assert.equal(checkHostCommand({ ...base, stemOuts: '0|D:\\Proyectos\\cancion\\a.exe' }, g).ok, false)
  })

  it('permite comandos sin rutas', () => {
    assert.equal(checkHostCommand({ type: 'noteOn', note: 60 }, grants()).ok, true)
    assert.equal(checkHostCommand({ type: 'clip.load', clipId: 'a', pcmBase64: '' }, grants()).ok, true)
  })
})

describe('plugin-host-guard: renders de análisis (A7b)', () => {
  const raiz = 'C:\\Users\\me\\AppData\\Roaming\\JasWave\\analysis'
  setAnalysisRoot(raiz)
  after(() => clearAnalysisRoot())

  it('admite analysis:true con outDir dentro de userData/analysis', () => {
    const r = checkHostCommand(
      { type: 'renderOfflineStart', analysis: true, outDir: `${raiz}\\job1`, tap: 'post', tapStems: 'all' },
      grants(),
    )
    assert.equal(r.ok, true)
  })

  it('rechaza outDir fuera de la raíz de análisis', () => {
    const fuera = checkHostCommand(
      { type: 'renderOfflineStart', analysis: true, outDir: 'D:\\Proyectos\\cancion\\analisis' },
      grants(),
    )
    assert.equal(fuera.ok, false)
    const escape = checkHostCommand(
      { type: 'renderOfflineStart', analysis: true, outDir: `${raiz}\\..\\..\\otro` },
      grants(),
    )
    assert.equal(escape.ok, false)
  })

  it('rechaza outDir sin analysis:true', () => {
    const r = checkHostCommand({ type: 'renderOfflineStart', outDir: `${raiz}\\job1` }, grants())
    assert.equal(r.ok, false)
  })

  it('rechaza analysis sin outDir', () => {
    const r = checkHostCommand({ type: 'renderOfflineStart', analysis: true }, grants())
    assert.equal(r.ok, false)
  })

  it('con analysis el outPath opcional sigue necesitando escritura', () => {
    const ok = checkHostCommand(
      { type: 'renderOfflineStart', analysis: true, outDir: `${raiz}\\job1`, outPath: 'D:\\Proyectos\\cancion\\mix.wav' },
      grants(),
    )
    assert.equal(ok.ok, true)
    const mal = checkHostCommand(
      { type: 'renderOfflineStart', analysis: true, outDir: `${raiz}\\job1`, outPath: 'C:\\Windows\\mix.wav' },
      grants(),
    )
    assert.equal(mal.ok, false)
  })
})

import { expandirVariablesDeEntorno } from './plugin-host-guard'

describe('expandirVariablesDeEntorno', () => {
  const env = { LOCALAPPDATA: 'C:/Users/a/AppData/Local', CommonProgramFiles: 'C:/Program Files/Common Files' }
  it('expande variables sin distinguir mayúsculas y deja las desconocidas tal cual', () => {
    assert.equal(expandirVariablesDeEntorno('%LOCALAPPDATA%/Programs/Common/VST3', env), 'C:/Users/a/AppData/Local/Programs/Common/VST3')
    assert.equal(expandirVariablesDeEntorno('%commonprogramfiles%/VST3', env), 'C:/Program Files/Common Files/VST3')
    assert.equal(expandirVariablesDeEntorno('%NO_EXISTE%/VST3', env), '%NO_EXISTE%/VST3')
    assert.equal(expandirVariablesDeEntorno('D:/Studio/VST', env), 'D:/Studio/VST')
  })
})
