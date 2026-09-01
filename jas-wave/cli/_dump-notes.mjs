const BASE='http://127.0.0.1:18787'
const state=await (await fetch(BASE+'/state')).then(r=>r.json())
console.log('tracks', state.tracks?.length, 'bpm', state.bpm)
for (const t of state.tracks||[]) {
  const c=t.clips?.[0]
  const notas=c?.notas
  const arr = Array.isArray(notas) ? notas : (notas && typeof notas==='object' ? Object.values(notas) : [])
  console.log(t.nombre, 'notasType', typeof notas, 'isArr', Array.isArray(notas), 'len', arr.length, 'clipInicio', c?.inicio, 'clipDur', c?.duracion)
  if (arr.length) {
    const starts=arr.map(n=>Number(n.inicio||0)).sort((a,b)=>a-b)
    const by={}
    for (const s of starts) { const k=Math.floor(s); by[k]=(by[k]||0)+1 }
    console.log('  beats', starts[0],'→',starts.at(-1), 'byBeatBucket', by)
  } else {
    console.log('  rawNotas', JSON.stringify(notas)?.slice(0,120))
  }
}
