import {
  BoxGeometry, BufferGeometry, CapsuleGeometry, Color, DoubleSide, Group, Material, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, RingGeometry, SphereGeometry, TorusGeometry,
} from 'three'

/** Emissive tint used to highlight the selected part. */
export const SELECT_EMISSIVE = 0x8a2f08
const GLOW_COLOR = 0xff6a1f

export interface SuitModel {
  group: Group
  /** materials of the selectable parts, by part id; each mesh owns its own material */
  partMaterials: Readonly<Record<string, readonly MeshStandardMaterial[]>>
  /** the materials actually rendered on the pulsing chest sensor */
  sensorMaterials: readonly MeshStandardMaterial[]
  /** apply selection highlight and the sensor pulse for time `ms` */
  update(selectedId: string, ms: number, pulse?: boolean): void
  /** free every geometry and material this model created (including unused templates) */
  dispose(): void
}

/** Sensor glow intensity at time `ms`: 0.5 … 1.3, period ≈ 2.4 s. */
export const sensorIntensity = (ms: number) => 0.9 + Math.sin(ms / 380) * 0.4

/**
 * Build the low-poly EVA suit. Pure Three.js (no renderer / DOM), so it can be unit-tested.
 * Selectable parts get their own material instance so highlighting one part never tints another;
 * the chest sensor keeps its orange emissive when not selected and pulses in both states.
 */
export function buildSuitModel(): SuitModel {
  const templates: Material[] = []
  const owned = new Set<Material>()
  const geometries = new Set<BufferGeometry>()
  const tpl = <M extends Material>(m: M) => (templates.push(m), m)

  const suit = tpl(new MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.6, metalness: 0.02 }))
  const dark = tpl(new MeshStandardMaterial({ color: 0x3a3430, roughness: 0.7 }))
  const gold = tpl(new MeshStandardMaterial({ color: 0xd9962f, roughness: 0.12, metalness: 1 }))
  const glow = tpl(new MeshStandardMaterial({ color: GLOW_COLOR, emissive: GLOW_COLOR, emissiveIntensity: 1.2 }))

  const group = new Group()
  const partMaterials: Record<string, MeshStandardMaterial[]> = {}
  const baseEmissive = new Map<MeshStandardMaterial, Color>()
  const sensorMaterials: MeshStandardMaterial[] = []

  const mesh = (geo: BufferGeometry, mat: MeshStandardMaterial, p: [number, number, number], id?: string, rot?: [number, number, number]) => {
    geometries.add(geo)
    let material = mat
    if (id) {
      material = mat.clone()
      owned.add(material)
      ;(partMaterials[id] ||= []).push(material)
      baseEmissive.set(material, material.emissive.clone())
      if (mat === glow) sensorMaterials.push(material)
    }
    const m = new Mesh(geo, material)
    m.position.set(...p)
    if (rot) m.rotation.set(...rot)
    group.add(m)
    return m
  }

  mesh(new SphereGeometry(0.5, 40, 28), suit, [0, 1.95, 0], 'helmet')
  mesh(new SphereGeometry(0.515, 40, 28, Math.PI / 2 - 1.05, 2.1, 0.55, 1.7), gold, [0, 1.95, 0.01], 'helmet')
  mesh(new TorusGeometry(0.34, 0.05, 12, 32), dark, [0, 1.52, 0], undefined, [Math.PI / 2, 0, 0])
  mesh(new CapsuleGeometry(0.46, 0.55, 8, 24), suit, [0, 1.1, 0])
  mesh(new BoxGeometry(0.78, 1.0, 0.42), suit, [0, 1.2, -0.52], 'plss')
  mesh(new BoxGeometry(0.58, 0.18, 0.1), dark, [0, 1.55, -0.76], 'plss')
  mesh(new BoxGeometry(0.22, 0.16, 0.05), glow, [0.18, 1.3, 0.45], 'chest')
  mesh(new BoxGeometry(0.3, 0.2, 0.05), dark, [-0.12, 1.2, 0.45])
  mesh(new CapsuleGeometry(0.17, 0.5, 8, 16), suit, [0.68, 1.3, 0.04], undefined, [0, 0, 0.35])
  mesh(new CapsuleGeometry(0.17, 0.5, 8, 16), suit, [-0.68, 1.3, 0.04], undefined, [0, 0, -0.35])
  mesh(new CapsuleGeometry(0.15, 0.4, 8, 16), suit, [0.9, 0.82, 0.12], undefined, [0.3, 0, 0.18])
  mesh(new CapsuleGeometry(0.15, 0.4, 8, 16), suit, [-0.9, 0.82, 0.12], undefined, [0.3, 0, -0.18])
  mesh(new SphereGeometry(0.17, 20, 16), dark, [0.96, 0.52, 0.2], 'gloves')
  mesh(new SphereGeometry(0.17, 20, 16), dark, [-0.96, 0.52, 0.2], 'gloves')
  mesh(new CapsuleGeometry(0.2, 0.7, 8, 20), suit, [0.26, 0.2, 0])
  mesh(new CapsuleGeometry(0.2, 0.7, 8, 20), suit, [-0.26, 0.2, 0])
  mesh(new BoxGeometry(0.3, 0.2, 0.52), dark, [0.26, -0.28, 0.08], 'boots')
  mesh(new BoxGeometry(0.3, 0.2, 0.52), dark, [-0.26, -0.28, 0.08], 'boots')

  const ringGeo = new RingGeometry(1.05, 1.07, 96)
  const ringMat = new MeshBasicMaterial({ color: GLOW_COLOR, transparent: true, opacity: 0.55, side: DoubleSide })
  geometries.add(ringGeo)
  owned.add(ringMat)
  const ring = new Mesh(ringGeo, ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = -0.4
  group.add(ring)

  const sensorSet = new Set(sensorMaterials)
  let disposed = false

  return {
    group,
    partMaterials,
    sensorMaterials,
    update(selectedId, ms, pulse = true) {
      for (const id in partMaterials) {
        for (const m of partMaterials[id]) {
          if (sensorSet.has(m)) {
            // the sensor always glows orange; selection brightens it via intensity, not colour
            m.emissive.setHex(GLOW_COLOR)
            const base = pulse ? sensorIntensity(ms) : 0.9
            m.emissiveIntensity = id === selectedId ? base + 0.5 : base
          } else if (id === selectedId) {
            m.emissive.setHex(SELECT_EMISSIVE)
          } else {
            m.emissive.copy(baseEmissive.get(m)!)
          }
        }
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      geometries.forEach((g) => g.dispose())
      owned.forEach((m) => m.dispose())
      templates.forEach((m) => m.dispose())
      group.clear()
    },
  }
}
