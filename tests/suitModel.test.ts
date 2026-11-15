import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Mesh, type Material } from 'three'
import { SELECT_EMISSIVE, buildSuitModel, sensorIntensity } from '../src/components/suitModel'

const meshes = (m: ReturnType<typeof buildSuitModel>) => m.group.children.filter((o): o is Mesh => o instanceof Mesh)

test('the pulsing material is the one actually rendered on the chest sensor mesh', () => {
  const model = buildSuitModel()
  assert.equal(model.sensorMaterials.length, 1)
  const sensor = model.sensorMaterials[0]
  const onMesh = meshes(model).filter((m) => m.material === sensor)
  assert.equal(onMesh.length, 1, 'sensor material is attached to exactly one mesh')
  assert.ok(model.partMaterials.chest.includes(sensor))
})

test('sensor pulses over time and stays orange when not selected', () => {
  const model = buildSuitModel()
  const sensor = model.sensorMaterials[0]
  const seen = new Set<number>()
  for (let ms = 0; ms < 2400; ms += 200) {
    model.update('helmet', ms)
    assert.equal(sensor.emissive.getHex(), 0xff6a1f, 'not black when another part is selected')
    assert.ok(Math.abs(sensor.emissiveIntensity - sensorIntensity(ms)) < 1e-9)
    seen.add(Math.round(sensor.emissiveIntensity * 100))
  }
  assert.ok(seen.size > 5, 'intensity actually changes')
  model.update('chest', 0)
  assert.ok(sensor.emissiveIntensity > sensorIntensity(0), 'selection brightens the sensor')
  model.update('chest', 0, false)
  assert.equal(sensor.emissiveIntensity, 0.9 + 0.5, 'reduced motion: steady glow')
})

test('selection highlight is applied and removed per part; parts never share materials', () => {
  const model = buildSuitModel()
  model.update('helmet', 0)
  for (const m of model.partMaterials.helmet) assert.equal(m.emissive.getHex(), SELECT_EMISSIVE)
  for (const m of model.partMaterials.boots) assert.equal(m.emissive.getHex(), 0x000000)
  model.update('boots', 0)
  for (const m of model.partMaterials.helmet) assert.equal(m.emissive.getHex(), 0x000000)
  for (const m of model.partMaterials.boots) assert.equal(m.emissive.getHex(), SELECT_EMISSIVE)
  const all = Object.values(model.partMaterials).flat()
  assert.equal(new Set(all).size, all.length)
})

test('dispose frees every geometry and material once, including unused templates', () => {
  const model = buildSuitModel()
  const mats = new Set<Material>()
  const geos = new Set<unknown>()
  for (const m of meshes(model)) {
    mats.add(m.material as Material)
    geos.add(m.geometry)
  }
  const disposed = new Set<unknown>()
  const watch = (o: { addEventListener: (t: 'dispose', f: () => void) => void }) => o.addEventListener('dispose', () => disposed.add(o))
  mats.forEach(watch)
  geos.forEach((g) => watch(g as never))
  // the template materials (e.g. the original glow) are only reachable through clone sources; track dispose count globally
  let count = 0
  const proto = Object.getPrototypeOf(model.sensorMaterials[0]) as { dispose: () => void }
  const orig = proto.dispose
  proto.dispose = function (this: unknown) {
    count++
    return orig.call(this)
  }
  try {
    model.dispose()
    model.dispose() // second call is a no-op
  } finally {
    proto.dispose = orig
  }
  for (const m of mats) assert.ok(disposed.has(m), 'rendered material disposed')
  for (const g of geos) assert.ok(disposed.has(g), 'geometry disposed')
  // 4 templates (suit, dark, gold, glow) + one clone per selectable mesh (10)
  assert.equal(count, 4 + Object.values(model.partMaterials).flat().length)
  assert.equal(model.group.children.length, 0)
})
