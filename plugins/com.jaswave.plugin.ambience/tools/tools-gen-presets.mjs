// Genera src/ambience_presets.h desde presets-jasboot.json (17 presets worship de Jasboot FX) más presets propios.
import fs from 'node:fs'
const src = JSON.parse(fs.readFileSync(new URL('./presets-jasboot.json', import.meta.url), 'utf8'))
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const NOTE_ID = { Room: 0 }
function map(p) {
  const on = (f) => (f ? 1 : 0)
  const o = []
  const add = (id, v) => o.push([id, +(+v).toFixed(3)])
  add('kRevMix', p.revMix * 100); add('kRevSize', clamp(0.6 + p.room * 6.4, 0.4, 12)); add('kRevDamp', p.damping * 100)
  add('kRevWidth', p.width * 100); add('kRevPre', p.preDelay); add('kRevLow', p.lowCut); add('kRevHigh', p.highCut)
  add('kRevMod', 30); add('kRevAttack', p.inSwell ? 350 : 0); add('kFreeze', 0)
  add('kDlyMix', on(p.inDelay) * p.delayMix * 100); add('kDlyTime', p.delayMs); add('kDlyNote', p.delayNote)
  add('kDlyFb', clamp(p.delayFb, 0, 0.9) * 100); add('kDlyTone', p.delayTone * 100); add('kDlyMod', p.delayMod * 100)
  add('kPing', p.delayPingPong); add('kDlyAttack', p.inSwell ? 200 : 0)
  add('kShMix', on(p.inShimmer) * p.shimmerMix * 100); add('kShSize', p.shimmerSize * 100); add('kShBlend', clamp(p.shimmerPitch * 100 + 25, 0, 100))
  add('kShTone', 60); add('kShAttack', 500); add('kShInterval', 0)
  add('kSwAttack', p.swellAttack); add('kSwDepth', on(p.inSwell) * p.swellDepth * 100); add('kComp', on(p.inComp) * p.comp * 100)
  add('kTremMix', 0); add('kTremRate', 4.5); add('kTremDepth', 50)
  add('kDrive', Math.max(p.drive, on(p.inDistortion) * p.distortion * 0.8) * 100); add('kDriveTone', p.distTone * 100); add('kDriveLevel', 50)
  add('kChMix', on(p.inChorus) * p.chorusMix * 100); add('kChRate', p.chorusRate); add('kChDepth', p.chorusDepth * 100)
  add('kEqLow', on(p.inEq) * p.eqLow); add('kEqMid', on(p.inEq) * p.eqMid); add('kEqHigh', on(p.inEq) * p.eqHigh)
  add('kWidth', 100); add('kBassMono', 0)
  return o
}
const own = [
  { name: 'Piano · Sala cálida', v: { kRevMix: 26, kRevSize: 2.6, kRevDamp: 48, kRevWidth: 105, kRevPre: 24, kRevLow: 110, kRevHigh: 9500, kRevMod: 25, kRevAttack: 0, kDlyMix: 0, kEqLow: 1, kEqHigh: -1, kWidth: 105 } },
  { name: 'Pad · Infinito (freeze)', v: { kRevMix: 70, kRevSize: 9, kRevDamp: 52, kRevWidth: 130, kRevPre: 40, kRevLow: 140, kRevHigh: 8000, kRevMod: 60, kFreeze: 0, kShMix: 22, kShSize: 55, kShBlend: 55, kShAttack: 700, kWidth: 130, kEqHigh: -2 } },
  { name: 'Plate brillante', v: { kRevMix: 30, kRevSize: 1.6, kRevDamp: 22, kRevWidth: 120, kRevPre: 8, kRevLow: 180, kRevHigh: 14000, kRevMod: 18, kEqHigh: 1.5, kWidth: 110 } },
  { name: 'Guitarra · Delay punteado', v: { kRevMix: 34, kRevSize: 3.2, kRevDamp: 42, kRevPre: 30, kDlyMix: 34, kDlyNote: 4, kDlyFb: 38, kDlyTone: 46, kDlyMod: 12, kPing: 1, kDlyAttack: 120, kEqLow: -1, kWidth: 115 } },
]
const base = map({ revMix: 0, room: 0.3, damping: 0.4, width: 1, preDelay: 20, lowCut: 120, highCut: 10000, delayMs: 480, delayMix: 0, delayFb: 0.35, delayMod: 0.2, delayTone: 0.5, delayNote: 0, swellAttack: 900, swellDepth: 0, chorusRate: 0.45, chorusDepth: 0.5, chorusMix: 0, shimmerMix: 0, shimmerSize: 0.5, shimmerPitch: 0.35, comp: 0, distortion: 0, distTone: 0.5, drive: 0, cabTone: 0.5, eqLow: 0, eqMid: 0, eqHigh: 0, inSwell: 0, inChorus: 0, inComp: 0, inDelay: 0, inShimmer: 0, inReverb: 1, inDistortion: 0, inCab: 0, inEq: 0, delayPingPong: 1 })
const all = [...src.map((p) => ({ name: p.name, vals: map(p) })), ...own.map((p) => ({ name: p.name, vals: base.map(([id, v]) => [id, id in p.v ? p.v[id] : v]) }))]
let out = '// Generado por tools-gen-presets.mjs: no editar a mano (los 17 primeros provienen de Jasboot FX)\n#pragma once\n#include <cstdint>\nnamespace JasWaveAmbience {\nstruct PresetValue { uint32_t id; double v; };\nstruct PresetDef { const wchar_t* name; const PresetValue* values; int count; };\n'
all.forEach((p, i) => { out += `static const PresetValue kPreset${i}[] = { ${p.vals.map(([id, v]) => `{ ${id}, ${v} }`).join(', ')} };\n` })
out += `static const PresetDef kPresetDefs[] = {\n${all.map((p, i) => `  { L"${p.name.replace(/"/g, '')}", kPreset${i}, ${p.vals.length} }`).join(',\n')}\n};\nconstexpr int kNumPresetDefs = ${all.length};\n} // namespace JasWaveAmbience\n`
fs.writeFileSync(new URL('./src/ambience_presets.h', import.meta.url), out)
console.log(all.length + ' presets: ' + all.map((p) => p.name).join(' | '))
