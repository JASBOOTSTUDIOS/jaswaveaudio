import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAN_MD } from '../plan/markdown'
import {
  aprobarPlan,
  diffPlans,
  hayPasosPendientes,
  isStructuredPlan,
  marcarPaso,
  parsePlan,
  planHash,
  serializePlan,
  siguientePasoPendiente,
  type PlanEstructurado,
} from '../plan/structured-plan'

const EJEMPLO = [
  '# Plan · Mejorar la mezcla del tema',
  '',
  '> Objetivo: subir el impacto del tema · Modo: create · Estado: borrador (2026-10-20) · Revisión: 3',
  '',
  '## Pasos',
  '- [x] S1 · Diagnóstico · @qa — Medir mezcla actual',
  '  - criterio: reporte audit.mix guardado',
  '  - evidencia: LUFS −17.2',
  '- [~] S2 · Mezcla · @ingeniero-mezcla — Gain staging de todas las pistas',
  '  - criterio: cada pista −18 ±3 dBFS RMS pre-fader',
  '  - herramientas: analysis.track, track.update, clip.gain',
  '- [ ] S3 · Mezcla · @ingeniero-mezcla — Limpiar 200–400 Hz en guitarras',
  '- [-] S4 · Master · @masterizacion — Compresor paralelo',
  '- [!] S5 · Efectos · @efectos — Reverb del pad',
  '  - bloqueado: falta decidir el tiempo',
  '',
  '## Notas del usuario',
  'Me gusta el verso 2. No tocar el final.',
].join('\n')

describe('parsePlan', () => {
  it('parsea el formato estructurado completo', () => {
    const plan = parsePlan(EJEMPLO)
    expect(plan).not.toBeNull()
    expect(plan!.titulo).toBe('Mejorar la mezcla del tema')
    expect(plan!.objetivo).toBe('subir el impacto del tema')
    expect(plan!.modo).toBe('create')
    expect(plan!.estadoPlan).toBe('borrador')
    expect(plan!.fecha).toBe('2026-10-20')
    expect(plan!.revision).toBe(3)
    expect(plan!.pasos).toHaveLength(5)

    const s1 = plan!.pasos[0]!
    expect(s1).toMatchObject({ id: 'S1', fase: 'Diagnóstico', agente: 'qa', titulo: 'Medir mezcla actual', estado: 'hecho' })
    expect(s1.criterios).toEqual(['reporte audit.mix guardado'])
    expect(s1.evidencia).toEqual(['LUFS −17.2'])

    const s2 = plan!.pasos[1]!
    expect(s2.estado).toBe('en-curso')
    expect(s2.herramientas).toEqual(['analysis.track', 'track.update', 'clip.gain'])

    expect(plan!.pasos[3]!.estado).toBe('omitido')
    const s5 = plan!.pasos[4]!
    expect(s5.estado).toBe('bloqueado')
    expect(s5.motivoBloqueo).toBe('falta decidir el tiempo')
    expect(plan!.notasUsuario).toContain('No tocar el final')
  })

  it('acepta el formato con dos puntos del prompt (# Plan: …)', () => {
    const md = ['# Plan: Crear intro', '> Objetivo: intro de 4 compases · Modo: plan · Estado: aprobado (2026-01-01) · Revisión: 1', '', '## Pasos', '- [ ] S1 · estructura · @coproductor — Crear pista Batería'].join('\n')
    const plan = parsePlan(md)!
    expect(plan.titulo).toBe('Crear intro')
    expect(plan.estadoPlan).toBe('aprobado')
    expect(plan.pasos[0]!.estado).toBe('pendiente')
  })

  it('es tolerante: línea sin id, sin agente y sin meta', () => {
    const md = ['# Plan · sin meta', '', '## Pasos', '- [ ] Ajustar volumen del bajo', '- [ ] S9 · general — Pasar a master'].join('\n')
    const plan = parsePlan(md)!
    expect(plan.modo).toBe('create')
    expect(plan.revision).toBe(0)
    expect(plan.pasos[0]).toMatchObject({ id: 'S1', agente: 'director', titulo: 'Ajustar volumen del bajo' })
    expect(plan.pasos[1]).toMatchObject({ id: 'S9', fase: 'general' })
  })

  it('devuelve null en el formato viejo (DEFAULT_PLAN_MD) y en textos sin Pasos', () => {
    expect(parsePlan(DEFAULT_PLAN_MD)).toBeNull()
    expect(parsePlan('hola, esto no es un plan')).toBeNull()
    expect(parsePlan('')).toBeNull()
    expect(parsePlan(null)).toBeNull()
  })

  it('isStructuredPlan distingue formatos', () => {
    expect(isStructuredPlan(EJEMPLO)).toBe(true)
    expect(isStructuredPlan(DEFAULT_PLAN_MD)).toBe(false)
  })
})

describe('serializePlan / round-trip', () => {
  it('serialize(parse(md)) conserva el contenido semántico', () => {
    const plan = parsePlan(EJEMPLO)!
    const out = parsePlan(serializePlan(plan))!
    expect(out).toEqual(plan)
  })

  it('serialize es estable (idempotente)', () => {
    const a = serializePlan(parsePlan(EJEMPLO)!)
    const b = serializePlan(parsePlan(a)!)
    expect(b).toBe(a)
  })

  it('conserva las notas del usuario sin reescribirlas', () => {
    const plan = parsePlan(EJEMPLO)!
    expect(serializePlan(plan)).toContain('Me gusta el verso 2. No tocar el final.')
  })
})

describe('planHash / diffPlans', () => {
  it('el hash no cambia al re-serializar y cambia al editar un paso', () => {
    const plan = parsePlan(EJEMPLO)!
    expect(planHash(serializePlan(plan))).toBe(planHash(plan))
    const editado = marcarPaso(plan, 'S3', 'hecho')
    expect(planHash(editado)).not.toBe(planHash(plan))
  })

  it('detecta añadidos, borrados y ediciones por id', () => {
    const a = parsePlan(EJEMPLO)!
    const mdNuevo = serializePlan({
      ...a,
      pasos: [
        a.pasos[0]!,
        a.pasos[1]!,
        { ...a.pasos[2]!, titulo: 'Limpiar 200–400 Hz en guitarras y pad' },
        { id: 'S6', fase: 'Efectos', agente: 'efectos', titulo: 'Delay del lead', estado: 'pendiente', criterios: [], herramientas: [], evidencia: [] },
      ],
    })
    const d = diffPlans(a, parsePlan(mdNuevo)!)
    expect(d.added.map((p) => p.id)).toEqual(['S6'])
    expect(d.removed.map((p) => p.id)).toEqual(['S4', 'S5'])
    expect(d.edited.map((p) => p.id)).toEqual(['S3'])
    expect(d.changed).toBe(true)
  })

  it('detecta reordenamiento', () => {
    const a = parsePlan(EJEMPLO)!
    const reordenado = { ...a, pasos: [a.pasos[1]!, a.pasos[0]!, ...a.pasos.slice(2)] }
    const d = diffPlans(a, reordenado)
    expect(d.reordered.length).toBeGreaterThan(0)
    expect(d.added).toHaveLength(0)
    expect(d.removed).toHaveLength(0)
    expect(d.changed).toBe(true)
  })

  it('dos parses del mismo texto dan diff sin cambios', () => {
    const d = diffPlans(parsePlan(EJEMPLO)!, parsePlan(EJEMPLO)!)
    expect(d.changed).toBe(false)
  })
})

describe('flujo de estados', () => {
  it('siguientePasoPendiente salta hecho/omitido/bloqueado/en-curso y respeta el orden', () => {
    const plan = parsePlan(EJEMPLO)!
    expect(siguientePasoPendiente(plan)?.id).toBe('S3')
    expect(hayPasosPendientes(plan)).toBe(true)
  })

  it('marcarPaso es inmutable y añade evidencia', () => {
    const plan = parsePlan(EJEMPLO)!
    const next = marcarPaso(plan, 'S3', 'hecho', { evidencia: ['LUFS −14.0'] })
    expect(plan.pasos[2]!.estado).toBe('pendiente')
    expect(next.pasos[2]!.estado).toBe('hecho')
    expect(next.pasos[2]!.evidencia).toEqual(['LUFS −14.0'])
  })

  it('aprobarPlan pasa a aprobado y sube la revisión', () => {
    const plan = parsePlan(EJEMPLO)!
    const ok = aprobarPlan(plan, '2026-10-21')
    expect(ok.estadoPlan).toBe('aprobado')
    expect(ok.revision).toBe(4)
    expect(ok.fecha).toBe('2026-10-21')
    expect(plan.estadoPlan).toBe('borrador')
  })

  it('un plan aprobado sin pasos pendientes no tiene trabajo que hacer', () => {
    const base: PlanEstructurado = {
      titulo: 't',
      objetivo: 'o',
      modo: 'auto',
      estadoPlan: 'aprobado',
      fecha: '',
      revision: 1,
      pasos: [],
      notasUsuario: '',
    }
    expect(hayPasosPendientes(base)).toBe(false)
  })
})
