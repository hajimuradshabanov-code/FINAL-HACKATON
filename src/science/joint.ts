/**
 * Joint deviation: several vitals moving a little at once.
 *
 * A single-vital limit (|z| ≥ 3.5) misses a physiological change that shows up as two or three
 * moderate shifts — early hypoxia is SpO₂ slightly down with heart rate and breathing slightly up,
 * none of them alarming alone. The personal z-scores are combined into one statistic,
 *
 *     T² = Σ zᵢ²   over heart rate, SpO₂, core temperature and respiration
 *
 * the diagonal form of Hotelling's T² (Hotelling 1947; NIST/SEMATECH e-Handbook §6.5.4.3): with
 * independent standardised vitals it follows a χ² distribution with k degrees of freedom. The four
 * z-scores here are neither independent nor serially uncorrelated, so the limit is not taken from
 * the χ² table but tuned on undisturbed runs, like the single-vital limit (src/science/validation.ts).
 * A joint deviation is T² ≥ JOINT.limit for JOINT.persistS seconds.
 *
 * The direction of the z-vector is then compared (cosine similarity) with a few signatures of
 * known conditions, to say what the pattern looks like. The signatures are textbook physiology
 * written down by this app — a pointer for the crew, not a diagnosis.
 */
import type { BaselineKey, BaselineState } from './baseline'

export const JOINT = { limit: 10, persistS: 6, minVitals: 3, minSimilarity: 0.75 } as const
export const JOINT_KEYS = ['heartRate', 'spo2', 'bodyTemp', 'respRate'] as const satisfies readonly BaselineKey[]
const ORDER = ['heartRate', 'spo2', 'bodyTemp', 'respRate', 'suitPressure'] as const satisfies readonly BaselineKey[]

export interface Signature {
  id: string
  label: string
  /** expected direction of [heart rate, SpO₂, core temperature, respiration, suit pressure] */
  vector: readonly [number, number, number, number, number]
  why: string
  act: string
}

export const SIGNATURES: readonly Signature[] = [
  { id: 'hypoxia', label: 'Low-oxygen pattern', vector: [1, -1, 0, 1, 0], why: 'Falling oxygen saturation with a compensating rise in heart rate and breathing.', act: 'Check O₂ flow and the CO₂ scrubber, slow down, and be ready to switch to backup O₂.' },
  { id: 'heat', label: 'Heat-strain pattern', vector: [1, 0, 1, 1, 0], why: 'Core temperature, heart rate and breathing rising together.', act: 'Turn the cooling garment up one step and reduce the work rate.' },
  { id: 'leak', label: 'Pressure-loss pattern', vector: [0.5, -1, 0, 0.5, -1], why: 'Suit pressure and oxygen saturation falling together.', act: 'Inspect seals, head toward the airlock and run the leak checklist.' },
  { id: 'cold', label: 'Cold-stress pattern', vector: [-0.5, 0, -1, -0.5, 0], why: 'Core temperature falling with slowing heart rate and breathing.', act: 'Turn the cooling garment down, keep moving, and check glove and boot heaters.' },
]

export interface JointReading {
  t2: number
  /** vitals that contributed */
  n: number
  flagged: boolean
  forS: number
  /** z of each vital, for display: [heart rate, SpO₂, core temperature, respiration, suit pressure] */
  z: number[]
  match: { signature: Signature; similarity: number } | null
}

export function matchSignature(z: readonly number[]): JointReading['match'] {
  const norm = Math.hypot(...z)
  if (!(norm > 0)) return null
  let best: JointReading['match'] = null
  for (const s of SIGNATURES) {
    const sim = z.reduce((a, x, i) => a + x * s.vector[i], 0) / (norm * Math.hypot(...s.vector))
    if (!best || sim > best.similarity) best = { signature: s, similarity: sim }
  }
  return best && best.similarity >= JOINT.minSimilarity ? best : null
}

export class JointDetector {
  private beyondS = 0
  private lastT = 0

  update(t: number, b: BaselineState): JointReading {
    const dt = this.lastT ? Math.max(0, Math.min(5, (t - this.lastT) / 1000)) : 1
    this.lastT = t
    const z = ORDER.map((k) => (Number.isFinite(b[k].z) ? b[k].z : 0))
    const used = JOINT_KEYS.filter((k) => Number.isFinite(b[k].z))
    const t2 = used.reduce((a, k) => a + b[k].z ** 2, 0)
    const scored = used.length >= JOINT.minVitals
    this.beyondS = scored && t2 >= JOINT.limit ? this.beyondS + dt : 0
    const flagged = this.beyondS >= JOINT.persistS
    return { t2: scored ? t2 : NaN, n: used.length, flagged, forS: flagged ? this.beyondS : 0, z, match: flagged ? matchSignature(z) : null }
  }
}
